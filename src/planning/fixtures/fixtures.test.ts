import { describe, expect, it } from "vitest";
import rawLibrary from "../../../data/planning/co_element_library.json";
import prices from "../../../public/data/states/co/planning_prices.json";
import expected from "./expected.json";
import { resolveLibrary, validateLibrary } from "../library";
import { calculateAlternative } from "../calculate";
import type { PriceTable, ProjectInputKey } from "../types";
import { createProject } from "../templates";
import {
  setBaseTreatment,
  setBudget,
  setElementEnabled,
  setElementInput,
  setElementOverride,
  setProjectInput,
  setStage,
} from "../edit";

// Expected values come from fixtures/expected.json, which was computed
// independently in Python from the rules in src/planning/README.md.

type Project = ReturnType<typeof createProject>;
type Summary = ReturnType<typeof calculateAlternative>["summary"];

interface ExpectedComponent {
  id: string;
  quantity: number;
  unitPrice: number;
  amount: number;
}

interface ExpectedElement {
  elementId: string;
  baseElementId: string;
  direct: number;
  multiplier: number;
  calculated: number;
  components: ExpectedComponent[];
}

interface ExpectedSummary {
  baseType: string;
  multiplier: number;
  construction: number;
  contingency: number;
  design: number;
  constructionEngineering: number;
  total: number;
  rangeLow: number;
  rangeHigh: number;
  rightOfWay?: number;
  utilityRelocation?: number;
  budgetRemaining?: number | null;
}

const NOW = "2026-10-09T00:00:00.000Z";
const ALT = "alt";

const validated = validateLibrary(rawLibrary);
if (!validated.ok) {
  throw new Error(`library failed validation: ${JSON.stringify(validated.issues)}`);
}
const { library } = resolveLibrary(validated.value, prices as unknown as PriceTable);

const groupOf = new Map<string, string>(
  rawLibrary.elements.map((e) => [e.id, e.group] as [string, string]),
);

// Template projectInputs (only intersection_safety sets them).
const templateProjectInputs = new Map<string, Record<string, number>>(
  rawLibrary.templates.map(
    (t) =>
      [t.id, (t as { projectInputs?: Record<string, number> }).projectInputs ?? {}] as [
        string,
        Record<string, number>,
      ],
  ),
);

function newProject(templateId: string | null): Project {
  return createProject(library, {
    id: "fixture",
    name: "Fixture",
    now: NOW,
    templateId,
    alternativeId: ALT,
  });
}

// Scenario inputs; keys the template already sets are skipped so the template value wins.
function withScenarioInputs(
  project: Project,
  inputs: Record<string, number>,
  skip: Record<string, number> = {},
): Project {
  let p = project;
  for (const [key, value] of Object.entries(inputs)) {
    if (!(key in skip)) {
      p = setProjectInput(p, key as ProjectInputKey, value);
    }
  }
  return p;
}

function expectElement(
  actual: ReturnType<typeof calculateAlternative>["elements"][number] | undefined,
  exp: ExpectedElement,
  multiplier: number,
) {
  expect(actual, `element ${exp.elementId} missing from result`).toBeDefined();
  if (!actual) return;
  expect(multiplier).toBeCloseTo(exp.multiplier, 6);
  expect(actual.direct).toBeCloseTo(exp.direct, 4);
  expect(actual.calculated).toBeCloseTo(exp.calculated, 4);
  expect(actual.components.map((c) => c.id)).toEqual(exp.components.map((c) => c.id));
  exp.components.forEach((ec, i) => {
    const ac = actual.components[i];
    expect(ac, `component ${ec.id} at index ${i}`).toBeDefined();
    if (!ac) return;
    expect(ac.quantity).toBeCloseTo(ec.quantity, 6);
    expect(ac.unitPrice).toBeCloseTo(ec.unitPrice, 4);
    expect(ac.amount).toBeCloseTo(ec.amount, 4);
  });
}

function expectSummary(actual: Summary, exp: ExpectedSummary) {
  expect(actual.baseType).toBe(exp.baseType);
  expect(actual.multiplier).toBeCloseTo(exp.multiplier, 6);
  expect(actual.construction).toBeCloseTo(exp.construction, 4);
  expect(actual.contingency).toBeCloseTo(exp.contingency, 4);
  expect(actual.design).toBeCloseTo(exp.design, 4);
  expect(actual.constructionEngineering).toBeCloseTo(exp.constructionEngineering, 4);
  expect(actual.total).toBeCloseTo(exp.total, 4);
  expect(actual.rangeLow).toBeCloseTo(exp.rangeLow, 4);
  expect(actual.rangeHigh).toBeCloseTo(exp.rangeHigh, 4);
  if (exp.rightOfWay !== undefined) {
    expect(actual.rightOfWay).toBeCloseTo(exp.rightOfWay, 4);
  }
  if (exp.utilityRelocation !== undefined) {
    expect(actual.utilityRelocation).toBeCloseTo(exp.utilityRelocation, 4);
  }
  if (exp.budgetRemaining === null) {
    expect(actual.budgetRemaining).toBeNull();
  } else if (exp.budgetRemaining !== undefined) {
    expect(actual.budgetRemaining).toBeCloseTo(exp.budgetRemaining, 4);
  }
}

for (const scenario of expected.scenarios) {
  describe(`scenario ${scenario.id}`, () => {
    describe("each element alone (library defaults)", () => {
      for (const el of scenario.elements) {
        it(`${el.elementId} alone`, () => {
          let project = newProject(null);
          project = withScenarioInputs(project, scenario.projectInputs);
          if (groupOf.get(el.elementId) === "base") {
            project = setBaseTreatment(project, library, ALT, el.elementId);
          } else {
            // Corridor and spot elements sit on base_none, which the blank project already enables.
            project = setElementEnabled(project, ALT, el.elementId, true);
          }
          const result = calculateAlternative(library, project);
          const actual = result.elements.find((e) => e.elementId === el.elementId);
          expectElement(actual, el, result.summary.multiplier);
        });
      }
    });

    describe("templates (Concept, no budget, ROW and utilities 0)", () => {
      for (const t of scenario.templates) {
        it(`${t.templateId}`, () => {
          let project = newProject(t.templateId);
          project = withScenarioInputs(
            project,
            scenario.projectInputs,
            templateProjectInputs.get(t.templateId) ?? {},
          );
          project = setStage(project, "concept");
          const { summary } = calculateAlternative(library, project);
          expectSummary(summary, t);
        });
      }
    });

    describe("extra case", () => {
      const ex = scenario.extra;
      it(`${ex.templateId} at ${ex.stageId} with budget, ROW, utilities, overrides and inputs`, () => {
        let project = newProject(ex.templateId);
        project = withScenarioInputs(project, scenario.projectInputs);
        project = setStage(project, ex.stageId);
        project = setBudget(project, ex.budget);
        project = setElementOverride(project, ALT, "right_of_way", ex.rightOfWay);
        project = setElementOverride(project, ALT, "utility_relocation", ex.utilityRelocation);
        for (const [elementId, amount] of Object.entries(ex.overrides)) {
          project = setElementOverride(project, ALT, elementId, amount);
        }
        for (const [elementId, inputs] of Object.entries(ex.inputs)) {
          for (const [key, value] of Object.entries(inputs)) {
            project = setElementInput(project, ALT, elementId, key, value);
          }
        }
        const result = calculateAlternative(library, project);
        expectSummary(result.summary, ex.summary);
        for (const exEl of ex.elements) {
          const actual = result.elements.find((e) => e.elementId === exEl.elementId);
          expectElement(actual, exEl, result.summary.multiplier);
        }
      });
    });
  });
}
