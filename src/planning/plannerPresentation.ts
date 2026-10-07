import type { PlanningScenario, ScenarioCostResult } from "./types";

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
}

const externalName = (id: string) => id === "right_of_way" ? "Property acquisition" : "Major utility relocation";
const sum = (...numbers: (number | null)[]) => numbers.every((value): value is number => value !== null && Number.isFinite(value))
  ? numbers.reduce<number>((total, value) => total + value!, 0) : null;

/** Planner copy derives from frozen scenario results; it never changes estimate completeness. */
export function buildPlannerEstimate(scenario: PlanningScenario, cost: ScenarioCostResult): PlannerEstimate {
  const notices: PlannerNotice[] = [];
  const hasBase = scenario.packages.some((instance) => instance.definition.kind !== "sidewalk");
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
  const construction = sum(cost.constructionSubtotal, cost.contingency);
  const knownExternal = scenario.externalScopes.reduce((total, scope) => total + (scope.decision === "manual" && typeof scope.amount === "number" && Number.isFinite(scope.amount) ? scope.amount : 0), 0);
  const pricedExternalWork = cost.components.filter((item) => item.category === "external" && item.status === "priced")
    .reduce((total, item) => total + (item.extendedCost ?? 0), 0);
  const pricedExternalAllowances = cost.allowances.filter((item) => item.category === "external" && item.status === "priced")
    .reduce((total, item) => total + (item.amount ?? 0), 0);
  const otherProjectCosts = sum(cost.services, knownExternal, pricedExternalWork, pricedExternalAllowances);
  const includedAmount = sum(construction, otherProjectCosts);
  const hasUnpricedWork = activeComponents.some((item) => item.status !== "priced") || cost.allowances.some((item) => item.status === "unpriced");
  const amount = !hasBase ? null : cost.complete ? cost.total : hasUnpricedWork ? cost.pricedDirectSubtotal : includedAmount;
  const amountLabel = !hasBase ? "Choose an improvement" : cost.complete ? "Planning estimate for included scope" : hasUnpricedWork ? "Priced items so far" : "Planning subtotal for included scope";
  const excludedScope = [
    ...scenario.externalScopes.filter((scope) => scope.decision === "unassessed").map((scope) => externalName(scope.scopeId)),
    ...(scenario.packages.some((instance) => instance.definition.kind !== "sidewalk") ? ["Widening, deep repairs, major grading, structures and lighting"] : []),
    ...(scenario.packages.some((instance) => instance.definition.kind === "sidewalk") ? ["Intermediate curb ramps and driveway crossings"] : []),
  ];
  const coverage = {
    state: scenario.state,
    packages: scenario.packages.map((instance) => [instance.definition.packageId, instance.definition.version, instance.definition.kind === "sidewalk" ? (instance.parameterOverrides.sides?.value ?? instance.definition.parameters.find((parameter) => parameter.key === "sides")?.defaultValue) : null, instance.definition.kind === "sidewalk" ? (instance.parameterOverrides.rampCount?.value ?? instance.definition.parameters.find((parameter) => parameter.key === "rampCount")?.defaultValue) : null]).sort(),
    components: cost.components.map((item) => [item.instanceId ? item.role : item.description, item.unit, item.status]).sort(),
    allowances: cost.allowances.map((item) => [item.role, item.status]).sort(),
    external: scenario.externalScopes.map((scope) => [scope.scopeId, scope.decision === "unassessed" ? "unassessed" : scope.decision === "none_assumed" ? "none" : scope.amount === null ? "unpriced" : "priced"]).sort(),
  };
  return { amount, amountLabel, construction: hasBase ? construction : null, otherProjectCosts: hasBase ? otherProjectCosts : null, fullScope: hasBase && cost.complete, notices: [...new Map(notices.map((notice) => [notice.text, notice])).values()], excludedScope, coverageKey: JSON.stringify(coverage) };
}

export function comparePlannerEstimates(left: PlannerEstimate, right: PlannerEstimate): number | null {
  return left.coverageKey === right.coverageKey && left.amount !== null && right.amount !== null ? right.amount - left.amount : null;
}
