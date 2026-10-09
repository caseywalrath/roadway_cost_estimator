// @vitest-environment jsdom
import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import rawLibrary from "../../../data/planning/co_element_library.json";
import prices from "../../../public/data/states/co/planning_prices.json";
import { calculateAlternative, roundElementAmount, roundTotalAmount } from "../../planning/calculate";
import { resolveLibrary, validateLibrary } from "../../planning/library";
import { openPlanningStore } from "../../planning/storage";
import { createProject } from "../../planning/templates";
import type { PriceTable } from "../../planning/types";
import { createPlanningController, type PlanningController } from "./planningController";

const validated = validateLibrary(rawLibrary);
if (!validated.ok) throw new Error("library invalid");
const { library } = resolveLibrary(validated.value, prices as unknown as PriceTable);

const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const totalText = (n: number) => money(roundTotalAmount(n));

let factory: IDBFactory;
let counter: number;
let clock: number;
let containers: HTMLElement[];
let controllers: PlanningController[];
let downloads: Array<{ filename: string; text: string; mimeType: string }>;

beforeEach(() => {
  factory = new IDBFactory();
  counter = 0;
  clock = 0;
  containers = [];
  controllers = [];
  downloads = [];
});

afterEach(() => {
  for (const c of controllers) c.unmount();
  for (const el of containers) el.remove();
  vi.restoreAllMocks();
});

function makeController(overrides: Partial<Parameters<typeof createPlanningController>[0]> = {}): PlanningController {
  const controller = createPlanningController({
    loadLibrary: async () => ({ library, issues: [] }),
    openStore: () => openPlanningStore({ factory }),
    now: () => new Date(Date.UTC(2026, 0, 1, 12, 0, clock++)).toISOString(),
    newId: () => `id-${++counter}`,
    saveDelayMs: 5,
    download: (filename, text, mimeType) => downloads.push({ filename, text, mimeType }),
    ...overrides
  });
  controllers.push(controller);
  return controller;
}

function makeContainer(): HTMLElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  containers.push(el);
  return el;
}

async function open(overrides = {}): Promise<{ controller: PlanningController; root: HTMLElement }> {
  const controller = makeController(overrides);
  const root = makeContainer();
  controller.mount(root);
  await controller.flush();
  return { controller, root };
}

function setValue(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, value: string): void {
  el.value = value;
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

const q = <T extends HTMLElement = HTMLElement>(root: ParentNode, selector: string): T => {
  const found = root.querySelector<T>(selector);
  if (!found) throw new Error(`Missing ${selector}`);
  return found;
};

async function createStreet(root: HTMLElement, controller: PlanningController, templateId = "complete_street", name = "Main Street"): Promise<void> {
  setValue(q<HTMLInputElement>(root, "[data-planning-new-name]"), name);
  const radio = q<HTMLInputElement>(root, `input[name='planning-template'][value='${templateId}']`);
  radio.checked = true;
  radio.dispatchEvent(new Event("change", { bubbles: true }));
  q(root, "[data-planning-create]").click();
  await controller.flush();
}

function expectedTotal(templateId: string): number {
  const project = createProject(library, { id: "x", name: "x", now: "2026-01-01T00:00:00.000Z", templateId, alternativeId: "y" });
  return calculateAlternative(library, project).summary.total;
}

const summaryTotal = (root: HTMLElement) => q(root, "aside [data-summary='total']").textContent;

describe("opening", () => {
  it("shows a loading message, then the new-project panel when nothing is saved", async () => {
    const controller = makeController();
    const root = makeContainer();
    controller.mount(root);
    expect(root.textContent).toContain("Loading");
    await controller.flush();
    expect(root.querySelector("[data-planning-new]")).not.toBeNull();
    expect(root.querySelector("[data-planning-new-cancel]")).toBeNull();
  });

  it("shows the error renderer when the library cannot load", async () => {
    const { root } = await open({ loadLibrary: async () => { throw new Error("HTTP 500"); } });
    expect(root.textContent).toContain("Planning prices could not be loaded. Reload the page to try again.");
    expect(root.textContent).toContain("HTTP 500");
  });

  it("falls back to memory with a notice when storage is blocked", async () => {
    const { controller, root } = await open({ openStore: async () => { throw new Error("blocked"); } });
    expect(root.querySelector("[data-planning-notice]")?.textContent).toContain("cannot be saved in this browser");
    await createStreet(root, controller);
    expect(q(root, "[data-planning-project-name]").textContent).toBe("Main Street");
    expect(q(root, "[data-planning-notice]").textContent).toContain("cannot be saved in this browser");
  });
});

describe("creating and editing", () => {
  it("creates a project from complete_street and shows the rounded total", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    expect(q(root, "[data-planning-project-name]").textContent).toBe("Main Street");
    expect(root.textContent).toContain("Started from Complete street");
    expect(summaryTotal(root)).toBe(totalText(expectedTotal("complete_street")));
    expect(q(root, "[data-summary='total']").textContent).toBe(totalText(expectedTotal("complete_street")));
  });

  it("requires a project name", async () => {
    const { controller, root } = await open();
    q(root, "[data-planning-create]").click();
    await controller.flush();
    expect(q(root, "[data-planning-new-error]").textContent).toBe("Enter a project name.");
    expect(root.querySelector("[data-planning-new]")).not.toBeNull();
  });

  it("creates a blank project with only the no-base row selected", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller, "", "Blank one");
    expect(q<HTMLInputElement>(root, "[data-element-toggle='base_none']").checked).toBe(true);
    expect(summaryTotal(root)).toBe("$0");
    expect(root.textContent).toContain("Started from a blank project");
  });

  it("toggles an element and updates the total without replacing the focused input", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const before = summaryTotal(root);
    const rowBox = q<HTMLInputElement>(root, "[data-element-amount='right_of_way']");
    rowBox.focus();
    expect(document.activeElement).toBe(rowBox);
    const toggle = q<HTMLInputElement>(root, "[data-element-toggle='rrfb']");
    expect(q(root, "[data-element-row='rrfb']").classList.contains("planning-row--off")).toBe(true);
    toggle.checked = true;
    toggle.dispatchEvent(new Event("change", { bubbles: true }));
    expect(summaryTotal(root)).not.toBe(before);
    expect(q(root, "[data-element-row='rrfb']").classList.contains("planning-row--off")).toBe(false);
    expect(q(root, "[data-element-amount='right_of_way']")).toBe(rowBox);
    expect(document.activeElement).toBe(rowBox);
    expect(q(root, "[data-summary='total']").textContent).toBe(summaryTotal(root));
    expect(q(root, "[data-planning-announce]").textContent).toContain("Total");
  });

  it("overrides an amount, shows the reset link, and restores the calculated amount", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const box = q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']");
    const calculatedText = box.value;
    const before = summaryTotal(root);
    expect(root.querySelector("[data-element-reset='curb_gutter']")).toBeNull();
    setValue(box, "1234567");
    expect(box.value).toBe("1,234,567");
    expect(q(root, "[data-element-reset='curb_gutter']").textContent).toBe(`Reset to calculated $${calculatedText}`);
    expect(summaryTotal(root)).not.toBe(before);
    q(root, "[data-element-reset='curb_gutter']").click();
    expect(root.querySelector("[data-element-reset='curb_gutter']")).toBeNull();
    expect(box.value).toBe(calculatedText);
    expect(summaryTotal(root)).toBe(before);
  });

  it("treats 0 as a valid override and blank as the calculated amount", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const box = q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']");
    const calculatedText = box.value;
    setValue(box, "0");
    expect(box.value).toBe("0");
    expect(root.querySelector("[data-element-reset='curb_gutter']")).not.toBeNull();
    setValue(box, "");
    expect(box.value).toBe(calculatedText);
    expect(root.querySelector("[data-element-reset='curb_gutter']")).toBeNull();
  });

  it("turns an off row on when an amount is typed in it", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    setValue(q<HTMLInputElement>(root, "[data-element-amount='signal']"), "500,000");
    expect(q<HTMLInputElement>(root, "[data-element-toggle='signal']").checked).toBe(true);
    expect(q(root, "[data-element-row='signal']").classList.contains("planning-row--off")).toBe(false);
  });

  it("rejects invalid dollar text, keeps it, and reverts on Escape", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const box = q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']");
    const before = summaryTotal(root);
    const original = box.value;
    box.focus();
    setValue(box, "abc");
    expect(box.value).toBe("abc");
    expect(box.getAttribute("aria-invalid")).toBe("true");
    expect(q(root, "[data-element-error='curb_gutter']").textContent).toContain("Enter a dollar amount of 0 or more");
    expect(summaryTotal(root)).toBe(before);
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(box.value).toBe(original);
    expect(box.hasAttribute("aria-invalid")).toBe(false);
    setValue(box, "-5");
    expect(box.getAttribute("aria-invalid")).toBe("true");
  });

  it("commits on Enter without moving focus", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const box = q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']");
    const before = summaryTotal(root);
    box.focus();
    box.value = "2000000";
    box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(box.value).toBe("2,000,000");
    expect(document.activeElement).toBe(box);
    expect(summaryTotal(root)).not.toBe(before);
  });

  it("selects one base treatment at a time", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const before = summaryTotal(root);
    const radio = q<HTMLInputElement>(root, "[data-element-toggle='mill_overlay']");
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    const checked = [...root.querySelectorAll<HTMLInputElement>("[data-planning-group='base'] input[type='radio']")].filter((r) => r.checked);
    expect(checked.map((r) => r.value)).toEqual(["mill_overlay"]);
    expect(q(root, "[data-element-row='reconstruction']").classList.contains("planning-row--off")).toBe(true);
    expect(summaryTotal(root)).not.toBe(before);
  });

  it("shows an unselected base treatment's own amount, greyed", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const preview = q<HTMLInputElement>(root, "[data-element-amount='mill_overlay']").value;
    expect(preview).toMatch(/^[\d,]+$/);
    expect(preview).not.toBe("0");
    const radio = q<HTMLInputElement>(root, "[data-element-toggle='mill_overlay']");
    radio.checked = true;
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    expect(q<HTMLInputElement>(root, "[data-element-amount='mill_overlay']").value).toBe(preview);
  });

  it("updates inherited element inputs when a corridor value changes", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const before = summaryTotal(root);
    const length = q<HTMLInputElement>(root, "[data-element-inputs='curb_gutter'] [data-input-key='lengthMiles']");
    expect(length.value).toBe("0.5");
    setValue(q<HTMLInputElement>(root, "[data-planning-project-input='lengthMiles']"), "1");
    expect(length.value).toBe("1");
    expect(summaryTotal(root)).not.toBe(before);
    setValue(length, "2");
    expect(root.querySelector("[data-element-input-reset='curb_gutter']")?.textContent).toBe("Use corridor value (1 mi)");
    q(root, "[data-element-input-reset='curb_gutter']").click();
    expect(length.value).toBe("1");
  });

  it("rejects decimals in the intersections field", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const field = q<HTMLInputElement>(root, "[data-planning-project-input='intersections']");
    setValue(field, "2.5");
    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.closest("label")?.querySelector(".filter-validation-message")?.textContent).toBe("Enter a whole number of 0 or more.");
  });

  it("re-renders conditional inputs and keeps focus on the select", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const region = q(root, "[data-element-inputs='reconstruction']");
    const select = q<HTMLSelectElement>(region, "[data-input-key='newSurface']");
    expect(region.querySelector("[data-input-key='asphaltThicknessIn']")).not.toBeNull();
    select.focus();
    setValue(select, "concrete");
    expect(region.querySelector("[data-input-key='asphaltThicknessIn']")).toBeNull();
    expect(document.activeElement).toBe(q(region, "[data-input-key='newSurface']"));
  });

  it("sets design percent and stage", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const before = summaryTotal(root);
    setValue(q<HTMLInputElement>(root, "[data-planning-rate='design']"), "20");
    expect(summaryTotal(root)).not.toBe(before);
    setValue(q<HTMLInputElement>(root, "[data-planning-rate='design']"), "150");
    expect(q(root, "[data-planning-summary-error]").textContent).toBe("Enter a percent from 0 to 100.");
    const stage = q<HTMLSelectElement>(root, "[data-planning-stage]");
    setValue(stage, "planning_study");
    expect(q(root, "aside [data-summary='contingencyRate']").textContent).toBe("25%");
  });

  it("shows budget remaining with under and over classes", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const total = expectedTotal("complete_street");
    const budget = q<HTMLInputElement>(root, "[data-planning-budget]");
    setValue(budget, String(Math.round(total + 500000)));
    let remaining = q(root, "[data-summary='budgetRemaining']");
    expect(q(root, "[data-summary='budgetLine']").hidden).toBe(false);
    expect(remaining.className).toBe("planning-budget--under");
    expect(remaining.textContent).toBe(`${money(roundElementAmount(Math.round(total + 500000) - total))} remaining`);
    expect(q(root, "[data-summary='budgetShort']").className).toBe("planning-budget--under");
    setValue(budget, String(Math.round(total - 500000)));
    remaining = q(root, "[data-summary='budgetRemaining']");
    expect(remaining.className).toBe("planning-budget--over");
    expect(remaining.textContent).toContain("over budget");
    setValue(budget, "");
    expect(q(root, "[data-summary='budgetLine']").hidden).toBe(true);
    setValue(budget, "lots");
    expect(budget.getAttribute("aria-invalid")).toBe("true");
  });
});

describe("alternatives", () => {
  it("adds an alternative from a template, switches between alternatives, and keeps both totals", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const firstTotal = summaryTotal(root);
    q(root, "[data-planning-add-alt]").click();
    const form = q(root, "[data-planning-add-alt-form]");
    expect(form.hidden).toBe(false);
    expect(q(root, "[data-planning-add-alt]").getAttribute("aria-expanded")).toBe("true");
    expect(q<HTMLInputElement>(root, "[data-planning-add-alt-name]").value).toBe("Alternative B");
    q<HTMLSelectElement>(root, "[data-planning-add-alt-template]").value = "mill_overlay";
    q(root, "[data-planning-add-alt-confirm]").click();
    const buttons = root.querySelectorAll("[data-planning-alt]");
    expect(buttons.length).toBe(2);
    expect(q<HTMLInputElement>(root, "[data-planning-alt-name]").value).toBe("Alternative B");
    const secondTotal = summaryTotal(root);
    expect(secondTotal).toBe(totalText(expectedTotal("mill_overlay")));
    expect(secondTotal).not.toBe(firstTotal);
    const firstButton = buttons[0] as HTMLElement;
    expect(firstButton.querySelector("small")?.textContent).toBe(firstTotal);
    firstButton.click();
    expect(summaryTotal(root)).toBe(firstTotal);
    expect(q(root, "[data-planning-alt]").getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelectorAll("[data-planning-alt][aria-pressed='true']").length).toBe(1);
  });

  it("renames, duplicates and deletes with confirmation", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    setValue(q<HTMLInputElement>(root, "[data-planning-alt-name]"), "Preferred");
    expect(q(root, "[data-alt-name]").textContent).toBe("Preferred");
    expect(q(root, "[data-summary='altName']").textContent).toBe("Preferred");
    setValue(q<HTMLInputElement>(root, "[data-planning-alt-name]"), "  ");
    expect(q<HTMLInputElement>(root, "[data-planning-alt-name]").getAttribute("aria-invalid")).toBe("true");
    q(root, "[data-planning-duplicate-alt]").click();
    expect(root.querySelectorAll("[data-planning-alt]").length).toBe(2);
    expect(q<HTMLInputElement>(root, "[data-planning-alt-name]").value).toBe("Preferred copy");
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    q(root, "[data-planning-delete-alt]").click();
    expect(confirm).toHaveBeenCalledWith("Delete Preferred copy? This cannot be undone.");
    expect(root.querySelectorAll("[data-planning-alt]").length).toBe(2);
    confirm.mockReturnValue(true);
    q(root, "[data-planning-delete-alt]").click();
    expect(root.querySelectorAll("[data-planning-alt]").length).toBe(1);
    expect(q<HTMLButtonElement>(root, "[data-planning-delete-alt]").disabled).toBe(true);
  });

  it("closes the add form with Escape", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    q(root, "[data-planning-add-alt]").click();
    q(root, "[data-planning-add-alt-name]").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(q(root, "[data-planning-add-alt-form]").hidden).toBe(true);
    expect(q(root, "[data-planning-add-alt]").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("persistence", () => {
  it("reloads saved data in a new controller over the same database", async () => {
    const first = await open();
    await createStreet(first.root, first.controller);
    setValue(q<HTMLInputElement>(first.root, "[data-element-amount='curb_gutter']"), "999000");
    setValue(q<HTMLInputElement>(first.root, "[data-planning-budget]"), "40000000");
    setValue(q<HTMLInputElement>(first.root, "[data-planning-project-input='lengthMiles']"), "0.75");
    const total = summaryTotal(first.root);
    await first.controller.flush();
    expect(q(first.root, "[data-planning-save-status]").textContent).toMatch(/^Saved/);
    first.controller.unmount();

    const second = await open();
    expect(q(second.root, "[data-planning-project-name]").textContent).toBe("Main Street");
    expect(summaryTotal(second.root)).toBe(total);
    expect(q<HTMLInputElement>(second.root, "[data-element-amount='curb_gutter']").value).toBe("999,000");
    expect(q<HTMLInputElement>(second.root, "[data-planning-budget]").value).toBe("40,000,000");
    expect(q<HTMLInputElement>(second.root, "[data-planning-project-input='lengthMiles']").value).toBe("0.75");
    expect(q(second.root, "[data-element-reset='curb_gutter']")).not.toBeNull();
  });

  it("keeps state when mounted again on a different container", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    setValue(q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']"), "999000");
    const total = summaryTotal(root);
    const next = makeContainer();
    controller.mount(next);
    expect(q(next, "[data-planning-project-name]").textContent).toBe("Main Street");
    expect(summaryTotal(next)).toBe(total);
    expect(q<HTMLInputElement>(next, "[data-element-amount='curb_gutter']").value).toBe("999,000");
    // The old container no longer reacts.
    setValue(q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']"), "1");
    expect(summaryTotal(next)).toBe(total);
    // The new container does.
    setValue(q<HTMLInputElement>(next, "[data-element-amount='curb_gutter']"), "5000000");
    expect(summaryTotal(next)).not.toBe(total);
    await controller.flush();
  });

  it("keeps open disclosures across an alternative switch", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    const details = q<HTMLDetailsElement>(root, "[data-element-details='curb_gutter']");
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    q(root, "[data-planning-add-alt]").click();
    q(root, "[data-planning-add-alt-confirm]").click();
    expect(q<HTMLDetailsElement>(root, "[data-element-details='curb_gutter']").open).toBe(true);
  });

  it("shows a conflict message and reloads the saved version without overwriting", async () => {
    const a = await open();
    await createStreet(a.root, a.controller);
    await a.controller.flush();
    const b = await open();
    setValue(q<HTMLInputElement>(a.root, "[data-planning-budget]"), "11111111");
    await a.controller.flush();
    setValue(q<HTMLInputElement>(b.root, "[data-planning-budget]"), "22222222");
    await b.controller.flush();
    const status = q(b.root, "[data-planning-save-status]");
    expect(status.textContent).toContain("changed in another tab");
    q(b.root, "[data-planning-reload]").click();
    await b.controller.flush();
    expect(q<HTMLInputElement>(b.root, "[data-planning-budget]").value).toBe("11,111,111");
    expect(q(b.root, "[data-planning-save-status]").textContent).toMatch(/^Saved/);
  });

  it("flushes a pending edit immediately", async () => {
    const { controller, root } = await open({ saveDelayMs: 60_000 });
    await createStreet(root, controller);
    setValue(q<HTMLInputElement>(root, "[data-planning-budget]"), "5000000");
    expect(q(root, "[data-planning-save-status]").textContent).toBe("Saving…");
    await controller.flush();
    expect(q(root, "[data-planning-save-status]").textContent).toMatch(/^Saved/);
    const store = await openPlanningStore({ factory });
    const saved = await store.getProject("id-1");
    expect(saved?.budget).toBe(5000000);
    store.close();
  });
});

describe("project management", () => {
  it("creates a second project, switches back, renames and deletes", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller, "mill_overlay", "First");
    q(root, "[data-planning-new-project]").click();
    expect(q(root, "[data-planning-new-cancel]")).not.toBeNull();
    await createStreet(root, controller, "complete_street", "Second");
    expect(q(root, "[data-planning-project-name]").textContent).toBe("Second");
    const items = root.querySelectorAll<HTMLButtonElement>("[data-planning-open-project]");
    expect([...items].map((b) => b.textContent).sort()).toEqual(["First", "Second"]);
    expect(q<HTMLButtonElement>(root, "[data-planning-open-project='id-1']").disabled).toBe(false);
    expect(q<HTMLButtonElement>(root, "[data-planning-open-project='id-3']").disabled).toBe(true);
    const first = [...items].find((b) => b.textContent === "First")!;
    first.click();
    await controller.flush();
    expect(q(root, "[data-planning-project-name]").textContent).toBe("First");

    q(root, "[data-planning-rename-project]").click();
    const input = q<HTMLInputElement>(root, "[data-planning-rename-input]");
    input.value = "  ";
    q(root, "[data-planning-rename-save]").click();
    expect(q(root, "[data-planning-rename-error]").textContent).toBe("Enter a project name.");
    input.value = "Renamed";
    q(root, "[data-planning-rename-save]").click();
    expect(q(root, "[data-planning-project-name]").textContent).toBe("Renamed");
    await controller.flush();
    expect([...root.querySelectorAll("[data-planning-open-project]")].map((b) => b.textContent)).toContain("Renamed");

    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    q(root, "[data-planning-delete-project]").click();
    await controller.flush();
    expect(confirm).toHaveBeenCalledWith("Delete planning project Renamed? This cannot be undone.");
    expect(q(root, "[data-planning-project-name]").textContent).toBe("Second");
    q(root, "[data-planning-delete-project]").click();
    await controller.flush();
    expect(root.querySelector("[data-planning-new]")).not.toBeNull();
  });

  it("cancels the delete when not confirmed", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    vi.spyOn(window, "confirm").mockReturnValue(false);
    q(root, "[data-planning-delete-project]").click();
    await controller.flush();
    expect(q(root, "[data-planning-project-name]").textContent).toBe("Main Street");
  });

  it("exports JSON and imports it as a new project", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    setValue(q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']"), "777000");
    q(root, "[data-planning-export='json']").click();
    expect(downloads.length).toBe(1);
    expect(downloads[0].filename).toBe("Main Street.planning.json");
    expect(downloads[0].mimeType).toBe("application/json");
    expect(JSON.parse(downloads[0].text).project.name).toBe("Main Street");

    const input = q<HTMLInputElement>(root, "[data-planning-import-input]");
    const file = new File([downloads[0].text], "Main Street.planning.json", { type: "application/json" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await controller.flush();
    expect(q(root, "[data-planning-notice]").textContent).toBe("Imported Main Street as a new planning project.");
    expect(q<HTMLInputElement>(root, "[data-element-amount='curb_gutter']").value).toBe("777,000");
    expect(root.querySelectorAll("[data-planning-open-project]").length).toBe(2);
  });

  it("reports an invalid import file", async () => {
    const { controller, root } = await open();
    const input = q<HTMLInputElement>(root, "[data-planning-import-input]");
    Object.defineProperty(input, "files", { value: [new File(["not json"], "bad.json")], configurable: true });
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await controller.flush();
    expect(q(root, "[data-planning-notice]").textContent).toBe("Could not import bad.json: The file is not valid JSON.");
    expect(root.querySelector("[data-planning-new]")).not.toBeNull();
  });

  it("downloads CSV with the csv mime type", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    q(root, "[data-planning-export='csv']").click();
    expect(downloads.length).toBe(1);
    expect(downloads[0].filename.endsWith(".planning.csv")).toBe(true);
    expect(downloads[0].mimeType).toBe("text/csv;charset=utf-8");
    expect(downloads[0].text).toContain("Main Street");
  });

  it("prints the summary and cleans up after printing", async () => {
    const print = vi.fn(() => {
      expect(document.body.querySelector(".planning-print")).not.toBeNull();
      expect(document.body.classList.contains("planning-printing")).toBe(true);
    });
    const { controller, root } = await open({ print });
    await createStreet(root, controller);
    q(root, "[data-planning-export='print']").click();
    expect(print).toHaveBeenCalledTimes(1);
    expect(document.body.querySelectorAll(".planning-print").length).toBe(1);
    expect(document.body.querySelector(".planning-print h1")?.textContent).toBe("Main Street");
    q(root, "[data-planning-export='print']").click();
    expect(document.body.querySelectorAll(".planning-print").length).toBe(1);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.querySelector(".planning-print")).toBeNull();
    expect(document.body.classList.contains("planning-printing")).toBe(false);
  });

  it("hides Create engineer Project when the host supplies no handoff", async () => {
    const { controller, root } = await open();
    await createStreet(root, controller);
    expect(root.querySelector("[data-planning-create-project]")).toBeNull();
  });

  it("saves, then hands the selected alternative to the host to create a Project", async () => {
    const calls: Array<{ name: string; alternativeId: string; revision: number }> = [];
    const createEngineerProject = vi.fn(async (_library: unknown, planning: { name: string; revision: number }, alternativeId: string) => {
      calls.push({ name: planning.name, alternativeId, revision: planning.revision });
    });
    const { controller, root } = await open({ createEngineerProject });
    await createStreet(root, controller);
    q(root, "[data-planning-create-project]").click();
    await controller.flush();
    expect(createEngineerProject).toHaveBeenCalledTimes(1);
    expect(calls[0].name).toBe("Main Street");
    expect(calls[0].alternativeId).toBe(q(root, "[data-planning-alt][aria-pressed='true']").dataset.planningAlt);
    expect(calls[0].revision).toBeGreaterThan(0);
  });

  it("shows an error notice when creating the Project fails", async () => {
    const { controller, root } = await open({ createEngineerProject: async () => { throw new Error("storage full"); } });
    await createStreet(root, controller);
    q(root, "[data-planning-create-project]").click();
    await controller.flush();
    expect(root.textContent).toContain("Could not create the engineer Project: storage full");
  });

  it("removes the print markup on unmount", async () => {
    const { controller, root } = await open({ print: () => undefined });
    await createStreet(root, controller);
    q(root, "[data-planning-export='print']").click();
    expect(document.body.querySelector(".planning-print")).not.toBeNull();
    controller.unmount();
    expect(document.body.querySelector(".planning-print")).toBeNull();
    expect(document.body.classList.contains("planning-printing")).toBe(false);
  });
});
