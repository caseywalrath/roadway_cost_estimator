import { describe, expect, it } from "vitest";
import { COLORADO_PILOT_PACKAGES } from "./recipes/coloradoPilot";
import { validatePackageDefinition, validatePlanningScenario } from "./validateRecipes";
import type { AllowanceDefinition, PackageInstance, PlanningScenario } from "./types";

const externalScopes: PlanningScenario["externalScopes"] = [
  { scopeId: "right_of_way", decision: "unassessed", amount: null, reason: "" },
  { scopeId: "major_utilities", decision: "unassessed", amount: null, reason: "" },
];
function scenario(patches: Partial<PlanningScenario> = {}): PlanningScenario {
  return {
    scenarioId: "scenario-1", state: "CO", name: "Validation fixture", location: "", notes: "",
    segments: [{ segmentId: "segment-1", name: "Mainline" }], packages: [], customComponents: [], substitutions: [], allowances: [],
    externalScopes: structuredClone(externalScopes), review: null, history: [], projectLink: null, handoffIntent: null,
    createdAt: "2026-10-06T00:00:00.000Z", updatedAt: "2026-10-06T00:00:00.000Z", ...patches,
  };
}
function instance(instanceId: string, scopeId = "roadway"): PackageInstance {
  return {
    instanceId, segmentId: "segment-1", scopeId,
    definition: structuredClone(COLORADO_PILOT_PACKAGES.find((entry) => entry.kind === "path")!),
    parameterOverrides: {}, quantityOverrides: {}, rateOverrides: {}, exclusions: {}, rateSnapshots: {},
  };
}
function allowance(allowanceId: string, base: AllowanceDefinition["base"]): AllowanceDefinition {
  return {
    allowanceId, role: "custom", name: allowanceId, category: "construction", enabled: true, percent: 0,
    base, assumption: { id: "fixture", description: "Validation fixture", origin: "pilot_assumption" },
    overrideReason: null, overlapTags: [], exclusion: null,
  };
}
const hasCode = (issues: { code: string }[], code: string) => issues.some((entry) => entry.code === code);

describe("planning recipe and scenario structural validation", () => {
  it("checks parameter override names, numeric bounds, integer rules, and reasons", () => {
    const source = instance("one");
    source.parameterOverrides = {
      unknown: { value: 2, reason: "typo" },
      lengthMiles: { value: -1, reason: "bad measure" },
      widthFt: { value: null, reason: "" },
    } as PackageInstance["parameterOverrides"];
    const issues = validatePlanningScenario(scenario({ packages: [source] }));
    expect(hasCode(issues, "unknown_parameter")).toBe(true);
    expect(hasCode(issues, "out_of_bounds")).toBe(true);
    expect(hasCode(issues, "invalid_number")).toBe(true);
    expect(hasCode(issues, "reason_required")).toBe(true);
  });

  it("rejects unknown quantity and rate override roles and dangling segments", () => {
    const source = instance("one");
    source.segmentId = "missing-segment";
    source.quantityOverrides = { mystery: { value: 1, reason: "mistake" } };
    source.rateOverrides = { mystery: { value: 1, reason: "mistake" } };
    const issues = validatePlanningScenario(scenario({ packages: [source] }));
    expect(issues.filter((entry) => entry.code === "missing_reference").length).toBeGreaterThanOrEqual(2);
  });

  it("finds duplicate segments, generated component IDs, and physical-scope overlap", () => {
    const one = instance("same");
    const two = instance("same");
    const issues = validatePlanningScenario(scenario({
      segments: [{ segmentId: "segment-1", name: "Mainline" }, { segmentId: "segment-1", name: "Duplicate" }],
      packages: [one, two],
    }));
    expect(hasCode(issues, "duplicate_id")).toBe(true);
    expect(hasCode(issues, "scope_overlap")).toBe(true);
  });

  it("accepts a reasoned active replacement when it resolves a physical overlap", () => {
    const first = instance("first");
    const second = instance("second");
    const issues = validatePlanningScenario(scenario({
      packages: [first, second],
      substitutions: [{
        replacementComponentId: "second/pavement", replacedComponentIds: ["first/pavement", "first/base", "first/excavation"], replacedAllowanceIds: [], reason: "Use the revised surface and section quantities.",
      }],
    }));
    expect(hasCode(issues, "scope_overlap")).toBe(false);
  });

  it("does not let a blank-reason substitution conceal overlap", () => {
    const issues = validatePlanningScenario(scenario({
      packages: [instance("first"), instance("second")],
      substitutions: [{
        replacementComponentId: "second/pavement", replacedComponentIds: ["first/pavement"], replacedAllowanceIds: [], reason: "  ",
      }],
    }));
    expect(hasCode(issues, "reason_required")).toBe(true);
    expect(hasCode(issues, "scope_overlap")).toBe(true);
  });

  it("checks substitution references, self replacement, and replacement cycles", () => {
    const issues = validatePlanningScenario(scenario({
      packages: [instance("first"), instance("second")],
      substitutions: [
        { replacementComponentId: "first/pavement", replacedComponentIds: ["second/pavement"], replacedAllowanceIds: [], reason: "Swap A" },
        { replacementComponentId: "second/pavement", replacedComponentIds: ["first/pavement"], replacedAllowanceIds: [], reason: "Swap B" },
        { replacementComponentId: "missing", replacedComponentIds: ["missing"], replacedAllowanceIds: ["missing-allowance"], reason: "Bad references" },
      ],
    }));
    expect(hasCode(issues, "allowance_cycle")).toBe(true);
    expect(hasCode(issues, "missing_reference")).toBe(true);
    expect(hasCode(issues, "scope_overlap")).toBe(true);
  });

  it("checks explicit allowance references and dependency cycles", () => {
    const issues = validatePlanningScenario(scenario({
      allowances: [
        allowance("a", { kind: "references", componentIds: [], allowanceIds: ["b"] }),
        allowance("b", { kind: "references", componentIds: ["missing-component"], allowanceIds: ["a"] }),
      ],
    }));
    expect(hasCode(issues, "missing_reference")).toBe(true);
    expect(hasCode(issues, "allowance_cycle")).toBe(true);
  });

  it("rejects built-in subtotal cycles and requires both external scope decisions", () => {
    const issues = validatePlanningScenario(scenario({
      allowances: [allowance("loop", { kind: "construction_subtotal" })],
      externalScopes: [externalScopes[0]],
    }));
    expect(hasCode(issues, "allowance_cycle")).toBe(true);
    expect(hasCode(issues, "missing_reference")).toBe(true);
  });

  it("rejects recipe rule refs, unit mismatch, and incomplete exact bindings", () => {
    const definition = structuredClone(COLORADO_PILOT_PACKAGES.find((entry) => entry.kind === "path")!);
    definition.components[0].quantityRule = { kind: "area", length: "missing", width: "widthFt", unit: "CY" as "SF" };
    const codes = validatePackageDefinition(definition).map((entry) => entry.code);
    expect(codes).toContain("missing_reference");
    expect(codes).toContain("unit_mismatch");
  });

  it("accepts surface application rules with a gallon output and GAL/SY rate", () => {
    const definition = structuredClone(COLORADO_PILOT_PACKAGES.find((entry) => entry.kind === "path")!);
    definition.parameters.push({ key: "tackRate", label: "Tack rate", unit: "GAL/SY", defaultValue: 0.1, optional: false, min: 0, assumption: { id: "tack", description: "Synthetic tack rate", origin: "pilot_assumption" } });
    definition.components[0].quantityRule = { kind: "surface_application", length: "lengthMiles", width: "widthFt", applicationRate: "tackRate", unit: "GAL" };
    expect(validatePackageDefinition(definition).filter((entry) => entry.path.includes("quantityRule"))).toEqual([]);
  });

  it("detects cycles spanning named references and implicit construction subtotals", () => {
    const construction = allowance("direct-fee", { kind: "references", componentIds: [], allowanceIds: ["service-fee"] });
    const service = { ...allowance("service-fee", { kind: "construction_subtotal" }), category: "service" as const };
    expect(hasCode(validatePlanningScenario(scenario({ allowances: [construction, service] })), "allowance_cycle")).toBe(true);
  });

  it("does not create cycles or duplicate active roles from disabled allowances", () => {
    const inactive = { ...allowance("inactive", { kind: "references", componentIds: [], allowanceIds: ["active"] }), enabled: false, role: "design" as const, category: "service" as const };
    const active = { ...allowance("active", { kind: "references", componentIds: [], allowanceIds: ["inactive"] }), role: "design" as const, category: "service" as const };
    const issues = validatePlanningScenario(scenario({ allowances: [inactive, active] }));
    expect(hasCode(issues, "allowance_cycle")).toBe(false);
    expect(hasCode(issues, "duplicate_id")).toBe(false);
  });

  it("keeps typed substitution namespaces distinct and ignores a replaced built-in role", () => {
    const first = { ...allowance("drainage", { kind: "direct_construction" }), role: "drainage" as const };
    const second = { ...first, allowanceId: "other-drainage" };
    const detail: PlanningScenario["customComponents"][number] = {
      componentId: "drainage", segmentId: "segment-1", scopeId: "detail", role: "pipe", description: "Synthetic pipe scope",
      category: "construction", unit: "LS", quantity: 1, unitRate: 100, reason: "Synthetic fixture", required: true, tags: [], exclusion: null,
    };
    const issues = validatePlanningScenario(scenario({
      customComponents: [detail], allowances: [first, second],
      substitutions: [{ replacementComponentId: "drainage", replacedComponentIds: [], replacedAllowanceIds: ["drainage"], reason: "Detailed work replaces the original percentage" }],
    }));
    expect(issues).toEqual([]);
  });
});
