import { beforeAll, describe, expect, it } from "vitest";
import prices from "../../public/data/states/co/planning_prices.json";
import rawLibrary from "../../data/planning/co_element_library.json";
import { setElementEnabled, setElementInput, setElementOverride, setProjectInput } from "./edit";
import { resolveLibrary } from "./library";
import { alternativeTemplateId, createProject, planTemplateSwitch } from "./templates";
import type { PlanningLibrary, PriceTable, ResolvedLibrary } from "./types";

let library: ResolvedLibrary;
beforeAll(() => {
  library = resolveLibrary(rawLibrary as unknown as PlanningLibrary, prices as unknown as PriceTable).library;
});
const make = (templateId: string | null) =>
  createProject(library, { id: "p1", name: "Test", now: "2026-01-01T00:00:00Z", templateId, alternativeId: "a1" });

describe("alternativeTemplateId", () => {
  it("records the template on a new alternative and falls back to the project's for older files", () => {
    const p = make("sidewalk_gap");
    expect(p.alternatives[0].templateId).toBe("sidewalk_gap");
    expect(make(null).alternatives[0].templateId).toBeNull();
    const { templateId: _drop, ...older } = p.alternatives[0];
    expect(alternativeTemplateId(p, older)).toBe("sidewalk_gap");
  });
});

describe("planTemplateSwitch", () => {
  it("replaces the elements without listing losses when the alternative is unedited", () => {
    const plan = planTemplateSwitch(make("mill_overlay"), library, "a1", "complete_street");
    expect(plan.lostEdits).toEqual([]);
    expect(plan.replacedInputs).toEqual([]);
    const alt = plan.project.alternatives[0];
    expect(alt.templateId).toBe("complete_street");
    expect(Object.keys(alt.selections).sort()).toEqual(
      Object.keys(make("complete_street").alternatives[0].selections).sort()
    );
    expect(alt.description).toBe(library.templates.find((t) => t.id === "complete_street")?.description);
  });

  it("lists what the planner changed", () => {
    let p = make("complete_street");
    p = setElementInput(p, "a1", "sidewalk", "sides", 1);
    p = setElementOverride(p, "a1", "lighting", 100000);
    p = setElementEnabled(p, "a1", "landscaping", false);
    p = setElementEnabled(p, "a1", "rrfb", true);
    const plan = planTemplateSwitch(p, library, "a1", "mill_overlay");
    expect(plan.lostEdits).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^Sidewalk \(inputs edited\)$/u),
        expect.stringMatching(/^.*ighting \(price overridden\)$/u),
        expect.stringMatching(/\(turned off\)$/u),
        expect.stringMatching(/\(added\)$/u)
      ])
    );
  });

  it("keeps the other alternatives, the name and a custom description", () => {
    let p = make("complete_street");
    p = { ...p, alternatives: [{ ...p.alternatives[0], description: "My note" }, { ...p.alternatives[0], id: "a2", name: "B" }] };
    const plan = planTemplateSwitch(p, library, "a1", "sidewalk_gap");
    expect(plan.project.alternatives[0].description).toBe("My note");
    expect(plan.project.alternatives[0].name).toBe(p.alternatives[0].name);
    expect(plan.project.alternatives[1]).toEqual(p.alternatives[1]);
  });

  it("switches to Blank with only the no-treatment base", () => {
    const plan = planTemplateSwitch(make("complete_street"), library, "a1", null);
    expect(plan.project.alternatives[0].templateId).toBeNull();
    expect(Object.keys(plan.project.alternatives[0].selections)).toEqual(["base_none"]);
    expect(plan.project.alternatives[0].description).toBe("");
  });

  it("moves corridor values the previous template set, and warns only about values the planner changed", () => {
    const toSafety = planTemplateSwitch(make("complete_street"), library, "a1", "intersection_safety");
    expect(toSafety.project.inputs.intersections).toBe(1);
    expect(toSafety.replacedInputs).toEqual([]);
    const back = planTemplateSwitch(toSafety.project, library, "a1", "complete_street");
    expect(back.project.inputs.intersections).toBe(4);
    expect(back.replacedInputs).toEqual([]);

    const edited = setProjectInput(make("complete_street"), "intersections", 7);
    const plan = planTemplateSwitch(edited, library, "a1", "intersection_safety");
    expect(plan.project.inputs.intersections).toBe(1);
    expect(plan.replacedInputs).toEqual([{ key: "intersections", label: "Intersections", from: 7, to: 1 }]);
    expect(planTemplateSwitch(edited, library, "a1", "sidewalk_gap").project.inputs.intersections).toBe(7);
  });

  it("throws for an unknown alternative or template", () => {
    expect(() => planTemplateSwitch(make(null), library, "nope", null)).toThrow();
    expect(() => planTemplateSwitch(make(null), library, "a1", "nope")).toThrow();
  });
});
