import { describe, expect, it } from "vitest";
import {
  calculateAlternative,
  combinedMultiplier,
  evaluateQuantity,
  roundElementAmount,
  roundTotalAmount,
  roundUnitPrice
} from "./calculate";
import type { ElementDefinition, PlanningProject, ResolvedComponent, ResolvedElement, ResolvedLibrary } from "./types";

const values = { lengthMiles: 0.5, widthFt: 24, thicknessIn: 2, density: 145, factor: 1.05, sides: 2, depthIn: 6 };

describe("evaluateQuantity", () => {
  it("area", () => {
    expect(evaluateQuantity({ kind: "area", length: "lengthMiles", width: "widthFt", unit: "SY" }, values).quantity).toBeCloseTo(7040, 6);
  });
  it("asphalt tons", () => {
    const rule = { kind: "asphalt_tons", length: "lengthMiles", width: "widthFt", thickness: "thicknessIn", density: "density", materialFactor: "factor", unit: "TON" } as const;
    expect(evaluateQuantity(rule, values).quantity).toBeCloseTo(803.88, 2);
  });
  it("sidewalk area with sides", () => {
    const rule = { kind: "area", length: "lengthMiles", width: "w5", sides: "sides", unit: "SY" } as const;
    expect(evaluateQuantity(rule, { ...values, w5: 5 }).quantity).toBeCloseTo(2933.33, 2);
  });
  it("volume", () => {
    const rule = { kind: "volume", length: "lengthMiles", width: "widthFt", depth: "depthIn", unit: "CY" } as const;
    expect(evaluateQuantity(rule, values).quantity).toBeCloseTo(1173.33, 2);
  });
  it("linear, miles and count", () => {
    expect(evaluateQuantity({ kind: "linear", length: "lengthMiles", sides: "sides", unit: "LF" }, values).quantity).toBeCloseTo(5280, 6);
    expect(evaluateQuantity({ kind: "miles", length: "lengthMiles", sides: "sides" }, values).quantity).toBe(1);
    expect(evaluateQuantity({ kind: "count", count: "sides" }, values).quantity).toBe(2);
  });
  it("invalid input gives an issue and 0", () => {
    const rule = { kind: "area", length: "lengthMiles", width: "missing", unit: "SY" } as const;
    const result = evaluateQuantity(rule, values);
    expect(result.quantity).toBe(0);
    expect(result.issues[0].code).toBe("invalid_input");
    expect(evaluateQuantity({ kind: "count", count: "n" }, { n: -1 }).quantity).toBe(0);
    expect(evaluateQuantity({ kind: "count", count: "n" }, { n: "x" }).issues).toHaveLength(1);
    expect(evaluateQuantity({ kind: "count", count: "n" }, { n: Infinity }).issues).toHaveLength(1);
  });
});

describe("rounding", () => {
  it("rounds half away from zero", () => {
    expect(roundElementAmount(1500)).toBe(2000);
    expect(roundElementAmount(-1500)).toBe(-2000);
    expect(roundElementAmount(1499.99)).toBe(1000);
    expect(roundTotalAmount(15000)).toBe(20000);
    expect(roundTotalAmount(14999)).toBe(10000);
    expect(roundUnitPrice(1.005)).toBe(1.01);
    expect(roundUnitPrice(-1.005)).toBe(-1.01);
    expect(roundUnitPrice(3.574)).toBe(3.57);
  });
  it("combinedMultiplier", () => {
    expect(combinedMultiplier({ minor: 0.5, trafficControl: 0.2, mobilization: 0.1, basis: "" })).toBeCloseTo(1.98, 10);
  });
});

// ---- Synthetic library: every number is hand-computable ----

function el(id: string, group: ElementDefinition["group"], components: ResolvedComponent[], extra: Partial<ResolvedElement> = {}): ResolvedElement {
  return { id, group, label: id, inputs: [], components, note: "", ...extra };
}
const assembly = (id: string, unitCost: number, quantity: ResolvedComponent["quantity"]): ResolvedComponent => ({
  id, label: id, unitCost, unit: "X", quantity, displayUnit: "X", unitPrice: unitCost, source: { kind: "assembly", basis: "" }
});
const factors = (minor: number) => ({ minor, trafficControl: 0, mobilization: 0, basis: "" });

const lib: ResolvedLibrary = {
  schemaVersion: 1, state: "XX", label: "", priceTable: "", notes: "", priceBasisLabel: "test",
  projectInputs: [], defaultStage: "s1", engineering: { design: 0.1, constructionEngineering: 0.1 },
  stages: [{ id: "s1", label: "S1", contingency: 0.1, rangeLow: -0.2, rangeHigh: 0.3 }],
  factors: { mill_overlay: factors(1), reconstruction: factors(0.5), path: factors(0), elements_only: factors(0) },
  groups: [],
  elements: [
    el("base_none", "base", [], { baseType: "elements_only" }),
    el("base_a", "base", [assembly("a", 1000, { kind: "miles", length: "lengthMiles" })], {
      baseType: "mill_overlay", inputs: [{ key: "lengthMiles", label: "", inherit: "lengthMiles" }]
    }),
    el("base_b", "base", [assembly("b", 200, { kind: "count", count: "n" })], {
      baseType: "reconstruction", inputs: [{ key: "n", label: "", default: 1 }]
    }),
    el("post", "spot", [assembly("p", 100, { kind: "count", count: "count" })], { inputs: [{ key: "count", label: "", default: 10 }] }),
    el("opt", "corridor", [assembly("o", 7, { kind: "count", count: "count" })], { inputs: [{ key: "count", label: "", default: 10 }] }),
    el("right_of_way", "other", []),
    el("utility_relocation", "other", [])
  ],
  templates: []
};

function project(selections: PlanningProject["alternatives"][0]["selections"], budget: number | null = null): PlanningProject {
  return {
    schemaVersion: 1, id: "p", name: "p", state: "XX", createdAt: "", updatedAt: "", revision: 0, templateId: null,
    inputs: { lengthMiles: 0.5, roadwayWidthFt: 40, intersections: 4 }, stageId: "s1",
    engineering: { design: 0.1, constructionEngineering: 0.1 }, budget,
    alternatives: [{ id: "a1", name: "A", description: "", selections }], selectedAlternativeId: "a1"
  };
}
const on = (override: number | null = null) => ({ enabled: true, inputs: {}, override });

describe("calculateAlternative", () => {
  it("computes direct, multiplier, totals, range and budget", () => {
    const result = calculateAlternative(
      lib,
      project({ base_a: on(), post: on(), opt: { enabled: false, inputs: {}, override: null }, right_of_way: { enabled: false, inputs: {}, override: 500 } }, 5000)
    );
    const s = result.summary;
    expect(result.issues).toEqual([]);
    expect(s.baseType).toBe("mill_overlay");
    expect(s.multiplier).toBe(2);
    const byId = Object.fromEntries(result.elements.map((e) => [e.elementId, e]));
    expect(byId.base_a.direct).toBe(500);
    expect(byId.base_a.amount).toBe(1000);
    expect(byId.post.direct).toBe(1000);
    expect(byId.post.amount).toBe(2000);
    expect(byId.opt.enabled).toBe(false);
    expect(byId.opt.direct).toBe(70);
    expect(result.elements.map((e) => e.elementId)).toEqual(["base_none", "base_a", "base_b", "post", "opt"]);
    expect(s.construction).toBe(3000);
    expect(s.contingency).toBeCloseTo(300, 9);
    expect(s.design).toBeCloseTo(330, 9);
    expect(s.constructionEngineering).toBeCloseTo(330, 9);
    expect(s.rightOfWay).toBe(500);
    expect(s.utilityRelocation).toBe(0);
    expect(s.total).toBeCloseTo(4460, 9);
    expect(s.rangeLow).toBeCloseTo(3568, 9);
    expect(s.rangeHigh).toBeCloseTo(5798, 9);
    expect(s.budgetRemaining).toBeCloseTo(540, 9);
  });

  it("counts a disabled element's ROW/utility amounts and leaves budget null", () => {
    const s = calculateAlternative(lib, project({ utility_relocation: { enabled: false, inputs: {}, override: 250 } })).summary;
    expect(s.utilityRelocation).toBe(250);
    expect(s.total).toBe(250);
    expect(s.budget).toBeNull();
    expect(s.budgetRemaining).toBeNull();
  });

  it("applies overrides including 0", () => {
    const result = calculateAlternative(lib, project({ base_a: on(), post: on(0), opt: on(50) }));
    const byId = Object.fromEntries(result.elements.map((e) => [e.elementId, e]));
    expect(byId.post.calculated).toBe(2000);
    expect(byId.post.amount).toBe(0);
    expect(byId.opt.amount).toBe(50);
    expect(result.summary.construction).toBe(1050);
  });

  it("uses elements_only factors when no base is enabled", () => {
    const s = calculateAlternative(lib, project({ post: on() })).summary;
    expect(s.baseType).toBe("elements_only");
    expect(s.multiplier).toBe(1);
    expect(s.construction).toBe(1000);
  });

  it("reports multiple_base and uses the first in library order", () => {
    const result = calculateAlternative(lib, project({ base_b: on(), base_a: on() }));
    expect(result.issues.map((i) => i.code)).toContain("multiple_base");
    expect(result.summary.baseType).toBe("mill_overlay");
  });

  it("throws for an unknown alternative", () => {
    expect(() => calculateAlternative(lib, project({}), "nope")).toThrow(/nope/);
  });
});
