import { projectCostSummary, type ProjectCostSummary, type ProjectLineItem, type UserProject } from "../projectWorkspace";

/** A backup is always parsed with parseProjectBackup before it reaches this module. */
export type BackupLineStatus = "added" | "removed" | "changed" | "unchanged" | "unpaired";
export type BackupLineAction = "keep_project" | "use_backup" | "add_separate" | "delete";
export type BackupMetadataKey = "name" | "location" | "notes";

export interface BackupLineComparison {
  /** Stable within this draft; use as a key in lineActions. */
  key: string;
  status: BackupLineStatus;
  pairing: "exact_id" | "confirmed" | null;
  current: ProjectLineItem | null;
  backup: ProjectLineItem | null;
  /** Suggestion only. The caller must place this ID in confirmedPairs to pair it. */
  suggestedCurrentLineId: string | null;
  candidateCurrentLineIds: string[];
  changedFields: string[];
  defaultAction: "keep_project";
}

export interface BackupMetadataComparison {
  key: BackupMetadataKey;
  current: UserProject[BackupMetadataKey];
  backup: UserProject[BackupMetadataKey];
  changed: boolean;
}

export interface BackupComparison {
  destinationProjectId: string;
  destinationRevision: number;
  backupProjectId: string;
  crossProject: boolean;
  metadata: BackupMetadataComparison[];
  lines: BackupLineComparison[];
  currentSummary: ProjectCostSummary;
  backupSummary: ProjectCostSummary;
}

export interface BackupMergeChoices {
  /** Backup line ID -> current line ID. Suggestions are inert until confirmed here. */
  confirmedPairs?: Record<string, string>;
  /** Comparison line key -> explicit action. Omitted actions keep current data. */
  lineActions?: Record<string, BackupLineAction>;
  /** Metadata field -> use the backup value. Omitted fields retain the destination value. */
  useBackupMetadata?: Partial<Record<BackupMetadataKey, boolean>>;
}

export interface BackupMergeOptions {
  /** Supply IDs at the UI boundary so comparisons and projections remain repeatable. */
  newLineId: (backupLineId: string) => string;
  timestamp: string;
}

export interface BackupMergeProjection {
  project: UserProject;
  summary: ProjectCostSummary;
  counts: { kept: number; updated: number; added: number; deleted: number };
}

const METADATA_KEYS: readonly BackupMetadataKey[] = [
  "name", "location", "notes"
];

const LINE_FIELDS: readonly (keyof ProjectLineItem)[] = [
  "lineItemType", "costCategory", "pricingMode", "percentageRate", "percentageBase", "costRole",
  "group", "itemCode", "description", "unit", "quantity", "preferredUnitCost", "notes"
];

export function compareProjectBackup(
  current: UserProject,
  backup: UserProject,
  confirmedPairs: Record<string, string> = {}
): BackupComparison {
  if (current.state !== backup.state) throw new Error("The backup and destination Project must have the same state.");
  const currentById = new Map(current.lineItems.map((line) => [line.lineItemId, line]));
  const backupById = new Map(backup.lineItems.map((line) => [line.lineItemId, line]));
  if (currentById.size !== current.lineItems.length || backupById.size !== backup.lineItems.length) {
    throw new Error("Project lines must have unique IDs before comparison.");
  }
  const pairedCurrentIds = new Set<string>();
  const pairedBackupIds = new Set<string>();
  const lines: BackupLineComparison[] = [];

  for (const backupLine of backup.lineItems) {
    const exact = currentById.get(backupLine.lineItemId);
    const confirmedId = confirmedPairs[backupLine.lineItemId];
    if (confirmedId && exact && confirmedId !== exact.lineItemId) throw new Error("An exact line ID cannot be paired with a different line.");
    const currentLine = exact ?? (confirmedId ? currentById.get(confirmedId) : undefined);
    if (confirmedId && !currentLine) throw new Error("A confirmed backup pairing no longer exists in the destination Project.");
    if (!currentLine) continue;
    if (pairedCurrentIds.has(currentLine.lineItemId)) throw new Error("Two backup lines cannot target the same Project line.");
    pairedCurrentIds.add(currentLine.lineItemId);
    pairedBackupIds.add(backupLine.lineItemId);
    const changedFields = lineChanges(currentLine, backupLine);
    lines.push({
      key: `backup:${backupLine.lineItemId}`,
      status: changedFields.length ? "changed" : "unchanged",
      pairing: exact ? "exact_id" : "confirmed",
      current: currentLine,
      backup: backupLine,
      suggestedCurrentLineId: null,
      candidateCurrentLineIds: [],
      changedFields,
      defaultAction: "keep_project"
    });
  }

  const remainingCurrent = current.lineItems.filter((line) => !pairedCurrentIds.has(line.lineItemId));
  const remainingBackup = backup.lineItems.filter((line) => !pairedBackupIds.has(line.lineItemId));
  const suggestions = suggestUniquePairs(remainingCurrent, remainingBackup);
  for (const backupLine of remainingBackup) {
    const suggestion = suggestions.get(backupLine.lineItemId) ?? null;
    const candidates = remainingCurrent.filter((line) => possibleIdentity(line, backupLine)).map((line) => line.lineItemId);
    lines.push({
      key: `backup:${backupLine.lineItemId}`,
      status: suggestion || candidates.length || !backupLine.itemCode.trim() ? "unpaired" : "added",
      pairing: null,
      current: null,
      backup: backupLine,
      suggestedCurrentLineId: suggestion,
      candidateCurrentLineIds: candidates,
      changedFields: [],
      defaultAction: "keep_project"
    });
  }
  for (const currentLine of remainingCurrent) {
    lines.push({
      key: `current:${currentLine.lineItemId}`,
      status: remainingBackup.some((line) => possibleIdentity(currentLine, line)) || !currentLine.itemCode.trim() ? "unpaired" : "removed",
      pairing: null,
      current: currentLine,
      backup: null,
      suggestedCurrentLineId: null,
      candidateCurrentLineIds: [],
      changedFields: [],
      defaultAction: "keep_project"
    });
  }
  return {
    destinationProjectId: current.projectId,
    destinationRevision: current.revision,
    backupProjectId: backup.projectId,
    crossProject: current.projectId !== backup.projectId,
    metadata: METADATA_KEYS.map((key) => ({
      key,
      current: current[key],
      backup: backup[key],
      changed: !sameValue(current[key], backup[key])
    })),
    lines,
    currentSummary: projectCostSummary(current),
    backupSummary: projectCostSummary(backup)
  };
}

export function buildProjectBackupMerge(
  current: UserProject,
  backup: UserProject,
  choices: BackupMergeChoices,
  options: BackupMergeOptions
): BackupMergeProjection {
  if (!Number.isFinite(Date.parse(options.timestamp))) throw new Error("A valid merge timestamp is required.");
  const comparison = compareProjectBackup(current, backup, choices.confirmedPairs);
  const knownKeys = new Set(comparison.lines.map((line) => line.key));
  for (const key of Object.keys(choices.lineActions ?? {})) {
    if (!knownKeys.has(key)) throw new Error(`The backup decision for ${key} is no longer valid.`);
  }
  const replacements = new Map<string, ProjectLineItem>();
  const deletions = new Set<string>();
  const additions: ProjectLineItem[] = [];
  const backupIdToResultId = new Map<string, string>();
  const usedIds = new Set(current.lineItems.map((line) => line.lineItemId));
  const counts = { kept: 0, updated: 0, added: 0, deleted: 0 };

  for (const row of comparison.lines) {
    const action = choices.lineActions?.[row.key] ?? "keep_project";
    const currentLine = row.current;
    const backupLine = row.backup;
    if (backupLine && currentLine) backupIdToResultId.set(backupLine.lineItemId, currentLine.lineItemId);
    if (action === "keep_project") {
      if (currentLine) counts.kept++;
      continue;
    }
    if (action === "delete") {
      if (!currentLine || backupLine) throw new Error("Delete applies only to a Project line missing from the backup.");
      deletions.add(currentLine.lineItemId);
      counts.deleted++;
      continue;
    }
    if (!backupLine) throw new Error("This action requires a backup line.");
    if (action === "use_backup" && currentLine) {
      replacements.set(currentLine.lineItemId, {
        ...structuredClone(backupLine),
        lineItemId: currentLine.lineItemId,
        createdAt: currentLine.createdAt,
        updatedAt: options.timestamp
      });
      counts.updated++;
      continue;
    }
    if (action !== "add_separate" && action !== "use_backup") throw new Error("Unknown backup line action.");
    const newId = options.newLineId(backupLine.lineItemId);
    if (!newId || usedIds.has(newId)) throw new Error("A new backup line ID is empty or duplicates another Project line.");
    usedIds.add(newId);
    backupIdToResultId.set(backupLine.lineItemId, newId);
    additions.push({ ...structuredClone(backupLine), lineItemId: newId, createdAt: options.timestamp, updatedAt: options.timestamp });
    counts.added++;
  }

  const remapBase = (line: ProjectLineItem): ProjectLineItem => {
    if (line.percentageBase?.kind !== "selected_lines") return line;
    return {
      ...line,
      percentageBase: {
        kind: "selected_lines",
        lineItemIds: line.percentageBase.lineItemIds.map((id) => backupIdToResultId.get(id) ?? id)
      }
    };
  };
  const mergedLines = [
    ...current.lineItems.filter((line) => !deletions.has(line.lineItemId)).map((line) => {
      const replacement = replacements.get(line.lineItemId);
      return replacement ? remapBase(replacement) : structuredClone(line);
    }),
    ...additions.map(remapBase)
  ];
  const fixedIds = new Set(mergedLines.filter((line) => line.pricingMode !== "percentage").map((line) => line.lineItemId));
  for (const line of mergedLines) {
    if (line.pricingMode === "percentage" && line.percentageBase?.kind === "selected_lines"
      && line.percentageBase.lineItemIds.some((id) => !fixedIds.has(id))) {
      throw new Error(`Percentage line ${line.description || line.lineItemId} references a missing fixed-cost line.`);
    }
  }
  const metadata = Object.fromEntries(METADATA_KEYS.filter((key) => choices.useBackupMetadata?.[key]).map((key) => [key, structuredClone(backup[key])])) as Partial<UserProject>;
  const project: UserProject = {
    ...structuredClone(current),
    ...metadata,
    lineItems: mergedLines,
    updatedAt: options.timestamp
  };
  return { project, summary: projectCostSummary(project), counts };
}

function lineChanges(current: ProjectLineItem, backup: ProjectLineItem): string[] {
  return LINE_FIELDS.filter((field) => !sameValue(current[field], backup[field]));
}

function suggestUniquePairs(current: ProjectLineItem[], backup: ProjectLineItem[]): Map<string, string> {
  const candidateForBackup = new Map<string, string[]>();
  for (const incoming of backup) {
    if (!incoming.itemCode.trim()) continue;
    const candidates = current.filter((line) => sameIdentity(line, incoming));
    candidateForBackup.set(incoming.lineItemId, candidates.map((line) => line.lineItemId));
  }
  const result = new Map<string, string>();
  for (const [backupId, candidates] of candidateForBackup) {
    if (candidates.length !== 1) continue;
    const currentId = candidates[0];
    if ([...candidateForBackup.values()].filter((ids) => ids.includes(currentId)).length === 1) result.set(backupId, currentId);
  }
  return result;
}

function sameIdentity(a: ProjectLineItem, b: ProjectLineItem): boolean {
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return Boolean(norm(a.itemCode))
    && norm(a.itemCode) === norm(b.itemCode)
    && norm(a.unit) === norm(b.unit)
    && norm(a.description) === norm(b.description)
    && norm(a.group) === norm(b.group)
    && a.costCategory === b.costCategory
    && a.pricingMode === b.pricingMode;
}

function possibleIdentity(a: ProjectLineItem, b: ProjectLineItem): boolean {
  if (sameIdentity(a, b)) return true;
  const norm = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase();
  return !norm(a.itemCode) && !norm(b.itemCode) && Boolean(norm(a.description))
    && norm(a.description) === norm(b.description)
    && norm(a.unit) === norm(b.unit)
    && norm(a.group) === norm(b.group)
    && a.costCategory === b.costCategory
    && a.pricingMode === b.pricingMode;
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
