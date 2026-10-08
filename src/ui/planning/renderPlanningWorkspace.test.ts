// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPackageInstance, createPlanningScenario, createPlanningWorkspace } from "../../planning/planningWorkspace";
import { calculateScenarioCosts } from "../../planning/costEngine";
import { NEBRASKA_PILOT_PACKAGES } from "../../planning/recipes/nebraskaPilot";
import { renderPlanningWorkspace } from "./renderPlanningWorkspace";

const timestamp = "2026-10-07T12:00:00.000Z";
function render(edited = false, existingCustom = false, baseKind = "resurfacing", includeCurb = false, includeSidewalk = false, elementPrices: "pending" | "partial" | "complete" = "pending") {
  const scenario = createPlanningScenario({ scenarioId: "alternative", state: "NE", name: "Alternative A", now: timestamp });
  const workspace = createPlanningWorkspace({ workspaceId: "planning", state: "NE", name: "Road", now: timestamp });
  const definition = NEBRASKA_PILOT_PACKAGES.find((recipe) => recipe.kind === (baseKind || "resurfacing"))!;
  const instance = createPackageInstance({ instanceId: "base", segmentId: "segment", scopeId: "road", definition });
  if (!scenario.ok || !workspace.ok || !instance.ok) throw Error("Invalid fixture");
  if (edited) {
    const role = instance.value.definition.components[0].role;
    instance.value.quantityOverrides[role] = { value: 20, reason: "Quantity field measurement" };
    instance.value.rateOverrides[role] = { value: 35, reason: "Local supplier quote" };
    instance.value.exclusions[role] = { reason: "Handled in separate contract", sectionEffect: "Separate construction section" };
  }
  scenario.value.segments = [{ segmentId: "segment", name: "Road" }];
  scenario.value.packages = baseKind ? [instance.value] : [];
  if (includeCurb) {
    const curb = createPackageInstance({ instanceId: "curb", segmentId: "segment", scopeId: "road", definition: NEBRASKA_PILOT_PACKAGES.find((recipe) => recipe.kind === "curb_gutter")! });
    if (!curb.ok) throw Error("Invalid curb fixture");
    scenario.value.packages.unshift(curb.value);
  }
  if (includeSidewalk) {
    const sidewalk = createPackageInstance({ instanceId: "sidewalk", segmentId: "segment", scopeId: "sidewalk", definition: NEBRASKA_PILOT_PACKAGES.find((recipe) => recipe.kind === "sidewalk")! });
    if (!sidewalk.ok) throw Error("Invalid sidewalk fixture");
    scenario.value.packages.push(sidewalk.value);
  }
  if (elementPrices !== "pending") {
    for (const element of scenario.value.packages.filter((entry) => ["sidewalk", "curb_gutter"].includes(entry.definition.kind))) {
      element.definition.components.forEach((component, index) => {
        if (elementPrices === "complete" || index === 0) element.rateOverrides[component.role] = { value: 100, reason: "Reviewed price" };
      });
    }
  }
  if (existingCustom) scenario.value.customComponents = [{
    componentId: "old-custom", segmentId: "segment", scopeId: "landscaping", role: "landscaping",
    description: "Existing landscaping", category: "construction", unit: "EACH", quantity: 2,
    unitRate: 100, reason: "Previous planner entry", required: true, tags: [], exclusion: null,
  }];
  workspace.value.scenarios = [scenario.value];
  workspace.value.activeScenarioId = scenario.value.scenarioId;
  const host = document.createElement("div");
  renderPlanningWorkspace(host, { state: "NE", workspace: workspace.value, workspaces: [workspace.value], scenario: scenario.value, cost: calculateScenarioCosts(scenario.value), comparison: null, compareId: "", recipes: NEBRASKA_PILOT_PACKAGES, message: "", dirty: false, busy: false, readOnly: false, persistent: true });
  return host;
}

describe("Planning engineer review presentation", () => {
  it("offers curb and gutter for resurfacing and keeps it separate from the base improvement", () => {
    const host = render(false, false, "resurfacing", true);
    expect(host.querySelector('[data-field="curb-enabled"]')).toBeNull();
    expect(host.querySelector('[data-action="add-package"][data-kind="curb_gutter"]')).toBeNull();
    expect(host.querySelector('[data-action="add-package"][data-kind="sidewalk"]')).not.toBeNull();
    expect(host.querySelector<HTMLSelectElement>('[data-field="curb-sides"]')?.value).toBe("2");
    expect(host.querySelector('[data-field="curb-sides"]')?.getAttribute('data-instance-id')).toBe("curb");
    expect(host.querySelector<HTMLSelectElement>('[data-field="base-kind"]')?.value).toBe("resurfacing");
    expect(host.querySelector('[data-field="base-kind"] option[value="curb_gutter"]')).toBeNull();
    expect(host.textContent).toContain("Optional element: Nebraska Curb and Gutter");
    expect(host.textContent).toContain("Existing curb removal is excluded");
    const row = host.querySelector('[data-detail="element-curb"]');
    expect(row?.hasAttribute('open')).toBe(false);
    expect(row?.querySelector('.planning-element-name')?.textContent).toBe("Curb and gutter");
    expect(row?.querySelector('.planning-element-cost')?.textContent).toBe("Price pending");
    expect(host.querySelectorAll('[data-action="remove-package"][data-id="curb"]')).toHaveLength(1);
    expect(row?.querySelector('[data-action="remove-package"][data-id="curb"]')?.getAttribute("aria-label")).toBe("Remove Curb and gutter");
  });

  it.each(["reconstruction", "path"])("omits optional curb and gutter for %s", (kind) => {
    const host = render(false, false, kind);
    expect(host.querySelector('[data-action="add-package"][data-kind="curb_gutter"]')).toBeNull();
    expect(host.querySelector('[data-action="add-package"][data-kind="sidewalk"]')).not.toBeNull();
  });

  it("offers eligible elements with their item basis in a single add menu", () => {
    const host = render();
    const menu = host.querySelector('.planning-element-menu');
    expect(menu?.querySelector('summary')?.textContent).toBe("Add project element");
    expect(menu?.querySelectorAll('[data-action="add-package"]')).toHaveLength(2);
    expect(menu?.textContent).toContain("Sidewalk");
    expect(menu?.textContent).toContain("Curb and gutter");
    expect(menu?.textContent).not.toContain("Concrete from exact state item data plus provisional curb ramps");
    expect(host.querySelector('[data-field="sidewalk-enabled"]')).toBeNull();
    expect(render(false, false, "").querySelector('[data-action="add-package"]')).toBeNull();
  });

  it("renders sidewalk as a closed compact row with its scope and existing controls", () => {
    const host = render(false, false, "resurfacing", true, true);
    const row = host.querySelector('[data-detail="element-sidewalk"]');
    expect(row?.hasAttribute('open')).toBe(false);
    expect(row?.querySelector('.planning-element-scope')?.textContent).toContain("Both sides");
    expect(row?.querySelector('.planning-element-scope')?.textContent).toContain("ft wide");
    expect(row?.querySelector('.planning-element-scope')?.textContent).toContain("4 ramps");
    for (const field of ["sidewalk-sides", "sidewalk-width", "ramp-count"]) {
      expect(row?.querySelector(`[data-field="${field}"]`)?.getAttribute('data-instance-id')).toBe("sidewalk");
    }
    expect(host.querySelector('.planning-element-menu')).toBeNull();
    expect(host.querySelectorAll('[data-action="remove-package"][data-id="sidewalk"]')).toHaveLength(1);
  });

  it("marks partial element costs and labels fully priced direct construction costs", () => {
    const partial = render(false, false, "resurfacing", false, true, "partial");
    expect(partial.querySelector('[data-detail="element-sidewalk"] .planning-element-cost')?.textContent).toMatch(/^\$[\d,]+ partial · price pending$/);
    const complete = render(false, false, "resurfacing", true, true, "complete");
    const label = complete.querySelector('[data-detail="element-sidewalk"] .planning-element-cost');
    expect(label?.textContent).toMatch(/^\$[\d,]+$/);
    expect(label?.getAttribute('aria-label')).toBe("Sidewalk direct construction cost");
    expect(complete.querySelector('[data-detail="element-curb"] .planning-element-cost')?.textContent).toMatch(/^\$[\d,]+$/);
  });

  it("removes open-ended work entry and keeps old custom work removable in engineer review", () => {
    const host = render(false, true);
    const elements = host.querySelector('.planning-elements')!;
    expect(host.querySelector('[data-action="add-custom"]')).toBeNull();
    expect(host.textContent).not.toContain("Other work to include");
    expect(elements.querySelector('[data-field="custom-description"]')).toBeNull();
    expect(elements.querySelector('[data-field="custom-quantity"]')).toBeNull();
    expect(host.querySelector('[data-field="custom-description"]')?.closest('.planning-advanced')).not.toBeNull();
    const remove = host.querySelector('[data-action="remove-custom"][data-id="old-custom"]');
    expect(remove?.closest('.planning-advanced')).not.toBeNull();
    expect(remove?.getAttribute('aria-label')).toBe("Remove Existing landscaping");
  });

  it("keeps distinct quantity and price explanations and a single scope reason", () => {
    const host = render(true);
    expect(host.querySelector<HTMLInputElement>('[data-field="override-reason"][data-kind="quantity"]')?.value).toBe("Quantity field measurement");
    expect(host.querySelector<HTMLInputElement>('[data-field="override-reason"][data-kind="rate"]')?.value).toBe("Local supplier quote");
    expect(host.querySelector<HTMLInputElement>('[data-field="exclusion-reason"]')?.value).toBe("Handled in separate contract");
    expect(host.textContent).toContain("Separate construction section");
    expect(host.querySelector('[data-field="exclusion-effect"]')).toBeNull();
    expect(host.querySelector('[data-action="create-project-handoff"]')?.hasAttribute('disabled')).toBe(true);
  });

  it("keeps one comparison selector and alternative creation in the actions menu", () => {
    const host = render();
    expect(host.querySelectorAll('[data-field="compare-select"]')).toHaveLength(1);
    expect(host.querySelectorAll('[data-action="duplicate"]')).toHaveLength(1);
    expect(host.querySelector('[data-action="duplicate"]')?.closest('.planning-actions')).not.toBeNull();
    expect(host.textContent).toContain("Assumptions and next steps");
    expect(host.querySelector('.planning-review-status')).toBeNull();
    expect(host.querySelector('.planning-export')?.textContent).toContain("Current alternative CSV");
    expect(host.querySelector('.planning-export')?.textContent).toContain("Planning project JSON");
  });

  it("presents work in six columns with closed editors and separate evidence", () => {
    const host = render();
    const table = host.querySelector('.planning-card table')!;
    expect([...table.querySelectorAll('thead th')].map((cell) => cell.textContent)).toEqual(["Work", "Quantity", "Unit price", "Amount", "Basis", "Status"]);
    const components = table.querySelectorAll('.planning-component');
    expect(components.length).toBeGreaterThan(0);
    expect(table.querySelectorAll('.planning-row-editor')).toHaveLength(components.length);
    expect(table.querySelectorAll('.planning-row-editor[open]')).toHaveLength(0);
    components.forEach((row) => {
      row.querySelectorAll('input, select').forEach((input) => expect(input.closest('details:not([open])')).not.toBeNull());
      expect(row.querySelector('.planning-scope-state')?.textContent).toBe("Included");
      expect(row.querySelector('details')?.querySelector('summary')?.textContent).toBe("Source evidence");
    });
    expect(host.querySelector('[data-field="exclusion-effect"]')).toBeNull();
    expect(host.querySelector('[data-field="exclusion-reason"]')).toBeNull();
    expect(host.querySelector('[data-field="override-reason"][data-kind="quantity"]')).toBeNull();
    expect(host.querySelector('[data-detail="record-review"]')).toBeNull();
    expect(host.querySelector('[data-detail="all-review-decisions"]')).toBeNull();
  });
});
