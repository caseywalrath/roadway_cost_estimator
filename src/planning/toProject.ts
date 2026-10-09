// Converts one Planning v2 alternative into an engineer Project. Mapping: docs/planning-v2-implementation-plan.md section 5a.
import type { ProjectLineItem, UserProject } from "../projects/projectWorkspace";
import { projectCostSummary } from "../projects/projectWorkspace";
import { calculateAlternative, roundTotalAmount } from "./calculate";
import type { PlanningProject, ResolvedLibrary } from "./types";

export interface CatalogEntry {
  agencyId: string;
  agencyItemId: string;
  itemCode: string;
  description: string;
  unit: string;
}

export interface ToProjectOptions {
  /** ISO timestamp for createdAt/updatedAt of the project and lines, and origin.createdAt. */
  now: string;
  newId: (prefix: "project" | "line") => string;
  /** Catalog lookup by agencyItemId (price-table item id). null = not in catalog. */
  catalog: (agencyItemId: string) => CatalogEntry | null;
}

export interface ToProjectResult {
  project: UserProject;
  planningTotal: number;
  projectTotal: number;
  difference: number;
}

const GROUP_ALLOWANCES = "Allowances";
const GROUP_OTHER = "Engineering and other costs";

const cents = (x: number): number => Math.round(x * 100) / 100;
/** Percent text from a fraction: 0.56 -> "56", 0.125 -> "12.5". */
const pct = (fraction: number): string => String(Math.round(fraction * 100 * 1000) / 1000);
const normUnit = (unit: string): string => unit.trim().toUpperCase();
/** Whole dollars with separators: 1234567.4 -> "$1,234,567". */
const dollars = (n: number): string => `$${Math.round(n).toLocaleString("en-US")}`;

export function planningAlternativeToProject(
  library: ResolvedLibrary,
  planning: PlanningProject,
  alternativeId: string,
  options: ToProjectOptions
): ToProjectResult {
  const alternative = planning.alternatives.find((a) => a.id === alternativeId);
  if (!alternative) throw new Error(`Alternative ${alternativeId} not found in project ${planning.id}.`);
  const result = calculateAlternative(library, planning, alternativeId);
  const { summary } = result;
  const { now, newId, catalog } = options;
  const projectId = newId("project");

  const lineItems: ProjectLineItem[] = [];
  const addLine = (line: {
    type: "catalog" | "custom";
    category: "construction" | "other";
    group: string;
    entry?: CatalogEntry;
    itemCode?: string;
    description: string;
    unit: string;
    quantity: number;
    unitCost: number;
    notes: string;
  }): ProjectLineItem => {
    const item: ProjectLineItem = {
      lineItemId: newId("line"),
      lineItemType: line.type,
      costCategory: line.category,
      state: planning.state,
      agencyId: line.entry?.agencyId ?? "",
      agencyItemId: line.entry?.agencyItemId ?? "",
      group: line.group,
      itemCode: line.entry?.itemCode ?? line.itemCode ?? "",
      description: line.description,
      descriptionOverrideEnabled: line.type === "custom",
      unit: line.unit,
      quantity: line.quantity,
      preferredUnitCost: line.unitCost,
      notes: line.notes,
      evidenceContext: null,
      createdAt: now,
      updatedAt: now
    };
    lineItems.push(item);
    return item;
  };

  // Construction lines, element by element (result order: base, corridor, spot).
  let directTotal = 0;
  const constructionTotal = () => lineItems.reduce((sum, l) => sum + cents((l.quantity ?? 0) * (l.preferredUnitCost ?? 0)), 0);
  for (const element of result.elements) {
    if (!element.enabled) continue;
    if (element.override !== null) {
      const amount = cents(element.override);
      if (amount === 0) continue;
      addLine({
        type: "custom",
        category: "construction",
        group: element.label,
        itemCode: "",
        description: element.label,
        unit: "LS",
        quantity: 1,
        unitCost: amount,
        notes: `Planning: ${element.label}. Entered amount; includes allowances for minor items, traffic control and mobilization.`
      });
      continue;
    }
    for (const component of element.components) {
      const quantity = cents(component.quantity);
      if (quantity === 0) continue;
      const unitCost = cents(component.unitPrice);
      let line: ProjectLineItem;
      if (component.source.kind === "item") {
        const entry = catalog(component.source.itemId);
        if (entry && normUnit(entry.unit) === normUnit(component.unit)) {
          line = addLine({
            type: "catalog",
            category: "construction",
            group: element.label,
            entry,
            description: entry.description,
            unit: entry.unit,
            quantity,
            unitCost,
            notes: `Planning: ${element.label} – ${component.label}`
          });
        } else {
          const reason = entry ? `catalog unit ${entry.unit}` : "item not found";
          line = addLine({
            type: "custom",
            category: "construction",
            group: element.label,
            itemCode: component.source.code,
            description: component.source.description,
            unit: component.unit,
            quantity,
            unitCost,
            notes: `Planning: ${component.label}. Not linked to the catalog (${reason}).`
          });
        }
      } else {
        line = addLine({
          type: "custom",
          category: "construction",
          group: element.label,
          itemCode: "",
          description: `${element.label} – ${component.label}`,
          unit: component.unit,
          quantity,
          unitCost,
          notes: `Planning assembly cost per ${component.unit}. Basis: ${component.source.basis}.`
        });
      }
      directTotal += cents((line.quantity ?? 0) * (line.preferredUnitCost ?? 0));
    }
  }

  // Allowances on the non-overridden lines as created.
  const D = directTotal;
  if (D > 0) {
    const { minor, trafficControl, mobilization } = summary.factors;
    const note = `Planning factor for ${summary.baseType.replace(/_/g, " ")}`;
    const allowance = (description: string, amount: number) =>
      addLine({
        type: "custom",
        category: "construction",
        group: GROUP_ALLOWANCES,
        itemCode: "",
        description,
        unit: "LS",
        quantity: 1,
        unitCost: cents(amount),
        notes: note
      });
    allowance(`Minor items allowance (${pct(minor)}% of listed items)`, D * minor);
    allowance(`Traffic control allowance (${pct(trafficControl)}%)`, D * (1 + minor) * trafficControl);
    const mobilizationLine = allowance(
      `Mobilization allowance (${pct(mobilization)}%)`,
      D * (1 + minor) * (1 + trafficControl) * mobilization
    );
    // Absorb the cent residual so construction lines sum to the Planning construction amount.
    const residual = cents(summary.construction) - constructionTotal();
    mobilizationLine.preferredUnitCost = cents((mobilizationLine.preferredUnitCost ?? 0) + residual);
  }

  const k = summary.contingencyRate;
  const C = summary.construction;
  const otherLine = (description: string, amount: number, notes: string) => {
    const unitCost = cents(amount);
    if (unitCost === 0) return;
    addLine({
      type: "custom",
      category: "other",
      group: GROUP_OTHER,
      itemCode: "",
      description,
      unit: "LS",
      quantity: 1,
      unitCost,
      notes
    });
  };
  const engineeringNote = (rate: number) =>
    `Planning: ${pct(rate)}% of construction plus contingency. The Project contingency is applied to this line, so it shows ${pct(rate)}% of construction.`;
  if (summary.designRate > 0) otherLine("Design engineering", summary.designRate * C, engineeringNote(summary.designRate));
  if (summary.constructionEngineeringRate > 0) {
    otherLine("Construction engineering", summary.constructionEngineeringRate * C, engineeringNote(summary.constructionEngineeringRate));
  }
  const netNote = (entered: number) =>
    `Planning entered ${dollars(entered)}. Shown net of the ${pct(k)}% Project contingency so the Project total matches Planning.`;
  if (summary.rightOfWay > 0) otherLine("Right-of-way", summary.rightOfWay / (1 + k), netNote(summary.rightOfWay));
  if (summary.utilityRelocation > 0) {
    otherLine("Utility relocation", summary.utilityRelocation / (1 + k), netNote(summary.utilityRelocation));
  }

  const stage = library.stages.find((s) => s.id === planning.stageId) ?? library.stages.find((s) => s.id === library.defaultStage);
  const stageLabel = stage?.label ?? planning.stageId;
  const project: UserProject = {
    projectId,
    state: planning.state,
    name: `${planning.name} – ${alternative.name}`,
    location: "",
    notes:
      `Created from Planning estimate "${planning.name}", ${alternative.name}, on ${now.slice(0, 10)}. ` +
      `Stage: ${stageLabel}. Unit prices: ${library.priceBasisLabel}. Planning total ${dollars(roundTotalAmount(summary.total))}.`,
    status: "active",
    archivedAt: null,
    revision: 0,
    lastBackupAt: null,
    lastBackupRevision: null,
    contingencyPercent: Math.round(k * 100 * 1000) / 1000,
    createdAt: now,
    updatedAt: now,
    lineItems,
    planningOrigin: {
      planningProjectId: planning.id,
      planningProjectName: planning.name,
      alternativeId: alternative.id,
      alternativeName: alternative.name,
      createdAt: now,
      planningTotal: summary.total
    }
  };

  const projectTotal = projectCostSummary(project).totalProjectCost;
  return { project, planningTotal: summary.total, projectTotal, difference: projectTotal - summary.total };
}
