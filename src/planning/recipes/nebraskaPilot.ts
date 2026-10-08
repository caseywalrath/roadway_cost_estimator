import type {
  Assumption,
  ComponentDefinition,
  NumericParameterDefinition,
  PackageDefinition,
  QuantityRule,
} from "../types";

const pilot = (id: string, description: string, reference?: string): Assumption => ({
  id,
  description,
  origin: reference ? "workbook_reference" : "pilot_assumption",
  ...(reference ? { reference } : {}),
});

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
  assumption: pilot(
    `ne-${key}`,
    `Provisional Nebraska pilot default for ${label}; confirm project-specific design and measured quantity before use.`,
  ),
});

const binding = (
  agencyItemId: string,
  description: string,
  unit: "SY" | "CY" | "TON" | "LF" | "GAL",
  scopeNote: string,
  fixedThickness?: { parameter: string; inches: number },
) => ({
  state: "NE" as const,
  agencyId: "ne_ndot" as const,
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
  assumptions: [pilot(`ne-${role}`, options.assumption ?? `${description} is a provisional scope proxy. Verify plan limits, specification, and bid-item suitability.`)],
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
  parameter("tackRateGalSy", "Tack application rate", "GAL/SY", 0.1, 0, { max: 0.5, exclusiveMin: true }),
];
const pathParameters = () => [
  parameter("lengthMiles", "Path length", "miles", 0.5, 0, { exclusiveMin: true }),
  parameter("widthFt", "Path width", "ft", 10, 0, { exclusiveMin: true }),
  parameter("thicknessIn", "Concrete bikeway thickness", "in", 5, 0, { exclusiveMin: true }),
  parameter("baseDepthIn", "Base depth", "in", 6, 0, { exclusiveMin: true }),
  parameter("excavationDepthIn", "Excavation depth", "in", 11, 0, { exclusiveMin: true }),
];
const sidewalkParameters = () => [
  parameter("lengthMiles", "Sidewalk length", "miles", 0.5, 0, { exclusiveMin: true }),
  parameter("widthFt", "Sidewalk width", "ft", 5, 0, { exclusiveMin: true }),
  parameter("sides", "Number of sides", "count", 2, 1, { max: 2, integer: true }),
  parameter("thicknessIn", "Concrete sidewalk thickness", "in", 5, 0, { exclusiveMin: true }),
  parameter("rampCount", "Curb ramps", "count", 4, 0, { max: 200, integer: true }),
];

const neAssumptions = [
  pilot("ne-geometry", "Length and width are pilot geometry defaults, not surveyed quantities or design recommendations."),
  pilot("ne-rates", "Rates are not included in the recipe. Nebraska annual report rates require a separate explicit frozen snapshot."),
];
const exclusions = [
  "Deep pavement repair, widening, mass grading, bridges, retaining walls, lighting, and right-of-way are not included.",
  "The bikeway item is a provisional item proxy; confirm concrete section, reinforcement, joints, and project specification.",
  "No rates are inferred from item identity or historical catalog status.",
];

const make = (
  packageId: string,
  kind: PackageDefinition["kind"],
  name: string,
  parameters: NumericParameterDefinition[],
  components: ComponentDefinition[],
): PackageDefinition => ({
  packageId,
  version: kind === "path" ? "pilot-1" : "pilot-2",
  state: "NE",
  kind,
  name,
  status: "provisional",
  parameters,
  components,
  assumptions: neAssumptions.map((assumption) => ({ ...assumption })),
  exclusions: [...exclusions],
});

export const NEBRASKA_PILOT_PACKAGES: readonly PackageDefinition[] = [
  make("ne-resurfacing", "resurfacing", "Nebraska Asphalt Resurfacing", asphaltParameters(), [
    component("milling", "Milling for asphaltic concrete inlay", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("ne_ndot_9179.79", "MILLING FOR ASPHALTIC CONCRETE INLAY", "SY", "Exact NDOT item; milling area proxy does not encode variable milling depth.")),
    component("asphalt", "Asphaltic concrete, Type SPS", { kind: "asphalt_tons", length: "lengthMiles", width: "widthFt", thickness: "thicknessIn", density: "densityLbCf", materialFactor: "materialFactor", unit: "TON" }, binding("ne_ndot_9005.23", "ASPHALTIC CONCRETE, TYPE SPS", "TON", "Exact NDOT item; mixture suitability and placed section require project review."), { tags: ["surface"] }),
    component("tack", "Tack coat", { kind: "surface_application", length: "lengthMiles", width: "widthFt", applicationRate: "tackRateGalSy", unit: "GAL" }, binding("ne_ndot_9053.00", "TACK COAT", "GAL", "NDOT published annual price; 0.10 GAL/SY pilot application on a milled surface. Joint-edge double application and surface-condition changes are excluded."), { assumption: "Tack quantity uses roadway area at 0.10 GAL/SY, the low end of NDOT's 0.10–0.20 GAL/SY range for milled surfaces. Confirm surface and application rate." }),
  ]),
  make("ne-reconstruction", "reconstruction", "Nebraska Concrete Reconstruction", [
    ...roadwayParameters(),
    parameter("baseDepthIn", "Base depth", "in", 6, 0, { exclusiveMin: true }),
    parameter("excavationDepthIn", "Excavation depth", "in", 15, 0, { exclusiveMin: true }),
    parameter("thicknessIn", "Concrete pavement thickness", "in", 9, 0, { exclusiveMin: true }),
  ], [
    component("pavement", "9 inch doweled concrete pavement, Class 47B-3500", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("ne_ndot_3075.46", "9\" DOWELED CONCRETE PAVEMENT, CLASS 47B-3500", "SY", "Exact 9-inch NDOT item; its title identifies doweled pavement but does not define all joint, reinforcement, or project-specific scope.", { parameter: "thicknessIn", inches: 9 }), { tags: ["surface"] }),
    component("base", "Crushed rock base course 6 inch", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("ne_ndot_8011.06", "CRUSHED ROCK BASE COURSE 6\"", "SY", "Exact 6-inch NDOT item; quantity is roadway area, not a variable-depth volume.", { parameter: "baseDepthIn", inches: 6 })),
    component("excavation", "Excavation", { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "excavationDepthIn", unit: "CY" }, binding("ne_ndot_1010.00", "EXCAVATION", "CY", "Exact NDOT excavation item; excludes unmodeled mass grading and unsuitable-material handling.")),
    component("curb_gutter", "Combination concrete curb and gutter", { kind: "linear", length: "lengthMiles", sides: "sides", unit: "LF" }, binding("ne_ndot_3014.11", "COMBINATION CONCRETE CLASS 47B-3500 CURB AND GUTTER", "LF", "Exact NDOT item; default quantity assumes curb on both sides.")),
    component("removal", "Existing pavement removal", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("ne_ndot_1101.00", "REMOVE PAVEMENT", "SY", "Exact NDOT remove-pavement item; roadway surface area proxy. Base/unsuitable-material removal and mass grading are excluded.")),
  ]),
  make("ne-path", "path", "Nebraska Concrete Bikeway", pathParameters(), [
    component("pavement", "5 inch concrete bikeway, Class 47B-3500", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("ne_ndot_3016.65", "5\" CONCRETE CLASS 47B-3500 BIKEWAY", "SY", "Historical annual-report identity retained as an exact published-price binding; historical status does not imply obsolescence.", { parameter: "thicknessIn", inches: 5 }), { tags: ["surface"], assumption: "NDOT bikeway item is a provisional path proxy. Confirm current specification, joints, and reinforcement." }),
    component("base", "Crushed rock base course 6 inch", { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding("ne_ndot_8011.06", "CRUSHED ROCK BASE COURSE 6\"", "SY", "Historical annual-report identity retained as an exact published-price binding; quantity is area for a fixed 6-inch course.", { parameter: "baseDepthIn", inches: 6 })),
    component("excavation", "Path excavation", { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "excavationDepthIn", unit: "CY" }, binding("ne_ndot_1010.00", "EXCAVATION", "CY", "Exact NDOT excavation item; path section default excludes unrelated bulk grading.")),
  ]),
  make("ne-sidewalk", "sidewalk", "Nebraska Concrete Sidewalk", sidewalkParameters(), [
    component("pavement", "5 inch concrete sidewalk", { kind: "area", length: "lengthMiles", width: "widthFt", sides: "sides", unit: "SY" }, binding("ne_ndot_3016.03", "CONCRETE CLASS 47B-3000 SIDEWALK 5\"", "SY", "Exact 5-inch NDOT sidewalk item; width is per side and area is multiplied by sides.", { parameter: "thicknessIn", inches: 5 }), { tags: ["surface"] }),
    component("ramps_crossings", "Curb ramps", { kind: "count", count: "rampCount", unit: "EACH" }, null, { assumption: "Four provisional curb ramps assume two project ends on two sidewalk sides. Each uses an 80 SF assembly proxy; intermediate intersections, driveway crossings, removals and utility adjustments are excluded." }),
  ]),
  make("ne-curb-gutter", "curb_gutter", "Nebraska Curb and Gutter", [
    parameter("lengthMiles", "Curb length", "miles", 0.5, 0, { exclusiveMin: true }),
    parameter("sides", "Curb sides", "count", 2, 1, { max: 2, integer: true }),
  ], [
    component("curb_gutter", "Combination concrete curb and gutter", { kind: "linear", length: "lengthMiles", sides: "sides", unit: "LF" }, binding("ne_ndot_3014.11", "COMBINATION CONCRETE CLASS 47B-3500 CURB AND GUTTER", "LF", "Exact NDOT item for new curb and gutter; assumes a continuous run on the selected sides."), { assumption: "Existing curb removal, driveway returns, drainage connections, and interrupted runs are excluded and require engineer review." }),
  ]),
];
