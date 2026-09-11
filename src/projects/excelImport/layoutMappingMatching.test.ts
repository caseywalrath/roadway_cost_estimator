// @ts-expect-error Node is used only to load the committed binary fixture in tests.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readWorkbook } from "./readWorkbook";
import { detectLayout } from "./detectLayout";
import { matchRows, normalizeImportDescription, normalizeImportUnit } from "./matchRows";
import { mergeContinuationRows, parseImportNumber, parseRows, validateMapping } from "./parseRows";
import { resolveDraftRows } from "./resolveDraft";
import { deduplicateSelectedRows, validateRegionOverlaps } from "./selectionRules";
import type { AgencyItemRecord } from "../../data/schema";
import type { ExcelImportMapping, ExcelImportSelection } from "./types";

const fixture = readFileSync("src/projects/excelImport/fixtures/sparse-reader-fixtures.xlsx");

describe("Excel import layout, mapping, matching, and resolution", () => {
  it("detects a physical header row and preserves explicit region mapping", () => {
    const workbook = readWorkbook(fixture, { fileName: "fixture.xlsx" });
    const layout = detectLayout(workbook.sheets[0]);
    expect(layout.regions[0].suggestedHeaderRow).toBe(2);
    expect(layout.regions[0].hiddenRowCount).toBe(1);
    expect(layout.regions[0].hiddenColumnCount).toBe(1);
    expect(layout.regions[0].headerCandidates[0].recognizedFields).toContain("itemCode");
    expect(layout.regions[0].sections.some((section) => section.title === "Synthetic workbook fixture")).toBe(true);
    const mapping: ExcelImportMapping = {
      headerRow: 2,
      columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6 },
      groupSource: "section",
      categorySource: "construction"
    };
    expect(validateMapping(mapping)).toEqual([]);
    expect(validateMapping({ ...mapping, columns: { itemCode: 1, description: 1 } })).toHaveLength(1);
  });

  it("parses typed numbers, cached formula values, and unresolved formula caches", () => {
    const workbook = readWorkbook(fixture, { fileName: "fixture.xlsx" });
    const selection: ExcelImportSelection = { sheetName: "Primary", startRow: 3, endRow: 5, startColumn: 1, endColumn: 6, includeHiddenRows: false, includedSectionIds: [] };
    const rows = parseRows(workbook.sheets[0], {
      selection,
      mapping: { headerRow: 2, columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6 }, groupSource: "blank", categorySource: "construction" }
    });
    expect(rows[0].values.itemCode).toBe("0012");
    expect(rows[0].values.sourceTotal).toBe(200);
    expect(rows[1].issues.map((issue) => issue.code)).toContain("formula-cache-missing");
    expect(rows[2].issues.map((issue) => issue.code)).toContain("formula-error");
  });

  it("uses exact code matching, explicit aliases, and review for description conflicts", () => {
    expect(normalizeImportDescription("  A\u0301   B ")).toBe("á b");
    expect(normalizeImportUnit("L.S.")).toBe("LS");
    const workbook = readWorkbook(fixture, { fileName: "fixture.xlsx" });
    const rows = parseRows(workbook.sheets[0], {
      selection: { sheetName: "Primary", startRow: 3, endRow: 3, startColumn: 1, endColumn: 6, includeHiddenRows: false, includedSectionIds: [] },
      mapping: { headerRow: 2, columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6 }, groupSource: "blank", categorySource: "construction" }
    });
    const agencyItem = catalog("0012", "MOBILIZATION", "EACH");
    const matched = matchRows(rows, { state: "CO", agencyId: "co_cdot", agencyItems: [agencyItem] });
    expect(matched[0].matchStatus).toBe("catalog-ready");
    expect(matched[0].selectedAgencyItemId).toBe(agencyItem.agencyItemId);
    const conflict = matchRows([{ ...rows[0], values: { ...rows[0].values, description: "Different work" } }], { state: "CO", agencyId: "co_cdot", agencyItems: [agencyItem] });
    expect(conflict[0].matchStatus).toBe("needs-review");
    const resolved = resolveDraftRows(conflict, { importId: "imp-1", fileName: "C:\\temp\\estimate.xlsx", importedAt: "2026-01-01T00:00:00.000Z", state: "CO", now: "2026-01-01T00:00:00.000Z", createLineItemId: () => "line-1", decisions: { [conflict[0].rowId]: { action: "keep-custom" } } });
    expect(resolved[0].lineItem?.lineItemType).toBe("custom");
    expect(resolved[0].lineItem?.costCategory).toBe("construction");
    expect(resolved[0].lineItem?.importSource?.fileName).toBe("estimate.xlsx");

    const descriptionOnly = matchRows([{ ...rows[0], rowId: "Primary#row-100", values: { ...rows[0].values, itemCode: "" } }], { state: "CO", agencyId: "co_cdot", agencyItems: [agencyItem] });
    expect(descriptionOnly[0].matchStatus).toBe("needs-review");
    const linked = resolveDraftRows(descriptionOnly, { importId: "imp-2", fileName: "estimate.xlsx", importedAt: "2026-01-01T00:00:00.000Z", state: "CO", now: "2026-01-01T00:00:00.000Z", createLineItemId: () => "line-2", decisions: { [descriptionOnly[0].rowId]: { action: "accept-description-match" } } });
    expect(linked[0].lineItem?.lineItemType).toBe("catalog");
  });

  it("deduplicates identical physical rows and blocks conflicting overlaps", () => {
    const mapping = { headerRow: 2, columns: { description: 2, unit: 3 }, groupSource: "blank" as const, categorySource: "construction" as const };
    expect(deduplicateSelectedRows([
      { rangeId: "a", startRow: 3, endRow: 4, startColumn: 2, endColumn: 3, includeHiddenRows: false, includedSectionIds: [] },
      { rangeId: "b", startRow: 4, endRow: 5, startColumn: 2, endColumn: 3, includeHiddenRows: false, includedSectionIds: [] }
    ]).map((range) => range.startRow)).toEqual([3, 4, 5]);
    expect(validateRegionOverlaps([
      { regionId: "a", startRow: 3, endRow: 5, startColumn: 2, endColumn: 3, mapping },
      { regionId: "b", startRow: 4, endRow: 6, startColumn: 2, endColumn: 3, mapping: { ...mapping, categorySource: "section" } }
    ])).toHaveLength(1);
  });

  it("rejects ambiguous numeric text and preserves zero versus blank", () => {
    const issues: any[] = [];
    expect(parseImportNumber({ display: "$1,250.50", cell: null }, "unitCost", issues)).toBe(1250.5);
    expect(parseImportNumber({ display: "1.250,50", cell: null }, "unitCost", issues)).toBeNull();
    expect(parseImportNumber({ display: "", cell: null }, "quantity", issues)).toBeNull();
    expect(parseImportNumber({ display: "0", cell: null }, "quantity", issues)).toBe(0);
    expect(issues.map((issue) => issue.code)).toContain("invalid-number");
  });

  it("requires an explicit decision for large source-total differences and supports fixed allowances", () => {
    const workbook = readWorkbook(fixture, { fileName: "fixture.xlsx" });
    const parsed = parseRows(workbook.sheets[0], {
      selection: { sheetName: "Primary", startRow: 3, endRow: 3, startColumn: 1, endColumn: 6, includeHiddenRows: false, includedSectionIds: [] },
      mapping: { headerRow: 2, columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6 }, groupSource: "blank", categorySource: "construction" }
    });
    const matched = matchRows([{ ...parsed[0], values: { ...parsed[0].values, quantity: 0.08, unitCost: 227700, sourceTotal: 227700 } }], { state: "CO", agencyId: "co_cdot", agencyItems: [] });
    const blocked = resolveDraftRows(matched, { importId: "imp-3", fileName: "estimate.xlsx", importedAt: "2026-01-01T00:00:00.000Z", state: "CO", decisions: {} });
    expect(blocked[0].outcome).toBe("failed");
    const allowance = resolveDraftRows(matched, { importId: "imp-3", fileName: "estimate.xlsx", importedAt: "2026-01-01T00:00:00.000Z", state: "CO", now: "2026-01-01T00:00:00.000Z", createLineItemId: () => "line-3", decisions: { [matched[0].rowId]: { action: "fixed-allowance" } } });
    expect(allowance[0].lineItem?.quantity).toBe(1);
    expect(allowance[0].lineItem?.preferredUnitCost).toBe(227700);
  });

  it("merges only an explicitly selected continuation within its section", () => {
    const workbook = readWorkbook(fixture, { fileName: "fixture.xlsx" });
    const rows = parseRows(workbook.sheets[0], {
      selection: { sheetName: "Primary", startRow: 3, endRow: 4, startColumn: 1, endColumn: 6, includeHiddenRows: false, includedSectionIds: [] },
      mapping: { headerRow: 2, columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6 }, groupSource: "blank", categorySource: "construction" }
    });
    const continuation = { ...rows[1], rowId: "Primary#row-4-cont", continuationOfRowId: rows[0].rowId, sectionId: undefined, values: { ...rows[1].values, itemCode: "", unit: "", quantity: null, unitCost: null }, rawValues: { ...rows[1].rawValues, itemCode: "", unit: "", quantity: "", unitCost: "" } };
    const merged = mergeContinuationRows([{ ...rows[0], sectionId: undefined }, continuation], [continuation.rowId]);
    expect(merged).toHaveLength(1);
    expect(merged[0].values.description).toContain("MOBILIZATION SIGNAL CABINET");
    expect(merged[0].contributingLocators).toHaveLength(2);
  });

  it("applies category precedence from mapped value, section default, then construction", () => {
    const workbook = readWorkbook(fixture, { fileName: "fixture.xlsx" });
    const section = { sectionId: "section-1", startRow: 3, endRow: 3, title: "Right of Way", defaultCategory: "other" as const, requiresAlternativeChoice: false, includedByDefault: true };
    const rows = parseRows(workbook.sheets[0], {
      selection: { sheetName: "Primary", startRow: 3, endRow: 3, startColumn: 1, endColumn: 7, includeHiddenRows: false, includedSectionIds: [section.sectionId] },
      mapping: { headerRow: 2, columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6, costCategory: 7 }, groupSource: "section", categorySource: "mapped" },
      sections: [section]
    });
    expect(rows[0].values.costCategory).toBe("other");
    const explicitSheet = { ...workbook.sheets[0], cells: [...workbook.sheets[0].cells, { address: "G3", rowNumber: 3, columnNumber: 7, columnLabel: "G", type: "string" as const, rawValue: "construction", formattedText: "construction", formula: null, hasFormula: false, cachedValue: null, numberFormat: null, mergeAnchor: null }] };
    const explicit = parseRows(explicitSheet, {
      selection: { sheetName: "Primary", startRow: 3, endRow: 3, startColumn: 1, endColumn: 7, includeHiddenRows: false, includedSectionIds: [section.sectionId] },
      mapping: { headerRow: 2, columns: { itemCode: 1, description: 2, unit: 3, quantity: 4, unitCost: 5, sourceTotal: 6, costCategory: 7 }, groupSource: "section", categorySource: "mapped" },
      sections: [section]
    });
    expect(explicit[0].values.costCategory).toBe("construction");
  });
});

function catalog(itemCode: string, officialDescription: string, officialUnit: string): AgencyItemRecord {
  return { agencyItemId: `co_cdot_${itemCode}`, state: "CO", agencyId: "co_cdot", agencyName: "CDOT", itemCode, currentVersionId: "version", itemStatus: "current", canonicalItemId: "canonical", officialDescription, officialAbbreviatedDescription: officialDescription, officialUnit, specReferenceCode: "", agency: "CDOT" };
}
