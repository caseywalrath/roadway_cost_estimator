import { describe, expect, it } from "vitest";
import { calculateScenarioCosts, createDefaultAllowances } from "./costEngine";
import type { AllowanceDefinition, CustomComponent, PlanningScenario } from "./types";

const component = (input: Partial<CustomComponent> = {}): CustomComponent => ({
  componentId: "direct", segmentId: "segment", scopeId: "roadway", role: "construction", description: "Synthetic known scope",
  category: "construction", unit: "LS", quantity: 1, unitRate: 100_000, reason: "synthetic test value", required: true, tags: [], exclusion: null, ...input,
});
function scenario(options: { customComponents?: CustomComponent[]; allowances?: AllowanceDefinition[]; externalScopes?: PlanningScenario["externalScopes"]; substitutions?: PlanningScenario["substitutions"] } = {}): PlanningScenario {
  return {
    scenarioId: "scenario", state: "NE", name: "Cost fixture", location: "", notes: "", segments: [{ segmentId: "segment", name: "Roadway" }],
    packages: [], customComponents: options.customComponents ?? [component()], substitutions: options.substitutions ?? [],
    allowances: options.allowances ?? createDefaultAllowances("NE"),
    externalScopes: options.externalScopes ?? [
      { scopeId: "right_of_way", decision: "none_assumed", amount: null, reason: "No acquisition in synthetic fixture." },
      { scopeId: "major_utilities", decision: "none_assumed", amount: null, reason: "No major relocation in synthetic fixture." },
    ],
    review: null, history: [], projectLink: null, handoffIntent: null,
    createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z",
  };
}

describe("Planning allowance graph and completeness", () => {
  it("returns independent default allowances and matches the 100,000 direct-cost reference", () => {
    const first = createDefaultAllowances("NE");
    const second = createDefaultAllowances("NE");
    first[0].percent = 0;
    expect(second[0].percent).toBe(8);
    expect(first[0].originalBasis).toMatchObject({ percent: 8, base: { kind: "direct_construction" }, enabled: true });
    first[0].originalBasis!.base.kind = "construction_subtotal";
    expect(second[0].originalBasis?.base.kind).toBe("direct_construction");
    const result = calculateScenarioCosts(scenario());
    expect(result).toMatchObject({ pricedDirectSubtotal: 100_000, directConstruction: 100_000, constructionSubtotal: 113_000, contingency: 28_250, services: 28_250, external: 0, total: 169_500, complete: true });
    expect(result.issues).toEqual([]);
  });

  it("rejects a contingency category change that would count the allowance twice", () => {
    const allowances = createDefaultAllowances("NE");
    allowances.find((entry) => entry.role === "contingency")!.category = "service";
    const result = calculateScenarioCosts(scenario({ allowances }));
    expect(result.complete).toBe(false);
    expect(result.total).toBeNull();
    expect(result.issues.some((entry) => entry.code === "invalid_recipe" && entry.path.endsWith(".category"))).toBe(true);
  });

  it("keeps manual zero distinct and does not resolve a missing required quantity", () => {
    const zero = calculateScenarioCosts(scenario({ customComponents: [component({ unitRate: 0 })] }));
    expect(zero.pricedDirectSubtotal).toBe(0);
    expect(zero.directConstruction).toBe(0);
    expect(zero.complete).toBe(true);
    const missing = calculateScenarioCosts(scenario({ customComponents: [component({ quantity: null })] }));
    expect(missing.pricedDirectSubtotal).toBe(0);
    expect(missing.directConstruction).toBeNull();
    expect(missing.constructionSubtotal).toBeNull();
    expect(missing.total).toBeNull();
    expect(missing.missingComponentIds).toContain("direct");
  });

  it("allows a reasoned exclusion to remove required unpriced manual scope from completeness", () => {
    const excluded = component({
      componentId: "unbound-removal", quantity: null, unitRate: null,
      exclusion: { reason: "Removal is outside this contract.", sectionEffect: "No removal scope is included." },
    });
    const result = calculateScenarioCosts(scenario({ customComponents: [component(), excluded] }));
    expect(result.complete).toBe(true);
    expect(result.total).toBe(169_500);
    expect(result.components.find((entry) => entry.componentId === "unbound-removal")?.status).toBe("excluded");
  });

  it("requires explicit external decisions and adds service/external component values", () => {
    const customService = component({ componentId: "service-line", role: "design-extra", category: "service", unitRate: 500 });
    const customExternal = component({ componentId: "external-line", role: "right-of-way-extra", category: "external", unitRate: 200 });
    const externalScopes: PlanningScenario["externalScopes"] = [
      { scopeId: "right_of_way", decision: "manual", amount: 100, reason: "Synthetic parcel allowance." },
      { scopeId: "major_utilities", decision: "none_assumed", amount: null, reason: "No relocation assumed." },
    ];
    const result = calculateScenarioCosts(scenario({ customComponents: [component(), customService, customExternal], externalScopes }));
    expect(result.services).toBe(28_750);
    expect(result.external).toBe(300);
    expect(result.total).toBe(170_300);
    const unassessed = calculateScenarioCosts(scenario({ externalScopes: [{ scopeId: "right_of_way", decision: "unassessed", amount: null, reason: "" }, externalScopes[1]] }));
    expect(unassessed.total).toBeNull();
    expect(unassessed.missingComponentIds).toContain("right_of_way");
  });

  it("returns null rather than an arbitrary subtotal when finite lines overflow in aggregate", () => {
    const huge = Number.MAX_VALUE * 0.75;
    const result = calculateScenarioCosts(scenario({ customComponents: [
      component({ componentId: "large-a", unitRate: huge }),
      component({ componentId: "large-b", scopeId: "roadway-b", unitRate: huge }),
    ] }));
    expect(result.pricedDirectSubtotal).toBeNull();
    expect(result.directConstruction).toBeNull();
    expect(result.total).toBeNull();
    expect(result.issues.some((entry) => entry.code === "invalid_number" && entry.path === "pricedDirectSubtotal")).toBe(true);
  });

  it("propagates named-reference dependencies independent of allowance array order", () => {
    const allowances = createDefaultAllowances("NE");
    const disabled = allowances.find((entry) => entry.role === "drainage")!;
    const named = { ...allowances.find((entry) => entry.role === "mobilization")!, allowanceId: "named", role: "custom" as const, name: "Named reference", percent: 100, base: { kind: "references" as const, componentIds: ["direct"], allowanceIds: ["drainage"] } };
    const reversed = [named, disabled, ...allowances.filter((entry) => entry.allowanceId !== "drainage" && entry.allowanceId !== "mobilization")];
    const result = calculateScenarioCosts(scenario({ allowances: reversed }));
    expect(result.allowances.find((entry) => entry.allowanceId === "drainage")?.status).toBe("excluded");
    expect(result.allowances.find((entry) => entry.allowanceId === "named")?.amount).toBe(100_000);
    expect(result.complete).toBe(true);

    const inactiveDuplicates = [...createDefaultAllowances("NE"), {
      ...createDefaultAllowances("NE").find((entry) => entry.role === "drainage")!, allowanceId: "drainage-copy", enabled: false,
    }];
    const inactiveResult = calculateScenarioCosts(scenario({ allowances: inactiveDuplicates }));
    expect(inactiveResult.complete).toBe(true);
  });

  it("rejects allowance cycles and does not count an enabled drainage allowance beside detailed drainage", () => {
    const cyclic = createDefaultAllowances("NE");
    cyclic.find((entry) => entry.role === "mobilization")!.base = { kind: "construction_subtotal" };
    const cycleResult = calculateScenarioCosts(scenario({ allowances: cyclic }));
    expect(cycleResult.issues.some((entry) => entry.code === "allowance_cycle")).toBe(true);
    expect(cycleResult.total).toBeNull();

    const drainage = createDefaultAllowances("NE");
    drainage.find((entry) => entry.role === "drainage")!.enabled = true;
    const detailed = component({ componentId: "drainage", role: "pipe-work", unitRate: 2_000, tags: ["drainage"] });
    const missingSubstitution = calculateScenarioCosts(scenario({ customComponents: [component(), detailed], allowances: drainage }));
    expect(missingSubstitution.total).toBeNull();
    const substituted = calculateScenarioCosts(scenario({
      customComponents: [component(), detailed], allowances: drainage,
      substitutions: [{ replacementComponentId: "drainage", replacedComponentIds: [], replacedAllowanceIds: ["drainage"], reason: "Detailed pipe estimate replaces allowance." }],
      externalScopes: scenario().externalScopes,
    }));
    expect(substituted.allowances.find((entry) => entry.allowanceId === "drainage")?.status).toBe("excluded");
    expect(substituted.total).toBe(172_890);
  });
});
