import rawLibrary from "../../data/planning/co_element_library.json";
import type {
  BaseType,
  ComponentDefinition,
  ElementDefinition,
  ElementInputDefinition,
  ElementSelection,
  InputValue,
  PlanningIssue,
  PlanningLibrary,
  PriceTable,
  ProjectInputs,
  ResolvedComponent,
  ResolvedElement,
  ResolvedLibrary
} from "./types";

const BASE_TYPES: BaseType[] = ["mill_overlay", "reconstruction", "path", "elements_only"];
const GROUP_IDS = ["base", "corridor", "spot", "other"];
const PROJECT_INPUT_KEYS = ["lengthMiles", "roadwayWidthFt", "intersections"];
/** Quantity rule keys that are not input references. */
const RULE_NON_INPUT_KEYS = new Set(["kind", "unit"]);

type Obj = Record<string, unknown>;
type ValidationResult =
  | { ok: true; value: PlanningLibrary; issues: PlanningIssue[] }
  | { ok: false; issues: PlanningIssue[] };

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateLibrary(raw: unknown): ValidationResult {
  const issues: PlanningIssue[] = [];
  const bad = (code: string, path: string, message: string) => issues.push({ code, path, message });
  const str = (o: Obj, key: string, path: string) => {
    if (typeof o[key] !== "string" || o[key] === "") bad("missing_field", `${path}.${key}`, `${path}.${key} must be a non-empty string.`);
  };
  if (!isObj(raw)) {
    return { ok: false, issues: [{ code: "missing_field", path: "", message: "Library must be an object." }] };
  }
  if (raw.schemaVersion !== 1) bad("missing_field", "schemaVersion", "schemaVersion must be 1.");
  for (const key of ["state", "label", "defaultStage"]) str(raw, key, "library");
  for (const key of ["projectInputs", "stages", "groups", "elements", "templates"]) {
    if (!Array.isArray(raw[key])) bad("missing_field", key, `${key} must be an array.`);
  }
  if (!isObj(raw.engineering)) bad("missing_field", "engineering", "engineering must be an object.");
  if (!isObj(raw.factors)) bad("missing_field", "factors", "factors must be an object.");
  else {
    for (const type of BASE_TYPES) if (!isObj(raw.factors[type])) bad("missing_factors", `factors.${type}`, `Missing factor set for ${type}.`);
  }
  if (issues.length > 0) return { ok: false, issues };

  const list = (key: string) => (raw[key] as unknown[]).filter(isObj);
  const projectKeys = new Set(list("projectInputs").map((p) => String(p.key)));
  const stageIds = new Set(list("stages").map((s) => String(s.id)));
  const groupIds = new Set(list("groups").map((g) => String(g.id)));
  for (const id of GROUP_IDS) if (!groupIds.has(id)) bad("unknown_group", "groups", `Group ${id} is not defined.`);
  for (const key of PROJECT_INPUT_KEYS) if (!projectKeys.has(key)) bad("missing_field", "projectInputs", `Project input ${key} is not defined.`);
  if (!stageIds.has(String(raw.defaultStage))) bad("unknown_stage", "defaultStage", `defaultStage ${String(raw.defaultStage)} is not a stage.`);

  const elementInputs = new Map<string, Set<string>>();
  list("elements").forEach((element, index) => {
    const path = `elements[${index}]`;
    str(element, "id", path);
    const id = String(element.id);
    if (elementInputs.has(id)) bad("duplicate_id", path, `Duplicate element id ${id}.`);
    if (!groupIds.has(String(element.group))) bad("unknown_group", path, `Element ${id} names unknown group ${String(element.group)}.`);
    if (element.group === "base" && !BASE_TYPES.includes(element.baseType as BaseType)) {
      bad("missing_factors", path, `Base element ${id} needs a baseType with a factor set.`);
    }
    const inputs = Array.isArray(element.inputs) ? element.inputs.filter(isObj) : [];
    const components = Array.isArray(element.components) ? element.components.filter(isObj) : [];
    if (!Array.isArray(element.inputs) || !Array.isArray(element.components)) bad("missing_field", path, `Element ${id} needs inputs and components arrays.`);
    const keys = new Set(inputs.map((i) => String(i.key)));
    elementInputs.set(id, keys);
    const checkWhen = (when: unknown, where: string) => {
      if (when !== undefined && (!isObj(when) || !keys.has(String(when.input)))) bad("unknown_input", where, `Condition in ${id} names an undefined input.`);
    };
    inputs.forEach((input, i) => {
      const sources = ["default", "inherit", "defaultFrom"].filter((k) => input[k] !== undefined).length;
      if (sources !== 1) bad("input_source", `${path}.inputs[${i}]`, `Input ${String(input.key)} needs exactly one of default, inherit, defaultFrom.`);
      if (input.inherit !== undefined && !projectKeys.has(String(input.inherit))) bad("unknown_input", `${path}.inputs[${i}]`, `Input ${String(input.key)} inherits an unknown project input.`);
      if (isObj(input.defaultFrom) && !projectKeys.has(String(input.defaultFrom.input))) bad("unknown_input", `${path}.inputs[${i}]`, `Input ${String(input.key)} defaultFrom names an unknown project input.`);
      checkWhen(input.when, `${path}.inputs[${i}].when`);
    });
    components.forEach((component, i) => {
      const where = `${path}.components[${i}]`;
      if (component.item === undefined && typeof component.unitCost !== "number") bad("missing_field", where, `Component ${String(component.id)} needs an item or a unitCost.`);
      checkWhen(component.when, `${where}.when`);
      if (!isObj(component.quantity)) return bad("missing_field", where, `Component ${String(component.id)} needs a quantity rule.`);
      for (const [key, ref] of Object.entries(component.quantity)) {
        if (!RULE_NON_INPUT_KEYS.has(key) && !keys.has(String(ref))) bad("unknown_input", `${where}.quantity.${key}`, `Quantity rule in ${id} names undefined input ${String(ref)}.`);
      }
    });
  });

  const templateIds = new Set<string>();
  list("templates").forEach((template, index) => {
    const path = `templates[${index}]`;
    str(template, "id", path);
    if (templateIds.has(String(template.id))) bad("duplicate_id", path, `Duplicate template id ${String(template.id)}.`);
    templateIds.add(String(template.id));
    if (!Array.isArray(template.elements)) return bad("missing_field", path, "Template needs an elements array.");
    template.elements.filter(isObj).forEach((entry, i) => {
      const keys = elementInputs.get(String(entry.id));
      if (!keys) return bad("unknown_element", `${path}.elements[${i}]`, `Template names unknown element ${String(entry.id)}.`);
      for (const key of isObj(entry.inputs) ? Object.keys(entry.inputs) : []) {
        if (!keys.has(key)) bad("unknown_input", `${path}.elements[${i}]`, `Template sets undefined input ${key} on ${String(entry.id)}.`);
      }
    });
  });

  return issues.length > 0 ? { ok: false, issues } : { ok: true, value: raw as unknown as PlanningLibrary, issues: [] };
}

export function resolveLibrary(library: PlanningLibrary, prices: PriceTable): { library: ResolvedLibrary; issues: PlanningIssue[] } {
  const issues: PlanningIssue[] = [];
  const resolve = (element: ElementDefinition, component: ComponentDefinition): ResolvedComponent => {
    const path = `${element.id}.${component.id}`;
    const ruleUnit = "unit" in component.quantity ? component.quantity.unit : undefined;
    if (component.item === undefined) {
      const unit = component.unit ?? ruleUnit ?? "";
      return { ...component, displayUnit: unit, unitPrice: component.unitCost ?? 0, source: { kind: "assembly", basis: component.basis ?? "" } };
    }
    const item = prices.items[component.item];
    const base = { kind: "item" as const, itemId: component.item, code: "", description: "", contracts: 0, pool: "statewide" as const, p25: 0, p75: 0 };
    if (!item) {
      issues.push({ code: "missing_price", path, message: `Price table has no item ${component.item}.` });
      return { ...component, displayUnit: ruleUnit ?? component.unit ?? "", unitPrice: 0, source: base };
    }
    const source = { ...base, code: item.code, description: item.description, contracts: item.contracts, pool: item.pool, p25: item.p25, p75: item.p75 };
    const displayUnit = ruleUnit ?? component.unit ?? item.unit;
    if (ruleUnit !== undefined && ruleUnit !== item.unit) {
      issues.push({ code: "unit_mismatch", path, message: `${component.item} is priced per ${item.unit} but the quantity is in ${ruleUnit}.` });
      return { ...component, displayUnit, unitPrice: 0, source };
    }
    return { ...component, displayUnit, unitPrice: item.price, source };
  };
  const elements: ResolvedElement[] = library.elements.map((element) => ({
    ...element,
    components: element.components.map((component) => resolve(element, component))
  }));
  return { library: { ...library, elements, priceBasisLabel: prices.basis.label }, issues };
}

export async function loadPlanningLibrary(fetchFn: typeof fetch = fetch): Promise<{ library: ResolvedLibrary; issues: PlanningIssue[] }> {
  const checked = validateLibrary(rawLibrary as unknown);
  if (!checked.ok) {
    throw new Error(`Planning library is invalid: ${checked.issues.map((i) => `${i.path}: ${i.message}`).join(" ")}`);
  }
  const url = `${import.meta.env.BASE_URL}data/states/co/planning_prices.json`;
  const response = await fetchFn(url);
  if (!response.ok) throw new Error(`Could not load planning prices (${response.status} ${response.statusText}) from ${url}.`);
  return resolveLibrary(checked.value, (await response.json()) as PriceTable);
}

export function isInputActive(input: ElementInputDefinition, values: Record<string, InputValue>): boolean {
  return !input.when || values[input.when.input] === input.when.equals;
}

export function elementInputValues(
  element: ElementDefinition | ResolvedElement,
  selection: ElementSelection | undefined,
  projectInputs: ProjectInputs
): Record<string, InputValue> {
  const all: Record<string, InputValue> = {};
  for (const input of element.inputs) {
    const changed = selection?.inputs[input.key];
    if (changed !== undefined) all[input.key] = changed;
    else if (input.inherit) all[input.key] = projectInputs[input.inherit];
    else if (input.defaultFrom) all[input.key] = projectInputs[input.defaultFrom.input] * input.defaultFrom.multiply;
    else if (input.default !== undefined) all[input.key] = input.default;
  }
  const active: Record<string, InputValue> = {};
  for (const input of element.inputs) {
    if (input.key in all && isInputActive(input, all)) active[input.key] = all[input.key];
  }
  return active;
}
