// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import rawLibrary from "../../../data/planning/co_element_library.json";
import prices from "../../../public/data/states/co/planning_prices.json";
import { calculateAlternative } from "../../planning/calculate";
import { addAlternative, renameAlternative, setBudget, setElementOverride } from "../../planning/edit";
import { resolveLibrary, validateLibrary } from "../../planning/library";
import { createProject } from "../../planning/templates";
import type { PlanningProject, PriceTable } from "../../planning/types";
import { formatTotalAmount } from "./format";
import { renderPrintSummary } from "./printSummary";

const validated = validateLibrary(rawLibrary);
if (!validated.ok) throw new Error("library invalid");
const { library } = resolveLibrary(validated.value, prices as unknown as PriceTable);

const base = createProject(library, { id: "p1", name: "Main <b>Street</b>", now: "2026-01-01T00:00:00.000Z", templateId: "complete_street", alternativeId: "a1" });

function render(project: PlanningProject): { html: string; root: HTMLElement } {
  const results = project.alternatives.map((a) => calculateAlternative(library, project, a.id));
  const html = renderPrintSummary(library, project, results, "2026-10-09T12:00:00.000Z");
  const div = document.createElement("div");
  div.innerHTML = html;
  return { html, root: div };
}

describe("renderPrintSummary", () => {
  it("renders the selected alternative on page 1", () => {
    const { root } = render(base);
    expect(root.querySelectorAll(".planning-print").length).toBe(1);
    expect(root.querySelector("h1")?.textContent).toBe("Main <b>Street</b>");
    expect(root.querySelector(".planning-print b")).toBeNull();
    expect(root.textContent).toContain("Colorado · ");
    expect(root.textContent).toContain("Printed October 9, 2026");
    expect(root.textContent).toMatch(/Length 0\.50 mi · Roadway width \d+ ft · \d+ intersections?/);
    expect(root.querySelectorAll("th[colspan='3']").length).toBeGreaterThan(0);
    expect(root.querySelector(".planning-print-page")).toBeNull();
    expect(root.textContent).toContain(formatTotalAmount(calculateAlternative(library, base).summary.total));
    expect(root.textContent).toContain("Not a design estimate.");
  });

  it("marks entered amounts and shows the budget row only when set", () => {
    const entered = setElementOverride(base, "a1", "sidewalk", 1000000);
    const { root } = render(entered);
    expect(root.textContent).toContain("$1,000,000 (entered)");
    expect(root.textContent).not.toContain("Budget $");
    const { root: withBudget } = render(setBudget(entered, 20000000));
    expect(withBudget.textContent).toContain("Budget $20,000,000");
    expect(withBudget.textContent).toMatch(/remaining|over budget/);
  });

  it("adds a comparison page for several alternatives", () => {
    const two = renameAlternative(addAlternative(base, library, "mill_overlay", { id: "a2", name: "Alt <i>B</i>" }), "a1", "Alt A");
    const { root } = render(setBudget(two, 20000000));
    const page = root.querySelector(".planning-print-page");
    expect(page).not.toBeNull();
    expect(page?.querySelector("h2")?.textContent).toBe("Alternatives compared");
    const heads = [...page!.querySelectorAll("thead th")].map((th) => th.textContent);
    expect(heads).toEqual(["Item", "Alt A (selected)", "Alt <i>B</i>"]);
    expect(page?.querySelector("i")).toBeNull();
    expect(page?.textContent).toContain("Budget remaining");
  });

  it("uses singular intersection", () => {
    const one = { ...base, inputs: { ...base.inputs, intersections: 1 } };
    expect(render(one).root.textContent).toMatch(/ 1 intersection(?!s)/);
  });
});
