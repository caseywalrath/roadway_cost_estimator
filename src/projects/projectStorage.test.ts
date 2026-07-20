// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateConfig } from "../data/schema";
import { buildProjectBackup, createImportedCopy, parseProjectBackup } from "./projectBackup";
import { PROJECT_EDIT_STALE_AFTER_MS, ProjectEditCoordinator } from "./projectEditCoordinator";
import { openProjectRepository, ProjectConflictError, type ProjectRepository } from "./projectRepository";
import { renderProjectManager, renderProjectWorkspace } from "../ui/renderProjectWorkspace";
import {
  addProject,
  createEmptyProjectWorkspaceState,
  createUserProject,
  duplicateUserProject,
  getActiveProject,
  migrateLegacyWorkspace,
  setActiveProject
} from "./projectWorkspace";

let repository: ProjectRepository | null = null;

beforeEach(async () => {
  TestBroadcastChannel.reset();
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  window.localStorage.clear();
  await deleteDatabase();
});

afterEach(async () => {
  repository?.close();
  repository = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await deleteDatabase();
});

describe("Project workspace v4", () => {
  it("renders one Project Actions menu without a duplicate workspace state selector", () => {
    const project = createUserProject("Header test", "CO");
    const html = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);

    expect(html).toContain("Project Actions");
    expect(html).toContain("Export CSV");
    expect(html).not.toContain("Export Project CSV");
    expect(html).toContain("Export Project Backup");
    expect(html).toContain("Import Project Backup");
    expect(html).not.toContain('name="state"');
    expect(html).not.toContain('id="project-name"');
    expect(html).toContain("Edit Active Project");
    expect(html).not.toContain("<span>Active Project</span>");
    expect(html).toContain('class="project-switcher-project-state">CO</span>');
  });

  it("shows Project Actions and explicit creation from both empty workspace states", () => {
    const archived = { ...createUserProject("Archived", "CO"), status: "archived" as const };
    const freshHtml = renderProjectWorkspace(null, [], testStates(), "CO", false, null);
    const archivedHtml = renderProjectWorkspace(null, [archived], testStates(), "CO", false, null);

    for (const html of [freshHtml, archivedHtml]) {
      expect(html).toContain("Project Actions");
      expect(html).toContain("No active Project");
      expect(html).toContain("New Project");
      expect(html).not.toContain("project-metadata-editor-form");
    }
  });

  it("renders workspace creation without a default manager creation editor", () => {
    const createEditor = {
      context: "workspace" as const,
      mode: "create" as const,
      projectId: null,
      state: "CO",
      name: "",
      location: "",
      notes: ""
    };
    const workspaceHtml = renderProjectWorkspace(null, [], testStates(), "CO", false, createEditor);
    const managerHtml = renderProjectManager([], testStates(), "CO", { query: "", state: "all", status: "active" }, null, false, null);

    expect(workspaceHtml).toContain("Create Project");
    expect(workspaceHtml).toContain('name="notes"');
    expect(managerHtml).toContain("Project Actions");
    expect(managerHtml).not.toContain('id="manager-project-editor-form"');
    expect(managerHtml).not.toContain("New Project</p><h2>");
  });

  it("renders the simplified manager and permanent delete only for archived Projects", () => {
    const active = createUserProject("Active", "CO");
    const archived = { ...createUserProject("Archived", "IA"), status: "archived" as const, archivedAt: new Date().toISOString() };
    const activeHtml = renderProjectManager([active, archived], testStates(), "CO", { query: "", state: "all", status: "active" }, active, false, null);
    const archivedHtml = renderProjectManager([active, archived], testStates(), "CO", { query: "", state: "all", status: "archived" }, active, false, null);

    expect(activeHtml).toContain('class="text-button" data-open-project');
    expect(activeHtml).not.toContain("Version history");
    expect(activeHtml).not.toContain("<th>Backup</th>");
    expect(activeHtml).not.toContain("Create, switch, back up, and archive browser Projects.");
    expect(activeHtml.indexOf("Back to active Project")).toBeLessThan(activeHtml.indexOf("Project Actions"));
    expect(activeHtml).not.toContain("data-delete-project");
    expect(archivedHtml).toContain('data-delete-project');
    expect(archivedHtml).toContain('aria-label="Permanently delete Archived"');
  });

  it("does not render an empty-line message for a Project with zero items", () => {
    const project = createUserProject("Empty", "CO");
    const html = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);
    expect(html).toContain("0 lines");
    expect(html).not.toContain("No project items have been added");
  });

  it("tracks an independent active Project for each state", () => {
    const colorado = createUserProject("Colorado estimate", "CO");
    const iowa = createUserProject("Iowa estimate", "IA");
    let state = addProject(createEmptyProjectWorkspaceState(), colorado);
    state = addProject(state, iowa);
    state = setActiveProject(state, colorado.projectId, "CO");

    expect(getActiveProject(state, "CO")?.projectId).toBe(colorado.projectId);
    expect(getActiveProject(state, "IA")?.projectId).toBe(iowa.projectId);
  });

  it("duplicates Project and line identities without changing evidence", () => {
    const project = createUserProject("Estimate", "CO");
    project.lineItems = [{
      lineItemId: "line_original",
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_001",
      itemCode: "001",
      description: "Test item",
      unit: "EACH",
      quantity: 1,
      preferredUnitCost: 2,
      notes: "",
      evidenceContext: {
        query: {} as never,
        filters: {} as never,
        sort: {} as never,
        includedRowCount: 0,
        includedObservationIds: ["observation_1"],
        summarySnapshot: {
          awarded: null,
          average: null,
          engineer: null,
          inflationAdjustmentEnabled: false,
          inflationTargetPeriodLabel: null,
          valuesAreInflationAdjusted: false
        },
        costSource: "manual"
      },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }];

    const duplicate = duplicateUserProject(project);
    expect(duplicate.projectId).not.toBe(project.projectId);
    expect(duplicate.lineItems[0].lineItemId).not.toBe(project.lineItems[0].lineItemId);
    expect(duplicate.lineItems[0].evidenceContext.includedObservationIds).toEqual(["observation_1"]);
  });

  it("rejects a legacy Project rather than silently dropping an invalid line", () => {
    const result = migrateLegacyWorkspace({
      schemaVersion: 3,
      activeProjectId: "project_bad",
      projects: [{
        projectId: "project_bad",
        state: "CO",
        name: "Bad estimate",
        location: "",
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lineItems: [{ lineItemId: "line_bad", quantity: "not-a-number" }]
      }]
    }, 3);

    expect(result.state.projects).toHaveLength(0);
    expect(result.rejectedProjectCount).toBe(1);
    expect(result.errors[0]).toContain("without dropping data");
  });

  it("removes only blank zero-line legacy placeholders and reconciles active state", () => {
    const blank = legacyProject("project_blank", "CO", "");
    const named = legacyProject("project_named", "CO", "Named estimate");
    const result = migrateLegacyWorkspace({
      schemaVersion: 3,
      activeProjectId: "project_blank",
      projects: [blank, named]
    }, 3);

    expect(result.state.projects.map((project) => project.projectId)).toEqual(["project_named"]);
    expect(result.state.activeProjectIdByState.CO).toBe("project_named");
    expect(result.removedPlaceholderProjectIds).toEqual(["project_blank"]);
    expect(result.removedPlaceholderProjectCount).toBe(1);
    expect(result.rejectedProjectCount).toBe(0);
    expect(result.state.projects.length + result.rejectedProjectCount + result.removedPlaceholderProjectCount).toBe(result.sourceProjectCount);
  });

  it.each([1, 2] as const)("migrates a v%s workspace into Colorado", (schemaVersion) => {
    const project = legacyProject(`project_v${schemaVersion}`, "CO", `Version ${schemaVersion}`);
    delete project.state;
    const result = migrateLegacyWorkspace({
      schemaVersion,
      activeProjectId: project.projectId,
      projects: [project]
    }, schemaVersion);

    expect(result.errors).toEqual([]);
    expect(result.state.projects[0].state).toBe("CO");
    expect(result.state.activeProjectIdByState.CO).toBe(project.projectId);
  });
});

describe("Project backup format", () => {
  it("round trips a v4 Project and creates collision-safe copies", () => {
    const project = { ...createUserProject("Backup test", "IA"), revision: 7 };
    const parsed = parseProjectBackup(JSON.parse(JSON.stringify(buildProjectBackup(project))) as unknown);
    expect(parsed?.project).toEqual(project);

    const copy = createImportedCopy(parsed!.project);
    expect(copy.projectId).not.toBe(project.projectId);
    expect(copy.name).toBe("Copy of Backup test");
    expect(copy.revision).toBe(0);
  });

  it("rejects unsupported JSON files", () => {
    expect(parseProjectBackup({ fileFormat: "other" })).toBeNull();
    const project = { ...createUserProject("Revision mismatch", "CO"), revision: 3 };
    expect(parseProjectBackup({ ...buildProjectBackup(project), revision: 2 })).toBeNull();
  });
});

describe.sequential("IndexedDB Project repository", () => {
  it("migrates v3 Projects, preserves the raw record, and resolves active state", async () => {
    const rawValue = JSON.stringify({
      schemaVersion: 3,
      activeProjectId: "project_co",
      projects: [
        legacyProject("project_co", "CO", "Colorado"),
        legacyProject("project_ia", "IA", "Iowa")
      ]
    });
    window.localStorage.setItem("roadway-cost-estimator:projects:v3", rawValue);

    const initialized = await openProjectRepository();
    repository = initialized.repository;
    expect(initialized.state.projects).toHaveLength(2);
    expect(initialized.state.activeProjectIdByState).toEqual({ CO: "project_co", IA: "project_ia" });
    expect(window.localStorage.getItem("roadway-cost-estimator:projects:v3")).not.toBeNull();
    expect((await readAllRecords<{ rawValue: string }>("migrationBackups"))[0].rawValue).toBe(rawValue);
  });

  it("preserves an invalid legacy Project for recovery without partially migrating it", async () => {
    const rawValue = JSON.stringify({
      schemaVersion: 3,
      activeProjectId: "project_bad",
      projects: [{ ...legacyProject("project_bad", "CO", "Bad"), lineItems: [{ lineItemId: "bad" }] }]
    });
    window.localStorage.setItem("roadway-cost-estimator:projects:v3", rawValue);

    const initialized = await openProjectRepository();
    repository = initialized.repository;
    expect(initialized.state.projects).toEqual([]);
    expect(initialized.warning).toContain("could not be migrated");
    expect((await readAllRecords<{ rawValue: string }>("migrationBackups"))[0].rawValue).toBe(rawValue);
  });

  it("removes an already-migrated legacy placeholder once and clears its active ID", async () => {
    const placeholder = { ...createUserProject("", "CO"), projectId: "project_legacy_placeholder", revision: 1 };
    await seedAlreadyMigratedPlaceholder(placeholder);

    const initialized = await openProjectRepository();
    repository = initialized.repository;
    expect(initialized.state.projects).toEqual([]);
    expect(initialized.state.activeProjectIdByState.CO).toBeNull();
    expect((await readAllRecords<{ rawValue: string }>("migrationBackups"))[0].rawValue).toBe("exact legacy value");
    expect((await readAllRecords<{ placeholderCleanupVersion: number }>("settings"))[0].placeholderCleanupVersion).toBe(1);
  });

  it("stores Projects independently and enforces optimistic revisions", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const first = await repository.createProject(createUserProject("First", "CO"));
    const second = await repository.createProject(createUserProject("Second", "CO"));
    await repository.setActiveProjectId("CO", second.projectId);

    const saved = await repository.saveProject({ ...first, notes: "updated" }, first.revision);
    expect(saved.revision).toBe(first.revision + 1);
    await expect(repository.saveProject(first, first.revision)).rejects.toBeInstanceOf(ProjectConflictError);

    const loaded = await repository.loadWorkspaceState();
    expect(loaded.projects.map((project) => project.name).sort()).toEqual(["First", "Second"]);
    expect(loaded.activeProjectIdByState.CO).toBe(second.projectId);
  });

  it("retains only the latest 20 snapshots", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    let project = await repository.createProject(createUserProject("History", "CO"));
    for (let index = 0; index < 25; index += 1) {
      project = await repository.saveProject({ ...project, notes: String(index) }, project.revision);
      await repository.createRevision(project, `Snapshot ${index}`);
    }
    const revisions = await repository.listRevisions(project.projectId);
    expect(revisions).toHaveLength(20);
    expect(revisions[0].revision).toBe(project.revision);
  });

  it("records backup status without creating a new Project revision", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const project = await repository.createProject(createUserProject("Backup", "CO"));
    const backedUp = await repository.recordBackup(project.projectId, project.revision);
    expect(backedUp.revision).toBe(project.revision);
    expect(backedUp.lastBackupRevision).toBe(project.revision);
  });

  it("permanently deletes only archived Projects and their snapshots", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const active = await repository.createProject(createUserProject("Active", "CO"));
    await expect(repository.deleteProject(active.projectId)).rejects.toThrow("Only archived Projects");

    const archived = await repository.saveProject({ ...active, status: "archived", archivedAt: new Date().toISOString() }, active.revision);
    await repository.createRevision(archived, "Archived snapshot");
    await repository.deleteProject(archived.projectId);

    expect(await repository.getProject(archived.projectId)).toBeNull();
    expect(await repository.listRevisions(archived.projectId)).toEqual([]);
  });
});

describe("Project edit coordination", () => {
  it("opens a second tab read-only and permits an explicit takeover", async () => {
    const first = new ProjectEditCoordinator();
    const second = new ProjectEditCoordinator();
    const lostOwnership = vi.fn();
    first.setLostOwnershipHandler(lostOwnership);

    const firstClaim = first.claim("project_shared");
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(await firstClaim).toBe(true);
    expect(await second.claim("project_shared")).toBe(false);
    second.takeOver("project_shared");
    expect(lostOwnership).toHaveBeenCalledOnce();

    first.close();
    second.close();
  });

  it("releases a stale editing claim after the heartbeat deadline", async () => {
    vi.useFakeTimers();
    const first = new ProjectEditCoordinator();
    const second = new ProjectEditCoordinator();
    const firstClaim = first.claim("project_stale");
    await vi.advanceTimersByTimeAsync(175);
    expect(await firstClaim).toBe(true);
    expect(await second.claim("project_stale")).toBe(false);
    const available = vi.fn();
    second.setOwnershipAvailableHandler(available);
    first.close();

    await vi.advanceTimersByTimeAsync(PROJECT_EDIT_STALE_AFTER_MS);
    expect(available).toHaveBeenCalledOnce();
    second.close();
  });
});

function legacyProject(projectId: string, state: string, name: string): Record<string, unknown> {
  return {
    projectId,
    state,
    name,
    location: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: state === "IA" ? "2026-02-01T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
    lineItems: []
  };
}

function testStates(): StateConfig[] {
  return [{ code: "CO", name: "Colorado" }, { code: "IA", name: "Iowa" }] as unknown as StateConfig[];
}

function seedAlreadyMigratedPlaceholder(project: ReturnType<typeof createUserProject>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("roadway-cost-estimator", 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      const projects = database.createObjectStore("projects", { keyPath: "projectId" });
      projects.createIndex("state", "state");
      projects.createIndex("status", "status");
      projects.createIndex("updatedAt", "updatedAt");
      database.createObjectStore("settings", { keyPath: "key" });
      const revisions = database.createObjectStore("revisions", { keyPath: ["projectId", "revision"] });
      revisions.createIndex("projectId", "projectId");
      revisions.createIndex("createdAt", "createdAt");
      database.createObjectStore("migrationBackups", { keyPath: "backupId" });
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["projects", "settings", "migrationBackups"], "readwrite");
      transaction.objectStore("projects").put(project);
      transaction.objectStore("settings").put({
        key: "workspace",
        activeProjectIdByState: { CO: project.projectId },
        migrationComplete: true,
        migratedAt: "2026-01-01T00:00:00.000Z"
      });
      transaction.objectStore("migrationBackups").put({
        backupId: "migration_old",
        sourceKey: "roadway-cost-estimator:projects:v3",
        schemaVersion: 3,
        rawValue: "exact legacy value",
        createdAt: "2026-01-01T00:00:00.000Z",
        report: {
          state: { schemaVersion: 4, activeProjectIdByState: { CO: project.projectId }, projects: [project] },
          rejectedProjectCount: 0,
          sourceProjectCount: 1,
          sourceLineItemCount: 0,
          migratedLineItemCount: 0,
          errors: []
        }
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("roadway-cost-estimator");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function readAllRecords<T>(storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("roadway-cost-estimator");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readonly");
      const records = transaction.objectStore(storeName).getAll();
      records.onerror = () => reject(records.error);
      records.onsuccess = () => {
        database.close();
        resolve(records.result as T[]);
      };
    };
  });
}

class TestBroadcastChannel {
  static channels = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    const channels = TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>();
    channels.add(this);
    TestBroadcastChannel.channels.set(name, channels);
  }

  postMessage(message: unknown): void {
    for (const channel of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel !== this) channel.onmessage?.({ data: structuredClone(message) } as MessageEvent);
    }
  }

  close(): void {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset(): void {
    TestBroadcastChannel.channels.clear();
  }
}
