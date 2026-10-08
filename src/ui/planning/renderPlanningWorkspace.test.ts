// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPackageInstance, createPlanningScenario, createPlanningWorkspace } from "../../planning/planningWorkspace";
import { calculateScenarioCosts } from "../../planning/costEngine";
import { NEBRASKA_PILOT_PACKAGES } from "../../planning/recipes/nebraskaPilot";
import { renderPlanningWorkspace } from "./renderPlanningWorkspace";

const timestamp = "2026-10-07T12:00:00.000Z";
function render(edited = false, existingCustom = false, baseKind = "resurfacing", includeCurb = false) {
  const scenario = createPlanningScenario({ scenarioId: "alternative", state: "NE", name: "Alternative A", now: timestamp });
  const workspace = createPlanningWorkspace({ workspaceId: "planning", state: "NE", name: "Road", now: timestamp });
  const definition = NEBRASKA_PILOT_PACKAGES.find((recipe) => recipe.kind === baseKind)!;
  const instance = createPackageInstance({ instanceId: "base", segmentId: "segment", scopeId: "road", definition });
  if (!scenario.ok || !workspace.ok || !instance.ok) throw Error("Invalid fixture");
  if (edited) {
    const role = instance.value.definition.components[0].role;
    instance.value.quantityOverrides[role] = { value: 20, reason: "Quantity field measurement" };
    instance.value.rateOverrides[role] = { value: 35, reason: "Local supplier quote" };
    instance.value.exclusions[role] = { reason: "Handled in separate contract", sectionEffect: "Separate construction section" };
  }
  scenario.value.segments = [{ segmentId: "segment", name: "Road" }];
  scenario.value.packages = [instance.value];
  if (includeCurb) {
    const curb = createPackageInstance({ instanceId: "curb", segmentId: "segment", scopeId: "road", definition: NEBRASKA_PILOT_PACKAGES.find((recipe) => recipe.kind === "curb_gutter")! });
    if (!curb.ok) throw Error("Invalid curb fixture");
    scenario.value.packages.unshift(curb.value);
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
    expect(host.querySelector<HTMLInputElement>('[data-field="curb-enabled"]')?.checked).toBe(true);
    expect(host.querySelector<HTMLSelectElement>('[data-field="curb-sides"]')?.value).toBe("2");
    expect(host.querySelector('[data-field="curb-sides"]')?.getAttribute('data-instance-id')).toBe("curb");
    expect(host.querySelector<HTMLSelectElement>('[data-field="base-kind"]')?.value).toBe("resurfacing");
    expect(host.querySelector('[data-field="base-kind"] option[value="curb_gutter"]')).toBeNull();
    expect(host.textContent).toContain("Optional element: Nebraska Curb and Gutter");
    expect(host.textContent).toContain("Existing curb removal is excluded");
  });

  it.each(["reconstruction", "path"])("omits optional curb and gutter for %s", (kind) => {
    expect(render(false, false, kind).querySelector('[data-field="curb-enabled"]')).toBeNull();
  });

  it("removes open-ended work entry and keeps old custom work removable in engineer review", () => {
    const host = render(false, true);
    const elements = [...host.querySelectorAll('.planning-section')].find((section) => section.querySelector('h2')?.textContent === "Add project elements")!;
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
    expect(host.textContent).toContain("Review before detailed estimate");
    expect(host.querySelector('.planning-review-status')?.textContent).toContain("pending");
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
    expect(host.querySelector('[data-detail="record-review"]')).not.toBeNull();
    expect(host.querySelector('[data-detail="all-review-decisions"]')?.closest('[data-detail="record-review"]')).toBeNull();
  });
});
