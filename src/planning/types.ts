/** Planning contract v1. Pure core only; runtime imports from other app modules are prohibited. */
export type PlanningState = "NE" | "CO";
export type PlanningUnit = "LF" | "SF" | "SY" | "CY" | "TON" | "EACH" | "LS";
export type PackageKind = "resurfacing" | "reconstruction" | "path" | "sidewalk";
export type CostCategory = "construction" | "service" | "external";
export type ComponentStatus = "priced" | "unpriced" | "excluded";

export interface PlanningIssue {
  code: string;
  path: string;
  message: string;
  severity: "error" | "warning";
}
export type PlanningResult<T> =
  | { ok: true; value: T; issues: PlanningIssue[] }
  | { ok: false; issues: PlanningIssue[] };

export interface Assumption {
  id: string;
  description: string;
  origin: "pilot_assumption" | "workbook_reference" | "source_scope";
  reference?: string;
}
export interface NumericParameterDefinition {
  key: string;
  label: string;
  unit: string;
  defaultValue: number | null;
  optional: boolean;
  min: number;
  max?: number;
  /** false permits exactly min; true requires a value greater than min. */
  exclusiveMin?: boolean;
  integer?: boolean;
  assumption: Assumption;
}
export interface NumericOverride { value: number | null; reason: string }
export interface Exclusion { reason: string; sectionEffect: string }

/** Parameter references point only to parameters in the owning package. No expression strings. */
export type QuantityRule =
  | { kind: "area"; length: string; width: string; sides?: string; unit: "SF" | "SY" }
  | { kind: "volume"; length: string; width: string; depth: string; sides?: string; unit: "CY" }
  | { kind: "asphalt_tons"; length: string; width: string; thickness: string; density: string; materialFactor: string; unit: "TON" }
  | { kind: "linear"; length: string; sides?: string; unit: "LF" }
  | { kind: "count"; count: string; unit: "EACH" }
  | { kind: "fixed"; value: number; unit: PlanningUnit }
  | { kind: "manual"; parameter: string; unit: PlanningUnit };

export interface ItemBinding {
  state: PlanningState;
  agencyId: "ne_ndot" | "co_cdot";
  agencyItemId: string;
  description: string;
  unit: PlanningUnit;
  provisional: true;
  scopeNote: string;
  /** An SY item with a fixed thickness cannot price a changed section. */
  fixedThickness?: { parameter: string; inches: number };
}
export interface ComponentDefinition {
  role: string;
  description: string;
  category: CostCategory;
  quantityRule: QuantityRule;
  binding: ItemBinding | null;
  required: boolean;
  tags: string[];
  assumptions: Assumption[];
}
export interface PackageDefinition {
  packageId: string;
  version: string;
  state: PlanningState;
  kind: PackageKind;
  name: string;
  status: "provisional";
  parameters: NumericParameterDefinition[];
  components: ComponentDefinition[];
  assumptions: Assumption[];
  exclusions: string[];
}
export interface PlanningSegment { segmentId: string; name: string }
export interface PackageInstance {
  instanceId: string;
  segmentId: string;
  /** Physical area identifier supplied by caller: roadway, sidewalk-left, separate path, etc. */
  scopeId: string;
  definition: PackageDefinition;
  parameterOverrides: Record<string, NumericOverride>;
  quantityOverrides: Record<string, NumericOverride>;
  rateOverrides: Record<string, NumericOverride>;
  exclusions: Record<string, Exclusion>;
  rateSnapshots: Record<string, RateSnapshot>;
}

export interface InflationBasis {
  method: "none" | "annual_window_nhcci" | "observation_quarter_nhcci";
  availability: "available" | "unavailable";
  targetPeriod: string | null;
  factor: number | null;
  reason: string | null;
}
export interface AnnualRateSnapshot {
  kind: "ne_annual";
  state: "NE";
  agencyItemId: string;
  unit: PlanningUnit;
  sourceUnit: string;
  sourceDescription: string;
  sourceId: string;
  summaryId: string;
  reportSeries: string;
  periodStart: string;
  periodEnd: string;
  sourceUrl: string;
  sourcePage: number | null;
  sourceLocator: string;
  rawRate: number;
  rate: number;
  inflation: InflationBasis;
  policyVersion: string;
  capturedAt: string;
}
export interface ContractLineContribution {
  observationId: string;
  contractItemId: string;
  sourceId: string;
  date: string;
  quantity: number;
  unit: string;
  rawRate: number;
  rate: number;
  inflationFactor: number | null;
  sourceLocator: string;
}
export interface ContractRateSnapshot {
  kind: "co_contract_median";
  state: "CO";
  agencyItemId: string;
  unit: PlanningUnit;
  requestedFrom: string;
  requestedTo: string;
  datasetAnchor: string;
  sourceTypes: string[];
  /** Explicit source filter requested by the user; empty means all cost-book sources. */
  requestedSourceIds: string[];
  /** Source IDs that actually contributed lines to the median. */
  sourceIds: string[];
  districts: string[];
  actualFrom: string;
  actualTo: string;
  contracts: { contractId: string; medianRate: number; lines: ContractLineContribution[] }[];
  excludedEvidence: { observationId: string; reason: string }[];
  rawRate: number;
  rate: number;
  limitedEvidence: boolean;
  inflation: InflationBasis;
  policyVersion: string;
  capturedAt: string;
}
export type RateSnapshot = AnnualRateSnapshot | ContractRateSnapshot;
export type RateBasis =
  | { kind: "manual"; value: number; reason: string; original: RateSnapshot | null }
  | RateSnapshot;

export interface CustomComponent {
  componentId: string;
  segmentId: string;
  scopeId: string;
  role: string;
  description: string;
  category: CostCategory;
  unit: PlanningUnit;
  quantity: number | null;
  unitRate: number | null;
  reason: string;
  required: boolean;
  tags: string[];
  exclusion: Exclusion | null;
}
export interface ScopeSubstitution {
  replacementComponentId: string;
  replacedComponentIds: string[];
  replacedAllowanceIds: string[];
  reason: string;
}
export interface CostComponent {
  componentId: string;
  instanceId: string | null;
  segmentId: string;
  scopeId: string;
  role: string;
  physicalScopeKey: string;
  description: string;
  category: CostCategory;
  required: boolean;
  tags: string[];
  unit: PlanningUnit;
  quantity: number | null;
  originalQuantity: number | null;
  quantityOverride: NumericOverride | null;
  formula: QuantityRule | null;
  formulaInputs: Record<string, number | null>;
  binding: ItemBinding | null;
  rate: number | null;
  rateBasis: RateBasis | null;
  extendedCost: number | null;
  status: ComponentStatus;
  exclusion: Exclusion | null;
  issues: PlanningIssue[];
}

/** Built-in subtotal nodes plus explicit component/allowance references form a directed graph. */
export type AllowanceBase =
  | { kind: "direct_construction" }
  | { kind: "construction_subtotal" }
  | { kind: "construction_with_contingency" }
  | { kind: "references"; componentIds: string[]; allowanceIds: string[] };
export interface AllowanceDefinition {
  allowanceId: string;
  role: "mobilization" | "traffic" | "drainage" | "minor_utilities" | "contingency" | "design" | "construction_engineering" | "custom";
  name: string;
  category: CostCategory;
  enabled: boolean;
  percent: number | null;
  base: AllowanceBase;
  /** Frozen initial basis; built-in defaults set it, later edits cannot replace it. */
  originalBasis?: { percent: number | null; base: AllowanceBase; enabled: boolean };
  assumption: Assumption;
  overrideReason: string | null;
  /** Detailed work on this tag requires a scoped explicit substitution or an overlap error. */
  overlapTags: string[];
  exclusion: Exclusion | null;
}
export interface AllowanceCost {
  allowanceId: string;
  role: AllowanceDefinition["role"];
  name: string;
  category: CostCategory;
  percent: number | null;
  baseAmount: number | null;
  amount: number | null;
  status: ComponentStatus;
  reason: string | null;
  issues: PlanningIssue[];
}
export interface ExternalScope {
  scopeId: "right_of_way" | "major_utilities";
  decision: "unassessed" | "none_assumed" | "manual";
  amount: number | null;
  reason: string;
}
export interface ScenarioReview {
  reviewer: string;
  date: string;
  notes: string;
  fingerprint: string;
}
export interface PlanningScenario {
  scenarioId: string;
  state: PlanningState;
  name: string;
  location: string;
  notes: string;
  segments: PlanningSegment[];
  packages: PackageInstance[];
  customComponents: CustomComponent[];
  substitutions: ScopeSubstitution[];
  allowances: AllowanceDefinition[];
  externalScopes: ExternalScope[];
  review: ScenarioReview | null;
  /** Copies preserve history as notes, but never resume original transfer operations. */
  history: string[];
  projectLink: { projectId: string; revision: number } | null;
  handoffIntent: { token: string; fingerprint: string; targetProjectId: string; status: "pending" | "complete" } | null;
  createdAt: string;
  updatedAt: string;
}
export interface PlanningWorkspace {
  schemaVersion: 1;
  workspaceId: string;
  state: PlanningState;
  name: string;
  revision: number;
  activeScenarioId: string | null;
  scenarios: PlanningScenario[];
  createdAt: string;
  updatedAt: string;
  lastBackupAt: string | null;
  lastBackupRevision: number | null;
}
export interface ScenarioCostResult {
  components: CostComponent[];
  allowances: AllowanceCost[];
  /** Sum known active priced construction components; null only for arithmetic overflow. */
  pricedDirectSubtotal: number | null;
  /** Complete D; null if any active required construction scope is unpriced. */
  directConstruction: number | null;
  constructionSubtotal: number | null;
  contingency: number | null;
  services: number | null;
  external: number | null;
  total: number | null;
  complete: boolean;
  missingComponentIds: string[];
  issues: PlanningIssue[];
}
export interface DuplicateScenarioIds {
  scenarioId: string;
  segmentIds: Record<string, string>;
  instanceIds: Record<string, string>;
  customComponentIds: Record<string, string>;
  allowanceIds: Record<string, string>;
}
export type ScenarioEdit =
  | { kind: "metadata"; name?: string; location?: string; notes?: string }
  | { kind: "set_segments"; segments: PlanningSegment[] }
  | { kind: "parameter"; instanceId: string; key: string; override: NumericOverride | null }
  | { kind: "quantity"; instanceId: string; role: string; override: NumericOverride | null }
  | { kind: "rate"; instanceId: string; role: string; override: NumericOverride | null }
  | { kind: "exclusion"; instanceId: string; role: string; exclusion: Exclusion | null }
  | { kind: "add_package"; instance: PackageInstance }
  | { kind: "remove_package"; instanceId: string; reason: string }
  | { kind: "set_custom"; component: CustomComponent }
  | { kind: "remove_custom"; componentId: string; reason: string }
  | { kind: "allowance"; allowance: AllowanceDefinition }
  | { kind: "external_scope"; scope: ExternalScope }
  | { kind: "substitutions"; substitutions: ScopeSubstitution[] }
  | { kind: "reprice"; instanceId: string; role: string; snapshot: RateSnapshot }
  | { kind: "update_package"; instanceId: string; definition: PackageDefinition; reason: string };
export interface ScenarioComparison {
  leftScenarioId: string;
  rightScenarioId: string;
  left: ScenarioCostResult;
  right: ScenarioCostResult;
  pricedDirectDifference: number | null;
  totalDifference: number | null;
  comparableCompleteTotals: boolean;
  changes: { path: string; before: unknown; after: unknown }[];
}
