import { describe, expect, it } from "vitest";
import rawLibrary from "../../data/planning/co_element_library.json";
import prices from "../../public/data/states/co/planning_prices.json";
import { elementInputValues, isInputActive, loadPlanningLibrary, resolveLibrary, validateLibrary } from "./library";
import type { PlanningLibrary, PriceTable } from "./types";

const priceTable = prices as unknown as PriceTable;
const clone = () => JSON.parse(JSON.stringify(rawLibrary)) as PlanningLibrary;
const codes = (raw: unknown) => validateLibrary(raw).issues.map((i) => i.code);

describe("validateLibrary", () => {
  it("accepts the real library", () => {
    const result = validateLibrary(rawLibrary);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it("rejects non-objects and missing fields", () => {
    expect(validateLibrary(null).ok).toBe(false);
    const broken = clone() as unknown as Record<string, unknown>;
    delete broken.elements;
    expect(validateLibrary(broken).ok).toBe(false);
  });

  it("rejects a duplicate element id", () => {
    const lib = clone();
    lib.elements[2].id = lib.elements[1].id;
    expect(codes(lib)).toContain("duplicate_id");
  });

  it("rejects a template naming an unknown element", () => {
    const lib = clone();
    lib.templates[0].elements.push({ id: "no_such_element" });
    expect(codes(lib)).toContain("unknown_element");
  });

  it("rejects a quantity rule naming an undefined input", () => {
    const lib = clone();
    const rule = lib.elements.find((e) => e.id === "sidewalk")!.components[0].quantity as { width: string };
    rule.width = "noSuchInput";
    expect(codes(lib)).toContain("unknown_input");
  });

  it("rejects a when condition naming an undefined input", () => {
    const lib = clone();
    lib.elements.find((e) => e.id === "sidewalk")!.components[1].when = { input: "nope", equals: "yes" };
    expect(codes(lib)).toContain("unknown_input");
  });

  it("rejects a base element without a baseType, an unknown group and a bad defaultStage", () => {
    const lib = clone();
    delete lib.elements[1].baseType;
    lib.elements[5].group = "mystery" as never;
    lib.defaultStage = "nope";
    expect(codes(lib)).toEqual(expect.arrayContaining(["missing_factors", "unknown_group", "unknown_stage"]));
  });
});

describe("resolveLibrary", () => {
  it("resolves the real library with no issues", () => {
    const { library, issues } = resolveLibrary(clone(), priceTable);
    expect(issues).toEqual([]);
    expect(library.priceBasisLabel).toBe(priceTable.basis.label);
    const planing = library.elements.find((e) => e.id === "mill_overlay")!.components.find((c) => c.item === "co_cdot_202-00240")!;
    expect(planing.unitPrice).toBe(priceTable.items["co_cdot_202-00240"].price);
    expect(planing.displayUnit).toBe("SY");
    expect(planing.source.kind).toBe("item");
    const ramps = library.elements.find((e) => e.id === "ada_ramps")!.components[0];
    expect(ramps.unitPrice).toBe(7300);
    expect(ramps.displayUnit).toBe("EACH");
    expect(ramps.source.kind).toBe("assembly");
  });

  it("reports missing prices and unit mismatches with a price of 0", () => {
    const lib = clone();
    const table = JSON.parse(JSON.stringify(priceTable)) as PriceTable;
    delete table.items["co_cdot_202-00240"];
    table.items["co_cdot_608-00006"].unit = "LF";
    const { library, issues } = resolveLibrary(lib, table);
    expect(issues.map((i) => i.code)).toEqual(expect.arrayContaining(["missing_price", "unit_mismatch"]));
    expect(library.elements.find((e) => e.id === "mill_overlay")!.components[0].unitPrice).toBe(0);
    expect(library.elements.find((e) => e.id === "sidewalk")!.components[0].unitPrice).toBe(0);
  });
});

describe("loadPlanningLibrary", () => {
  it("fetches the price table and resolves", async () => {
    const fetchFn = (async () => new Response(JSON.stringify(priceTable))) as typeof fetch;
    const { library, issues } = await loadPlanningLibrary(fetchFn);
    expect(issues).toEqual([]);
    expect(library.elements.length).toBeGreaterThan(10);
  });

  it("throws a clear error on HTTP failure", async () => {
    const fetchFn = (async () => new Response("", { status: 404, statusText: "Not Found" })) as typeof fetch;
    await expect(loadPlanningLibrary(fetchFn)).rejects.toThrow(/404/);
  });
});

describe("element inputs", () => {
  const lib = clone();
  const project = { lengthMiles: 0.5, roadwayWidthFt: 40, intersections: 4 };
  const reconstruction = lib.elements.find((e) => e.id === "reconstruction")!;
  const ramps = lib.elements.find((e) => e.id === "ada_ramps")!;

  it("uses defaults, inherited values and defaultFrom, then planner changes", () => {
    const values = elementInputValues(reconstruction, undefined, project);
    expect(values).toMatchObject({ lengthMiles: 0.5, widthFt: 40, existingSurface: "asphalt", baseDepthIn: 6 });
    expect(elementInputValues(ramps, undefined, project)).toEqual({ count: 16 });
    const changed = { enabled: true, inputs: { widthFt: 30, count: 3 }, override: null };
    expect(elementInputValues(reconstruction, changed, project).widthFt).toBe(30);
    expect(elementInputValues(ramps, changed, project)).toEqual({ count: 3 });
  });

  it("omits inactive conditional inputs", () => {
    const concrete = { enabled: true, inputs: { newSurface: "concrete" }, override: null };
    const values = elementInputValues(reconstruction, concrete, project);
    expect("asphaltThicknessIn" in values).toBe(false);
    const input = reconstruction.inputs.find((i) => i.key === "asphaltThicknessIn")!;
    expect(isInputActive(input, values)).toBe(false);
    expect(isInputActive(input, { newSurface: "asphalt" })).toBe(true);
  });
});
