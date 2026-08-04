import type {
  EvidenceFilters,
  EvidenceSort,
  EvidenceStats,
  SearchQuery
} from "../data/schema";

export const PROJECT_WORKSPACE_SCHEMA_VERSION = 7;
export const LEGACY_PROJECT_WORKSPACE_KEYS = [
  "roadway-cost-estimator:projects:v3",
  "roadway-cost-estimator:projects:v2",
  "roadway-cost-estimator:projects:v1"
] as const;

export type ProjectStatus = "active" | "archived";

export interface ProjectWorkspaceState {
  schemaVersion: 7;
  activeProjectIdByState: Record<string, string | null>;
  projects: UserProject[];
}

export interface UserProject {
  projectId: string;
  state: string;
  name: string;
  location: string;
  notes: string;
  status: ProjectStatus;
  archivedAt: string | null;
  revision: number;
  lastBackupAt: string | null;
  lastBackupRevision: number | null;
  contingencyPercent: number;
  createdAt: string;
  updatedAt: string;
  lineItems: ProjectLineItem[];
}

export interface ProjectCostSummary {
  constructionCost: number;
  otherCost: number;
  contingencyPercent: number;
  contingencyCost: number;
  totalProjectCost: number;
}

export interface ProjectLineItem {
  lineItemId: string;
  lineItemType: ProjectLineItemType;
  state: string;
  agencyId: string;
  agencyItemId: string;
  group: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number | null;
  preferredUnitCost: number | null;
  notes: string;
  evidenceContext: ProjectEvidenceContext | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectLineItemType = "explorer" | "custom";

export type ProjectSortKey =
  | "group"
  | "itemCode"
  | "description"
  | "preferredUnitCost"
  | "unit"
  | "quantity"
  | "totalItemCost"
  | "notes";

export type ProjectSortDirection = "asc" | "desc";

export interface ProjectSort {
  key: ProjectSortKey;
  direction: ProjectSortDirection;
}

export const DEFAULT_PROJECT_SORT: ProjectSort = {
  key: "group",
  direction: "asc"
};

export interface ProjectEvidenceContext {
  query: SearchQuery;
  filters: EvidenceFilters;
  sort: EvidenceSort;
  includedRowCount: number;
  includedObservationIds: string[];
  summarySnapshot: ProjectEvidenceSummarySnapshot;
  costSource: "manual" | "quick_fill";
}

export interface ProjectEvidenceSummarySnapshot {
  awarded: EvidenceStats | null;
  average: EvidenceStats | null;
  engineer: EvidenceStats | null;
  inflationAdjustmentEnabled: boolean;
  inflationTargetPeriodLabel: string | null;
  valuesAreInflationAdjusted: boolean;
}

export interface CreateProjectLineItemInput {
  state: string;
  agencyId: string;
  agencyItemId: string;
  group: string;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number;
  preferredUnitCost: number;
  notes: string;
  evidenceContext: ProjectEvidenceContext;
}

export interface ProjectLineItemEditableFields {
  group?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  quantity?: number | null;
  preferredUnitCost?: number | null;
  notes?: string;
}

export interface LegacyMigrationResult {
  state: ProjectWorkspaceState;
  rejectedProjectCount: number;
  removedPlaceholderProjectIds: string[];
  removedPlaceholderProjectCount: number;
  sourceProjectCount: number;
  sourceLineItemCount: number;
  migratedLineItemCount: number;
  errors: string[];
}

export function createEmptyProjectWorkspaceState(): ProjectWorkspaceState {
  return {
    schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION,
    activeProjectIdByState: {},
    projects: []
  };
}

export function createUserProject(name: string, state: string, location = "", notes = ""): UserProject {
  const now = currentTimestamp();
  return {
    projectId: createId("project"),
    state,
    name: name.trim(),
    location: location.trim(),
    notes: notes.trim(),
    status: "active",
    archivedAt: null,
    revision: 0,
    lastBackupAt: null,
    lastBackupRevision: null,
    contingencyPercent: 0,
    createdAt: now,
    updatedAt: now,
    lineItems: []
  };
}

export function isLegacyPlaceholderProject(project: UserProject): boolean {
  return !project.name.trim()
    && !project.location.trim()
    && !project.notes.trim()
    && project.lineItems.length === 0;
}

export function getActiveProject(state: ProjectWorkspaceState, stateCode: string): UserProject | null {
  const projectId = state.activeProjectIdByState[stateCode] ?? null;
  return state.projects.find((project) => project.projectId === projectId && project.status === "active") ?? null;
}

export function setActiveProject(state: ProjectWorkspaceState, projectId: string | null, stateCode: string): ProjectWorkspaceState {
  const project = projectId ? state.projects.find((candidate) => candidate.projectId === projectId) : null;
  return {
    ...state,
    activeProjectIdByState: {
      ...state.activeProjectIdByState,
      [stateCode]: project?.status === "active" && project.state === stateCode ? project.projectId : null
    }
  };
}

export function addProject(state: ProjectWorkspaceState, project: UserProject): ProjectWorkspaceState {
  return setActiveProject({ ...state, projects: [...state.projects, project] }, project.projectId, project.state);
}

export function createProjectLineItem(input: CreateProjectLineItemInput): ProjectLineItem {
  const now = currentTimestamp();
  return {
    lineItemId: createId("line"),
    lineItemType: "explorer",
    ...input,
    group: normalizeProjectGroup(input.group),
    createdAt: now,
    updatedAt: now
  };
}

export function createCustomProjectLineItem(state: string): ProjectLineItem {
  const now = currentTimestamp();
  return {
    lineItemId: createId("line"),
    lineItemType: "custom",
    state,
    agencyId: "",
    agencyItemId: "",
    group: "",
    itemCode: "",
    description: "",
    unit: "",
    quantity: null,
    preferredUnitCost: null,
    notes: "",
    evidenceContext: null,
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
  if (!project) return state;
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
  if (!project || !currentLine) return state;
  const now = currentTimestamp();
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((lineItem) => lineItem.lineItemId === lineItemId ? {
      ...replacement,
      lineItemId,
      group: normalizeProjectGroup(replacement.group),
      createdAt: currentLine.createdAt,
      updatedAt: now
    } : lineItem),
    updatedAt: now
  });
}

export function updateProjectLineItem(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string,
  fields: ProjectLineItemEditableFields
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) return state;
  const now = currentTimestamp();
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((lineItem) => {
      if (lineItem.lineItemId !== lineItemId) return lineItem;
      const allowedFields = lineItem.lineItemType === "custom"
        ? normalizeProjectLineItemFields(fields)
        : {
            ...(fields.group !== undefined ? { group: normalizeProjectGroup(fields.group) } : {}),
            ...(fields.quantity !== undefined ? { quantity: fields.quantity } : {}),
            ...(fields.preferredUnitCost !== undefined ? { preferredUnitCost: fields.preferredUnitCost } : {}),
            ...(fields.notes !== undefined ? { notes: fields.notes } : {})
          };
      return { ...lineItem, ...allowedFields, updatedAt: now };
    }),
    updatedAt: now
  });
}

export function updateProjectContingencyPercent(
  state: ProjectWorkspaceState,
  projectId: string,
  contingencyPercent: number
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) return state;
  return updateProject(state, projectId, {
    ...project,
    contingencyPercent: normalizeProjectContingencyPercent(contingencyPercent),
    updatedAt: currentTimestamp()
  });
}

export function projectLineTotal(lineItem: ProjectLineItem): number {
  return (lineItem.quantity ?? 0) * (lineItem.preferredUnitCost ?? 0);
}

export function projectConstructionCost(project: UserProject): number {
  return project.lineItems
    .filter((lineItem) => lineItem.lineItemType === "explorer")
    .reduce((sum, lineItem) => sum + projectLineTotal(lineItem), 0);
}

export function projectOtherCost(project: UserProject): number {
  return project.lineItems
    .filter((lineItem) => lineItem.lineItemType === "custom")
    .reduce((sum, lineItem) => sum + projectLineTotal(lineItem), 0);
}

export function projectContingencyCost(project: UserProject): number {
  return (projectConstructionCost(project) + projectOtherCost(project)) * project.contingencyPercent / 100;
}

export function projectCostSummary(project: UserProject): ProjectCostSummary {
  const constructionCost = projectConstructionCost(project);
  const otherCost = projectOtherCost(project);
  const contingencyCost = (constructionCost + otherCost) * project.contingencyPercent / 100;
  return {
    constructionCost,
    otherCost,
    contingencyPercent: project.contingencyPercent,
    contingencyCost,
    totalProjectCost: constructionCost + otherCost + contingencyCost
  };
}

export function createDefaultProjectSort(): ProjectSort {
  return { ...DEFAULT_PROJECT_SORT };
}

export function projectGroupSuggestions(project: UserProject | null): string[] {
  const suggestions = new Map<string, string>();
  for (const lineItem of project?.lineItems ?? []) {
    const group = normalizeProjectGroup(lineItem.group);
    const key = group.toLocaleLowerCase();
    if (group && !suggestions.has(key)) suggestions.set(key, group);
  }
  return [...suggestions.values()].sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
}

export function sortProjectLineItems(lineItems: ProjectLineItem[], sort: ProjectSort): ProjectLineItem[] {
  return lineItems
    .map((lineItem, index) => ({ lineItem, index }))
    .sort((left, right) => {
      const leftBlank = projectSortValueIsBlank(left.lineItem, sort.key);
      const rightBlank = projectSortValueIsBlank(right.lineItem, sort.key);
      if (leftBlank || rightBlank) {
        if (leftBlank && rightBlank) return left.index - right.index;
        return leftBlank ? 1 : -1;
      }
      const comparison = compareProjectLineItems(left.lineItem, right.lineItem, sort.key);
      return comparison === 0 ? left.index - right.index : comparison * (sort.direction === "asc" ? 1 : -1);
    })
    .map(({ lineItem }) => lineItem);
}

function compareProjectLineItems(left: ProjectLineItem, right: ProjectLineItem, key: ProjectSortKey): number {
  if (key === "group" || key === "itemCode" || key === "description" || key === "unit" || key === "notes") {
    return compareProjectText(left[key], right[key]);
  }

  const leftValue = key === "totalItemCost" ? sortableProjectLineTotal(left) : left[key];
  const rightValue = key === "totalItemCost" ? sortableProjectLineTotal(right) : right[key];
  return compareProjectNumbers(leftValue, rightValue);
}

function compareProjectText(left: string, right: string): number {
  const leftValue = left.trim();
  const rightValue = right.trim();
  if (!leftValue && !rightValue) return 0;
  if (!leftValue) return 1;
  if (!rightValue) return -1;
  return leftValue.localeCompare(rightValue, undefined, { numeric: true, sensitivity: "base" });
}

function compareProjectNumbers(left: number | null, right: number | null): number {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  return left - right;
}

function projectSortValueIsBlank(lineItem: ProjectLineItem, key: ProjectSortKey): boolean {
  if (key === "group" || key === "itemCode" || key === "description" || key === "unit" || key === "notes") {
    return !lineItem[key].trim();
  }

  return (key === "totalItemCost" ? sortableProjectLineTotal(lineItem) : lineItem[key]) === null;
}

function sortableProjectLineTotal(lineItem: ProjectLineItem): number | null {
  return lineItem.quantity === null || lineItem.preferredUnitCost === null
    ? null
    : projectLineTotal(lineItem);
}

export function projectTotal(project: UserProject): number {
  return projectCostSummary(project).totalProjectCost;
}

export function removeProjectLineItem(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) return state;
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.filter((lineItem) => lineItem.lineItemId !== lineItemId),
    updatedAt: currentTimestamp()
  });
}

export function duplicateUserProject(project: UserProject): UserProject {
  const now = currentTimestamp();
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

export function replaceProject(state: ProjectWorkspaceState, project: UserProject): ProjectWorkspaceState {
  const exists = state.projects.some((candidate) => candidate.projectId === project.projectId);
  return {
    ...state,
    projects: exists
      ? state.projects.map((candidate) => candidate.projectId === project.projectId ? project : candidate)
      : [...state.projects, project]
  };
}

export function removeProjectFromState(state: ProjectWorkspaceState, projectId: string): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) return state;
  const nextState = { ...state, projects: state.projects.filter((candidate) => candidate.projectId !== projectId) };
  return state.activeProjectIdByState[project.state] === projectId
    ? setActiveProject(nextState, null, project.state)
    : nextState;
}

export function parseUserProjectV4(value: unknown): UserProject | null {
  return parseUserProject(value, 4);
}

export function parseUserProjectV5(value: unknown): UserProject | null {
  return parseUserProject(value, 5);
}

export function parseUserProjectV6(value: unknown): UserProject | null {
  return parseUserProject(value, 6);
}

export function parseUserProjectV7(value: unknown): UserProject | null {
  return parseUserProject(value, 7);
}

export function migrateLegacyWorkspace(value: unknown, schemaVersion: 1 | 2 | 3): LegacyMigrationResult {
  const empty = createEmptyProjectWorkspaceState();
  if (!isRecord(value) || value.schemaVersion !== schemaVersion || !Array.isArray(value.projects)) {
    return {
      state: empty,
      rejectedProjectCount: 0,
      removedPlaceholderProjectIds: [],
      removedPlaceholderProjectCount: 0,
      sourceProjectCount: 0,
      sourceLineItemCount: 0,
      migratedLineItemCount: 0,
      errors: ["Legacy workspace did not match its declared schema."]
    };
  }

  const projects: UserProject[] = [];
  const removedPlaceholderProjectIds: string[] = [];
  const errors: string[] = [];
  let rejectedProjectCount = 0;
  let sourceLineItemCount = 0;

  value.projects.forEach((rawProject, index) => {
    const rawLineCount = isRecord(rawProject) && Array.isArray(rawProject.lineItems) ? rawProject.lineItems.length : 0;
    sourceLineItemCount += rawLineCount;
    const project = parseUserProject(rawProject, schemaVersion);
    if (!project || project.lineItems.length !== rawLineCount) {
      errors.push(`Project ${index + 1} could not be migrated without dropping data.`);
      rejectedProjectCount += 1;
      return;
    }
    if (isLegacyPlaceholderProject(project)) {
      removedPlaceholderProjectIds.push(project.projectId);
      return;
    }
    projects.push(project);
  });

  const activeProjectId = typeof value.activeProjectId === "string" ? value.activeProjectId : null;
  const activeProjectIdByState: Record<string, string | null> = {};
  const activeProject = projects.find((project) => project.projectId === activeProjectId);
  if (activeProject) activeProjectIdByState[activeProject.state] = activeProject.projectId;

  for (const project of [...projects].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
    if (!(project.state in activeProjectIdByState)) activeProjectIdByState[project.state] = project.projectId;
  }

  return {
    state: { schemaVersion: 7, activeProjectIdByState, projects },
    rejectedProjectCount,
    removedPlaceholderProjectIds,
    removedPlaceholderProjectCount: removedPlaceholderProjectIds.length,
    sourceProjectCount: value.projects.length,
    sourceLineItemCount,
    migratedLineItemCount: projects.reduce((sum, project) => sum + project.lineItems.length, 0),
    errors
  };
}

function updateProject(state: ProjectWorkspaceState, projectId: string, nextProject: UserProject): ProjectWorkspaceState {
  return {
    ...state,
    projects: state.projects.map((project) => project.projectId === projectId ? nextProject : project)
  };
}

function parseUserProject(value: unknown, schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7): UserProject | null {
  if (!isRecord(value) || typeof value.projectId !== "string" || !value.projectId.trim()) return null;
  if (schemaVersion >= 4) {
    if (value.status !== "active" && value.status !== "archived") return null;
    if (!isNonNegativeInteger(value.revision)) return null;
    if (value.lastBackupAt !== null && typeof value.lastBackupAt !== "string") return null;
    if (value.lastBackupRevision !== null && !isNonNegativeInteger(value.lastBackupRevision)) return null;
  }
  const rawLineItems = Array.isArray(value.lineItems) ? value.lineItems : [];
  const lineItems = rawLineItems
    .map((lineItem) => parseProjectLineItem(lineItem, schemaVersion))
    .filter((lineItem): lineItem is ProjectLineItem => lineItem !== null);
  if (lineItems.length !== rawLineItems.length) return null;

  const state = schemaVersion >= 3 ? stringValue(value.state) : "CO";
  if (!state) return null;
  const revision = schemaVersion >= 4 ? positiveInteger(value.revision) : 0;
  const status = schemaVersion >= 4 && value.status === "archived" ? "archived" : "active";
  return {
    projectId: value.projectId,
    state,
    name: stringValue(value.name),
    location: stringValue(value.location),
    notes: stringValue(value.notes),
    status,
    archivedAt: status === "archived" ? nullableString(value.archivedAt) : null,
    revision,
    lastBackupAt: schemaVersion >= 4 ? nullableString(value.lastBackupAt) : null,
    lastBackupRevision: schemaVersion >= 4 ? nullableNonNegativeInteger(value.lastBackupRevision) : null,
    contingencyPercent: normalizeProjectContingencyPercent(value.contingencyPercent),
    createdAt: stringValue(value.createdAt) || currentTimestamp(),
    updatedAt: stringValue(value.updatedAt) || currentTimestamp(),
    lineItems
  };
}

function parseProjectLineItem(value: unknown, schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7): ProjectLineItem | null {
  if (!isRecord(value) || typeof value.lineItemId !== "string" || !value.lineItemId.trim()) return null;
  const lineItemType = value.lineItemType === "custom"
    ? "custom"
    : value.lineItemType === undefined || value.lineItemType === "explorer"
      ? "explorer"
      : null;
  if (!lineItemType) return null;
  const state = schemaVersion >= 3 ? stringValue(value.state) : "CO";
  const agencyId = schemaVersion >= 3 ? stringValue(value.agencyId) : "co_cdot";
  const agencyItemId = schemaVersion >= 3
    ? stringValue(value.agencyItemId)
    : legacyColoradoAgencyItemId(stringValue(value.itemCode));
  const itemCode = stringValue(value.itemCode);
  const description = stringValue(value.description);
  const unit = stringValue(value.unit);
  if (!state) return null;
  if (lineItemType === "explorer") {
    const quantity = positiveNumberValue(value.quantity);
    const preferredUnitCost = positiveNumberValue(value.preferredUnitCost);
    const evidenceContext = parseProjectEvidenceContext(value.evidenceContext);
    if (quantity === null || preferredUnitCost === null || !evidenceContext || !agencyId || !agencyItemId || !itemCode || !description || !unit) return null;
    return {
      lineItemId: value.lineItemId,
      lineItemType,
      state,
      agencyId,
      agencyItemId,
      group: normalizeProjectGroup(value.group),
      itemCode,
      description,
      unit,
      quantity,
      preferredUnitCost,
      notes: stringValue(value.notes),
      evidenceContext,
      createdAt: stringValue(value.createdAt) || currentTimestamp(),
      updatedAt: stringValue(value.updatedAt) || currentTimestamp()
    };
  }

  const quantity = nullableNumberValue(value.quantity);
  const preferredUnitCost = nullableNumberValue(value.preferredUnitCost);
  if (quantity === undefined || preferredUnitCost === undefined) return null;
  return {
    lineItemId: value.lineItemId,
    lineItemType,
    state,
    agencyId: "",
    agencyItemId: "",
    group: normalizeProjectGroup(value.group),
    itemCode,
    description,
    unit,
    quantity,
    preferredUnitCost,
    notes: stringValue(value.notes),
    evidenceContext: null,
    createdAt: stringValue(value.createdAt) || currentTimestamp(),
    updatedAt: stringValue(value.updatedAt) || currentTimestamp()
  };
}

function parseProjectEvidenceContext(value: unknown): ProjectEvidenceContext | null {
  if (!isRecord(value)) return null;
  const summarySnapshot = parseProjectEvidenceSummarySnapshot(value.summarySnapshot);
  if (!isRecord(value.query) || !isRecord(value.filters) || !isRecord(value.sort) || !summarySnapshot) return null;
  return {
    query: value.query as unknown as SearchQuery,
    filters: value.filters as unknown as EvidenceFilters,
    sort: value.sort as unknown as EvidenceSort,
    includedRowCount: numberValue(value.includedRowCount) ?? 0,
    includedObservationIds: Array.isArray(value.includedObservationIds)
      ? value.includedObservationIds.map(String).filter(Boolean)
      : [],
    summarySnapshot,
    costSource: value.costSource === "quick_fill" ? "quick_fill" : "manual"
  };
}

function parseProjectEvidenceSummarySnapshot(value: unknown): ProjectEvidenceSummarySnapshot | null {
  if (!isRecord(value)) return null;
  return {
    awarded: parseEvidenceStats(value.awarded),
    average: parseEvidenceStats(value.average),
    engineer: parseEvidenceStats(value.engineer),
    inflationAdjustmentEnabled: Boolean(value.inflationAdjustmentEnabled),
    inflationTargetPeriodLabel: nullableString(value.inflationTargetPeriodLabel),
    valuesAreInflationAdjusted: Boolean(value.valuesAreInflationAdjusted)
  };
}

function parseEvidenceStats(value: unknown): EvidenceStats | null {
  if (!isRecord(value)) return null;
  const keys = ["count", "low", "p25", "median", "average", "p75", "high"] as const;
  const parsed = Object.fromEntries(keys.map((key) => [key, numberValue(value[key])])) as Record<typeof keys[number], number | null>;
  if (keys.some((key) => parsed[key] === null)) return null;
  return parsed as EvidenceStats;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

function normalizeProjectGroup(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeProjectContingencyPercent(value: unknown): number {
  const parsed = numberValue(value);
  return parsed ?? 0;
}

function numberValue(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function positiveNumberValue(value: unknown): number | null {
  const parsed = numberValue(value);
  return parsed !== null && parsed > 0 ? parsed : null;
}

function normalizeProjectLineItemFields(fields: ProjectLineItemEditableFields): ProjectLineItemEditableFields {
  return fields.group === undefined ? fields : { ...fields, group: normalizeProjectGroup(fields.group) };
}

function nullableNumberValue(value: unknown): number | null | undefined {
  if (value === null || value === undefined || (typeof value === "string" && !value.trim())) return null;
  return numberValue(value) ?? undefined;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function positiveInteger(value: unknown): number {
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : 0;
}

function nullableNonNegativeInteger(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = numberValue(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function currentTimestamp(): string {
  return new Date().toISOString();
}

export function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  return uuid
    ? `${prefix}_${uuid}`
    : `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function legacyColoradoAgencyItemId(itemCode: string): string {
  return itemCode ? `co_cdot_${itemCode.toLowerCase()}` : "";
}
