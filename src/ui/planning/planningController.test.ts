// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppData } from "../../data/schema";
import { addPlanningScenario, createPlanningScenario, createPlanningWorkspace, setActivePlanningScenario } from "../../planning/planningWorkspace";
import type { PlanningState, PlanningWorkspace } from "../../planning/types";
import { createPlanningController, type PlanningPersistence } from "./planningController";

const timestamp = "2026-10-07T12:00:00.000Z";
function workspace(id: string): PlanningWorkspace {
  const result = createPlanningWorkspace({ workspaceId: id, state: "NE", name: id, now: timestamp });
  if (!result.ok) throw new Error("Fixture failed");
  return result.value;
}

function repository(initial: PlanningWorkspace[]): PlanningPersistence {
  const items = new Map(initial.map((entry) => [entry.workspaceId, entry]));
  let active: string | null = initial[0]?.workspaceId ?? null;
  return {
    isPersistent: false,
    listWorkspaces: async (state?: PlanningState) => [...items.values()].filter((entry) => !state || entry.state === state),
    getWorkspace: async (id) => items.get(id) ?? null,
    createWorkspace: async (entry) => { items.set(entry.workspaceId, entry); return entry; },
    saveWorkspace: async (entry, expected) => { if (items.get(entry.workspaceId)?.revision !== expected) throw Error("Revision conflict"); const saved = { ...entry, revision: expected + 1 }; items.set(entry.workspaceId, saved); return saved; },
    getActiveWorkspaceId: async () => active,
    setActiveWorkspaceId: async (_state, id) => { active = id; },
    recordBackup: async (id) => items.get(id)!,
    close: () => undefined,
  };
}

const data = { stateConfig: { code: "NE" } } as AppData;
afterEach(() => vi.restoreAllMocks());

describe("Planning controller workspace transitions", () => {
  it("switches existing workspaces without waiting on its own queued operation", async () => {
    const host = document.createElement("div");
    const controller = createPlanningController(data, repository([workspace("first"), workspace("second")]));
    await controller.mount(host);
    const picker = host.querySelector<HTMLSelectElement>("[data-field='workspace-select']")!;
    picker.value = "second";
    picker.dispatchEvent(new Event("change", { bubbles: true }));
    await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>("[data-field='workspace-select']")?.value).toBe("second"));
    controller.close();
  });

  it("creates a workspace after the create action", async () => {
    const host = document.createElement("div");
    const controller = createPlanningController(data, repository([]));
    await controller.mount(host);
    host.querySelector<HTMLInputElement>("[data-field='new-project-name']")!.value = "New pilot";
    host.querySelector<HTMLButtonElement>("[data-action='create-workspace']")!.click();
    await vi.waitFor(() => expect(host.querySelector("[data-field='workspace-select']")?.textContent).toContain("New pilot"));
    await vi.waitFor(() => expect(host.querySelector<HTMLSelectElement>("[data-field='scenario-select']")?.textContent).toContain("Alternative A"));
    expect(host.querySelector(".planning-advanced")?.hasAttribute("open")).toBe(false);
    expect(host.querySelector("[data-field='base-kind']")).not.toBeNull();
    expect(host.querySelector(".planning-estimate")?.textContent).toContain("Choose an improvement");
    expect(host.textContent).not.toContain("Range not calibrated");
    controller.close();
  });

  it("adds and removes curb from the element picker and clears it when reconstruction replaces resurfacing", async () => {
    const created = createPlanningScenario({ scenarioId: "estimate", state: "NE", name: "Estimate", now: timestamp });
    if (!created.ok) throw Error("Fixture failed");
    const added = addPlanningScenario(workspace("curb"), created.value, timestamp);
    if (!added.ok) throw Error("Fixture failed");
    const active = setActivePlanningScenario(added.value, "estimate", timestamp);
    if (!active.ok) throw Error("Fixture failed");
    const pricingData = { ...data, agencyItems: [], agencyItemById: new Map(), itemPriceSummaries: [], itemPriceSummariesByAgencyItemId: new Map(), sourceById: new Map() } as unknown as AppData;
    const host = document.createElement("div");
    const controller = createPlanningController(pricingData, repository([active.value]));
    await controller.mount(host);
    const base = host.querySelector<HTMLSelectElement>("[data-field='base-kind']")!;
    base.value = "resurfacing";
    base.dispatchEvent(new Event("change", { bubbles: true }));
    host.querySelector<HTMLButtonElement>("[data-action='add-package'][data-kind='sidewalk']")!.click();
    const sidewalkWidth = host.querySelector<HTMLInputElement>("[data-field='sidewalk-width']")!;
    const sidewalkId = sidewalkWidth.dataset.instanceId;
    const sidewalkRow = host.querySelector<HTMLDetailsElement>(`[data-detail='element-${sidewalkId}']`)!;
    sidewalkRow.open = true;
    sidewalkWidth.value = "7";
    sidewalkWidth.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.querySelector<HTMLDetailsElement>(`[data-detail='element-${sidewalkId}']`)?.open).toBe(true);
    expect(host.querySelector(`[data-detail='element-${sidewalkId}'] .planning-element-scope`)?.textContent).toContain("7 ft wide");
    host.querySelector<HTMLButtonElement>(`[data-detail='element-${sidewalkId}'] [data-action='remove-package']`)!.click();
    expect(host.querySelector("[data-action='add-package'][data-kind='sidewalk']")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("[data-action='add-package'][data-kind='curb_gutter']")!.click();
    const curbId = host.querySelector<HTMLSelectElement>("[data-field='curb-sides']")?.dataset.instanceId;
    expect(curbId).toBeTruthy();
    expect(host.querySelector<HTMLSelectElement>("[data-field='curb-sides']")?.value).toBe("2");
    expect(host.textContent).toContain("Optional element: Nebraska Curb and Gutter");
    host.querySelector<HTMLButtonElement>(`[data-detail='element-${curbId}'] [data-action='remove-package']`)!.click();
    expect(host.querySelector("[data-field='curb-sides']")).toBeNull();
    expect(host.querySelector("[data-action='add-package'][data-kind='curb_gutter']")).not.toBeNull();
    host.querySelector<HTMLButtonElement>("[data-action='add-package'][data-kind='curb_gutter']")!.click();
    const changed = host.querySelector<HTMLSelectElement>("[data-field='base-kind']")!;
    changed.value = "reconstruction";
    changed.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.querySelector("[data-action='add-package'][data-kind='curb_gutter']")).toBeNull();
    expect(host.textContent).not.toContain("Optional element: Nebraska Curb and Gutter");
    expect(host.querySelector<HTMLSelectElement>("[data-field='base-kind']")?.value).toBe("reconstruction");
    controller.close();
  });

  it("holds an invalid numeric draft and prevents saving a stale allowance", async () => {
    const scenario = createPlanningScenario({ scenarioId: "estimate", state: "NE", name: "Estimate", now: timestamp });
    if (!scenario.ok) throw Error("Fixture failed");
    const added = addPlanningScenario(workspace("draft"), scenario.value, timestamp);
    if (!added.ok) throw Error("Fixture failed");
    const active = setActivePlanningScenario(added.value, "estimate", timestamp);
    if (!active.ok) throw Error("Fixture failed");
    const host = document.createElement("div");
    const controller = createPlanningController(data, repository([active.value]));
    await controller.mount(host);
    const percent = host.querySelector<HTMLInputElement>("[data-field='allowance-percent']")!;
    percent.value = "abc";
    percent.dispatchEvent(new Event("change", { bubbles: true }));
    expect(percent.value).toBe("abc");
    expect(percent.getAttribute("aria-invalid")).toBe("true");
    expect(await controller.flush()).toBe(false);
    expect(host.querySelector<HTMLInputElement>("[data-field='allowance-percent']")?.value).toBe("abc");
    controller.close();
  });

  it("preserves a known property-impact reason when its amount changes", async () => {
    const created = createPlanningScenario({ scenarioId: "estimate", state: "NE", name: "Estimate", now: timestamp });
    if (!created.ok) throw Error("Fixture failed");
    const added = addPlanningScenario(workspace("property"), created.value, timestamp);
    if (!added.ok) throw Error("Fixture failed");
    const active = setActivePlanningScenario(added.value, "estimate", timestamp);
    if (!active.ok) throw Error("Fixture failed");
    const store = repository([active.value]);
    const host = document.createElement("div");
    const controller = createPlanningController(data, store);
    await controller.mount(host);
    const decision = host.querySelector<HTMLSelectElement>("[data-field='external-decision'][data-id='right_of_way']")!;
    decision.value = "manual";
    decision.dispatchEvent(new Event("change", { bubbles: true }));
    const reasonInput = host.querySelector<HTMLInputElement>("[data-field='external-reason'][data-id='right_of_way']")!;
    reasonInput.value = "Concept parcel sketch";
    reasonInput.dispatchEvent(new Event("change", { bubbles: true }));
    const amount = host.querySelector<HTMLInputElement>("[data-field='external-amount'][data-id='right_of_way']")!;
    amount.value = "12000";
    amount.dispatchEvent(new Event("change", { bubbles: true }));
    expect(host.querySelector<HTMLInputElement>("[data-field='external-reason'][data-id='right_of_way']")?.value).toBe("Concept parcel sketch");
    controller.close();
  });
});
