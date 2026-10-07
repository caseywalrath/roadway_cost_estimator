import { duplicatePlanningScenario, scenarioFingerprint } from "./planningWorkspace";
import { validatePackageDefinition, validatePlanningScenario } from "./validateRecipes";
import type { PlanningIssue, PlanningResult, PlanningScenario, PlanningWorkspace } from "./types";

export const PLANNING_BACKUP_FORMAT = "roadway-cost-estimator-planning" as const;
export const PLANNING_BACKUP_VERSION = 1 as const;

export interface PlanningBackupFile {
  fileFormat: typeof PLANNING_BACKUP_FORMAT;
  fileVersion: typeof PLANNING_BACKUP_VERSION;
  exportedAt: string;
  workspaceSchemaVersion: 1;
  revision: number;
  workspace: PlanningWorkspace;
}

const error = (code: string, path: string, message: string): PlanningIssue => ({ code, path, message, severity: "error" });
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const finiteInt = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
const nonblank = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const isoDateTime = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
  && Number.isFinite(Date.parse(value));
const isoDate = (value: unknown): value is string => typeof value === "string"
  && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
  && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
const draftIssue = (entry: PlanningIssue): boolean => ["invalid_number", "out_of_bounds", "integer_required", "missing_parameter"].includes(entry.code);
const clone = <T>(value: T): T => structuredClone(value);
const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;
const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(nonblank);

function validInflation(value: unknown, kind: "ne_annual" | "co_contract_median"): boolean {
  if (!record(value) || !["available", "unavailable"].includes(String(value.availability))) return false;
  if (kind === "ne_annual" && value.method !== "annual_window_nhcci") return false;
  if (kind === "co_contract_median" && !["none", "observation_quarter_nhcci"].includes(String(value.method))) return false;
  if (value.targetPeriod !== null && !nonblank(value.targetPeriod)) return false;
  if (value.availability === "unavailable") return value.factor === null && nonblank(value.reason);
  return value.reason === null && (kind === "ne_annual" ? positive(value.factor) : value.factor === null);
}

function validFrozenRate(value: unknown): boolean {
  if (!record(value) || !["ne_annual", "co_contract_median"].includes(String(value.kind))
    || !nonblank(value.agencyItemId) || !nonblank(value.unit) || !positive(value.rawRate)
    || !positive(value.rate) || !nonblank(value.policyVersion) || !isoDateTime(value.capturedAt)) return false;
  const kind = value.kind as "ne_annual" | "co_contract_median";
  if (!validInflation(value.inflation, kind)) return false;
  if (kind === "ne_annual") return value.state === "NE" && nonblank(value.sourceUnit)
    && nonblank(value.sourceDescription) && nonblank(value.sourceId) && nonblank(value.summaryId)
    && nonblank(value.reportSeries) && isoDate(value.periodStart) && isoDate(value.periodEnd)
    && value.periodStart <= value.periodEnd && nonblank(value.sourceUrl)
    && (value.sourcePage === null || finiteInt(value.sourcePage)) && nonblank(value.sourceLocator);
  return value.state === "CO" && isoDate(value.requestedFrom) && isoDate(value.requestedTo)
    && value.requestedFrom <= value.requestedTo && isoDate(value.datasetAnchor)
    && isoDate(value.actualFrom) && isoDate(value.actualTo) && value.actualFrom <= value.actualTo
    && strings(value.sourceTypes) && value.sourceTypes.length > 0 && strings(value.sourceIds)
    && value.sourceIds.length > 0 && Array.isArray(value.requestedSourceIds)
    && value.requestedSourceIds.every(nonblank) && Array.isArray(value.districts)
    && value.districts.every((entry) => typeof entry === "string")
    && Array.isArray(value.excludedEvidence)
    && value.excludedEvidence.every((entry) => record(entry) && nonblank(entry.observationId) && nonblank(entry.reason))
    && typeof value.limitedEvidence === "boolean" && Array.isArray(value.contracts)
    && value.contracts.length > 0 && value.contracts.every((entry) => record(entry)
      && nonblank(entry.contractId) && positive(entry.medianRate) && Array.isArray(entry.lines)
      && entry.lines.length > 0 && entry.lines.every((line) => record(line)
        && nonblank(line.observationId) && nonblank(line.contractItemId)
        && nonblank(line.sourceId) && isoDate(line.date) && positive(line.quantity)
        && nonblank(line.unit) && positive(line.rawRate) && positive(line.rate)
        && nonblank(line.sourceLocator)
        && (kind === "co_contract_median" && (value.inflation as Record<string, unknown>).method === "observation_quarter_nhcci"
          ? positive(line.inflationFactor) : line.inflationFactor === null)));
}

/** Builds a detached recovery file without changing or evaluating the workspace. */
export function buildPlanningBackup(workspace: PlanningWorkspace, exportedAt = workspace.updatedAt): PlanningBackupFile {
  return {
    fileFormat: PLANNING_BACKUP_FORMAT,
    fileVersion: PLANNING_BACKUP_VERSION,
    exportedAt,
    workspaceSchemaVersion: 1,
    revision: workspace.revision,
    workspace: clone(workspace),
  };
}

function validateWorkspace(workspace: unknown): PlanningIssue[] {
  const issues: PlanningIssue[] = [];
  if (!record(workspace)) return [error("invalid_backup", "workspace", "Workspace must be an object.")];
  if (workspace.schemaVersion !== 1) issues.push(error("invalid_backup", "workspace.schemaVersion", "Unsupported Planning workspace schema."));
  if (!nonblank(workspace.workspaceId) || !nonblank(workspace.name)) issues.push(error("invalid_backup", "workspace", "Workspace ID and name must be nonblank."));
  if (!isoDateTime(workspace.createdAt) || !isoDateTime(workspace.updatedAt)) issues.push(error("invalid_backup", "workspace.timestamps", "Workspace timestamps must be ISO date-times."));
  if (workspace.state !== "NE" && workspace.state !== "CO") issues.push(error("state_mismatch", "workspace.state", "Workspace state must be NE or CO."));
  if (!finiteInt(workspace.revision) || workspace.revision < 0) issues.push(error("invalid_backup", "workspace.revision", "Workspace revision must be a nonnegative integer."));
  if (!Array.isArray(workspace.scenarios)) issues.push(error("invalid_backup", "workspace.scenarios", "Workspace scenarios must be an array."));
  if (workspace.activeScenarioId !== null && !nonblank(workspace.activeScenarioId)) issues.push(error("invalid_backup", "workspace.activeScenarioId", "Active scenario ID must be null or nonblank."));
  if (Array.isArray(workspace.scenarios)) {
    const ids = new Set<string>();
    for (const [index, scenario] of workspace.scenarios.entries()) {
      if (!record(scenario)) { issues.push(error("invalid_backup", `workspace.scenarios[${index}]`, "Scenario must be an object.")); continue; }
      const arrays = ["segments", "packages", "customComponents", "substitutions", "allowances", "externalScopes", "history"] as const;
      for (const key of arrays) if (!Array.isArray(scenario[key])) issues.push(error("invalid_backup", `workspace.scenarios[${index}].${key}`, `${key} must be an array.`));
      if (scenario.review !== null && !record(scenario.review)) issues.push(error("invalid_backup", `workspace.scenarios[${index}].review`, "Review must be null or an object."));
      if (scenario.projectLink !== null && !record(scenario.projectLink)) issues.push(error("invalid_backup", `workspace.scenarios[${index}].projectLink`, "Project link must be null or an object."));
      if (scenario.handoffIntent !== null && !record(scenario.handoffIntent)) issues.push(error("invalid_backup", `workspace.scenarios[${index}].handoffIntent`, "Handoff intent must be null or an object."));
      if (!isoDateTime(scenario.createdAt) || !isoDateTime(scenario.updatedAt)) issues.push(error("invalid_backup", `workspace.scenarios[${index}].timestamps`, "Scenario timestamps must be ISO date-times."));
      if (record(scenario.review) && (!nonblank(scenario.review.reviewer) || !isoDate(scenario.review.date) || !nonblank(scenario.review.fingerprint) || typeof scenario.review.notes !== "string")) issues.push(error("invalid_backup", `workspace.scenarios[${index}].review`, "Review fields are malformed."));
      if (Array.isArray(scenario.packages)) for (const [packageIndex, instance] of scenario.packages.entries()) {
        if (!record(instance) || !record(instance.definition)) { issues.push(error("invalid_backup", `workspace.scenarios[${index}].packages[${packageIndex}]`, "Package instance and definition must be objects.")); continue; }
        for (const key of ["parameters", "components", "assumptions", "exclusions"] as const) {
          if (!Array.isArray(instance.definition[key])) issues.push(error("invalid_backup", `workspace.scenarios[${index}].packages[${packageIndex}].definition.${key}`, `${key} must be an array.`));
          else if (key !== "exclusions" && (instance.definition[key] as unknown[]).some((item) => !record(item))) issues.push(error("invalid_backup", `workspace.scenarios[${index}].packages[${packageIndex}].definition.${key}`, `${key} entries must be objects.`));
        }
        for (const key of ["parameterOverrides", "quantityOverrides", "rateOverrides", "exclusions", "rateSnapshots"] as const) if (!record(instance[key])) issues.push(error("invalid_backup", `workspace.scenarios[${index}].packages[${packageIndex}].${key}`, `${key} must be an object.`));
        if (record(instance.rateSnapshots)) for (const [role, snapshot] of Object.entries(instance.rateSnapshots)) {
          if (!validFrozenRate(snapshot)) issues.push(error("invalid_snapshot", `workspace.scenarios[${index}].packages[${packageIndex}].rateSnapshots.${role}`, "Rate snapshot identity, rates, or provenance are malformed."));
        }
      }
      if (ids.has(String(scenario.scenarioId))) issues.push(error("duplicate_id", `workspace.scenarios[${index}].scenarioId`, "Scenario ID is duplicated."));
      ids.add(String(scenario.scenarioId));
      if (scenario.state !== workspace.state) issues.push(error("state_mismatch", `workspace.scenarios[${index}].state`, "Scenario state must match workspace state."));
      const shapeOk = arrays.every((key) => Array.isArray(scenario[key])) &&
        (scenario.packages as unknown[]).every((instance) => {
          if (!record(instance) || !record(instance.definition)) return false;
          const definition = instance.definition as Record<string, unknown>;
          return ["parameters", "components", "assumptions", "exclusions"].every((key) => Array.isArray(definition[key])) &&
            ["parameters", "components", "assumptions"].every((key) => (definition[key] as unknown[]).every((item) => record(item)));
        });
      if (shapeOk) issues.push(...validatePlanningScenario(scenario as unknown as PlanningScenario).filter((entry) => !draftIssue(entry)));
      for (const instance of Array.isArray(scenario.packages) ? scenario.packages : []) {
        if (record(instance) && record(instance.definition)) issues.push(...validatePackageDefinition(instance.definition as never));
      }
    }
    if (workspace.activeScenarioId !== null && !ids.has(String(workspace.activeScenarioId))) issues.push(error("missing_reference", "workspace.activeScenarioId", "Active scenario does not exist."));
  }
  if (workspace.lastBackupAt !== null && !nonblank(workspace.lastBackupAt)) issues.push(error("invalid_backup", "workspace.lastBackupAt", "Backup timestamp must be null or nonblank."));
  if (workspace.lastBackupRevision !== null && (!finiteInt(workspace.lastBackupRevision) || workspace.lastBackupRevision < 0)) issues.push(error("invalid_backup", "workspace.lastBackupRevision", "Backup revision must be null or a nonnegative integer."));
  return issues;
}

/** Parses and validates the complete recovery record. It never normalizes malformed data. */
export function parsePlanningBackup(value: unknown): PlanningBackupFile | null {
  if (!record(value) || value.fileFormat !== PLANNING_BACKUP_FORMAT || value.fileVersion !== PLANNING_BACKUP_VERSION || value.workspaceSchemaVersion !== 1 || !isoDateTime(value.exportedAt) || !finiteInt(value.revision) || !record(value.workspace)) return null;
  const workspace = value.workspace as unknown as PlanningWorkspace;
  let issues: PlanningIssue[];
  try { issues = validateWorkspace(workspace); } catch { return null; }
  if (issues.some((entry) => entry.severity === "error") || workspace.revision !== value.revision) return null;
  return { fileFormat: PLANNING_BACKUP_FORMAT, fileVersion: 1, exportedAt: value.exportedAt, workspaceSchemaVersion: 1, revision: value.revision, workspace: clone(workspace) };
}

function freshId(original: string, used: Set<string>, seed = ""): string {
  const base = `${original}-copy${seed ? `-${seed}` : ""}`;
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}`;
  used.add(candidate);
  return candidate;
}

/** Imports a valid backup as an independent workspace copy. IDs and all typed references are remapped. */
export function importPlanningWorkspace(workspace: PlanningWorkspace, now: string, idSeed: string): PlanningResult<PlanningWorkspace> {
  const issues = validateWorkspace(workspace);
  if (!isoDateTime(now)) issues.push(error("invalid_recipe", "now", "Import timestamp must be an ISO date-time."));
  if (!nonblank(idSeed)) issues.push(error("invalid_recipe", "idSeed", "A unique import ID seed is required."));
  if (issues.some((entry) => entry.severity === "error")) return { ok: false, issues };
  const used = new Set<string>([workspace.workspaceId, ...workspace.scenarios.flatMap((s) => [s.scenarioId, ...s.segments.map((x) => x.segmentId), ...s.packages.map((x) => x.instanceId), ...s.customComponents.map((x) => x.componentId), ...s.allowances.map((x) => x.allowanceId)])]);
  const workspaceId = freshId(workspace.workspaceId, used, idSeed);
  const scenarios: PlanningScenario[] = [];
  const scenarioIdMap = new Map<string, string>();
  for (const source of workspace.scenarios) {
    const scenarioId = freshId(source.scenarioId, used, idSeed);
    const segmentIds: Record<string, string> = {};
    const instanceIds: Record<string, string> = {};
    const customComponentIds: Record<string, string> = {};
    const allowanceIds: Record<string, string> = {};
    for (const segment of source.segments) segmentIds[segment.segmentId] = freshId(segment.segmentId, used, idSeed);
    for (const instance of source.packages) instanceIds[instance.instanceId] = freshId(instance.instanceId, used, idSeed);
    for (const component of source.customComponents) customComponentIds[component.componentId] = freshId(component.componentId, used, idSeed);
    for (const allowance of source.allowances) allowanceIds[allowance.allowanceId] = freshId(allowance.allowanceId, used, idSeed);
    const duplicate = duplicatePlanningScenario(source, { scenarioId, segmentIds, instanceIds, customComponentIds, allowanceIds }, `${source.name} (Imported)`, now);
    if (!duplicate.ok) return duplicate;
    scenarios.push(duplicate.value);
    scenarioIdMap.set(source.scenarioId, scenarioId);
  }
  const copy: PlanningWorkspace = {
    schemaVersion: 1,
    workspaceId,
    state: workspace.state,
    name: `${workspace.name} (Imported)`,
    revision: 0,
    activeScenarioId: workspace.activeScenarioId === null ? null : (scenarioIdMap.get(workspace.activeScenarioId) ?? null),
    scenarios,
    createdAt: now,
    updatedAt: now,
    lastBackupAt: null,
    lastBackupRevision: null,
  };
  return { ok: true, value: copy, issues: [] };
}

export function importPlanningBackup(value: unknown, now: string, idSeed: string): PlanningResult<PlanningWorkspace> {
  const parsed = parsePlanningBackup(value);
  return parsed ? importPlanningWorkspace(parsed.workspace, now, idSeed) : { ok: false, issues: [error("invalid_backup", "file", "The selected file is not a supported Planning backup.")] };
}

export function planningBackupFingerprint(workspace: PlanningWorkspace): string {
  return workspace.scenarios.map((scenario) => scenarioFingerprint(scenario)).join("|");
}

// Compatibility aliases for callers using the shorter recovery terminology.
export const buildPlanningRecovery = buildPlanningBackup;
export const parsePlanningRecovery = parsePlanningBackup;
export const createImportedPlanningWorkspace = importPlanningWorkspace;
