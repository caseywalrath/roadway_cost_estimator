import type {
  AgencyItemRecord,
  EvidenceFilters,
  EvidenceSort,
  EvidenceStats,
  SearchQuery
} from "../data/schema";

export const PROJECT_WORKSPACE_SCHEMA_VERSION = 12;
export const LEGACY_PROJECT_WORKSPACE_KEYS = [
  "roadway-cost-estimator:projects:v3",
  "roadway-cost-estimator:projects:v2",
  "roadway-cost-estimator:projects:v1"
] as const;

export type ProjectStatus = "active" | "archived";

export interface ProjectWorkspaceState {
  schemaVersion: 12;
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
  /** Excel source history used to compare later imports into this Project. */
  excelImportSources?: ProjectExcelImportSource[];
  /** Set when the Project was created from a Planning estimate. Absent on all other Projects. */
  planningOrigin?: ProjectPlanningOrigin;
}

export interface ProjectPlanningOrigin {
  planningProjectId: string;
  planningProjectName: string;
  alternativeId: string;
  alternativeName: string;
  createdAt: string;
  /** Planning total (full precision) at the time the Project was created. */
  planningTotal: number;
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
  /** Legacy Explorer is accepted only while older stored Projects are normalized. */
  lineItemType: ProjectLineItemType | "explorer";
  costCategory: ProjectCostCategory;
  pricingMode?: "fixed" | "percentage";
  percentageRate?: number;
  percentageBase?: ProjectPercentageBase;
  costRole?: "standard" | "contingency";
  importSource?: ProjectLineImportSource;
  state: string;
  agencyId: string;
  agencyItemId: string;
  group: string;
  itemCode: string;
  description: string;
  descriptionOverrideEnabled: boolean;
  unit: string;
  quantity: number | null;
  preferredUnitCost: number | null;
  notes: string;
  evidenceContext: ProjectEvidenceContext | null;
  createdAt: string;
  updatedAt: string;
}

export type ProjectLineItemType = "catalog" | "custom";
export type ProjectCostCategory = "construction" | "other" | "contingency";
export type ProjectPercentageBase =
  | { kind: "all_fixed" | "construction_fixed" | "other_fixed" }
  | { kind: "group"; group: string }
  | { kind: "selected_lines"; lineItemIds: string[] };

export interface ProjectCalculation {
  amountByLineId: Record<string, number>;
  baseByLineId: Record<string, number>;
  warningsByLineId: Record<string, string>;
  summary: ProjectCostSummary;
}

export interface ProjectLineImportSource {
  importId: string;
  fileName: string;
  sheetName: string;
  rowNumber: number;
  sourceRange: string;
  importedAt: string;
  original: {
    itemCode: string;
    description: string;
    unit: string;
    quantity: number | null;
    unitCost: number | null;
    total: number | null;
  };
  decisions: string[];
}

export interface ProjectExcelImportSource {
  sourceId: string;
  fileName: string;
  /** SHA-256 digest of the exact workbook bytes, when SubtleCrypto is available. */
  digest: string | null;
  /** Stable worksheet and mapped-header signature used to suggest similar sources. */
  mappingSignature: string;
  sheetName: string;
  lastReviewedAt: string;
  rows: ProjectExcelImportSourceRow[];
}

export interface ProjectExcelImportSourceRow {
  identityKey: string;
  sheetName: string;
  rowNumber: number;
  sourceRange: string;
  values: {
    itemCode: string;
    description: string;
    unit: string;
    quantity: number | null;
    unitCost: number | null;
    total: number | null;
    group: string;
    costCategory: ProjectCostCategory;
    notes: string;
  };
  /** Project values at the time this source row was last reviewed. */
  projectValues: {
    itemCode: string;
    description: string;
    unit: string;
    quantity: number | null;
    unitCost: number | null;
    group: string;
    costCategory: ProjectCostCategory;
  } | null;
  /** Project lines previously linked to this source row. Missing IDs are retained as history. */
  lineItemIds: string[];
}

export type ProjectSortKey =
  | "group"
  | "costCategory"
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
  quantity: number | null;
  preferredUnitCost: number | null;
  notes: string;
  evidenceContext: ProjectEvidenceContext | null;
  costCategory?: ProjectCostCategory;
  importSource?: ProjectLineImportSource;
}

export interface ProjectLineItemEditableFields {
  costCategory?: ProjectCostCategory;
  group?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  quantity?: number | null;
  preferredUnitCost?: number | null;
  notes?: string;
  percentageRate?: number;
  percentageBase?: ProjectPercentageBase;
  costRole?: "standard" | "contingency";
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

export function createCatalogProjectLineItem(input: CreateProjectLineItemInput): ProjectLineItem {
  const now = currentTimestamp();
  return {
    lineItemId: createId("line"),
    lineItemType: "catalog",
    ...input,
    costCategory: normalizeProjectCostCategory(input.costCategory, "construction"),
    group: normalizeProjectGroup(input.group),
    descriptionOverrideEnabled: false,
    createdAt: now,
    updatedAt: now
  };
}

export function createCustomProjectLineItem(
  state: string,
  costCategory: ProjectCostCategory = "other",
  importSource?: ProjectLineImportSource
): ProjectLineItem {
  const now = currentTimestamp();
  return {
    lineItemId: createId("line"),
    lineItemType: "custom",
    costCategory: normalizeProjectCostCategory(costCategory, "other"),
    state,
    agencyId: "",
    agencyItemId: "",
    group: "",
    itemCode: "",
    description: "",
    descriptionOverrideEnabled: true,
    unit: "",
    quantity: null,
    preferredUnitCost: null,
    notes: "",
    evidenceContext: null,
    ...(importSource ? { importSource } : {}),
    createdAt: now,
    updatedAt: now
  };
}

export function createPercentageProjectLineItem(
  state: string,
  costCategory: ProjectCostCategory,
  description: string,
  rate: number,
  base: ProjectPercentageBase,
  role: "standard" | "contingency" = "standard"
): ProjectLineItem {
  if (!Number.isFinite(rate) || rate < 0) throw new Error("Enter a nonnegative percentage rate.");
  if (!parsePercentageBase(base)) throw new Error("Choose a valid fixed-cost percentage base.");
  const line = createCustomProjectLineItem(state, costCategory);
  return {
    ...line,
    description,
    costCategory: role === "contingency" ? "contingency" : costCategory,
    pricingMode: "percentage",
    percentageRate: rate,
    percentageBase: base,
    costRole: role,
    unit: "%"
  };
}

export function findExactProjectCatalogItem(
  agencyItems: AgencyItemRecord[],
  state: string,
  agencyId: string,
  itemCode: string
): AgencyItemRecord | null {
  const normalizedState = state.trim().toUpperCase();
  const normalizedCode = itemCode.trim().toUpperCase();
  if (!normalizedCode) return null;
  return agencyItems.find((item) =>
    item.state.trim().toUpperCase() === normalizedState
    && item.agencyId === agencyId
    && item.itemCode.trim().toUpperCase() === normalizedCode
  ) ?? null;
}

export function findDuplicateCatalogLineItemIds(project: UserProject, agencyItemId: string): string[] {
  if (!agencyItemId) return [];
  return project.lineItems
    .filter((lineItem) => lineItem.lineItemType === "catalog" && lineItem.agencyItemId === agencyItemId)
    .map((lineItem) => lineItem.lineItemId);
}

export function linkProjectLineItemToCatalog(
  lineItem: ProjectLineItem,
  agencyItem: AgencyItemRecord
): ProjectLineItem {
  return {
    ...lineItem,
    lineItemType: "catalog",
    state: agencyItem.state,
    agencyId: agencyItem.agencyId,
    agencyItemId: agencyItem.agencyItemId,
    itemCode: agencyItem.itemCode,
    description: agencyItem.officialDescription,
    descriptionOverrideEnabled: false,
    unit: agencyItem.officialUnit,
    evidenceContext: null,
    updatedAt: currentTimestamp()
  };
}

/** @deprecated Use createCatalogProjectLineItem. */
export function createProjectLineItem(input: CreateProjectLineItemInput): ProjectLineItem {
  return createCatalogProjectLineItem(input);
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
  const target = project.lineItems.find((line) => line.lineItemId === lineItemId);
  const nextCategory = fields.costCategory ?? (fields.costRole === "contingency" ? "contingency"
    : fields.costRole === "standard" && target?.costCategory === "contingency" ? "construction" : undefined);
  if (nextCategory !== undefined) fields = { ...fields, costCategory: nextCategory, costRole: nextCategory === "contingency" ? "contingency" : "standard" };
  if (target?.pricingMode === "percentage") {
    if (fields.percentageRate !== undefined && (!Number.isFinite(fields.percentageRate) || fields.percentageRate < 0)) return state;
    if (fields.percentageBase && (!parsePercentageBase(fields.percentageBase) || !validatePercentageBases(project.lineItems.map((line) => line.lineItemId === lineItemId ? { ...line, percentageBase: fields.percentageBase } : line)))) return state;
  }
  const now = currentTimestamp();
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((lineItem) => {
      if (lineItem.lineItemId !== lineItemId) return lineItem;
      const allowedFields = lineItem.lineItemType === "custom"
        ? normalizeProjectLineItemFields(fields)
        : {
            ...(fields.costCategory !== undefined ? { costCategory: normalizeProjectCostCategory(fields.costCategory, lineItem.costCategory) } : {}),
            ...(fields.group !== undefined ? { group: normalizeProjectGroup(fields.group) } : {}),
            ...(lineItem.descriptionOverrideEnabled && fields.description !== undefined ? { description: String(fields.description) } : {}),
            ...(fields.quantity !== undefined ? { quantity: fields.quantity } : {}),
            ...(fields.preferredUnitCost !== undefined ? { preferredUnitCost: fields.preferredUnitCost } : {}),
            ...(fields.notes !== undefined ? { notes: fields.notes } : {})
          };
      if (lineItem.pricingMode === "percentage") {
        return {
          ...lineItem,
          ...allowedFields,
          ...(fields.percentageRate !== undefined ? { percentageRate: fields.percentageRate } : {}),
          ...(fields.percentageBase !== undefined ? { percentageBase: fields.percentageBase } : {}),
          ...(fields.costRole !== undefined ? { costRole: fields.costRole } : {}),
          quantity: null,
          preferredUnitCost: null,
          unit: "%",
          updatedAt: now
        };
      }
      return { ...lineItem, ...allowedFields, ...(fields.costRole !== undefined ? { costRole: fields.costRole } : {}), updatedAt: now };
    }),
    updatedAt: now
  });
}

export function setProjectLinePricingMode(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string,
  mode: "fixed" | "percentage"
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  const line = project?.lineItems.find((candidate) => candidate.lineItemId === lineItemId);
  if (!project || !line || line.lineItemType !== "custom") return state;
  if ((line.pricingMode ?? "fixed") === mode) return state;
  if (mode === "percentage" && project.lineItems.some((item) =>
    item.pricingMode === "percentage" && item.percentageBase?.kind === "selected_lines" && item.percentageBase.lineItemIds.includes(lineItemId)
  )) return state;
  const now = currentTimestamp();
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((item) => item.lineItemId !== lineItemId ? item : mode === "percentage"
      ? {
          ...item,
          pricingMode: "percentage" as const,
          percentageRate: 0,
          percentageBase: { kind: "construction_fixed" as const },
          preferredUnitCost: null,
          quantity: null,
          unit: "%",
          updatedAt: now
        }
      : {
          ...item,
          pricingMode: "fixed" as const,
          percentageRate: undefined,
          percentageBase: undefined,
          preferredUnitCost: null,
          quantity: null,
          unit: "",
          updatedAt: now
        }),
    updatedAt: now
  });
}

export function enableProjectLineDescriptionOverride(
  state: ProjectWorkspaceState,
  projectId: string,
  lineItemId: string
): ProjectWorkspaceState {
  const project = state.projects.find((candidate) => candidate.projectId === projectId);
  if (!project) return state;
  const now = currentTimestamp();
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems.map((lineItem) => lineItem.lineItemId === lineItemId && lineItem.lineItemType === "catalog"
      ? { ...lineItem, descriptionOverrideEnabled: true, updatedAt: now }
      : lineItem),
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
  if (lineItem.pricingMode === "percentage") return 0;
  return (lineItem.quantity ?? 0) * (lineItem.preferredUnitCost ?? 0);
}

export function calculateProject(project: UserProject): ProjectCalculation {
  const fixed = project.lineItems.filter((line) => line.pricingMode !== "percentage");
  const amountByLineId: Record<string, number> = Object.create(null);
  const baseByLineId: Record<string, number> = Object.create(null);
  const warningsByLineId: Record<string, string> = Object.create(null);
  for (const line of fixed) amountByLineId[line.lineItemId] = projectLineTotal(line);
  const fixedSum = (lines: ProjectLineItem[]) => lines.reduce((sum, line) => sum + (amountByLineId[line.lineItemId] ?? 0), 0);
  for (const line of project.lineItems.filter((item) => item.pricingMode === "percentage")) {
    const base = line.percentageBase;
    let eligible: ProjectLineItem[] = [];
    if (base?.kind === "all_fixed") eligible = fixed;
    else if (base?.kind === "construction_fixed") eligible = fixed.filter((item) => item.costCategory === "construction" && item.costRole !== "contingency");
    else if (base?.kind === "other_fixed") eligible = fixed.filter((item) => item.costCategory === "other" && item.costRole !== "contingency");
    else if (base?.kind === "group") eligible = fixed.filter((item) => item.group.trim().toLocaleLowerCase() === base.group.trim().toLocaleLowerCase());
    else if (base?.kind === "selected_lines") {
      const selected = new Set(base.lineItemIds);
      eligible = fixed.filter((item) => selected.has(item.lineItemId));
      if (eligible.length !== selected.size) warningsByLineId[line.lineItemId] = "A selected fixed item is missing.";
    }
    const baseAmount = fixedSum(eligible);
    baseByLineId[line.lineItemId] = baseAmount;
    amountByLineId[line.lineItemId] = baseAmount * (line.percentageRate ?? 0) / 100;
  }
  let constructionCost = 0;
  let otherCost = 0;
  let contingencyCost = 0;
  for (const line of project.lineItems) {
    const amount = amountByLineId[line.lineItemId] ?? 0;
    if (line.costCategory === "contingency" || line.costRole === "contingency") contingencyCost += amount;
    else if (line.costCategory === "construction") constructionCost += amount;
    else otherCost += amount;
  }
  return {
    amountByLineId,
    baseByLineId,
    warningsByLineId,
    summary: {
      constructionCost,
      otherCost,
      contingencyPercent: 0,
      contingencyCost,
      totalProjectCost: constructionCost + otherCost + contingencyCost
    }
  };
}

export function projectConstructionCost(project: UserProject): number {
  return calculateProject(project).summary.constructionCost;
}

export function projectOtherCost(project: UserProject): number {
  return calculateProject(project).summary.otherCost;
}

export function projectContingencyCost(project: UserProject): number {
  return calculateProject(project).summary.contingencyCost;
}

export function projectCostSummary(project: UserProject): ProjectCostSummary {
  return calculateProject(project).summary;
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

export function sortProjectLineItems(lineItems: ProjectLineItem[], sort: ProjectSort, project?: UserProject): ProjectLineItem[] {
  const amounts = project ? calculateProject(project).amountByLineId : {};
  return lineItems
    .map((lineItem, index) => ({ lineItem, index }))
    .sort((left, right) => {
      const leftBlank = projectSortValueIsBlank(left.lineItem, sort.key);
      const rightBlank = projectSortValueIsBlank(right.lineItem, sort.key);
      if (leftBlank || rightBlank) {
        if (leftBlank && rightBlank) return left.index - right.index;
        return leftBlank ? 1 : -1;
      }
      const comparison = sort.key === "totalItemCost" && project
        ? (amounts[left.lineItem.lineItemId] ?? 0) - (amounts[right.lineItem.lineItemId] ?? 0)
        : compareProjectLineItems(left.lineItem, right.lineItem, sort.key);
      return comparison === 0 ? left.index - right.index : comparison * (sort.direction === "asc" ? 1 : -1);
    })
    .map(({ lineItem }) => lineItem);
}

function compareProjectLineItems(left: ProjectLineItem, right: ProjectLineItem, key: ProjectSortKey): number {
  if (key === "group" || key === "costCategory" || key === "itemCode" || key === "description" || key === "unit" || key === "notes") {
    return compareProjectText(left[key], right[key]);
  }

  const leftValue = key === "totalItemCost" ? sortableProjectLineTotal(left) : key === "quantity" && left.pricingMode === "percentage" ? left.percentageRate ?? null : left[key];
  const rightValue = key === "totalItemCost" ? sortableProjectLineTotal(right) : key === "quantity" && right.pricingMode === "percentage" ? right.percentageRate ?? null : right[key];
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
  if (key === "group" || key === "costCategory" || key === "itemCode" || key === "description" || key === "unit" || key === "notes") {
    return !lineItem[key].trim();
  }

  return (key === "totalItemCost" ? sortableProjectLineTotal(lineItem) : key === "quantity" && lineItem.pricingMode === "percentage" ? lineItem.percentageRate ?? null : lineItem[key]) === null;
}

function sortableProjectLineTotal(lineItem: ProjectLineItem): number | null {
  if (lineItem.pricingMode === "percentage") return 0;
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
  if (!project.lineItems.some((lineItem) => lineItem.lineItemId === lineItemId)) return state;
  const now = currentTimestamp();
  return updateProject(state, projectId, {
    ...project,
    lineItems: project.lineItems
      .filter((lineItem) => lineItem.lineItemId !== lineItemId)
      .map((lineItem) => {
        const base = lineItem.percentageBase;
        if (lineItem.pricingMode !== "percentage" || base?.kind !== "selected_lines" || !base.lineItemIds.includes(lineItemId)) return lineItem;
        return {
          ...lineItem,
          percentageBase: { kind: "selected_lines" as const, lineItemIds: base.lineItemIds.filter((id) => id !== lineItemId) },
          updatedAt: now
        };
      }),
    updatedAt: now
  });
}

export function duplicateUserProject(project: UserProject): UserProject {
  const now = currentTimestamp();
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

export function parseUserProjectV8(value: unknown): UserProject | null {
  return parseUserProject(value, 8);
}

export function parseUserProjectV9(value: unknown): UserProject | null {
  return parseUserProject(value, 9);
}

export function parseUserProjectV10(value: unknown): UserProject | null {
  return parseUserProject(value, 10);
}

export function parseUserProjectV11(value: unknown): UserProject | null {
  return parseUserProject(value, 11);
}

export function parseUserProjectV12(value: unknown): UserProject | null {
  return parseUserProject(value, 12);
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
    state: { schemaVersion: PROJECT_WORKSPACE_SCHEMA_VERSION, activeProjectIdByState, projects },
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

function parseUserProject(value: unknown, schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12): UserProject | null {
  if (!isRecord(value) || typeof value.projectId !== "string" || !value.projectId.trim()) return null;
  if (schemaVersion >= 4) {
    if (value.status !== "active" && value.status !== "archived") return null;
    if (!isNonNegativeInteger(value.revision)) return null;
    if (value.lastBackupAt !== null && typeof value.lastBackupAt !== "string") return null;
    if (value.lastBackupRevision !== null && !isNonNegativeInteger(value.lastBackupRevision)) return null;
  }
  const rawLineItems = Array.isArray(value.lineItems) ? value.lineItems : [];
  let lineItems = rawLineItems
    .map((lineItem) => parseProjectLineItem(lineItem, schemaVersion))
    .filter((lineItem): lineItem is ProjectLineItem => lineItem !== null);
  if (lineItems.length !== rawLineItems.length) return null;
  const legacyCategoryContingencies = new Set(rawLineItems.flatMap((rawLine) =>
    isRecord(rawLine) && rawLine.costRole === "contingency" && rawLine.pricingMode !== "percentage"
      && (rawLine.costCategory === "construction" || rawLine.costCategory === "other")
      ? [rawLine.costCategory] : []
  ));
  if (legacyCategoryContingencies.size) {
    lineItems = lineItems.map((line) => {
      if (line.pricingMode !== "percentage") return line;
      const category = line.percentageBase?.kind === "construction_fixed" ? "construction"
        : line.percentageBase?.kind === "other_fixed" ? "other" : null;
      if (!category || !legacyCategoryContingencies.has(category)) return line;
      const lineItemIds = lineItems.flatMap((candidate, index) => {
        const raw = rawLineItems[index];
        return candidate.pricingMode !== "percentage" && isRecord(raw) && raw.costCategory === category
          ? [candidate.lineItemId] : [];
      });
      return { ...line, percentageBase: { kind: "selected_lines" as const, lineItemIds } };
    });
  }

  const state = schemaVersion >= 3 ? stringValue(value.state) : "CO";
  if (!state) return null;
  const revision = schemaVersion >= 4 ? positiveInteger(value.revision) : 0;
  const status = schemaVersion >= 4 && value.status === "archived" ? "archived" : "active";
  const planningOrigin = schemaVersion >= 10 ? parseProjectPlanningOrigin(value.planningOrigin) : null;
  const excelImportSources = schemaVersion >= 12
    ? parseProjectExcelImportSources(value.excelImportSources)
    : null;
  if (schemaVersion >= 12 && value.excelImportSources !== undefined && !excelImportSources) return null;
  const legacyContingency = normalizeProjectContingencyPercent(value.contingencyPercent);
  if (legacyContingency > 0) {
    const migrationLine = createPercentageProjectLineItem(state, "construction", "Project contingency", legacyContingency, { kind: "all_fixed" }, "contingency");
    const legacyId = `legacy_contingency_${value.projectId}`;
    migrationLine.lineItemId = legacyId;
    for (let suffix = 1; lineItems.some((line) => line.lineItemId === migrationLine.lineItemId); suffix++) migrationLine.lineItemId = `${legacyId}_${suffix}`;
    migrationLine.createdAt = stringValue(value.createdAt) || currentTimestamp();
    migrationLine.updatedAt = stringValue(value.updatedAt) || currentTimestamp();
    lineItems.push(migrationLine);
  }
  if (!validatePercentageBases(lineItems)) return null;
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
    contingencyPercent: 0,
    createdAt: stringValue(value.createdAt) || currentTimestamp(),
    updatedAt: stringValue(value.updatedAt) || currentTimestamp(),
    lineItems,
    ...(excelImportSources ? { excelImportSources } : {}),
    ...(planningOrigin ? { planningOrigin } : {})
  };
}

function parseProjectExcelImportSources(value: unknown): ProjectExcelImportSource[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const sources = value.map(parseProjectExcelImportSource);
  return sources.every((source): source is ProjectExcelImportSource => source !== null) ? sources : null;
}

function parseProjectExcelImportSource(value: unknown): ProjectExcelImportSource | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.sourceId)
    || !isNonEmptyBasename(value.fileName)
    || (value.digest !== null && (typeof value.digest !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(value.digest)))
    || !isNonEmptyString(value.mappingSignature)
    || !isNonEmptyString(value.sheetName)
    || !isNonEmptyString(value.lastReviewedAt)
    || !Array.isArray(value.rows)) return null;
  const rows = value.rows.map(parseProjectExcelImportSourceRow);
  if (rows.some((row) => row === null)) return null;
  return {
    sourceId: value.sourceId,
    fileName: value.fileName,
    digest: value.digest,
    mappingSignature: value.mappingSignature,
    sheetName: value.sheetName,
    lastReviewedAt: value.lastReviewedAt,
    rows: rows as ProjectExcelImportSourceRow[]
  };
}

function parseProjectExcelImportSourceRow(value: unknown): ProjectExcelImportSourceRow | null {
  if (!isRecord(value) || !isNonEmptyString(value.identityKey)
    || !isNonEmptyString(value.sheetName) || !isNonNegativeInteger(value.rowNumber) || value.rowNumber < 1
    || !isNonEmptyString(value.sourceRange)
    || !isRecord(value.values)
    || !isNonEmptyString(value.values.itemCode, true)
    || !isNonEmptyString(value.values.description, true)
    || !isNonEmptyString(value.values.unit, true)
    || !isNullableStoredNumber(value.values.quantity)
    || !isNullableStoredNumber(value.values.unitCost)
    || !isNullableStoredNumber(value.values.total)
    || !isNonEmptyString(value.values.group, true)
    || (value.values.costCategory !== "construction" && value.values.costCategory !== "other" && value.values.costCategory !== "contingency")
    || !isNonEmptyString(value.values.notes, true)
    || value.projectValues === undefined
    || (value.projectValues !== null && !parseProjectExcelImportProjectValues(value.projectValues))
    || !Array.isArray(value.lineItemIds)
    || value.lineItemIds.some((id) => !isNonEmptyString(id))) return null;
  return {
    identityKey: value.identityKey,
    sheetName: value.sheetName,
    rowNumber: value.rowNumber,
    sourceRange: value.sourceRange,
    values: {
      itemCode: value.values.itemCode,
      description: value.values.description,
      unit: value.values.unit,
      quantity: value.values.quantity,
      unitCost: value.values.unitCost,
      total: value.values.total,
      group: value.values.group,
      costCategory: value.values.costCategory,
      notes: value.values.notes
    },
    projectValues: value.projectValues === null ? null : parseProjectExcelImportProjectValues(value.projectValues),
    lineItemIds: [...new Set(value.lineItemIds)]
  };
}

function parseProjectExcelImportProjectValues(value: unknown): ProjectExcelImportSourceRow["projectValues"] | null {
  if (value === null) return null;
  if (!isRecord(value)
    || !isNonEmptyString(value.itemCode, true)
    || !isNonEmptyString(value.description, true)
    || !isNonEmptyString(value.unit, true)
    || !isNullableStoredNumber(value.quantity)
    || !isNullableStoredNumber(value.unitCost)
    || !isNonEmptyString(value.group, true)
    || (value.costCategory !== "construction" && value.costCategory !== "other" && value.costCategory !== "contingency")) return null;
  return {
    itemCode: value.itemCode,
    description: value.description,
    unit: value.unit,
    quantity: value.quantity,
    unitCost: value.unitCost,
    group: value.group,
    costCategory: value.costCategory
  };
}

function parseProjectPlanningOrigin(value: unknown): ProjectPlanningOrigin | null {
  if (!isRecord(value)) return null;
  const { planningProjectId, planningProjectName, alternativeId, alternativeName, createdAt, planningTotal } = value;
  if (typeof planningProjectId !== "string" || typeof planningProjectName !== "string"
    || typeof alternativeId !== "string" || typeof alternativeName !== "string"
    || typeof createdAt !== "string" || typeof planningTotal !== "number" || !Number.isFinite(planningTotal)) return null;
  return { planningProjectId, planningProjectName, alternativeId, alternativeName, createdAt, planningTotal };
}

function parseProjectLineItem(value: unknown, schemaVersion: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12): ProjectLineItem | null {
  if (!isRecord(value) || typeof value.lineItemId !== "string" || !value.lineItemId.trim()) return null;
  const legacyExplorer = value.lineItemType === undefined || value.lineItemType === "explorer";
  const lineItemType = value.lineItemType === "custom"
    ? "custom"
    : schemaVersion >= 8 && value.lineItemType === "catalog"
      ? "catalog"
      : legacyExplorer
        ? "catalog"
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
  if (schemaVersion >= 10
    && value.costCategory !== undefined
    && value.costCategory !== "construction"
    && value.costCategory !== "other"
    && value.costCategory !== "contingency") return null;
  const storedCostCategory = normalizeProjectCostCategory(
    value.costCategory,
    lineItemType === "catalog" ? "construction" : "other"
  );
  const importSource = value.importSource === undefined || value.importSource === null
    ? undefined
    : parseProjectLineImportSource(value.importSource);
  if (value.importSource !== undefined && value.importSource !== null && !importSource) return null;
  if (!state) return null;
  const quantity = nullableNumberValue(value.quantity);
  const preferredUnitCost = nullableNumberValue(value.preferredUnitCost);
  if (quantity === undefined || preferredUnitCost === undefined) return null;
  const pricingMode = schemaVersion >= 11 && value.pricingMode === "percentage" ? "percentage" : "fixed";
  if (schemaVersion >= 11 && value.pricingMode !== undefined && value.pricingMode !== "fixed" && value.pricingMode !== "percentage") return null;
  if (pricingMode === "percentage" && lineItemType !== "custom") return null;
  const percentageRate = pricingMode === "percentage" ? value.percentageRate : undefined;
  const percentageBase = pricingMode === "percentage" ? parsePercentageBase(value.percentageBase) : undefined;
  if (pricingMode === "percentage" && (typeof percentageRate !== "number" || !Number.isFinite(percentageRate) || percentageRate < 0 || !percentageBase)) return null;
  const costRole = schemaVersion >= 11 && value.costRole === "contingency" ? "contingency" : "standard";
  if (schemaVersion >= 11 && value.costRole !== undefined && value.costRole !== "contingency" && value.costRole !== "standard") return null;
  const costCategory = costRole === "contingency" ? "contingency" : storedCostCategory;
  const normalizedCostRole = costCategory === "contingency" ? "contingency" : costRole;
  if (lineItemType === "catalog") {
    const evidenceContext = value.evidenceContext === null || value.evidenceContext === undefined
      ? null
      : parseProjectEvidenceContext(value.evidenceContext);
    if (legacyExplorer && (quantity === null || preferredUnitCost === null || !evidenceContext)) return null;
    if (value.evidenceContext !== null && value.evidenceContext !== undefined && !evidenceContext) return null;
    if (!agencyId || !agencyItemId || !itemCode || !description || !unit) return null;
    return {
      lineItemId: value.lineItemId,
      lineItemType,
      costCategory,
      ...(value.pricingMode !== undefined ? { pricingMode } : {}),
      ...(value.costRole !== undefined ? { costRole: normalizedCostRole } : {}),
      ...(importSource ? { importSource } : {}),
      state,
      agencyId,
      agencyItemId,
      group: normalizeProjectGroup(value.group),
      itemCode,
      description,
      descriptionOverrideEnabled: value.descriptionOverrideEnabled === true,
      unit,
      quantity,
      preferredUnitCost,
      notes: stringValue(value.notes),
      evidenceContext,
      createdAt: stringValue(value.createdAt) || currentTimestamp(),
      updatedAt: stringValue(value.updatedAt) || currentTimestamp()
    };
  }
  return {
    lineItemId: value.lineItemId,
    lineItemType,
    costCategory,
    ...(value.pricingMode !== undefined ? { pricingMode } : {}),
    ...(value.costRole !== undefined ? { costRole: normalizedCostRole } : {}),
    ...(pricingMode === "percentage" ? { percentageRate: percentageRate as number, percentageBase: percentageBase as ProjectPercentageBase } : {}),
    ...(importSource ? { importSource } : {}),
    state,
    agencyId: "",
    agencyItemId: "",
    group: normalizeProjectGroup(value.group),
    itemCode,
    description,
    descriptionOverrideEnabled: true,
    unit,
    quantity,
    preferredUnitCost,
    notes: stringValue(value.notes),
    evidenceContext: null,
    createdAt: stringValue(value.createdAt) || currentTimestamp(),
    updatedAt: stringValue(value.updatedAt) || currentTimestamp()
  };
}

function parsePercentageBase(value: unknown): ProjectPercentageBase | null {
  if (!isRecord(value)) return null;
  if (value.kind === "all_fixed" || value.kind === "construction_fixed" || value.kind === "other_fixed") return { kind: value.kind };
  if (value.kind === "group" && typeof value.group === "string" && value.group.trim()) return { kind: "group", group: normalizeProjectGroup(value.group) };
  if (value.kind === "selected_lines" && Array.isArray(value.lineItemIds)
    && value.lineItemIds.every((id) => typeof id === "string" && id.trim())
    && new Set(value.lineItemIds).size === value.lineItemIds.length) {
    return { kind: "selected_lines", lineItemIds: [...value.lineItemIds] };
  }
  return null;
}

function validatePercentageBases(lines: ProjectLineItem[]): boolean {
  const fixedIds = new Set(lines.filter((line) => line.pricingMode !== "percentage").map((line) => line.lineItemId));
  return lines.every((line) => line.pricingMode !== "percentage" || line.percentageBase?.kind !== "selected_lines"
    || line.percentageBase.lineItemIds.every((id) => fixedIds.has(id)));
}

function parseProjectLineImportSource(value: unknown): ProjectLineImportSource | null {
  if (!isRecord(value)
    || !isNonEmptyString(value.importId)
    || !isNonEmptyBasename(value.fileName)
    || !isNonEmptyString(value.sheetName)
    || !isNonEmptyString(value.sourceRange)
    || !isNonEmptyString(value.importedAt)
    || !isNonNegativeInteger(value.rowNumber)
    || value.rowNumber < 1
    || !isRecord(value.original)
    || !isNonEmptyString(value.original.itemCode, true)
    || !isNonEmptyString(value.original.description, true)
    || !isNonEmptyString(value.original.unit, true)
    || !isNullableStoredNumber(value.original.quantity)
    || !isNullableStoredNumber(value.original.unitCost)
    || !isNullableStoredNumber(value.original.total)
    || !Array.isArray(value.decisions)
    || value.decisions.some((decision) => typeof decision !== "string")) {
    return null;
  }

  return {
    importId: value.importId,
    fileName: value.fileName,
    sheetName: value.sheetName,
    rowNumber: value.rowNumber,
    sourceRange: value.sourceRange,
    importedAt: value.importedAt,
    original: {
      itemCode: value.original.itemCode,
      description: value.original.description,
      unit: value.original.unit,
      quantity: value.original.quantity,
      unitCost: value.original.unitCost,
      total: value.original.total
    },
    decisions: [...value.decisions]
  };
}

function isNonEmptyString(value: unknown, allowBlank = false): value is string {
  return typeof value === "string" && (allowBlank || value.trim().length > 0);
}

function isNonEmptyBasename(value: unknown): value is string {
  return isNonEmptyString(value) && !/[\\/]/.test(value);
}

function isNullableStoredNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function parseProjectEvidenceContext(value: unknown): ProjectEvidenceContext | null {
  if (!isRecord(value)) return null;
  const summarySnapshot = parseProjectEvidenceSummarySnapshot(value.summarySnapshot);
  const includedRowCount = value.includedRowCount;
  const includedObservationIds = value.includedObservationIds;
  if (!isRecord(value.query)
    || !isRecord(value.filters)
    || !isRecord(value.sort)
    || !summarySnapshot
    || !isNonNegativeInteger(includedRowCount)
    || !Array.isArray(includedObservationIds)
    || includedObservationIds.some((observationId) => typeof observationId !== "string")
    || (value.costSource !== "manual" && value.costSource !== "quick_fill")) return null;
  return {
    query: value.query as unknown as SearchQuery,
    filters: value.filters as unknown as EvidenceFilters,
    sort: value.sort as unknown as EvidenceSort,
    includedRowCount,
    includedObservationIds: [...includedObservationIds],
    summarySnapshot,
    costSource: value.costSource
  };
}

function parseProjectEvidenceSummarySnapshot(value: unknown): ProjectEvidenceSummarySnapshot | null {
  if (!isRecord(value)) return null;
  if (typeof value.inflationAdjustmentEnabled !== "boolean"
    || typeof value.valuesAreInflationAdjusted !== "boolean"
    || (value.inflationTargetPeriodLabel !== null && typeof value.inflationTargetPeriodLabel !== "string")) return null;
  const statsKeys = ["awarded", "average", "engineer"] as const;
  if (statsKeys.some((key) => !(key in value) || (value[key] !== null && !parseEvidenceStats(value[key])))) return null;
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
  return {
    ...fields,
    ...(fields.group === undefined ? {} : { group: normalizeProjectGroup(fields.group) }),
    ...(fields.costCategory === undefined ? {} : { costCategory: normalizeProjectCostCategory(fields.costCategory, "other") })
  };
}

function normalizeProjectCostCategory(value: unknown, fallback: ProjectCostCategory): ProjectCostCategory {
  return value === "construction" || value === "other" || value === "contingency" ? value : fallback;
}

function projectLineCostCategory(lineItem: ProjectLineItem): ProjectCostCategory {
  return lineItem.costCategory ?? (lineItem.lineItemType === "custom" ? "other" : "construction");
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
