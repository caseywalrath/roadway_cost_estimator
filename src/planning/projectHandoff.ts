import type { AgencyItemRecord } from "../data/schema";
import { projectTotal, type ProjectLineItem, type ProjectPlanningDecision, type ProjectPlanningLineOrigin, type UserProject } from "../projects/projectWorkspace";
import { calculateScenarioCosts } from "./costEngine";
import { scenarioFingerprint } from "./planningWorkspace";
import { normalizePlanningUnit } from "./units";
import type { CostComponent, PlanningScenario, PlanningWorkspace, ScenarioCostResult } from "./types";

export interface HandoffBridge {
  construction: number;
  other: number;
  withheld: string[];
  differenceFromCompleteTotal: number | null;
}
export type HandoffBuildResult =
  | { ok: true; project: UserProject; bridge: HandoffBridge; cost: ScenarioCostResult }
  | { ok: false; errors: string[] };

const blockingCodes = new Set(["scope_overlap", "duplicate_id", "allowance_cycle", "state_mismatch", "invalid_recipe", "invalid_number", "out_of_bounds", "integer_required", "reason_required", "missing_reference", "unit_mismatch"]);
const amount = (value: number | null): number => value ?? 0;
const lineId = (projectId: string, source: string): string => `${projectId}:${source}`;

/** Pure creation snapshot. Missing work becomes a named Project decision, never a zero-valued claim. */
export function buildProjectHandoff(input: {
  workspace: PlanningWorkspace;
  scenario: PlanningScenario;
  catalog: AgencyItemRecord[];
  token: string;
  projectId: string;
  projectName: string;
  now: string;
}): HandoffBuildResult {
  const { workspace, scenario, catalog, token, projectId, now } = input;
  const cost = calculateScenarioCosts(scenario);
  const errors = cost.issues.filter((issue) => issue.severity === "error" && blockingCodes.has(issue.code))
    .map((issue) => `${issue.path}: ${issue.message}`);
  if (workspace.state !== scenario.state || !workspace.scenarios.some((entry) => entry.scenarioId === scenario.scenarioId)) errors.push("Alternative does not belong to this Planning project.");
  if (scenario.packages.length === 0 && scenario.customComponents.length === 0) errors.push("Choose work before creating a Project.");
  if (!input.projectName.trim() || !token.trim() || !projectId.trim()) errors.push("Project name and handoff identity are required.");
  if (errors.length) return { ok: false, errors };

  const catalogById = new Map(catalog.filter((item) => item.state.toUpperCase() === scenario.state).map((item) => [item.agencyItemId, item]));
  const lineItems: ProjectLineItem[] = [];
  const decisions: ProjectPlanningDecision[] = [];
  const includedScope: string[] = [];
  const excludedScope: string[] = [];
  const withheld: string[] = [];
  const addLine = (source: string, description: string, category: "construction" | "other", quantity: number | null, rate: number | null, origin: ProjectPlanningLineOrigin, item: AgencyItemRecord | null, unit: string, group: string) => {
    const id = lineId(projectId, source);
    lineItems.push({
      lineItemId: id, lineItemType: item ? "catalog" : "custom", costCategory: category,
      state: scenario.state, agencyId: item?.agencyId ?? "", agencyItemId: item?.agencyItemId ?? "",
      group, itemCode: item?.itemCode ?? "", description, descriptionOverrideEnabled: !item,
      unit, quantity, preferredUnitCost: rate, notes: "",
      evidenceContext: null, planningOrigin: origin, createdAt: now, updatedAt: now,
    });
    if (quantity === null || rate === null || rate === 0) {
      decisions.push({ decisionId: `price:${source}`, label: description, kind: "line", lineItemId: id,
        status: rate === 0 && quantity !== null && origin.reason?.trim() ? "resolved" : "pending",
        reason: rate === 0 && quantity !== null ? origin.reason ?? "" : "", sourceAmount: origin.originalAmount });
      if (quantity === null || rate === null || !origin.reason?.trim()) withheld.push(description);
    }
  };

  for (const component of cost.components) {
    if (component.status === "excluded") {
      excludedScope.push(`${component.description}: ${component.exclusion?.reason ?? "Removed"}`);
      continue;
    }
    includedScope.push(component.description);
    const binding = component.binding;
    const item = binding ? catalogById.get(binding.agencyItemId) ?? null : null;
    if (binding && (!item || item.agencyId !== binding.agencyId || normalizePlanningUnit(item.officialUnit) !== binding.unit)) {
      errors.push(`Catalog identity or unit unavailable for ${component.description} (${binding.agencyItemId}/${binding.unit}).`);
      continue;
    }
    const instance = scenario.packages.find((entry) => entry.instanceId === component.instanceId);
    const origin: ProjectPlanningLineOrigin = {
      sourceId: component.componentId, role: component.role,
      packageId: instance?.definition.packageId ?? null, packageVersion: instance?.definition.version ?? null,
      sourceKind: "component", originalQuantity: component.quantity, originalUnitRate: component.rate,
      originalAmount: component.extendedCost, originalUnit: component.unit,
      reason: component.quantityOverride?.reason ?? (component.rateBasis?.kind === "manual" ? component.rateBasis.reason : null),
      rateBasis: component.rateBasis, allowanceRule: null,
    };
    addLine(`component:${component.componentId}`, component.description,
      component.category === "construction" ? "construction" : "other", component.quantity,
      component.rate, origin, item, item?.officialUnit ?? component.unit,
      instance?.definition.name ?? "Other work");
  }
  if (errors.length) return { ok: false, errors };

  let frozenContingencyLineId: string | null = null;
  for (const allowance of cost.allowances) {
    const definition = scenario.allowances.find((entry) => entry.allowanceId === allowance.allowanceId);
    if (!definition) continue;
    if (allowance.status === "excluded") {
      excludedScope.push(`${allowance.name}: ${allowance.reason ?? "Removed"}`);
      continue;
    }
    const source = `allowance:${allowance.allowanceId}`;
    const category = allowance.category === "construction" ? "construction" : "other";
    const origin: ProjectPlanningLineOrigin = {
      sourceId: allowance.allowanceId, role: allowance.role, packageId: null, packageVersion: null,
      sourceKind: allowance.role === "contingency" ? "contingency" : "allowance",
      originalQuantity: allowance.amount === null ? null : 1, originalUnitRate: allowance.amount,
      originalAmount: allowance.amount, originalUnit: "LS", reason: definition.overrideReason,
      rateBasis: null, allowanceRule: { percent: allowance.percent, base: structuredClone(definition.base), baseAmount: allowance.baseAmount },
    };
    if (allowance.role === "contingency") frozenContingencyLineId = lineId(projectId, source);
    addLine(source, allowance.role === "contingency" ? "Frozen Planning contingency" : allowance.name,
      category, allowance.amount === null ? null : 1, allowance.amount, origin, null, "LS",
      category === "construction" ? "Construction allowances" : "Other costs");
  }

  for (const scope of scenario.externalScopes) {
    const label = scope.scopeId === "right_of_way" ? "Right-of-way" : "Major utilities";
    if (scope.decision === "none_assumed") { excludedScope.push(`${label}: none assumed — ${scope.reason}`); continue; }
    if (scope.decision === "unassessed") {
      decisions.push({ decisionId: `scope:${scope.scopeId}`, label, kind: "scope", lineItemId: null,
        status: "pending", reason: "", sourceAmount: null });
      withheld.push(label);
      continue;
    }
    if (scope.amount === null) {
      decisions.push({ decisionId: `scope:${scope.scopeId}`, label, kind: "scope", lineItemId: null,
        status: "pending", reason: "", sourceAmount: null });
      withheld.push(label);
      continue;
    }
    addLine(`external:${scope.scopeId}`, label, "other", 1, scope.amount,
      { sourceId: scope.scopeId, role: scope.scopeId, packageId: null, packageVersion: null,
        sourceKind: "external", originalQuantity: 1, originalUnitRate: scope.amount,
        originalAmount: scope.amount, originalUnit: "LS", reason: scope.reason, rateBasis: null, allowanceRule: null },
      null, "LS", "Other costs");
  }

  const pricedSubtotal = lineItems.reduce((sum, line) => sum + (line.quantity === null || line.preferredUnitCost === null ? 0 : line.quantity * line.preferredUnitCost), 0);
  const project: UserProject = {
    projectId, state: scenario.state, name: input.projectName.trim(), location: scenario.location,
    notes: scenario.notes, status: "active", archivedAt: null, revision: 0,
    lastBackupAt: null, lastBackupRevision: null, contingencyPercent: 0,
    createdAt: now, updatedAt: now, lineItems,
    planningOrigin: { token, workspaceId: workspace.workspaceId, workspaceName: workspace.name,
      scenarioId: scenario.scenarioId, scenarioName: scenario.name, fingerprint: scenarioFingerprint(scenario),
      capturedAt: now, includedScope, excludedScope, decisions, frozenContingencyLineId,
      planningTotal: cost.total, planningPricedSubtotal: pricedSubtotal },
  };
  const difference = cost.total === null ? null : Math.abs(projectTotal(project) - cost.total);
  if (difference !== null && difference > 0.01) return { ok: false, errors: [`Project starting total differs from Planning by ${difference.toFixed(2)}.`] };
  return { ok: true, project, cost, bridge: {
    construction: lineItems.filter((line) => line.costCategory === "construction").reduce((sum, line) => sum + amount(line.quantity === null || line.preferredUnitCost === null ? null : line.quantity * line.preferredUnitCost), 0),
    other: lineItems.filter((line) => line.costCategory === "other").reduce((sum, line) => sum + amount(line.quantity === null || line.preferredUnitCost === null ? null : line.quantity * line.preferredUnitCost), 0),
    withheld, differenceFromCompleteTotal: difference,
  } };
}
