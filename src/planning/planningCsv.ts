import { calculateScenarioCosts } from "./costEngine";
import { getScenarioReviewStatus } from "./planningWorkspace";
import type { AllowanceCost, CostComponent, PlanningScenario, ScenarioCostResult } from "./types";

export const PLANNING_CSV_FIELDS = [
  "row_type", "scenario_id", "scenario_name", "state", "segment_id", "scope_id", "package_instance_id", "package_id", "package_version", "role", "description", "category", "status", "unit", "input_key", "input_value", "quantity", "original_quantity", "rate", "extended_cost", "rate_basis", "rate_provenance", "original_basis", "override_reason", "issues", "review_status", "reviewer", "review_date", "review_notes", "allowance_percent", "allowance_base", "allowance_amount", "external_decision", "external_reason", "cost_summary", "cost_total", "cost_complete", "missing_reasons",
] as const;
export type PlanningCsvField = typeof PLANNING_CSV_FIELDS[number];
export type PlanningCsvRow = Record<PlanningCsvField, string>;

const text = (value: unknown): string => value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
const number = (value: number | null | undefined): string => value === null || value === undefined ? "" : String(value);
const quote = (value: string): string => /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
const issueText = (items: { code: string; message: string }[]): string => items.map((item) => `${item.code}: ${item.message}`).join(" | ");
const basis = (component: CostComponent): string => component.rateBasis ? component.rateBasis.kind === "manual" ? "manual" : component.rateBasis.kind : "";
const provenance = (component: CostComponent): string => {
  const value = component.rateBasis;
  if (!value || value.kind === "manual") return value?.kind === "manual" ? value.reason : "";
  return text(value);
};
const blank = (): PlanningCsvRow => Object.fromEntries(PLANNING_CSV_FIELDS.map((field) => [field, ""])) as PlanningCsvRow;

function componentRow(scenario: PlanningScenario, component: CostComponent, cost: ScenarioCostResult): PlanningCsvRow {
  const row = blank();
  const instance = component.instanceId ? scenario.packages.find((entry) => entry.instanceId === component.instanceId) : undefined;
  const overrideReasons = [component.quantityOverride?.reason, instance?.rateOverrides[component.role]?.reason, instance?.exclusions[component.role]?.reason].filter((value): value is string => !!value).join(" | ");
  Object.assign(row, { row_type: "component", scenario_id: scenario.scenarioId, scenario_name: scenario.name, state: scenario.state, segment_id: component.segmentId, scope_id: component.scopeId, package_instance_id: component.instanceId ?? "", package_id: instance?.definition.packageId ?? "", package_version: instance?.definition.version ?? "", role: component.role, description: component.description, category: component.category, status: component.status, unit: component.unit, quantity: number(component.quantity), original_quantity: number(component.originalQuantity), rate: number(component.rate), extended_cost: number(component.extendedCost), rate_basis: basis(component), rate_provenance: provenance(component), original_basis: text(instance?.rateSnapshots[component.role] ?? ""), override_reason: [overrideReasons, component.exclusion?.sectionEffect].filter(Boolean).join(" | "), issues: issueText(component.issues), review_status: getScenarioReviewStatus(scenario) });
  row.reviewer = scenario.review?.reviewer ?? ""; row.review_date = scenario.review?.date ?? ""; row.review_notes = scenario.review?.notes ?? "";
  row.cost_summary = "total"; row.cost_total = number(cost.total); row.cost_complete = String(cost.complete);
  return row;
}

function allowanceRow(scenario: PlanningScenario, allowance: AllowanceCost, cost: ScenarioCostResult): PlanningCsvRow {
  const row = blank();
  const definition = scenario.allowances.find((entry) => entry.allowanceId === allowance.allowanceId);
  Object.assign(row, { row_type: "allowance", scenario_id: scenario.scenarioId, scenario_name: scenario.name, state: scenario.state, role: allowance.role, description: allowance.name, category: allowance.category, status: allowance.status, rate: number(allowance.percent), extended_cost: number(allowance.amount), allowance_percent: number(allowance.percent), allowance_base: number(allowance.baseAmount), allowance_amount: number(allowance.amount), original_basis: text(definition?.originalBasis ?? ""), issues: issueText(allowance.issues), override_reason: definition?.overrideReason ?? allowance.reason ?? "", review_status: getScenarioReviewStatus(scenario), cost_summary: "total", cost_total: number(cost.total), cost_complete: String(cost.complete) });
  return row;
}

/** Produces deterministic, review-oriented CSV with stable headers and source provenance. */
export function buildPlanningCsv(scenario: PlanningScenario, cost: ScenarioCostResult = calculateScenarioCosts(scenario)): string {
  const inputRows: PlanningCsvRow[] = [];
  for (const instance of [...scenario.packages].sort((a, b) => a.instanceId.localeCompare(b.instanceId))) {
    for (const definition of [...instance.definition.parameters].sort((a, b) => a.key.localeCompare(b.key))) {
      const row = blank();
      const override = Object.prototype.hasOwnProperty.call(instance.parameterOverrides, definition.key) ? instance.parameterOverrides[definition.key] : null;
      Object.assign(row, { row_type: "input", scenario_id: scenario.scenarioId, scenario_name: scenario.name, state: scenario.state, segment_id: instance.segmentId, scope_id: instance.scopeId, package_instance_id: instance.instanceId, package_id: instance.definition.packageId, package_version: instance.definition.version, role: "parameter", description: definition.label, input_key: definition.key, input_value: number(override ? override.value : definition.defaultValue), unit: definition.unit, original_basis: JSON.stringify({ defaultValue: definition.defaultValue, assumption: definition.assumption }), override_reason: override?.reason ?? "", review_status: getScenarioReviewStatus(scenario) });
      inputRows.push(row);
    }
  }
  const rows = [...inputRows, ...[...cost.components].sort((a, b) => a.componentId.localeCompare(b.componentId)).map((component) => componentRow(scenario, component, cost))];
  for (const external of [...scenario.externalScopes].sort((a, b) => a.scopeId.localeCompare(b.scopeId))) {
    const row = blank();
    Object.assign(row, { row_type: "external", scenario_id: scenario.scenarioId, scenario_name: scenario.name, state: scenario.state, role: external.scopeId, description: "External scope", status: external.decision, extended_cost: number(external.amount), external_decision: external.decision, external_reason: external.reason, review_status: getScenarioReviewStatus(scenario) });
    rows.push(row);
  }
  rows.push(...[...cost.allowances].sort((a, b) => a.allowanceId.localeCompare(b.allowanceId)).map((allowance) => allowanceRow(scenario, allowance, cost)));
  const summary = blank();
  Object.assign(summary, { row_type: "summary", scenario_id: scenario.scenarioId, scenario_name: scenario.name, state: scenario.state, description: "Scenario cost summary", cost_summary: JSON.stringify({ pricedDirectSubtotal: cost.pricedDirectSubtotal, directConstruction: cost.directConstruction, constructionSubtotal: cost.constructionSubtotal, contingency: cost.contingency, services: cost.services, external: cost.external, total: cost.total }), cost_total: number(cost.total), cost_complete: String(cost.complete), issues: issueText(cost.issues), missing_reasons: cost.missingComponentIds.join(" | "), review_status: getScenarioReviewStatus(scenario), reviewer: scenario.review?.reviewer ?? "", review_date: scenario.review?.date ?? "", review_notes: scenario.review?.notes ?? "" });
  rows.push(summary);
  return [PLANNING_CSV_FIELDS.join(","), ...rows.map((row) => PLANNING_CSV_FIELDS.map((field) => quote(row[field] ?? "")).join(","))].join("\n") + "\n";
}

export const buildPlanningCostReviewCsv = buildPlanningCsv;
export const buildPlanningCsvReview = buildPlanningCsv;
