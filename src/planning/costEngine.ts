import { generateScenarioComponents } from "./quantityEngine";
import { validatePlanningScenario } from "./validateRecipes";
import type {
  AllowanceCost,
  AllowanceDefinition,
  CostComponent,
  PlanningIssue,
  PlanningState,
  PlanningScenario,
  ScenarioCostResult,
} from "./types";

const issue = (code: string, path: string, message: string, severity: PlanningIssue["severity"] = "error"): PlanningIssue => ({ code, path, message, severity });
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

const allowanceAssumption = (state: PlanningState, role: AllowanceDefinition["role"], description: string): AllowanceDefinition["assumption"] => ({
  id: `${state.toLowerCase()}-${role}-pilot`,
  description,
  origin: state === "NE" && ["mobilization", "traffic", "contingency", "design", "construction_engineering"].includes(role) ? "workbook_reference" : "pilot_assumption",
  ...(state === "NE" && ["mobilization", "traffic", "contingency", "design", "construction_engineering"].includes(role) ? { reference: "Giles workbook starting percentages; provisional only, not calibrated." } : {}),
});

export function createDefaultAllowances(state: PlanningState): AllowanceDefinition[] {
  const make = (
    role: AllowanceDefinition["role"], name: string, category: AllowanceDefinition["category"], percent: number | null,
    base: AllowanceDefinition["base"], enabled = true, overlapTags: string[] = [],
  ): AllowanceDefinition => ({
    allowanceId: role,
    role,
    name,
    category,
    enabled,
    percent,
    base,
    originalBasis: { percent, base: structuredClone(base), enabled },
    assumption: allowanceAssumption(state, role, `${name} is a provisional Planning allowance; confirm project-specific basis and percentage.`),
    overrideReason: null,
    overlapTags,
    exclusion: null,
  });
  return [
    make("mobilization", "Mobilization", "construction", 8, { kind: "direct_construction" }),
    make("traffic", "Traffic control", "construction", 5, { kind: "direct_construction" }),
    make("drainage", "Drainage allowance", "construction", 20, { kind: "direct_construction" }, false, ["drainage"]),
    make("minor_utilities", "Minor utilities allowance", "construction", 5, { kind: "direct_construction" }, false, ["minor_utilities"]),
    make("contingency", "Contingency", "construction", 25, { kind: "construction_subtotal" }),
    make("design", "Design engineering", "service", 10, { kind: "construction_with_contingency" }),
    make("construction_engineering", "Construction engineering", "service", 10, { kind: "construction_with_contingency" }),
  ];
}

interface MutableAllowanceCost extends AllowanceCost { issues: PlanningIssue[] }

export function calculateScenarioCosts(scenario: PlanningScenario): ScenarioCostResult {
  const components = generateScenarioComponents(scenario);
  const validationIssues = validatePlanningScenario(scenario);
  const issues = [
    ...validationIssues,
    ...components.filter((component) => component.status !== "excluded").flatMap((component) => component.issues),
  ];
  const componentById = new Map(components.map((component) => [component.componentId, component]));
  const direct = components.filter((component) => component.category === "construction" && component.status !== "excluded");
  const directSum = direct.reduce((sum, component) => sum + (component.status === "priced" && component.extendedCost !== null ? component.extendedCost : 0), 0);
  const pricedDirectSubtotal = Number.isFinite(directSum) ? directSum : null;
  if (pricedDirectSubtotal === null) issues.push(issue("invalid_number", "pricedDirectSubtotal", "Priced direct subtotal exceeds the finite numeric range."));
  let directConstruction = direct.some((component) => component.required && component.status !== "priced") ? null : (Number.isFinite(directSum) ? directSum : null);
  if (directConstruction !== null && !Number.isFinite(directConstruction)) {
    directConstruction = null;
    issues.push(issue("invalid_number", "directConstruction", "Direct construction total exceeds the finite numeric range."));
  }

  const allAllowances = Array.isArray(scenario.allowances) ? scenario.allowances : [];
  const substitutedAllowanceReasons = new Map<string, string>();
  const substitutionCandidates = new Map<string, string[]>();
  for (const [index, substitution] of (scenario.substitutions ?? []).entries()) {
    const replacement = componentById.get(substitution.replacementComponentId);
    const hasStructuralErrors = validationIssues.some((entry) => entry.severity === "error" && entry.path.startsWith(`scenario.substitutions[${index}]`));
    if (!replacement || replacement.status === "excluded" || replacement.issues.some((entry) => entry.code === "scope_overlap") || !nonblank(substitution.reason) || hasStructuralErrors) continue;
    for (const allowanceId of substitution.replacedAllowanceIds) {
      substitutionCandidates.set(allowanceId, [...(substitutionCandidates.get(allowanceId) ?? []), substitution.reason.trim()]);
    }
  }
  for (const [allowanceId, reasons] of substitutionCandidates) if (reasons.length === 1) substitutedAllowanceReasons.set(allowanceId, reasons[0]);
  const roleGroups = new Map<string, AllowanceDefinition[]>();
  for (const allowance of allAllowances) if (allowance.role !== "custom" && allowance.enabled && !allowance.exclusion && !substitutedAllowanceReasons.has(allowance.allowanceId)) roleGroups.set(allowance.role, [...(roleGroups.get(allowance.role) ?? []), allowance]);
  const duplicateAllowanceIds = new Set<string>();
  for (const [role, group] of roleGroups) if (group.length > 1) {
    for (const allowance of group) {
      duplicateAllowanceIds.add(allowance.allowanceId);
      issues.push(issue("duplicate_id", `allowances/${allowance.allowanceId}`, `Multiple active allowance definitions use built-in role '${role}'.`));
    }
  }

  const allowances = new Map<string, MutableAllowanceCost>();
  const definitionById = new Map<string, AllowanceDefinition>();
  for (const allowance of allAllowances) {
    definitionById.set(allowance.allowanceId, allowance);
    allowances.set(allowance.allowanceId, {
      allowanceId: allowance.allowanceId, role: allowance.role, name: allowance.name, category: allowance.category,
      percent: allowance.percent, baseAmount: null, amount: null, status: "unpriced", reason: null, issues: [],
    });
  }
  const allowanceValueCache = new Map<string, number | null>();
  const cycleIds = new Set<string>();
  const allowanceStack: string[] = [];

  const activeDefinition = (definition: AllowanceDefinition): boolean =>
    definition.enabled && !definition.exclusion && !substitutedAllowanceReasons.has(definition.allowanceId);
  const excludedAllowanceReason = (definition: AllowanceDefinition): string | null =>
    substitutedAllowanceReasons.get(definition.allowanceId) ?? definition.exclusion?.reason ?? null;
  const attachAllowanceIssue = (id: string, entry: PlanningIssue): void => {
    const result = allowances.get(id);
    if (result && !result.issues.some((existing) => existing.code === entry.code && existing.path === entry.path)) result.issues.push(entry);
    if (!issues.some((existing) => existing.code === entry.code && existing.path === entry.path)) issues.push(entry);
  };

  const valueForAllowance = (id: string): number | null => {
    if (allowanceValueCache.has(id)) return allowanceValueCache.get(id) ?? null;
    const definition = definitionById.get(id);
    if (!definition) return null;
    if (!activeDefinition(definition)) {
      const result = allowances.get(id)!;
      result.status = "excluded";
      result.reason = excludedAllowanceReason(definition) ?? "Allowance disabled by scenario.";
      allowanceValueCache.set(id, null);
      return null;
    }
    if (duplicateAllowanceIds.has(id)) {
      attachAllowanceIssue(id, issue("duplicate_id", `allowances/${id}`, "Built-in allowance role is duplicated."));
      return null;
    }
    const cycleAt = allowanceStack.indexOf(id);
    if (cycleAt >= 0) {
      for (const cycleId of allowanceStack.slice(cycleAt)) cycleIds.add(cycleId);
      cycleIds.add(id);
      attachAllowanceIssue(id, issue("allowance_cycle", `allowances/${id}`, "Allowance bases contain a dependency cycle."));
      return null;
    }
    const result = allowances.get(id)!;
    if (definition.percent === null || !finiteNonnegative(definition.percent)) {
      attachAllowanceIssue(id, issue(definition.percent === null ? "missing_rate" : "invalid_number", `allowances/${id}/percent`, "Enabled allowance percentage must be finite and nonnegative."));
      result.status = "unpriced";
      return null;
    }
    allowanceStack.push(id);
    const baseAmount = valueForBase(definition.base);
    allowanceStack.pop();
    if (cycleIds.has(id)) {
      attachAllowanceIssue(id, issue("allowance_cycle", `allowances/${id}`, "Allowance bases contain a dependency cycle."));
      result.status = "unpriced";
      result.reason = "Allowance dependency cycle.";
      allowanceValueCache.set(id, null);
      return null;
    }
    result.baseAmount = baseAmount;
    if (baseAmount === null) {
      result.status = "unpriced";
      result.reason = "Allowance base is unavailable because required scope or a referenced value is unpriced.";
      attachAllowanceIssue(id, issue("missing_quantity", `allowances/${id}/base`, result.reason));
      allowanceValueCache.set(id, null);
      return null;
    }
    const amount = baseAmount * definition.percent / 100;
    if (!Number.isFinite(amount)) {
      result.status = "unpriced";
      result.reason = "Allowance amount is not finite.";
      attachAllowanceIssue(id, issue("invalid_number", `allowances/${id}/amount`, result.reason));
      allowanceValueCache.set(id, null);
      return null;
    }
    result.amount = amount;
    result.status = "priced";
    result.reason = definition.overrideReason;
    allowanceValueCache.set(id, amount);
    return amount;
  };

  const directValue = (): number | null => directConstruction;
  const activeConstructionAllowances = (): AllowanceDefinition[] => allAllowances.filter((allowance) =>
    allowance.category === "construction" && allowance.role !== "contingency" && activeDefinition(allowance));
  const subtotalValue = (): number | null => {
    if (directConstruction === null) return null;
    if (issues.some((entry) => entry.code === "scope_overlap")) return null;
    let subtotal = directConstruction;
    for (const allowance of activeConstructionAllowances()) {
      const amount = valueForAllowance(allowance.allowanceId);
      if (amount === null) return null;
      subtotal += amount;
    }
    if (!Number.isFinite(subtotal)) {
      issues.push(issue("invalid_number", "constructionSubtotal", "Construction subtotal exceeds the finite numeric range."));
      return null;
    }
    return subtotal;
  };
  const contingencyValue = (): number | null => {
    const enabled = allAllowances.filter((allowance) => allowance.role === "contingency" && activeDefinition(allowance));
    if (enabled.length === 0) return 0;
    if (enabled.length !== 1) return null;
    return valueForAllowance(enabled[0].allowanceId);
  };
  const subtotalWithContingency = (): number | null => {
    const subtotal = subtotalValue();
    const contingency = contingencyValue();
    if (subtotal === null || contingency === null) return null;
    const total = subtotal + contingency;
    if (!Number.isFinite(total)) {
      issues.push(issue("invalid_number", "constructionWithContingency", "Construction plus contingency exceeds the finite numeric range."));
      return null;
    }
    return total;
  };

  function valueForBase(base: AllowanceDefinition["base"]): number | null {
    switch (base.kind) {
      case "direct_construction": return directValue();
      case "construction_subtotal": return subtotalValue();
      case "construction_with_contingency": return subtotalWithContingency();
      case "references": {
        let total = 0;
        for (const ref of new Set(base.componentIds)) {
          if (componentById.has(ref)) {
            const component = componentById.get(ref)!;
            if (component.status === "excluded") continue;
            if (component.status !== "priced" || component.extendedCost === null) return null;
            total += component.extendedCost;
          } else return null;
          if (!Number.isFinite(total)) return null;
        }
        for (const ref of new Set(base.allowanceIds)) {
          if (definitionById.has(ref)) {
            const allowance = allowances.get(ref)!;
            const amount = valueForAllowance(ref);
            if (allowance.status === "excluded") continue;
            if (amount === null) return null;
            total += amount;
          } else {
            return null;
          }
          if (!Number.isFinite(total)) return null;
        }
        return total;
      }
    }
  }

  // Evaluate every allowance so enabled, unpriced rows remain visible even when no total uses them.
  for (const definition of allAllowances) valueForAllowance(definition.allowanceId);
  for (const id of cycleIds) {
    const result = allowances.get(id);
    if (result) {
      result.status = "unpriced";
      result.amount = null;
      result.reason = "Allowance dependency cycle.";
    }
  }

  const allowanceCosts = allAllowances.map((definition) => allowances.get(definition.allowanceId)!);
  const sumAllowanceCategory = (category: AllowanceDefinition["category"]): number | null => {
    const selected = allowanceCosts.filter((cost) => cost.category === category && cost.status !== "excluded");
    if (selected.some((cost) => cost.status !== "priced" || cost.amount === null)) return null;
    const total = selected.reduce((sum, cost) => sum + (cost.amount ?? 0), 0);
    if (!Number.isFinite(total)) {
      issues.push(issue("invalid_number", `allowances/${category}`, "Allowance category total exceeds the finite numeric range."));
      return null;
    }
    return total;
  };
  const constructionSubtotal = subtotalValue();
  const contingency = contingencyValue();
  const componentCategoryTotal = (category: AllowanceDefinition["category"]): number | null => {
    const selected = components.filter((component) => component.category === category && component.status !== "excluded");
    if (selected.some((component) => component.status !== "priced" || component.extendedCost === null)) return null;
    const value = selected.reduce((sum, component) => sum + (component.extendedCost ?? 0), 0);
    if (!Number.isFinite(value)) {
      issues.push(issue("invalid_number", `components/${category}`, "Component category total exceeds the finite numeric range."));
      return null;
    }
    return value;
  };
  const serviceComponents = componentCategoryTotal("service");
  const serviceAllowances = sumAllowanceCategory("service");
  const serviceTotal = serviceComponents === null || serviceAllowances === null ? null : serviceComponents + serviceAllowances;
  const services = serviceTotal !== null && Number.isFinite(serviceTotal) ? serviceTotal : null;
  if (serviceTotal !== null && services === null) issues.push(issue("invalid_number", "services", "Service total exceeds the finite numeric range."));

  const externalMap = new Map((scenario.externalScopes ?? []).map((scope) => [scope.scopeId, scope]));
  let external: number | null = 0;
  for (const scopeId of ["right_of_way", "major_utilities"] as const) {
    const scope = externalMap.get(scopeId);
    if (!scope) {
      external = null;
      issues.push(issue("unassessed_scope", `externalScopes/${scopeId}`, "External scope must be explicitly assessed."));
    } else if (scope.decision === "unassessed") {
      external = null;
      issues.push(issue("unassessed_scope", `externalScopes/${scopeId}`, "External scope remains unassessed."));
    } else if (scope.decision === "none_assumed") {
      if (!nonblank(scope.reason)) {
        external = null;
        issues.push(issue("reason_required", `externalScopes/${scopeId}`, "None-assumed scope requires a reason."));
      }
    } else if (scope.decision === "manual" && finiteNonnegative(scope.amount) && nonblank(scope.reason)) {
      if (external !== null) {
        external += scope.amount;
        if (!Number.isFinite(external)) {
          external = null;
          issues.push(issue("invalid_number", `externalScopes/${scopeId}`, "External scope total exceeds the finite numeric range."));
        }
      }
    } else {
      external = null;
      issues.push(issue("invalid_number", `externalScopes/${scopeId}`, "Manual external scope requires a finite nonnegative amount and reason."));
    }
  }
  const externalAllowances = sumAllowanceCategory("external");
  const externalComponents = componentCategoryTotal("external");
  if (external !== null && externalAllowances !== null && externalComponents !== null) {
    external += externalAllowances + externalComponents;
    if (!Number.isFinite(external)) {
      external = null;
      issues.push(issue("invalid_number", "external", "External total exceeds the finite numeric range."));
    }
  } else external = null;

  const activeUnpricedComponents = components.filter((component) => component.status !== "excluded" && component.status !== "priced");
  const activeUnpricedAllowances = allowanceCosts.filter((allowance) => allowance.status !== "excluded" && allowance.status !== "priced");
  const missingComponentIds = [
    ...activeUnpricedComponents.map((component) => component.componentId),
    ...activeUnpricedAllowances.map((allowance) => allowance.allowanceId),
    ...(["right_of_way", "major_utilities"] as const).filter((scopeId) => externalMap.get(scopeId)?.decision === "unassessed" || !externalMap.has(scopeId)),
  ];
  const fullConstructionValue = constructionSubtotal === null || contingency === null ? null : constructionSubtotal + contingency;
  const fullConstruction = fullConstructionValue !== null && Number.isFinite(fullConstructionValue) ? fullConstructionValue : null;
  if (fullConstructionValue !== null && fullConstruction === null) issues.push(issue("invalid_number", "constructionWithContingency", "Construction plus contingency exceeds the finite numeric range."));
  const allKnown = fullConstruction !== null && services !== null && external !== null &&
    activeUnpricedComponents.length === 0 && activeUnpricedAllowances.length === 0 &&
    !issues.some((entry) => entry.severity === "error");
  let total = allKnown ? fullConstruction! + services! + external! : null;
  if (total !== null && !Number.isFinite(total)) {
    total = null;
    issues.push(issue("invalid_number", "total", "Full project total is not finite."));
  }
  const complete = total !== null && Number.isFinite(total);

  return {
    components,
    allowances: allowanceCosts,
    pricedDirectSubtotal,
    directConstruction,
    constructionSubtotal,
    contingency,
    services,
    external,
    total: complete ? total : null,
    complete,
    missingComponentIds: [...new Set(missingComponentIds)],
    issues,
  };
}
