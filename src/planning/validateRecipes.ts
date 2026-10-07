import { normalizePlanningUnit } from "./units";
import type {
  AllowanceDefinition,
  ComponentDefinition,
  PackageDefinition,
  PlanningIssue,
  PlanningScenario,
  QuantityRule,
} from "./types";

const issue = (code: string, path: string, message: string, severity: PlanningIssue["severity"] = "error"): PlanningIssue => ({ code, path, message, severity });
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const validUnit = (value: unknown): boolean => typeof value === "string" && normalizePlanningUnit(value) !== null;

function ruleRefs(rule: QuantityRule): string[] {
  switch (rule.kind) {
    case "area": return [rule.length, rule.width, ...(rule.sides ? [rule.sides] : [])];
    case "volume": return [rule.length, rule.width, rule.depth, ...(rule.sides ? [rule.sides] : [])];
    case "asphalt_tons": return [rule.length, rule.width, rule.thickness, rule.density, rule.materialFactor];
    case "surface_application": return [rule.length, rule.width, rule.applicationRate];
    case "linear": return [rule.length, ...(rule.sides ? [rule.sides] : [])];
    case "count": return [rule.count];
    case "manual": return [rule.parameter];
    case "fixed": return [];
  }
}

function expectedUnit(rule: QuantityRule): string {
  switch (rule.kind) {
    case "area": return rule.unit;
    case "volume": return rule.unit;
    case "asphalt_tons": return "TON";
    case "surface_application": return "GAL";
    case "linear": return "LF";
    case "count": return "EACH";
    case "fixed": return rule.unit;
    case "manual": return rule.unit;
  }
}

function packageIssues(definition: PackageDefinition): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const base = `package:${String(definition.packageId ?? "")}`;
  if (!nonblank(definition.packageId) || !nonblank(definition.version) || !nonblank(definition.name)) issues.push(issue("invalid_recipe", base, "Package ID, version, and name must be nonblank."));
  if (definition.status !== "provisional") issues.push(issue("invalid_recipe", `${base}.status`, "Pilot package status must be provisional."));
  if (definition.state !== "NE" && definition.state !== "CO") issues.push(issue("state_mismatch", `${base}.state`, "Planning package state must be NE or CO."));
  if (!["resurfacing", "reconstruction", "path", "sidewalk"].includes(definition.kind)) issues.push(issue("invalid_recipe", `${base}.kind`, "Package kind is not supported."));

  const parameters = new Map<string, PackageDefinition["parameters"][number]>();
  for (const [index, parameter] of (definition.parameters ?? []).entries()) {
    const path = `${base}.parameters[${index}]`;
    if (!nonblank(parameter.key) || !nonblank(parameter.label) || !nonblank(parameter.unit)) issues.push(issue("invalid_recipe", path, "Parameter key, label, and unit must be nonblank."));
    if (parameters.has(parameter.key)) issues.push(issue("duplicate_id", `${path}.key`, `Duplicate parameter key ${parameter.key}.`));
    parameters.set(parameter.key, parameter);
    if (!finite(parameter.min) || (parameter.max !== undefined && !finite(parameter.max)) || (parameter.max !== undefined && parameter.max < parameter.min)) issues.push(issue("invalid_recipe", `${path}.bounds`, "Parameter bounds must be finite and ordered."));
    if (parameter.defaultValue === null) {
      if (!parameter.optional) issues.push(issue("missing_parameter", `${path}.defaultValue`, "A required parameter must have a numeric default."));
    } else if (!finite(parameter.defaultValue)) {
      issues.push(issue("invalid_number", `${path}.defaultValue`, "Parameter default must be finite or null when optional."));
    } else {
      if (parameter.defaultValue < parameter.min || (parameter.exclusiveMin && parameter.defaultValue === parameter.min) || (parameter.max !== undefined && parameter.defaultValue > parameter.max)) issues.push(issue("out_of_bounds", `${path}.defaultValue`, "Parameter default is outside its declared bounds."));
      if (parameter.integer && !Number.isInteger(parameter.defaultValue)) issues.push(issue("integer_required", `${path}.defaultValue`, "Parameter default must be an integer."));
    }
    if (parameter.optional && parameter.defaultValue === null && parameter.min > 0) issues.push(issue("invalid_recipe", `${path}.min`, "An optional null parameter cannot require a positive minimum."));
    if (typeof parameter.optional !== "boolean" || typeof parameter.integer !== "undefined" && typeof parameter.integer !== "boolean" || typeof parameter.exclusiveMin !== "undefined" && typeof parameter.exclusiveMin !== "boolean") issues.push(issue("invalid_recipe", path, "Parameter flags must be booleans."));
    if (!parameter.assumption || !nonblank(parameter.assumption.id) || !nonblank(parameter.assumption.description)) issues.push(issue("invalid_recipe", `${path}.assumption`, "Every parameter needs a named assumption."));
  }

  const roles = new Set<string>();
  for (const [index, component] of (definition.components ?? []).entries()) {
    const path = `${base}.components[${index}]`;
    if (!nonblank(component.role) || !nonblank(component.description)) issues.push(issue("invalid_recipe", path, "Component role and description must be nonblank."));
    if (roles.has(component.role)) issues.push(issue("duplicate_id", `${path}.role`, `Duplicate component role ${component.role}.`));
    roles.add(component.role);
    if (!["construction", "service", "external"].includes(component.category)) issues.push(issue("invalid_recipe", `${path}.category`, "Component category is unsupported."));
    if (typeof component.required !== "boolean") issues.push(issue("invalid_recipe", `${path}.required`, "Component required flag must be boolean."));
    if (!Array.isArray(component.tags) || component.tags.some((tag) => !nonblank(tag))) issues.push(issue("invalid_recipe", `${path}.tags`, "Component tags must be nonblank strings."));
    if (!component.assumptions?.length || component.assumptions.some((assumption) => !nonblank(assumption.id) || !nonblank(assumption.description))) issues.push(issue("invalid_recipe", `${path}.assumptions`, "Every component needs a named scope assumption."));
    const rule = component.quantityRule;
    if (!rule || !validUnit(rule.unit)) {
      issues.push(issue("invalid_recipe", `${path}.quantityRule`, "Quantity rule and unit must be valid."));
      continue;
    }
    if ((rule.kind === "area" && !["SF", "SY"].includes(rule.unit)) || (rule.kind === "volume" && rule.unit !== "CY") || (rule.kind === "asphalt_tons" && rule.unit !== "TON") || (rule.kind === "surface_application" && rule.unit !== "GAL") || (rule.kind === "linear" && rule.unit !== "LF") || (rule.kind === "count" && rule.unit !== "EACH")) issues.push(issue("unit_mismatch", `${path}.quantityRule.unit`, `The ${rule.kind} rule has incompatible output unit ${rule.unit}.`));
    if (rule.kind === "fixed" && (!finite(rule.value) || rule.value < 0)) issues.push(issue("invalid_number", `${path}.quantityRule.value`, "Fixed quantity must be finite and nonnegative."));
    const refs = ruleRefs(rule);
    for (const ref of refs) if (!parameters.has(ref)) issues.push(issue("missing_reference", `${path}.quantityRule`, `Quantity rule references unknown parameter ${ref}.`));
    const requiredParameterUnits: Record<string, string> = {};
    const integerParameters = new Set<string>();
    if (rule.kind === "area" || rule.kind === "volume" || rule.kind === "asphalt_tons" || rule.kind === "surface_application" || rule.kind === "linear") {
      requiredParameterUnits[rule.length] = "miles";
      if ("width" in rule) requiredParameterUnits[rule.width] = "ft";
      if ("sides" in rule && rule.sides) { requiredParameterUnits[rule.sides] = "count"; integerParameters.add(rule.sides); }
      if (rule.kind === "volume") requiredParameterUnits[rule.depth] = "in";
      if (rule.kind === "asphalt_tons") {
        requiredParameterUnits[rule.thickness] = "in";
        requiredParameterUnits[rule.density] = "lb/ft³";
        requiredParameterUnits[rule.materialFactor] = "factor";
      }
      if (rule.kind === "surface_application") requiredParameterUnits[rule.applicationRate] = "GAL/SY";
    } else if (rule.kind === "count") { requiredParameterUnits[rule.count] = "count"; integerParameters.add(rule.count); }
    else if (rule.kind === "manual") requiredParameterUnits[rule.parameter] = rule.unit;
    for (const [key, expected] of Object.entries(requiredParameterUnits)) {
      const actual = parameters.get(key)?.unit;
      if (actual !== undefined && actual !== expected) issues.push(issue("unit_mismatch", `${path}.quantityRule.${key}`, `Parameter ${key} must use ${expected}, not ${actual}.`));
      if (integerParameters.has(key) && parameters.has(key) && !parameters.get(key)?.integer) issues.push(issue("integer_required", `${path}.quantityRule.${key}`, `Parameter ${key} must be declared integer.`));
    }
    if (component.binding) {
      const binding = component.binding;
      const expectedAgency = definition.state === "NE" ? "ne_ndot" : "co_cdot";
      const expectedPrefix = `${expectedAgency}_`;
      if (binding.state !== definition.state || binding.agencyId !== expectedAgency || !binding.agencyItemId.startsWith(expectedPrefix) || binding.agencyItemId.length === expectedPrefix.length) issues.push(issue("state_mismatch", `${path}.binding`, "Binding state, agency, and item identity must match the package state."));
      if (!nonblank(binding.description) || !nonblank(binding.scopeNote) || binding.provisional !== true) issues.push(issue("invalid_recipe", `${path}.binding`, "Bindings need a description, explicit scope note, and provisional marker."));
      if (normalizePlanningUnit(binding.unit) !== normalizePlanningUnit(expectedUnit(rule))) issues.push(issue("unit_mismatch", `${path}.binding.unit`, "Binding unit must match the quantity rule output unit."));
      if (binding.fixedThickness) {
        const fixed = binding.fixedThickness;
        if (!parameters.has(fixed.parameter)) issues.push(issue("missing_reference", `${path}.binding.fixedThickness`, `Fixed thickness references unknown parameter ${fixed.parameter}.`));
        else if (parameters.get(fixed.parameter)?.unit !== "in") issues.push(issue("unit_mismatch", `${path}.binding.fixedThickness.parameter`, "Fixed-thickness parameter must use inches."));
        if (!finite(fixed.inches) || fixed.inches <= 0) issues.push(issue("invalid_number", `${path}.binding.fixedThickness.inches`, "Fixed binding thickness must be finite and positive."));
        else if (parameters.get(fixed.parameter)?.defaultValue !== fixed.inches) issues.push(issue("binding_thickness_mismatch", `${path}.binding.fixedThickness`, "Recipe default thickness must match the fixed item thickness."));
      }
    }
  }
  for (const [index, assumption] of (definition.assumptions ?? []).entries()) if (!nonblank(assumption.id) || !nonblank(assumption.description)) issues.push(issue("invalid_recipe", `${base}.assumptions[${index}]`, "Package assumptions need a nonblank ID and description."));
  if (!Array.isArray(definition.exclusions) || definition.exclusions.some((entry) => !nonblank(entry))) issues.push(issue("invalid_recipe", `${base}.exclusions`, "Package exclusions must be nonblank statements."));
  return issues;
}

export function validatePackageDefinition(definition: PackageDefinition): PlanningIssue[] {
  return packageIssues(definition);
}

function generatedId(instanceId: string, role: string): string { return `${instanceId}/${role}`; }
function canonicalRole(role: string): string { return ["asphalt", "pavement", "sidewalk"].includes(role) ? "surface" : role; }
function addUnique(id: string, path: string, ids: Map<string, string>, issues: PlanningIssue[]): void {
  if (ids.has(id)) issues.push(issue("duplicate_id", path, `ID ${id} duplicates ${ids.get(id)}.`));
  else ids.set(id, path);
}
function componentDefinitions(scenario: PlanningScenario): { id: string; instanceId: string | null; segmentId: string; scopeId: string; role: string; category: string; required: boolean; tags: string[]; definition: ComponentDefinition | null; excluded: boolean }[] {
  const out: ReturnType<typeof componentDefinitions> = [];
  for (const instance of scenario.packages ?? []) for (const definition of instance.definition.components ?? []) out.push({
    id: generatedId(instance.instanceId, definition.role), instanceId: instance.instanceId, segmentId: instance.segmentId, scopeId: instance.scopeId,
    role: definition.role, category: definition.category, required: definition.required, tags: definition.tags ?? [], definition,
    excluded: Object.prototype.hasOwnProperty.call(instance.exclusions ?? {}, definition.role),
  });
  for (const custom of scenario.customComponents ?? []) out.push({
    id: custom.componentId, instanceId: null, segmentId: custom.segmentId, scopeId: custom.scopeId, role: custom.role,
    category: custom.category, required: custom.required, tags: custom.tags ?? [], definition: null, excluded: custom.exclusion !== null,
  });
  return out;
}

function validOverride(value: { value: number | null; reason: string }, path: string, issues: PlanningIssue[], limits?: { min: number; max?: number; exclusiveMin?: boolean; integer?: boolean }): void {
  if (!nonblank(value.reason)) issues.push(issue("reason_required", `${path}.reason`, "An override requires a nonblank reason."));
  if (value.value === null || !finite(value.value)) { issues.push(issue("invalid_number", `${path}.value`, "Override value must be a finite number; null is retained as an invalid draft.")); return; }
  if (value.value < 0 || (limits && (value.value < limits.min || (limits.exclusiveMin && value.value === limits.min) || (limits.max !== undefined && value.value > limits.max)))) issues.push(issue("out_of_bounds", `${path}.value`, "Override value is outside the permitted bounds."));
  if (limits?.integer && !Number.isInteger(value.value)) issues.push(issue("integer_required", `${path}.value`, "Override value must be an integer."));
}

export function validatePlanningScenario(scenario: PlanningScenario): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  if (scenario.state !== "NE" && scenario.state !== "CO") issues.push(issue("state_mismatch", "scenario.state", "Planning scenario state must be NE or CO."));
  if (!nonblank(scenario.scenarioId) || !nonblank(scenario.name)) issues.push(issue("invalid_recipe", "scenario", "Scenario ID and name must be nonblank."));
  const segments = new Map<string, string>();
  for (const [index, segment] of (scenario.segments ?? []).entries()) {
    if (!nonblank(segment.segmentId) || !nonblank(segment.name)) issues.push(issue("invalid_recipe", `scenario.segments[${index}]`, "Segment ID and name must be nonblank."));
    addUnique(segment.segmentId, `scenario.segments[${index}].segmentId`, segments, issues);
  }
  const instances = new Map<string, string>();
  const componentIds = new Map<string, string>();
  const allowanceIds = new Map<string, string>();
  for (const [index, instance] of (scenario.packages ?? []).entries()) {
    const path = `scenario.packages[${index}]`;
    addUnique(instance.instanceId, `${path}.instanceId`, instances, issues);
    if (!segments.has(instance.segmentId)) issues.push(issue("missing_reference", `${path}.segmentId`, `Segment ${instance.segmentId} does not exist.`));
    if (!nonblank(instance.scopeId)) issues.push(issue("invalid_recipe", `${path}.scopeId`, "Package scope ID must be nonblank."));
    if (instance.definition?.state !== scenario.state) issues.push(issue("state_mismatch", `${path}.definition.state`, "Package and scenario states must match."));
    issues.push(...packageIssues(instance.definition));
    const params = new Map((instance.definition.parameters ?? []).map((parameter) => [parameter.key, parameter]));
    const roles = new Set((instance.definition.components ?? []).map((component) => component.role));
    for (const key of Object.keys(instance.parameterOverrides ?? {})) if (!params.has(key)) issues.push(issue("unknown_parameter", `${path}.parameterOverrides.${key}`, `Unknown package parameter ${key}.`));
    for (const [key, override] of Object.entries(instance.parameterOverrides ?? {})) {
      const parameter = params.get(key);
      if (override.value === null && parameter?.optional) {
        if (!nonblank(override.reason)) issues.push(issue("reason_required", `${path}.parameterOverrides.${key}.reason`, "An override requires a nonblank reason."));
      } else {
        validOverride(override, `${path}.parameterOverrides.${key}`, issues, parameter ? { min: parameter.min, max: parameter.max, exclusiveMin: parameter.exclusiveMin, integer: parameter.integer } : undefined);
      }
    }
    for (const [collectionName, collection] of [["quantityOverrides", instance.quantityOverrides], ["rateOverrides", instance.rateOverrides]] as const) {
      for (const [role, override] of Object.entries(collection ?? {})) {
        if (!roles.has(role)) issues.push(issue("missing_reference", `${path}.${collectionName}.${role}`, `Component role ${role} does not exist.`));
        const definition = instance.definition.components.find((entry) => entry.role === role);
        const limits = collectionName === "quantityOverrides"
          ? { min: 0, integer: definition?.quantityRule.unit === "EACH" }
          : { min: 0 };
        validOverride(override, `${path}.${collectionName}.${role}`, issues, limits);
      }
    }
    for (const [role, exclusion] of Object.entries(instance.exclusions ?? {})) {
      if (!roles.has(role)) issues.push(issue("missing_reference", `${path}.exclusions.${role}`, `Component role ${role} does not exist.`));
      if (!nonblank(exclusion.reason) || !nonblank(exclusion.sectionEffect)) issues.push(issue("reason_required", `${path}.exclusions.${role}`, "Exclusions require a reason and section effect."));
    }
    for (const [role, snapshot] of Object.entries(instance.rateSnapshots ?? {})) {
      if (!roles.has(role)) issues.push(issue("missing_reference", `${path}.rateSnapshots.${role}`, `Component role ${role} does not exist.`));
      const component = instance.definition.components.find((entry) => entry.role === role);
      if (snapshot.state !== scenario.state || (component?.binding && (snapshot.agencyItemId !== component.binding.agencyItemId || snapshot.unit !== component.binding.unit))) issues.push(issue("invalid_snapshot", `${path}.rateSnapshots.${role}`, "Rate snapshot state, item identity, and unit must match the exact recipe binding."));
    }
    for (const component of instance.definition.components ?? []) addUnique(generatedId(instance.instanceId, component.role), `${path}.components.${component.role}`, componentIds, issues);
  }
  for (const [index, custom] of (scenario.customComponents ?? []).entries()) {
    const path = `scenario.customComponents[${index}]`;
    addUnique(custom.componentId, `${path}.componentId`, componentIds, issues);
    if (!segments.has(custom.segmentId)) issues.push(issue("missing_reference", `${path}.segmentId`, `Segment ${custom.segmentId} does not exist.`));
    if (!nonblank(custom.scopeId) || !nonblank(custom.role) || !nonblank(custom.description)) issues.push(issue("invalid_recipe", path, "Custom component scope, role, and description must be nonblank."));
    if (!validUnit(custom.unit)) issues.push(issue("unit_mismatch", `${path}.unit`, "Custom component unit is not supported."));
    if (custom.quantity !== null && (!finite(custom.quantity) || custom.quantity < 0 || custom.unit === "EACH" && !Number.isInteger(custom.quantity))) issues.push(issue(custom.unit === "EACH" ? "integer_required" : "invalid_number", `${path}.quantity`, "Custom quantity must be finite, nonnegative, and integral for EACH."));
    if (custom.unitRate !== null && (!finite(custom.unitRate) || custom.unitRate < 0)) issues.push(issue("invalid_number", `${path}.unitRate`, "Custom unit rate must be finite and nonnegative."));
    if (!nonblank(custom.reason)) issues.push(issue("reason_required", `${path}.reason`, "Custom pricing requires a reason."));
    if (custom.exclusion && (!nonblank(custom.exclusion.reason) || !nonblank(custom.exclusion.sectionEffect))) issues.push(issue("reason_required", `${path}.exclusion`, "Custom exclusion requires a reason and section effect."));
  }
  const contributions = componentDefinitions(scenario);
  const allowanceById = new Map<string, AllowanceDefinition>();
  for (const [index, allowance] of (scenario.allowances ?? []).entries()) {
    const path = `scenario.allowances[${index}]`;
    addUnique(allowance.allowanceId, `${path}.allowanceId`, allowanceIds, issues);
    allowanceById.set(allowance.allowanceId, allowance);
    if (!nonblank(allowance.name)) issues.push(issue("invalid_recipe", `${path}.name`, "Allowance name must be nonblank."));
    const builtInCategory: Record<string, string> = {
      mobilization: "construction", traffic: "construction", drainage: "construction", minor_utilities: "construction",
      contingency: "construction", design: "service", construction_engineering: "service",
    };
    if (allowance.role !== "custom" && builtInCategory[allowance.role] !== allowance.category) {
      issues.push(issue("invalid_recipe", `${path}.category`, "Built-in allowance roles must retain their construction or service category."));
    }
    if (!["construction", "service", "external"].includes(allowance.category)) issues.push(issue("invalid_recipe", `${path}.category`, "Allowance category is unsupported."));
    if (allowance.percent !== null && (!finite(allowance.percent) || allowance.percent < 0)) issues.push(issue("invalid_number", `${path}.percent`, "Allowance percent must be finite and nonnegative or null when unpriced."));
    if (allowance.exclusion && (!nonblank(allowance.exclusion.reason) || !nonblank(allowance.exclusion.sectionEffect))) issues.push(issue("reason_required", `${path}.exclusion`, "Allowance exclusion requires a reason and section effect."));
    if (allowance.enabled && allowance.overrideReason !== null && !nonblank(allowance.overrideReason)) issues.push(issue("reason_required", `${path}.overrideReason`, "Allowance override reason must be nonblank."));
  }
  const substitutionPairs = new Map<string, string>();
  const replacedBy = new Map<string, string>();
  const replacedAllowancesBy = new Map<string, string>();
  const replacementEdges = new Map<string, string[]>();
  const validSubstitutions = new Set<number>();
  for (const [index, substitution] of (scenario.substitutions ?? []).entries()) {
    const path = `scenario.substitutions[${index}]`;
    let valid = nonblank(substitution.reason) && componentIds.has(substitution.replacementComponentId) && !substitution.replacedComponentIds.includes(substitution.replacementComponentId);
    if (!nonblank(substitution.reason)) issues.push(issue("reason_required", `${path}.reason`, "Substitution requires a nonblank reason."));
    if (!componentIds.has(substitution.replacementComponentId)) issues.push(issue("missing_reference", `${path}.replacementComponentId`, "Replacement component does not exist."));
    if (substitution.replacedComponentIds.includes(substitution.replacementComponentId)) { issues.push(issue("scope_overlap", path, "A component cannot replace itself.")); valid = false; }
    const replacement = contributions.find((entry) => entry.id === substitution.replacementComponentId);
    if (replacement?.excluded) { issues.push(issue("scope_overlap", `${path}.replacementComponentId`, "An excluded component cannot replace other scope.")); valid = false; }
    const seen = new Set<string>();
    for (const id of substitution.replacedComponentIds) {
      if (!componentIds.has(id)) { issues.push(issue("missing_reference", `${path}.replacedComponentIds`, `Replaced component ${id} does not exist.`)); valid = false; }
      if (seen.has(id)) { issues.push(issue("duplicate_id", `${path}.replacedComponentIds`, `Component ${id} is listed more than once.`)); valid = false; }
      seen.add(id);
      if (replacedBy.has(id)) { issues.push(issue("scope_overlap", `${path}.replacedComponentIds`, `Component ${id} is already replaced by ${replacedBy.get(id)}.`)); valid = false; }
      else replacedBy.set(id, substitution.replacementComponentId);
      const edges = replacementEdges.get(substitution.replacementComponentId) ?? [];
      edges.push(id); replacementEdges.set(substitution.replacementComponentId, edges);
    }
    for (const id of substitution.replacedAllowanceIds) {
      if (!allowanceIds.has(id)) { issues.push(issue("missing_reference", `${path}.replacedAllowanceIds`, `Replaced allowance ${id} does not exist.`)); valid = false; }
      if (replacedAllowancesBy.has(id)) { issues.push(issue("scope_overlap", `${path}.replacedAllowanceIds`, `Allowance ${id} is already replaced.`)); valid = false; }
      else replacedAllowancesBy.set(id, substitution.replacementComponentId);
    }
    const pair = JSON.stringify([substitution.replacementComponentId, [...substitution.replacedComponentIds].sort(), [...substitution.replacedAllowanceIds].sort()]);
    if (substitutionPairs.has(pair)) { issues.push(issue("duplicate_id", path, "Duplicate substitution structure.")); valid = false; }
    substitutionPairs.set(pair, path);
    if (valid) validSubstitutions.add(index);
  }
  const visit = (node: string, stack: Set<string>, done: Set<string>): void => {
    if (stack.has(node)) { issues.push(issue("allowance_cycle", "scenario.substitutions", "Substitution replacement references contain a cycle.")); return; }
    if (done.has(node)) return;
    stack.add(node);
    for (const next of replacementEdges.get(node) ?? []) visit(next, stack, done);
    stack.delete(node); done.add(node);
  };
  const replacementDone = new Set<string>();
  for (const node of replacementEdges.keys()) visit(node, new Set(), replacementDone);
  const substitutionReplacements = new Set((scenario.substitutions ?? []).map((entry) => entry.replacementComponentId));
  for (const replacementId of substitutionReplacements) {
    if (replacedBy.has(replacementId)) {
      issues.push(issue("scope_overlap", "scenario.substitutions", `Replacement component ${replacementId} is itself replaced and therefore is not an active replacement.`));
      validSubstitutions.clear();
    }
  }
  if (issues.some((entry) => entry.code === "allowance_cycle" && entry.path === "scenario.substitutions")) validSubstitutions.clear();
  const validReplacedComponents = new Set<string>();
  const validReplacedAllowances = new Set<string>();
  for (const index of validSubstitutions) {
    const substitution = scenario.substitutions[index];
    substitution.replacedComponentIds.forEach((id) => validReplacedComponents.add(id));
    substitution.replacedAllowanceIds.forEach((id) => validReplacedAllowances.add(id));
  }
  const activeByPhysicalKey = new Map<string, typeof contributions[number]>();
  for (const component of contributions) {
    if (component.excluded || validReplacedComponents.has(component.id)) continue;
    const key = JSON.stringify([component.segmentId, component.scopeId, canonicalRole(component.role)]);
    const previous = activeByPhysicalKey.get(key);
    if (previous) issues.push(issue("scope_overlap", `scenario.components.${component.id}`, `Active component overlaps ${previous.id} at the same physical scope and canonical role.`));
    else activeByPhysicalKey.set(key, component);
  }

  const activeAllowance = (allowance: AllowanceDefinition): boolean =>
    allowance.enabled && !allowance.exclusion && !validReplacedAllowances.has(allowance.allowanceId);
  const allowanceRoles = new Set<string>();
  const allowanceNode = (id: string): string => `allowance:${id}`;
  const active = (scenario.allowances ?? []).filter(activeAllowance);
  const allowanceGraph = new Map<string, string[]>([
    ["builtin:D", []],
    ["builtin:S", active.filter((entry) => entry.category === "construction" && entry.role !== "contingency").map((entry) => allowanceNode(entry.allowanceId))],
    ["builtin:K", active.filter((entry) => entry.role === "contingency").map((entry) => allowanceNode(entry.allowanceId))],
    ["builtin:S+K", ["builtin:S", "builtin:K"]],
  ]);
  for (const [index, allowance] of (scenario.allowances ?? []).entries()) {
    const path = `scenario.allowances[${index}]`;
    if (activeAllowance(allowance) && allowance.role !== "custom") {
      if (allowanceRoles.has(allowance.role)) issues.push(issue("duplicate_id", `${path}.role`, `More than one active allowance has built-in role ${allowance.role}.`));
      allowanceRoles.add(allowance.role);
    }
    let dependencies: string[] = [];
    switch (allowance.base.kind) {
      case "direct_construction": dependencies = ["builtin:D"]; break;
      case "construction_subtotal": dependencies = ["builtin:S"]; break;
      case "construction_with_contingency": dependencies = ["builtin:S+K"]; break;
      case "references":
        for (const id of allowance.base.componentIds) if (!componentIds.has(id)) issues.push(issue("missing_reference", `${path}.base.componentIds`, `Component ${id} does not exist.`));
        for (const id of allowance.base.allowanceIds) if (!allowanceIds.has(id)) issues.push(issue("missing_reference", `${path}.base.allowanceIds`, `Allowance ${id} does not exist.`));
        dependencies = [...new Set(allowance.base.allowanceIds)].map(allowanceNode);
        break;
    }
    // Disabled, excluded and explicitly replaced rows contribute zero, never dependencies.
    allowanceGraph.set(allowanceNode(allowance.allowanceId), activeAllowance(allowance) ? dependencies : []);
  }
  const allowanceDone = new Set<string>();
  const allowanceStack = new Set<string>();
  const walkAllowance = (id: string): void => {
    if (allowanceStack.has(id)) { issues.push(issue("allowance_cycle", "scenario.allowances", "Allowance references and subtotal bases contain a dependency cycle.")); return; }
    if (allowanceDone.has(id)) return;
    allowanceStack.add(id);
    for (const next of allowanceGraph.get(id) ?? []) walkAllowance(next);
    allowanceStack.delete(id); allowanceDone.add(id);
  };
  for (const id of allowanceGraph.keys()) walkAllowance(id);

  for (const component of contributions) {
    if (component.excluded || validReplacedComponents.has(component.id)) continue;
    const tags = new Set(component.tags);
    for (const allowance of scenario.allowances ?? []) {
      if (!allowance.enabled || allowance.exclusion || !allowance.overlapTags?.some((tag) => tags.has(tag))) continue;
      if (!validReplacedAllowances.has(allowance.allowanceId)) issues.push(issue("scope_overlap", `scenario.components.${component.id}`, `Detailed ${allowance.overlapTags.join("/")} work requires an explicit substitution of allowance ${allowance.allowanceId}.`));
    }
  }
  const externalIds = new Set<string>();
  for (const external of scenario.externalScopes ?? []) {
    if (!["right_of_way", "major_utilities"].includes(external.scopeId)) issues.push(issue("invalid_recipe", "scenario.externalScopes", "External scope ID is unsupported."));
    if (externalIds.has(external.scopeId)) issues.push(issue("duplicate_id", `scenario.externalScopes.${external.scopeId}`, "External scope decision must appear exactly once."));
    externalIds.add(external.scopeId);
    if (external.decision === "manual" && (!finite(external.amount) || external.amount! < 0 || !nonblank(external.reason))) issues.push(issue("invalid_number", `scenario.externalScopes.${external.scopeId}`, "Manual external scope requires a finite nonnegative amount and reason."));
    if (external.decision === "none_assumed" && !nonblank(external.reason)) issues.push(issue("reason_required", `scenario.externalScopes.${external.scopeId}.reason`, "A none-assumed decision requires a reason."));
  }
  for (const id of ["right_of_way", "major_utilities"]) if (!externalIds.has(id)) issues.push(issue("missing_reference", `scenario.externalScopes.${id}`, `External scope decision ${id} is required exactly once.`));
  return issues;
}
