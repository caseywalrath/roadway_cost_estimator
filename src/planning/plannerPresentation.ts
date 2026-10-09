import type { PackageKind, PlanningScenario, ScenarioCostResult } from "./types";

export interface PlannerNotice { kind: "price" | "scope" | "evidence"; text: string }
export interface PlannerEstimate {
  amount: number | null;
  amountLabel: string;
  construction: number | null;
  otherProjectCosts: number | null;
  fullScope: boolean;
  notices: PlannerNotice[];
  excludedScope: string[];
  coverageKey: string;
  lines: { label: string; amount: number | null; detail?: string; group: "construction" | "other" }[];
}

const externalName = (id: string) => id === "right_of_way" ? "Property acquisition" : "Major utility relocation";
const isBaseKind = (kind: PackageKind) => kind === "resurfacing" || kind === "reconstruction" || kind === "path";
const sum = (...numbers: (number | null)[]) => numbers.every((value): value is number => value !== null && Number.isFinite(value))
  ? numbers.reduce<number>((total, value) => total + value!, 0) : null;

/** Planner copy derives from frozen scenario results; it never changes estimate completeness. */
export function buildPlannerEstimate(scenario: PlanningScenario, cost: ScenarioCostResult): PlannerEstimate {
  const notices: PlannerNotice[] = [];
  const hasBase = scenario.packages.some((instance) => isBaseKind(instance.definition.kind));
  if (!hasBase) notices.push({ kind: "scope", text: "Choose an improvement type to begin the estimate." });
  const activeComponents = cost.components.filter((item) => item.status !== "excluded");
  for (const component of activeComponents.filter((item) => item.status !== "priced")) {
    notices.push({ kind: "price", text: `${component.description} needs an engineer price or a scope change.` });
  }
  for (const allowance of cost.allowances.filter((item) => item.status === "unpriced")) {
    notices.push({ kind: "price", text: `${allowance.name} cannot be calculated until its priced work is resolved.` });
  }
  for (const scope of scenario.externalScopes) {
    if (scope.decision === "unassessed") notices.push({ kind: "scope", text: `Confirm whether ${externalName(scope.scopeId).toLowerCase()} is expected.` });
    if (scope.decision === "manual" && (scope.amount === null || !Number.isFinite(scope.amount))) notices.push({ kind: "price", text: `${externalName(scope.scopeId)} needs an amount from an engineer.` });
  }
  for (const instance of scenario.packages) {
    for (const snapshot of Object.values(instance.rateSnapshots)) {
      if (snapshot.kind === "co_contract_median" && snapshot.limitedEvidence) notices.push({ kind: "evidence", text: `${instance.definition.name} uses limited Colorado bid-price evidence; check the source before relying on it.` });
    }
  }
  const lines: PlannerEstimate["lines"] = [];
  for (const instance of scenario.packages) {
    const selected = cost.components.filter((item) => item.instanceId === instance.instanceId && item.status !== "excluded");
    if (!selected.length) continue;
    const priced = selected.filter((item) => item.status === "priced" && item.extendedCost !== null);
    const amount = priced.length ? priced.reduce((total, item) => total + item.extendedCost!, 0) : null;
    lines.push({ label: instance.definition.kind === "sidewalk" ? "Sidewalk" : instance.definition.kind === "curb_gutter" ? "Curb and gutter" : instance.definition.name, amount, detail: selected.some((item) => item.status !== "priced") ? "Partial" : undefined, group: selected[0].category === "construction" ? "construction" : "other" });
  }
  for (const component of cost.components.filter((item) => item.instanceId === null && item.status !== "excluded")) {
    lines.push({ label: component.description, amount: component.status === "priced" ? component.extendedCost : null, group: component.category === "construction" ? "construction" : "other" });
  }
  for (const allowance of cost.allowances.filter((item) => item.status !== "excluded")) {
    lines.push({ label: allowance.name, amount: allowance.status === "priced" ? allowance.amount : null, detail: allowance.percent === null ? undefined : `${allowance.percent}%`, group: allowance.category === "construction" ? "construction" : allowance.role === "contingency" ? "construction" : "other" });
  }
  for (const scope of scenario.externalScopes.filter((item) => item.decision === "manual")) {
    lines.push({ label: externalName(scope.scopeId), amount: scope.amount, group: "other" });
  }
  const pricedSum = (group: "construction" | "other") => lines.filter((line) => line.group === group).reduce((total, line) => total + (line.amount ?? 0), 0);
  const construction = pricedSum("construction");
  const otherProjectCosts = pricedSum("other");
  const includedAmount = sum(construction, otherProjectCosts);
  const hasUnpricedWork = activeComponents.some((item) => item.status !== "priced") || cost.allowances.some((item) => item.status === "unpriced");
  const amount = !hasBase ? null : cost.complete ? cost.total : includedAmount;
  const amountLabel = !hasBase ? "Choose an improvement" : cost.complete ? "Planning estimate for included scope" : hasUnpricedWork ? "Priced items so far" : "Planning subtotal for included scope";
  const excludedScope = [
    ...scenario.externalScopes.filter((scope) => scope.decision === "unassessed").map((scope) => externalName(scope.scopeId)),
    ...(hasBase ? ["Widening, deep repairs, major grading, structures and lighting"] : []),
    ...(scenario.packages.some((instance) => instance.definition.kind === "sidewalk") ? ["Intermediate curb ramps and driveway crossings"] : []),
    ...(scenario.packages.some((instance) => instance.definition.kind === "curb_gutter") ? ["Existing curb removal, driveway returns and drainage connections"] : []),
  ];
  const coverage = {
    state: scenario.state,
    packages: scenario.packages.map((instance) => [instance.definition.packageId, instance.definition.version, instance.definition.kind === "sidewalk" || instance.definition.kind === "curb_gutter" ? (instance.parameterOverrides.sides?.value ?? instance.definition.parameters.find((parameter) => parameter.key === "sides")?.defaultValue) : null, instance.definition.kind === "sidewalk" ? (instance.parameterOverrides.rampCount?.value ?? instance.definition.parameters.find((parameter) => parameter.key === "rampCount")?.defaultValue) : null]).sort(),
    components: cost.components.map((item) => [item.instanceId ? item.role : item.description, item.unit, item.status]).sort(),
    allowances: cost.allowances.map((item) => [item.role, item.status]).sort(),
    external: scenario.externalScopes.map((scope) => [scope.scopeId, scope.decision === "unassessed" ? "unassessed" : scope.decision === "none_assumed" ? "none" : scope.amount === null ? "unpriced" : "priced"]).sort(),
  };
  return { amount, amountLabel, construction: hasBase ? construction : null, otherProjectCosts: hasBase ? otherProjectCosts : null, fullScope: hasBase && cost.complete, notices: [...new Map(notices.map((notice) => [notice.text, notice])).values()], excludedScope, coverageKey: JSON.stringify(coverage), lines };
}

export function comparePlannerEstimates(left: PlannerEstimate, right: PlannerEstimate): number | null {
  return left.coverageKey === right.coverageKey && left.amount !== null && right.amount !== null ? right.amount - left.amount : null;
}
