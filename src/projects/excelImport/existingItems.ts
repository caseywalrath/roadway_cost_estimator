import { projectLineTotal, type ProjectLineItem, type UserProject } from "../projectWorkspace";
import type { ResolvedImportRow } from "./types";

export type ExistingItemAction = "add" | "update" | "skip";
export interface ExistingItemChoice { action: ExistingItemAction; targetLineItemId?: string }
export interface ExistingItemMatch {
  rowId: string;
  incoming: ProjectLineItem;
  candidates: ProjectLineItem[];
  action: ExistingItemAction;
  targetLineItemId?: string;
  needsTarget: boolean;
}
export interface ExistingItemPlan {
  matches: ExistingItemMatch[];
  additions: ProjectLineItem[];
  updates: ProjectLineItem[];
  skippedRowIds: string[];
  errors: string[];
  constructionDelta: number;
  otherDelta: number;
}

const normalize = (value: string) => value.normalize("NFC").trim().toLowerCase();
export function existingItemKey(line: ProjectLineItem): string {
  const identity = line.lineItemType === "catalog"
    ? ["catalog", line.state, line.agencyId, line.agencyItemId]
    : ["custom", normalize(line.itemCode), normalize(line.description), normalize(line.unit)];
  return JSON.stringify([...identity, normalize(line.group), line.costCategory]);
}

export function planExistingItems(
  rows: ResolvedImportRow[], project: UserProject | null,
  defaultAction: ExistingItemAction = "add", choices: Record<string, ExistingItemChoice> = {}
): ExistingItemPlan {
  const accepted = rows.filter((row) => row.lineItem && (row.outcome === "imported" || row.outcome === "imported-incomplete"));
  const existing = new Map<string, ProjectLineItem[]>();
  for (const line of project?.lineItems ?? []) {
    const key = existingItemKey(line);
    existing.set(key, [...(existing.get(key) ?? []), line]);
  }
  const incomingCounts = new Map<string, number>();
  for (const row of accepted) {
    const key = existingItemKey(row.lineItem!);
    incomingCounts.set(key, (incomingCounts.get(key) ?? 0) + 1);
  }
  const plan: ExistingItemPlan = { matches: [], additions: [], updates: [], skippedRowIds: [], errors: [], constructionDelta: 0, otherDelta: 0 };
  const usedTargets = new Set<string>();
  const addDelta = (line: ProjectLineItem, amount: number) => {
    if (line.costCategory === "construction") plan.constructionDelta += amount;
    else plan.otherDelta += amount;
  };
  for (const row of accepted) {
    const incoming = row.lineItem!;
    const key = existingItemKey(incoming);
    const candidates = existing.get(key) ?? [];
    if (!candidates.length) { plan.additions.push(incoming); addDelta(incoming, projectLineTotal(incoming)); continue; }
    const ambiguous = candidates.length !== 1 || incomingCounts.get(key)! > 1;
    const choice = choices[row.rowId];
    const action = choice?.action ?? (defaultAction === "update" && ambiguous ? "add" : defaultAction);
    const targetLineItemId = choice?.targetLineItemId ?? (!ambiguous && action === "update" ? candidates[0].lineItemId : undefined);
    const match: ExistingItemMatch = { rowId: row.rowId, incoming, candidates, action, targetLineItemId, needsTarget: ambiguous };
    plan.matches.push(match);
    if (action === "skip") { plan.skippedRowIds.push(row.rowId); continue; }
    if (action === "add") { plan.additions.push(incoming); addDelta(incoming, projectLineTotal(incoming)); continue; }
    const target = candidates.find((line) => line.lineItemId === targetLineItemId);
    if (!target) { plan.errors.push("Choose an existing Project item for each update, or select Add as separate item."); continue; }
    if (usedTargets.has(target.lineItemId)) { plan.errors.push("More than one spreadsheet row targets the same Project item. Update it from only one row; add or skip the others."); continue; }
    usedTargets.add(target.lineItemId);
    const updated: ProjectLineItem = {
      ...structuredClone(target),
      quantity: incoming.quantity ?? target.quantity,
      preferredUnitCost: incoming.preferredUnitCost ?? target.preferredUnitCost,
      notes: incoming.notes.trim() ? incoming.notes : target.notes,
      importSource: structuredClone(incoming.importSource),
      updatedAt: incoming.updatedAt
    };
    if (updated.importSource) updated.importSource.decisions = [...updated.importSource.decisions, "update-existing-item"];
    plan.updates.push(updated);
    addDelta(updated, projectLineTotal(updated) - projectLineTotal(target));
  }
  return plan;
}
