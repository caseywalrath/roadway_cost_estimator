import { buildPlanningBackup, parsePlanningBackup } from "../planningBackup";
import type { PlanningState, PlanningWorkspace } from "../types";

const DATABASE_NAME = "roadway-cost-estimator-planning";
const DATABASE_VERSION = 1;
const SETTINGS_KEY = "workspace";
export const MAX_PLANNING_REVISIONS = 20;

interface SettingsRecord {
  key: typeof SETTINGS_KEY;
  activeWorkspaceIdByState: Record<PlanningState, string | null>;
}

export interface PlanningRevision {
  workspaceId: string;
  revision: number;
  createdAt: string;
  reason: string;
  workspace: PlanningWorkspace;
}

export interface PlanningRepository {
  readonly isPersistent: boolean;
  close(): void;
  listWorkspaces(state?: PlanningState): Promise<PlanningWorkspace[]>;
  getWorkspace(workspaceId: string): Promise<PlanningWorkspace | null>;
  createWorkspace(workspace: PlanningWorkspace): Promise<PlanningWorkspace>;
  /** Atomically checks the stored revision, snapshots it, and saves revision + 1. */
  saveWorkspace(workspace: PlanningWorkspace, expectedRevision: number, reason?: string): Promise<PlanningWorkspace>;
  deleteWorkspace(workspaceId: string): Promise<void>;
  listRevisions(workspaceId: string): Promise<PlanningRevision[]>;
  getActiveWorkspaceId(state: PlanningState): Promise<string | null>;
  setActiveWorkspaceId(state: PlanningState, workspaceId: string | null): Promise<void>;
  /** Marks a successful recovery export without changing the content revision. */
  recordBackup(workspaceId: string, revision: number): Promise<PlanningWorkspace>;
}

export class PlanningConflictError extends Error {
  constructor() {
    super("This Planning workspace changed in another browser tab. Reload it before saving again.");
    this.name = "PlanningConflictError";
  }
}

export class PlanningStorageError extends Error {
  constructor(message: string) { super(message); this.name = "PlanningStorageError"; }
}

/** A failed open yields an explicit tab-local repository. The UI must display warning. */
export async function openPlanningRepository(): Promise<{ repository: PlanningRepository; warning: string | null }> {
  try {
    const database = await openDatabase();
    return { repository: new IndexedDbPlanningRepository(database), warning: null };
  } catch {
    return {
      repository: sharedMemoryRepository,
      warning: "Planning storage could not be opened. Changes are available only in this browser tab. Export a recovery file before leaving."
    };
  }
}

const clone = <T>(value: T): T => structuredClone(value);
const settingsDefault = (): SettingsRecord => ({ key: SETTINGS_KEY, activeWorkspaceIdByState: { NE: null, CO: null } });

function validated(workspace: PlanningWorkspace): PlanningWorkspace {
  const parsed = parsePlanningBackup(buildPlanningBackup(workspace, new Date().toISOString()));
  if (!parsed) throw new PlanningStorageError("Planning workspace is invalid and was not saved.");
  return clone(workspace);
}

function nextWorkspace(workspace: PlanningWorkspace, revision: number): PlanningWorkspace {
  return validated({ ...clone(workspace), revision, updatedAt: new Date().toISOString() });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error ?? new PlanningStorageError("Planning write was aborted."));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new PlanningStorageError("IndexedDB is unavailable.")); return; }
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const db = request.result;
      const workspaces = db.createObjectStore("workspaces", { keyPath: "workspaceId" });
      workspaces.createIndex("state", "state");
      db.createObjectStore("settings", { keyPath: "key" });
      const revisions = db.createObjectStore("revisions", { keyPath: ["workspaceId", "revision"] });
      revisions.createIndex("workspaceId", "workspaceId");
    };
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new PlanningStorageError("Planning database upgrade is blocked by another tab."));
  });
}

class IndexedDbPlanningRepository implements PlanningRepository {
  readonly isPersistent = true;
  constructor(private readonly db: IDBDatabase) {}
  close(): void { this.db.close(); }

  async listWorkspaces(state?: PlanningState): Promise<PlanningWorkspace[]> {
    const tx = this.db.transaction("workspaces", "readonly");
    const done = transactionDone(tx);
    const store = tx.objectStore("workspaces");
    const raw = await requestResult<PlanningWorkspace[]>(state ? store.index("state").getAll(state) : store.getAll());
    await done;
    return raw.map(validated).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async getWorkspace(workspaceId: string): Promise<PlanningWorkspace | null> {
    const tx = this.db.transaction("workspaces", "readonly");
    const done = transactionDone(tx);
    const raw = await requestResult<PlanningWorkspace | undefined>(tx.objectStore("workspaces").get(workspaceId));
    await done;
    return raw ? validated(raw) : null;
  }

  async createWorkspace(workspace: PlanningWorkspace): Promise<PlanningWorkspace> {
    const saved = validated(workspace);
    if (saved.revision !== 0) throw new PlanningStorageError("A new Planning workspace must start at revision zero.");
    const tx = this.db.transaction("workspaces", "readwrite");
    const done = transactionDone(tx);
    tx.objectStore("workspaces").add(saved);
    await done;
    return clone(saved);
  }

  async saveWorkspace(workspace: PlanningWorkspace, expectedRevision: number, reason = "Before Planning edit"): Promise<PlanningWorkspace> {
    const input = validated(workspace);
    const tx = this.db.transaction(["workspaces", "revisions"], "readwrite");
    const workspaceStore = tx.objectStore("workspaces");
    const revisionStore = tx.objectStore("revisions");
    const done = transactionDone(tx);
    try {
      const current = await requestResult<PlanningWorkspace | undefined>(workspaceStore.get(input.workspaceId));
      if (!current || current.revision !== expectedRevision || current.state !== input.state) throw new PlanningConflictError();
      const saved = nextWorkspace(input, expectedRevision + 1);
      const snapshot: PlanningRevision = { workspaceId: current.workspaceId, revision: current.revision, createdAt: saved.updatedAt, reason, workspace: clone(current) };
      revisionStore.put(snapshot);
      workspaceStore.put(saved);
      const keys = await requestResult<IDBValidKey[]>(revisionStore.index("workspaceId").getAllKeys(current.workspaceId));
      const numbers = keys.map((key) => (key as [string, number])[1]).sort((a, b) => b - a);
      for (const revision of numbers.slice(MAX_PLANNING_REVISIONS)) revisionStore.delete([current.workspaceId, revision]);
      await done;
      return clone(saved);
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already have ended */ }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const tx = this.db.transaction(["workspaces", "revisions", "settings"], "readwrite");
    const done = transactionDone(tx);
    try {
      const workspaces = tx.objectStore("workspaces");
      const revisions = tx.objectStore("revisions");
      const current = await requestResult<PlanningWorkspace | undefined>(workspaces.get(workspaceId));
      if (!current) throw new PlanningStorageError("Planning workspace was not found.");
      const keys = await requestResult<IDBValidKey[]>(revisions.index("workspaceId").getAllKeys(workspaceId));
      const settingsStore = tx.objectStore("settings");
      const settings = await requestResult<SettingsRecord | undefined>(settingsStore.get(SETTINGS_KEY)) ?? settingsDefault();
      if (settings.activeWorkspaceIdByState[current.state] === workspaceId) settings.activeWorkspaceIdByState[current.state] = null;
      settingsStore.put(settings);
      workspaces.delete(workspaceId);
      keys.forEach((key) => revisions.delete(key));
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already have ended */ }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async listRevisions(workspaceId: string): Promise<PlanningRevision[]> {
    const tx = this.db.transaction("revisions", "readonly");
    const done = transactionDone(tx);
    const revisions = await requestResult<PlanningRevision[]>(tx.objectStore("revisions").index("workspaceId").getAll(workspaceId));
    await done;
    return revisions.map((entry) => ({ ...entry, workspace: validated(entry.workspace) })).sort((a, b) => b.revision - a.revision);
  }

  async getActiveWorkspaceId(state: PlanningState): Promise<string | null> {
    const tx = this.db.transaction(["settings", "workspaces"], "readonly");
    const done = transactionDone(tx);
    const settings = await requestResult<SettingsRecord | undefined>(tx.objectStore("settings").get(SETTINGS_KEY));
    const id = settings?.activeWorkspaceIdByState[state] ?? null;
    const workspace = id ? await requestResult<PlanningWorkspace | undefined>(tx.objectStore("workspaces").get(id)) : null;
    await done;
    return workspace?.state === state ? id : null;
  }

  async setActiveWorkspaceId(state: PlanningState, workspaceId: string | null): Promise<void> {
    const tx = this.db.transaction(["settings", "workspaces"], "readwrite");
    const done = transactionDone(tx);
    try {
      if (workspaceId) {
        const workspace = await requestResult<PlanningWorkspace | undefined>(tx.objectStore("workspaces").get(workspaceId));
        if (!workspace || workspace.state !== state) throw new PlanningStorageError("Active Planning workspace must exist in the selected state.");
      }
      const settingsStore = tx.objectStore("settings");
      const settings = await requestResult<SettingsRecord | undefined>(settingsStore.get(SETTINGS_KEY)) ?? settingsDefault();
      settings.activeWorkspaceIdByState[state] = workspaceId;
      settingsStore.put(settings);
      await done;
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already have ended */ }
      await done.catch(() => undefined);
      throw error;
    }
  }

  async recordBackup(workspaceId: string, revision: number): Promise<PlanningWorkspace> {
    const tx = this.db.transaction("workspaces", "readwrite");
    const done = transactionDone(tx);
    try {
      const store = tx.objectStore("workspaces");
      const current = await requestResult<PlanningWorkspace | undefined>(store.get(workspaceId));
      if (!current || current.revision !== revision) throw new PlanningConflictError();
      const saved = { ...current, lastBackupAt: new Date().toISOString(), lastBackupRevision: revision };
      store.put(saved);
      await done;
      return clone(saved);
    } catch (error) {
      try { tx.abort(); } catch { /* transaction may already have ended */ }
      await done.catch(() => undefined);
      throw error;
    }
  }
}

class MemoryPlanningRepository implements PlanningRepository {
  readonly isPersistent = false;
  private workspaces = new Map<string, PlanningWorkspace>();
  private revisions = new Map<string, PlanningRevision[]>();
  private settings = settingsDefault();
  close(): void {}
  async listWorkspaces(state?: PlanningState): Promise<PlanningWorkspace[]> {
    return [...this.workspaces.values()].filter((entry) => !state || entry.state === state).map(clone).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getWorkspace(id: string): Promise<PlanningWorkspace | null> { return clone(this.workspaces.get(id) ?? null); }
  async createWorkspace(workspace: PlanningWorkspace): Promise<PlanningWorkspace> {
    const saved = validated(workspace);
    if (saved.revision !== 0 || this.workspaces.has(saved.workspaceId)) throw new PlanningStorageError("Planning workspace already exists or has a nonzero revision.");
    this.workspaces.set(saved.workspaceId, saved);
    return clone(saved);
  }
  async saveWorkspace(workspace: PlanningWorkspace, expectedRevision: number, reason = "Before Planning edit"): Promise<PlanningWorkspace> {
    const input = validated(workspace);
    const current = this.workspaces.get(input.workspaceId);
    if (!current || current.revision !== expectedRevision || current.state !== input.state) throw new PlanningConflictError();
    const saved = nextWorkspace(input, expectedRevision + 1);
    const snapshot: PlanningRevision = { workspaceId: current.workspaceId, revision: current.revision, createdAt: saved.updatedAt, reason, workspace: clone(current) };
    this.revisions.set(current.workspaceId, [snapshot, ...(this.revisions.get(current.workspaceId) ?? [])].slice(0, MAX_PLANNING_REVISIONS));
    this.workspaces.set(saved.workspaceId, saved);
    return clone(saved);
  }
  async deleteWorkspace(id: string): Promise<void> {
    const current = this.workspaces.get(id);
    if (!current) throw new PlanningStorageError("Planning workspace was not found.");
    this.workspaces.delete(id);
    this.revisions.delete(id);
    if (this.settings.activeWorkspaceIdByState[current.state] === id) this.settings.activeWorkspaceIdByState[current.state] = null;
  }
  async listRevisions(id: string): Promise<PlanningRevision[]> { return clone(this.revisions.get(id) ?? []); }
  async getActiveWorkspaceId(state: PlanningState): Promise<string | null> {
    const id = this.settings.activeWorkspaceIdByState[state];
    return id && this.workspaces.get(id)?.state === state ? id : null;
  }
  async setActiveWorkspaceId(state: PlanningState, id: string | null): Promise<void> {
    if (id && this.workspaces.get(id)?.state !== state) throw new PlanningStorageError("Active Planning workspace must exist in the selected state.");
    this.settings.activeWorkspaceIdByState[state] = id;
  }
  async recordBackup(id: string, revision: number): Promise<PlanningWorkspace> {
    const current = this.workspaces.get(id);
    if (!current || current.revision !== revision) throw new PlanningConflictError();
    const saved = { ...current, lastBackupAt: new Date().toISOString(), lastBackupRevision: revision };
    this.workspaces.set(id, saved);
    return clone(saved);
  }
}

/** Retain explicit memory-only workspaces while the user switches states in one tab. */
const sharedMemoryRepository = new MemoryPlanningRepository();
