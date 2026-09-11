import type {
  ExcelCellSnapshot,
  ExcelImportMapping,
  ExcelImportSelection,
  ExcelSectionSuggestion,
  ExcelWorksheetSnapshot,
  ImportField,
  ImportIssue,
  ImportRowLocator,
  ParsedImportValues,
  ParsedImportRow,
  ParseRowsOptions
} from "./types";
import type { ProjectCostCategory } from "../projectWorkspace";

const NUMERIC_FIELDS: readonly ImportField[] = ["quantity", "unitCost", "sourceTotal"];

export function parseRows(sheet: ExcelWorksheetSnapshot, options: ParseRowsOptions): ParsedImportRow[] {
  const { selection, mapping } = options;
  const ranges = selection.ranges?.length ? selection.ranges : [{ rangeId: "primary", ...selection }];
  const cells = new Map(sheet.cells.map((cell) => [cell.address.toUpperCase(), cell]));
  const rows: ParsedImportRow[] = [];
  const seenRows = new Set<number>();
  let previousItem: ParsedImportRow | null = null;
  let previousRowNumber: number | null = null;
  for (const activeSelection of ranges) {
    for (let rowNumber = activeSelection.startRow; rowNumber <= activeSelection.endRow; rowNumber += 1) {
    if (seenRows.has(rowNumber)) continue;
    seenRows.add(rowNumber);
    const hidden = sheet.hiddenRows.includes(rowNumber);
    const section = (options.sections ?? []).find((candidate) => rowNumber >= candidate.startRow && rowNumber <= candidate.endRow);
    if (previousRowNumber !== null && (rowNumber !== previousRowNumber + 1 || section?.sectionId !== previousItem?.sectionId)) previousItem = null;
    const selected = !hidden || activeSelection.includeHiddenRows;
    if (!selected) previousItem = null;
    const issues: ImportIssue[] = [];
    if (!selected) issues.push({ code: "hidden-row-excluded", severity: "warning", message: "Hidden row is excluded by the current selection." });
    if (section && !activeSelection.includedSectionIds.includes(section.sectionId)) {
      issues.push({ code: "section-excluded", severity: "warning", message: `Section “${section.title}” is excluded by the current selection.` });
    }
    const values = createBlankValues(section?.defaultCategory ?? "construction");
    const rawValues: Partial<Record<ImportField, string>> = {};
    const addresses: string[] = [];
    for (const field of Object.keys(mapping.columns) as ImportField[]) {
      const column = mapping.columns[field];
      if (!column) continue;
      const cell = resolveMappedCell(sheet, cells, rowNumber, column);
      if (cell) addresses.push(cell.address);
      const value = readMappedField(field, cell, issues);
      rawValues[field] = value.display;
      if (field === "itemCode") values.itemCode = readCode(cell, value.display, issues);
      else if (field === "description") values.description = value.display.trim();
      else if (field === "unit") values.unit = value.display.trim();
      else if (field === "notes") values.notes = value.display.trim();
      else if (field === "group") values.group = value.display.trim();
      else if (field === "costCategory") {
        const parsed = parseCategory(value.display);
        if (value.display.trim() && !parsed) issues.push({ code: "invalid-cost-category", severity: "error", message: "Cost category must be construction or other.", field });
        if (parsed) values.costCategory = parsed;
      } else if (NUMERIC_FIELDS.includes(field)) {
        const numeric = parseImportNumber(value, field, issues);
        if (field === "quantity") values.quantity = numeric;
        if (field === "unitCost") values.unitCost = numeric;
        if (field === "sourceTotal") values.sourceTotal = numeric;
      }
    }
    if ((mapping.groupSource === "section" || (mapping.groupSource === "mapped" && !values.group)) && section) values.group = section.title.trim();
    if (mapping.categorySource === "construction") values.costCategory = "construction";
    if (mapping.categorySource === "section") values.costCategory = section?.defaultCategory ?? "construction";
    const classification = classifyRow(values, rawValues, mapping, rowNumber, activeSelection, cells, issues);
    const sourceRange = toSourceRange(sheet.name, rowNumber, addresses, activeSelection);
    const row: ParsedImportRow = {
      rowId: `${sheet.name}#row-${rowNumber}`,
      locator: { sheetName: sheet.name, rowNumber, sourceRange, addresses: [...new Set(addresses)].sort(compareAddress) },
      classification,
      values,
      rawValues,
      issues,
      hidden,
      selected,
      ...(section ? { sectionId: section.sectionId } : {})
    };
    if (classification === "ambiguous" && previousItem && values.description && !values.itemCode && !values.unit && values.quantity === null && values.unitCost === null) {
      row.continuationOfRowId = previousItem.rowId;
    }
    if (classification === "item") previousItem = row;
    previousRowNumber = rowNumber;
    rows.push(row);
    }
  }
  return rows;
}

export function validateMapping(mapping: ExcelImportMapping): ImportIssue[] {
  const issues: ImportIssue[] = [];
  if (!mapping.columns.itemCode && !mapping.columns.description) {
    issues.push({ code: "missing-item-identity-mapping", severity: "error", message: "Map Item Code or Description before reviewing items." });
  }
  const seen = new Map<number, ImportField>();
  for (const field of Object.keys(mapping.columns) as ImportField[]) {
    const column = mapping.columns[field];
    if (!Number.isInteger(column) || (column ?? 0) < 1) {
      issues.push({ code: "invalid-mapping-column", severity: "error", message: `${field} must map to a physical column.`, field });
      continue;
    }
    const other = seen.get(column!);
    if (other) issues.push({ code: "duplicate-mapping-column", severity: "error", message: `Column ${column} is mapped to both ${other} and ${field}.`, field });
    else seen.set(column!, field);
  }
  return issues;
}

/** Merge explicitly selected description continuations without crossing a section or range boundary. */
export function mergeContinuationRows(rows: ParsedImportRow[], continuationRowIds: Iterable<string>): ParsedImportRow[] {
  const selected = new Set(continuationRowIds);
  const byId = new Map(rows.map((row) => [row.rowId, row]));
  const mergedInto = new Set<string>();
  const mergedParents = new Map<string, ParsedImportRow>();
  for (const row of rows) {
    if (!selected.has(row.rowId) || !row.continuationOfRowId) continue;
    const parent = byId.get(row.continuationOfRowId);
    if (!parent || parent.sectionId !== row.sectionId) continue;
    mergedInto.add(row.rowId);
    const base = mergedParents.get(parent.rowId) ?? parent;
    const contributingLocators: ImportRowLocator[] = [...(base.contributingLocators ?? [base.locator]), ...(row.contributingLocators ?? [row.locator])];
    mergedParents.set(parent.rowId, {
      ...base,
      values: { ...base.values, description: [base.values.description, row.values.description].filter(Boolean).join(" ") },
      rawValues: { ...base.rawValues, description: [base.rawValues.description, row.rawValues.description].filter(Boolean).join(" ") },
      issues: [...base.issues, ...row.issues, { code: "continuation-merged", severity: "info", message: `Description continuation from row ${row.locator.rowNumber} was merged.` }],
      locator: { ...base.locator, sourceRange: `${base.locator.sourceRange};${row.locator.sourceRange}`, addresses: [...new Set([...base.locator.addresses, ...row.locator.addresses])].sort(compareAddress) },
      contributingLocators
    });
  }
  return rows.filter((row) => !mergedInto.has(row.rowId)).map((row) => mergedParents.get(row.rowId) ?? row);
}

export function resolveMappedCell(
  sheet: ExcelWorksheetSnapshot,
  cells: Map<string, ExcelCellSnapshot>,
  rowNumber: number,
  columnNumber: number
): ExcelCellSnapshot | null {
  const direct = cells.get(address(rowNumber, columnNumber));
  if (direct) return direct;
  const merge = sheet.merges.find((candidate) => rowNumber >= candidate.start.rowNumber && rowNumber <= candidate.end.rowNumber && columnNumber >= candidate.start.columnNumber && columnNumber <= candidate.end.columnNumber);
  if (!merge) return null;
  const anchor = cells.get(merge.start.address.toUpperCase());
  if (!anchor) return null;
  // Horizontal headings may be read from their anchor. Values in vertical
  // merges are intentionally not copied into later item rows.
  if (merge.start.rowNumber !== merge.end.rowNumber && rowNumber !== merge.start.rowNumber) return null;
  return anchor;
}

export function parseImportNumber(value: { display: string; cell: ExcelCellSnapshot | null }, field: ImportField, issues: ImportIssue[]): number | null {
  const { cell, display } = value;
  if (!display.trim()) return null;
  if (cell && (cell.type === "boolean" || cell.type === "date" || cell.type === "error")) {
    issues.push({ code: cell.type === "error" ? "formula-error" : "invalid-numeric-cell", severity: "error", message: `${field} contains a ${cell.type} cell.`, field });
    return null;
  }
  const raw = display.normalize("NFC").trim();
  const monetary = field === "unitCost" || field === "sourceTotal";
  const candidate = monetary ? raw.replace(/^\$\s*/, "") : raw;
  const valid = /^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(candidate);
  if (!valid) {
    issues.push({ code: "invalid-number", severity: "error", message: `“${raw}” is not an unambiguous nonnegative number.`, field });
    return null;
  }
  const numeric = Number(candidate.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric < 0) {
    issues.push({ code: "invalid-number", severity: "error", message: `“${raw}” is outside the supported numeric range.`, field });
    return null;
  }
  return numeric;
}

function readMappedField(field: ImportField, cell: ExcelCellSnapshot | null, issues: ImportIssue[]): { display: string; cell: ExcelCellSnapshot | null } {
  if (!cell) return { display: "", cell: null };
  if (cell.hasFormula && cell.cachedValue === null && !cell.formattedText.trim()) {
    issues.push({ code: "formula-cache-missing", severity: "error", message: `Formula in ${cell.address} has no saved result.`, field });
    return { display: "", cell };
  }
  if (cell.type === "error") {
    issues.push({ code: "formula-error", severity: "error", message: `${cell.address} contains an Excel error value.`, field });
  }
  const display = cell.formattedText || valueToText(cell.cachedValue ?? cell.rawValue);
  if (cell.mergeAnchor && cell.mergeAnchor !== cell.address && field !== "description" && field !== "itemCode") {
    issues.push({ code: "vertical-merge-value", severity: "warning", message: `${cell.address} is part of a vertically merged spreadsheet field. The value appears in ${cell.mergeAnchor}, so this row has no separate value.`, field });
    return { display: "", cell };
  }
  return { display, cell };
}

function classifyRow(
  values: { itemCode: string; description: string; unit: string; quantity: number | null; unitCost: number | null; sourceTotal: number | null },
  rawValues: Partial<Record<ImportField, string>>,
  mapping: ExcelImportMapping,
  rowNumber: number,
  selection: Pick<ExcelImportSelection, "startColumn" | "endColumn">,
  cells: Map<string, ExcelCellSnapshot>,
  issues: ImportIssue[]
): ParsedImportRow["classification"] {
  const hasAny = Object.values(rawValues).some((value) => Boolean(value?.trim()));
  if (!hasAny) return "blank";
  const headerFields = Object.values(rawValues).flatMap((value) => value ? [] : []);
  void headerFields;
  const mappedLabels = Object.values(rawValues).filter((value): value is string => Boolean(value)).map((value) => value.trim().toLowerCase());
  if (mappedLabels.some((value) => /^(item code|item no\.?|item number|description|unit|units|uom|quantity|qty|unit cost|unit price|total|amount|notes|remarks)$/i.test(value))) return "repeated-header";
  if (looksLikeSummary(values.description) && !values.itemCode && values.quantity === null && values.unitCost === null) {
    issues.push({ code: "summary-row", severity: "warning", message: "Summary or fee row is excluded by default." });
    return "summary";
  }
  if (values.itemCode || values.description) {
    if (values.description && !values.itemCode && !values.unit && values.quantity === null && values.unitCost === null) return "ambiguous";
    return "item";
  }
  const physicalCells = [...cells.values()].filter((cell) => cell.rowNumber === rowNumber && cell.columnNumber >= selection.startColumn && cell.columnNumber <= selection.endColumn);
  if (physicalCells.length === 1) return "section-heading";
  return "ambiguous";
}

function createBlankValues(category: ProjectCostCategory): ParsedImportValues {
  return { itemCode: "", description: "", unit: "", quantity: null, unitCost: null, sourceTotal: null, notes: "", group: "", costCategory: category };
}

function parseCategory(value: string): ProjectCostCategory | null {
  const normalized = value.trim().toLowerCase();
  return normalized === "construction" || normalized === "other" ? normalized : null;
}

function readCode(cell: ExcelCellSnapshot | null, display: string, issues: ImportIssue[]): string {
  if (!cell) return "";
  if (cell.type === "date" || cell.type === "boolean" || cell.type === "error") {
    issues.push({ code: "invalid-item-code-cell", severity: "error", message: `${cell.address} cannot be used as an item code.` , field: "itemCode" });
    return "";
  }
  if (/e[+-]?\d+/i.test(display)) {
    issues.push({ code: "scientific-item-code", severity: "error", message: `${cell.address} uses scientific notation; correct it before matching the item code.`, field: "itemCode" });
  }
  // Formatted text is the only safe way to retain supported zero padding.
  return (cell.formattedText || display).trim();
}

function valueToText(value: unknown): string {
  return value === null || value === undefined ? "" : typeof value === "string" ? value : String(value);
}

function toSourceRange(sheetName: string, rowNumber: number, addresses: string[], selection: Pick<ExcelImportSelection, "startColumn" | "endColumn">): string {
  if (addresses.length === 0) return `${sheetName}!${address(rowNumber, selection.startColumn)}:${address(rowNumber, selection.endColumn)}`;
  const sorted = addresses.map(parseAddress).filter(Boolean).sort((left, right) => left!.column - right!.column);
  return `${sheetName}!${sorted[0]!.address}:${sorted[sorted.length - 1]!.address}`;
}

function address(row: number, column: number): string {
  let value = "";
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return `${value}${row}`;
}

function parseAddress(value: string): { address: string; row: number; column: number } | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(value);
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  return { address: value.toUpperCase(), row: Number(match[2]), column };
}

function compareAddress(left: string, right: string): number {
  const a = parseAddress(left)!;
  const b = parseAddress(right)!;
  return a.column - b.column || a.row - b.row;
}

function looksLikeSummary(value: string): boolean {
  return /\b(subtotal|grand total|contingency|engineering fee|fee summary|bid total)\b/i.test(value);
}
