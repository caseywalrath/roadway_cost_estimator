import { beforeAll, describe, expect, it } from "vitest";
import prices from "../../public/data/states/co/planning_prices.json";
import rawLibrary from "../../data/planning/co_element_library.json";
import { calculateAlternative } from "./calculate";
import {
  addAlternative, duplicateAlternative, removeAlternative, renameAlternative, resetElementInput, selectAlternative,
  setBaseTreatment, setBudget, setElementEnabled, setElementInput, setElementOverride, setEngineering, setProjectInput, setStage
} from "./edit";
import { resolveLibrary } from "./library";
import { createAlternative, createProject } from "./templates";
import type { PlanningLibrary, PriceTable, ResolvedLibrary } from "./types";

let library: ResolvedLibrary;
beforeAll(() => {
  library = resolveLibrary(rawLibrary as unknown as PlanningLibrary, prices as unknown as PriceTable).library;
});
const make = (templateId: string | null) =>
  createProject(library, { id: "p1", name: "Test", now: "2026-01-01T00:00:00Z", templateId, alternativeId: "a1" });

describe("templates", () => {
  it("creates a project from a template", () => {
    const p = make("intersection_safety");
    expect(p.inputs).toEqual({ lengthMiles: 0.1, roadwayWidthFt: 40, intersections: 1 });
    expect(p.stageId).toBe("concept");
    expect(p.engineering).toEqual({ design: 0.1, constructionEngineering: 0.1 });
    expect(p.budget).toBeNull();
    expect(p.revision).toBe(0);
    expect(p.templateId).toBe("intersection_safety");
    expect(p.alternatives).toHaveLength(1);
    expect(p.alternatives[0].name).toBe("Alternative A");
    expect(p.alternatives[0].description).toMatch(/signalized/);
    expect(Object.keys(p.alternatives[0].selections)).toEqual(["base_none", "signal", "ada_ramps", "crosswalk", "refuge_island"]);
    expect(p.selectedAlternativeId).toBe("a1");
  });

  it("creates a blank project with base_none only", () => {
    const p = make(null);
    expect(p.inputs).toEqual({ lengthMiles: 0.5, roadwayWidthFt: 40, intersections: 4 });
    expect(p.alternatives[0].description).toBe("");
    expect(p.alternatives[0].selections).toEqual({ base_none: { enabled: true, inputs: {}, override: null } });
  });

  it("writes template inputs into selections", () => {
    const alt = createAlternative(library, "full_reconstruction", { id: "x", name: "X" });
    expect(alt.selections.sidewalk).toEqual({ enabled: true, inputs: { existingSidewalk: "yes" }, override: null });
    expect(() => createAlternative(library, "nope", { id: "x", name: "X" })).toThrow();
  });
});

describe("edit helpers", () => {
  it("setBaseTreatment is select-one and does not mutate", () => {
    const p = make("mill_overlay");
    const snapshot = JSON.stringify(p);
    const next = setBaseTreatment(p, library, "a1", "reconstruction");
    expect(JSON.stringify(p)).toBe(snapshot);
    expect(next.alternatives[0].selections.reconstruction.enabled).toBe(true);
    expect(next.alternatives[0].selections.mill_overlay.enabled).toBe(false);
    expect(next.revision).toBe(0);
    expect(next.updatedAt).toBe(p.updatedAt);
    expect(() => setBaseTreatment(p, library, "a1", "sidewalk")).toThrow();
  });

  it("enabling a base element routes through select-one when the library is given", () => {
    const p = make("mill_overlay");
    const next = setElementEnabled(p, "a1", "path", true, library);
    expect(next.alternatives[0].selections.path.enabled).toBe(true);
    expect(next.alternatives[0].selections.mill_overlay.enabled).toBe(false);
    const off = setElementEnabled(next, "a1", "ada_ramps", false);
    expect(off.alternatives[0].selections.ada_ramps.enabled).toBe(false);
  });

  it("override null restores the calculated amount; 0 is valid", () => {
    const p = make("mill_overlay");
    const calc = calculateAlternative(library, p).elements.find((e) => e.elementId === "ada_ramps")!;
    const zero = calculateAlternative(library, setElementOverride(p, "a1", "ada_ramps", 0)).elements.find((e) => e.elementId === "ada_ramps")!;
    expect(zero.amount).toBe(0);
    const reset = setElementOverride(setElementOverride(p, "a1", "ada_ramps", 5), "a1", "ada_ramps", null);
    const back = calculateAlternative(library, reset).elements.find((e) => e.elementId === "ada_ramps")!;
    expect(back.amount).toBe(calc.calculated);
    expect(back.override).toBeNull();
  });

  it("switches components with conditional inputs", () => {
    const p = make("full_reconstruction");
    const ids = (proj: typeof p) =>
      calculateAlternative(library, proj).elements.find((e) => e.elementId === "reconstruction")!.components.map((c) => c.id);
    expect(ids(p)).toEqual(["remove_asphalt", "excavation", "base", "asphalt"]);
    const concrete = setElementInput(p, "a1", "reconstruction", "existingSurface", "concrete");
    const result = calculateAlternative(library, concrete).elements.find((e) => e.elementId === "reconstruction")!;
    const removal = result.components.find((c) => c.id === "remove_concrete")!;
    expect(removal.source).toMatchObject({ kind: "item", itemId: "co_cdot_202-00210" });
    expect(removal.unitPrice).toBe((prices as unknown as PriceTable).items["co_cdot_202-00210"].price);
    expect(ids(concrete)).toEqual(["remove_concrete", "excavation", "base", "asphalt"]);
    const both = setElementInput(concrete, "a1", "reconstruction", "newSurface", "concrete");
    expect(ids(both)).toEqual(["remove_concrete", "excavation", "base", "concrete"]);
    const r2 = calculateAlternative(library, both).elements.find((e) => e.elementId === "reconstruction")!;
    expect("asphaltThicknessIn" in r2.inputs).toBe(false);
    const reset = resetElementInput(both, "a1", "reconstruction", "newSurface");
    expect(ids(reset)).toEqual(["remove_concrete", "excavation", "base", "asphalt"]);
  });

  it("ada_ramps defaults to intersections x 4, follows project input changes, unless overridden", () => {
    const rampsCount = (proj: ReturnType<typeof make>) =>
      calculateAlternative(library, proj).elements.find((e) => e.elementId === "ada_ramps")!.inputs.count;
    const p = make("mill_overlay");
    expect(rampsCount(p)).toBe(16);
    const more = setProjectInput(p, "intersections", 6);
    expect(rampsCount(more)).toBe(24);
    expect(p.inputs.intersections).toBe(4);
    const fixed = setElementInput(more, "a1", "ada_ramps", "count", 10);
    expect(rampsCount(setProjectInput(fixed, "intersections", 2))).toBe(10);
    expect(rampsCount(setProjectInput(resetElementInput(fixed, "a1", "ada_ramps", "count"), "intersections", 2))).toBe(8);
  });

  it("project-level setters", () => {
    const p = make(null);
    expect(setStage(p, "planning_study").stageId).toBe("planning_study");
    expect(setEngineering(p, { design: 0.2 }).engineering).toEqual({ design: 0.2, constructionEngineering: 0.1 });
    expect(setBudget(p, 1000).budget).toBe(1000);
    expect(setBudget(setBudget(p, 1000), null).budget).toBeNull();
    expect(p.budget).toBeNull();
  });

  it("add, duplicate, rename, select and remove alternatives", () => {
    let p = make("mill_overlay");
    p = addAlternative(p, library, null, { id: "a2", name: "Blank" });
    expect(p.alternatives.map((a) => a.id)).toEqual(["a1", "a2"]);
    expect(p.selectedAlternativeId).toBe("a1");
    const edited = setElementInput(p, "a1", "mill_overlay", "thicknessIn", 3);
    const dup = duplicateAlternative(edited, "a1", { id: "a3", name: "Copy" });
    expect(dup.alternatives.map((a) => a.id)).toEqual(["a1", "a3", "a2"]);
    expect(dup.alternatives[1].selections.mill_overlay.inputs).toEqual({ thicknessIn: 3 });
    const changedCopy = setElementInput(dup, "a3", "mill_overlay", "thicknessIn", 4);
    expect(changedCopy.alternatives[0].selections.mill_overlay.inputs.thicknessIn).toBe(3);
    expect(renameAlternative(p, "a2", "New", "desc").alternatives[1]).toMatchObject({ name: "New", description: "desc" });
    expect(renameAlternative(p, "a1", "Only name").alternatives[0].description).toMatch(/Resurface/);
    const selected = selectAlternative(p, "a2");
    expect(removeAlternative(selected, "a1").selectedAlternativeId).toBe("a2");
    const removedSelected = removeAlternative(selected, "a2");
    expect(removedSelected.selectedAlternativeId).toBe("a1");
    expect(removedSelected.alternatives).toHaveLength(1);
    expect(removeAlternative(removedSelected, "a1")).toBe(removedSelected);
  });
});
