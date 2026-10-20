import {
  PROJECT_WORKSPACE_SCHEMA_VERSION,
  createId,
  projectCostSummary,
  parseUserProjectV9,
  parseUserProjectV10,
  parseUserProjectV11,
  parseUserProjectV12,
  type ProjectCostSummary,
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
  summary: ProjectCostSummary;
}

export function buildProjectBackup(project: UserProject): ProjectBackupFile {
  return {
    fileFormat: PROJECT_FILE_FORMAT,
    fileVersion: PROJECT_FILE_VERSION,
    exportedAt: new Date().toISOString(),
    projectSchemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    revision: project.revision,
    project: structuredClone(project),
    summary: projectCostSummary(project)
  };
}

export function parseProjectBackup(value: unknown): ProjectBackupFile | null {
  if (!isRecord(value)
    || value.fileFormat !== PROJECT_FILE_FORMAT
    || value.fileVersion !== PROJECT_FILE_VERSION
    || (value.projectSchemaVersion !== 4
      && value.projectSchemaVersion !== 5
      && value.projectSchemaVersion !== 6
      && value.projectSchemaVersion !== 7
      && value.projectSchemaVersion !== 8
      && value.projectSchemaVersion !== 9
      && value.projectSchemaVersion !== 10
      && value.projectSchemaVersion !== 11
      && value.projectSchemaVersion !== PROJECT_WORKSPACE_SCHEMA_VERSION)
    || typeof value.exportedAt !== "string"
    || typeof value.revision !== "number") {
    return null;
  }
  const project = value.projectSchemaVersion === PROJECT_WORKSPACE_SCHEMA_VERSION
    ? parseUserProjectV12(value.project)
    : value.projectSchemaVersion === 11
      ? parseUserProjectV11(value.project)
    : value.projectSchemaVersion === 10
      ? parseUserProjectV10(value.project)
      : parseUserProjectV9(value.project);
  return project && value.revision === project.revision
    ? {
        ...value,
        projectSchemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
        project,
        summary: projectCostSummary(project)
      } as ProjectBackupFile
    : null;
}

export function createImportedCopy(project: UserProject): UserProject {
  const now = new Date().toISOString();
  const newIds = new Map(project.lineItems.map((line) => [line.lineItemId, createId("line")]));
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
      lineItemId: newIds.get(lineItem.lineItemId)!,
      ...(lineItem.percentageBase?.kind === "selected_lines" ? { percentageBase: { kind: "selected_lines" as const, lineItemIds: lineItem.percentageBase.lineItemIds.map((id) => newIds.get(id) ?? id) } } : {}),
      createdAt: now,
      updatedAt: now
    })),
    ...(project.excelImportSources ? {
      excelImportSources: project.excelImportSources.map((source) => ({
        ...structuredClone(source),
        rows: source.rows.map((row) => ({
          ...structuredClone(row),
          lineItemIds: row.lineItemIds.map((id) => newIds.get(id) ?? id)
        }))
      }))
    } : {})
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
