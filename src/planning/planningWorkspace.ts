import { validatePackageDefinition, validatePlanningScenario } from "./validateRecipes";
import { createDefaultAllowances } from "./costEngine";
import type {
  AllowanceDefinition,
  DuplicateScenarioIds,
  Exclusion,
  PackageDefinition,
  PackageInstance,
  PlanningIssue,
  PlanningResult,
  PlanningScenario,
  PlanningSegment,
  PlanningState,
  PlanningWorkspace,
  ScenarioEdit,
  ScenarioReview,
} from "./types";

const error = (code: string, path: string, message: string): PlanningIssue => ({ code, path, message, severity: "error" });
const success = <T>(value: T, issues: PlanningIssue[] = []): PlanningResult<T> => ({ ok: true, value, issues });
const failure = <T = never>(...issues: PlanningIssue[]): PlanningResult<T> => ({ ok: false, issues });
const clone = <T>(value: T): T => structuredClone(value);
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validIsoDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const validIsoDateTime = (value: string): boolean => {
  const match = /^(\d{4}-\d{2}-\d{2})T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
  return Boolean(match && validIsoDate(match[1]) && Number.isFinite(Date.parse(value)));
};
const supportedState = (state: unknown): state is PlanningState => state === "NE" || state === "CO";

function validateNamed(value: string, path: string): PlanningIssue[] {
  return nonblank(value) ? [] : [error("invalid_recipe", path, "A nonblank value is required.")];
}

function workspaceNext(workspace: PlanningWorkspace, now: string, patch: Partial<PlanningWorkspace>): PlanningWorkspace {
  return { ...workspace, ...patch, revision: workspace.revision + 1, updatedAt: now };
}

function scenarioHasUniqueIds(scenario: PlanningScenario): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const check = (values: string[], path: string) => {
    const seen = new Set<string>();
    values.forEach((id, index) => {
      if (!nonblank(id)) issues.push(error("invalid_recipe", `${path}[${index}]`, "ID must be nonblank."));
      else if (seen.has(id)) issues.push(error("duplicate_id", `${path}[${index}]`, `Duplicate ID '${id}'.`));
      seen.add(id);
    });
  };
  check(scenario.segments.map((x) => x.segmentId), "segments");
  check(scenario.packages.map((x) => x.instanceId), "packages");
  check(scenario.customComponents.map((x) => x.componentId), "customComponents");
  check(scenario.allowances.map((x) => x.allowanceId), "allowances");
  const segmentIds = new Set(scenario.segments.map((x) => x.segmentId));
  scenario.packages.forEach((instance, i) => {
    if (!segmentIds.has(instance.segmentId)) issues.push(error("missing_reference", `packages[${i}].segmentId`, "Package references a missing segment."));
  });
  scenario.customComponents.forEach((component, i) => {
    if (!segmentIds.has(component.segmentId)) issues.push(error("missing_reference", `customComponents[${i}].segmentId`, "Custom component references a missing segment."));
  });
  return issues;
}

function validateScenarioStructural(scenario: PlanningScenario): PlanningIssue[] {
  const issues = scenarioHasUniqueIds(scenario);
  if (!supportedState(scenario.state)) issues.push(error("state_mismatch", "state", "Scenario state is unsupported."));
  if (!nonblank(scenario.scenarioId)) issues.push(error("invalid_recipe", "scenarioId", "Scenario ID must be nonblank."));
  if (!nonblank(scenario.name)) issues.push(error("invalid_recipe", "name", "Scenario name must be nonblank."));
  if (!validIsoDateTime(scenario.createdAt)) issues.push(error("invalid_recipe", "createdAt", "Timestamp must be an ISO date-time."));
  if (!validIsoDateTime(scenario.updatedAt)) issues.push(error("invalid_recipe", "updatedAt", "Timestamp must be an ISO date-time."));
  scenario.packages.forEach((instance, i) => {
    if (instance.definition.state !== scenario.state) issues.push(error("state_mismatch", `packages[${i}].definition.state`, "Package state must match scenario state."));
    issues.push(...validatePackageDefinition(instance.definition).map((issue) => ({ ...issue, path: `packages[${i}].definition.${issue.path}` })));
  });
  return issues;
}

function isNumericDraftIssue(issue: PlanningIssue): boolean {
  if (!["invalid_number", "out_of_bounds", "integer_required", "missing_parameter"].includes(issue.code)) return false;
  return /(?:parameterOverrides|quantityOverrides|rateOverrides)/.test(issue.path)
    || issue.code !== "missing_parameter" && /scenario\.(?:customComponents\[\d+\]\.(?:quantity|unitRate)|allowances\[\d+\]\.percent|externalScopes\.(?:right_of_way|major_utilities))/.test(issue.path);
}

function clearReviewWhenChanged(previous: PlanningScenario, next: PlanningScenario): PlanningScenario {
  if (scenarioFingerprint(previous) === scenarioFingerprint(next)) return next;
  return { ...next, review: previous.review };
}

/** Create an empty workspace. IDs and time are supplied by the caller. */
export function createPlanningWorkspace(input: { workspaceId: string; state: PlanningState; name: string; now: string }): PlanningResult<PlanningWorkspace> {
  const issues = [
    ...validateNamed(input.workspaceId, "workspaceId"),
    ...validateNamed(input.name, "name"),
    ...(!supportedState(input.state) ? [error("state_mismatch", "state", "State must be NE or CO.")] : []),
    ...(!validIsoDateTime(input.now) ? [error("invalid_recipe", "now", "Timestamp must be an ISO date-time.")] : []),
  ];
  if (issues.length) return failure(...issues);
  return success({ schemaVersion: 1, workspaceId: input.workspaceId, state: input.state, name: input.name.trim(), revision: 0, activeScenarioId: null, scenarios: [], createdAt: input.now, updatedAt: input.now, lastBackupAt: null, lastBackupRevision: null });
}

/** Create an empty scenario with state-specific default allowances. */
export function createPlanningScenario(input: { scenarioId: string; state: PlanningState; name: string; now: string }): PlanningResult<PlanningScenario> {
  const issues = [
    ...validateNamed(input.scenarioId, "scenarioId"), ...validateNamed(input.name, "name"),
    ...(!supportedState(input.state) ? [error("state_mismatch", "state", "State must be NE or CO.")] : []),
    ...(!validIsoDateTime(input.now) ? [error("invalid_recipe", "now", "Timestamp must be an ISO date-time.")] : []),
  ];
  if (issues.length) return failure(...issues);
  const scenario: PlanningScenario = {
    scenarioId: input.scenarioId, state: input.state, name: input.name.trim(), location: "", notes: "", segments: [], packages: [], customComponents: [], substitutions: [],
    allowances: createDefaultAllowances(input.state).map(clone),
    externalScopes: [
      { scopeId: "right_of_way", decision: "unassessed", amount: null, reason: "" },
      { scopeId: "major_utilities", decision: "unassessed", amount: null, reason: "" },
    ],
    review: null, history: [], projectLink: null, handoffIntent: null, createdAt: input.now, updatedAt: input.now,
  };
  return success(scenario);
}

/** Create an independent, unedited package instance. */
export function createPackageInstance(input: { instanceId: string; segmentId: string; scopeId: string; definition: PackageDefinition }): PlanningResult<PackageInstance> {
  const issues = [
    ...validateNamed(input.instanceId, "instanceId"), ...validateNamed(input.segmentId, "segmentId"), ...validateNamed(input.scopeId, "scopeId"),
    ...validatePackageDefinition(input.definition),
  ];
  if (issues.length) return failure(...issues);
  return success({ instanceId: input.instanceId, segmentId: input.segmentId, scopeId: input.scopeId, definition: clone(input.definition), parameterOverrides: {}, quantityOverrides: {}, rateOverrides: {}, exclusions: {}, rateSnapshots: {} });
}

export function addPlanningScenario(workspace: PlanningWorkspace, scenario: PlanningScenario, now: string): PlanningResult<PlanningWorkspace> {
  const issues = validateScenarioStructural(scenario);
  const validationIssues = validatePlanningScenario(scenario);
  issues.push(...validationIssues.filter((issue) => !isNumericDraftIssue(issue)));
  if (scenario.state !== workspace.state) issues.push(error("state_mismatch", "scenario.state", "Scenario state must match workspace state."));
  if (workspace.scenarios.some((x) => x.scenarioId === scenario.scenarioId)) issues.push(error("duplicate_id", "scenario.scenarioId", "Scenario ID already exists in workspace."));
  if (!validIsoDateTime(now)) issues.push(error("invalid_recipe", "now", "Timestamp must be an ISO date-time."));
  if (issues.length) return failure(...issues);
  return success(workspaceNext(workspace, now, { scenarios: [...workspace.scenarios.map(clone), clone(scenario)] }), validationIssues.filter(isNumericDraftIssue));
}

export function setActivePlanningScenario(workspace: PlanningWorkspace, scenarioId: string | null, now: string): PlanningResult<PlanningWorkspace> {
  const issues: PlanningIssue[] = [];
  if (scenarioId !== null && !workspace.scenarios.some((x) => x.scenarioId === scenarioId)) issues.push(error("missing_reference", "activeScenarioId", "Active scenario must exist in this workspace."));
  if (!validIsoDateTime(now)) issues.push(error("invalid_recipe", "now", "Timestamp must be an ISO date-time."));
  if (issues.length) return failure(...issues);
  return success(workspaceNext(workspace, now, { activeScenarioId: scenarioId }));
}

function invalidNumericOverride(override: { value: number | null; reason: string }, path: string): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  if (!nonblank(override.reason)) issues.push(error("reason_required", `${path}.reason`, "Override reason is required."));
  if (override.value !== null && !Number.isFinite(override.value)) issues.push(error("invalid_number", `${path}.value`, "Override value must be finite or null."));
  return issues;
}

function findPackage(scenario: PlanningScenario, instanceId: string, path = "packages"): { instance: PackageInstance; index: number } | null {
  const index = scenario.packages.findIndex((x) => x.instanceId === instanceId);
  return index < 0 ? null : { instance: scenario.packages[index], index };
}

/** Apply one command atomically. Invalid numeric draft values are retained with validation issues. */
export function editPlanningScenario(scenario: PlanningScenario, edit: ScenarioEdit, now: string): PlanningResult<PlanningScenario> {
  if (!validIsoDateTime(now)) return failure(error("invalid_recipe", "now", "Timestamp must be an ISO date-time."));
  const next = clone(scenario);
  const issues: PlanningIssue[] = [];
  const packageAt = (instanceId: string, path: string) => {
    const found = findPackage(next, instanceId);
    if (!found) issues.push(error("missing_reference", path, "Package instance does not exist."));
    return found;
  };
  switch (edit.kind) {
    case "metadata":
      if (edit.name !== undefined) { if (!nonblank(edit.name)) issues.push(error("invalid_recipe", "name", "Scenario name must be nonblank.")); else next.name = edit.name.trim(); }
      if (edit.location !== undefined) next.location = edit.location;
      if (edit.notes !== undefined) next.notes = edit.notes;
      break;
    case "set_segments": {
      const ids = edit.segments.map((x) => x.segmentId);
      if (new Set(ids).size !== ids.length) issues.push(error("duplicate_id", "segments", "Segment IDs must be unique."));
      edit.segments.forEach((segment, i) => { if (!nonblank(segment.segmentId) || !nonblank(segment.name)) issues.push(error("invalid_recipe", `segments[${i}]`, "Segment ID and name must be nonblank.")); });
      const allowed = new Set(ids);
      next.packages.forEach((x, i) => { if (!allowed.has(x.segmentId)) issues.push(error("missing_reference", `packages[${i}].segmentId`, "Removing this segment would leave a package reference dangling.")); });
      next.customComponents.forEach((x, i) => { if (!allowed.has(x.segmentId)) issues.push(error("missing_reference", `customComponents[${i}].segmentId`, "Removing this segment would leave a custom component reference dangling.")); });
      if (!issues.length) next.segments = clone(edit.segments);
      break;
    }
    case "parameter": case "quantity": case "rate": case "exclusion": {
      const found = packageAt(edit.instanceId, "instanceId");
      if (!found) break;
      const roles = new Set(found.instance.definition.components.map((c) => c.role));
      if (edit.kind === "parameter") {
        const keys = new Set(found.instance.definition.parameters.map((p) => p.key));
        if (!keys.has(edit.key)) { issues.push(error("unknown_parameter", `packages[${found.index}].parameterOverrides.${edit.key}`, "Parameter is not defined by this package.")); break; }
        if (edit.override === null) delete found.instance.parameterOverrides[edit.key];
        else { issues.push(...invalidNumericOverride(edit.override, `packages[${found.index}].parameterOverrides.${edit.key}`)); if (!issues.some((x) => x.code === "reason_required")) found.instance.parameterOverrides[edit.key] = clone(edit.override); }
      } else {
        if (!roles.has(edit.role)) { issues.push(error("invalid_recipe", `packages[${found.index}].${edit.kind}Overrides.${edit.role}`, "Component role is not defined by this package.")); break; }
        if (edit.kind === "quantity") {
          if (edit.override === null) delete found.instance.quantityOverrides[edit.role];
          else { issues.push(...invalidNumericOverride(edit.override, `packages[${found.index}].quantityOverrides.${edit.role}`)); if (!issues.some((x) => x.code === "reason_required")) found.instance.quantityOverrides[edit.role] = clone(edit.override); }
        } else if (edit.kind === "rate") {
          if (edit.override === null) delete found.instance.rateOverrides[edit.role];
          else { issues.push(...invalidNumericOverride(edit.override, `packages[${found.index}].rateOverrides.${edit.role}`)); if (!issues.some((x) => x.code === "reason_required")) found.instance.rateOverrides[edit.role] = clone(edit.override); }
        } else if (edit.exclusion === null) delete found.instance.exclusions[edit.role];
        else if (!nonblank(edit.exclusion.reason) || !nonblank(edit.exclusion.sectionEffect)) issues.push(error("reason_required", `packages[${found.index}].exclusions.${edit.role}`, "Exclusion reason and section effect are required."));
        else found.instance.exclusions[edit.role] = clone(edit.exclusion);
      }
      break;
    }
    case "add_package": {
      if (edit.instance.definition.state !== scenario.state) issues.push(error("state_mismatch", "instance.definition.state", "Package state must match scenario state."));
      if (next.packages.some((x) => x.instanceId === edit.instance.instanceId)) issues.push(error("duplicate_id", "instance.instanceId", "Package instance ID already exists."));
      if (!next.segments.some((x) => x.segmentId === edit.instance.segmentId)) issues.push(error("missing_reference", "instance.segmentId", "Package segment does not exist."));
      if (!nonblank(edit.instance.scopeId)) issues.push(error("invalid_recipe", "instance.scopeId", "Package scope ID must be nonblank."));
      issues.push(...validatePackageDefinition(edit.instance.definition));
      if (!issues.length) next.packages.push(clone(edit.instance));
      break;
    }
    case "remove_package": {
      if (!nonblank(edit.reason)) issues.push(error("reason_required", "reason", "Removal reason is required."));
      const found = packageAt(edit.instanceId, "instanceId");
      if (found && !issues.length) { next.history.push(`Removed package ${edit.instanceId}: ${edit.reason.trim()}`); next.packages.splice(found.index, 1); }
      break;
    }
    case "set_custom": {
      const component = edit.component;
      if (!nonblank(component.componentId) || !nonblank(component.role) || !nonblank(component.scopeId)) issues.push(error("invalid_recipe", "component", "Custom component ID, role and scope must be nonblank."));
      if (component.segmentId && !next.segments.some((x) => x.segmentId === component.segmentId)) issues.push(error("missing_reference", "component.segmentId", "Custom component segment does not exist."));
      const at = next.customComponents.findIndex((x) => x.componentId === component.componentId);
      if (at < 0) next.customComponents.push(clone(component)); else next.customComponents[at] = clone(component);
      if (!nonblank(component.reason)) issues.push(error("reason_required", "component.reason", "Custom component reason is required."));
      break;
    }
    case "remove_custom": {
      if (!nonblank(edit.reason)) issues.push(error("reason_required", "reason", "Removal reason is required."));
      const at = next.customComponents.findIndex((x) => x.componentId === edit.componentId);
      if (at < 0) issues.push(error("missing_reference", "componentId", "Custom component does not exist."));
      else if (!issues.length) { next.history.push(`Removed custom component ${edit.componentId}: ${edit.reason.trim()}`); next.customComponents.splice(at, 1); }
      break;
    }
    case "allowance": {
      const a = edit.allowance;
      if (!nonblank(a.allowanceId) || !nonblank(a.name)) issues.push(error("invalid_recipe", "allowance", "Allowance ID and name must be nonblank."));
      if (a.overrideReason !== null && !nonblank(a.overrideReason)) issues.push(error("reason_required", "allowance.overrideReason", "Allowance override reason must be nonblank."));
      const at = next.allowances.findIndex((x) => x.allowanceId === a.allowanceId);
      const previous = at < 0 ? null : next.allowances[at];
      const originalBasis = previous
        ? previous.originalBasis ?? { percent: previous.percent, base: clone(previous.base), enabled: previous.enabled }
        : { percent: a.percent, base: clone(a.base), enabled: a.enabled };
      const basisChanged = previous !== null && canonical([previous.percent, previous.base, previous.enabled]) !== canonical([a.percent, a.base, a.enabled]);
      if (basisChanged && !nonblank(a.overrideReason)) issues.push(error("reason_required", "allowance.overrideReason", "Changing allowance percent, base or enabled state requires a reason."));
      if (!issues.length) {
        const updated = { ...clone(a), originalBasis: clone(originalBasis) };
        if (at < 0) next.allowances.push(updated); else next.allowances[at] = updated;
      }
      break;
    }
    case "external_scope": {
      const at = next.externalScopes.findIndex((x) => x.scopeId === edit.scope.scopeId);
      if (at < 0) issues.push(error("missing_reference", "scope.scopeId", "External scope must be one of the built-in scope IDs."));
      else if ((edit.scope.decision === "none_assumed" || edit.scope.decision === "manual") && !nonblank(edit.scope.reason)) issues.push(error("reason_required", "scope.reason", "External scope decision requires a reason."));
      else next.externalScopes[at] = clone(edit.scope);
      break;
    }
    case "substitutions": {
      const componentIds = new Set([
        ...next.packages.flatMap((instance) => instance.definition.components.map((component) => `${instance.instanceId}/${component.role}`)),
        ...next.customComponents.map((component) => component.componentId),
      ]);
      const allowanceIds = new Set(next.allowances.map((allowance) => allowance.allowanceId));
      for (const [i, s] of edit.substitutions.entries()) {
        if (!componentIds.has(s.replacementComponentId)) issues.push(error("missing_reference", `substitutions[${i}].replacementComponentId`, "Replacement component does not exist."));
        if (!nonblank(s.reason)) issues.push(error("reason_required", `substitutions[${i}].reason`, "Substitution reason is required."));
        for (const ref of s.replacedComponentIds) if (!componentIds.has(ref)) issues.push(error("missing_reference", `substitutions[${i}].replacedComponentIds`, `Component '${ref}' does not exist.`));
        for (const ref of s.replacedAllowanceIds) if (!allowanceIds.has(ref)) issues.push(error("missing_reference", `substitutions[${i}].replacedAllowanceIds`, `Allowance '${ref}' does not exist.`));
      }
      if (!issues.length) next.substitutions = clone(edit.substitutions);
      break;
    }
    case "reprice": {
      const found = packageAt(edit.instanceId, "instanceId");
      if (!found) break;
      if (!found.instance.definition.components.some((c) => c.role === edit.role)) { issues.push(error("invalid_recipe", "role", "Component role is not defined by this package.")); break; }
      if (edit.snapshot.state !== scenario.state || edit.snapshot.agencyItemId !== found.instance.definition.components.find((c) => c.role === edit.role)?.binding?.agencyItemId || edit.snapshot.unit !== found.instance.definition.components.find((c) => c.role === edit.role)?.binding?.unit) {
        issues.push(error("invalid_snapshot", "snapshot", "Snapshot state, item and unit must match the component binding.")); break;
      }
      found.instance.rateSnapshots[edit.role] = clone(edit.snapshot);
      break;
    }
    case "update_package": {
      const found = packageAt(edit.instanceId, "instanceId");
      if (!found) break;
      if (!nonblank(edit.reason)) issues.push(error("reason_required", "reason", "Package update reason is required."));
      if (edit.definition.state !== scenario.state) issues.push(error("state_mismatch", "definition.state", "Package state must match scenario state."));
      issues.push(...validatePackageDefinition(edit.definition));
      const roles = new Set(edit.definition.components.map((c) => c.role));
      for (const role of [...Object.keys(found.instance.quantityOverrides), ...Object.keys(found.instance.rateOverrides), ...Object.keys(found.instance.exclusions), ...Object.keys(found.instance.rateSnapshots)]) if (!roles.has(role)) issues.push(error("missing_reference", `definition.components.${role}`, "Update would orphan a retained component override or snapshot."));
      const keys = new Set(edit.definition.parameters.map((p) => p.key));
      for (const key of Object.keys(found.instance.parameterOverrides)) if (!keys.has(key)) issues.push(error("missing_reference", `definition.parameters.${key}`, "Update would orphan a retained parameter override."));
      if (!issues.length) {
        found.instance.definition = clone(edit.definition);
        next.history.push(`Updated package ${edit.instanceId} to ${edit.definition.packageId}@${edit.definition.version}: ${edit.reason.trim()}`);
      }
      break;
    }
  }
  if (issues.some((x) => x.severity === "error" && x.code !== "invalid_number" && x.code !== "out_of_bounds" && x.code !== "integer_required" && x.code !== "missing_parameter")) return failure(...issues);
  next.updatedAt = now;
  const withReview = clearReviewWhenChanged(scenario, next);
  const validationIssues = validatePlanningScenario(withReview);
  const structuralValidationIssues = validationIssues.filter((issue) => !isNumericDraftIssue(issue));
  if (structuralValidationIssues.some((issue) => issue.severity === "error")) return failure(...issues, ...structuralValidationIssues);
  return success(withReview, [...issues, ...validationIssues]);
}

export function replacePlanningScenario(workspace: PlanningWorkspace, scenario: PlanningScenario, now: string): PlanningResult<PlanningWorkspace> {
  const index = workspace.scenarios.findIndex((x) => x.scenarioId === scenario.scenarioId);
  const issues = validateScenarioStructural(scenario);
  const validationIssues = validatePlanningScenario(scenario);
  issues.push(...validationIssues.filter((issue) => !isNumericDraftIssue(issue)));
  if (index < 0) issues.push(error("missing_reference", "scenario.scenarioId", "Scenario to replace does not exist."));
  if (scenario.state !== workspace.state) issues.push(error("state_mismatch", "scenario.state", "Scenario state must match workspace state."));
  if (!validIsoDateTime(now)) issues.push(error("invalid_recipe", "now", "Timestamp must be an ISO date-time."));
  if (issues.length) return failure(...issues);
  const scenarios = workspace.scenarios.map(clone);
  scenarios[index] = { ...clone(scenario), updatedAt: now };
  return success(workspaceNext(workspace, now, { scenarios }), validationIssues.filter(isNumericDraftIssue));
}

export function duplicatePlanningScenario(scenario: PlanningScenario, ids: DuplicateScenarioIds, name: string, now: string): PlanningResult<PlanningScenario> {
  const issues: PlanningIssue[] = [...validateNamed(ids.scenarioId, "ids.scenarioId"), ...validateNamed(name, "name")];
  if (!validIsoDateTime(now)) issues.push(error("invalid_recipe", "now", "Timestamp must be an ISO date-time."));
  const namespaces: Array<[string, string[], Record<string, string>]> = [
    ["segments", scenario.segments.map((x) => x.segmentId), ids.segmentIds],
    ["instances", scenario.packages.map((x) => x.instanceId), ids.instanceIds],
    ["customComponents", scenario.customComponents.map((x) => x.componentId), ids.customComponentIds],
    ["allowances", scenario.allowances.map((x) => x.allowanceId), ids.allowanceIds],
  ];
  const allTargets = [ids.scenarioId];
  for (const [namespace, originalIds, map] of namespaces) {
    for (const original of originalIds) {
      const target = map[original];
      if (!nonblank(target)) issues.push(error("missing_reference", `ids.${namespace}.${original}`, "Every existing ID requires a fresh target ID."));
      else { if (target === original) issues.push(error("duplicate_id", `ids.${namespace}.${original}`, "Duplicate IDs must differ from original IDs.")); allTargets.push(target); }
    }
    for (const key of Object.keys(map)) if (!originalIds.includes(key)) issues.push(error("missing_reference", `ids.${namespace}.${key}`, "ID map contains an unknown source ID."));
  }
  if (new Set(allTargets).size !== allTargets.length) issues.push(error("duplicate_id", "ids", "Every target ID must be unique across the duplicated scenario."));
  const allOriginal = new Set([scenario.scenarioId, ...scenario.segments.map((x) => x.segmentId), ...scenario.packages.map((x) => x.instanceId), ...scenario.customComponents.map((x) => x.componentId), ...scenario.allowances.map((x) => x.allowanceId)]);
  for (const target of allTargets) if (allOriginal.has(target)) issues.push(error("duplicate_id", "ids", "Target IDs may not collide with IDs in the source scenario."));
  if (issues.length) return failure(...issues);
  const generatedComponentIds = new Map<string, string>();
  for (const instance of scenario.packages) {
    for (const component of instance.definition.components) {
      generatedComponentIds.set(`${instance.instanceId}/${component.role}`, `${ids.instanceIds[instance.instanceId]}/${component.role}`);
    }
  }
  const remapComponentReference = (id: string): string => ids.customComponentIds[id] ?? generatedComponentIds.get(id) ?? id;
  const remapBase = (base: AllowanceDefinition["base"]): AllowanceDefinition["base"] => base.kind === "references" ? {
    ...base,
    componentIds: base.componentIds.map(remapComponentReference),
    allowanceIds: base.allowanceIds.map((id) => ids.allowanceIds[id] ?? id),
  } : clone(base);
  const copy = clone(scenario);
  copy.segments = copy.segments.map((segment) => ({ ...segment, segmentId: ids.segmentIds[segment.segmentId] }));
  copy.packages = copy.packages.map((instance) => ({
    ...instance,
    instanceId: ids.instanceIds[instance.instanceId],
    segmentId: ids.segmentIds[instance.segmentId],
  }));
  copy.customComponents = copy.customComponents.map((component) => ({
    ...component,
    componentId: ids.customComponentIds[component.componentId],
    segmentId: ids.segmentIds[component.segmentId],
  }));
  copy.allowances = copy.allowances.map((allowance) => ({
    ...allowance,
    allowanceId: ids.allowanceIds[allowance.allowanceId],
    base: remapBase(allowance.base),
    ...(allowance.originalBasis ? { originalBasis: { ...allowance.originalBasis, base: remapBase(allowance.originalBasis.base) } } : {}),
  }));
  copy.substitutions = copy.substitutions.map((substitution) => ({
    ...substitution,
    replacementComponentId: remapComponentReference(substitution.replacementComponentId),
    replacedComponentIds: substitution.replacedComponentIds.map(remapComponentReference),
    replacedAllowanceIds: substitution.replacedAllowanceIds.map((id) => ids.allowanceIds[id] ?? id),
  }));
  copy.scenarioId = ids.scenarioId;
  copy.name = name.trim();
  copy.createdAt = now;
  copy.updatedAt = now;
  copy.review = null;
  copy.projectLink = null;
  copy.handoffIntent = null;
  const historical: string[] = [];
  if (scenario.review) historical.push(`Copied from reviewed scenario ${scenario.scenarioId}; reviewer ${scenario.review.reviewer}, date ${scenario.review.date}; notes: ${scenario.review.notes}`);
  if (scenario.projectLink) historical.push(`Copied from scenario ${scenario.scenarioId}, linked to Project ${scenario.projectLink.projectId} at revision ${scenario.projectLink.revision}; link was cleared on this copy.`);
  if (scenario.handoffIntent) historical.push(`Copied from scenario ${scenario.scenarioId} with a ${scenario.handoffIntent.status} transfer intent for Project ${scenario.handoffIntent.targetProjectId}; intent was cleared on this copy.`);
  copy.history = [...scenario.history, ...historical];
  const validationIssues = validatePlanningScenario(copy).filter((issue) => !isNumericDraftIssue(issue));
  if (validationIssues.some((issue) => issue.severity === "error")) return failure(...validationIssues);
  return success(copy);
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`).join(",")}}`;
  }
  if (typeof value === "number") return Number.isFinite(value) ? `number:${JSON.stringify(value)}` : `number:${String(value)}`;
  if (typeof value === "string") return `string:${JSON.stringify(value)}`;
  if (typeof value === "boolean") return `boolean:${value}`;
  if (value === null) return "null";
  return `undefined:${String(value)}`;
}

/** Stable local change detector. Scenario name/location/notes and review/transfer metadata are excluded. */
export function scenarioFingerprint(scenario: PlanningScenario): string {
  const { scenarioId: _scenarioId, name: _name, location: _location, notes: _notes, review: _review, history: _history, projectLink: _projectLink, handoffIntent: _handoffIntent, createdAt: _createdAt, updatedAt: _updatedAt, ...content } = scenario;
  return canonical(content);
}

export function recordScenarioReview(scenario: PlanningScenario, input: { reviewer: string; date: string; notes: string }, now: string): PlanningResult<PlanningScenario> {
  const issues: PlanningIssue[] = [];
  if (!nonblank(input.reviewer)) issues.push(error("reason_required", "reviewer", "Reviewer is required."));
  if (!validIsoDate(input.date)) issues.push(error("invalid_recipe", "date", "Review date must be a valid ISO calendar date."));
  if (!validIsoDateTime(now)) issues.push(error("invalid_recipe", "now", "Timestamp must be an ISO date-time."));
  if (!issues.length && !scenarioFingerprint(scenario)) issues.push(error("invalid_recipe", "scenario", "Scenario fingerprint could not be computed."));
  if (issues.length) return failure(...issues);
  const review: ScenarioReview = { reviewer: input.reviewer.trim(), date: input.date, notes: input.notes, fingerprint: scenarioFingerprint(scenario) };
  return success({ ...clone(scenario), review, updatedAt: now });
}

export function getScenarioReviewStatus(scenario: PlanningScenario): "pending" | "current" | "stale" {
  if (!scenario.review) return "pending";
  return scenario.review.fingerprint === scenarioFingerprint(scenario) ? "current" : "stale";
}
