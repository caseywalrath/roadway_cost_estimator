import { elementInputValues } from "./library";
import type {
  AlternativeResult,
  ComponentResult,
  ElementResult,
  FactorSet,
  InputValue,
  PlanningIssue,
  PlanningProject,
  QuantityRule,
  ResolvedLibrary,
  StageDefinition
} from "./types";

const FEET_PER_MILE = 5280;

/** Rounds to the nearest 1/perUnit, half away from zero. */
function roundHalfAway(n: number, perUnit: number): number {
  return (Math.sign(n) * Math.round(Math.abs(n) * perUnit + 1e-9)) / perUnit + 0;
}

export const roundElementAmount = (n: number) => roundHalfAway(n, 1 / 1000);
export const roundTotalAmount = (n: number) => roundHalfAway(n, 1 / 10000);
export const roundUnitPrice = (n: number) => roundHalfAway(n, 100);

export function combinedMultiplier(f: FactorSet): number {
  return (1 + f.minor) * (1 + f.trafficControl) * (1 + f.mobilization);
}

export function evaluateQuantity(rule: QuantityRule, values: Record<string, InputValue>): { quantity: number; issues: PlanningIssue[] } {
  const issues: PlanningIssue[] = [];
  const read = (key: string): number => {
    const value = values[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
    issues.push({ code: "invalid_input", path: key, message: `Input ${key} must be a number of 0 or more.` });
    return 0;
  };
  const sides = () => ("sides" in rule && rule.sides !== undefined ? read(rule.sides) : 1);
  const lengthFt = () => ("length" in rule ? read(rule.length) * FEET_PER_MILE : 0);

  let quantity = 0;
  switch (rule.kind) {
    case "area":
      quantity = (lengthFt() * read(rule.width) * sides()) / 9;
      break;
    case "volume":
      quantity = (lengthFt() * read(rule.width) * sides() * read(rule.depth)) / 12 / 27;
      break;
    case "asphalt_tons":
      quantity = ((lengthFt() * read(rule.width) * read(rule.thickness)) / 12) * read(rule.density) / 2000 * read(rule.materialFactor);
      break;
    case "linear":
      quantity = lengthFt() * sides();
      break;
    case "miles":
      quantity = read(rule.length) * sides();
      break;
    case "count":
      quantity = read(rule.count);
      break;
  }
  return issues.length > 0 ? { quantity: 0, issues } : { quantity, issues };
}

export function calculateAlternative(
  library: ResolvedLibrary,
  project: PlanningProject,
  alternativeId: string = project.selectedAlternativeId
): AlternativeResult {
  const alternative = project.alternatives.find((a) => a.id === alternativeId);
  if (!alternative) throw new Error(`Alternative ${alternativeId} not found in project ${project.id}.`);
  const issues: PlanningIssue[] = [];
  const selectionOf = (id: string) => alternative.selections[id];

  const enabledBases = library.elements.filter((e) => e.group === "base" && selectionOf(e.id)?.enabled);
  const baseType = enabledBases[0]?.baseType ?? "elements_only";
  if (enabledBases.length > 1) {
    issues.push({ code: "multiple_base", path: "selections", message: `More than one base treatment is enabled; using ${enabledBases[0].id}.` });
  }
  const factors = library.factors[baseType];
  const multiplier = combinedMultiplier(factors);

  let stage: StageDefinition | undefined = library.stages.find((s) => s.id === project.stageId);
  if (!stage) {
    issues.push({ code: "unknown_stage", path: "stageId", message: `Stage ${project.stageId} not found; using the default stage.` });
    stage = library.stages.find((s) => s.id === library.defaultStage) ?? library.stages[0];
  }

  const elements: ElementResult[] = library.elements
    .filter((element) => element.group !== "other")
    .map((element) => {
      const selection = selectionOf(element.id);
      const enabled = selection?.enabled ?? false;
      const inputs = elementInputValues(element, selection, project.inputs);
      const components: ComponentResult[] = [];
      for (const component of element.components) {
        if (component.when && inputs[component.when.input] !== component.when.equals) continue;
        const { quantity, issues: quantityIssues } = evaluateQuantity(component.quantity, inputs);
        if (enabled) {
          for (const issue of quantityIssues) {
            issues.push({ ...issue, path: `${element.id}.${component.id}.${issue.path}` });
          }
        }
        components.push({
          id: component.id,
          label: component.label,
          quantity,
          unit: component.displayUnit,
          unitPrice: component.unitPrice,
          amount: quantity * component.unitPrice,
          source: component.source
        });
      }
      const direct = components.reduce((sum, c) => sum + c.amount, 0);
      const calculated = direct * multiplier;
      const override = selection?.override ?? null;
      return {
        elementId: element.id,
        label: element.label,
        group: element.group,
        enabled,
        inputs,
        components,
        direct,
        calculated,
        override,
        amount: override ?? calculated
      };
    });

  const construction = elements.filter((e) => e.enabled).reduce((sum, e) => sum + e.amount, 0);
  const contingency = construction * stage.contingency;
  const design = (construction + contingency) * project.engineering.design;
  const constructionEngineering = (construction + contingency) * project.engineering.constructionEngineering;
  const rightOfWay = selectionOf("right_of_way")?.override ?? 0;
  const utilityRelocation = selectionOf("utility_relocation")?.override ?? 0;
  const total = construction + contingency + design + constructionEngineering + rightOfWay + utilityRelocation;

  return {
    alternativeId,
    elements,
    issues,
    summary: {
      baseType,
      factors,
      multiplier,
      construction,
      contingencyRate: stage.contingency,
      contingency,
      designRate: project.engineering.design,
      design,
      constructionEngineeringRate: project.engineering.constructionEngineering,
      constructionEngineering,
      rightOfWay,
      utilityRelocation,
      total,
      rangeLow: total * (1 + stage.rangeLow),
      rangeHigh: total * (1 + stage.rangeHigh),
      budget: project.budget,
      budgetRemaining: project.budget === null ? null : project.budget - total
    }
  };
}
