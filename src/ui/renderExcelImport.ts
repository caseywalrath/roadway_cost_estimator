import type { StateConfig } from "../data/schema";
import type {
  ExcelImportMapping,
  ExcelImportSelection,
  ExcelLayoutDetection,
  ExcelRegionSuggestion,
  ExcelWorkbookSnapshot,
  ImportField,
  ImportResolutionAction,
  ImportRowDecision,
  MatchedImportRow
} from "../projects/excelImport/types";

export type ExcelImportStage = "file" | "sheet" | "mapping" | "review" | "result";
export type ExcelImportReviewFilter = "all" | "needs-review" | "ready" | "excluded";
export type ExcelImportReviewIssueFilter = "all" | "description" | "unit" | "missing" | "allowance";

export interface ExcelImportConfirmationSummary {
  destinationLabel: string;
  keepsExistingItems: boolean;
  importedCount: number;
  skippedCount: number;
  skippedReasons: Array<{ label: string; count: number }>;
  constructionCost: number;
  otherCost: number;
  hasOtherCosts: boolean;
  sourceTotalComparison: {
    comparedItemCount: number;
    recalculatedMinusSource: number;
  } | null;
}

export interface ExcelImportViewModel {
  stage: ExcelImportStage;
  fileName: string | null;
  workbook: ExcelWorkbookSnapshot | null;
  detections: ExcelLayoutDetection[];
  selectedSheetName: string | null;
  selectedRegionId: string | null;
  selection: ExcelImportSelection | null;
  mapping: ExcelImportMapping | null;
  advancedSettingsOpen: boolean;
  rows: MatchedImportRow[];
  decisions: Record<string, ImportRowDecision>;
  reviewFilter: ExcelImportReviewFilter;
  reviewIssueFilter: ExcelImportReviewIssueFilter;
  reviewPage: number;
  selectedReviewRowIds: string[];
  readStatus: "idle" | "reading" | "ready" | "error";
  progressText: string;
  fileSize: number | null;
  errorMessage: string | null;
  destinationState: string;
  destinationAgencyId: string;
  destinationProjectMode: "active" | "new";
  newProjectName: string;
  confirmation: ExcelImportConfirmationSummary | null;
  resultMessage: string | null;
  commitStatus: "idle" | "committing" | "committed" | "failed";
  commitMessage: string | null;
}

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  itemCode: "Item Code",
  description: "Description",
  unit: "Unit",
  quantity: "Quantity",
  unitCost: "Unit cost",
  sourceTotal: "Extended cost",
  notes: "Notes",
  group: "Project group",
  costCategory: "Cost category"
};

const REVIEW_PAGE_SIZE = 50;
const PRIMARY_MAPPING_FIELDS: readonly ImportField[] = ["itemCode", "description", "unit", "quantity", "unitCost", "notes"];

export function renderExcelImportWizard(
  view: ExcelImportViewModel,
  states: StateConfig[],
  activeProjectLabel: string | null
): string {
  return `<section class="panel-block excel-import-wizard" data-excel-import-wizard aria-labelledby="excel-import-title">
    <div class="excel-import-heading">
      <div>
        <p class="eyebrow">Project Actions</p>
        <h2 id="excel-import-title" tabindex="-1">Import From Excel</h2>
        <p class="muted">Choose a workbook, confirm its data, and review any items that need a decision before importing them into the Project.</p>
      </div>
      <button type="button" class="secondary-button" data-excel-import-cancel>${view.stage === "result" && view.commitStatus === "committed" ? "Close" : "Cancel import"}</button>
    </div>
    ${renderStepIndicator(view.stage)}
    ${view.errorMessage ? `<p class="excel-import-error" role="alert" data-excel-import-error>${escapeHtml(view.errorMessage)}</p>` : ""}
    ${renderStage(view, states, activeProjectLabel)}
  </section>`;
}

function renderStage(view: ExcelImportViewModel, states: StateConfig[], activeProjectLabel: string | null): string {
  switch (view.stage) {
    case "file": return renderFileStage(view, states, activeProjectLabel);
    case "sheet": return renderSheetStage(view);
    case "mapping": return renderMappingStage(view);
    case "review": return renderReviewStage(view, states);
    case "result": return renderResultStage(view);
  }
}

function renderStepIndicator(stage: ExcelImportStage): string {
  const steps: Array<[ExcelImportStage, string]> = [
    ["file", "Choose file"],
    ["sheet", "Choose data"],
    ["mapping", "Match columns"],
    ["review", "Review items"],
    ["result", "Confirm import"]
  ];
  const currentIndex = steps.findIndex(([value]) => value === stage);
  return `<ol class="excel-import-steps" aria-label="Excel import steps">${steps.map(([value, label], index) => {
    const complete = index < currentIndex;
    const current = index === currentIndex;
    return `<li class="${current ? "is-current" : complete ? "is-complete" : ""}"><button type="button" data-excel-import-step="${value}" ${complete ? "" : "disabled"} ${current ? 'aria-current="step"' : ""}><span>${index + 1}</span><span>${escapeHtml(label)}</span></button></li>`;
  }).join("")}</ol>`;
}

function renderFileStage(view: ExcelImportViewModel, states: StateConfig[], activeProjectLabel: string | null): string {
  return `<div class="excel-import-stage" data-excel-import-stage="file">
    <section class="excel-import-file-choice" aria-labelledby="excel-import-file-choice-title">
      <h3 id="excel-import-file-choice-title">Excel file</h3>
      <label class="excel-import-file-picker"><input type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-excel-import-file /><span class="excel-import-file-picker-content"><strong>Browse files</strong><small>Select an .xlsx estimate or item list.</small></span></label>
      <div class="excel-import-read-status" role="status" aria-live="polite" data-excel-import-read-status>${renderFileStatus(view)}</div>
    </section>
    <section class="excel-import-destination" aria-labelledby="excel-import-destination-title">
      <div>
        <h3 id="excel-import-destination-title">Where should the items go?</h3>
        <p class="muted">${renderMatchingContext(view.destinationState, states)}</p>
      </div>
      <div class="excel-import-destination-options">
        ${activeProjectLabel ? `<label><input type="radio" name="excelImportProjectMode" value="active" data-excel-import-project-mode ${view.destinationProjectMode === "active" ? "checked" : ""} /><span><strong>Add items to ${escapeHtml(activeProjectLabel)}</strong><small>Keep the items already in this Project.</small></span></label>` : ""}
        <label><input type="radio" name="excelImportProjectMode" value="new" data-excel-import-project-mode ${view.destinationProjectMode === "new" ? "checked" : ""} /><span><strong>Create a new Project</strong><small>Start a separate Project for these imported items.</small></span></label>
      </div>
      ${view.destinationProjectMode === "new" ? `<label class="excel-import-new-project-name"><span>New Project name</span><input type="text" name="excelImportNewProjectName" value="${escapeHtml(view.newProjectName)}" data-excel-import-new-project-name /></label>` : ""}
    </section>
    <div class="excel-import-actions excel-import-actions--split"><span></span><button type="button" class="primary-button" data-excel-import-next="sheet" ${view.readStatus !== "ready" ? "disabled" : ""}>Next: Choose data</button></div>
  </div>`;
}

function renderFileStatus(view: ExcelImportViewModel): string {
  if (view.readStatus === "reading") return escapeHtml(view.progressText || "Reading workbook…");
  if (view.fileName) return `<strong>${escapeHtml(view.fileName)}</strong>${view.fileSize === null ? "" : `<span>${escapeHtml(formatFileSize(view.fileSize))}</span>`}<span>${view.readStatus === "ready" ? "Workbook ready. Continue to choose the item data." : "Workbook could not be read."}</span>`;
  return "No workbook selected.";
}

function renderMatchingContext(destinationState: string, states: StateConfig[]): string {
  const stateName = states.find((state) => state.code === destinationState)?.name ?? destinationState;
  return `Item codes will be checked against ${escapeHtml(stateName)} items.`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function renderSheetStage(view: ExcelImportViewModel): string {
  const selectedDetection = view.detections.find((detection) => detection.sheetName === view.selectedSheetName) ?? null;
  const regions = selectedDetection?.regions ?? [];
  const region = selectedRegion(view);
  const sheet = view.workbook?.sheets.find((candidate) => candidate.name === view.selectedSheetName) ?? null;
  const selection = view.selection;
  return `<div class="excel-import-stage" data-excel-import-stage="sheet">
    <div class="excel-import-data-heading"><div><h3>Choose the item data</h3><p class="muted">A worksheet and data range were selected based on recognized column labels and populated cells.</p></div><label><span>Worksheet</span><select data-excel-import-sheet>${view.workbook?.sheets.map((candidate) => `<option value="${escapeHtml(candidate.name)}" ${candidate.name === view.selectedSheetName ? "selected" : ""}>${escapeHtml(candidate.name)}${candidate.visibility !== "visible" ? ` (${escapeHtml(candidate.visibility)})` : ""}</option>`).join("") ?? ""}</select></label></div>
    ${selectedDetection?.warnings.length ? `<ul class="excel-import-warning-list">${selectedDetection.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>` : ""}
    ${regions.length > 1 ? `<section class="excel-import-region-choices" aria-labelledby="excel-import-region-choices-title"><h4 id="excel-import-region-choices-title">Detected item tables</h4><div>${regions.map((candidate) => renderRegionOption(candidate, view.selectedRegionId)).join("")}</div></section>` : ""}
    ${region && sheet && selection ? renderDataPreview(sheet, region, selection) : `<p class="muted">No populated item table was detected on this worksheet. Select another worksheet or set a data range below.</p>`}
    ${region ? renderSectionSelection(view, region) : ""}
    ${renderRangeSettings(view, region)}
    <div class="excel-import-actions excel-import-actions--split"><button type="button" class="secondary-button" data-excel-import-back="file">Back: Choose file</button><button type="button" class="primary-button" data-excel-import-next="mapping" ${view.selectedRegionId ? "" : "disabled"}>Next: Match columns</button></div>
  </div>`;
}

function renderRegionOption(region: ExcelRegionSuggestion, selectedRegionId: string | null): string {
  const selected = region.regionId === selectedRegionId;
  const header = region.suggestedHeaderRow ? region.headerCandidates.find((candidate) => candidate.rowNumber === region.suggestedHeaderRow) : null;
  return `<label class="excel-import-region-option"><input type="radio" name="excelImportRegion" value="${escapeHtml(region.regionId)}" data-excel-import-region ${selected ? "checked" : ""} /><span><strong>${escapeHtml(`${columnLabel(region.startColumn)}${region.startRow}:${columnLabel(region.endColumn)}${region.endRow}`)}</strong><small>${regionRowCount(region)} spreadsheet rows${header ? `; headers include ${escapeHtml(header.recognizedFields.map((field) => IMPORT_FIELD_LABELS[field]).join(", "))}` : "; column matching required"}</small></span></label>`;
}

function renderDataPreview(sheet: ExcelWorkbookSnapshot["sheets"][number], region: ExcelRegionSuggestion, selection: ExcelImportSelection): string {
  const range = `${columnLabel(selection.startColumn)}${selection.startRow}:${columnLabel(selection.endColumn)}${selection.endRow}`;
  const header = region.headerCandidates.find((candidate) => candidate.rowNumber === selection.startRow || candidate.rowNumber === region.suggestedHeaderRow) ?? null;
  const previewRows = previewRowsForSelection(sheet, selection, header?.rowNumber ?? null);
  const previewColumns = previewColumnNumbers(selection, header, sheet);
  return `<section class="excel-import-data-preview" aria-labelledby="excel-import-data-preview-title"><div class="excel-import-preview-summary"><div><h4 id="excel-import-data-preview-title">Detected item table</h4><p><strong>${regionRowCountForSelection(selection)} spreadsheet rows in ${escapeHtml(range)}</strong></p><small>${header ? `Headers found on row ${header.rowNumber}.` : "No header row was confirmed. You can match columns in the next step."}</small></div><span class="excel-import-detection-badge">${region.confidence === "suggested" ? "Detected" : "Check selection"}</span></div><div class="table-scroll excel-import-preview-scroll" tabindex="0" aria-label="Spreadsheet preview"><table><thead><tr>${previewColumns.map((column) => `<th>${escapeHtml(`${columnLabel(column)}${header?.labels[column] ? ` — ${header.labels[column]}` : ""}`)}</th>`).join("")}</tr></thead><tbody>${previewRows.length ? previewRows.map((row) => `<tr>${previewColumns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${previewColumns.length}" class="muted">No populated rows were found in this range.</td></tr>`}</tbody></table></div></section>`;
}

function renderRangeSettings(view: ExcelImportViewModel, region: ExcelRegionSuggestion | null): string {
  const selection = view.selection;
  const hiddenRowCount = region?.hiddenRowCount ?? 0;
  return `<details class="excel-import-range-settings"><summary>Change data range</summary><div><p class="muted">Use this only when the detected table includes helper cells or misses part of the item list.</p><div class="excel-import-range-fields"><label><span>First cell</span><input type="text" value="${escapeHtml(selection ? `${columnLabel(selection.startColumn)}${selection.startRow}` : "")}" data-excel-import-start-cell placeholder="B11" /></label><label><span>Last cell</span><input type="text" value="${escapeHtml(selection ? `${columnLabel(selection.endColumn)}${selection.endRow}` : "")}" data-excel-import-end-cell placeholder="H143" /></label><button type="button" class="secondary-button" data-excel-import-apply-range>Use this range</button></div>${hiddenRowCount ? `<label class="excel-import-hidden-row-toggle"><input type="checkbox" data-excel-import-include-hidden ${selection?.includeHiddenRows ? "checked" : ""} /><span>Include ${hiddenRowCount} hidden row${hiddenRowCount === 1 ? "" : "s"}</span></label>` : ""}</div></details>`;
}

function renderSectionSelection(view: ExcelImportViewModel, region: ExcelRegionSuggestion): string {
  if (!region.sections.some((section) => section.requiresAlternativeChoice)) return "";
  const included = new Set(view.selection?.includedSectionIds ?? []);
  const alternatives = region.sections.filter((section) => section.requiresAlternativeChoice);
  return `<section class="excel-import-section-selection" aria-labelledby="excel-import-section-selection-title"><h4 id="excel-import-section-selection-title">Choose source section</h4><p class="muted">This worksheet contains alternative sections. Select the section to include in this import.</p><fieldset><legend>Source section</legend>${alternatives.map((section) => `<label><input type="radio" name="excelImportAlternativeSection" value="${escapeHtml(section.sectionId)}" data-excel-import-alternative-section ${included.has(section.sectionId) ? "checked" : ""} /><span>${escapeHtml(section.title)}</span></label>`).join("")}</fieldset></section>`;
}

function previewRowsForSelection(sheet: ExcelWorkbookSnapshot["sheets"][number], selection: ExcelImportSelection, headerRow: number | null): Array<Record<number, string>> {
  const firstRow = Math.max(selection.startRow, (headerRow ?? selection.startRow) + 1);
  const rows = new Map<number, Record<number, string>>();
  sheet.cells.forEach((cell) => {
    if (cell.rowNumber < firstRow || cell.rowNumber > selection.endRow || cell.columnNumber < selection.startColumn || cell.columnNumber > selection.endColumn) return;
    const row = rows.get(cell.rowNumber) ?? {};
    row[cell.columnNumber] = cell.formattedText || (cell.rawValue === null ? "" : String(cell.rawValue));
    rows.set(cell.rowNumber, row);
  });
  return [...rows.entries()].sort(([left], [right]) => left - right).filter(([, row]) => Object.values(row).some((value) => value.trim())).slice(0, 6).map(([, row]) => row);
}

function previewColumnNumbers(selection: ExcelImportSelection, header: ExcelRegionSuggestion["headerCandidates"][number] | null, sheet: ExcelWorkbookSnapshot["sheets"][number]): number[] {
  const columns = new Set<number>();
  Object.keys(header?.labels ?? {}).forEach((column) => columns.add(Number(column)));
  sheet.cells.forEach((cell) => {
    if (columns.size >= 7 || cell.rowNumber < selection.startRow || cell.rowNumber > selection.endRow || cell.columnNumber < selection.startColumn || cell.columnNumber > selection.endColumn) return;
    if (cell.rawValue !== null || cell.formattedText.trim()) columns.add(cell.columnNumber);
  });
  return [...columns].sort((left, right) => left - right).slice(0, 7);
}

function regionRowCount(region: ExcelRegionSuggestion): number {
  return region.endRow - region.startRow + 1;
}

function regionRowCountForSelection(selection: ExcelImportSelection): number {
  return selection.endRow - selection.startRow + 1;
}

function renderMappingStage(view: ExcelImportViewModel): string {
  const region = selectedRegion(view);
  const mapping = view.mapping;
  if (!region || !mapping) return `<div class="excel-import-stage"><p class="muted">Choose a worksheet area before mapping columns.</p><div class="excel-import-actions"><button type="button" class="secondary-button" data-excel-import-back="sheet">Back</button></div></div>`;
  const labels = mapping.headerRow ? (region.headerCandidates.find((candidate) => candidate.rowNumber === mapping.headerRow)?.labels ?? {}) : {};
  const sheet = view.workbook?.sheets.find((candidate) => candidate.name === region.sheetName) ?? null;
  const startColumn = view.selection?.startColumn ?? region.startColumn;
  const endColumn = view.selection?.endColumn ?? region.endColumn;
  const columns = Array.from({ length: endColumn - startColumn + 1 }, (_, index) => startColumn + index);
  return `<div class="excel-import-stage" data-excel-import-stage="mapping">
    <div class="excel-import-mapping-heading"><div><h3>Match spreadsheet columns</h3><p class="muted">Confirm the columns used to create Project items. We selected the likely matches.</p></div><p class="excel-import-selection-summary">${escapeHtml(region.sheetName)} · rows ${view.selection?.startRow ?? region.startRow}–${view.selection?.endRow ?? region.endRow}</p></div>
    <p class="excel-import-mapping-guidance">Map either <strong>Item Code</strong> or <strong>Description</strong> to continue. Description, Unit, Quantity, and Unit Cost are recommended.</p>
    <div class="table-scroll excel-import-mapping-table-shell" tabindex="0" aria-label="Column matching table"><table class="excel-import-mapping-table"><thead><tr><th>Project field</th><th>Spreadsheet column</th><th>Example values</th><th>Status</th></tr></thead><tbody>${PRIMARY_MAPPING_FIELDS.map((field) => renderPrimaryFieldMapping(field, mapping, columns, labels, sheet, view.selection)).join("")}</tbody></table></div>
    ${renderAdvancedMappingSettings(view, region, mapping, columns, labels, sheet, view.selection)}
    <div class="excel-import-actions excel-import-actions--split"><button type="button" class="secondary-button" data-excel-import-back="sheet">Back: Choose data</button><button type="button" class="primary-button" data-excel-import-next="review">Next: Review items</button></div>
  </div>`;
}

function renderPrimaryFieldMapping(
  field: ImportField,
  mapping: ExcelImportMapping,
  columns: number[],
  labels: Record<number, string>,
  sheet: ExcelWorkbookSnapshot["sheets"][number] | null,
  selection: ExcelImportSelection | null
): string {
  const selectedColumn = mapping.columns[field];
  const status = mappingStatus(field, mapping);
  return `<tr><th scope="row"><label for="excel-import-field-${field}">${escapeHtml(IMPORT_FIELD_LABELS[field])}</label></th><td>${renderFieldMapping(field, selectedColumn, columns, labels, `excel-import-field-${field}`)}</td><td>${escapeHtml(mappingExamples(sheet, selection, mapping.headerRow, selectedColumn))}</td><td><span class="excel-import-mapping-status excel-import-mapping-status--${status.kind}">${escapeHtml(status.label)}</span></td></tr>`;
}

function renderAdvancedMappingSettings(
  view: ExcelImportViewModel,
  region: ExcelRegionSuggestion,
  mapping: ExcelImportMapping,
  columns: number[],
  labels: Record<number, string>,
  sheet: ExcelWorkbookSnapshot["sheets"][number] | null,
  selection: ExcelImportSelection | null
): string {
  return `<details class="excel-import-advanced-settings" data-excel-import-advanced-settings ${view.advancedSettingsOpen ? "open" : ""}><summary>Advanced import settings</summary><div>
    <label><span>Extended cost (comparison only)</span>${renderFieldMapping("sourceTotal", mapping.columns.sourceTotal, columns, labels, "excel-import-field-sourceTotal")}</label>
    <label><span>Project groups</span><select data-excel-import-group-source><option value="section" ${mapping.groupSource === "section" ? "selected" : ""}>Use detected section headings as groups</option><option value="mapped" ${mapping.groupSource === "mapped" ? "selected" : ""}>Use a spreadsheet column as groups</option><option value="blank" ${mapping.groupSource === "blank" ? "selected" : ""}>Do not create groups</option></select></label>
    ${mapping.groupSource === "mapped" ? `<label><span>Project group column</span>${renderFieldMapping("group", mapping.columns.group, columns, labels, "excel-import-field-group")}</label>` : ""}
    <label><span>Cost categories</span><select data-excel-import-category-source><option value="construction" ${mapping.categorySource === "construction" ? "selected" : ""}>Assign imported items to Construction Costs</option><option value="mapped" ${mapping.categorySource === "mapped" ? "selected" : ""}>Use a spreadsheet column</option><option value="section" ${mapping.categorySource === "section" ? "selected" : ""}>Use detected section categories</option></select></label>
    ${mapping.categorySource === "mapped" ? `<label><span>Cost category column</span>${renderFieldMapping("costCategory", mapping.columns.costCategory, columns, labels, "excel-import-field-costCategory")}</label>` : ""}
    <label><span>Header row</span><select data-excel-import-header-row><option value="">No header row / match columns manually</option>${region.headerCandidates.map((candidate) => `<option value="${candidate.rowNumber}" ${mapping.headerRow === candidate.rowNumber ? "selected" : ""}>Row ${candidate.rowNumber}: ${escapeHtml(candidate.recognizedFields.map((field) => IMPORT_FIELD_LABELS[field]).join(", "))}${candidate.tied ? " (review choice)" : ""}</option>`).join("")}</select></label>
    ${mapping.columns.sourceTotal ? `<p class="muted">Examples: ${escapeHtml(mappingExamples(sheet, selection, mapping.headerRow, mapping.columns.sourceTotal))}</p>` : ""}
  </div></details>`;
}

function renderFieldMapping(field: ImportField, selectedColumn: number | undefined, columns: number[], labels: Record<number, string>, id?: string): string {
  const options = columns.map((column) => `<option value="${column}" ${selectedColumn === column ? "selected" : ""}>${columnLabel(column)}${labels[column] ? ` — ${escapeHtml(labels[column])}` : ""}</option>`).join("");
  return `<select ${id ? `id="${id}"` : ""} data-excel-import-field="${field}"><option value="">Do not import</option>${options}</select>`;
}

function mappingStatus(field: ImportField, mapping: ExcelImportMapping): { kind: "matched" | "recommended" | "required" | "optional"; label: string } {
  if (mapping.columns[field]) return { kind: "matched", label: "Matched" };
  if ((field === "itemCode" || field === "description") && !mapping.columns.itemCode && !mapping.columns.description) return { kind: "required", label: "Required" };
  if (field === "description" || field === "unit" || field === "quantity" || field === "unitCost") return { kind: "recommended", label: "Recommended" };
  return { kind: "optional", label: "Optional" };
}

function mappingExamples(
  sheet: ExcelWorkbookSnapshot["sheets"][number] | null,
  selection: ExcelImportSelection | null,
  headerRow: number | null,
  column: number | undefined
): string {
  if (!sheet || !selection || !column) return "—";
  const startRow = Math.max(selection.startRow, (headerRow ?? selection.startRow - 1) + 1);
  const values = sheet.cells
    .filter((cell) => cell.columnNumber === column && cell.rowNumber >= startRow && cell.rowNumber <= selection.endRow)
    .map((cell) => (cell.formattedText || (cell.rawValue === null ? "" : String(cell.rawValue))).trim())
    .filter(Boolean);
  return values.slice(0, 2).join(", ") || "—";
}

function renderReviewStage(view: ExcelImportViewModel, states: StateConfig[]): string {
  const rows = filteredReviewRows(view);
  const pageCount = Math.max(1, Math.ceil(rows.length / REVIEW_PAGE_SIZE));
  const page = Math.min(view.reviewPage, pageCount - 1);
  const pageRows = rows.slice(page * REVIEW_PAGE_SIZE, (page + 1) * REVIEW_PAGE_SIZE);
  const selectableRows = rows.filter((row) => isSelectableReviewRow(row, view.decisions));
  const visibleSelectableRows = pageRows.filter((row) => isSelectableReviewRow(row, view.decisions));
  const selectedRowIds = new Set(view.selectedReviewRowIds);
  const selectedRows = selectableRows.filter((row) => selectedRowIds.has(row.rowId));
  const allVisibleSelected = visibleSelectableRows.length > 0 && visibleSelectableRows.every((row) => selectedRowIds.has(row.rowId));
  const bulkOptions = sharedBulkReviewOptions(selectedRows);
  const readyCount = view.rows.filter((row) => (reviewRowKind(row) === "ready" || reviewRowKind(row) === "custom") && view.decisions[row.rowId]?.action !== "exclude").length;
  const needsReview = unresolvedReviewRows(view).length;
  const skipped = view.rows.filter((row) => reviewRowKind(row) === "skipped" || view.decisions[row.rowId]?.action === "exclude").length;
  const stateName = states.find((state) => state.code === view.destinationState)?.name ?? view.destinationState;
  const reviewMessage = needsReview
    ? `Resolve ${needsReview} item${needsReview === 1 ? "" : "s"} to continue.`
    : "No decisions are required. Review the items, then continue.";
  return `<div class="excel-import-stage" data-excel-import-stage="review">
    <div class="excel-import-review-summary" aria-label="Import review summary"><button type="button" class="excel-import-review-card ${view.reviewFilter === "ready" ? "is-active" : ""}" data-excel-import-review-filter="ready"><strong>${readyCount}</strong><span>Ready to import</span></button><button type="button" class="excel-import-review-card ${view.reviewFilter === "needs-review" ? "is-active" : ""}" data-excel-import-review-filter="needs-review"><strong>${needsReview}</strong><span>Needs attention</span></button><button type="button" class="excel-import-review-card ${view.reviewFilter === "excluded" ? "is-active" : ""}" data-excel-import-review-filter="excluded"><strong>${skipped}</strong><span>Skipped</span></button><button type="button" class="excel-import-review-show-all ${view.reviewFilter === "all" ? "is-active" : ""}" data-excel-import-review-filter="all">Show all ${view.rows.length} rows</button></div>
    <p class="excel-import-review-guidance ${needsReview ? "is-attention" : ""}" role="status">${reviewMessage}</p>
    ${renderReviewBulkControls(view, selectedRows, selectableRows.length, visibleSelectableRows.length, allVisibleSelected, bulkOptions)}
    <div class="table-scroll excel-import-table-shell" tabindex="0" aria-label="Excel import item review"><table class="excel-import-table"><thead><tr><th><label class="excel-import-select-all"><input type="checkbox" data-excel-import-toggle-visible ${allVisibleSelected ? "checked" : ""} ${visibleSelectableRows.length ? "" : "disabled"} /><span class="sr-only">Select visible items needing attention</span></label></th><th>Spreadsheet row</th><th>Code</th><th>Description</th><th>Unit</th><th>Quantity</th><th>Unit cost</th><th>Match</th><th>Choice</th></tr></thead><tbody>${pageRows.length ? pageRows.map((row) => renderReviewRow(row, view.decisions, stateName, selectedRowIds.has(row.rowId))).join("") : `<tr><td colspan="9" class="muted">No rows match this view.</td></tr>`}</tbody></table></div>
    <div class="excel-import-pagination" aria-label="Table pages"><button type="button" class="secondary-button" data-excel-import-page="prev" ${page <= 0 ? "disabled" : ""}>Previous 50</button><span>Page ${page + 1} of ${pageCount}</span><button type="button" class="secondary-button" data-excel-import-page="next" ${page >= pageCount - 1 ? "disabled" : ""}>Next 50</button></div>
    <div class="excel-import-actions excel-import-actions--split"><button type="button" class="secondary-button" data-excel-import-back="mapping">Back: Match columns</button><button type="button" class="primary-button" data-excel-import-finish ${needsReview ? "disabled" : ""}>Next: Confirm import</button></div>
  </div>`;
}

function renderReviewBulkControls(
  view: ExcelImportViewModel,
  selectedRows: MatchedImportRow[],
  filteredSelectableCount: number,
  visibleSelectableCount: number,
  allVisibleSelected: boolean,
  bulkOptions: Array<[ImportResolutionAction, string]>
): string {
  const issueOptions: Array<[ExcelImportReviewIssueFilter, string]> = [["all", "All issue types"], ["description", "Description differs"], ["unit", "Unit differs"], ["missing", "Missing information"], ["allowance", "Allowance rows"]];
  const selectedCount = selectedRows.length;
  return `<section class="excel-import-bulk-review" aria-labelledby="excel-import-bulk-review-title">
    <div><h3 id="excel-import-bulk-review-title">Resolve selected items</h3><p class="muted">Filter the list, select only rows with the same issue, then apply one choice. Individual row choices remain available.</p></div>
    <div class="excel-import-bulk-review-controls">
      <label><span>Issue type</span><select data-excel-import-review-issue-filter>${issueOptions.map(([value, label]) => `<option value="${value}" ${view.reviewIssueFilter === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
      <div class="excel-import-bulk-review-selection"><button type="button" class="secondary-button" data-excel-import-select-visible ${visibleSelectableCount ? "" : "disabled"}>${allVisibleSelected ? "Clear visible" : `Select visible (${visibleSelectableCount})`}</button><button type="button" class="secondary-button" data-excel-import-select-filtered ${filteredSelectableCount ? "" : "disabled"}>Select all filtered (${filteredSelectableCount})</button><button type="button" class="secondary-button" data-excel-import-clear-selection ${selectedCount ? "" : "disabled"}>Clear selection</button></div>
      <div class="excel-import-bulk-review-apply"><label><span>Apply to ${selectedCount} selected</span><select data-excel-import-bulk-action ${bulkOptions.length ? "" : "disabled"}><option value="">Choose a resolution…</option>${bulkOptions.map(([value, label]) => `<option value="${value}">${escapeHtml(label)}</option>`).join("")}</select></label><button type="button" class="primary-button" data-excel-import-apply-bulk-action ${selectedCount && bulkOptions.length ? "" : "disabled"}>Apply</button></div>
    </div>
  </section>`;
}

function renderReviewRow(row: MatchedImportRow, decisions: Record<string, ImportRowDecision>, stateName: string, selected: boolean): string {
  const kind = reviewRowKind(row);
  const decision = decisions[row.rowId];
  const issueText = reviewIssueText(row, kind);
  const selectable = isSelectableReviewRow(row, decisions);
  return `<tr class="excel-import-row--${kind}"><td>${selectable ? `<label class="excel-import-row-select"><input type="checkbox" data-excel-import-review-row="${escapeHtml(row.rowId)}" ${selected ? "checked" : ""} /><span class="sr-only">Select spreadsheet row ${row.locator.rowNumber}</span></label>` : "—"}</td><td><strong>${row.locator.rowNumber}</strong><small>${escapeHtml(row.locator.sourceRange)}</small>${issueText ? `<span class="excel-import-row-issue">${escapeHtml(issueText)}</span>` : ""}</td><td>${escapeHtml(row.values.itemCode || "—")}</td><td>${escapeHtml(row.values.description || "—")}</td><td>${escapeHtml(row.values.unit || "—")}</td><td>${row.values.quantity === null ? "—" : escapeHtml(String(row.values.quantity))}</td><td>${row.values.unitCost === null ? "—" : escapeHtml(String(row.values.unitCost))}</td><td>${renderMatch(row, kind, stateName)}</td><td>${renderReviewChoice(row, kind, decision)}</td></tr>`;
}

function renderMatch(row: MatchedImportRow, kind: ReviewRowKind, stateName: string): string {
  const candidate = row.candidates.find((item) => item.agencyItemId === row.selectedAgencyItemId) ?? row.candidates[0];
  const label: Record<ReviewRowKind, string> = {
    ready: `Matched to ${stateName} item`,
    custom: "No exact match — import as custom item",
    descriptionConflict: row.unitComparison === "different" ? "Description and unit differ — choose which to use" : "Description differs — choose which to use",
    unitConflict: "Unit differs — choose which to use",
    incomplete: "Missing required information",
    allowance: "Allowance row — choose how to import it",
    skipped: "Skipped",
    unresolved: "Missing required information"
  };
  const comparison = candidate && (kind === "descriptionConflict" || kind === "unitConflict")
    ? `<dl class="excel-import-comparison">${kind === "descriptionConflict" ? `<div><dt>Spreadsheet description</dt><dd>${escapeHtml(row.values.description || "—")}</dd></div><div><dt>Official description</dt><dd>${escapeHtml(candidate.officialDescription || "—")}</dd></div>` : ""}${(kind === "unitConflict" || row.unitComparison === "different") ? `<div><dt>Spreadsheet unit</dt><dd>${escapeHtml(row.values.unit || "—")}</dd></div><div><dt>Official unit</dt><dd>${escapeHtml(candidate.officialUnit || "—")}</dd></div>` : ""}</dl>`
    : "";
  return `<span class="excel-import-match excel-import-match--${kind}">${escapeHtml(label[kind])}</span>${comparison}`;
}

function renderReviewChoice(row: MatchedImportRow, kind: ReviewRowKind, decision: ImportRowDecision | undefined): string {
  const action = decision?.action ?? (kind === "custom" ? "keep-custom" : "");
  if (kind === "ready") return `<span class="excel-import-choice-ready">Ready</span>`;
  if (kind === "skipped") return `<span class="muted">Skipped</span>`;
  const options = reviewChoiceOptions(row, kind);
  return `<label class="excel-import-choice"><span class="sr-only">Choose how to import source row ${row.locator.rowNumber}</span><select data-excel-import-row-action="${escapeHtml(row.rowId)}"><option value="" ${!action ? "selected" : ""}>Choose…</option>${options.map(([value, label]) => `<option value="${value}" ${action === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>`;
}

function reviewChoiceOptions(row: MatchedImportRow, kind: ReviewRowKind): Array<[string, string]> {
  if (kind === "descriptionConflict") {
    const unitAlsoDiffers = row.unitComparison === "different";
    return [["use-catalog-description", unitAlsoDiffers ? "Use official description and unit" : "Use official description"], ["keep-custom", unitAlsoDiffers ? "Keep spreadsheet description and unit as custom item" : "Keep spreadsheet description as custom item"], ["exclude", "Skip row"]];
  }
  if (kind === "unitConflict") return [["accept-catalog", "Use official unit"], ["keep-custom", "Keep spreadsheet unit as custom item"], ["exclude", "Skip row"]];
  if (kind === "custom") return [["keep-custom", "Import as custom item"], ["exclude", "Skip row"]];
  if (kind === "incomplete") return [["accept-incomplete", "Import incomplete item"], ["exclude", "Skip row"]];
  if (kind === "allowance") return [["fixed-allowance", "Import as allowance"], ["exclude", "Skip row"]];
  return [["exclude", "Skip row"]];
}

function isSelectableReviewRow(row: MatchedImportRow, decisions: Record<string, ImportRowDecision>): boolean {
  const kind = reviewRowKind(row);
  return kind !== "ready" && kind !== "custom" && kind !== "skipped" && !decisions[row.rowId]?.action;
}

function sharedBulkReviewOptions(rows: MatchedImportRow[]): Array<[ImportResolutionAction, string]> {
  if (!rows.length) return [];
  const optionsByAction = rows.map((row) => new Map(reviewChoiceOptions(row, reviewRowKind(row)) as Array<[ImportResolutionAction, string]>));
  return [...optionsByAction[0].entries()].filter(([action]) => optionsByAction.every((options) => options.has(action)));
}

type ReviewRowKind = "ready" | "custom" | "descriptionConflict" | "unitConflict" | "incomplete" | "allowance" | "skipped" | "unresolved";

function reviewRowKind(row: MatchedImportRow): ReviewRowKind {
  if (!row.selected || row.issues.some((issue) => issue.code === "hidden-row-excluded" || issue.code === "section-excluded")) return "skipped";
  if (row.classification === "summary" && row.values.sourceTotal !== null) return "allowance";
  if (row.classification === "blank" || row.classification === "repeated-header" || row.classification === "section-heading") return "skipped";
  if (!row.values.description.trim() && row.matchStatus !== "catalog-ready") return "unresolved";
  if (row.values.quantity === null || row.values.unitCost === null) return "incomplete";
  if (row.descriptionComparison === "different") return "descriptionConflict";
  if (row.unitComparison === "different") return "unitConflict";
  if (row.matchStatus === "catalog-ready") return "ready";
  if (row.matchStatus === "custom-ready" || row.matchStatus === "unmatched") return "custom";
  return "unresolved";
}

function reviewIssueText(row: MatchedImportRow, kind: ReviewRowKind): string {
  if (kind === "ready" || kind === "custom" || kind === "descriptionConflict" || kind === "unitConflict") return "";
  const message = [...row.issues, ...row.matchIssues].map((issue) => issue.message).find(Boolean) ?? "";
  return message.replace(/catalog/gi, "official item");
}


function renderResultStage(view: ExcelImportViewModel): string {
  const summary = view.confirmation;
  if (!summary) return `<div class="excel-import-stage" data-excel-import-stage="result"><p class="excel-import-error" role="alert">The import summary is unavailable. Return to review and prepare the import again.</p><div class="excel-import-actions"><button type="button" class="secondary-button" data-excel-import-back="review">Back to review</button></div></div>`;
  const disabled = view.commitStatus === "committing" ? "disabled" : "";
  if (view.commitStatus === "committed") {
    return `<div class="excel-import-stage" data-excel-import-stage="result"><div class="excel-import-result excel-import-result--success" role="status" aria-live="polite"><h3>${summary.importedCount} item${summary.importedCount === 1 ? "" : "s"} were added to ${escapeHtml(summary.destinationLabel)}.</h3><p>${summary.skippedCount ? `${summary.skippedCount} spreadsheet row${summary.skippedCount === 1 ? " was" : "s were"} skipped.` : "The import is complete."}</p></div>${summary.skippedCount ? `<div class="excel-import-actions"><button type="button" class="secondary-button" data-excel-import-download-report>Download skipped-row report</button></div>` : ""}</div>`;
  }
  const failure = view.commitStatus === "failed";
  return `<div class="excel-import-stage" data-excel-import-stage="result">
    <div class="excel-import-result${failure ? " excel-import-result--failure" : ""}" role="status" aria-live="polite">
      <h3>${failure ? "Import could not be completed" : "Ready to import"}</h3>
      ${failure ? `<p>No items were added. ${escapeHtml(view.commitMessage ?? "Review the import and try again.")}</p>` : renderConfirmationSummary(summary)}
    </div>
    ${failure ? "" : renderCostSummary(summary)}
    ${failure ? "" : renderSkippedRows(summary)}
    <div class="excel-import-actions">
      <button type="button" class="secondary-button" data-excel-import-back="review" ${disabled}>Back to review</button>
      ${summary.skippedCount ? `<button type="button" class="secondary-button" data-excel-import-download-report ${disabled}>Download skipped-row report</button>` : ""}
      <button type="button" class="primary-button" data-excel-import-commit ${disabled}>${view.commitStatus === "committing" ? "Importing items…" : failure ? "Try import again" : `Import ${summary.importedCount} item${summary.importedCount === 1 ? "" : "s"}`}</button>
    </div>
  </div>`;
}

function renderConfirmationSummary(summary: ExcelImportConfirmationSummary): string {
  const destinationNote = summary.keepsExistingItems
    ? "Existing Project items will remain in place."
    : "A new Project will be created with these items.";
  return `<p><strong>${summary.importedCount} item${summary.importedCount === 1 ? " will" : "s will"} be added to ${escapeHtml(summary.destinationLabel)}.</strong> ${summary.skippedCount} spreadsheet row${summary.skippedCount === 1 ? " will" : "s will"} be skipped. ${destinationNote}</p>`;
}

function renderCostSummary(summary: ExcelImportConfirmationSummary): string {
  const sourceTotal = summary.sourceTotalComparison;
  const sourceText = !sourceTotal
    ? "No spreadsheet extended-cost column was matched, so there is no total comparison."
    : Math.abs(sourceTotal.recalculatedMinusSource) < 0.005
      ? `Recalculated totals match the spreadsheet extended costs for ${sourceTotal.comparedItemCount} item${sourceTotal.comparedItemCount === 1 ? "" : "s"}.`
      : `Recalculated totals are ${formatMoney(Math.abs(sourceTotal.recalculatedMinusSource))} ${sourceTotal.recalculatedMinusSource > 0 ? "above" : "below"} the spreadsheet extended costs for ${sourceTotal.comparedItemCount} item${sourceTotal.comparedItemCount === 1 ? "" : "s"}.`;
  return `<section class="excel-import-confirmation-costs" aria-labelledby="excel-import-confirmation-costs-title"><h4 id="excel-import-confirmation-costs-title">Imported cost summary</h4><dl><div><dt>Construction Costs</dt><dd>${formatMoney(summary.constructionCost)}</dd></div>${summary.hasOtherCosts ? `<div><dt>Other Costs</dt><dd>${formatMoney(summary.otherCost)}</dd></div>` : ""}</dl><p class="muted">${sourceText}</p></section>`;
}

function renderSkippedRows(summary: ExcelImportConfirmationSummary): string {
  if (!summary.skippedCount) return "";
  return `<section class="excel-import-skipped-summary" aria-labelledby="excel-import-skipped-summary-title"><h4 id="excel-import-skipped-summary-title">Skipped spreadsheet rows</h4><ul>${summary.skippedReasons.map((reason) => `<li><strong>${reason.count}</strong> ${escapeHtml(reason.label)}</li>`).join("")}</ul><p class="muted">Download the issue report for the affected row numbers and source text.</p></section>`;
}

function formatMoney(value: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);
}

function selectedRegion(view: ExcelImportViewModel): ExcelRegionSuggestion | null {
  const detection = view.detections.find((candidate) => candidate.sheetName === view.selectedSheetName);
  return detection?.regions.find((candidate) => candidate.regionId === view.selectedRegionId) ?? null;
}

function unresolvedReviewRows(view: ExcelImportViewModel): MatchedImportRow[] {
  return view.rows.filter((row) => {
    const kind = reviewRowKind(row);
    if (kind === "ready" || kind === "custom" || kind === "skipped") return false;
    return !view.decisions[row.rowId]?.action;
  });
}

function filteredReviewRows(view: ExcelImportViewModel): MatchedImportRow[] {
  if (view.reviewFilter === "needs-review") return unresolvedReviewRows(view).filter((row) => reviewIssueFilterMatches(row, view.reviewIssueFilter));
  if (view.reviewFilter === "ready") return view.rows.filter((row) => (reviewRowKind(row) === "ready" || reviewRowKind(row) === "custom") && view.decisions[row.rowId]?.action !== "exclude");
  if (view.reviewFilter === "excluded") return view.rows.filter((row) => reviewRowKind(row) === "skipped" || view.decisions[row.rowId]?.action === "exclude");
  return view.rows;
}

function reviewIssueFilterMatches(row: MatchedImportRow, filter: ExcelImportReviewIssueFilter): boolean {
  if (filter === "all") return true;
  const kind = reviewRowKind(row);
  if (filter === "description") return kind === "descriptionConflict";
  if (filter === "unit") return kind === "unitConflict";
  if (filter === "allowance") return kind === "allowance";
  return kind === "incomplete" || kind === "unresolved";
}

function columnLabel(column: number): string {
  let value = "";
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    value = String.fromCharCode(65 + remainder) + value;
    current = Math.floor((current - 1) / 26);
  }
  return value;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[character] ?? character));
}
