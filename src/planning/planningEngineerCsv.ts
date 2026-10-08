import { calculateScenarioCosts } from "./costEngine";
import { buildPlannerEstimate } from "./plannerPresentation";
import type { AllowanceCost, CostComponent, PlanningScenario, RateBasis, ScenarioCostResult } from "./types";

export const PLANNING_ENGINEER_CSV_FIELDS = [
  "planning_project", "alternative", "state", "row_type", "element", "work", "quantity", "unit", "unit_price", "amount", "cost_category", "status", "price_basis", "note",
] as const;

export type PlanningEngineerCsvField = typeof PLANNING_ENGINEER_CSV_FIELDS[number];
export type PlanningEngineerCsvRow = Record<PlanningEngineerCsvField, string>;

const number = (value: number | null | undefined): string => value === null || value === undefined ? "" : String(value);
const row = (): PlanningEngineerCsvRow => Object.fromEntries(PLANNING_ENGINEER_CSV_FIELDS.map((field) => [field, ""])) as PlanningEngineerCsvRow;
const externalName = (scopeId: string): string => scopeId === "right_of_way" ? "Property acquisition" : "Major utility relocation";

function issueText(items: { message: string }[]): string {
  return items.map((item) => item.message).filter(Boolean).join("; ");
}

function rateBasisLabel(basis: RateBasis | null, status: CostComponent["status"]): string {
  if (status === "excluded") return "Excluded scope";
  if (!basis) return status === "priced" ? "Priced" : "Price pending";
  if (basis.kind === "manual") return "Manual rate";
  if (basis.kind === "ne_annual") return `NDOT annual report (${basis.reportSeries}, ${basis.periodStart} to ${basis.periodEnd})`;
  return `CDOT bid median (${basis.actualFrom} to ${basis.actualTo})`;
}

function componentNote(component: CostComponent): string {
  const details = [component.exclusion?.reason, component.exclusion?.sectionEffect, issueText(component.issues)];
  if (component.rateBasis?.kind === "manual" && component.rateBasis.reason) details.push(component.rateBasis.reason);
  return details.filter(Boolean).join("; ");
}

function componentRow(project: string, scenario: PlanningScenario, component: CostComponent): PlanningEngineerCsvRow {
  const output = row();
  const instance = component.instanceId ? scenario.packages.find((entry) => entry.instanceId === component.instanceId) : undefined;
  output.planning_project = project;
  output.alternative = scenario.name;
  output.state = scenario.state;
  output.row_type = "component";
  output.element = instance?.definition.name ?? "Other work";
  output.work = component.description;
  output.quantity = number(component.quantity);
  output.unit = component.unit;
  output.unit_price = number(component.rate);
  output.amount = number(component.extendedCost);
  output.cost_category = component.category;
  output.status = component.status;
  output.price_basis = rateBasisLabel(component.rateBasis, component.status);
  output.note = componentNote(component);
  return output;
}

function allowanceBasis(allowance: AllowanceCost, scenario: PlanningScenario): string {
  const definition = scenario.allowances.find((entry) => entry.allowanceId === allowance.allowanceId);
  if (allowance.status === "excluded") return "Excluded scope";
  const base = definition?.base.kind.replace(/_/g, " ") ?? "calculation base";
  return `${number(allowance.percent)}% of ${base}`;
}

function allowanceNote(allowance: AllowanceCost, scenario: PlanningScenario): string {
  const definition = scenario.allowances.find((entry) => entry.allowanceId === allowance.allowanceId);
  return [allowance.reason, issueText(allowance.issues), definition?.exclusion?.reason, definition?.overrideReason].filter(Boolean).join("; ");
}

function allowanceRow(project: string, scenario: PlanningScenario, allowance: AllowanceCost): PlanningEngineerCsvRow {
  const output = row();
  output.planning_project = project;
  output.alternative = scenario.name;
  output.state = scenario.state;
  output.row_type = "allowance";
  output.element = "Allowances";
  output.work = allowance.name;
  output.unit = "%";
  output.unit_price = number(allowance.percent);
  output.amount = number(allowance.amount);
  output.cost_category = allowance.category;
  output.status = allowance.status;
  output.price_basis = allowanceBasis(allowance, scenario);
  output.note = allowanceNote(allowance, scenario);
  return output;
}

function impactRow(project: string, scenario: PlanningScenario, scope: PlanningScenario["externalScopes"][number]): PlanningEngineerCsvRow {
  const output = row();
  const noImpact = scope.decision === "none_assumed";
  output.planning_project = project;
  output.alternative = scenario.name;
  output.state = scenario.state;
  output.row_type = "impact";
  output.element = "Major project impacts";
  output.work = externalName(scope.scopeId);
  output.amount = noImpact ? "0" : number(scope.amount);
  output.cost_category = "external";
  output.status = noImpact ? "excluded" : scope.decision === "manual" && scope.amount !== null ? "priced" : "unpriced";
  output.price_basis = noImpact ? "No impact expected" : scope.decision === "manual" ? "Planner-entered amount" : "Scope not assessed";
  output.note = scope.reason;
  return output;
}

/** Builds the readable, lossless-enough-for-review Planning CSV; detailed provenance remains in JSON and buildPlanningCsv. */
export function buildPlanningEngineerCsv(
  scenario: PlanningScenario,
  planningProject: string = scenario.name,
  cost: ScenarioCostResult = calculateScenarioCosts(scenario),
): string {
  const estimate = buildPlannerEstimate(scenario, cost);
  const rows = [
    ...cost.components.map((component) => componentRow(planningProject, scenario, component)),
    ...cost.allowances.map((allowance) => allowanceRow(planningProject, scenario, allowance)),
    ...scenario.externalScopes.map((scope) => impactRow(planningProject, scenario, scope)),
  ];
  const summary = row();
  summary.planning_project = planningProject;
  summary.alternative = scenario.name;
  summary.state = scenario.state;
  summary.row_type = "estimate";
  summary.element = "Estimate";
  summary.work = estimate.amountLabel;
  summary.amount = number(estimate.amount);
  summary.status = estimate.fullScope ? "complete" : "incomplete";
  summary.note = [...estimate.notices.map((notice) => notice.text), ...estimate.excludedScope.map((scope) => `Excluded scope: ${scope}`)].join("; ");
  rows.push(summary);
  const csvCell = (value: string): string => {
    const safe = /^[\t ]*[=+\-@]/.test(value) ? `'${value}` : value;
    return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return [PLANNING_ENGINEER_CSV_FIELDS.join(","), ...rows.map((entry) => PLANNING_ENGINEER_CSV_FIELDS.map((field) => csvCell(entry[field])).join(","))].join("\r\n") + "\r\n";
}

