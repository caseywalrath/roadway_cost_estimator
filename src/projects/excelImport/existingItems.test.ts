import { describe, expect, it } from "vitest";
import type { ProjectLineItem, UserProject } from "../projectWorkspace";
import type { ResolvedImportRow } from "./types";
import { existingItemKey, planExistingItems } from "./existingItems";

const line = (overrides: Partial<ProjectLineItem> = {}): ProjectLineItem => ({
  lineItemId: "existing", lineItemType: "catalog", costCategory: "construction",
  state: "NE", agencyId: "ndot", agencyItemId: "item-1", group: "Grading",
  itemCode: "100", description: "Excavation", descriptionOverrideEnabled: false,
  unit: "CY", quantity: 10, preferredUnitCost: 5, notes: "Existing notes",
  evidenceContext: null, createdAt: "2026-01-01", updatedAt: "2026-01-02", ...overrides
});
const project = (...lineItems: ProjectLineItem[]): UserProject => ({
  projectId: "project", state: "NE", name: "Test", location: "", notes: "",
  status: "active", archivedAt: null, revision: 1, lastBackupAt: null,
  lastBackupRevision: null, contingencyPercent: 10, createdAt: "2026-01-01",
  updatedAt: "2026-01-02", lineItems
});
const row = (rowId: string, item: ProjectLineItem): ResolvedImportRow => ({
  rowId, outcome: "imported", lineItem: item, importSource: item.importSource ?? null,
  issues: [], recalculatedTotal: null, sourceTotalDifference: null
});

describe("existing Project item import planning", () => {
  it("matches official identity, Group and category regardless of price or displayed description", () => {
    const base = line();
    expect(existingItemKey(line({ description: "Changed display", itemCode: "Changed", quantity: 99, preferredUnitCost: 40, group: " grading " }))).toBe(existingItemKey(base));
    for (const change of [{ state: "CO" }, { agencyId: "other" }, { agencyItemId: "other" }, { group: "Pavement" }, { costCategory: "other" as const }]) {
      expect(existingItemKey(line(change))).not.toBe(existingItemKey(base));
    }
  });

  it("matches custom items by normalized code, description, unit, Group and category", () => {
    const base = line({ lineItemType: "custom" });
    expect(existingItemKey(line({ lineItemType: "custom", itemCode: " 100 ", description: " EXCAVATION ", unit: " cy ", group: " grading ", quantity: 40 }))).toBe(existingItemKey(base));
    for (const change of [{ itemCode: "101" }, { description: "Fill" }, { unit: "TON" }, { group: "Pavement" }, { costCategory: "other" as const }]) {
      expect(existingItemKey({ ...base, ...change })).not.toBe(existingItemKey(base));
    }
    expect(existingItemKey(base)).not.toBe(existingItemKey(line()));
  });

  it("defaults to additions and adds unmatched rows regardless of matching policy", () => {
    const incoming = line({ lineItemId: "incoming" });
    expect(planExistingItems([row("r1", incoming)], project(line())).additions).toEqual([incoming]);
    for (const action of ["update", "skip"] as const) {
      const result = planExistingItems([row("r1", incoming)], null, action);
      expect(result.additions).toEqual([incoming]);
      expect(result.matches).toEqual([]);
    }
  });

  it("skips matching rows and supports individual overrides", () => {
    const rows = [row("r1", line({ lineItemId: "incoming" })), row("r2", line({ lineItemId: "new", agencyItemId: "new" }))];
    const result = planExistingItems(rows, project(line()), "add", { r1: { action: "skip" } });
    expect(result.skippedRowIds).toEqual(["r1"]);
    expect(result.additions.map((item) => item.lineItemId)).toEqual(["new"]);
    expect(result.constructionDelta).toBe(50);
  });

  it("updates only spreadsheet values while retaining existing identity and metadata", () => {
    const existing = line();
    const incoming = line({ lineItemId: "incoming", quantity: 20, preferredUnitCost: 8, notes: "Imported notes", createdAt: "2026-02-01", updatedAt: "2026-02-02", importSource: {
      importId: "import", fileName: "estimate.xlsx", sheetName: "Estimate", rowNumber: 4,
      sourceRange: "A1:F10", importedAt: "2026-02-02", original: { itemCode: "100", description: "Excavation", unit: "CY", quantity: 20, unitCost: 8, total: 160 }, decisions: []
    } });
    const result = planExistingItems([row("r1", incoming)], project(existing), "update");
    expect(result.updates).toEqual([{ ...existing, quantity: 20, preferredUnitCost: 8, notes: "Imported notes", importSource: { ...incoming.importSource, decisions: ["update-existing-item"] }, updatedAt: incoming.updatedAt }]);
    expect(result.additions).toEqual([]);
    expect(result.constructionDelta).toBe(110);
    expect(existing.quantity).toBe(10);
  });

  it("preserves blank numeric values and notes but replaces explicit zero", () => {
    const blank = planExistingItems([row("r1", line({ quantity: null, preferredUnitCost: null, notes: "  " }))], project(line()), "update");
    expect(blank.updates[0]).toMatchObject({ quantity: 10, preferredUnitCost: 5, notes: "Existing notes" });
    expect(blank.constructionDelta).toBe(0);
    const zero = planExistingItems([row("r1", line({ quantity: 0, preferredUnitCost: 0 }))], project(line()), "update");
    expect(zero.updates[0]).toMatchObject({ quantity: 0, preferredUnitCost: 0 });
    expect(zero.constructionDelta).toBe(-50);
  });

  it("requires explicit targets for multiple existing matches", () => {
    const rows = [row("r1", line({ lineItemId: "incoming" }))];
    const existing = project(line(), line({ lineItemId: "second" }));
    const fallback = planExistingItems(rows, existing, "update");
    expect(fallback.matches[0]).toMatchObject({ action: "add", needsTarget: true });
    expect(fallback.additions).toHaveLength(1);
    expect(planExistingItems(rows, existing, "add", { r1: { action: "update" } }).errors).toHaveLength(1);
    const explicit = planExistingItems(rows, existing, "update", { r1: { action: "update", targetLineItemId: "second" } });
    expect(explicit.updates[0].lineItemId).toBe("second");
    expect(explicit.errors).toEqual([]);
  });

  it("requires explicit targets for repeated incoming identities and rejects competing updates", () => {
    const rows = [row("r1", line({ lineItemId: "one" })), row("r2", line({ lineItemId: "two" }))];
    const fallback = planExistingItems(rows, project(line()), "update");
    expect(fallback.additions).toHaveLength(2);
    expect(fallback.matches.every((match) => match.needsTarget)).toBe(true);
    const conflicting = planExistingItems(rows, project(line()), "add", {
      r1: { action: "update", targetLineItemId: "existing" },
      r2: { action: "update", targetLineItemId: "existing" }
    });
    expect(conflicting.updates).toHaveLength(1);
    expect(conflicting.errors).toHaveLength(1);
  });

  it("separates category deltas and excludes failed or excluded rows", () => {
    const existing = line({ costCategory: "other" });
    const failed = { ...row("failed", line()), outcome: "failed" as const };
    const excluded = { ...row("excluded", line()), outcome: "excluded" as const };
    const result = planExistingItems([row("r1", line({ costCategory: "other", quantity: 20 })), row("new", line()), failed, excluded], project(existing), "update");
    expect(result.otherDelta).toBe(50);
    expect(result.constructionDelta).toBe(50);
    expect(result.additions).toHaveLength(1);
    expect(result.updates).toHaveLength(1);
  });
});
