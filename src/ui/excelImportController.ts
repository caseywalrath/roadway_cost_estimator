import type { AgencyItemRecord, StateConfig } from "../data/schema";
import { projectLineTotal, type ProjectWorkspaceState, type UserProject } from "../projects/projectWorkspace";
import { detectWorkbookLayouts } from "../projects/excelImport/detectLayout";
import { matchRows } from "../projects/excelImport/matchRows";
import { parseRows, validateMapping } from "../projects/excelImport/parseRows";
import { resolveDraftRows } from "../projects/excelImport/resolveDraft";
import type {
  ExcelImportMapping,
  ExcelImportSelection,
  ExcelImportWorkerResponse,
  ExcelRegionSuggestion,
  ExcelWorkbookSnapshot,
  ImportField,
  ImportResolutionAction,
  ImportRowDecision,
  MatchedImportRow,
  ResolvedImportRow
} from "../projects/excelImport/types";
import type { ExcelImportConfirmationSummary, ExcelImportReviewFilter, ExcelImportReviewIssueFilter, ExcelImportStage, ExcelImportViewModel } from "./renderExcelImport";

interface WorkerLike {
  onmessage: ((event: MessageEvent<ExcelImportWorkerResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface ExcelImportReadyDraft {
  importId: string;
  fileName: string;
  importedAt: string;
  state: string;
  agencyId: string;
  destinationProjectMode: "active" | "new";
  newProjectName: string;
  baseProjectId: string | null;
  baseProjectRevision: number | null;
  selection: ExcelImportSelection;
  mapping: ExcelImportMapping;
  rows: MatchedImportRow[];
  decisions: Record<string, ImportRowDecision>;
  resolvedRows: ResolvedImportRow[];
  summary: {
    importedCount: number;
    notImportedCount: number;
    hiddenRowsExcluded: number;
    unselectedSheetCount: number;
    unselectedRegionCount: number;
  };
}

export interface ExcelImportControllerOptions {
  currentStateCode: string;
  currentAgencyId: string;
  agencyItems: AgencyItemRecord[];
  activeProject: UserProject | null;
  projectState?: ProjectWorkspaceState;
  states: StateConfig[];
  onRender: () => void;
  onClose: () => void;
  onReady?: (draft: ExcelImportReadyDraft) => void;
  onCommit?: (draft: ExcelImportReadyDraft) => Promise<string | void> | string | void;
  onDownloadReport?: (draft: ExcelImportReadyDraft) => void;
  workerFactory?: () => WorkerLike;
}

const INITIAL_STAGE: ExcelImportStage = "file";

export class ExcelImportNeedsReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExcelImportNeedsReviewError";
  }
}

export class ExcelImportController {
  private readonly options: ExcelImportControllerOptions;
  private readonly workerFactory: () => WorkerLike;
  private worker: WorkerLike | null = null;
  private operationToken = 0;
  private requestId = "";
  private view: ExcelImportViewModel;
  private selectedFile: File | null = null;
  private readyDraft: ExcelImportReadyDraft | null = null;

  constructor(options: ExcelImportControllerOptions) {
    this.options = options;
    this.workerFactory = options.workerFactory ?? defaultWorkerFactory;
    this.view = this.createInitialView();
  }

  get isOpen(): boolean { return true; }
  get viewModel(): ExcelImportViewModel { return this.view; }

  open(): void {
    this.view = this.createInitialView();
    this.selectedFile = null;
    this.readyDraft = null;
    this.terminateWorker();
    this.options.onRender();
  }

  /** Testable/UI adapter entry point for the file input change event. */
  async selectFile(file: File): Promise<void> {
    await this.readFile(file);
  }

  dispose(): void {
    this.operationToken += 1;
    this.terminateWorker();
    this.selectedFile = null;
    this.readyDraft = null;
  }

  cancel(): void {
    this.dispose();
    this.options.onClose();
  }

  bind(root: HTMLElement): void {
    const wizard = root.querySelector<HTMLElement>("[data-excel-import-wizard]");
    if (!wizard) return;
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-cancel]")?.addEventListener("click", () => this.cancel());
    wizard.querySelector<HTMLInputElement>("[data-excel-import-file]")?.addEventListener("change", (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (file) void this.readFile(file);
    });
    wizard.querySelectorAll<HTMLInputElement>("[data-excel-import-project-mode]").forEach((input) => {
      input.addEventListener("change", () => {
        this.view = { ...this.view, destinationProjectMode: input.value === "new" ? "new" : "active" };
        this.options.onRender();
      });
    });
    wizard.querySelector<HTMLInputElement>("[data-excel-import-new-project-name]")?.addEventListener("input", (event) => {
      this.view = { ...this.view, newProjectName: (event.currentTarget as HTMLInputElement).value };
    });
    wizard.querySelectorAll<HTMLButtonElement>("[data-excel-import-next]").forEach((button) => {
      button.addEventListener("click", () => this.next(button.dataset.excelImportNext as ExcelImportStage));
    });
    wizard.querySelectorAll<HTMLButtonElement>("[data-excel-import-back]").forEach((button) => {
      button.addEventListener("click", () => this.back(button.dataset.excelImportBack as ExcelImportStage));
    });
    wizard.querySelectorAll<HTMLButtonElement>("[data-excel-import-step]").forEach((button) => {
      button.addEventListener("click", () => this.openCompletedStep(button.dataset.excelImportStep as ExcelImportStage));
    });
    wizard.querySelector<HTMLSelectElement>("[data-excel-import-sheet]")?.addEventListener("change", (event) => {
      this.selectSheet((event.currentTarget as HTMLSelectElement).value);
    });
    wizard.querySelectorAll<HTMLInputElement>("[data-excel-import-region]").forEach((input) => {
      input.addEventListener("change", () => this.selectRegion(input.value));
    });
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-apply-range]")?.addEventListener("click", () => {
      const start = wizard.querySelector<HTMLInputElement>("[data-excel-import-start-cell]")?.value ?? "";
      const end = wizard.querySelector<HTMLInputElement>("[data-excel-import-end-cell]")?.value ?? "";
      this.applyManualRange(start, end);
    });
    wizard.querySelector<HTMLSelectElement>("[data-excel-import-header-row]")?.addEventListener("change", (event) => {
      const value = (event.currentTarget as HTMLSelectElement).value;
      this.updateMapping({ headerRow: value ? Number(value) : null });
    });
    wizard.querySelector<HTMLDetailsElement>("[data-excel-import-advanced-settings]")?.addEventListener("toggle", (event) => {
      this.view = { ...this.view, advancedSettingsOpen: (event.currentTarget as HTMLDetailsElement).open };
    });
    wizard.querySelectorAll<HTMLSelectElement>("[data-excel-import-field]").forEach((select) => {
      select.addEventListener("change", () => {
        const field = select.dataset.excelImportField as ImportField | undefined;
        if (!field) return;
        this.updateFieldMapping(field, select.value ? Number(select.value) : undefined);
      });
    });
    wizard.querySelector<HTMLSelectElement>("[data-excel-import-group-source]")?.addEventListener("change", (event) => {
      this.updateMapping({ groupSource: (event.currentTarget as HTMLSelectElement).value as ExcelImportMapping["groupSource"] });
    });
    wizard.querySelector<HTMLSelectElement>("[data-excel-import-category-source]")?.addEventListener("change", (event) => {
      this.updateMapping({ categorySource: (event.currentTarget as HTMLSelectElement).value as ExcelImportMapping["categorySource"] });
    });
    wizard.querySelectorAll<HTMLInputElement>("[data-excel-import-section]").forEach((input) => {
      input.addEventListener("change", () => this.toggleSection(input.value, input.checked));
    });
    wizard.querySelectorAll<HTMLInputElement>("[data-excel-import-alternative-section]").forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) this.selectAlternativeSection(input.value);
      });
    });
    wizard.querySelector<HTMLInputElement>("[data-excel-import-include-hidden]")?.addEventListener("change", (event) => {
      this.updateSelection({ includeHiddenRows: (event.currentTarget as HTMLInputElement).checked });
    });
    wizard.querySelectorAll<HTMLElement>("[data-excel-import-review-filter]").forEach((control) => {
      control.addEventListener("click", () => {
        const filter = control.dataset.excelImportReviewFilter as ExcelImportReviewFilter | undefined;
        if (!filter) return;
        this.view = { ...this.view, reviewFilter: filter, reviewPage: 0, selectedReviewRowIds: [] };
        this.options.onRender();
      });
    });
    wizard.querySelector<HTMLSelectElement>("[data-excel-import-review-issue-filter]")?.addEventListener("change", (event) => {
      const filter = (event.currentTarget as HTMLSelectElement).value as ExcelImportReviewIssueFilter;
      if (!isReviewIssueFilter(filter)) return;
      this.view = { ...this.view, reviewFilter: "needs-review", reviewIssueFilter: filter, reviewPage: 0, selectedReviewRowIds: [] };
      this.options.onRender();
    });
    wizard.querySelectorAll<HTMLButtonElement>("[data-excel-import-page]").forEach((button) => {
      button.addEventListener("click", () => {
        const delta = button.dataset.excelImportPage === "next" ? 1 : -1;
        this.view = { ...this.view, reviewPage: Math.max(0, this.view.reviewPage + delta) };
        this.options.onRender();
      });
    });
    wizard.querySelectorAll<HTMLSelectElement>("[data-excel-import-row-action]").forEach((select) => {
      select.addEventListener("change", () => this.setRowAction(select.dataset.excelImportRowAction ?? "", select.value as ImportResolutionAction | ""));
    });
    wizard.querySelectorAll<HTMLInputElement>("[data-excel-import-review-row]").forEach((input) => {
      input.addEventListener("change", () => this.toggleReviewRowSelection(input.dataset.excelImportReviewRow ?? "", input.checked));
    });
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-select-visible]")?.addEventListener("click", () => this.selectReviewRows("visible"));
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-select-filtered]")?.addEventListener("click", () => this.selectReviewRows("filtered"));
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-clear-selection]")?.addEventListener("click", () => this.clearReviewSelection());
    wizard.querySelector<HTMLInputElement>("[data-excel-import-toggle-visible]")?.addEventListener("change", () => this.selectReviewRows("visible"));
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-apply-bulk-action]")?.addEventListener("click", () => {
      const action = wizard.querySelector<HTMLSelectElement>("[data-excel-import-bulk-action]")?.value as ImportResolutionAction | "" | undefined;
      if (action) this.applyBulkReviewAction(action);
    });
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-finish]")?.addEventListener("click", () => this.finish());
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-commit]")?.addEventListener("click", () => void this.commit());
    wizard.querySelector<HTMLButtonElement>("[data-excel-import-download-report]")?.addEventListener("click", () => {
      if (this.readyDraft) this.options.onDownloadReport?.(this.readyDraft);
    });
  }

  private createInitialView(): ExcelImportViewModel {
    return {
      stage: INITIAL_STAGE,
      fileName: null,
      workbook: null,
      detections: [],
      selectedSheetName: null,
      selectedRegionId: null,
      selection: null,
      mapping: null,
      advancedSettingsOpen: false,
      rows: [],
      decisions: {},
      reviewFilter: "all",
      reviewIssueFilter: "all",
      reviewPage: 0,
      selectedReviewRowIds: [],
      readStatus: "idle",
      progressText: "",
      fileSize: null,
      errorMessage: null,
      destinationState: this.options.currentStateCode,
      destinationAgencyId: this.options.currentAgencyId,
      destinationProjectMode: this.options.activeProject ? "active" : "new",
      newProjectName: "",
      confirmation: null,
      resultMessage: null,
      commitStatus: "idle",
      commitMessage: null
    };
  }

  private async readFile(file: File): Promise<void> {
    this.operationToken += 1;
    const token = this.operationToken;
    this.terminateWorker();
    this.readyDraft = null;
    this.selectedFile = file;
    this.requestId = `excel-import-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.view = {
      ...this.createInitialView(),
      fileName: file.name,
      fileSize: file.size,
      readStatus: "reading",
      progressText: "Reading workbook…"
    };
    this.options.onRender();
    try {
      const data = await file.arrayBuffer();
      if (token !== this.operationToken) return;
      const worker = this.workerFactory();
      this.worker = worker;
      worker.onmessage = (event) => this.receiveWorkerMessage(token, event.data);
      worker.onerror = () => this.failRead(token, "The workbook could not be read. Check that it is an unencrypted .xlsx file.");
      worker.postMessage({ type: "read", requestId: this.requestId, fileName: file.name, data }, [data]);
    } catch (error) {
      this.failRead(token, error instanceof Error ? error.message : "The workbook could not be read.");
    }
  }

  private receiveWorkerMessage(token: number, response: ExcelImportWorkerResponse): void {
    if (token !== this.operationToken || response.requestId !== this.requestId) return;
    if (response.type === "progress") {
      this.view = { ...this.view, progressText: response.progress.sheetName ? `Reading ${response.progress.sheetName}…` : "Reading workbook…" };
      this.options.onRender();
      return;
    }
    if (response.type === "error") {
      this.failRead(token, response.error.message);
      return;
    }
    this.terminateWorker();
    this.acceptWorkbook(response.workbook);
  }

  private acceptWorkbook(workbook: ExcelWorkbookSnapshot): void {
    const detections = detectWorkbookLayouts(workbook.sheets);
    const firstSheet = this.preferredSheet(workbook, detections);
    const detection = detections.find((candidate) => candidate.sheetName === firstSheet?.name);
    const region = this.preferredRegion(detection);
    this.view = {
      ...this.view,
      workbook,
      detections,
      selectedSheetName: firstSheet?.name ?? null,
      selectedRegionId: region?.regionId ?? null,
      selection: region ? this.selectionForRegion(region) : null,
      mapping: region ? this.suggestMapping(region) : null,
      decisions: {},
      readStatus: "ready",
      progressText: `Read ${workbook.sheetCount} worksheet${workbook.sheetCount === 1 ? "" : "s"}.`,
      errorMessage: null,
      stage: "file"
    };
    this.options.onRender();
  }

  private failRead(token: number, message: string): void {
    if (token !== this.operationToken) return;
    this.terminateWorker();
    this.view = { ...this.view, readStatus: "error", errorMessage: message, progressText: "" };
    this.options.onRender();
  }

  private selectSheet(sheetName: string): void {
    this.readyDraft = null;
    const detection = this.view.detections.find((candidate) => candidate.sheetName === sheetName);
    const region = this.preferredRegion(detection);
    this.view = {
      ...this.view,
      selectedSheetName: sheetName,
      selectedRegionId: region?.regionId ?? null,
      selection: region ? this.selectionForRegion(region) : null,
      mapping: region ? this.suggestMapping(region) : null,
      decisions: {},
      rows: [],
      reviewPage: 0,
      selectedReviewRowIds: [],
      resultMessage: null,
      errorMessage: null
    };
    this.options.onRender();
  }

  private selectRegion(regionId: string): void {
    const region = this.selectedDetection()?.regions.find((candidate) => candidate.regionId === regionId);
    if (!region) return;
    this.readyDraft = null;
    this.view = { ...this.view, selectedRegionId: regionId, selection: this.selectionForRegion(region), mapping: this.suggestMapping(region), rows: [], decisions: {}, reviewPage: 0, selectedReviewRowIds: [], resultMessage: null, errorMessage: null };
    this.options.onRender();
  }

  private applyManualRange(startText: string, endText: string): void {
    const region = this.selectedDetection()?.regions.find((candidate) => candidate.regionId === this.view.selectedRegionId);
    const start = parseCellAddress(startText);
    const end = parseCellAddress(endText);
    if (!region || !start || !end || start.row > end.row || start.column > end.column) {
      this.view = { ...this.view, errorMessage: "Enter a valid top-left and bottom-right cell range." };
      this.options.onRender();
      return;
    }
    const sheet = this.view.workbook?.sheets.find((candidate) => candidate.name === this.view.selectedSheetName);
    if (!sheet || start.row < 1 || end.row > sheet.rowCount || start.column < 1 || end.column > sheet.columnCount) {
      this.view = { ...this.view, errorMessage: "The selected range is outside the worksheet bounds." };
      this.options.onRender();
      return;
    }
    this.view = {
      ...this.view,
      selection: { ...(this.view.selection ?? this.selectionForRegion(region)), startRow: start.row, endRow: end.row, startColumn: start.column, endColumn: end.column },
      mapping: this.suggestMapping(region, { startRow: start.row, endRow: end.row, startColumn: start.column, endColumn: end.column }),
      rows: [],
      decisions: {},
      errorMessage: null,
      resultMessage: null
    };
    this.readyDraft = null;
    this.options.onRender();
  }

  private selectionForRegion(region: ExcelRegionSuggestion): ExcelImportSelection {
    return {
      sheetName: region.sheetName,
      startRow: region.startRow,
      endRow: region.endRow,
      startColumn: region.startColumn,
      endColumn: region.endColumn,
      includeHiddenRows: false,
      includedSectionIds: region.sections.filter((section) => section.includedByDefault).map((section) => section.sectionId)
    };
  }

  private suggestMapping(
    region: ExcelRegionSuggestion,
    range?: Pick<ExcelImportSelection, "startRow" | "endRow" | "startColumn" | "endColumn">
  ): ExcelImportMapping {
    const candidateHeaders = region.headerCandidates.filter((candidate) => !range || (candidate.rowNumber >= range.startRow && candidate.rowNumber <= range.endRow));
    const header = candidateHeaders.find((candidate) => candidate.rowNumber === region.suggestedHeaderRow) ?? candidateHeaders[0] ?? null;
    const columns: Partial<Record<ImportField, number>> = {};
    header?.recognizedFields.forEach((field) => {
      const column = Object.entries(header.labels).find(([, label]) => {
        const normalized = label.trim().replace(/\s+/g, " ").toLowerCase();
        return normalized && fieldAliases(field).includes(normalized);
      })?.[0];
      if (column) columns[field] = Number(column);
    });
    const firstColumn = range?.startColumn ?? region.startColumn;
    // Estimate sheets often leave the description header blank while labeling
    // Units, Qty, Unit Price, and Total to its right. Treat that unlabeled
    // leading column as the likely description instead of requiring every
    // user to make the same manual correction.
    if (!columns.description && !header?.labels[firstColumn] && Object.keys(columns).length > 0) {
      columns.description = firstColumn;
    }
    return {
      headerRow: header?.rowNumber ?? null,
      columns,
      groupSource: "section",
      categorySource: "construction"
    };
  }

  private updateMapping(patch: Partial<ExcelImportMapping>): void {
    if (!this.view.mapping) return;
    this.view = { ...this.view, mapping: { ...this.view.mapping, ...patch }, rows: [], decisions: {}, reviewPage: 0, selectedReviewRowIds: [], resultMessage: null, errorMessage: null };
    this.readyDraft = null;
    this.options.onRender();
  }

  private updateFieldMapping(field: ImportField, column: number | undefined): void {
    if (!this.view.mapping) return;
    const columns = { ...this.view.mapping.columns };
    if (column === undefined) delete columns[field];
    else columns[field] = column;
    this.updateMapping({ columns });
  }

  private updateSelection(patch: Partial<ExcelImportSelection>): void {
    if (!this.view.selection) return;
    this.view = { ...this.view, selection: { ...this.view.selection, ...patch }, rows: [], decisions: {}, reviewPage: 0, selectedReviewRowIds: [], resultMessage: null, errorMessage: null };
    this.readyDraft = null;
    this.options.onRender();
  }

  private toggleSection(sectionId: string, checked: boolean): void {
    const included = new Set(this.view.selection?.includedSectionIds ?? []);
    if (checked) included.add(sectionId); else included.delete(sectionId);
    this.updateSelection({ includedSectionIds: [...included] });
  }

  private selectAlternativeSection(sectionId: string): void {
    const alternatives = this.selectedDetection()?.regions.find((candidate) => candidate.regionId === this.view.selectedRegionId)?.sections.filter((section) => section.requiresAlternativeChoice) ?? [];
    const included = new Set(this.view.selection?.includedSectionIds ?? []);
    alternatives.forEach((section) => included.delete(section.sectionId));
    included.add(sectionId);
    this.updateSelection({ includedSectionIds: [...included] });
  }

  private next(stage: ExcelImportStage): void {
    if (stage === "sheet") {
      if (this.view.readStatus !== "ready" || !this.view.workbook) return;
      this.view = { ...this.view, stage: "sheet", errorMessage: null };
      this.options.onRender();
      return;
    }
    if (stage === "mapping") {
      if (!this.view.selectedRegionId) {
        this.view = { ...this.view, errorMessage: "Choose a populated worksheet area before mapping columns." };
        this.options.onRender();
        return;
      }
      this.view = { ...this.view, stage: "mapping", errorMessage: null };
      this.options.onRender();
      return;
    }
    if (stage === "review") {
      if (!this.prepareRows()) return;
      this.view = { ...this.view, stage: "review", errorMessage: null };
      this.options.onRender();
    }
  }

  private back(stage: ExcelImportStage): void {
    if (stage === "file") {
      this.view = { ...this.view, stage: "file", errorMessage: null };
    } else if (stage === "sheet") {
      this.view = { ...this.view, stage: "sheet", errorMessage: null };
    } else if (stage === "mapping") {
      this.view = { ...this.view, stage: "mapping", errorMessage: null };
    } else {
      this.view = { ...this.view, stage, resultMessage: null };
    }
    this.options.onRender();
  }

  private openCompletedStep(stage: ExcelImportStage): void {
    if (stage === this.view.stage) return;
    this.back(stage);
  }

  private prepareRows(): boolean {
    const sheet = this.view.workbook?.sheets.find((candidate) => candidate.name === this.view.selectedSheetName);
    const selection = this.view.selection;
    const mapping = this.view.mapping;
    if (!sheet || !selection || !mapping) {
      this.view = { ...this.view, errorMessage: "Choose a worksheet area and map its columns before reviewing rows." };
      this.options.onRender();
      return false;
    }
    const validation = validateMapping(mapping);
    if (validation.length) {
      this.view = { ...this.view, errorMessage: validation.map((issue) => issue.message).join(" ") };
      this.options.onRender();
      return false;
    }
    const sections = this.view.detections.find((candidate) => candidate.sheetName === selection.sheetName)?.regions.find((candidate) => candidate.regionId === this.view.selectedRegionId)?.sections ?? [];
    const parsed = parseRows(sheet, { selection, mapping, sections });
    const matched = matchRows(parsed, {
      state: this.view.destinationState,
      agencyId: this.view.destinationAgencyId,
      agencyItems: this.options.agencyItems,
      existingProject: this.options.activeProject
    });
    const needsAttention = matched.some((row) => requiresReviewDecision(row));
    this.view = {
      ...this.view,
      rows: matched,
      decisions: {},
      reviewFilter: needsAttention ? "needs-review" : "all",
      reviewIssueFilter: "all",
      reviewPage: 0,
      selectedReviewRowIds: [],
      resultMessage: null,
      errorMessage: null
    };
    return true;
  }

  private selectableReviewRows(): MatchedImportRow[] {
    const unresolved = this.view.rows.filter((row) => requiresReviewDecision(row) && !this.decisions()[row.rowId]?.action);
    if (this.view.reviewFilter !== "needs-review") return [];
    return unresolved.filter((row) => reviewIssueFilterMatches(row, this.view.reviewIssueFilter));
  }

  private toggleReviewRowSelection(rowId: string, selected: boolean): void {
    const selectableIds = new Set(this.selectableReviewRows().map((row) => row.rowId));
    if (!selectableIds.has(rowId)) return;
    const next = new Set(this.view.selectedReviewRowIds.filter((id) => selectableIds.has(id)));
    if (selected) next.add(rowId); else next.delete(rowId);
    this.view = { ...this.view, selectedReviewRowIds: [...next] };
    this.options.onRender();
  }

  private selectReviewRows(scope: "visible" | "filtered"): void {
    const rows = this.selectableReviewRows();
    const pageStart = this.view.reviewPage * 50;
    const targetRows = scope === "visible" ? rows.slice(pageStart, pageStart + 50) : rows;
    const targetIds = new Set(targetRows.map((row) => row.rowId));
    const selected = new Set(this.view.selectedReviewRowIds.filter((id) => rows.some((row) => row.rowId === id)));
    const allSelected = targetRows.length > 0 && targetRows.every((row) => selected.has(row.rowId));
    if (scope === "visible" && allSelected) targetIds.forEach((id) => selected.delete(id));
    else targetIds.forEach((id) => selected.add(id));
    this.view = { ...this.view, selectedReviewRowIds: [...selected] };
    this.options.onRender();
  }

  private clearReviewSelection(): void {
    if (!this.view.selectedReviewRowIds.length) return;
    this.view = { ...this.view, selectedReviewRowIds: [] };
    this.options.onRender();
  }

  private applyBulkReviewAction(action: ImportResolutionAction): void {
    const selected = new Set(this.view.selectedReviewRowIds);
    const rows = this.selectableReviewRows().filter((row) => selected.has(row.rowId));
    if (!rows.length || !rows.every((row) => availableReviewActions(row).includes(action))) return;
    const decisions = { ...this.decisions() };
    rows.forEach((row) => {
      decisions[row.rowId] = { action, ...(row.selectedAgencyItemId ? { agencyItemId: row.selectedAgencyItemId } : {}) };
    });
    this.view = { ...this.view, resultMessage: null, decisions, selectedReviewRowIds: [] };
    this.options.onRender();
  }

  private setRowAction(rowId: string, action: ImportResolutionAction | ""): void {
    if (!rowId) return;
    const decisions = { ...this.decisions() };
    if (!action) delete decisions[rowId];
    else {
      const row = this.view.rows.find((candidate) => candidate.rowId === rowId);
      decisions[rowId] = {
        action,
        ...(row?.selectedAgencyItemId ? { agencyItemId: row.selectedAgencyItemId } : {})
      };
    }
    this.view = { ...this.view, resultMessage: null, decisions, selectedReviewRowIds: this.view.selectedReviewRowIds.filter((id) => id !== rowId) };
    this.options.onRender();
  }

  private decisions(): Record<string, ImportRowDecision> {
    return this.view.decisions;
  }

  private finish(): void {
    if (!this.selectedFile || !this.view.selection || !this.view.mapping || !this.view.rows.length) {
      this.view = { ...this.view, errorMessage: "There are no parsed rows to prepare." };
      this.options.onRender();
      return;
    }
    if (this.view.destinationProjectMode === "new" && !this.view.newProjectName.trim()) {
      this.view = { ...this.view, stage: "file", errorMessage: "Enter a name for the new Project before confirming the import." };
      this.options.onRender();
      return;
    }
    const resolvedRows = resolveDraftRows(this.view.rows, {
      importId: this.requestId,
      fileName: this.selectedFile.name,
      importedAt: new Date().toISOString(),
      state: this.view.destinationState,
      decisions: this.decisions()
    });
    const imported = resolvedRows.filter((row) => row.outcome === "imported" || row.outcome === "imported-incomplete").length;
    const failed = resolvedRows.filter((row) => row.outcome === "failed").length;
    const excluded = resolvedRows.filter((row) => row.outcome === "excluded").length;
    const selectedDetection = this.selectedDetection();
    const summary = {
      importedCount: imported,
      notImportedCount: resolvedRows.length - imported,
      hiddenRowsExcluded: this.view.rows.filter((row) => row.hidden && !row.selected).length,
      unselectedSheetCount: Math.max(0, (this.view.workbook?.sheetCount ?? 0) - 1),
      unselectedRegionCount: Math.max(0, (selectedDetection?.regions.length ?? 0) - 1)
    };
    const draft: ExcelImportReadyDraft = {
      importId: this.requestId,
      fileName: this.selectedFile.name,
      importedAt: new Date().toISOString(),
      state: this.view.destinationState,
      agencyId: this.view.destinationAgencyId,
      destinationProjectMode: this.view.destinationProjectMode,
      newProjectName: this.view.newProjectName.trim(),
      baseProjectId: this.view.destinationProjectMode === "active" ? this.options.activeProject?.projectId ?? null : null,
      baseProjectRevision: this.view.destinationProjectMode === "active" ? this.options.activeProject?.revision ?? null : null,
      selection: this.view.selection,
      mapping: this.view.mapping,
      rows: this.view.rows,
      decisions: this.decisions(),
      resolvedRows,
      summary
    };
    this.readyDraft = draft;
    this.options.onReady?.(draft);
    this.view = {
      ...this.view,
      stage: "result",
      confirmation: this.buildConfirmationSummary(draft),
      commitStatus: "idle",
      commitMessage: null,
      resultMessage: null
    };
    this.options.onRender();
  }

  private buildConfirmationSummary(draft: ExcelImportReadyDraft): ExcelImportConfirmationSummary {
    const importedRows = draft.resolvedRows.filter((row) => row.outcome === "imported" || row.outcome === "imported-incomplete");
    const skippedRows = draft.resolvedRows.filter((row) => row.outcome === "excluded" || row.outcome === "failed");
    const sourceRows = importedRows.filter((row) => row.sourceTotalDifference !== null);
    const skippedReasons = new Map<string, number>();
    for (const resolved of skippedRows) {
      const row = draft.rows.find((candidate) => candidate.rowId === resolved.rowId);
      const label = resolved.outcome === "failed"
        ? "could not be prepared"
        : row?.classification === "blank" || row?.classification === "section-heading" || row?.classification === "repeated-header" || row?.classification === "summary"
          ? "were blank rows, headings, or totals"
          : row?.selected === false
            ? "were outside the selected data"
            : draft.decisions[resolved.rowId]?.action === "exclude"
              ? "were skipped during review"
              : "were not included";
      skippedReasons.set(label, (skippedReasons.get(label) ?? 0) + 1);
    }
    const constructionCost = importedRows
      .filter((row) => row.lineItem?.costCategory === "construction")
      .reduce((total, row) => total + projectLineTotal(row.lineItem!), 0);
    const otherCost = importedRows
      .filter((row) => row.lineItem?.costCategory === "other")
      .reduce((total, row) => total + projectLineTotal(row.lineItem!), 0);
    return {
      destinationLabel: draft.destinationProjectMode === "active"
        ? this.options.activeProject?.name ?? "the current Project"
        : draft.newProjectName,
      keepsExistingItems: draft.destinationProjectMode === "active",
      importedCount: importedRows.length,
      skippedCount: skippedRows.length,
      skippedReasons: [...skippedReasons.entries()].map(([label, count]) => ({ label, count })),
      constructionCost,
      otherCost,
      hasOtherCosts: otherCost !== 0,
      sourceTotalComparison: sourceRows.length
        ? {
            comparedItemCount: sourceRows.length,
            recalculatedMinusSource: roundCurrency(sourceRows.reduce((total, row) => total + (row.sourceTotalDifference ?? 0), 0))
          }
        : null
    };
  }

  refreshDestinationProject(project: UserProject | null): void {
    this.options.activeProject = project;
  }

  private async commit(): Promise<void> {
    if (!this.readyDraft || this.view.commitStatus === "committing" || this.view.commitStatus === "committed") return;
    if (!this.options.onCommit) {
      this.view = { ...this.view, commitStatus: "failed", commitMessage: "The application could not provide a Project commit handler." };
      this.options.onRender();
      return;
    }
    this.view = { ...this.view, commitStatus: "committing", commitMessage: null };
    this.options.onRender();
    try {
      await this.options.onCommit(this.readyDraft);
      this.view = { ...this.view, commitStatus: "committed", commitMessage: null };
    } catch (error) {
      if (error instanceof ExcelImportNeedsReviewError) {
        this.view = { ...this.view, stage: "review", commitStatus: "failed", commitMessage: error.message, errorMessage: error.message, resultMessage: null };
      } else {
        this.view = { ...this.view, commitStatus: "failed", commitMessage: error instanceof Error ? error.message : "The import could not be saved. The draft remains available." };
      }
    }
    this.options.onRender();
  }

  private selectedDetection() {
    return this.view.detections.find((candidate) => candidate.sheetName === this.view.selectedSheetName) ?? null;
  }

  private preferredSheet(workbook: ExcelWorkbookSnapshot, detections: ReturnType<typeof detectWorkbookLayouts>): ExcelWorkbookSnapshot["sheets"][number] | null {
    const visible = workbook.sheets.filter((sheet) => sheet.visibility === "visible");
    const candidates = visible.length ? visible : workbook.sheets;
    return candidates.slice().sort((left, right) => this.regionConfidence(right, detections) - this.regionConfidence(left, detections) || left.name.localeCompare(right.name))[0] ?? null;
  }

  private preferredRegion(detection: ReturnType<typeof detectWorkbookLayouts>[number] | undefined): ExcelRegionSuggestion | null {
    return detection?.regions.slice().sort((left, right) => this.regionConfidence(right) - this.regionConfidence(left) || left.regionId.localeCompare(right.regionId))[0] ?? null;
  }

  private regionConfidence(sheet: ExcelWorkbookSnapshot["sheets"][number], detections: ReturnType<typeof detectWorkbookLayouts>): number;
  private regionConfidence(region: ExcelRegionSuggestion): number;
  private regionConfidence(value: ExcelWorkbookSnapshot["sheets"][number] | ExcelRegionSuggestion, detections?: ReturnType<typeof detectWorkbookLayouts>): number {
    const region = "regionId" in value ? value : this.preferredRegion(detections?.find((detection) => detection.sheetName === value.name));
    if (!region) return -1;
    const headerScore = region.headerCandidates[0]?.score ?? 0;
    return (region.confidence === "suggested" ? 10_000 : 0) + headerScore * 100 + Math.min(region.endRow - region.startRow + 1, 999);
  }

  private terminateWorker(): void {
    if (this.worker) this.worker.terminate();
    this.worker = null;
  }
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function requiresReviewDecision(row: MatchedImportRow): boolean {
  if (!row.selected || row.issues.some((issue) => issue.code === "hidden-row-excluded" || issue.code === "section-excluded")) return false;
  if (row.classification === "blank" || row.classification === "repeated-header" || row.classification === "section-heading") return false;
  if (row.classification === "summary" && row.values.sourceTotal !== null) return true;
  if ((!row.values.description.trim() && row.matchStatus !== "catalog-ready") || row.values.quantity === null || row.values.unitCost === null) return true;
  return row.matchStatus === "needs-review" || row.matchStatus === "invalid";
}

function isReviewIssueFilter(value: string): value is ExcelImportReviewIssueFilter {
  return value === "all" || value === "description" || value === "unit" || value === "missing" || value === "allowance";
}

function reviewIssueFilterMatches(row: MatchedImportRow, filter: ExcelImportReviewIssueFilter): boolean {
  if (filter === "all") return true;
  if (row.classification === "summary" && row.values.sourceTotal !== null) return filter === "allowance";
  if ((!row.values.description.trim() && row.matchStatus !== "catalog-ready") || row.values.quantity === null || row.values.unitCost === null) return filter === "missing";
  if (row.descriptionComparison === "different") return filter === "description";
  if (row.unitComparison === "different") return filter === "unit";
  return filter === "missing";
}

function availableReviewActions(row: MatchedImportRow): ImportResolutionAction[] {
  if (row.classification === "summary" && row.values.sourceTotal !== null) return ["fixed-allowance", "exclude"];
  if ((!row.values.description.trim() && row.matchStatus !== "catalog-ready") || row.values.quantity === null || row.values.unitCost === null) return ["accept-incomplete", "exclude"];
  if (row.descriptionComparison === "different") return ["use-catalog-description", "keep-custom", "exclude"];
  if (row.unitComparison === "different") return ["accept-catalog", "keep-custom", "exclude"];
  return ["exclude"];
}

function defaultWorkerFactory(): WorkerLike {
  if (typeof Worker === "undefined") throw new Error("This browser does not support workbook workers.");
  return new Worker(new URL("../projects/excelImport/importWorker.ts", import.meta.url), { type: "module" });
}

function fieldAliases(field: ImportField): string[] {
  const aliases: Record<ImportField, string[]> = {
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
  return aliases[field];
}

function parseCellAddress(value: string): { row: number; column: number } | null {
  const match = /^([A-Z]+)([1-9][0-9]*)$/i.exec(value.trim());
  if (!match) return null;
  let column = 0;
  for (const character of match[1].toUpperCase()) column = column * 26 + character.charCodeAt(0) - 64;
  return { row: Number(match[2]), column };
}
