import type {
  Assumption,
  ComponentDefinition,
  NumericParameterDefinition,
  PackageDefinition,
  QuantityRule,
} from "../types";

const pilot = (id: string, description: string): Assumption => ({ id, description, origin: "pilot_assumption" });

const parameter = (
  key: string,
  label: string,
  unit: string,
  defaultValue: number,
  min: number,
  options: { max?: number; integer?: boolean; exclusiveMin?: boolean } = {},
): NumericParameterDefinition => ({
  key,
  label,
  unit,
  defaultValue,
  optional: false,
  min,
  ...options,
  assumption: pilot(`co-${key}`, `Provisional Colorado pilot default for ${label}; confirm project-specific design and measured quantity before use.`),
});

const binding = (
  agencyItemId: string,
  description: string,
  unit: "SY" | "CY" | "TON" | "LF",
  scopeNote: string,
  fixedThickness?: { parameter: string; inches: number },
) => ({
  state: "CO" as const,
  agencyId: "co_cdot" as const,
  agencyItemId,
  description,
  unit,
  provisional: true as const,
  scopeNote,
  ...(fixedThickness ? { fixedThickness } : {}),
});

const component = (
  role: string,
  description: string,
  quantityRule: QuantityRule,
  item: ReturnType<typeof binding> | null,
  options: { required?: boolean; tags?: string[]; assumption?: string } = {},
): ComponentDefinition => ({
  role,
  description,
  category: "construction",
  quantityRule,
  binding: item,
  required: options.required ?? true,
  tags: options.tags ?? [],
  assumptions: [pilot(`co-${role}`, options.assumption ?? `${description} is a provisional scope proxy. Verify plan limits, specification, and bid-item suitability.`)],
});

const roadwayParameters = () => [
  parameter("lengthMiles", "Segment length", "miles", 0.5, 0, { exclusiveMin: true }),
  parameter("widthFt", "Roadway width", "ft", 24, 0, { exclusiveMin: true }),
  parameter("sides", "Number of sides", "count", 2, 1, { max: 2, integer: true }),
];
const asphaltParameters = () => [
  ...roadwayParameters(),
  parameter("thicknessIn", "Asphalt thickness", "in", 2, 0, { exclusiveMin: true }),
  parameter("millingDepthIn", "Milling depth", "in", 2, 0, { exclusiveMin: true }),
  parameter("densityLbCf", "Asphalt density", "lb/ft³", 145, 0, { exclusiveMin: true }),
  parameter("materialFactor", "Asphalt material factor", "factor", 1.05, 1),
];
const pathParameters = () => [
  parameter("lengthMiles", "Path length", "miles", 0.5, 0, { exclusiveMin: true }),
  parameter("widthFt", "Path width", "ft", 10, 0, { exclusiveMin: true }),
  parameter("thicknessIn", "Concrete bikeway thickness", "in", 6, 0, { exclusiveMin: true }),
  parameter("baseDepthIn", "Base depth", "in", 6, 0, { exclusiveMin: true }),
  parameter("excavationDepthIn", "Excavation depth", "in", 12, 0, { exclusiveMin: true }),
];
const sidewalkParameters = () => [
  parameter("lengthMiles", "Sidewalk length", "miles", 0.5, 0, { exclusiveMin: true }),
  parameter("widthFt", "Sidewalk width", "ft", 5, 0, { exclusiveMin: true }),
  parameter("sides", "Number of sides", "count", 2, 1, { max: 2, integer: true }),
  parameter("thicknessIn", "Concrete sidewalk thickness", "in", 6, 0, { exclusiveMin: true }),
];

const coAssumptions = [
  pilot("co-geometry", "Length and width are pilot geometry defaults, not surveyed quantities or design recommendations."),
  pilot("co-rates", "Rates are not included in the recipe. Colorado contract-median rates require a separate explicit frozen snapshot."),
];
const exclusions = [
  "Deep pavement repair, widening, mass grading, bridges, retaining walls, lighting, and right-of-way are not included.",
  "Concrete path and sidewalk item sections are provisional proxies; verify joints, reinforcement, curb ramps, and project specifications.",
  "No rate is inferred from item identity, statewide averages, or a different bid-price type.",
];

const make = (
  packageId: string,
  kind: PackageDefinition["kind"],
  name: string,
  parameters: NumericParameterDefinition[],
  components: ComponentDefinition[],
): PackageDefinition => ({
  packageId,
  version: "pilot-1",
  state: "CO",
  kind,
  name,
  status: "provisional",
  parameters,
  components,
  assumptions: coAssumptions.map((assumption) => ({ ...assumption })),
  exclusions: [...exclusions],
});

export const COLORADO_PILOT_PACKAGES: readonly PackageDefinition[] = [
  make("co-resurfacing", "resurfacing", "Colorado Asphalt Resurfacing", asphaltParameters(), [
    component("milling", "Removal of asphalt mat (planing)", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("co_cdot_202-00240", "Removal of Asphalt Mat (Planing)", "SY", "Exact CDOT item; milling area proxy does not encode variable milling depth.")),
    component("asphalt", "Hot mix asphalt, grading SX (75), PG 64-22", { kind: "asphalt_tons", length: "lengthMiles", width: "widthFt", thickness: "thicknessIn", density: "densityLbCf", materialFactor: "materialFactor", unit: "TON" }, binding("co_cdot_403-34741", "Hot Mix Asphalt (Grading SX) (75) (PG 64-22)", "TON", "Exact CDOT item; mixture, lift design, and placed section require project review."), { tags: ["surface"] }),
    component("tack", "Tack coat", { kind: "fixed", value: 1, unit: "LS" }, null, { assumption: "Required one-lump-sum manual scope; no exact pilot item binding or percentage rate is assumed." }),
  ]),
  make("co-reconstruction", "reconstruction", "Colorado Concrete Reconstruction", [
    ...roadwayParameters(),
    parameter("baseDepthIn", "Base depth", "in", 6, 0, { exclusiveMin: true }),
    parameter("excavationDepthIn", "Excavation depth", "in", 15, 0, { exclusiveMin: true }),
    parameter("thicknessIn", "Concrete pavement thickness", "in", 9, 0, { exclusiveMin: true }),
  ], [
    component("pavement", "Concrete pavement (9 inch)", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("co_cdot_412-00900", "Concrete Pavement (9 Inch)", "SY", "Exact 9-inch CDOT item; title does not establish project-specific joint, dowel, or reinforcement scope; quantity is roadway surface area.", { parameter: "thicknessIn", inches: 9 }), { tags: ["surface"] }),
    component("base", "Aggregate base course (Class 6)", { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "baseDepthIn", unit: "CY" }, binding("co_cdot_304-06007", "Aggregate Base Course (Class 6)", "CY", "Exact CDOT volume item; 6-inch pilot base quantity is volume.")),
    component("excavation", "Unclassified excavation", { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "excavationDepthIn", unit: "CY" }, binding("co_cdot_203-00000", "Unclassified Excavation", "CY", "Exact CDOT excavation item; excludes unmodeled mass grading and unsuitable-material handling.")),
    component("curb_gutter", "Curb and gutter Type 2, Section I-B", { kind: "linear", length: "lengthMiles", sides: "sides", unit: "LF" }, binding("co_cdot_609-21010", "Curb and Gutter Type 2 (Section I-B)", "LF", "Exact CDOT item; default quantity assumes curb on both sides.")),
    component("removal", "Existing pavement removal", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, null, { assumption: "Required roadway-area removal scope remains manually priced until an exact suitable binding is selected." }),
  ]),
  make("co-path", "path", "Colorado Concrete Bikeway", pathParameters(), [
    component("pavement", "Concrete bikeway (6 inch)", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("co_cdot_608-00026", "Concrete Bikeway (6 Inch)", "SY", "Exact 6-inch CDOT item; pilot proxy for path surface; verify joints and reinforcement.", { parameter: "thicknessIn", inches: 6 }), { tags: ["surface"] }),
    component("base", "Aggregate base course (Class 6)", { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "baseDepthIn", unit: "CY" }, binding("co_cdot_304-06007", "Aggregate Base Course (Class 6)", "CY", "Exact CDOT volume item; 6-inch pilot base quantity is volume.")),
    component("excavation", "Path unclassified excavation", { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "excavationDepthIn", unit: "CY" }, binding("co_cdot_203-00000", "Unclassified Excavation", "CY", "Exact CDOT excavation item; path section default excludes unrelated bulk grading.")),
  ]),
  make("co-sidewalk", "sidewalk", "Colorado Concrete Sidewalk", sidewalkParameters(), [
    component("pavement", "Concrete sidewalk (6 inch)", { kind: "area", length: "lengthMiles", width: "widthFt", sides: "sides", unit: "SY" }, binding("co_cdot_608-00006", "Concrete Sidewalk (6 Inch)", "SY", "Exact 6-inch CDOT item; width is per side and area is multiplied by sides.", { parameter: "thicknessIn", inches: 6 }), { tags: ["surface"] }),
    component("ramps_crossings", "Sidewalk ramps and crossings", { kind: "fixed", value: 1, unit: "LS" }, null, { assumption: "Required one-lump-sum manual/unpriced scope. Counted ramps and driveways need explicit custom work or a reasoned exclusion." }),
  ]),
];
