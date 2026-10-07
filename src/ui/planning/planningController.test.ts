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
    vi.spyOn(window, "prompt").mockReturnValue("New pilot");
    const host = document.createElement("div");
    const controller = createPlanningController(data, repository([]));
    await controller.mount(host);
    host.querySelector<HTMLButtonElement>("[data-action='create-workspace']")!.click();
    await vi.waitFor(() => expect(host.querySelector("[data-field='workspace-select']")?.textContent).toContain("New pilot"));
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
});
