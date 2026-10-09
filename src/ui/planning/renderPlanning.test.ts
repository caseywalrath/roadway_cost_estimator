// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import rawLibrary from "../../../data/planning/co_element_library.json";
import prices from "../../../public/data/states/co/planning_prices.json";
import { calculateAlternative } from "../../planning/calculate";
import { setBudget, setElementOverride } from "../../planning/edit";
import { resolveLibrary, validateLibrary } from "../../planning/library";
import { createProject } from "../../planning/templates";
import type { PlanningProject, PriceTable } from "../../planning/types";
import { formatElementAmount, formatTotalAmount } from "./format";
import { renderLoadError, renderNewProjectPanel, renderPlanningView, type PlanningViewModel } from "./renderPlanning";

const validated = validateLibrary(rawLibrary);
if (!validated.ok) throw new Error("library invalid");
const { library } = resolveLibrary(validated.value, prices as unknown as PriceTable);

function makeVm(project: PlanningProject, extra: Partial<PlanningViewModel> = {}): PlanningViewModel {
  const result = calculateAlternative(library, project);
  return {
    library,
    project,
    projects: [{ id: project.id, name: project.name, updatedAt: project.updatedAt, revision: 0 }],
    result,
    altTotals: { [project.selectedAlternativeId]: result.summary.total },
    basePreview: {},
    openDetails: new Set(),
    addAltOpen: false,
    addAltName: "Alternative B",
    renaming: false,
    saveStatus: { kind: "saved", at: "2026-01-01T12:00:00.000Z" },
    notice: null,
    canCreateProject: false,
    ...extra
  };
}

const complete = createProject(library, { id: "p1", name: "Main Street", now: "2026-01-01T00:00:00.000Z", templateId: "complete_street", alternativeId: "a1" });

function render(vm: PlanningViewModel): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = renderPlanningView(vm);
  return div;
}

describe("renderPlanningView", () => {
  const vm = makeVm(complete);
  const root = render(vm);

  it("renders the header, corridor strip, groups and summary", () => {
    expect(root.querySelector("[data-planning-root]")).not.toBeNull();
    expect(root.querySelector("[data-planning-project-name]")?.textContent).toBe("Main Street");
    expect(root.querySelector(".planning-header .eyebrow")?.textContent).toBe("Planning estimate");
    expect(root.textContent).toContain("Started from Complete street");
    expect(root.querySelectorAll("[data-planning-project-input]").length).toBe(3);
    expect(root.querySelectorAll("fieldset.planning-group").length).toBe(4);
    expect(root.querySelector("[data-planning-group='base'] .planning-group-heading")?.textContent).toContain("Choose one");
    expect(root.querySelector(".planning-summary")?.getAttribute("id")).toBe("planning-summary");
    expect(root.querySelector(".planning-total-bar")).not.toBeNull();
    expect(root.textContent).toContain(`Prices: ${library.priceBasisLabel}`);
  });

  it("offers print, CSV and JSON export in that order", () => {
    const kinds = [...root.querySelectorAll<HTMLElement>("[data-planning-export]")].map((b) => b.dataset.planningExport);
    expect(kinds).toEqual(["print", "csv", "json"]);
  });

  it("uses radios for the base group and checkboxes for corridor elements", () => {
    const radios = root.querySelectorAll<HTMLInputElement>("[data-planning-group='base'] input[type='radio']");
    expect(radios.length).toBe(4);
    expect([...radios].filter((r) => r.checked).map((r) => r.value)).toEqual(["reconstruction"]);
    expect(root.querySelectorAll("[data-planning-group='corridor'] input[type='checkbox']").length).toBeGreaterThan(3);
    expect(root.querySelector("[data-element-row='base_none'] .muted")?.textContent).toBe("Elements only");
    expect(root.querySelector("[data-element-row='base_none'] [data-element-amount]")).toBeNull();
  });

  it("shows calculated amounts rounded to $1,000 and totals to $10,000", () => {
    const result = vm.result;
    const recon = result.elements.find((e) => e.elementId === "reconstruction")!;
    const box = root.querySelector<HTMLInputElement>("[data-element-amount='reconstruction']")!;
    expect(box.value).toBe(formatElementAmount(recon.calculated).replace("$", ""));
    expect(box.value).toMatch(/^\d{1,3}(,\d{3})*$/);
    expect(box.value.endsWith(",000")).toBe(true);
    expect(root.querySelector("[data-summary='total']")?.textContent).toBe(formatTotalAmount(result.summary.total));
    expect(root.querySelector("[data-summary='construction']")?.textContent).toBe(formatElementAmount(result.summary.construction));
    expect(root.querySelector("[data-summary='rightOfWay']")?.textContent).toBe("Not included");
  });

  it("marks unselected rows with the off class and keeps selected rows plain", () => {
    expect(root.querySelector("[data-element-row='reconstruction']")?.classList.contains("planning-row--off")).toBe(false);
    expect(root.querySelector("[data-element-row='signal']")?.classList.contains("planning-row--off")).toBe(true);
    expect(root.querySelector<HTMLInputElement>("[data-element-amount='signal']")?.getAttribute("aria-label")).toBe("New or rebuilt signal amount in dollars, not included");
  });

  it("renders row details, components with sources, and the allowance line", () => {
    const row = root.querySelector("[data-element-row='curb_gutter']")!;
    expect(row.querySelector("details.planning-row-details")).not.toBeNull();
    expect(row.querySelector("[data-element-brief]")?.textContent).toContain("0.50 mi");
    expect(row.querySelector("[data-element-components]")?.textContent).toContain("allowance (minor items");
    expect(row.querySelector("[data-element-components] small[title]")).not.toBeNull();
    expect(row.querySelector("[data-element-inputs] [data-input-key='lengthMiles']")).not.toBeNull();
  });

  it("shows no reset link until an amount is overridden, then shows the calculated amount", () => {
    expect(root.querySelector("[data-element-reset]")).toBeNull();
    const calculated = vm.result.elements.find((e) => e.elementId === "curb_gutter")!.calculated;
    const overridden = render(makeVm(setElementOverride(complete, "a1", "curb_gutter", 0)));
    expect(overridden.querySelector<HTMLInputElement>("[data-element-amount='curb_gutter']")?.value).toBe("0");
    expect(overridden.querySelector("[data-element-reset='curb_gutter']")?.textContent).toBe(`Reset to calculated ${formatElementAmount(calculated)}`);
  });

  it("renders other costs as plain dollar boxes with a placeholder", () => {
    const box = root.querySelector<HTMLInputElement>("[data-element-amount='right_of_way']")!;
    expect(box.placeholder).toBe("Not included");
    expect(box.value).toBe("");
    const withRow = render(makeVm(setElementOverride(complete, "a1", "right_of_way", 250000)));
    expect(withRow.querySelector<HTMLInputElement>("[data-element-amount='right_of_way']")?.value).toBe("250,000");
    expect(withRow.querySelector("[data-summary='rightOfWay']")?.textContent).toBe("$250,000");
  });

  it("shows the budget line with an under or over class", () => {
    expect(root.querySelector("[data-summary='budgetLine']")?.hasAttribute("hidden")).toBe(true);
    const total = vm.result.summary.total;
    const under = render(makeVm(setBudget(complete, total + 500000)));
    expect(under.querySelector("[data-summary='budgetRemaining']")?.className).toBe("planning-budget--under");
    expect(under.querySelector("[data-summary='budgetRemaining']")?.textContent).toContain("remaining");
    expect(under.querySelector("[data-summary='budgetShort']")?.textContent).toContain("under budget");
    const over = render(makeVm(setBudget(complete, total - 500000)));
    expect(over.querySelector("[data-summary='budgetRemaining']")?.className).toBe("planning-budget--over");
    expect(over.querySelector("[data-summary='budgetRemaining']")?.textContent).toContain("over budget");
  });

  it("marks the selected alternative with aria-pressed and disables Delete for one alternative", () => {
    const button = root.querySelector("[data-planning-alt='a1']")!;
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.classList.contains("app-view-tab--active")).toBe(true);
    expect(root.querySelector<HTMLButtonElement>("[data-planning-delete-alt]")?.disabled).toBe(true);
  });

  it("escapes project and alternative names", () => {
    const hostile = { ...complete, name: '<img src=x onerror="1">' };
    const out = render(makeVm(hostile));
    expect(out.querySelector("img")).toBeNull();
    expect(out.querySelector("[data-planning-project-name]")?.textContent).toBe('<img src=x onerror="1">');
  });

  it("shows the conflict message with a reload button", () => {
    const out = render(makeVm(complete, { saveStatus: { kind: "conflict" } }));
    expect(out.querySelector("[data-planning-save-status]")?.textContent).toContain("changed in another tab");
    expect(out.querySelector("[data-planning-reload]")?.textContent).toBe("Reload saved version");
  });

  it("carries no hard-coded color style anywhere in the output", () => {
    const html = [renderPlanningView(makeVm(setBudget(complete, 1))), renderNewProjectPanel(library, { name: "", templateId: null, inputs: complete.inputs, error: "" }, true), renderLoadError("x")].join("");
    const holder = document.createElement("div");
    holder.innerHTML = html;
    for (const el of holder.querySelectorAll("[style]")) {
      expect(el.getAttribute("style") ?? "").not.toMatch(/#[0-9a-f]{3,6}\b|rgb|color/i);
    }
    expect(html).not.toMatch(/style="[^"]*(#[0-9a-f]{3,6}|rgb)/i);
    expect(html).not.toMatch(/<style/i);
  });
});

describe("renderNewProjectPanel", () => {
  const draft = { name: "", templateId: "mill_overlay" as string | null, inputs: complete.inputs, error: "" };

  it("lists each template plus Blank and prefills the corridor fields", () => {
    const panel = document.createElement("div");
    panel.innerHTML = renderNewProjectPanel(library, draft, false);
    const radios = panel.querySelectorAll<HTMLInputElement>("input[name='planning-template']");
    expect(radios.length).toBe(library.templates.length + 1);
    expect([...radios].find((r) => r.checked)?.value).toBe("mill_overlay");
    expect(panel.querySelector("h2")?.textContent).toBe("Start a planning estimate");
    expect(panel.querySelectorAll("[data-planning-new-input]").length).toBe(3);
    expect(panel.querySelector("[data-planning-new-cancel]")).toBeNull();
    expect(panel.querySelector("[data-planning-create]")?.textContent).toBe("Create project");
  });

  it("shows Cancel when a project already exists and checks Blank for a null template", () => {
    const panel = document.createElement("div");
    panel.innerHTML = renderNewProjectPanel(library, { ...draft, templateId: null }, true);
    expect(panel.querySelector("[data-planning-new-cancel]")).not.toBeNull();
    expect(panel.querySelector<HTMLInputElement>("input[name='planning-template'][value='']")?.checked).toBe(true);
  });
});

describe("renderLoadError", () => {
  it("shows the plain message and the error text", () => {
    const out = document.createElement("div");
    out.innerHTML = renderLoadError("HTTP 500 <b>");
    expect(out.textContent).toContain("Planning prices could not be loaded. Reload the page to try again.");
    expect(out.textContent).toContain("HTTP 500 <b>");
    expect(out.querySelector("b")).toBeNull();
  });
});
