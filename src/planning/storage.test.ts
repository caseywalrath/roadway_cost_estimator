import { IDBFactory } from "fake-indexeddb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openPlanningStore, type PlanningStore } from "./storage";
import type { PlanningProject } from "./types";

let factory: IDBFactory;
let store: PlanningStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
});

function open(): Promise<PlanningStore> {
  return openPlanningStore({ factory }).then((s) => (store = s));
}

function makeProject(id: string, overrides: Partial<PlanningProject> = {}): PlanningProject {
  return {
    schemaVersion: 1,
    id,
    name: `Project ${id}`,
    state: "CO",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    revision: 0,
    templateId: null,
    inputs: { lengthMiles: 1, roadwayWidthFt: 24, intersections: 0 },
    stageId: "planning",
    engineering: { design: 0.1, constructionEngineering: 0.1 },
    budget: null,
    alternatives: [],
    selectedAlternativeId: "a1",
    ...overrides
  };
}

function createDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = factory.open(name, 1);
    request.onsuccess = () => { request.result.close(); resolve(); };
    request.onerror = () => reject(request.error);
  });
}

async function databaseNames(): Promise<string[]> {
  return (await factory.databases()).map((d) => d.name ?? "");
}

describe("planning storage", () => {
  beforeEach(() => { factory = new IDBFactory(); });

  it("saves a new project at revision 1 and reloads it", async () => {
    const s = await open();
    const result = await s.saveProject(makeProject("p1"), 0, "2026-02-01T00:00:00.000Z");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.project.revision).toBe(1);
    expect(result.project.updatedAt).toBe("2026-02-01T00:00:00.000Z");
    expect(result.project.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(await s.getProject("p1")).toEqual(result.project);
    expect(await s.getProject("missing")).toBeNull();
  });

  it("returns a conflict with the current project for a stale revision", async () => {
    const s = await open();
    const first = await s.saveProject(makeProject("p1"), 0, "2026-02-01T00:00:00.000Z");
    if (!first.ok) throw new Error("expected save");
    const second = await s.saveProject({ ...first.project, name: "Renamed" }, 1, "2026-02-02T00:00:00.000Z");
    expect(second.ok && second.project.revision).toBe(2);
    const stale = await s.saveProject({ ...first.project, name: "Stale" }, 1, "2026-02-03T00:00:00.000Z");
    expect(stale.ok).toBe(false);
    if (stale.ok) return;
    expect(stale.reason).toBe("conflict");
    expect(stale.current.name).toBe("Renamed");
    expect((await s.getProject("p1"))?.name).toBe("Renamed");
    const duplicateNew = await s.saveProject(makeProject("p1"), 0, "2026-02-04T00:00:00.000Z");
    expect(duplicateNew.ok).toBe(false);
  });

  it("lists projects newest first and deletes", async () => {
    const s = await open();
    await s.saveProject(makeProject("old"), 0, "2026-02-01T00:00:00.000Z");
    await s.saveProject(makeProject("new"), 0, "2026-03-01T00:00:00.000Z");
    await s.saveProject(makeProject("mid"), 0, "2026-02-15T00:00:00.000Z");
    const list = await s.listProjects();
    expect(list.map((p) => p.id)).toEqual(["new", "mid", "old"]);
    expect(list[0]).toEqual({ id: "new", name: "Project new", updatedAt: "2026-03-01T00:00:00.000Z", revision: 1 });
    await s.deleteProject("mid");
    expect((await s.listProjects()).map((p) => p.id)).toEqual(["new", "old"]);
    expect(await s.getProject("mid")).toBeNull();
  });

  it("round-trips the last project id", async () => {
    const s = await open();
    expect(await s.getLastProjectId()).toBeNull();
    await s.setLastProjectId("p1");
    expect(await s.getLastProjectId()).toBe("p1");
    await s.setLastProjectId(null);
    expect(await s.getLastProjectId()).toBeNull();
  });

  it("deletes the legacy pilot database once", async () => {
    await createDatabase("roadway-cost-estimator-planning");
    expect(await databaseNames()).toContain("roadway-cost-estimator-planning");
    const s = await open();
    const names = await databaseNames();
    expect(names).not.toContain("roadway-cost-estimator-planning");
    expect(names).toContain("roadway-cost-estimator-planning-v2");
    s.close();
    // Flag is set: a database recreated under the legacy name is left alone.
    await createDatabase("roadway-cost-estimator-planning");
    await open();
    expect(await databaseNames()).toContain("roadway-cost-estimator-planning");
  });

  it("skips corrupted stored records", async () => {
    const s = await open();
    await s.saveProject(makeProject("good"), 0, "2026-02-01T00:00:00.000Z");
    s.close();
    await new Promise<void>((resolve, reject) => {
      const request = factory.open("roadway-cost-estimator-planning-v2", 1);
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction("projects", "readwrite");
        tx.objectStore("projects").put({ id: "bad", name: 5 });
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
    });
    const reopened = await open();
    expect(await reopened.getProject("bad")).toBeNull();
    expect((await reopened.listProjects()).map((p) => p.id)).toEqual(["good"]);
  });

  it("rejects with a plain message when IndexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error simulate a browser without IndexedDB
    delete globalThis.indexedDB;
    try {
      await expect(openPlanningStore()).rejects.toThrow("Planning storage is unavailable in this browser.");
    } finally {
      globalThis.indexedDB = original;
    }
  });
});
