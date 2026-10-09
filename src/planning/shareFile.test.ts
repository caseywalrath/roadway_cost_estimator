import { describe, expect, it } from "vitest";
import libraryJson from "../../data/planning/co_element_library.json";
import { buildShareFile, importProjectCopy, parseShareFile } from "./shareFile";
import type { PlanningLibrary, PlanningProject } from "./types";

const library = libraryJson as unknown as PlanningLibrary;
const NOW = "2026-01-02T03:04:05.000Z";

function makeProject(): PlanningProject {
  return {
    schemaVersion: 1,
    id: "p1",
    name: "Main Street",
    state: "CO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 3,
    templateId: null,
    inputs: { lengthMiles: 1.5, roadwayWidthFt: 36, intersections: 6 },
    stageId: "planning_study",
    engineering: { design: 0.12, constructionEngineering: 0.08 },
    budget: 2_500_000,
    alternatives: [
      {
        id: "a1",
        name: "Option A",
        description: "First",
        selections: {
          mill_overlay: { enabled: true, inputs: { thicknessIn: 3, materialFactor: 1.1 }, override: null },
          base_none: { enabled: false, inputs: {}, override: 0 }
        }
      },
      { id: "a2", name: "Option B", description: "", selections: {} }
    ],
    selectedAlternativeId: "a2"
  };
}

function fileText(mutate: (file: any) => void): string {
  const file = JSON.parse(buildShareFile(makeProject(), { state: "CO", priceBasisLabel: "2026 basis" }, NOW));
  mutate(file);
  return JSON.stringify(file);
}

function issueCodes(text: string): string[] {
  const result = parseShareFile(text, library);
  return result.issues.map((i) => i.code);
}

describe("buildShareFile", () => {
  it("writes the documented envelope, 2-space indent, trailing newline", () => {
    const text = buildShareFile(makeProject(), { state: "CO", priceBasisLabel: "2026 basis" }, NOW);
    expect(text.endsWith("}\n")).toBe(true);
    expect(text).toContain('\n  "format": "roadway-cost-estimator/planning"');
    const file = JSON.parse(text);
    expect(file.formatVersion).toBe(2);
    expect(file.exportedAt).toBe(NOW);
    expect(file.state).toBe("CO");
    expect(file.priceBasis).toBe("2026 basis");
    expect(file.project).toEqual(makeProject());
  });
});

describe("parseShareFile", () => {
  it("round trips a project with no issues", () => {
    const text = buildShareFile(makeProject(), { state: "CO", priceBasisLabel: "b" }, NOW);
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project).toEqual(makeProject());
      expect(result.issues).toEqual([]);
    }
  });

  it("fails on invalid JSON", () => {
    expect(parseShareFile("{nope", library).ok).toBe(false);
  });

  it("fails on wrong format, version, and state", () => {
    expect(parseShareFile(fileText((f) => { f.format = "other"; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { f.formatVersion = 1; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { f.state = "TX"; }), library).ok).toBe(false);
  });

  it("fails when project is not an object or has no alternatives", () => {
    expect(parseShareFile(fileText((f) => { f.project = []; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { f.project = "x"; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { f.project.alternatives = []; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { delete f.project.alternatives; }), library).ok).toBe(false);
  });

  it("fails on an alternative missing id or name, and on duplicate ids", () => {
    expect(parseShareFile(fileText((f) => { delete f.project.alternatives[0].id; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { delete f.project.alternatives[0].name; }), library).ok).toBe(false);
    expect(parseShareFile(fileText((f) => { f.project.alternatives[1].id = "a1"; }), library).ok).toBe(false);
  });

  it("fills missing or invalid project inputs from library defaults", () => {
    const text = fileText((f) => {
      delete f.project.inputs.lengthMiles;
      f.project.inputs.roadwayWidthFt = "wide";
      f.project.inputs.intersections = 2.5;
    });
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.inputs).toEqual({ lengthMiles: 0.5, roadwayWidthFt: 40, intersections: 4 });
      expect(result.issues.filter((i) => i.code === "missing_input")).toHaveLength(3);
    }
  });

  it("replaces out-of-range engineering rates with library defaults", () => {
    const text = fileText((f) => {
      f.project.engineering.design = 1.5;
      f.project.engineering.constructionEngineering = -0.1;
    });
    const result = parseShareFile(text, library);
    expect(result.ok && result.project.engineering).toEqual(library.engineering);
    expect(issueCodes(text)).toContain("invalid_engineering");
  });

  it("replaces an unknown stage with the default stage", () => {
    const text = fileText((f) => { f.project.stageId = "nope"; });
    const result = parseShareFile(text, library);
    expect(result.ok && result.project.stageId).toBe(library.defaultStage);
    expect(issueCodes(text)).toContain("unknown_stage");
  });

  it("coerces budget to null when negative or non-numeric", () => {
    for (const bad of [-1, "5", true]) {
      const text = fileText((f) => { f.project.budget = bad; });
      const result = parseShareFile(text, library);
      expect(result.ok && result.project.budget).toBeNull();
      expect(issueCodes(text)).toContain("invalid_budget");
    }
    const zero = parseShareFile(fileText((f) => { f.project.budget = 0; }), library);
    expect(zero.ok && zero.project.budget).toBe(0);
  });

  it("drops invalid input values and fixes bad enabled/override", () => {
    const text = fileText((f) => {
      f.project.alternatives[0].selections.mill_overlay = {
        enabled: "yes",
        inputs: { thicknessIn: 3, densityLbCf: "145", materialFactor: -1, widthFt: true, lengthMiles: null, unknownKey: 1 },
        override: "12"
      };
    });
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.alternatives[0].selections.mill_overlay).toEqual({
        enabled: false,
        inputs: { thicknessIn: 3 },
        override: null
      });
      expect(result.issues.filter((i) => i.code === "invalid_input_value")).toHaveLength(4);
      expect(result.issues.filter((i) => i.code === "unknown_input")).toHaveLength(1);
      expect(result.issues.map((i) => i.code)).toContain("invalid_override");
    }
  });

  it("rejects option values outside the library list and keeps only the first base treatment", () => {
    const text = fileText((f) => {
      f.project.alternatives[0].selections.sidewalk = { enabled: true, inputs: { sides: "2", existingSidewalk: "maybe", widthFt: 8 }, override: null };
      f.project.alternatives[0].selections.reconstruction = { enabled: true, inputs: { existingSurface: "Concrete", asphaltThicknessIn: -4 }, override: null };
    });
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sels = result.project.alternatives[0].selections;
      expect(sels.sidewalk.inputs).toEqual({ widthFt: 8 });
      expect(sels.reconstruction.inputs).toEqual({});
      expect(sels.mill_overlay.enabled).toBe(true);
      expect(sels.reconstruction.enabled).toBe(false);
      expect(result.issues.map((i) => i.code)).toContain("multiple_base");
      expect(result.issues.filter((i) => i.code === "invalid_input_value")).toHaveLength(4);
    }
  });

  it("drops selections for unknown elements", () => {
    const text = fileText((f) => {
      f.project.alternatives[0].selections.not_an_element = { enabled: true, inputs: {}, override: null };
    });
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.project.alternatives[0].selections)).not.toContain("not_an_element");
      expect(result.issues.some((i) => i.code === "unknown_element")).toBe(true);
    }
  });

  it("ignores prototype keys in selections and inputs", () => {
    const text = buildShareFile(makeProject(), { state: "CO", priceBasisLabel: "b" }, NOW)
      .replace('"thicknessIn": 3', '"__proto__": {"polluted": 1}, "constructor": 5, "prototype": 6, "thicknessIn": 3')
      .replace('"mill_overlay": {', '"__proto__": {"enabled": true, "inputs": {}, "override": null}, "mill_overlay": {');
    expect(text).toContain("__proto__");
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      const sels = result.project.alternatives[0].selections;
      expect(Object.keys(sels).sort()).toEqual(["base_none", "mill_overlay"]);
      expect(Object.keys(sels.mill_overlay.inputs).sort()).toEqual(["materialFactor", "thicknessIn"]);
      expect(Object.getPrototypeOf(sels)).toBe(Object.prototype);
      expect(({} as any).polluted).toBeUndefined();
      expect(result.issues.some((i) => i.code === "unknown_element")).toBe(false);
    }
  });

  it("falls back to the first alternative when selectedAlternativeId is unknown", () => {
    const result = parseShareFile(fileText((f) => { f.project.selectedAlternativeId = "zzz"; }), library);
    expect(result.ok && result.project.selectedAlternativeId).toBe("a1");
  });

  it("coerces names, description, and revision", () => {
    const text = fileText((f) => {
      f.project.name = "   ";
      f.project.revision = -2;
      f.project.alternatives[0].name = "  Padded  ";
      f.project.alternatives[0].description = 42;
    });
    const result = parseShareFile(text, library);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.project.name).toBe("Untitled");
      expect(result.project.revision).toBe(0);
      expect(result.project.alternatives[0].name).toBe("Padded");
      expect(result.project.alternatives[0].description).toBe("42");
    }
    const frac = parseShareFile(fileText((f) => { f.project.revision = 1.5; }), library);
    expect(frac.ok && frac.project.revision).toBe(0);
  });
});

describe("importProjectCopy", () => {
  it("assigns new ids, remaps selectedAlternativeId, resets revision and dates", () => {
    const original = makeProject();
    let n = 0;
    const copy = importProjectCopy(original, { newId: () => `new${(n += 1)}`, now: NOW });
    expect(copy.id).not.toBe(original.id);
    const ids = copy.alternatives.map((a) => a.id);
    expect(new Set(ids).size).toBe(2);
    expect(ids).not.toContain("a1");
    expect(ids).not.toContain("a2");
    expect(copy.selectedAlternativeId).toBe(ids[1]);
    expect(copy.revision).toBe(0);
    expect(copy.createdAt).toBe(NOW);
    expect(copy.updatedAt).toBe(NOW);
    expect(copy.name).toBe(original.name);
    expect(copy.alternatives.map((a) => a.name)).toEqual(["Option A", "Option B"]);
    expect(copy.alternatives[0].selections).toEqual(original.alternatives[0].selections);
    expect(copy.inputs).toEqual(original.inputs);
  });

  it("shares no references with the input", () => {
    const original = makeProject();
    const snapshot = structuredClone(original);
    const copy = importProjectCopy(original, { newId: () => Math.random().toString(36), now: NOW });
    copy.inputs.lengthMiles = 99;
    copy.engineering.design = 0.9;
    copy.alternatives[0].selections.mill_overlay.inputs.thicknessIn = 99;
    copy.alternatives[0].selections.mill_overlay.enabled = false;
    copy.alternatives.pop();
    expect(original).toEqual(snapshot);
  });
});
