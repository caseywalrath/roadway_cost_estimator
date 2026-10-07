// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPlanningWorkspace } from "../planningWorkspace";
import { openPlanningRepository, PlanningConflictError, type PlanningRepository } from "./planningRepository";

const databaseName = "roadway-cost-estimator-planning";
const now = "2026-10-07T00:00:00.000Z";
let repositories: PlanningRepository[] = [];

function workspace(id: string, state: "NE" | "CO") {
  const result = createPlanningWorkspace({ workspaceId: id, state, name: id, now });
  if (!result.ok) throw new Error("Fixture creation failed.");
  return result.value;
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

beforeEach(async () => { await deleteDatabase(); });
afterEach(async () => {
  repositories.forEach((repository) => repository.close());
  repositories = [];
  vi.unstubAllGlobals();
  await deleteDatabase();
});

async function open(): Promise<PlanningRepository> {
  const result = await openPlanningRepository();
  repositories.push(result.repository);
  expect(result.warning).toBeNull();
  return result.repository;
}

describe("Planning persistence", () => {
  it("isolates states and keeps the active selection in the Planning database", async () => {
    const first = await open();
    expect(first.isPersistent).toBe(true);
    await first.createWorkspace(workspace("ne-1", "NE"));
    await first.createWorkspace(workspace("co-1", "CO"));
    await first.setActiveWorkspaceId("NE", "ne-1");
    await first.setActiveWorkspaceId("CO", "co-1");
    await expect(first.setActiveWorkspaceId("NE", "co-1")).rejects.toThrow();
    expect((await first.listWorkspaces("NE")).map((entry) => entry.workspaceId)).toEqual(["ne-1"]);
    first.close();
    const second = await open();
    expect(await second.getActiveWorkspaceId("NE")).toBe("ne-1");
    expect(await second.getActiveWorkspaceId("CO")).toBe("co-1");
  });

  it("saves one pre-edit snapshot atomically and rejects a stale tab", async () => {
    const first = await open();
    const second = await open();
    await first.createWorkspace(workspace("shared", "NE"));
    const draft = { ...(await first.getWorkspace("shared"))!, name: "Changed" };
    const saved = await first.saveWorkspace(draft, 0, "Structural edit");
    expect(saved.revision).toBe(1);
    expect((await first.listRevisions("shared")).map((entry) => [entry.revision, entry.workspace.name, entry.reason]))
      .toEqual([[0, "shared", "Structural edit"]]);
    await expect(second.saveWorkspace({ ...draft, name: "Stale" }, 0)).rejects.toBeInstanceOf(PlanningConflictError);
    expect((await second.getWorkspace("shared"))?.name).toBe("Changed");
    expect((await second.listRevisions("shared"))).toHaveLength(1);
  });

  it("retains 20 snapshots, marks a backup, and removes related state on deletion", async () => {
    const repository = await open();
    let current = await repository.createWorkspace(workspace("history", "CO"));
    await repository.setActiveWorkspaceId("CO", "history");
    for (let index = 0; index < 23; index += 1) current = await repository.saveWorkspace({ ...current, name: `Edit ${index}` }, current.revision);
    const revisions = await repository.listRevisions("history");
    expect(revisions).toHaveLength(20);
    expect(revisions[0].revision).toBe(22);
    expect(revisions[revisions.length - 1]?.revision).toBe(3);
    const backedUp = await repository.recordBackup("history", 23);
    expect(backedUp.lastBackupRevision).toBe(23);
    await expect(repository.recordBackup("history", 22)).rejects.toBeInstanceOf(PlanningConflictError);
    await repository.deleteWorkspace("history");
    expect(await repository.getWorkspace("history")).toBeNull();
    expect(await repository.getActiveWorkspaceId("CO")).toBeNull();
    expect(await repository.listRevisions("history")).toEqual([]);
  });

  it("states explicitly when IndexedDB is unavailable and keeps a tab-local draft", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const result = await openPlanningRepository();
    repositories.push(result.repository);
    expect(result.repository.isPersistent).toBe(false);
    expect(result.warning).toContain("Export a recovery file");
    await result.repository.createWorkspace(workspace("draft", "NE"));
    expect((await result.repository.getWorkspace("draft"))?.workspaceId).toBe("draft");
    const reopened = await openPlanningRepository();
    expect(reopened.repository.isPersistent).toBe(false);
    expect((await reopened.repository.getWorkspace("draft"))?.workspaceId).toBe("draft");
  });
});
