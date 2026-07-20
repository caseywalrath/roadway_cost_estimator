import {
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  createId,
  parseUserProjectV4,
  type UserProject
} from "./projectWorkspace";

const PROJECT_FILE_FORMAT = "roadway-cost-estimator-project";
const PROJECT_FILE_VERSION = 1;

export interface ProjectBackupFile {
  fileFormat: typeof PROJECT_FILE_FORMAT;
  fileVersion: typeof PROJECT_FILE_VERSION;
  exportedAt: string;
  projectSchemaVersion: typeof PROJECT_WORKSPACE_SCHEMA_VERSION;
  revision: number;
  project: UserProject;
}

export function buildProjectBackup(project: UserProject): ProjectBackupFile {
  return {
    fileFormat: PROJECT_FILE_FORMAT,
    fileVersion: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    projectSchemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    revision: project.revision,
    project: structuredClone(project)
  };
}

export function parseProjectBackup(value: unknown): ProjectBackupFile | null {
  if (!isRecord(value)
    || value.fileFormat !== PROJECT_FILE_FORMAT
    || value.fileVersion !== PROJECT_FILE_VERSION
    || value.projectSchemaVersion !== PROJECT_WORKSPACE_SCHEMA_VERSION
    || typeof value.exportedAt !== "string"
    || typeof value.revision !== "number") {
    return null;
  }
  const project = parseUserProjectV4(value.project);
  return project && value.revision === project.revision ? { ...value, project } as ProjectBackupFile : null;
}

export function createImportedCopy(project: UserProject): UserProject {
  const now = new Date().toISOString();
  return {
    ...structuredClone(project),
    projectId: createId("project"),
    name: `Copy of ${project.name.trim() || "Unnamed Project"}`,
    status: "active",
    archivedAt: null,
    revision: 0,
    lastBackupAt: null,
    lastBackupRevision: null,
    createdAt: now,
    updatedAt: now,
    lineItems: project.lineItems.map((lineItem) => ({
      ...structuredClone(lineItem),
      lineItemId: createId("line"),
      createdAt: now,
      updatedAt: now
    }))
  };
}

export function downloadProjectBackup(project: UserProject): void {
  const file = buildProjectBackup(project);
  const blob = new Blob([JSON.stringify(file, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(project.name || "project")}.rce-project.json`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function readProjectBackupFile(file: File): Promise<ProjectBackupFile> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text()) as unknown;
  } catch {
    throw new Error("The selected Project backup is not valid JSON.");
  }
  const backup = parseProjectBackup(parsed);
  if (!backup) throw new Error("The selected file is not a supported Roadway Cost Estimator Project backup.");
  return backup;
}

function sanitizeFilename(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
