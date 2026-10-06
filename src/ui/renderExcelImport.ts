import type { StateConfig } from "../data/schema";
import type { ExistingItemAction, ExistingItemPlan } from "../projects/excelImport/existingItems";
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
export type ExcelImportReviewFilter = "all" | "needs-review" | "ready" | "excluded" | "reviewed";
export type ExcelImportReviewIssueFilter = "all" | "description" | "unit" | "missing" | "allowance" | "other";

export interface ExcelImportConfirmationSummary {
  existingItemPlan?: ExistingItemPlan;
  existingItemsDetailsOpen?: boolean;
  existingItemAction?: ExistingItemAction;
  addedCount?: number;
  updatedCount?: number;
  constructionDelta?: number;
  otherDelta?: number;
  projectedConstructionCost?: number;
  projectedOtherCost?: number;
  destinationLabel: string;
  keepsExistingItems: boolean;
  importedCount: number;
  skippedCount: number;
  unresolvedSkippedCount: number;
  automaticallySkippedItemCount?: number;
  failedItemCount?: number;
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
  reviewUndo?: { decisions: Record<string, ImportRowDecision>; rows: MatchedImportRow[]; filter: ExcelImportReviewFilter; issueFilter: ExcelImportReviewIssueFilter; page: number };
  readStatus: "idle" | "reading" | "ready" | "error";
  progressText: string;
  fileSize: number | null;
  errorMessage: string | null;
  destinationState: string;
  destinationAgencyId: string;
  destinationCatalogStatus: "ready" | "loading" | "error";
  destinationCatalogError: string | null;
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
        ${view.stage === "result" ? "" : `<p class="muted">Choose a workbook, confirm its data, and review any items that need a decision before importing them into the Project.</p>`}
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
  const stateName = stateNameFor(view.destinationState, states);
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
        ${view.destinationCatalogStatus === "loading" ? `<p class="excel-import-catalog-status" role="status">Loading ${escapeHtml(stateName)} item catalog…</p>` : ""}
        ${view.destinationCatalogStatus === "error" ? `<p class="excel-import-catalog-error" role="alert">${escapeHtml(view.destinationCatalogError ?? "The selected state's item catalog could not be loaded.")} <button type="button" class="text-button" data-excel-import-retry-destination-state>Retry</button></p>` : ""}
      </div>
      <div class="excel-import-destination-options">
        ${activeProjectLabel ? `<label><input type="radio" name="excelImportProjectMode" value="active" data-excel-import-project-mode ${view.destinationProjectMode === "active" ? "checked" : ""} /><span><strong>Add items to ${escapeHtml(activeProjectLabel)}</strong><small>Keep the items already in this Project.</small></span></label>` : ""}
        <label><input type="radio" name="excelImportProjectMode" value="new" data-excel-import-project-mode ${view.destinationProjectMode === "new" ? "checked" : ""} /><span><strong>Create a new Project</strong><small>Start a separate Project for these imported items.</small></span></label>
      </div>
      ${view.destinationProjectMode === "new" ? `<div class="excel-import-new-project-fields">
        <label class="excel-import-new-project-name"><span>New Project name</span><input type="text" name="excelImportNewProjectName" value="${escapeHtml(view.newProjectName)}" data-excel-import-new-project-name /></label>
        <label class="excel-import-new-project-state"><span>State</span><select name="excelImportDestinationState" data-excel-import-destination-state>${states.map((state) => `<option value="${escapeHtml(state.code)}" ${state.code === view.destinationState ? "selected" : ""}>${escapeHtml(state.name)}</option>`).join("")}</select></label>
      </div>` : ""}
    </section>
    <div class="excel-import-actions excel-import-actions--split"><span></span><button type="button" class="primary-button" data-excel-import-next="sheet" ${view.readStatus !== "ready" || view.destinationCatalogStatus !== "ready" ? "disabled" : ""}>Next: Choose data</button></div>
  </div>`;
}

function renderFileStatus(view: ExcelImportViewModel): string {
  if (view.readStatus === "reading") return escapeHtml(view.progressText || "Reading workbook…");
  if (view.fileName) return `<strong>${escapeHtml(view.fileName)}</strong>${view.fileSize === null ? "" : `<span>${escapeHtml(formatFileSize(view.fileSize))}</span>`}<span>${view.readStatus === "ready" ? "Workbook ready. Continue to choose the item data." : "Workbook could not be read."}</span>`;
  return "No workbook selected.";
}

function renderMatchingContext(destinationState: string, states: StateConfig[]): string {
  const stateName = stateNameFor(destinationState, states);
  return `Item codes will be checked against ${escapeHtml(stateName)} items.`;
}

function stateNameFor(destinationState: string, states: StateConfig[]): string {
  return states.find((state) => state.code === destinationState)?.name ?? destinationState;
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
    <div class="excel-import-data-heading"><div><h3>Choose the item data</h3></div><label><span>Worksheet</span><select data-excel-import-sheet>${view.workbook?.sheets.map((candidate) => `<option value="${escapeHtml(candidate.name)}" ${candidate.name === view.selectedSheetName ? "selected" : ""}>${escapeHtml(candidate.name)}${candidate.visibility !== "visible" ? ` (${escapeHtml(candidate.visibility)})` : ""}</option>`).join("") ?? ""}</select></label></div>
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
    <div class="excel-import-mapping-heading"><div><h3>Match spreadsheet columns</h3></div><p class="excel-import-selection-summary">${escapeHtml(region.sheetName)} · rows ${view.selection?.startRow ?? region.startRow}–${view.selection?.endRow ?? region.endRow}</p></div>
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
  const selectableRows = view.reviewFilter === "needs-review" ? rows.filter((row) => isSelectableReviewRow(row, view.decisions)) : [];
  const visibleSelectableRows = pageRows.filter((row) => selectableRows.includes(row));
  const selectedRowIds = new Set(view.selectedReviewRowIds);
  const selectedRows = selectableRows.filter((row) => selectedRowIds.has(row.rowId));
  const unresolved = unresolvedReviewRows(view);
  const readyCount = view.rows.filter((row) => (reviewRowKind(row) === "ready" || reviewRowKind(row) === "custom") && !view.decisions[row.rowId]).length;
  const reviewedCount = view.rows.filter((row) => !!view.decisions[row.rowId]?.action && !view.decisions[row.rowId]?.automaticallySkipped).length;
  const skipped = view.rows.filter((row) => reviewRowKind(row) === "skipped" || view.decisions[row.rowId]?.action === "exclude").length;
  const stateName = states.find((state) => state.code === view.destinationState)?.name ?? view.destinationState;
  const filters: Array<[ExcelImportReviewFilter, string, number]> = [["needs-review", "Needs attention", unresolved.length], ["reviewed", "Reviewed", reviewedCount], ["all", "All items", view.rows.length]];
  const groups: Array<[ExcelImportReviewIssueFilter, string]> = [["all", "All issues"], ["description", "Description differs"], ["unit", "Unit differs"], ["missing", "Missing information"], ["allowance", "Allowances"], ["other", "Other issues"]];
  const options = sharedBulkReviewOptions(selectedRows);
  return `<div class="excel-import-stage" data-excel-import-stage="review">
    <div class="excel-import-review-task" role="status"><h3>${unresolved.length ? `${unresolved.length} item${unresolved.length === 1 ? " needs" : "s need"} attention. Continue to skip ${unresolved.length === 1 ? "it" : "them"}, or choose an action.` : "All items reviewed. Continue to confirm import."}</h3></div>
    <div class="excel-import-review-tabs" aria-label="Review views">${filters.map(([value, label, count]) => { const active = view.reviewFilter === value || (value === "all" && (view.reviewFilter === "ready" || view.reviewFilter === "excluded")); return `<button type="button" class="secondary-button ${active ? "is-active" : ""}" data-excel-import-review-filter="${value}" aria-pressed="${active}">${label} <span>${count}</span></button>`; }).join("")}</div>
    ${view.reviewFilter === "needs-review" ? `<div class="excel-import-selection-tools"><label class="excel-import-compact-filter"><span>Issue type</span><select data-excel-import-review-issue-filter>${groups.map(([value, label]) => { const count = unresolved.filter((row) => reviewIssueFilterMatches(row, value)).length; return `<option value="${value}" ${view.reviewIssueFilter === value ? "selected" : ""}>${label} (${count})</option>`; }).join("")}</select></label>
    <div class="excel-import-review-selection-controls"><button type="button" class="secondary-button" data-excel-import-select-visible aria-label="${visibleSelectableRows.length > 0 && visibleSelectableRows.every((row) => selectedRowIds.has(row.rowId)) ? "Clear visible rows" : "Select all visible rows"}" aria-pressed="${visibleSelectableRows.length > 0 && visibleSelectableRows.every((row) => selectedRowIds.has(row.rowId))}" ${visibleSelectableRows.length ? "" : "disabled"}>Select All / Clear</button>${selectedRows.length ? `<label class="excel-import-review-action"><select aria-label="Choose action for selected rows" data-excel-import-bulk-action><option value="">Choose action…</option>${options.map(([action, label]) => `<option value="${action}">${escapeHtml(bulkActionLabel(action, label, selectedRows))}</option>`).join("")}</select></label>` : ""}${!selectedRows.length && view.reviewUndo && view.reviewUndo.rows === view.rows ? `<div class="excel-import-review-feedback" role="status"><button type="button" class="secondary-button" data-excel-import-undo>Undo</button></div>` : ""}</div></div>` : view.reviewFilter === "reviewed" ? "" : `<div class="excel-import-selection-tools"><label class="excel-import-compact-filter"><span>Show</span><select data-excel-import-all-status><option value="all" ${view.reviewFilter === "all" ? "selected" : ""}>All items (${view.rows.length})</option><option value="ready" ${view.reviewFilter === "ready" ? "selected" : ""}>Ready to import (${readyCount})</option><option value="excluded" ${view.reviewFilter === "excluded" ? "selected" : ""}>Skipped (${skipped})</option></select></label></div>`}
    <div class="table-scroll excel-import-table-shell" tabindex="0" aria-label="Excel import item review"><table class="excel-import-table excel-import-review-table"><thead><tr><th></th><th>Row</th><th>Item</th><th>Why it needs attention / review result</th><th>Your choice</th></tr></thead><tbody>${pageRows.length ? pageRows.map((row) => renderReviewRow(row, view.decisions, stateName, selectedRowIds.has(row.rowId), view.reviewFilter === "needs-review")).join("") : `<tr><td colspan="5" class="muted">${view.reviewFilter === "needs-review" ? "No items need a decision in this group. Choose another group or review your recorded choices." : "No items match this view."}</td></tr>`}</tbody></table></div>
    <div class="excel-import-pagination" aria-label="Table pages"><button type="button" class="secondary-button" data-excel-import-page="prev" ${page <= 0 ? "disabled" : ""}>Previous 50</button><span>Page ${page + 1} of ${pageCount}</span><button type="button" class="secondary-button" data-excel-import-page="next" ${page >= pageCount - 1 ? "disabled" : ""}>Next 50</button></div>
    <div class="excel-import-actions excel-import-actions--split"><button type="button" class="secondary-button" data-excel-import-back="mapping">Back: Match columns</button><button type="button" class="primary-button" data-excel-import-finish>Next: Confirm import</button></div>
  </div>`;
}

function bulkActionLabel(action: ImportResolutionAction, fallback: string, rows: MatchedImportRow[]): string {
  const descriptions = rows.some((row) => row.descriptionComparison === "different");
  const units = rows.some((row) => row.unitComparison === "different");
  const fields = descriptions ? (units ? "descriptions and units" : "descriptions") : "units";
  if (action === "use-catalog-description" || action === "accept-catalog") return `Use official ${fields}`;
  if (action === "keep-custom") return `Keep spreadsheet ${fields} as custom items`;
  if (action === "exclude") return "Skip selected";
  return fallback;
}

function renderReviewRow(row: MatchedImportRow, decisions: Record<string, ImportRowDecision>, stateName: string, selected: boolean, attentionView: boolean): string {
  const kind = reviewRowKind(row);
  const decision = decisions[row.rowId];
  const issueText = reviewIssueText(row, kind);
  const selectable = attentionView && isSelectableReviewRow(row, decisions);
  return `<tr class="excel-import-row--${kind}"><td>${selectable ? `<label class="excel-import-row-select"><input type="checkbox" aria-label="Select row ${row.locator.rowNumber}" data-excel-import-review-row="${escapeHtml(row.rowId)}" ${selected ? "checked" : ""} /></label>` : ""}</td><td>${row.locator.rowNumber}</td>
    <td><strong>${escapeHtml(row.values.itemCode || "No item code")}</strong><div>${escapeHtml(row.values.description || "No description")}</div><small>${escapeHtml(row.locator.sourceRange)}</small><details class="excel-import-item-details"><summary>View item details</summary><dl><dt>Unit</dt><dd>${escapeHtml(row.values.unit || "—")}</dd><dt>Quantity</dt><dd>${row.values.quantity ?? "—"}</dd><dt>Unit cost</dt><dd>${row.values.unitCost === null ? "—" : formatMoney(row.values.unitCost)}</dd><dt>Group</dt><dd>${escapeHtml(row.values.group || "—")}</dd><dt>Cost category</dt><dd>${row.values.costCategory === "construction" ? "Construction Costs" : "Other Costs"}</dd><dt>Spreadsheet total</dt><dd>${row.values.sourceTotal === null ? "—" : formatMoney(row.values.sourceTotal)}</dd><dt>Notes</dt><dd>${escapeHtml(row.values.notes || "—")}</dd></dl></details></td>
    <td>${decision?.automaticallySkipped ? `<strong>Automatically skipped</strong><p>No supported import choice is available. Check for a missing estimate item.</p>` : decision?.action ? `<strong>Choice recorded</strong><p>${escapeHtml(reviewChoiceOptions(row, kind).find(([action]) => action === decision.action)?.[1] || "Reviewed")}</p>` : renderMatch(row, kind, stateName)}${issueText ? `<span class="excel-import-row-issue">${escapeHtml(issueText)}</span>` : ""}</td><td>${renderReviewChoice(row, kind, decision)}</td></tr>`;
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
  if (decision?.automaticallySkipped || isSkipOnlyReviewRow(row)) return '<span class="muted">Automatically skipped</span>';
  if (kind === "ready") return `<span class="excel-import-choice-ready">Ready</span>`;
  if (kind === "skipped") return `<span class="muted">Skipped</span>`;
  const options = reviewChoiceOptions(row, kind);
  const buttons = options.map(([value, label]) => `<button type="button" class="secondary-button" data-excel-import-row-choice="${escapeHtml(row.rowId)}" data-excel-import-action="${value}">${escapeHtml(label)}</button>`).join("");
  return `<div class="excel-import-row-actions">${decision?.action ? `<details><summary>Change choice</summary>${buttons}</details>` : buttons}</div>`;
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

export function isSkipOnlyReviewRow(row: MatchedImportRow): boolean {
  const kind = reviewRowKind(row);
  if (kind === "skipped" || kind === "ready" || kind === "custom") return false;
  const options = reviewChoiceOptions(row, kind);
  return options.length === 1 && options[0][0] === "exclude";
}

function isSelectableReviewRow(row: MatchedImportRow, decisions: Record<string, ImportRowDecision>): boolean {
  if (isSkipOnlyReviewRow(row)) return false;
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
  const commitDisabled = view.commitStatus === "committing" || summary.importedCount === 0 || summary.existingItemPlan?.errors.length ? "disabled" : "";
  if (view.commitStatus === "committed") {
    return `<div class="excel-import-stage" data-excel-import-stage="result"><div class="excel-import-result excel-import-result--success" role="status" aria-live="polite"><h3>${importOperationText(summary, true)} ${summary.updatedCount ? "in" : "to"} ${escapeHtml(summary.destinationLabel)}.</h3><p>${summary.skippedCount ? `${summary.skippedCount} spreadsheet row${summary.skippedCount === 1 ? " was" : "s were"} skipped.` : "The import is complete."}</p></div>${summary.skippedCount ? `<div class="excel-import-actions"><button type="button" class="secondary-button" data-excel-import-download-report>Download skipped-row report</button></div>` : ""}</div>`;
  }
  const failure = view.commitStatus === "failed";
  return `<div class="excel-import-stage" data-excel-import-stage="result">
    <div class="excel-import-result${failure ? " excel-import-result--failure" : ""}" role="status" aria-live="polite">
      <h3>${failure ? "Import could not be completed" : summary.importedCount ? "Ready to import" : "No items ready to import"}</h3>
      ${failure ? `<p>No Project changes were saved. ${escapeHtml(view.commitMessage ?? "Review the import and try again.")}</p>` : renderConfirmationSummary(summary)}
    </div>
    ${failure ? "" : renderConfirmationWarnings(summary)}
    ${renderExistingItems(summary, Boolean(disabled))}
    ${failure ? "" : renderCostSummary(summary)}
    ${failure ? "" : renderSkippedRows(summary)}
    <div class="excel-import-actions">
      <button type="button" class="secondary-button" data-excel-import-back="review" ${disabled}>Back to review</button>
      <button type="button" class="primary-button" data-excel-import-commit ${commitDisabled}>${view.commitStatus === "committing" ? "Importing items…" : failure ? "Try import again" : summary.updatedCount ? importOperationText(summary) : summary.importedCount ? `Import ${summary.importedCount} item${summary.importedCount === 1 ? "" : "s"}` : "No items to import"}</button>
    </div>
  </div>`;
}

function renderConfirmationSummary(summary: ExcelImportConfirmationSummary): string {
  return `<p class="excel-import-confirmation-destination">${summary.keepsExistingItems ? "Project" : "New Project"}: <strong>${escapeHtml(summary.destinationLabel)}</strong></p>
    <dl class="excel-import-outcome-counts" aria-label="Import outcome"><div><dt>Add</dt><dd>${summary.addedCount ?? summary.importedCount}</dd></div><div><dt>Update</dt><dd>${summary.updatedCount ?? 0}</dd></div><div><dt>Skip rows</dt><dd>${summary.skippedCount}</dd></div></dl>`;
}

function renderConfirmationWarnings(summary: ExcelImportConfirmationSummary): string {
  const warnings: string[] = [];
  if (summary.unresolvedSkippedCount) warnings.push(`${summary.unresolvedSkippedCount} unresolved item${summary.unresolvedSkippedCount === 1 ? "" : "s"} will be skipped.`);
  const missing = (summary.automaticallySkippedItemCount ?? 0) + (summary.failedItemCount ?? 0);
  if (missing) warnings.push(`${missing} item${missing === 1 ? " could" : "s could"} not be imported. Check skipped rows for missing estimate items.`);
  const comparison = summary.sourceTotalComparison;
  if (comparison && Math.abs(comparison.recalculatedMinusSource) >= 0.005) warnings.push(`Calculated costs are ${formatMoney(Math.abs(comparison.recalculatedMinusSource))} ${comparison.recalculatedMinusSource > 0 ? "above" : "below"} spreadsheet costs for ${comparison.comparedItemCount} compared item${comparison.comparedItemCount === 1 ? "" : "s"}.`);
  return warnings.length ? `<div class="excel-import-confirmation-warnings" role="note" aria-label="Import warnings">${warnings.map((warning) => `<p>${escapeHtml(warning)}</p>`).join("")}</div>` : "";
}

function importOperationText(summary: ExcelImportConfirmationSummary, completed = false): string {
  const added = summary.addedCount ?? summary.importedCount;
  const updated = summary.updatedCount ?? 0;
  const parts: string[] = [];
  if (added) parts.push(completed ? `${added} item${added === 1 ? " was" : "s were"} added` : `Add ${added} item${added === 1 ? "" : "s"}`);
  if (updated) parts.push(completed ? `${updated} item${updated === 1 ? " was" : "s were"} updated` : `${added ? "update" : "Update"} ${updated} existing item${updated === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

function renderExistingItems(summary: ExcelImportConfirmationSummary, busy: boolean): string {
  const plan = summary.existingItemPlan;
  if (!plan?.matches.length) return "";
  const disabled = busy ? "disabled" : "";
  const options = (action: ExistingItemAction, plural: boolean) => ([
    ["add", plural ? "Add as separate items" : "Add as separate item"],
    ["update", plural ? "Update existing items" : "Update existing item"],
    ["skip", plural ? "Skip matching items" : "Skip this item"]
  ] as const).map(([value, label]) => `<option value="${value}" ${action === value ? "selected" : ""}>${label}</option>`).join("");
  const numeric = (value: number | null) => value === null ? "Blank" : value.toLocaleString();
  const separateCount = plan.matches.filter((match) => match.action === "add").length;
  const ambiguousAddCount = plan.matches.filter((match) => match.needsTarget && match.action === "add").length;
  return `<section class="excel-import-existing-items" aria-labelledby="excel-import-existing-title"><div class="excel-import-existing-heading"><h4 id="excel-import-existing-title">Items already in this Project</h4><span>${plan.matches.length} matches</span></div>
    <label class="excel-import-existing-default"><span>Matching items</span><select data-excel-import-existing-default ${disabled}>${options(summary.existingItemAction ?? "add", true)}</select></label>
    ${separateCount ? `<p class="excel-import-match-notice">${separateCount} matching item${separateCount === 1 ? " will" : "s will"} be added again.</p>` : ""}
    ${(summary.updatedCount ?? 0) > 0 ? `<p class="excel-import-match-notice">Updates replace quantity, unit cost, and nonblank notes.</p>` : ""}
    ${ambiguousAddCount && summary.existingItemAction === "update" ? `<p class="excel-import-unresolved-notice">${ambiguousAddCount} ambiguous match${ambiguousAddCount === 1 ? " needs" : "es need"} a target to update; currently added separately.</p>` : ""}
    ${plan.errors.length ? `<p class="excel-import-error" role="alert">${escapeHtml([...new Set(plan.errors)].join(" "))}</p>` : ""}
    <details data-excel-import-existing-details ${summary.existingItemsDetailsOpen || plan.errors.length ? "open" : ""}><summary>Compare matches / individual choices</summary><p class="muted">Matches include Group and cost category. Blank values keep existing values when updating. Changing the matching-items rule resets individual choices.</p><div class="table-scroll"><table><thead><tr><th>Row</th><th>Item / Group</th><th>Existing<small>Quantity / Unit cost</small></th><th>Spreadsheet<small>Quantity / Unit cost</small></th><th>Choice</th></tr></thead><tbody>${plan.matches.map((match) => {
      const target = match.candidates.find((line) => line.lineItemId === match.targetLineItemId) ?? (match.candidates.length === 1 ? match.candidates[0] : null);
      return `<tr><td>${match.incoming.importSource?.rowNumber ?? "—"}</td><td><strong>${escapeHtml(match.incoming.itemCode)}</strong> ${escapeHtml(match.incoming.description)}<small>${escapeHtml(match.incoming.group || "No Group")}</small></td><td>${target ? `${numeric(target.quantity)} / ${target.preferredUnitCost === null ? "Blank" : formatMoney(target.preferredUnitCost)}` : `${match.candidates.length} possible Project rows`}</td><td>${numeric(match.incoming.quantity)} / ${match.incoming.preferredUnitCost === null ? "Blank" : formatMoney(match.incoming.preferredUnitCost)}</td><td><select aria-label="Action for spreadsheet row ${match.incoming.importSource?.rowNumber ?? ""}" data-excel-import-existing-action="${escapeHtml(match.rowId)}" ${disabled}>${options(match.action, false)}</select>${match.needsTarget && match.action !== "skip" ? `<select aria-label="Existing Project row to update" data-excel-import-existing-target="${escapeHtml(match.rowId)}" ${disabled}><option value="">Choose a Project row to update…</option>${match.candidates.map((line, index) => `<option value="${escapeHtml(line.lineItemId)}" ${match.targetLineItemId === line.lineItemId ? "selected" : ""}>Match ${index + 1}: quantity ${numeric(line.quantity)}, unit cost ${line.preferredUnitCost === null ? "Blank" : formatMoney(line.preferredUnitCost)}${line.notes ? `; ${escapeHtml(line.notes)}` : ""}</option>`).join("")}</select>` : ""}</td></tr>`;
    }).join("")}</tbody></table></div></details></section>`;
}

function renderCostSummary(summary: ExcelImportConfirmationSummary): string {
  const construction = summary.keepsExistingItems ? summary.projectedConstructionCost ?? summary.constructionCost : summary.constructionCost;
  const other = summary.keepsExistingItems ? summary.projectedOtherCost ?? summary.otherCost : summary.otherCost;
  const comparison = summary.sourceTotalComparison;
  const comparisonText = comparison
    ? `Spreadsheet total comparison: ${formatMoney(comparison.recalculatedMinusSource)} difference across ${comparison.comparedItemCount} compared items.`
    : "No spreadsheet cost comparison available.";
  return `<section class="excel-import-confirmation-costs" aria-labelledby="excel-import-confirmation-costs-title"><div class="excel-import-cost-heading"><h4 id="excel-import-confirmation-costs-title">Project costs after import</h4><strong>${formatMoney(construction + other)}</strong><small>Before contingency</small></div>
    <details><summary>Cost breakdown</summary><dl><div><dt>Construction Costs</dt><dd>${formatMoney(construction)}</dd></div>${other !== 0 ? `<div><dt>Other Costs</dt><dd>${formatMoney(other)}</dd></div>` : ""}${summary.keepsExistingItems ? `<div><dt>Change from import</dt><dd>${formatMoney((summary.constructionDelta ?? summary.constructionCost) + (summary.otherDelta ?? summary.otherCost))}</dd></div>` : ""}</dl><p class="muted">${escapeHtml(comparisonText)}</p></details></section>`;
}

function renderSkippedRows(summary: ExcelImportConfirmationSummary): string {
  if (!summary.skippedCount) return "";
  const compactReason = (label: string) => {
    if (label.includes("left unresolved")) return "Unresolved items";
    if (label.includes("automatically skipped")) return "Items without a supported import choice";
    if (label.includes("blank rows")) return "Blank rows, headings, or totals";
    if (label.includes("existing Project")) return "Matching items skipped";
    if (label.includes("outside")) return "Outside selected data";
    if (label.includes("during review")) return "Skipped in review";
    if (label.includes("prepared")) return "Items that could not be imported";
    return "Other excluded rows";
  };
  return `<details class="excel-import-skipped-summary"><summary>Skipped rows (${summary.skippedCount})</summary><ul>${summary.skippedReasons.map((reason) => `<li><strong>${reason.count}</strong> ${escapeHtml(compactReason(reason.label))}</li>`).join("")}</ul><button type="button" class="secondary-button" data-excel-import-download-report>Download skipped-row report</button></details>`;
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
    if (isSkipOnlyReviewRow(row)) return false;
    const kind = reviewRowKind(row);
    if (kind === "ready" || kind === "custom" || kind === "skipped") return false;
    return !view.decisions[row.rowId]?.action;
  });
}

function filteredReviewRows(view: ExcelImportViewModel): MatchedImportRow[] {
  if (view.reviewFilter === "reviewed") return view.rows.filter((row) => !!view.decisions[row.rowId]?.action && !view.decisions[row.rowId]?.automaticallySkipped);
  if (view.reviewFilter === "needs-review") return unresolvedReviewRows(view).filter((row) => reviewIssueFilterMatches(row, view.reviewIssueFilter));
  if (view.reviewFilter === "ready") return view.rows.filter((row) => (reviewRowKind(row) === "ready" || reviewRowKind(row) === "custom") && !view.decisions[row.rowId]?.action);
  if (view.reviewFilter === "excluded") return view.rows.filter((row) => reviewRowKind(row) === "skipped" || view.decisions[row.rowId]?.action === "exclude");
  return view.rows;
}

function reviewIssueFilterMatches(row: MatchedImportRow, filter: ExcelImportReviewIssueFilter): boolean {
  if (filter === "all") return true;
  const kind = reviewRowKind(row);
  if (filter === "description") return kind === "descriptionConflict";
  if (filter === "unit") return kind === "unitConflict";
  if (filter === "allowance") return kind === "allowance";
  const missing = kind === "incomplete" || (kind === "unresolved" && !row.values.description.trim());
  return filter === "missing" ? missing : kind === "unresolved" && !missing;
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
