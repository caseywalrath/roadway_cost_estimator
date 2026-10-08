// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createPackageInstance, createPlanningScenario, createPlanningWorkspace } from "../../planning/planningWorkspace";
import { calculateScenarioCosts } from "../../planning/costEngine";
import { NEBRASKA_PILOT_PACKAGES } from "../../planning/recipes/nebraskaPilot";
import { renderPlanningWorkspace } from "./renderPlanningWorkspace";

const timestamp = "2026-10-07T12:00:00.000Z";
function render(edited = false) {
  const scenario = createPlanningScenario({ scenarioId: "alternative", state: "NE", name: "Alternative A", now: timestamp });
  const workspace = createPlanningWorkspace({ workspaceId: "planning", state: "NE", name: "Road", now: timestamp });
  const instance = createPackageInstance({ instanceId: "base", segmentId: "segment", scopeId: "road", definition: NEBRASKA_PILOT_PACKAGES[0] });
  if (!scenario.ok || !workspace.ok || !instance.ok) throw Error("Invalid fixture");
  if (edited) {
    const role = instance.value.definition.components[0].role;
    instance.value.quantityOverrides[role] = { value: 20, reason: "Quantity field measurement" };
    instance.value.rateOverrides[role] = { value: 35, reason: "Local supplier quote" };
    instance.value.exclusions[role] = { reason: "Handled in separate contract", sectionEffect: "Separate construction section" };
  }
  scenario.value.segments = [{ segmentId: "segment", name: "Road" }];
  scenario.value.packages = [instance.value];
  workspace.value.scenarios = [scenario.value];
  workspace.value.activeScenarioId = scenario.value.scenarioId;
  const host = document.createElement("div");
  renderPlanningWorkspace(host, { state: "NE", workspace: workspace.value, workspaces: [workspace.value], scenario: scenario.value, cost: calculateScenarioCosts(scenario.value), comparison: null, compareId: "", recipes: NEBRASKA_PILOT_PACKAGES, message: "", dirty: false, busy: false, readOnly: false, persistent: true });
  return host;
}

describe("Planning engineer review presentation", () => {
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
