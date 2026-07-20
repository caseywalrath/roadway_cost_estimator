import {
  LEGACY_PROJECT_WORKSPACE_KEYS,
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  createEmptyProjectWorkspaceState,
  isLegacyPlaceholderProject,
  migrateLegacyWorkspace,
  parseUserProjectV4,
  removeProjectFromState,
  type LegacyMigrationResult,
  type ProjectWorkspaceState,
  type UserProject
} from "./projectWorkspace";

const DATABASE_NAME = "roadway-cost-estimator";
const DATABASE_VERSION = 1;
const SETTINGS_KEY = "workspace";
const MAX_REVISIONS_PER_PROJECT = 20;
const PLACEHOLDER_CLEANUP_VERSION = 1;

interface WorkspaceSettingsRecord {
  key: typeof SETTINGS_KEY;
  activeProjectIdByState: Record<string, string | null>;
  migrationComplete: boolean;
  migratedAt: string | null;
  placeholderCleanupVersion?: number;
}

export interface ProjectRevision {
  projectId: string;
  revision: number;
  createdAt: string;
  reason: string;
  project: UserProject;
}

export interface MigrationBackup {
  backupId: string;
  sourceKey: string;
  schemaVersion: number | null;
  rawValue: string;
  createdAt: string;
  report: LegacyMigrationResult | null;
}

export interface ProjectRepositoryInitialization {
  repository: ProjectRepository;
  state: ProjectWorkspaceState;
  warning: string | null;
}

export interface ProjectRepository {
  readonly isPersistent: boolean;
  close(): void;
  loadWorkspaceState(): Promise<ProjectWorkspaceState>;
  createProject(project: UserProject): Promise<UserProject>;
  saveProject(project: UserProject, expectedRevision: number): Promise<UserProject>;
  deleteProject(projectId: string): Promise<void>;
  recordBackup(projectId: string, revision: number): Promise<UserProject>;
  setActiveProjectId(stateCode: string, projectId: string | null): Promise<void>;
  createRevision(project: UserProject, reason: string): Promise<void>;
  listRevisions(projectId: string): Promise<ProjectRevision[]>;
  getProject(projectId: string): Promise<UserProject | null>;
}

export class ProjectConflictError extends Error {
  constructor() {
    super("This Project changed in another browser tab. Reload it before saving again.");
    this.name = "ProjectConflictError";
  }
}

export async function openProjectRepository(): Promise<ProjectRepositoryInitialization> {
  try {
    const database = await openDatabase();
    const repository = new IndexedDbProjectRepository(database);
    const migrationWarning = await repository.initialize();
    return {
      repository,
      state: await repository.loadWorkspaceState(),
      warning: migrationWarning
    };
  } catch {
    const fallback = loadLegacyFallbackState();
    return {
      repository: new MemoryProjectRepository(fallback.state),
      state: fallback.state,
      warning: "Project storage could not be opened. Changes will remain available only in this browser tab."
    };
  }
}

class IndexedDbProjectRepository implements ProjectRepository {
  readonly isPersistent = true;

  constructor(private readonly database: IDBDatabase) {}

  close(): void { this.database.close(); }

  async initialize(): Promise<string | null> {
    const settings = await this.getSettings();
    if (settings?.migrationComplete) {
      await this.cleanupLegacyPlaceholders(settings);
      return null;
    }

    const legacy = findLegacyWorkspace();
    if (!legacy) {
      await this.putSettings(defaultSettings());
      return null;
    }

    const createdAt = new Date().toISOString();
    let report: LegacyMigrationResult | null = null;
    let parseWarning: string | null = null;
    try {
      const parsed: unknown = JSON.parse(legacy.rawValue);
      report = migrateLegacyWorkspace(parsed, legacy.schemaVersion);
      if (report.errors.length > 0) {
        parseWarning = `${report.rejectedProjectCount} saved Project${report.rejectedProjectCount === 1 ? "" : "s"} could not be migrated without dropping data. The original browser record was preserved.`;
      }
    } catch {
      parseWarning = "Saved Project data was not readable. The original browser record was preserved for recovery.";
    }

    const transaction = this.database.transaction(
      ["projects", "settings", "migrationBackups"],
      "readwrite"
    );
    const backup: MigrationBackup = {
      backupId: `migration_${Date.now()}`,
      sourceKey: legacy.key,
      schemaVersion: legacy.schemaVersion,
      rawValue: legacy.rawValue,
      createdAt,
      report
    };
    transaction.objectStore("migrationBackups").put(backup);
    for (const project of report?.state.projects ?? []) {
      transaction.objectStore("projects").put({ ...project, revision: 1 });
    }
    transaction.objectStore("settings").put({
      key: SETTINGS_KEY,
      activeProjectIdByState: report?.state.activeProjectIdByState ?? {},
      migrationComplete: true,
      migratedAt: createdAt,
      placeholderCleanupVersion: PLACEHOLDER_CLEANUP_VERSION
    } satisfies WorkspaceSettingsRecord);
    await transactionDone(transaction);

    const projectCountsMatch = !report || report.state.projects.length
      + report.rejectedProjectCount
      + report.removedPlaceholderProjectCount === report.sourceProjectCount;
    if (report && (!projectCountsMatch || report.migratedLineItemCount !== report.sourceLineItemCount)) {
      return parseWarning ?? "Some saved Project lines require recovery from the preserved migration backup.";
    }
    return parseWarning;
  }

  async loadWorkspaceState(): Promise<ProjectWorkspaceState> {
    const transaction = this.database.transaction(["projects", "settings"], "readonly");
    const projects = await requestResult<UserProject[]>(transaction.objectStore("projects").getAll());
    const settings = await requestResult<WorkspaceSettingsRecord | undefined>(
      transaction.objectStore("settings").get(SETTINGS_KEY)
    );
    await transactionDone(transaction);
    return {
      schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
      activeProjectIdByState: sanitizeActiveProjectIds(settings?.activeProjectIdByState ?? {}, projects),
      projects: projects.map((project) => parseUserProjectV4(project)).filter((project): project is UserProject => project !== null)
    };
  }

  async createProject(project: UserProject): Promise<UserProject> {
    const stored = { ...structuredClone(project), revision: Math.max(1, project.revision), updatedAt: new Date().toISOString() };
    const transaction = this.database.transaction("projects", "readwrite");
    transaction.objectStore("projects").add(stored);
    await transactionDone(transaction);
    return stored;
  }

  async saveProject(project: UserProject, expectedRevision: number): Promise<UserProject> {
    const transaction = this.database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const current = await requestResult<UserProject | undefined>(store.get(project.projectId));
    if (!current || current.revision !== expectedRevision) {
      transaction.abort();
      throw new ProjectConflictError();
    }
    const saved: UserProject = {
      ...structuredClone(project),
      revision: expectedRevision + 1,
      updatedAt: new Date().toISOString()
    };
    store.put(saved);
    await transactionDone(transaction);
    return saved;
  }

  async deleteProject(projectId: string): Promise<void> {
    const transaction = this.database.transaction(["projects", "revisions", "settings"], "readwrite");
    const projectStore = transaction.objectStore("projects");
    const revisionStore = transaction.objectStore("revisions");
    const settingsStore = transaction.objectStore("settings");
    const project = await requestResult<UserProject | undefined>(projectStore.get(projectId));
    if (!project || project.status !== "archived") {
      transaction.abort();
      throw new Error("Only archived Projects can be permanently deleted.");
    }
    const revisionKeys = await requestResult<IDBValidKey[]>(revisionStore.index("projectId").getAllKeys(projectId));
    const settings = await requestResult<WorkspaceSettingsRecord | undefined>(settingsStore.get(SETTINGS_KEY));
    projectStore.delete(projectId);
    for (const revisionKey of revisionKeys) revisionStore.delete(revisionKey);
    if (settings?.activeProjectIdByState[project.state] === projectId) {
      settingsStore.put({
        ...settings,
        activeProjectIdByState: { ...settings.activeProjectIdByState, [project.state]: null }
      } satisfies WorkspaceSettingsRecord);
    }
    await transactionDone(transaction);
  }

  async recordBackup(projectId: string, revision: number): Promise<UserProject> {
    const transaction = this.database.transaction("projects", "readwrite");
    const store = transaction.objectStore("projects");
    const current = await requestResult<UserProject | undefined>(store.get(projectId));
    if (!current) {
      transaction.abort();
      throw new Error("Project was not found.");
    }
    const saved = {
      ...current,
      lastBackupAt: new Date().toISOString(),
      lastBackupRevision: revision
    };
    store.put(saved);
    await transactionDone(transaction);
    return saved;
  }

  async setActiveProjectId(stateCode: string, projectId: string | null): Promise<void> {
    const settings = await this.getSettings() ?? defaultSettings();
    await this.putSettings({
      ...settings,
      activeProjectIdByState: { ...settings.activeProjectIdByState, [stateCode]: projectId }
    });
  }

  async createRevision(project: UserProject, reason: string): Promise<void> {
    if (project.revision < 1) return;
    const transaction = this.database.transaction("revisions", "readwrite");
    transaction.objectStore("revisions").put({
      projectId: project.projectId,
      revision: project.revision,
      createdAt: new Date().toISOString(),
      reason,
      project: structuredClone(project)
    } satisfies ProjectRevision);
    await transactionDone(transaction);
    await this.trimRevisions(project.projectId);
  }

  async listRevisions(projectId: string): Promise<ProjectRevision[]> {
    const transaction = this.database.transaction("revisions", "readonly");
    const index = transaction.objectStore("revisions").index("projectId");
    const revisions = await requestResult<ProjectRevision[]>(index.getAll(projectId));
    await transactionDone(transaction);
    return revisions.sort((left, right) => right.revision - left.revision);
  }

  async getProject(projectId: string): Promise<UserProject | null> {
    const transaction = this.database.transaction("projects", "readonly");
    const project = await requestResult<UserProject | undefined>(transaction.objectStore("projects").get(projectId));
    await transactionDone(transaction);
    return project ?? null;
  }

  private async getSettings(): Promise<WorkspaceSettingsRecord | undefined> {
    const transaction = this.database.transaction("settings", "readonly");
    const settings = await requestResult<WorkspaceSettingsRecord | undefined>(transaction.objectStore("settings").get(SETTINGS_KEY));
    await transactionDone(transaction);
    return settings;
  }

  private async putSettings(settings: WorkspaceSettingsRecord): Promise<void> {
    const transaction = this.database.transaction("settings", "readwrite");
    transaction.objectStore("settings").put(settings);
    await transactionDone(transaction);
  }

  private async cleanupLegacyPlaceholders(settings: WorkspaceSettingsRecord): Promise<void> {
    if ((settings.placeholderCleanupVersion ?? 0) >= PLACEHOLDER_CLEANUP_VERSION) return;

    const readTransaction = this.database.transaction(["projects", "migrationBackups"], "readonly");
    const projects = await requestResult<UserProject[]>(readTransaction.objectStore("projects").getAll());
    const backups = await requestResult<MigrationBackup[]>(readTransaction.objectStore("migrationBackups").getAll());
    await transactionDone(readTransaction);

    const legacyProjectIds = new Set(backups.flatMap((backup) =>
      backup.report?.state.projects.map((project) => project.projectId) ?? []
    ));
    const placeholderIds = projects
      .filter((project) => legacyProjectIds.has(project.projectId) && isLegacyPlaceholderProject(project))
      .map((project) => project.projectId);
    const placeholderIdSet = new Set(placeholderIds);
    const activeProjectIdByState = Object.fromEntries(
      Object.entries(settings.activeProjectIdByState).map(([stateCode, projectId]) => [
        stateCode,
        projectId && placeholderIdSet.has(projectId) ? null : projectId
      ])
    );

    const writeTransaction = this.database.transaction(["projects", "revisions", "settings"], "readwrite");
    const projectStore = writeTransaction.objectStore("projects");
    const revisionStore = writeTransaction.objectStore("revisions");
    const revisionIndex = revisionStore.index("projectId");
    for (const projectId of placeholderIds) {
      projectStore.delete(projectId);
      const revisionKeys = await requestResult<IDBValidKey[]>(revisionIndex.getAllKeys(projectId));
      for (const revisionKey of revisionKeys) revisionStore.delete(revisionKey);
    }
    writeTransaction.objectStore("settings").put({
      ...settings,
      activeProjectIdByState,
      placeholderCleanupVersion: PLACEHOLDER_CLEANUP_VERSION
    } satisfies WorkspaceSettingsRecord);
    await transactionDone(writeTransaction);
  }

  private async trimRevisions(projectId: string): Promise<void> {
    const revisions = await this.listRevisions(projectId);
    if (revisions.length <= MAX_REVISIONS_PER_PROJECT) return;
    const transaction = this.database.transaction("revisions", "readwrite");
    const store = transaction.objectStore("revisions");
    for (const revision of revisions.slice(MAX_REVISIONS_PER_PROJECT)) {
      store.delete([revision.projectId, revision.revision]);
    }
    await transactionDone(transaction);
  }
}

class MemoryProjectRepository implements ProjectRepository {
  readonly isPersistent = false;
  constructor(private state: ProjectWorkspaceState) {}

  close(): void {}

  async loadWorkspaceState(): Promise<ProjectWorkspaceState> { return structuredClone(this.state); }
  async createProject(project: UserProject): Promise<UserProject> {
    const saved = { ...structuredClone(project), revision: 1 };
    this.state.projects.push(saved);
    return saved;
  }
  async saveProject(project: UserProject, expectedRevision: number): Promise<UserProject> {
    const saved = { ...structuredClone(project), revision: expectedRevision + 1, updatedAt: new Date().toISOString() };
    this.state.projects = this.state.projects.map((candidate) => candidate.projectId === saved.projectId ? saved : candidate);
    return saved;
  }
  async deleteProject(projectId: string): Promise<void> {
    const project = this.state.projects.find((candidate) => candidate.projectId === projectId);
    if (!project || project.status !== "archived") throw new Error("Only archived Projects can be permanently deleted.");
    this.state = removeProjectFromState(this.state, projectId);
  }
  async recordBackup(projectId: string, revision: number): Promise<UserProject> {
    const project = this.state.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) throw new Error("Project was not found.");
    project.lastBackupAt = new Date().toISOString();
    project.lastBackupRevision = revision;
    return structuredClone(project);
  }
  async setActiveProjectId(stateCode: string, projectId: string | null): Promise<void> {
    this.state.activeProjectIdByState[stateCode] = projectId;
  }
  async createRevision(): Promise<void> {}
  async listRevisions(): Promise<ProjectRevision[]> { return []; }
  async getProject(projectId: string): Promise<UserProject | null> {
    return structuredClone(this.state.projects.find((project) => project.projectId === projectId) ?? null);
  }
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
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
    request.onsuccess = () => resolve(request.result);
  });
}

function findLegacyWorkspace(): { key: string; rawValue: string; schemaVersion: 1 | 2 | 3 } | null {
  for (let index = 0; index < LEGACY_PROJECT_WORKSPACE_KEYS.length; index += 1) {
    const key = LEGACY_PROJECT_WORKSPACE_KEYS[index];
    const rawValue = window.localStorage.getItem(key);
    if (rawValue) return { key, rawValue, schemaVersion: (3 - index) as 1 | 2 | 3 };
  }
  return null;
}

function loadLegacyFallbackState(): LegacyMigrationResult {
  const legacy = findLegacyWorkspace();
  if (!legacy) {
    return {
      state: createEmptyProjectWorkspaceState(),
      rejectedProjectCount: 0,
      removedPlaceholderProjectIds: [],
      removedPlaceholderProjectCount: 0,
      sourceProjectCount: 0,
      sourceLineItemCount: 0,
      migratedLineItemCount: 0,
      errors: []
    };
  }
  try {
    return migrateLegacyWorkspace(JSON.parse(legacy.rawValue) as unknown, legacy.schemaVersion);
  } catch {
    return {
      state: createEmptyProjectWorkspaceState(),
      rejectedProjectCount: 0,
      removedPlaceholderProjectIds: [],
      removedPlaceholderProjectCount: 0,
      sourceProjectCount: 0,
      sourceLineItemCount: 0,
      migratedLineItemCount: 0,
      errors: ["Legacy workspace was not readable."]
    };
  }
}

function defaultSettings(): WorkspaceSettingsRecord {
  return {
    key: SETTINGS_KEY,
    activeProjectIdByState: {},
    migrationComplete: true,
    migratedAt: null,
    placeholderCleanupVersion: PLACEHOLDER_CLEANUP_VERSION
  };
}

function sanitizeActiveProjectIds(
  activeProjectIdByState: Record<string, string | null>,
  projects: UserProject[]
): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  for (const [stateCode, projectId] of Object.entries(activeProjectIdByState)) {
    const project = projects.find((candidate) => candidate.projectId === projectId);
    result[stateCode] = project?.state === stateCode && project.status === "active" ? project.projectId : null;
  }
  return result;
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
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction was aborted."));
  });
}
