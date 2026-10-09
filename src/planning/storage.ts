import type { PlanningProject } from "./types";

const DATABASE_NAME = "roadway-cost-estimator-planning-v2";
const LEGACY_DATABASE_NAME = "roadway-cost-estimator-planning";
const DATABASE_VERSION = 1;

export interface PlanningProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  revision: number;
}

export type SavePlanningResult =
  | { ok: true; project: PlanningProject }
  | { ok: false; reason: "conflict"; current: PlanningProject };

export interface PlanningStore {
  listProjects(): Promise<PlanningProjectSummary[]>;
  getProject(id: string): Promise<PlanningProject | null>;
  /** New projects use expectedRevision 0. A stale revision returns a conflict with the stored project. */
  saveProject(project: PlanningProject, expectedRevision: number, now: string): Promise<SavePlanningResult>;
  deleteProject(id: string): Promise<void>;
  getLastProjectId(): Promise<string | null>;
  setLastProjectId(id: string | null): Promise<void>;
  close(): void;
}

const UNAVAILABLE = "Planning storage is unavailable in this browser.";
const FAILED = "Planning storage could not complete the request.";

export function isPlanningProject(value: unknown): value is PlanningProject {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.schemaVersion === 1 &&
    typeof v.id === "string" &&
    typeof v.name === "string" &&
    typeof v.updatedAt === "string" &&
    typeof v.revision === "number" &&
    typeof v.inputs === "object" && v.inputs !== null &&
    Array.isArray(v.alternatives)
  );
}

export async function openPlanningStore(options: { factory?: IDBFactory } = {}): Promise<PlanningStore> {
  const factory = options.factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!factory) throw new Error(UNAVAILABLE);
  const database = await openDatabase(factory);
  const store = new IndexedDbPlanningStore(database);
  await store.removeLegacyDatabase(factory);
  return store;
}

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      reject(new Error(UNAVAILABLE));
      return;
    }
    request.onupgradeneeded = () => {
      const database = request.result;
      database.createObjectStore("projects", { keyPath: "id" });
      database.createObjectStore("meta", { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(UNAVAILABLE));
    request.onblocked = () => reject(new Error("Planning storage is blocked by another browser tab. Close other tabs and reload."));
  });
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error(FAILED));
  });
}

class IndexedDbPlanningStore implements PlanningStore {
  constructor(private readonly database: IDBDatabase) {}

  close(): void { this.database.close(); }

  /** Runs once: deletes the old pilot database. Blocked or failed attempts are ignored and retried next open. */
  async removeLegacyDatabase(factory: IDBFactory): Promise<void> {
    try {
      const flag = await this.getMeta("legacyDeleted");
      if (flag === true) return;
      const deleted = await new Promise<boolean>((resolve) => {
        const request = factory.deleteDatabase(LEGACY_DATABASE_NAME);
        request.onsuccess = () => resolve(true);
        request.onerror = () => resolve(false);
        request.onblocked = () => resolve(false);
      });
      if (deleted) await this.setMeta("legacyDeleted", true);
    } catch {
      // Cleanup is best effort.
    }
  }

  private async getMeta(key: string): Promise<unknown> {
    const record = await done(this.database.transaction("meta").objectStore("meta").get(key));
    return (record as { value?: unknown } | undefined)?.value;
  }

  private async setMeta(key: string, value: unknown): Promise<void> {
    const transaction = this.database.transaction("meta", "readwrite");
    await done(transaction.objectStore("meta").put({ key, value }));
  }

  async listProjects(): Promise<PlanningProjectSummary[]> {
    const all = await done(this.database.transaction("projects").objectStore("projects").getAll());
    return all
      .filter(isPlanningProject)
      .map(({ id, name, updatedAt, revision }) => ({ id, name, updatedAt, revision }))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async getProject(id: string): Promise<PlanningProject | null> {
    const value = await done(this.database.transaction("projects").objectStore("projects").get(id));
    return isPlanningProject(value) ? value : null;
  }

  saveProject(project: PlanningProject, expectedRevision: number, now: string): Promise<SavePlanningResult> {
    return new Promise((resolve, reject) => {
      const transaction = this.database.transaction("projects", "readwrite");
      const projects = transaction.objectStore("projects");
      let result: SavePlanningResult | null = null;
      transaction.oncomplete = () => (result ? resolve(result) : reject(new Error(FAILED)));
      transaction.onerror = () => reject(new Error(FAILED));
      transaction.onabort = () => reject(new Error(FAILED));
      const read = projects.get(project.id);
      read.onsuccess = () => {
        const current = isPlanningProject(read.result) ? read.result : null;
        if (current && current.revision !== expectedRevision) {
          result = { ok: false, reason: "conflict", current };
          return;
        }
        const saved: PlanningProject = { ...project, revision: expectedRevision + 1, updatedAt: now };
        projects.put(saved);
        result = { ok: true, project: saved };
      };
    });
  }

  async deleteProject(id: string): Promise<void> {
    const transaction = this.database.transaction("projects", "readwrite");
    await done(transaction.objectStore("projects").delete(id));
  }

  async getLastProjectId(): Promise<string | null> {
    const value = await this.getMeta("lastProjectId");
    return typeof value === "string" ? value : null;
  }

  async setLastProjectId(id: string | null): Promise<void> {
    if (id === null) {
      const transaction = this.database.transaction("meta", "readwrite");
      await done(transaction.objectStore("meta").delete("lastProjectId"));
    } else {
      await this.setMeta("lastProjectId", id);
    }
  }
}
