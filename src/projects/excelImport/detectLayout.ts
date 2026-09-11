import type {
  ExcelCellSnapshot,
  ExcelHeaderCandidate,
  ExcelLayoutDetection,
  ExcelRegionSuggestion,
  ExcelSectionSuggestion,
  ExcelWorksheetSnapshot,
  ImportField
} from "./types";

const HEADER_ALIASES: Record<ImportField, readonly string[]> = {
  itemCode: ["item code", "item no", "item number", "contract item no", "pay item"],
  description: ["item description", "description", "work description"],
  unit: ["unit", "units", "uom"],
  quantity: ["quantity", "qty", "estimated quantity"],
  unitCost: ["unit cost", "unit price", "preferred unit cost"],
  sourceTotal: ["extended cost", "total item cost", "amount", "total"],
  notes: ["notes", "line notes", "remarks"],
  group: ["group", "section", "category"],
  costCategory: ["cost category"]
};

export function normalizeHeaderLabel(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/g, " ").replace(/[,:;|]+$/g, "").toLowerCase();
}

export function suggestedImportFields(value: string): ImportField[] {
  const label = normalizeHeaderLabel(value);
  if (!label) return [];
  return (Object.keys(HEADER_ALIASES) as ImportField[]).filter((field) => HEADER_ALIASES[field].includes(label));
}

export function detectLayout(sheet: ExcelWorksheetSnapshot): ExcelLayoutDetection {
  const populated = sheet.cells.filter((cell) => cell.type !== "blank" && hasText(cell));
  const parsedRange = parseRange(sheet.range);
  const minRow = populated.reduce((value, cell) => Math.min(value, cell.rowNumber), parsedRange.startRow ?? 1);
  const maxRow = populated.reduce((value, cell) => Math.max(value, cell.rowNumber), parsedRange.endRow ?? minRow);
  const minColumn = populated.reduce((value, cell) => Math.min(value, cell.columnNumber), parsedRange.startColumn ?? 1);
  const maxColumn = populated.reduce((value, cell) => Math.max(value, cell.columnNumber), parsedRange.endColumn ?? minColumn);
  const rowMap = groupRows(sheet.cells);
  const headerCandidates = detectHeaderCandidates(rowMap, minRow, maxRow, minColumn, maxColumn);
  const topScore = headerCandidates[0]?.score ?? 0;
  const topTied = headerCandidates.filter((candidate) => candidate.score === topScore && topScore > 0);
  const suggestedHeaderRow = topTied.length === 1 && topScore >= 2 ? topTied[0].rowNumber : null;
  const sections = detectSections(sheet, rowMap, minRow, maxRow, minColumn, maxColumn, suggestedHeaderRow);
  const region: ExcelRegionSuggestion = {
    regionId: `${sheet.name}#${minRow}-${maxRow}:${minColumn}-${maxColumn}`,
    sheetName: sheet.name,
    startRow: minRow,
    endRow: maxRow,
    startColumn: minColumn,
    endColumn: maxColumn,
    headerCandidates,
    suggestedHeaderRow,
    sections,
    hiddenRowCount: sheet.hiddenRows.filter((row) => row >= minRow && row <= maxRow).length,
    hiddenColumnCount: sheet.hiddenColumns.filter((column) => column >= minColumn && column <= maxColumn).length,
    printArea: sheet.printAreas[0] ?? null,
    confidence: suggestedHeaderRow === null ? "review" : "suggested"
  };
  const warnings: string[] = [];
  if (sheet.visibility !== "visible") warnings.push("This worksheet is hidden and requires explicit selection.");
  if (headerCandidates.length === 0) warnings.push("No row with two or more recognized headers was found; map columns manually.");
  if (topTied.length > 1) warnings.push("More than one row may contain column labels. In Step 3, choose the row that contains the item-table headings.");
  if (sections.some((section) => section.requiresAlternativeChoice)) {
    warnings.push("Alternative sections require explicit inclusion choices.");
  }
  return { sheetName: sheet.name, regions: [region], warnings };
}

export function detectWorkbookLayouts(sheets: ExcelWorksheetSnapshot[]): ExcelLayoutDetection[] {
  return sheets.map(detectLayout);
}

function detectHeaderCandidates(
  rowMap: Map<number, ExcelCellSnapshot[]>,
  minRow: number,
  maxRow: number,
  minColumn: number,
  maxColumn: number
): ExcelHeaderCandidate[] {
  const result: ExcelHeaderCandidate[] = [];
  for (let rowNumber = minRow; rowNumber <= maxRow; rowNumber += 1) {
    const row = rowMap.get(rowNumber) ?? [];
    const labels: Record<number, string> = {};
    const recognizedFields = new Set<ImportField>();
    for (const cell of row) {
      if (cell.columnNumber < minColumn || cell.columnNumber > maxColumn) continue;
      const label = cell.formattedText || stringValue(cell.rawValue);
      if (!label.trim()) continue;
      labels[cell.columnNumber] = label;
      suggestedImportFields(label).forEach((field) => recognizedFields.add(field));
    }
    if (recognizedFields.size < 2) continue;
    const following = [...Array(4)].map((_, offset) => rowMap.get(rowNumber + offset + 1) ?? []);
    const plausible = following.filter((nextRow) => nextRow.some((cell) => hasText(cell))).length;
    const score = recognizedFields.size * 10 + Math.min(plausible, 3);
    result.push({ rowNumber, score, recognizedFields: [...recognizedFields].sort(), labels, tied: false });
  }
  result.sort((left, right) => right.score - left.score || left.rowNumber - right.rowNumber);
  const topScore = result[0]?.score;
  return result.map((candidate) => ({ ...candidate, tied: candidate.score === topScore }));
}

function detectSections(
  sheet: ExcelWorksheetSnapshot,
  rowMap: Map<number, ExcelCellSnapshot[]>,
  minRow: number,
  maxRow: number,
  minColumn: number,
  maxColumn: number,
  headerRow: number | null
): ExcelSectionSuggestion[] {
  const headings: Array<{ rowNumber: number; title: string }> = [];
  for (let rowNumber = minRow; rowNumber <= maxRow; rowNumber += 1) {
    if (rowNumber === headerRow) continue;
    const cells = (rowMap.get(rowNumber) ?? []).filter((cell) => cell.columnNumber >= minColumn && cell.columnNumber <= maxColumn && hasText(cell));
    if (cells.length !== 1) continue;
    const cell = cells[0];
    const title = (cell.formattedText || stringValue(cell.rawValue)).trim();
    if (!title || suggestedImportFields(title).length > 0 || looksLikeSummary(title)) continue;
    const isMergedHeading = cell.mergeAnchor === cell.address || sheet.merges.some((merge) => merge.start.address === cell.address && merge.end.columnNumber > merge.start.columnNumber);
    const uppercaseHeading = title.length <= 80 && title === title.toUpperCase() && /[A-Z]/.test(title);
    const separatedHeading = !(rowMap.get(rowNumber - 1) ?? []).some((candidate) => hasText(candidate));
    if (isMergedHeading || uppercaseHeading || separatedHeading) headings.push({ rowNumber, title });
  }
  const sections: ExcelSectionSuggestion[] = [];
  headings.forEach((heading, index) => {
    const startRow = Math.min(maxRow, heading.rowNumber + 1);
    const endRow = Math.max(startRow, index + 1 < headings.length ? headings[index + 1].rowNumber - 1 : maxRow);
    const normalized = heading.title.normalize("NFC").toLowerCase();
    const alternative = /\balternat(?:e|ive)\b/.test(normalized);
    sections.push({
      sectionId: `${sheet.name}#section-${heading.rowNumber}`,
      startRow,
      endRow,
      title: heading.title,
      defaultCategory: "construction",
      requiresAlternativeChoice: alternative,
      includedByDefault: !alternative
    });
  });
  return sections;
}

function groupRows(cells: ExcelCellSnapshot[]): Map<number, ExcelCellSnapshot[]> {
  const rows = new Map<number, ExcelCellSnapshot[]>();
  cells.forEach((cell) => {
    const row = rows.get(cell.rowNumber) ?? [];
    row.push(cell);
    rows.set(cell.rowNumber, row);
  });
  rows.forEach((row) => row.sort((left, right) => left.columnNumber - right.columnNumber));
  return rows;
}

function hasText(cell: ExcelCellSnapshot): boolean {
  return cell.rawValue !== null || Boolean(cell.formattedText.trim()) || Boolean(cell.formula);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : value === null || value === undefined ? "" : String(value);
}

function looksLikeSummary(value: string): boolean {
  return /\b(subtotal|grand total|contingency|engineering fee|fee summary|bid total)\b/i.test(value);
}

function parseRange(range: string | null): { startRow: number | null; endRow: number | null; startColumn: number | null; endColumn: number | null } {
  if (!range) return { startRow: null, endRow: null, startColumn: null, endColumn: null };
  const parts = range.split(":").map(parseAddress);
  if (parts.some((part) => !part)) return { startRow: null, endRow: null, startColumn: null, endColumn: null };
  const end = parts[1] ?? parts[0]!;
  return { startRow: parts[0]!.row, endRow: end.row, startColumn: parts[0]!.column, endColumn: end.column };
}

function parseAddress(value: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(value.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}
