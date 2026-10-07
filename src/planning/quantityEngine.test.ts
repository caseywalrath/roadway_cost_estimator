import { describe, expect, it } from "vitest";
import type { PackageDefinition, PackageInstance, PlanningScenario } from "./types";
import { evaluateQuantityRule, generateScenarioComponents, resolvePackageParameters } from "./quantityEngine";

const assumption = { id: "test", description: "Synthetic arithmetic fixture.", origin: "pilot_assumption" as const };
const param = (key: string, unit: string, value: number, min = 0, integer = false) => ({ key, label: key, unit, defaultValue: value, optional: false, min, integer, assumption });
function definition(): PackageDefinition {
  return {
    packageId: "synthetic", version: "1", state: "NE", kind: "reconstruction", name: "Synthetic", status: "provisional",
    parameters: [
      param("lengthMiles", "miles", 0.5, 0, false), param("widthFt", "ft", 24, 0, false),
      param("depthIn", "in", 15, 0, false), param("thicknessIn", "in", 9, 0, false),
      param("count", "count", 2, 0, true),
    ],
    components: [
      { role: "area", description: "Road area", category: "construction", quantityRule: { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding: null, required: true, tags: [], assumptions: [assumption] },
      { role: "asphalt", description: "Asphalt", category: "construction", quantityRule: { kind: "asphalt_tons", length: "lengthMiles", width: "widthFt", thickness: "thicknessIn", density: "density", materialFactor: "factor", unit: "TON" }, binding: null, required: true, tags: [], assumptions: [assumption] },
      { role: "excavation", description: "Section excavation", category: "construction", quantityRule: { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "depthIn", unit: "CY" }, binding: null, required: true, tags: [], assumptions: [assumption] },
      { role: "manual", description: "Manual LS", category: "construction", quantityRule: { kind: "fixed", value: 1, unit: "LS" }, binding: null, required: false, tags: [], assumptions: [assumption] },
    ],
    assumptions: [assumption], exclusions: [],
  };
}
function instance(overrides: PackageInstance["parameterOverrides"] = {}, scopeId = "roadway"): PackageInstance {
  return { instanceId: "p1", segmentId: "s1", scopeId, definition: definition(), parameterOverrides: overrides, quantityOverrides: {}, rateOverrides: {}, exclusions: {}, rateSnapshots: {} };
}
function scenario(packages: PackageInstance[]): PlanningScenario {
  return { scenarioId: "scenario", state: "NE", name: "Synthetic", location: "", notes: "", segments: [{ segmentId: "s1", name: "Segment" }], packages, customComponents: [], substitutions: [], allowances: [], externalScopes: [], review: null, history: [], projectLink: null, handoffIntent: null, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" };
}

describe("quantity rules and package parameters", () => {
  it("preserves each target reason when one replacement has multiple substitution records", () => {
    const source = scenario([]);
    source.customComponents = ["a", "b", "c"].map((id) => ({
      componentId: id, segmentId: "s1", scopeId: id, role: "scope", description: `Synthetic ${id}`,
      category: "construction", unit: "LS", quantity: 1, unitRate: 10, reason: "Synthetic fixture",
      required: true, tags: [], exclusion: null,
    }));
    source.substitutions = [
      { replacementComponentId: "c", replacedComponentIds: ["a"], replacedAllowanceIds: [], reason: "Reason for A" },
      { replacementComponentId: "c", replacedComponentIds: ["b"], replacedAllowanceIds: [], reason: "Reason for B" },
    ];
    const rows = generateScenarioComponents(source);
    expect(rows.find((row) => row.componentId === "a")?.exclusion?.reason).toBe("Reason for A");
    expect(rows.find((row) => row.componentId === "b")?.exclusion?.reason).toBe("Reason for B");
    expect(rows.find((row) => row.componentId === "c")?.status).toBe("priced");
  });
  it("matches independent roadway, asphalt, and excavation reference quantities", () => {
    const formulaParameters = { lengthMiles: 0.5, widthFt: 24, depthIn: 15, thicknessIn: 2, density: 145, factor: 1.05 };
    expect(evaluateQuantityRule({ kind: "area", length: "lengthMiles", width: "widthFt", unit: "SF" }, formulaParameters)).toMatchObject({ ok: true, value: 63_360 });
    expect(evaluateQuantityRule({ kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, formulaParameters)).toMatchObject({ ok: true, value: 7_040 });
    expect(evaluateQuantityRule({ kind: "surface_application", length: "lengthMiles", width: "widthFt", applicationRate: "tackRate", unit: "GAL" }, { ...formulaParameters, tackRate: 0.1 })).toMatchObject({ ok: true, value: 704 });
    const asphalt = evaluateQuantityRule({ kind: "asphalt_tons", length: "lengthMiles", width: "widthFt", thickness: "thicknessIn", density: "density", materialFactor: "factor", unit: "TON" }, formulaParameters);
    expect(asphalt.ok).toBe(true);
    if (asphalt.ok) expect(asphalt.value).toBeCloseTo(803.88, 10);
    expect(evaluateQuantityRule({ kind: "volume", length: "lengthMiles", width: "widthFt", depth: "depthIn", unit: "CY" }, formulaParameters)).toMatchObject({ ok: true, value: 2_933.3333333333335 });
  });

  it("retains null drafts and rejects bounds, integers, and missing parameters", () => {
    const pkg = instance({ lengthMiles: { value: null, reason: "blanked for review" } });
    const resolved = resolvePackageParameters(pkg);
    expect(resolved.ok).toBe(false);
    expect(resolved.issues.map((entry) => entry.code)).toContain("missing_parameter");
    expect(resolvePackageParameters(instance({ count: { value: 1.5, reason: "invalid draft" } })).issues.map((entry) => entry.code)).toContain("integer_required");
    expect(evaluateQuantityRule({ kind: "area", length: "missing", width: "widthFt", unit: "SY" }, { widthFt: 24 })).toMatchObject({ ok: false, issues: [{ code: "missing_parameter" }] });
    expect(evaluateQuantityRule({ kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, { lengthMiles: Number.NaN, widthFt: 24 })).toMatchObject({ ok: false, issues: [{ code: "invalid_number" }] });
  });

  it("keeps valid manual zero priced, permits manual pricing without a binding, and warns on fixed-thickness mismatch", () => {
    const pkg = definition();
    pkg.components = [{ ...pkg.components[0], role: "pavement", quantityRule: { kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, binding: { state: "NE", agencyId: "ne_ndot", agencyItemId: "ne_ndot_example", description: "Fixed nine inch item", unit: "SY", provisional: true, scopeNote: "synthetic", fixedThickness: { parameter: "thicknessIn", inches: 9 } } }];
    const item = { ...instance(), definition: pkg, parameterOverrides: { thicknessIn: { value: 10, reason: "section changed" } }, rateOverrides: { pavement: { value: 0, reason: "explicit no-cost rate" } } };
    const components = generateScenarioComponents(scenario([item]));
    expect(components[0]).toMatchObject({ quantity: 7_040, rate: 0, extendedCost: 0, status: "priced", rateBasis: { kind: "manual", value: 0 } });
    expect(components[0].issues.find((entry) => entry.code === "binding_thickness_mismatch")?.severity).toBe("warning");
  });

  it("keeps missing rates visible and flags physical-scope collisions on both components", () => {
    const one = instance();
    const two = { ...instance(), instanceId: "p2" };
    const result = generateScenarioComponents(scenario([one, two]));
    const duplicatedSurface = result.filter((component) => component.role === "area");
    expect(duplicatedSurface).toHaveLength(2);
    expect(duplicatedSurface.every((component) => component.status === "unpriced" && component.issues.some((entry) => entry.code === "scope_overlap"))).toBe(true);
    expect(result.some((component) => component.role === "manual" && component.issues.some((entry) => entry.code === "missing_rate"))).toBe(true);
  });

  it("retains the engineer exclusion reason and does not invent an excluded quantity cost", () => {
    const pkg = definition();
    pkg.components = [pkg.components[3]];
    const item = { ...instance(), definition: pkg, exclusions: { manual: { reason: "not in contract", sectionEffect: "no tack work" } } };
    expect(generateScenarioComponents(scenario([item]))[0]).toMatchObject({ status: "excluded", exclusion: { reason: "not in contract", sectionEffect: "no tack work" }, extendedCost: null });
  });

  it("keeps both sides of circular substitutions active and visibly unpriced", () => {
    const pkg = definition();
    pkg.components = [
      { ...pkg.components[3], role: "a", binding: null },
      { ...pkg.components[3], role: "b", binding: null },
    ];
    const item = {
      ...instance(), definition: pkg,
      rateOverrides: { a: { value: 2, reason: "synthetic rate" }, b: { value: 3, reason: "synthetic rate" } },
    };
    const source = scenario([item]);
    source.substitutions = [
      { replacementComponentId: "p1/a", replacedComponentIds: ["p1/b"], replacedAllowanceIds: [], reason: "A replaces B" },
      { replacementComponentId: "p1/b", replacedComponentIds: ["p1/a"], replacedAllowanceIds: [], reason: "B replaces A" },
    ];
    const rows = generateScenarioComponents(source);
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.status === "unpriced" && row.exclusion === null && row.issues.some((entry) => entry.code === "scope_overlap"))).toBe(true);
  });

  it("keeps component and allowance references in separate ID namespaces", () => {
    const pkg = definition();
    pkg.components = [{ ...pkg.components[3], role: "drainage", binding: null }];
    const item = { ...instance(), definition: pkg, rateOverrides: { drainage: { value: 0, reason: "manual zero" } } };
    const source = scenario([item]);
    source.allowances = [{
      allowanceId: "drainage", role: "drainage", name: "Drainage", category: "construction", enabled: true, percent: 20,
      base: { kind: "direct_construction" }, assumption, overrideReason: null, overlapTags: ["drainage"], exclusion: null,
    }];
    source.substitutions = [{ replacementComponentId: "p1/drainage", replacedComponentIds: [], replacedAllowanceIds: ["drainage"], reason: "Component scope replaces percentage allowance." }];
    const result = generateScenarioComponents(source);
    expect(result[0]).toMatchObject({ status: "priced", rate: 0, extendedCost: 0 });
    expect(result[0].issues.some((entry) => entry.code === "scope_overlap")).toBe(false);
  });
});
