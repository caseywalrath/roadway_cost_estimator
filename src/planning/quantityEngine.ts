import type {
  AnnualRateSnapshot,
  ComponentDefinition,
  CostComponent,
  ContractRateSnapshot,
  ItemBinding,
  NumericOverride,
  PackageInstance,
  PlanningIssue,
  PlanningResult,
  PlanningScenario,
  PlanningUnit,
  QuantityRule,
  RateSnapshot,
} from "./types";
import { convertPlanningQuantity, normalizePlanningUnit } from "./units";
import { validatePackageDefinition } from "./validateRecipes";

const issue = (code: string, path: string, message: string, severity: PlanningIssue["severity"] = "error"): PlanningIssue => ({ code, path, message, severity });
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const finiteNonnegative = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
const physicalRole = (role: string): string => ["asphalt", "pavement", "sidewalk"].includes(role) ? "surface" : role;
const generatedId = (instanceId: string, role: string): string => `${instanceId}/${role}`;

export function resolvePackageParameters(instance: PackageInstance): PlanningResult<Record<string, number | null>> {
  const values: Record<string, number | null> = {};
  const issues: PlanningIssue[] = [];
  const definitions = new Map(instance.definition.parameters.map((definition) => [definition.key, definition]));

  for (const [key, override] of Object.entries(instance.parameterOverrides)) {
    if (!definitions.has(key)) issues.push(issue("unknown_parameter", `packages/${instance.instanceId}/parameterOverrides/${key}`, `Parameter '${key}' is not defined by this package.`));
    if (!override || typeof override !== "object") {
      issues.push(issue("invalid_number", `packages/${instance.instanceId}/parameterOverrides/${key}`, "Parameter override is invalid."));
    } else if (!nonblank(override.reason)) {
      issues.push(issue("reason_required", `packages/${instance.instanceId}/parameterOverrides/${key}/reason`, "A reason is required for a parameter override."));
    }
  }

  for (const definition of instance.definition.parameters) {
    const path = `packages/${instance.instanceId}/parameters/${definition.key}`;
    const hasOverride = Object.prototype.hasOwnProperty.call(instance.parameterOverrides, definition.key);
    const candidate = hasOverride ? instance.parameterOverrides[definition.key]?.value : definition.defaultValue;
    if (candidate === null) {
      values[definition.key] = null;
      if (!definition.optional) issues.push(issue("missing_parameter", path, "A required parameter cannot be blank."));
      continue;
    }
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) {
      values[definition.key] = null;
      issues.push(issue("invalid_number", path, "Parameter must be a finite number."));
      continue;
    }
    if (candidate < definition.min || (definition.exclusiveMin && candidate === definition.min) || (definition.max !== undefined && candidate > definition.max)) {
      values[definition.key] = null;
      issues.push(issue("out_of_bounds", path, `Parameter must be ${definition.exclusiveMin ? "greater than" : "at least"} ${definition.min}${definition.max === undefined ? "" : ` and no greater than ${definition.max}`}.`));
      continue;
    }
    if (definition.integer && !Number.isInteger(candidate)) {
      values[definition.key] = null;
      issues.push(issue("integer_required", path, "Parameter must be a whole number."));
      continue;
    }
    values[definition.key] = candidate;
  }

  return issues.some((entry) => entry.severity === "error") ? { ok: false, issues } : { ok: true, value: values, issues };
}

export function evaluateQuantityRule(rule: QuantityRule, parameters: Record<string, number | null>): PlanningResult<number> {
  const issues: PlanningIssue[] = [];
  const get = (name: string): number | null => {
    if (!Object.prototype.hasOwnProperty.call(parameters, name)) {
      issues.push(issue("missing_parameter", `parameters/${name}`, `Required parameter '${name}' is not defined.`));
      return null;
    }
    const value = parameters[name];
    if (value === null || value === undefined) {
      issues.push(issue("missing_parameter", `parameters/${name}`, `Required parameter '${name}' is blank.`));
      return null;
    }
    if (!Number.isFinite(value) || value < 0) {
      issues.push(issue("invalid_number", `parameters/${name}`, `Parameter '${name}' must be a finite nonnegative number.`));
      return null;
    }
    return value;
  };
  const lengthFeet = (key: string): number | null => {
    const miles = get(key);
    return miles === null ? null : miles * 5280;
  };
  const areaSquareFeet = (lengthKey: string, widthKey: string, sidesKey?: string): number | null => {
    const length = lengthFeet(lengthKey);
    const width = get(widthKey);
    const sides = sidesKey ? get(sidesKey) : 1;
    if (sidesKey && sides !== null && !Number.isInteger(sides)) issues.push(issue("integer_required", `parameters/${sidesKey}`, `Parameter '${sidesKey}' must be a whole number.`));
    return length === null || width === null || sides === null ? null : length * width * sides;
  };
  let result: number | null = null;

  switch (rule.kind) {
    case "area": {
      const sf = areaSquareFeet(rule.length, rule.width, rule.sides);
      if (sf !== null) {
        if (rule.unit === "SF") result = sf;
        else {
          const converted = convertPlanningQuantity(sf, "SF", "SY");
          if (converted.ok) result = converted.value;
          else issues.push(...converted.issues);
        }
      }
      break;
    }
    case "volume": {
      const sf = areaSquareFeet(rule.length, rule.width, rule.sides);
      const depth = get(rule.depth);
      if (sf !== null && depth !== null) result = (sf * depth) / 12 / 27;
      break;
    }
    case "asphalt_tons": {
      const sf = areaSquareFeet(rule.length, rule.width);
      const thickness = get(rule.thickness);
      const density = get(rule.density);
      const materialFactor = get(rule.materialFactor);
      if (sf !== null && thickness !== null && density !== null && materialFactor !== null) {
        if (materialFactor < 1) issues.push(issue("out_of_bounds", `parameters/${rule.materialFactor}`, "Material factor must be at least 1."));
        else result = sf * (thickness / 12) * density / 2000 * materialFactor;
      }
      break;
    }
    case "linear": {
      const length = lengthFeet(rule.length);
      const sides = rule.sides ? get(rule.sides) : 1;
      if (rule.sides && sides !== null && !Number.isInteger(sides)) issues.push(issue("integer_required", `parameters/${rule.sides}`, `Parameter '${rule.sides}' must be a whole number.`));
      if (length !== null && sides !== null) result = length * sides;
      break;
    }
    case "count": {
      result = get(rule.count);
      if (result !== null && !Number.isInteger(result)) issues.push(issue("integer_required", `parameters/${rule.count}`, "Count must be a whole number."));
      break;
    }
    case "fixed":
      result = rule.value;
      if (!Number.isFinite(result) || result < 0) issues.push(issue("invalid_number", "rule/value", "Fixed quantity must be a finite nonnegative number."));
      break;
    case "manual":
      result = get(rule.parameter);
      break;
  }

  if (result !== null && !Number.isFinite(result)) issues.push(issue("invalid_number", "quantity", "Calculated quantity is not finite."));
  if (result !== null && result < 0) issues.push(issue("invalid_number", "quantity", "Calculated quantity cannot be negative."));
  if (issues.some((entry) => entry.severity === "error") || result === null) return { ok: false, issues: issues.length ? issues : [issue("missing_quantity", "quantity", "Quantity could not be calculated.")] };
  return { ok: true, value: result, issues };
}

function validSnapshot(snapshot: RateSnapshot, binding: ItemBinding, state: PlanningScenario["state"]): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  const path = "rateSnapshot";
  if (snapshot.state !== state || binding.state !== state) issues.push(issue("state_mismatch", path, "Rate snapshot and item binding must match the scenario state."));
  if (snapshot.agencyItemId !== binding.agencyItemId || snapshot.unit !== binding.unit) issues.push(issue("invalid_snapshot", path, "Rate snapshot identity or unit does not match the selected binding."));
  if (!finiteNonnegative(snapshot.rate) || snapshot.rate <= 0 || !finiteNonnegative(snapshot.rawRate) || snapshot.rawRate <= 0) issues.push(issue("missing_rate", path, "Automatic frozen rates must be positive finite values."));
  if (!nonblank(snapshot.policyVersion) || !nonblank(snapshot.capturedAt)) issues.push(issue("invalid_snapshot", path, "Rate snapshot is missing policy or capture provenance."));
  if (!(["none", "annual_window_nhcci", "observation_quarter_nhcci"] as string[]).includes(snapshot.inflation.method) || !(["available", "unavailable"] as string[]).includes(snapshot.inflation.availability)) issues.push(issue("invalid_snapshot", path, "Rate snapshot has an unsupported inflation method or availability."));
  if (snapshot.inflation.availability === "available" && (!finiteNonnegative(snapshot.inflation.factor) || snapshot.inflation.factor === 0)) issues.push(issue("invalid_snapshot", path, "Available inflation adjustment requires a positive finite factor."));
  if (snapshot.inflation.availability === "unavailable" && !nonblank(snapshot.inflation.reason)) issues.push(issue("invalid_snapshot", path, "Unavailable inflation adjustment requires a reason."));
  if (snapshot.inflation.targetPeriod !== null && !nonblank(snapshot.inflation.targetPeriod)) issues.push(issue("invalid_snapshot", path, "Inflation target period must be nonblank when supplied."));
  if (snapshot.kind === "ne_annual") {
    const annual = snapshot as AnnualRateSnapshot;
    if (state !== "NE" || !["none", "annual_window_nhcci"].includes(annual.inflation.method) || !nonblank(annual.sourceUnit) || !nonblank(annual.sourceDescription) || !nonblank(annual.sourceId) || !nonblank(annual.summaryId) || !nonblank(annual.reportSeries) || !nonblank(annual.periodStart) || !nonblank(annual.periodEnd) || !nonblank(annual.sourceUrl) || !nonblank(annual.sourceLocator)) {
      issues.push(issue("invalid_snapshot", path, "Nebraska annual snapshot has invalid state or incomplete source provenance."));
    }
  } else if (snapshot.kind === "co_contract_median") {
    const contract = snapshot as ContractRateSnapshot;
    const validLine = (line: ContractRateSnapshot["contracts"][number]["lines"][number]): boolean =>
      nonblank(line.observationId) && nonblank(line.contractItemId) && nonblank(line.sourceId) && nonblank(line.date) &&
      finiteNonnegative(line.quantity) && line.quantity > 0 && normalizeUnitCompatible(line.unit, binding.unit) &&
      finiteNonnegative(line.rawRate) && line.rawRate > 0 && finiteNonnegative(line.rate) && line.rate > 0 && nonblank(line.sourceLocator);
    if (state !== "CO" || !["none", "observation_quarter_nhcci"].includes(contract.inflation.method) || !nonblank(contract.datasetAnchor) || !contract.contracts.length || !contract.sourceIds.length || !contract.requestedFrom || !contract.requestedTo || !nonblank(contract.actualFrom) || !nonblank(contract.actualTo) || !contract.sourceTypes.length || !Array.isArray(contract.districts) || contract.contracts.some((row) => !nonblank(row.contractId) || !finiteNonnegative(row.medianRate) || row.medianRate <= 0 || !row.lines.length || row.lines.some((line) => !validLine(line)))) {
      issues.push(issue("invalid_snapshot", path, "Colorado contract snapshot has invalid state or incomplete evidence provenance."));
    }
  } else {
    issues.push(issue("invalid_snapshot", path, "Rate snapshot kind is unsupported."));
  }
  return issues;
}

function normalizeUnitCompatible(raw: string, unit: PlanningUnit): boolean {
  // The source spelling is retained in the snapshot; normalize without converting dimensions.
  return normalizePlanningUnit(raw) === unit;
}

function validOverride(override: NumericOverride, path: string, label: string, allowNull = false): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  if (!nonblank(override.reason)) issues.push(issue("reason_required", `${path}/reason`, `A reason is required for the ${label} override.`));
  if (override.value === null && allowNull) return issues;
  if (!finiteNonnegative(override.value)) issues.push(issue("invalid_number", path, `${label} must be a finite nonnegative number.`));
  return issues;
}

function componentIssues(component: CostComponent, additions: PlanningIssue[]): void {
  component.issues.push(...additions);
  if (additions.some((entry) => entry.severity === "error")) {
    component.status = "unpriced";
    component.rate = null;
    component.extendedCost = null;
  }
}

function generatePackageComponent(instance: PackageInstance, definition: ComponentDefinition, scenarioState: PlanningScenario["state"]): CostComponent {
  const componentId = generatedId(instance.instanceId, definition.role);
  const basePath = `components/${componentId}`;
  const resolved = resolvePackageParameters(instance);
  const formula = evaluateQuantityRule(definition.quantityRule, resolved.ok ? resolved.value : collectPartialParameters(instance));
  const quantityOverride = Object.prototype.hasOwnProperty.call(instance.quantityOverrides, definition.role) ? instance.quantityOverrides[definition.role] : null;
  const parameterKeys = new Set(Object.keys(collectFormulaInputs(definition.quantityRule, collectPartialParameters(instance))));
  if (definition.binding?.fixedThickness) parameterKeys.add(definition.binding.fixedThickness.parameter);
  const validationIssues = validatePackageDefinition(instance.definition);
  const componentIndex = instance.definition.components.indexOf(definition);
  const issues = validationIssues.filter((entry) => {
    const componentMatch = entry.path.match(/components\[(\d+)\]/);
    if (componentMatch) return Number(componentMatch[1]) === componentIndex;
    const parameterMatch = entry.path.match(/parameters(?:\[(\d+)\]|\/([^/.]+)|\.([^/.]+))/);
    if (parameterMatch) {
      const index = parameterMatch[1] === undefined ? null : Number(parameterMatch[1]);
      const key = parameterMatch[2] ?? parameterMatch[3] ?? (index === null ? null : instance.definition.parameters[index]?.key);
      return key !== null && parameterKeys.has(key);
    }
    return true;
  }).map((entry) => ({ ...entry, path: `${basePath}/${entry.path}` }));
  if (!resolved.ok) {
    const relevantIssues = resolved.issues.filter((entry) => {
      const match = entry.path.match(/(?:parameterOverrides|parameters)\/([^/]+)/);
      return entry.code === "unknown_parameter" || !match || parameterKeys.has(match[1]);
    });
    issues.push(...relevantIssues.map((entry) => ({ ...entry, path: `${basePath}/${entry.path}` })));
  }
  let quantity = formula.ok ? formula.value : null;
  if (!formula.ok) issues.push(...formula.issues.map((entry) => ({ ...entry, path: `${basePath}/${entry.path}` })));
  if (quantityOverride) {
    const overrideIssues = validOverride(quantityOverride, `${basePath}/quantityOverride`, "quantity");
    issues.push(...overrideIssues);
    quantity = overrideIssues.some((entry) => entry.severity === "error") ? null : quantityOverride.value;
  }
  if (definition.quantityRule.unit === "EACH" && quantity !== null && !Number.isInteger(quantity)) issues.push(issue("integer_required", `${basePath}/quantity`, "Each quantities must be whole numbers."));

  const exclusion = Object.prototype.hasOwnProperty.call(instance.exclusions, definition.role) ? instance.exclusions[definition.role] : null;
  if (exclusion && (!nonblank(exclusion.reason) || !nonblank(exclusion.sectionEffect))) issues.push(issue("reason_required", `${basePath}/exclusion`, "Exclusions require a reason and a section effect."));

  const binding = definition.binding;
  let rate: number | null = null;
  let rateBasis: CostComponent["rateBasis"] = null;
  const rateOverride = Object.prototype.hasOwnProperty.call(instance.rateOverrides, definition.role) ? instance.rateOverrides[definition.role] : null;
  const snapshot = Object.prototype.hasOwnProperty.call(instance.rateSnapshots, definition.role) ? instance.rateSnapshots[definition.role] : null;
  let thicknessMismatch = false;
  if (binding?.fixedThickness) {
    const actual = (resolved.ok ? resolved.value : collectPartialParameters(instance))[binding.fixedThickness.parameter];
    thicknessMismatch = actual === null || actual === undefined || actual !== binding.fixedThickness.inches;
    if (thicknessMismatch) issues.push(issue("binding_thickness_mismatch", `${basePath}/binding`, `Bound item is fixed at ${binding.fixedThickness.inches} inches; the selected section thickness is different.`, actual === null || actual === undefined ? "error" : "error"));
  }
  if (binding && binding.state !== scenarioState) issues.push(issue("state_mismatch", `${basePath}/binding`, "Item binding state does not match the scenario."));
  if (binding && binding.unit !== definition.quantityRule.unit) issues.push(issue("unit_mismatch", `${basePath}/binding`, "Item binding unit does not match the quantity rule."));
  if (rateOverride) {
    const overrideIssues = validOverride(rateOverride, `${basePath}/rateOverride`, "rate");
    issues.push(...overrideIssues);
    if (!overrideIssues.some((entry) => entry.severity === "error") && typeof rateOverride.value === "number") {
      rate = rateOverride.value;
      rateBasis = { kind: "manual", value: rateOverride.value, reason: rateOverride.reason, original: snapshot };
      if (thicknessMismatch) {
        const mismatch = issues.find((entry) => entry.code === "binding_thickness_mismatch");
        const actual = (resolved.ok ? resolved.value : collectPartialParameters(instance))[binding?.fixedThickness?.parameter ?? ""];
        if (mismatch && typeof actual === "number" && Number.isFinite(actual)) mismatch.severity = "warning";
      }
    }
  } else if (snapshot && binding && !thicknessMismatch) {
    const snapshotIssues = validSnapshot(snapshot, binding, scenarioState);
    issues.push(...snapshotIssues.map((entry) => ({ ...entry, path: `${basePath}/${entry.path}` })));
    if (!snapshotIssues.some((entry) => entry.severity === "error")) {
      rate = snapshot.rate;
      rateBasis = snapshot;
    }
  } else if (binding && !snapshot) {
    issues.push(issue("missing_rate", `${basePath}/rate`, "No frozen rate or manual rate is available for this component."));
  }

  if (binding === null && rate === null && !issues.some((entry) => entry.code === "missing_rate")) issues.push(issue("missing_rate", `${basePath}/binding`, "This component has no approved automatic item binding; enter a manual rate or keep it visible as unpriced."));
  const unit = binding?.unit ?? definition.quantityRule.unit;
  if (quantity !== null && rate !== null && !issues.some((entry) => entry.severity === "error")) {
    // A valid manual zero remains a priced component.
  }
  const excluded = Boolean(exclusion && nonblank(exclusion.reason) && nonblank(exclusion.sectionEffect));
  const component: CostComponent = {
    componentId,
    instanceId: instance.instanceId,
    segmentId: instance.segmentId,
    scopeId: instance.scopeId,
    role: definition.role,
    physicalScopeKey: JSON.stringify([instance.segmentId, instance.scopeId, physicalRole(definition.role)]),
    description: definition.description,
    category: definition.category,
    required: definition.required,
    tags: [...definition.tags],
    unit,
    quantity,
    originalQuantity: formula.ok ? formula.value : null,
    quantityOverride,
    formula: definition.quantityRule,
    formulaInputs: collectFormulaInputs(definition.quantityRule, resolved.ok ? resolved.value : collectPartialParameters(instance)),
    binding,
    rate,
    rateBasis,
    extendedCost: null,
    status: excluded ? "excluded" : "unpriced",
    exclusion: excluded ? exclusion : null,
    issues,
  };
  if (quantity === null && !component.issues.some((entry) => entry.code === "missing_quantity")) component.issues.push(issue("missing_quantity", `${basePath}/quantity`, "A valid quantity is unavailable."));
  if (quantity !== null && rate !== null && !component.issues.some((entry) => entry.severity === "error")) {
    component.extendedCost = quantity * rate;
    if (Number.isFinite(component.extendedCost)) component.status = excluded ? "excluded" : "priced";
    else component.issues.push(issue("invalid_number", `${basePath}/extendedCost`, "Extended cost is not finite."));
  }
  if (excluded) {
    component.rate = null;
    component.rateBasis = null;
    component.extendedCost = null;
  }
  return component;
}

function collectPartialParameters(instance: PackageInstance): Record<string, number | null> {
  const values: Record<string, number | null> = {};
  for (const definition of instance.definition.parameters) {
    const hasOverride = Object.prototype.hasOwnProperty.call(instance.parameterOverrides, definition.key);
    const value = hasOverride ? instance.parameterOverrides[definition.key]?.value : definition.defaultValue;
    values[definition.key] = typeof value === "number" && Number.isFinite(value) ? value : null;
  }
  return values;
}

function collectFormulaInputs(rule: QuantityRule, parameters: Record<string, number | null>): Record<string, number | null> {
  const keys: string[] = [];
  switch (rule.kind) {
    case "area": keys.push(rule.length, rule.width, ...(rule.sides ? [rule.sides] : [])); break;
    case "volume": keys.push(rule.length, rule.width, rule.depth, ...(rule.sides ? [rule.sides] : [])); break;
    case "asphalt_tons": keys.push(rule.length, rule.width, rule.thickness, rule.density, rule.materialFactor); break;
    case "linear": keys.push(rule.length, ...(rule.sides ? [rule.sides] : [])); break;
    case "count": keys.push(rule.count); break;
    case "manual": keys.push(rule.parameter); break;
    case "fixed": break;
  }
  return Object.fromEntries([...new Set(keys)].map((key) => [key, parameters[key] ?? null]));
}

function generateCustomComponent(custom: PlanningScenario["customComponents"][number], state: PlanningScenario["state"]): CostComponent {
  const path = `components/${custom.componentId}`;
  const issues: PlanningIssue[] = [];
  if (!finiteNonnegative(custom.quantity)) issues.push(issue(custom.quantity === null ? "missing_quantity" : "invalid_number", `${path}/quantity`, "Custom quantity must be a finite nonnegative number."));
  if (!finiteNonnegative(custom.unitRate)) issues.push(issue(custom.unitRate === null ? "missing_rate" : "invalid_number", `${path}/rate`, "Custom rate must be a finite nonnegative number."));
  if ((custom.quantity !== null || custom.unitRate !== null) && !nonblank(custom.reason)) issues.push(issue("reason_required", `${path}/reason`, "A reason is required for manual quantity or rate values."));
  if (custom.unit === "EACH" && custom.quantity !== null && !Number.isInteger(custom.quantity)) issues.push(issue("integer_required", `${path}/quantity`, "Each quantities must be whole numbers."));
  const excluded = Boolean(custom.exclusion && nonblank(custom.exclusion.reason) && nonblank(custom.exclusion.sectionEffect));
  if (custom.exclusion && (!nonblank(custom.exclusion.reason) || !nonblank(custom.exclusion.sectionEffect))) issues.push(issue("reason_required", `${path}/exclusion`, "Exclusions require a reason and a section effect."));
  const valid = !issues.some((entry) => entry.severity === "error") && custom.quantity !== null && custom.unitRate !== null;
  const cost = valid ? custom.quantity! * custom.unitRate! : null;
  const component: CostComponent = {
    componentId: custom.componentId, instanceId: null, segmentId: custom.segmentId, scopeId: custom.scopeId,
    role: custom.role, physicalScopeKey: JSON.stringify([custom.segmentId, custom.scopeId, physicalRole(custom.role)]),
    description: custom.description, category: custom.category, required: custom.required, tags: [...custom.tags], unit: custom.unit,
    quantity: custom.quantity, originalQuantity: custom.quantity, quantityOverride: null, formula: null, formulaInputs: {}, binding: null,
    rate: custom.unitRate, rateBasis: custom.unitRate === null ? null : { kind: "manual", value: custom.unitRate, reason: custom.reason, original: null },
    extendedCost: excluded ? null : cost, status: excluded ? "excluded" : (cost !== null && Number.isFinite(cost) ? "priced" : "unpriced"),
    exclusion: custom.exclusion, issues,
  };
  if (state !== "NE" && state !== "CO") component.issues.push(issue("state_mismatch", path, "Scenario state is unsupported."));
  if (cost !== null && !Number.isFinite(cost)) component.issues.push(issue("invalid_number", `${path}/extendedCost`, "Extended cost is not finite."));
  return component;
}

export function generateScenarioComponents(scenario: PlanningScenario): CostComponent[] {
  const components = scenario.packages.flatMap((instance) => instance.definition.components.map((definition) => generatePackageComponent(instance, definition, scenario.state)));
  components.push(...scenario.customComponents.map((custom) => generateCustomComponent(custom, scenario.state)));

  const byId = new Map<string, CostComponent[]>();
  for (const component of components) byId.set(component.componentId, [...(byId.get(component.componentId) ?? []), component]);
  for (const [id, matching] of byId) {
    if (matching.length > 1) for (const component of matching) componentIssues(component, [issue("duplicate_id", `components/${id}`, "Component IDs must be unique across generated and custom components.")]);
  }

  const substitutions = scenario.substitutions ?? [];
  const replacedBy = new Map<string, string[]>();
  const replacementEdges = new Map<string, string[]>();
  const substitutionReasons = new Map<string, string>();
  const invalidSubstitutions = new Set<string>();
  const replacementCounts = new Map<string, number>();
  for (const substitution of substitutions) {
    const replacement = byId.get(substitution.replacementComponentId)?.[0];
    const componentRefs = substitution.replacedComponentIds;
    const allowanceRefs = substitution.replacedAllowanceIds;
    const refs = [...componentRefs, ...allowanceRefs];
    const issues: PlanningIssue[] = [];
    if (!replacement || byId.get(substitution.replacementComponentId)?.length !== 1) issues.push(issue("missing_reference", `substitutions/${substitution.replacementComponentId}`, "Substitution replacement must identify one existing component."));
    if (!nonblank(substitution.reason)) issues.push(issue("reason_required", `substitutions/${substitution.replacementComponentId}/reason`, "Substitutions require a reason."));
    if (componentRefs.includes(substitution.replacementComponentId)) issues.push(issue("scope_overlap", `substitutions/${substitution.replacementComponentId}`, "A component cannot replace itself."));
    const localSeen = new Set<string>();
    for (const id of componentRefs) {
      if (localSeen.has(id)) issues.push(issue("scope_overlap", `substitutions/${id}`, "A substitution cannot replace the same scope more than once."));
      localSeen.add(id);
      if (!byId.has(id)) issues.push(issue("missing_reference", `substitutions/${id}`, "Substitution references a missing component."));
      replacedBy.set(id, [...(replacedBy.get(id) ?? []), substitution.replacementComponentId]);
      replacementEdges.set(substitution.replacementComponentId, [...(replacementEdges.get(substitution.replacementComponentId) ?? []), id]);
    }
    const allowanceSeen = new Set<string>();
    for (const id of allowanceRefs) {
      if (allowanceSeen.has(id)) issues.push(issue("scope_overlap", `substitutions/${id}`, "A substitution cannot replace the same allowance more than once."));
      allowanceSeen.add(id);
      if (!(scenario.allowances ?? []).some((allowance) => allowance.allowanceId === id)) issues.push(issue("missing_reference", `substitutions/${id}`, "Substitution references a missing allowance."));
      replacementCounts.set(id, (replacementCounts.get(id) ?? 0) + 1);
    }
    if (replacement?.status === "excluded") issues.push(issue("scope_overlap", `substitutions/${substitution.replacementComponentId}`, "An excluded component cannot be the active replacement."));
    if (issues.length) invalidSubstitutions.add(substitution.replacementComponentId);
    else for (const id of substitution.replacedComponentIds) substitutionReasons.set(id, substitution.reason.trim());
    for (const entry of issues) {
      if (replacement) componentIssues(replacement, [entry]);
      for (const id of refs) for (const target of byId.get(id) ?? []) componentIssues(target, [entry]);
    }
  }
  const seen = new Set<string>();
  const cyclic = new Set<string>();
  const visiting: string[] = [];
  const visit = (id: string): void => {
    const cycleAt = visiting.indexOf(id);
    if (cycleAt >= 0) { for (const cycleId of visiting.slice(cycleAt)) cyclic.add(cycleId); return; }
    if (seen.has(id)) return;
    visiting.push(id);
    for (const target of replacementEdges.get(id) ?? []) if (replacementEdges.has(target)) visit(target);
    visiting.pop(); seen.add(id);
  };
  for (const id of replacementEdges.keys()) visit(id);
  for (const id of cyclic) invalidSubstitutions.add(id);
  for (const id of cyclic) for (const component of byId.get(id) ?? []) componentIssues(component, [issue("scope_overlap", `components/${id}`, "Circular substitutions are invalid.")]);

  // A replacement must remain active itself. Chains hide scope and cycles make
  // the active contribution ambiguous, so retain all involved rows as errors.
  for (const replacementId of replacementEdges.keys()) {
    if (replacedBy.has(replacementId)) {
      invalidSubstitutions.add(replacementId);
      const replacementTarget = replacedBy.get(replacementId) ?? [];
      for (const component of byId.get(replacementId) ?? []) componentIssues(component, [issue("scope_overlap", `components/${replacementId}`, "A substitution replacement cannot itself be replaced." )]);
      for (const id of replacementTarget) for (const component of byId.get(id) ?? []) componentIssues(component, [issue("scope_overlap", `components/${id}`, "A substitution replacement cannot itself be replaced." )]);
    }
  }
  for (const [allowanceId, count] of replacementCounts) if (count > 1) {
    for (const substitution of substitutions.filter((entry) => entry.replacedAllowanceIds.includes(allowanceId))) invalidSubstitutions.add(substitution.replacementComponentId);
  }
  for (const [id, replacements] of replacedBy) {
    if (replacements.length > 1) for (const target of byId.get(id) ?? []) componentIssues(target, [issue("scope_overlap", `components/${id}`, "Multiple substitutions replace the same component; resolve the conflict explicitly.")]);
    else {
      const replacement = replacements[0];
      if (invalidSubstitutions.has(replacement)) continue;
      for (const target of byId.get(id) ?? []) {
        if (target.status !== "excluded") {
          target.status = "excluded";
          target.extendedCost = null;
          target.rate = null;
          target.rateBasis = null;
          target.exclusion = { reason: substitutionReasons.get(id) ?? `Replaced by ${replacement}.`, sectionEffect: "Scope is accounted for by the explicit replacement component." };
        }
      }
    }
  }

  const byPhysicalScope = new Map<string, CostComponent[]>();
  for (const component of components) {
    if (component.status === "excluded") continue;
    byPhysicalScope.set(component.physicalScopeKey, [...(byPhysicalScope.get(component.physicalScopeKey) ?? []), component]);
  }
  for (const [key, matching] of byPhysicalScope) {
    if (matching.length > 1) for (const component of matching) componentIssues(component, [issue("scope_overlap", `components/${component.componentId}`, `Multiple active components claim the same physical scope (${key}); choose an explicit substitution or exclusion.`)]);
  }
  return components;
}
