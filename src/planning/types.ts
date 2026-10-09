// Planning v2 shared types. Contract and rules: src/planning/README.md.

// ---------- Library (data/planning/co_element_library.json) ----------

export type BaseType = "mill_overlay" | "reconstruction" | "path" | "elements_only";
export type GroupId = "base" | "corridor" | "spot" | "other";
export type GroupSelection = "one" | "any" | "amount";
export type ProjectInputKey = "lengthMiles" | "roadwayWidthFt" | "intersections";
export type InputValue = number | string;

export interface Condition {
  input: string;
  equals: InputValue;
}

export interface ProjectInputDefinition {
  key: ProjectInputKey;
  label: string;
  unit: string;
  default: number;
  min?: number;
  integer?: boolean;
}

export interface ElementInputDefinition {
  key: string;
  label: string;
  unit?: string;
  /** Exactly one of default, inherit, defaultFrom supplies the starting value. */
  default?: InputValue;
  inherit?: ProjectInputKey;
  defaultFrom?: { input: ProjectInputKey; multiply: number };
  options?: InputValue[];
  integer?: boolean;
  min?: number;
  /** Shown only in the advanced part of the inputs disclosure. */
  advanced?: boolean;
  /** Input is shown and used only when the condition holds. */
  when?: Condition;
}

export type QuantityRule =
  | { kind: "area"; length: string; width: string; sides?: string; unit: "SY" }
  | { kind: "volume"; length: string; width: string; depth: string; sides?: string; unit: "CY" }
  | {
      kind: "asphalt_tons";
      length: string;
      width: string;
      thickness: string;
      density: string;
      materialFactor: string;
      unit: "TON";
    }
  | { kind: "linear"; length: string; sides?: string; unit: "LF" }
  | { kind: "miles"; length: string; sides?: string }
  | { kind: "count"; count: string };

export interface ComponentDefinition {
  id: string;
  label: string;
  /** Price-table item id (item-priced component). */
  item?: string;
  /** Direct 2026 assembly cost per unit (assembly component). */
  unitCost?: number;
  /** Assembly unit, e.g. "MILE" or "EACH". Item components take the unit from the quantity rule. */
  unit?: string;
  quantity: QuantityRule;
  when?: Condition;
  basis?: string;
}

export interface ElementDefinition {
  id: string;
  group: GroupId;
  label: string;
  /** Base-group elements only: selects the factor set. */
  baseType?: BaseType;
  inputs: ElementInputDefinition[];
  components: ComponentDefinition[];
  note: string;
}

export interface FactorSet {
  minor: number;
  trafficControl: number;
  mobilization: number;
  basis: string;
}

export interface StageDefinition {
  id: string;
  label: string;
  contingency: number;
  rangeLow: number;
  rangeHigh: number;
}

export interface GroupDefinition {
  id: GroupId;
  label: string;
  selection: GroupSelection;
}

export interface TemplateDefinition {
  id: string;
  label: string;
  description: string;
  projectInputs?: Partial<Record<ProjectInputKey, number>>;
  elements: Array<{ id: string; inputs?: Record<string, InputValue> }>;
}

export interface PlanningLibrary {
  schemaVersion: 1;
  state: string;
  label: string;
  priceTable: string;
  notes: string;
  projectInputs: ProjectInputDefinition[];
  stages: StageDefinition[];
  defaultStage: string;
  engineering: { design: number; constructionEngineering: number };
  factors: Record<BaseType, FactorSet>;
  groups: GroupDefinition[];
  elements: ElementDefinition[];
  templates: TemplateDefinition[];
}

// ---------- Price table (public/data/states/co/planning_prices.json) ----------

export interface PriceTableItem {
  code: string;
  description: string;
  unit: string;
  price: number;
  p25: number;
  p75: number;
  contracts: number;
  urbanContracts: number;
  pool: "urban" | "statewide";
  observations: number;
  droppedOtherUnitRows: number;
}

export interface PriceTable {
  schemaVersion: 1;
  state: string;
  basis: { indexSource: string; indexPeriod: string; escalationFactor: number; label: string };
  window: { start: string; end: string };
  rules: Record<string, unknown>;
  items: Record<string, PriceTableItem>;
  summary: Record<string, number>;
}

// ---------- Resolved library (library + bound prices) ----------

export type PriceSource =
  | {
      kind: "item";
      itemId: string;
      code: string;
      description: string;
      contracts: number;
      pool: "urban" | "statewide";
      p25: number;
      p75: number;
    }
  | { kind: "assembly"; basis: string };

export interface ResolvedComponent extends ComponentDefinition {
  /** Unit for display: item rule unit, or assembly unit. */
  displayUnit: string;
  unitPrice: number;
  source: PriceSource;
}

export interface ResolvedElement extends Omit<ElementDefinition, "components"> {
  components: ResolvedComponent[];
}

export interface ResolvedLibrary extends Omit<PlanningLibrary, "elements"> {
  elements: ResolvedElement[];
  priceBasisLabel: string;
}

// ---------- Planning project (stored and shared) ----------

export type ProjectInputs = Record<ProjectInputKey, number>;

export interface ElementSelection {
  enabled: boolean;
  /** Only inputs the planner changed. Missing keys use the library default or inherited value. */
  inputs: Record<string, InputValue>;
  /** Planner dollar amount. null = use the calculated amount. 0 is a valid override.
   *  For "other" group elements this is the entered amount (null counts as $0). */
  override: number | null;
}

export interface Alternative {
  id: string;
  name: string;
  description: string;
  /** Keyed by element id. Elements with no entry are off with default inputs. */
  selections: Record<string, ElementSelection>;
}

export interface PlanningProject {
  schemaVersion: 1;
  id: string;
  name: string;
  state: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  templateId: string | null;
  inputs: ProjectInputs;
  stageId: string;
  engineering: { design: number; constructionEngineering: number };
  /** null = no budget entered. */
  budget: number | null;
  alternatives: Alternative[];
  selectedAlternativeId: string;
}

// ---------- Calculation results ----------

export interface PlanningIssue {
  code: string;
  path: string;
  message: string;
}

export interface ComponentResult {
  id: string;
  label: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  amount: number;
  source: PriceSource;
}

export interface ElementResult {
  elementId: string;
  label: string;
  group: GroupId;
  enabled: boolean;
  /** Effective input values (defaults, inherited values, planner changes). Inactive conditional inputs omitted. */
  inputs: Record<string, InputValue>;
  components: ComponentResult[];
  /** Sum of component amounts, before factors. */
  direct: number;
  /** direct × combined multiplier of the alternative's base type. */
  calculated: number;
  override: number | null;
  /** override ?? calculated. Counted in totals only when enabled. */
  amount: number;
}

export interface AlternativeSummary {
  baseType: BaseType;
  factors: FactorSet;
  multiplier: number;
  construction: number;
  contingencyRate: number;
  contingency: number;
  designRate: number;
  design: number;
  constructionEngineeringRate: number;
  constructionEngineering: number;
  rightOfWay: number;
  utilityRelocation: number;
  total: number;
  rangeLow: number;
  rangeHigh: number;
  budget: number | null;
  /** budget − total; null when no budget. */
  budgetRemaining: number | null;
}

export interface AlternativeResult {
  alternativeId: string;
  elements: ElementResult[];
  summary: AlternativeSummary;
  issues: PlanningIssue[];
}
