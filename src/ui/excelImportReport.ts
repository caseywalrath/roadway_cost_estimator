import type { ExcelImportReadyDraft } from "./excelImportController";
import type { MatchedImportRow, ResolvedImportRow } from "../projects/excelImport/types";

const REPORT_HEADERS = [
  "file",
  "sheet",
  "original row",
  "original range",
  "snippet",
  "outcome",
  "reason codes/text",
  "original item code",
  "original description",
  "original unit",
  "original quantity",
  "original unit cost",
  "original source total",
  "original group",
  "original category",
  "original notes",
  "final item code",
  "final description",
  "final unit",
  "final quantity",
  "final unit cost",
  "final identity",
  "group",
  "category",
  "final notes",
  "recalculated total",
  "difference",
  "resulting line id"
] as const;

export function buildExcelImportReportCsv(draft: ExcelImportReadyDraft): string {
  const rowsById = new Map(draft.rows.map((row) => [row.rowId, row]));
  const output = [REPORT_HEADERS.map(csvCell).join(",")];
  for (const result of draft.resolvedRows) {
    const row = rowsById.get(result.rowId);
    if (!row) continue;
    output.push(reportRow(draft.fileName, row, result).map(csvCell).join(","));
  }
  return `${output.join("\r\n")}\r\n`;
}

export function downloadExcelImportReport(draft: ExcelImportReadyDraft): void {
  const blob = new Blob([buildExcelImportReportCsv(draft)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(draft.fileName)}-import-report.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function reportRow(fileName: string, row: MatchedImportRow, result: ResolvedImportRow): Array<string | number | null> {
  const line = result.lineItem;
  const original = row.values;
  const reasons = result.issues.map((issue) => `${issue.code}: ${issue.message}`).join(" | ");
  const snippet = original.description.trim()
    || original.itemCode.trim()
    || row.rawValues.description
    || row.rawValues.itemCode
    || Object.values(row.rawValues).find((value) => value?.trim())
    || "";
  return [
    fileName,
    row.locator.sheetName,
    row.locator.rowNumber,
    row.locator.sourceRange,
    snippet,
    result.outcome,
    reasons,
    original.itemCode,
    original.description,
    original.unit,
    original.quantity,
    original.unitCost,
    original.sourceTotal,
    original.group,
    original.costCategory,
    row.values.notes,
    line?.itemCode ?? "",
    line?.description ?? "",
    line?.unit ?? "",
    line?.quantity ?? null,
    line?.preferredUnitCost ?? null,
    line?.agencyItemId ?? "",
    line?.group ?? original.group,
    line?.costCategory ?? original.costCategory,
    line?.notes ?? "",
    result.recalculatedTotal,
    result.sourceTotalDifference,
    line?.lineItemId ?? ""
  ];
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Prefix formula-like text so opening the diagnostic report in Excel cannot execute it.
  if (/^[=+\-@]/u.test(text) && !/^-[0-9]+(?:\.[0-9]+)?$/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/\.[^.]+$/u, "").replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/gu, "").toLowerCase() || "workbook";
}
