import * as XLSX from "xlsx";
import type {
  CellObject,
  Range,
  WorkBook,
  WorkSheet
} from "xlsx";
import {
  DEFAULT_WORKBOOK_READ_LIMITS,
  type ExcelCellSnapshot,
  type ExcelCellType,
  type ExcelCellValue,
  type ExcelMergeSnapshot,
  type ExcelSheetVisibility,
  type ExcelWorkbookSnapshot,
  type ExcelWorksheetSnapshot,
  type ReadWorkbookOptions,
  type WorkbookReadError,
  type WorkbookReadLimits
} from "./types";

const ADDRESS_PATTERN = /^[A-Z]+[1-9][0-9]*$/i;

/** Error thrown by the reader with a serializable code suitable for a worker response. */
export class WorkbookReadException extends Error {
  readonly details: WorkbookReadError;

  constructor(details: WorkbookReadError) {
    super(details.message);
    this.name = "WorkbookReadException";
    this.details = details;
  }
}

/**
 * Parse one .xlsx file into a sparse, serializable workbook snapshot.
 *
 * SheetJS is intentionally imported by this adapter rather than by the UI.
 * The import worker is the production entry point, so the parser bundle is
 * loaded only when an import worker is created.
 */
export function readWorkbook(
  input: ArrayBuffer | Uint8Array,
  options: ReadWorkbookOptions
): ExcelWorkbookSnapshot {
  const limits = normalizeLimits(options.limits);
  const fileName = options.fileName.trim();
  const startedAt = Date.now();

  assertNotCancelled(options.signal);
  if (!/\.xlsx$/i.test(fileName)) {
    throw failure("unsupported-extension", `Only .xlsx workbooks can be imported. Received "${fileName || "(unnamed file)"}".`);
  }

  const bytes = toBytes(input);
  if (bytes.byteLength > limits.maxFileBytes) {
    throw failure(
      "file-too-large",
      `The workbook is ${(bytes.byteLength / (1024 * 1024)).toFixed(1)} MiB. The import limit is ${formatMiB(limits.maxFileBytes)} MiB.`
    );
  }
  if (!isZipContainer(bytes)) {
    throw failure("unsupported-format", "The selected file is not an .xlsx ZIP workbook. Save it as an Excel .xlsx file and try again.");
  }

  options.onProgress?.({ phase: "reading", populatedCellCount: 0 });
  let workbook: WorkBook;
  try {
    workbook = XLSX.read(bytes, {
      type: "array",
      cellDates: true,
      cellFormula: true,
      cellNF: true,
      cellText: true,
      cellStyles: true,
      dense: false,
      nodim: true,
      // Do not request sheet stubs. Empty cells are represented by merge and
      // range metadata, while stub creation can inflate sparse workbooks.
      sheetStubs: false
    });
  } catch (error) {
    throw mapParserError(error);
  }

  assertNotCancelled(options.signal);
  checkTimeout(startedAt, limits.maxParseMilliseconds);

  const sheetNames = Array.isArray(workbook.SheetNames) ? workbook.SheetNames : [];
  if (sheetNames.length > limits.maxWorksheets) {
    throw failure(
      "too-many-worksheets",
      `The workbook contains ${sheetNames.length} worksheets. The import limit is ${limits.maxWorksheets}.`
    );
  }

  const sheets: ExcelWorksheetSnapshot[] = [];
  let populatedCellCount = 0;
  for (let sheetIndex = 0; sheetIndex < sheetNames.length; sheetIndex += 1) {
    assertNotCancelled(options.signal);
    checkTimeout(startedAt, limits.maxParseMilliseconds);

    const sheetName = sheetNames[sheetIndex] ?? "";
    const sheet = workbook.Sheets?.[sheetName];
    if (!sheet) {
      throw failure("parse-failed", `Worksheet "${sheetName}" was listed but could not be read.`);
    }
    options.onProgress?.({
      phase: "sheet",
      sheetName,
      sheetIndex,
      sheetCount: sheetNames.length,
      populatedCellCount
    });
    const snapshot = readWorksheet(
      workbook,
      sheet,
      sheetName,
      sheetIndex,
      limits,
      startedAt,
      options.signal,
      populatedCellCount
    );
    sheets.push(snapshot);
    populatedCellCount += snapshot.populatedCellCount;
    if (populatedCellCount > limits.maxPopulatedCells) {
      throw failure(
        "too-many-cells",
        `The workbook contains more than ${limits.maxPopulatedCells.toLocaleString()} populated cells. Select a smaller workbook.`
      );
    }
    options.onProgress?.({
      phase: "sheet",
      sheetName,
      sheetIndex,
      sheetCount: sheetNames.length,
      populatedCellCount
    });
  }

  assertNotCancelled(options.signal);
  checkTimeout(startedAt, limits.maxParseMilliseconds);
  return {
    fileName,
    workbookType: typeof workbook.bookType === "string" ? workbook.bookType : "xlsx",
    sheets,
    sheetCount: sheets.length,
    populatedCellCount,
    hasDefinedNames: (workbook.Workbook?.Names?.length ?? 0) > 0
  };
}

export function toWorkbookReadError(error: unknown): WorkbookReadError {
  if (error instanceof WorkbookReadException) {
    return error.details;
  }
  const message = error instanceof Error ? error.message : String(error);
  return { code: "parse-failed", message: message || "The workbook could not be parsed." };
}

function readWorksheet(
  workbook: WorkBook,
  sheet: WorkSheet,
  sheetName: string,
  sheetIndex: number,
  limits: WorkbookReadLimits,
  startedAt: number,
  signal: AbortSignal | undefined,
  priorCellCount: number
): ExcelWorksheetSnapshot {
  const merges = readMerges(sheet);
  const cells: ExcelCellSnapshot[] = [];
  const cellKeys = Object.keys(sheet)
    .filter((key) => ADDRESS_PATTERN.test(key))
    .sort(compareCellAddresses);

  for (let index = 0; index < cellKeys.length; index += 1) {
    if (index % 512 === 0) {
      assertNotCancelled(signal);
      checkTimeout(startedAt, limits.maxParseMilliseconds);
    }
    const address = cellKeys[index];
    const cell = sheet[address] as CellObject | undefined;
    if (!cell || typeof cell !== "object") {
      continue;
    }
    const coordinate = XLSX.utils.decode_cell(address);
    const populatedCellCount = priorCellCount + cells.length + 1;
    if (populatedCellCount > limits.maxPopulatedCells) {
      throw failure(
        "too-many-cells",
        `The workbook contains more than ${limits.maxPopulatedCells.toLocaleString()} populated cells. Select a smaller workbook.`
      );
    }
    cells.push(readCell(address, coordinate.r, coordinate.c, cell, merges));
  }

  const declaredRange = readRange(sheet["!ref"]);
  let rowCount = declaredRange ? declaredRange.e.r + 1 : 0;
  let columnCount = declaredRange ? declaredRange.e.c + 1 : 0;
  for (const cell of cells) {
    rowCount = Math.max(rowCount, cell.rowNumber);
    columnCount = Math.max(columnCount, cell.columnNumber);
  }

  return {
    name: sheetName,
    visibility: sheetVisibility(workbook, sheetIndex),
    range: typeof sheet["!ref"] === "string" ? sheet["!ref"] : null,
    populatedCellCount: cells.length,
    rowCount,
    columnCount,
    cells,
    merges,
    hiddenRows: hiddenRows(sheet),
    hiddenColumns: hiddenColumns(sheet),
    printAreas: printAreasForSheet(workbook, sheetName, sheetIndex)
  };
}

function readCell(
  address: string,
  zeroBasedRow: number,
  zeroBasedColumn: number,
  cell: CellObject,
  merges: ExcelMergeSnapshot[]
): ExcelCellSnapshot {
  const rawValue = serializableValue(cell.v);
  const hasFormula = typeof cell.f === "string" && cell.f.length > 0;
  const type = hasFormula && rawValue === null ? "unknown" : cellType(cell.t);
  const mergeAnchor = mergeAnchorForCell(zeroBasedRow, zeroBasedColumn, merges);
  return {
    address,
    rowNumber: zeroBasedRow + 1,
    columnNumber: zeroBasedColumn + 1,
    columnLabel: XLSX.utils.encode_col(zeroBasedColumn),
    type,
    rawValue,
    formattedText: formattedText(cell, rawValue),
    formula: hasFormula ? cell.f ?? null : null,
    hasFormula,
    cachedValue: hasFormula ? rawValue : null,
    numberFormat: cell.z === undefined || cell.z === null ? null : String(cell.z),
    mergeAnchor
  };
}

function readMerges(sheet: WorkSheet): ExcelMergeSnapshot[] {
  const rawMerges = Array.isArray(sheet["!merges"]) ? sheet["!merges"] as Range[] : [];
  return rawMerges
    .filter((merge) => isValidRange(merge))
    .map((merge) => ({
      range: XLSX.utils.encode_range(merge),
      start: addressFor(merge.s.r, merge.s.c),
      end: addressFor(merge.e.r, merge.e.c)
    }))
    .sort((left, right) => compareCoordinates(left.start, right.start));
}

function mergeAnchorForCell(row: number, column: number, merges: ExcelMergeSnapshot[]): string | null {
  for (const merge of merges) {
    if (
      row >= merge.start.rowNumber - 1 &&
      row <= merge.end.rowNumber - 1 &&
      column >= merge.start.columnNumber - 1 &&
      column <= merge.end.columnNumber - 1
    ) {
      return merge.start.address;
    }
  }
  return null;
}

function hiddenRows(sheet: WorkSheet): number[] {
  const rows = Array.isArray(sheet["!rows"]) ? sheet["!rows"] as Array<{ hidden?: boolean }> : [];
  return rows.flatMap((row, index) => row?.hidden ? [index + 1] : []);
}

function hiddenColumns(sheet: WorkSheet): number[] {
  const columns = Array.isArray(sheet["!cols"]) ? sheet["!cols"] as Array<{ hidden?: boolean }> : [];
  return columns.flatMap((column, index) => column?.hidden ? [index + 1] : []);
}

function printAreasForSheet(workbook: WorkBook, sheetName: string, sheetIndex: number): string[] {
  const names = workbook.Workbook?.Names ?? [];
  return names
    .filter((name) => name.Name.toLowerCase() === "_xlnm.print_area")
    .filter((name) => name.Sheet === undefined || name.Sheet === sheetIndex || name.Ref.includes(quotedSheetName(sheetName)))
    .map((name) => name.Ref)
    .filter((ref): ref is string => typeof ref === "string" && ref.length > 0);
}

function quotedSheetName(sheetName: string): string {
  return `'${sheetName.replace(/'/g, "''")}'!`;
}

function sheetVisibility(workbook: WorkBook, sheetIndex: number): ExcelSheetVisibility {
  const hidden = workbook.Workbook?.Sheets?.[sheetIndex]?.Hidden ?? 0;
  return hidden === 2 ? "veryHidden" : hidden === 1 ? "hidden" : "visible";
}

function cellType(type: CellObject["t"]): ExcelCellType {
  switch (type) {
    case "s": return "string";
    case "n": return "number";
    case "b": return "boolean";
    case "d": return "date";
    case "e": return "error";
    case "z": return "blank";
    default: return "unknown";
  }
}

function serializableValue(value: unknown): ExcelCellValue {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return String(value);
}

function formattedText(cell: CellObject, rawValue: ExcelCellValue): string {
  if (typeof cell.w === "string") return cell.w;
  if (rawValue === null) return "";
  return String(rawValue);
}

function readRange(value: unknown): Range | null {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  try {
    const range = XLSX.utils.decode_range(value);
    return isValidRange(range) ? range : null;
  } catch {
    return null;
  }
}

function isValidRange(range: Range | undefined): range is Range {
  return Boolean(
    range &&
    Number.isInteger(range.s?.r) && Number.isInteger(range.s?.c) &&
    Number.isInteger(range.e?.r) && Number.isInteger(range.e?.c) &&
    range.s.r >= 0 && range.s.c >= 0 && range.e.r >= range.s.r && range.e.c >= range.s.c
  );
}

function addressFor(row: number, column: number): { rowNumber: number; columnNumber: number; address: string } {
  return {
    rowNumber: row + 1,
    columnNumber: column + 1,
    address: XLSX.utils.encode_cell({ r: row, c: column })
  };
}

function compareCellAddresses(left: string, right: string): number {
  const leftCell = XLSX.utils.decode_cell(left);
  const rightCell = XLSX.utils.decode_cell(right);
  return compareCoordinates(leftCell, rightCell);
}

function compareCoordinates(
  left: { r?: number; c?: number; rowNumber?: number; columnNumber?: number },
  right: { r?: number; c?: number; rowNumber?: number; columnNumber?: number }
): number {
  const leftRow = left.r ?? (left.rowNumber ?? 0) - 1;
  const rightRow = right.r ?? (right.rowNumber ?? 0) - 1;
  const leftColumn = left.c ?? (left.columnNumber ?? 0) - 1;
  const rightColumn = right.c ?? (right.columnNumber ?? 0) - 1;
  return leftRow - rightRow || leftColumn - rightColumn;
}

function toBytes(input: ArrayBuffer | Uint8Array): Uint8Array {
  return input instanceof Uint8Array
    ? input
    : new Uint8Array(input);
}

function isZipContainer(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b &&
    (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07) &&
    (bytes[3] === 0x04 || bytes[3] === 0x06 || bytes[3] === 0x08);
}

function normalizeLimits(overrides: Partial<WorkbookReadLimits> | undefined): WorkbookReadLimits {
  const limits = { ...DEFAULT_WORKBOOK_READ_LIMITS, ...overrides };
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw failure("parse-failed", `Workbook read limit ${key} must be a positive finite number.`);
    }
  }
  return limits;
}

function assertNotCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw failure("cancelled", "Workbook import was cancelled.");
  }
}

function checkTimeout(startedAt: number, maxMilliseconds: number): void {
  if (Date.now() - startedAt > maxMilliseconds) {
    throw failure("parse-timeout", `Workbook parsing exceeded the ${maxMilliseconds.toLocaleString()} ms limit.`);
  }
}

function mapParserError(error: unknown): WorkbookReadException {
  const causeMessage = error instanceof Error ? error.message : String(error);
  const normalized = causeMessage.toLowerCase();
  if (normalized.includes("password") || normalized.includes("encrypted")) {
    return failure(
      "encrypted-workbook",
      "This workbook is password-protected or encrypted. Remove protection and save a new .xlsx file before importing.",
      causeMessage
    );
  }
  if (normalized.includes("unsupported") || normalized.includes("format")) {
    return failure(
      "unsupported-format",
      "SheetJS could not read this workbook format. Save the file as a standard .xlsx workbook and try again.",
      causeMessage
    );
  }
  return failure("parse-failed", "The workbook could not be parsed. Open it in Excel, repair or resave it, and try again.", causeMessage);
}

function failure(
  code: WorkbookReadError["code"],
  message: string,
  causeMessage?: string
): WorkbookReadException {
  return new WorkbookReadException({ code, message, causeMessage });
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(0)} MiB`;
}
