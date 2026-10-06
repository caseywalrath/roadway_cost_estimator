import { describe, expect, it } from "vitest";
import reference from "./fixtures/referenceCases.json";
import { NEBRASKA_PILOT_PACKAGES } from "./recipes/nebraskaPilot";
import { COLORADO_PILOT_PACKAGES } from "./recipes/coloradoPilot";
import { createPackageInstance, createPlanningScenario, editPlanningScenario } from "./planningWorkspace";
import { generateScenarioComponents } from "./quantityEngine";
import { calculateScenarioCosts } from "./costEngine";
import type { PackageDefinition, PlanningResult, PlanningScenario } from "./types";

const now = "2026-10-06T12:00:00.000Z";
function value<T>(result: PlanningResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
function withPackage(definition: PackageDefinition): PlanningScenario {
  let scenario = value(createPlanningScenario({ scenarioId: "scenario", state: definition.state, name: "Reference", now }));
  scenario = value(editPlanningScenario(scenario, { kind: "set_segments", segments: [{ segmentId: "corridor", name: "Corridor" }] }, now));
  const instance = value(createPackageInstance({ instanceId: "package", segmentId: "corridor", scopeId: "surface", definition }));
  return value(editPlanningScenario(scenario, { kind: "add_package", instance }, now));
}
function recipe(definitions: readonly PackageDefinition[], kind: PackageDefinition["kind"]): PackageDefinition {
  const definition = definitions.find((entry) => entry.kind === kind);
  if (!definition) throw new Error(`Missing ${kind} recipe`);
  return definition;
}
function quantity(scenario: PlanningScenario, role: string): number | null | undefined {
  return generateScenarioComponents(scenario).find((component) => component.role === role)?.quantity;
}

describe("Planning core integrated reference cases", () => {
  it.each([[NEBRASKA_PILOT_PACKAGES], [COLORADO_PILOT_PACKAGES]])("keeps resurfacing quantities independent of the source state", (definitions) => {
    const scenario = withPackage(recipe(definitions, "resurfacing"));
    expect(quantity(scenario, "milling")).toBeCloseTo(reference.roadway.areaSquareYards, 8);
    expect(quantity(scenario, "asphalt")).toBeCloseTo(reference.roadway.asphaltTons, 8);
    expect(quantity(scenario, "tack")).toBe(1);
    const doubled = value(editPlanningScenario(scenario, { kind: "parameter", instanceId: "package", key: "lengthMiles", override: { value: 1, reason: "Longer corridor" } }, now));
    expect(quantity(doubled, "asphalt")).toBeCloseTo(1607.76, 8);
    expect(quantity(doubled, "tack")).toBe(1);
  });

  it("uses separate state base units and path sections", () => {
    const ne = withPackage(recipe(NEBRASKA_PILOT_PACKAGES, "path"));
    const co = withPackage(recipe(COLORADO_PILOT_PACKAGES, "path"));
    expect(quantity(ne, "pavement")).toBeCloseTo(reference.path.areaSquareYards, 8);
    expect(quantity(co, "pavement")).toBeCloseTo(reference.path.areaSquareYards, 8);
    expect(quantity(ne, "base")).toBeCloseTo(reference.path.areaSquareYards, 8);
    expect(quantity(co, "base")).toBeCloseTo(reference.path.baseCubicYards, 8);
    expect(quantity(ne, "excavation")).toBeCloseTo(reference.path.neExcavationCubicYards, 8);
    expect(quantity(co, "excavation")).toBeCloseTo(reference.path.coExcavationCubicYards, 8);
    expect(generateScenarioComponents(ne).find((component) => component.role === "base")?.unit).toBe("SY");
    expect(generateScenarioComponents(co).find((component) => component.role === "base")?.unit).toBe("CY");
  });

  it.each([[NEBRASKA_PILOT_PACKAGES], [COLORADO_PILOT_PACKAGES]])("produces reconstruction and sidewalk reference quantities", (definitions) => {
    const road = withPackage(recipe(definitions, "reconstruction"));
    expect(quantity(road, "pavement")).toBeCloseTo(reference.roadway.areaSquareYards, 8);
    expect(quantity(road, "removal")).toBeCloseTo(reference.roadway.areaSquareYards, 8);
    expect(quantity(road, "excavation")).toBeCloseTo(reference.roadway.excavationCubicYards, 8);
    expect(quantity(road, "curb_gutter")).toBe(reference.roadway.curbBothSidesFeet);
    const sidewalk = withPackage(recipe(definitions, "sidewalk"));
    expect(quantity(sidewalk, "pavement")).toBeCloseTo(reference.sidewalk.areaSquareYards, 8);
  });

  it("matches independently calculated allowances and preserves full precision", () => {
    let scenario = value(createPlanningScenario({ scenarioId: "cost-reference", state: "CO", name: "Cost reference", now }));
    scenario = value(editPlanningScenario(scenario, { kind: "set_segments", segments: [{ segmentId: "corridor", name: "Corridor" }] }, now));
    scenario = value(editPlanningScenario(scenario, { kind: "set_custom", component: {
      componentId: "construction", segmentId: "corridor", scopeId: "manual", role: "direct", description: "Synthetic reference amount",
      category: "construction", unit: "LS", quantity: 1, unitRate: 100000, reason: "Independent arithmetic fixture",
      required: true, tags: [], exclusion: null
    } }, now));
    for (const scopeId of ["right_of_way", "major_utilities"] as const) {
      scenario = value(editPlanningScenario(scenario, { kind: "external_scope", scope: { scopeId, decision: "none_assumed", amount: null, reason: "Synthetic fixture excludes external scope" } }, now));
    }
    const result = calculateScenarioCosts(scenario);
    expect(result.complete).toBe(true);
    expect(result.directConstruction).toBe(reference.allowances.directConstruction);
    expect(result.constructionSubtotal).toBe(reference.allowances.constructionSubtotal);
    expect(result.contingency).toBe(reference.allowances.contingency);
    expect(result.services).toBe(28250);
    expect(result.total).toBe(reference.allowances.totalProjectCost);
    for (const [category, amount] of [["service", 5000], ["external", 10000]] as const) {
      scenario = value(editPlanningScenario(scenario, { kind: "set_custom", component: {
        componentId: category, segmentId: "corridor", scopeId: category, role: category, description: `Manual ${category} scope`,
        category, unit: "LS", quantity: 1, unitRate: amount, reason: "Independent category reconciliation fixture",
        required: true, tags: [], exclusion: null
      } }, now));
    }
    const withOtherCosts = calculateScenarioCosts(scenario);
    expect(withOtherCosts.complete).toBe(true);
    expect(withOtherCosts.directConstruction).toBe(100000);
    expect(withOtherCosts.services).toBe(33250);
    expect(withOtherCosts.external).toBe(10000);
    expect(withOtherCosts.total).toBe(184500);
  });

  it("keeps missing scope incomplete instead of estimating a complete zero-cost project", () => {
    const scenario = withPackage(recipe(COLORADO_PILOT_PACKAGES, "resurfacing"));
    const result = calculateScenarioCosts(scenario);
    expect(result.complete).toBe(false);
    expect(result.total).toBeNull();
    expect(result.pricedDirectSubtotal).toBe(0);
    expect(result.components.find((component) => component.role === "tack")?.status).toBe("unpriced");
    expect(result.missingComponentIds).toContain("right_of_way");
    expect(result.missingComponentIds).toContain("major_utilities");
  });
});
