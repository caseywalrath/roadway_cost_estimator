import { calculateScenarioCosts } from "./costEngine";
import type { AllowanceBase, PlanningIssue, PlanningResult, PlanningScenario, ScenarioComparison } from "./types";

function contentForComparison(scenario: PlanningScenario): Omit<PlanningScenario, "scenarioId" | "name" | "location" | "notes" | "review" | "history" | "projectLink" | "handoffIntent" | "createdAt" | "updatedAt"> {
  const { scenarioId: _scenarioId, name: _name, location: _location, notes: _notes, review: _review, history: _history, projectLink: _projectLink, handoffIntent: _handoffIntent, createdAt: _createdAt, updatedAt: _updatedAt, ...content } = scenario;
  const segmentIds = new Map(scenario.segments.map((item, index) => [item.segmentId, `segment#${index}`]));
  const instanceIds = new Map(scenario.packages.map((item, index) => [item.instanceId, `package#${index}`]));
  const customIds = new Map(scenario.customComponents.map((item, index) => [item.componentId, `custom#${index}`]));
  const allowanceIds = new Map(scenario.allowances.map((item, index) => [item.allowanceId, `allowance#${index}`]));
  const generatedIds = new Map<string, string>();
  scenario.packages.forEach((instance, index) => instance.definition.components.forEach((component) => {
    generatedIds.set(`${instance.instanceId}/${component.role}`, `package#${index}/${component.role}`);
  }));
  const componentReference = (id: string): string => customIds.get(id) ?? generatedIds.get(id) ?? id;
  const normalizedBase = (base: AllowanceBase): AllowanceBase => base.kind === "references" ? {
    ...base,
    componentIds: base.componentIds.map(componentReference),
    allowanceIds: base.allowanceIds.map((id) => allowanceIds.get(id) ?? id),
  } : base;
  return {
    ...content,
    segments: content.segments.map((segment) => ({ ...segment, segmentId: segmentIds.get(segment.segmentId) ?? segment.segmentId })),
    packages: content.packages.map((instance) => ({ ...instance, instanceId: instanceIds.get(instance.instanceId) ?? instance.instanceId, segmentId: segmentIds.get(instance.segmentId) ?? instance.segmentId })),
    customComponents: content.customComponents.map((component) => ({ ...component, componentId: customIds.get(component.componentId) ?? component.componentId, segmentId: segmentIds.get(component.segmentId) ?? component.segmentId })),
    allowances: content.allowances.map((allowance) => ({
      ...allowance,
      allowanceId: allowanceIds.get(allowance.allowanceId) ?? allowance.allowanceId,
      base: normalizedBase(allowance.base),
      ...(allowance.originalBasis ? { originalBasis: { ...allowance.originalBasis, base: normalizedBase(allowance.originalBasis.base) } } : {}),
    })),
    substitutions: content.substitutions.map((substitution) => ({
      ...substitution,
      replacementComponentId: componentReference(substitution.replacementComponentId),
      replacedComponentIds: substitution.replacedComponentIds.map(componentReference),
      replacedAllowanceIds: substitution.replacedAllowanceIds.map((id) => allowanceIds.get(id) ?? id),
    })),
  };
}

function diffValues(before: unknown, after: unknown, path: string, changes: ScenarioComparison["changes"]): void {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const count = Math.max(before.length, after.length);
    for (let index = 0; index < count; index += 1) {
      if (index >= before.length) changes.push({ path: `${path}[${index}]`, before: undefined, after: after[index] });
      else if (index >= after.length) changes.push({ path: `${path}[${index}]`, before: before[index], after: undefined });
      else diffValues(before[index], after[index], `${path}[${index}]`, changes);
    }
    return;
  }
  if ((before && typeof before === "object" && !Array.isArray(before)) || (after && typeof after === "object" && !Array.isArray(after))) {
    const a = before && typeof before === "object" && !Array.isArray(before) ? before as Record<string, unknown> : {};
    const b = after && typeof after === "object" && !Array.isArray(after) ? after as Record<string, unknown> : {};
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) {
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in a)) diffValues(undefined, b[key], childPath, changes);
      else if (!(key in b)) diffValues(a[key], undefined, childPath, changes);
      else diffValues(a[key], b[key], childPath, changes);
    }
    const beforeObject = Boolean(before && typeof before === "object" && !Array.isArray(before));
    const afterObject = Boolean(after && typeof after === "object" && !Array.isArray(after));
    if (before !== undefined && after !== undefined && beforeObject !== afterObject) changes.push({ path, before, after });
    return;
  }
  changes.push({ path, before, after });
}

function reviewStructuralIssues(issues: PlanningIssue[]): PlanningIssue[] {
  return issues.filter((issue) => issue.severity === "error");
}

/** Compare frozen scenario inputs without refreshing packages or rates. Difference is right minus left. */
export function comparePlanningScenarios(left: PlanningScenario, right: PlanningScenario): PlanningResult<ScenarioComparison> {
  if (left.state !== right.state) return { ok: false, issues: [{ code: "state_mismatch", path: "right.state", message: "Scenarios from different states cannot be compared.", severity: "error" }] };
  const leftCosts = calculateScenarioCosts(left);
  const rightCosts = calculateScenarioCosts(right);
  const issues = [...reviewStructuralIssues(leftCosts.issues), ...reviewStructuralIssues(rightCosts.issues)];
  const changes: ScenarioComparison["changes"] = [];
  diffValues(contentForComparison(left), contentForComparison(right), "", changes);
  const directDifference = leftCosts.pricedDirectSubtotal !== null && rightCosts.pricedDirectSubtotal !== null
    ? rightCosts.pricedDirectSubtotal - leftCosts.pricedDirectSubtotal
    : null;
  return {
    ok: true,
    value: {
      leftScenarioId: left.scenarioId,
      rightScenarioId: right.scenarioId,
      left: leftCosts,
      right: rightCosts,
      pricedDirectDifference: directDifference !== null && Number.isFinite(directDifference) ? directDifference : null,
      totalDifference: leftCosts.complete && rightCosts.complete && leftCosts.total !== null && rightCosts.total !== null ? rightCosts.total - leftCosts.total : null,
      comparableCompleteTotals: leftCosts.complete && rightCosts.complete,
      changes,
    },
    issues,
  };
}
