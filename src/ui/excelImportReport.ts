import type { ExcelImportReadyDraft } from "./excelImportController";
import type { MatchedImportRow, ResolvedImportRow } from "../projects/excelImport/types";

const REPORT_HEADERS = ["Sheet", "Row", "Item Code", "Description", "Outcome", "Quantity", "Unit Cost", "Reason"] as const;

interface ImportStatusRow {
  sheet: string;
  row: number;
  itemCode: string;
  description: string;
  outcome: string;
  quantity: number | null;
  unitCost: number | null;
  reason: string;
}

export function buildExcelImportReportCsv(draft: ExcelImportReadyDraft, committed = false): string {
  const rowsById = new Map(draft.rows.map((row) => [row.rowId, row]));
  const plan = draft.existingItemPlan;
  const reportRows: ImportStatusRow[] = [];
  for (const resolved of draft.resolvedRows) {
    const source = rowsById.get(resolved.rowId);
    if (!source || !isItemCandidate(source)) continue;
    const match = plan?.matches.find((candidate) => candidate.rowId === resolved.rowId);
    const skipped = match?.action === "skip" || Boolean(plan?.skippedRowIds.includes(resolved.rowId));
    const update = match?.action === "update"
      ? plan?.updates.find((line) => line.lineItemId === match.targetLineItemId) ?? null
      : null;
    const accepted = (resolved.outcome === "imported" || resolved.outcome === "imported-incomplete") && !skipped;
    const line = update ?? (accepted ? resolved.lineItem : null);
    reportRows.push({
      sheet: source.locator.sheetName,
      row: source.locator.rowNumber,
      itemCode: line?.itemCode || source.values.itemCode || source.rawValues.itemCode || "",
      description: line?.description || source.values.description || source.rawValues.description || "",
      outcome: accepted
        ? update ? committed ? "Updated" : "Will update" : committed ? "Imported" : "Will import"
        : committed ? "Not imported" : "Will not import",
      quantity: accepted ? line?.quantity ?? null : source.values.quantity,
      unitCost: accepted ? line?.preferredUnitCost ?? null : source.values.unitCost,
      reason: accepted ? "" : omissionReason(draft, source, resolved, skipped)
    });
  }
  return `${[REPORT_HEADERS.join(","), ...reportRows.map((row) => [
    row.sheet, row.row, row.itemCode, row.description, row.outcome, row.quantity, row.unitCost, row.reason
  ].map(csvCell).join(","))].join("\r\n")}\r\n`;
}

export function downloadExcelImportReport(draft: ExcelImportReadyDraft, committed = false): void {
  const blob = new Blob([buildExcelImportReportCsv(draft, committed)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${sanitizeFilename(draft.fileName)}-${committed ? "import-status" : "review-preview"}.csv`;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isItemCandidate(row: MatchedImportRow): boolean {
  if (row.classification === "item") return true;
  return row.classification === "ambiguous"
    && Boolean(row.values.itemCode.trim() || row.values.description.trim() || row.rawValues.itemCode?.trim() || row.rawValues.description?.trim());
}

function omissionReason(draft: ExcelImportReadyDraft, source: MatchedImportRow, resolved: ResolvedImportRow, skippedExisting: boolean): string {
  if (skippedExisting) return "Kept the existing Project item";
  if (draft.decisions[resolved.rowId]?.leftUnresolved) return "Needs review";
  if (draft.decisions[resolved.rowId]?.action === "exclude") return "Skipped during review";
  if (!source.selected) return "Outside selected data";
  const issues = [...resolved.issues, ...source.matchIssues, ...source.issues];
  const issue = issues.find((candidate) => candidate.severity === "error")
    ?? issues.find((candidate) => candidate.severity === "warning");
  return issue?.message ?? "Could not be imported";
}

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/u.test(text) && !/^-[0-9]+(?:\.[0-9]+)?$/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

function sanitizeFilename(value: string): string {
  return value.trim().replace(/\.[^.]+$/u, "").replace(/[^a-z0-9]+/giu, "-").replace(/^-+|-+$/gu, "").toLowerCase() || "workbook";
}
