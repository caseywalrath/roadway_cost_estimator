import type {
  EvidenceFilters,
  EvidenceSort,
  EvidenceStats,
  SearchQuery
} from "../data/schema";

export const PROJECT_WORKSPACE_STORAGE_KEY = "roadway-cost-estimator:projects:v1";
export const PROJECT_WORKSPACE_SCHEMA_VERSION = 1;

export interface ProjectWorkspaceState {
  schemaVersion: 1;
  activeProjectId: string | null;
  projects: UserProject[];
}

export interface UserProject {
  projectId: string;
  name: string;
  location: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  lineItems: ProjectLineItem[];
}

export interface ProjectLineItem {
  lineItemId: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  preferredUnitCost: number;
  costBasis: string;
  notes: string;
  evidenceContext: ProjectEvidenceContext;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEvidenceContext {
  query: SearchQuery;
  filters: EvidenceFilters;
  sort: EvidenceSort;
  includedRowCount: number;
  includedObservationIds: string[];
  summarySnapshot: ProjectEvidenceSummarySnapshot;
  costSource: "manual" | "quick_fill";
  costSourceLabel: string;
}

export interface ProjectEvidenceSummarySnapshot {
  awarded: EvidenceStats | null;
  average: EvidenceStats | null;
  engineer: EvidenceStats | null;
  inflationAdjustmentEnabled: boolean;
  inflationTargetPeriodLabel: string | null;
  valuesAreInflationAdjusted: boolean;
}

export interface ProjectWorkspaceLoadResult {
  state: ProjectWorkspaceState;
  warning: string | null;
}

export interface CreateProjectLineItemInput {
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  preferredUnitCost: number;
  costBasis: string;
  notes: string;
  evidenceContext: ProjectEvidenceContext;
}

export function createEmptyProjectWorkspaceState(): ProjectWorkspaceState {
  return {
    schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    activeProjectId: null,
    projects: []
  };
}

export function loadProjectWorkspaceState(): ProjectWorkspaceLoadResult {
  try {
    const rawValue = window.localStorage.getItem(PROJECT_WORKSPACE_STORAGE_KEY);

    if (!rawValue) {
      return {
        state: createEmptyProjectWorkspaceState(),
        warning: null
      };
    }

    const parsedValue: unknown = JSON.parse(rawValue);
    const state = parseProjectWorkspaceState(parsedValue);

    if (!state) {
      return {
        state: createEmptyProjectWorkspaceState(),
        warning: "Saved project data was not readable. The Project workspace started with a clean local draft."
      };
    }

    return {
      state,
      warning: null
    };
  } catch {
    return {
      state: createEmptyProjectWorkspaceState(),
      warning: "Saved project data could not be loaded. The Project workspace is still available for this browser session."
    };
  }
}

export function saveProjectWorkspaceState(state: ProjectWorkspaceState): string | null {
  try {
    window.localStorage.setItem(PROJECT_WORKSPACE_STORAGE_KEY, JSON.stringify(state));
    return null;
  } catch {
    return "Project changes could not be saved to browser storage. They will remain available only until this page is reloaded.";
  }
}

export function ensureActiveProject(state: ProjectWorkspaceState): ProjectWorkspaceState {
  const activeProject = getActiveProject(state);

  if (activeProject) {
    return state;
  }

  const project = createUserProject();

  return {
    ...state,
    activeProjectId: project.projectId,
    projects: [...state.projects, project]
  };
}

export function getActiveProject(state: ProjectWorkspaceState): UserProject | null {
  return state.projects.find((project) => project.projectId === state.activeProjectId) ?? state.projects[0] ?? null;
}

export function hasRequiredProjectMetadata(project: UserProject | null): boolean {
  return Boolean(project?.name.trim() && project.location.trim());
}

export function updateActiveProjectMetadata(
  state: ProjectWorkspaceState,
  fields: Pick<UserProject, "name" | "location" | "notes">
): ProjectWorkspaceState {
  const activeProject = getActiveProject(state);

  if (!activeProject) {
    return state;
  }

  const now = currentTimestamp();

  return updateProject(state, activeProject.projectId, {
    ...activeProject,
    name: fields.name,
    location: fields.location,
    notes: fields.notes,
    updatedAt: now
  });
}

export function createProjectLineItem(input: CreateProjectLineItemInput): ProjectLineItem {
  const now = currentTimestamp();

  return {
    lineItemId: createId("line"),
    itemCode: input.itemCode,
    description: input.description,
    unit: input.unit,
    quantity: input.quantity,
    preferredUnitCost: input.preferredUnitCost,
    costBasis: input.costBasis,
    notes: input.notes,
    evidenceContext: input.evidenceContext,
    createdAt: now,
    updatedAt: now
  };
}

export function addProjectLineItem(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItem: ProjectLineItem
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);

  if (!project) {
    return state;
  }

  return updateProject(state, projectId, {
    ...project,
    lineItems: [...project.lineItems, lineItem],
    updatedAt: currentTimestamp()
  });
}

export function replaceProjectLineItem(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string,
  replacement: ProjectLineItem
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  const currentLine = project?.lineItems.find((lineItem) => lineItem.lineItemId === lineItemId);

  if (!project || !currentLine) {
    return state;
  }

  const now = currentTimestamp();
  const nextLineItem: ProjectLineItem = {
    ...replacement,
    lineItemId,
    createdAt: currentLine.createdAt,
    updatedAt: now
  };

  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((lineItem) =>
      lineItem.lineItemId === lineItemId ? nextLineItem : lineItem
    ),
    updatedAt: now
  });
}

export function updateProjectLineItem(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string,
  fields: Pick<ProjectLineItem, "quantity" | "preferredUnitCost" | "costBasis" | "notes">
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);

  if (!project) {
    return state;
  }

  const now = currentTimestamp();

  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((lineItem) =>
      lineItem.lineItemId === lineItemId
        ? {
            ...lineItem,
            quantity: fields.quantity,
            preferredUnitCost: fields.preferredUnitCost,
            costBasis: fields.costBasis,
            notes: fields.notes,
            updatedAt: now
          }
        : lineItem
    ),
    updatedAt: now
  });
}

export function removeProjectLineItem(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);

  if (!project) {
    return state;
  }

  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.filter((lineItem) => lineItem.lineItemId !== lineItemId),
    updatedAt: currentTimestamp()
  });
}

function createUserProject(): UserProject {
  const now = currentTimestamp();

  return {
    projectId: createId("project"),
    name: "",
    location: "",
    notes: "",
    createdAt: now,
    updatedAt: now,
    lineItems: []
  };
}

function updateProject(
  state: ProjectWorkspaceState,
  projectId: string,
  nextProject: UserProject
): ProjectWorkspaceState {
  return {
    ...state,
    activeProjectId: projectId,
    projects: state.projects.map((project) =>
      project.projectId === projectId ? nextProject : project
    )
  };
}

function parseProjectWorkspaceState(value: unknown): ProjectWorkspaceState | null {
  if (!isRecord(value) || value.schemaVersion !== PROJECT_WORKSPACE_SCHEMA_VERSION) {
    return null;
  }

  if (!Array.isArray(value.projects)) {
    return null;
  }

  const projects = value.projects
    .map(parseUserProject)
    .filter((project): project is UserProject => project !== null);

  const activeProjectId = typeof value.activeProjectId === "string" ? value.activeProjectId : null;
  const resolvedActiveProjectId = projects.some((project) => project.projectId === activeProjectId)
    ? activeProjectId
    : projects[0]?.projectId ?? null;

  return {
    schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    activeProjectId: resolvedActiveProjectId,
    projects
  };
}

function parseUserProject(value: unknown): UserProject | null {
  if (!isRecord(value) || typeof value.projectId !== "string") {
    return null;
  }

  return {
    projectId: value.projectId,
    name: stringValue(value.name),
    location: stringValue(value.location),
    notes: stringValue(value.notes),
    createdAt: stringValue(value.createdAt) || currentTimestamp(),
    updatedAt: stringValue(value.updatedAt) || currentTimestamp(),
    lineItems: Array.isArray(value.lineItems)
      ? value.lineItems
          .map(parseProjectLineItem)
          .filter((lineItem): lineItem is ProjectLineItem => lineItem !== null)
      : []
  };
}

function parseProjectLineItem(value: unknown): ProjectLineItem | null {
  if (!isRecord(value) || typeof value.lineItemId !== "string") {
    return null;
  }

  const quantity = numberValue(value.quantity);
  const preferredUnitCost = numberValue(value.preferredUnitCost);
  const evidenceContext = parseProjectEvidenceContext(value.evidenceContext);

  if (quantity === null || preferredUnitCost === null || !evidenceContext) {
    return null;
  }

  return {
    lineItemId: value.lineItemId,
    itemCode: stringValue(value.itemCode),
    description: stringValue(value.description),
    unit: stringValue(value.unit),
    quantity,
    preferredUnitCost,
    costBasis: stringValue(value.costBasis) || "Manual entry",
    notes: stringValue(value.notes),
    evidenceContext,
    createdAt: stringValue(value.createdAt) || currentTimestamp(),
    updatedAt: stringValue(value.updatedAt) || currentTimestamp()
  };
}

function parseProjectEvidenceContext(value: unknown): ProjectEvidenceContext | null {
  if (!isRecord(value)) {
    return null;
  }

  const summarySnapshot = parseProjectEvidenceSummarySnapshot(value.summarySnapshot);

  if (!isRecord(value.query) || !isRecord(value.filters) || !isRecord(value.sort) || !summarySnapshot) {
    return null;
  }

  return {
    query: value.query as unknown as SearchQuery,
    filters: value.filters as unknown as EvidenceFilters,
    sort: value.sort as unknown as EvidenceSort,
    includedRowCount: numberValue(value.includedRowCount) ?? 0,
    includedObservationIds: Array.isArray(value.includedObservationIds)
      ? value.includedObservationIds.map((item) => String(item)).filter(Boolean)
      : [],
    summarySnapshot,
    costSource: value.costSource === "quick_fill" ? "quick_fill" : "manual",
    costSourceLabel: stringValue(value.costSourceLabel) || "Manual entry"
  };
}

function parseProjectEvidenceSummarySnapshot(value: unknown): ProjectEvidenceSummarySnapshot | null {
  if (!isRecord(value)) {
    return null;
  }

  return {
    awarded: parseEvidenceStats(value.awarded),
    average: parseEvidenceStats(value.average),
    engineer: parseEvidenceStats(value.engineer),
    inflationAdjustmentEnabled: Boolean(value.inflationAdjustmentEnabled),
    inflationTargetPeriodLabel: typeof value.inflationTargetPeriodLabel === "string"
      ? value.inflationTargetPeriodLabel
      : null,
    valuesAreInflationAdjusted: Boolean(value.valuesAreInflationAdjusted)
  };
}

function parseEvidenceStats(value: unknown): EvidenceStats | null {
  if (!isRecord(value)) {
    return null;
  }

  const count = numberValue(value.count);
  const low = numberValue(value.low);
  const p25 = numberValue(value.p25);
  const median = numberValue(value.median);
  const average = numberValue(value.average);
  const p75 = numberValue(value.p75);
  const high = numberValue(value.high);

  if (
    count === null
    || low === null
    || p25 === null
    || median === null
    || average === null
    || p75 === null
    || high === null
  ) {
    return null;
  }

  return {
    count,
    low,
    p25,
    median,
    average,
    p75,
    high
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function numberValue(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();

  if (uuid) {
    return `${prefix}_${uuid}`;
  }

  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
