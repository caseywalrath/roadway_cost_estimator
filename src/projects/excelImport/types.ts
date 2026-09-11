import type { AgencyItemRecord } from "../../data/schema";
import type {
  ProjectCostCategory,
  ProjectLineItem,
  ProjectLineImportSource,
  UserProject
} from "../projectWorkspace";

/**
 * Serializable contracts shared by the workbook reader, import worker, and
 * later import-review stages.  These types intentionally preserve physical
 * spreadsheet coordinates instead of reducing a sheet to header-keyed rows.
 */

export type ExcelSheetVisibility = "visible" | "hidden" | "veryHidden";

export type ExcelCellType = "blank" | "string" | "number" | "boolean" | "date" | "error" | "unknown";

export type ExcelCellValue = string | number | boolean | null;

export interface ExcelCellSnapshot {
  /** A1 address, for example C12. */
  address: string;
  /** Original 1-based worksheet row number. */
  rowNumber: number;
  /** Original 1-based worksheet column number. */
  columnNumber: number;
  /** Excel column label, for example C. */
  columnLabel: string;
  type: ExcelCellType;
  /** Typed value read from the workbook cell, or null for a blank/missing value. */
  rawValue: ExcelCellValue;
  /** SheetJS formatted display value, when one exists. */
  formattedText: string;
  /** Formula text without evaluating it. */
  formula: string | null;
  /** True when the source cell contains a formula, including a missing cache. */
  hasFormula: boolean;
  /** Cached formula result, or null when no cached result was stored. */
  cachedValue: ExcelCellValue;
  /** Number format captured from the source cell, when present. */
  numberFormat: string | null;
  /** A1 address of the merge anchor when this cell is covered by a merge. */
  mergeAnchor: string | null;
}

export interface ExcelMergeSnapshot {
  range: string;
  start: { rowNumber: number; columnNumber: number; address: string };
  end: { rowNumber: number; columnNumber: number; address: string };
}

export interface ExcelWorksheetSnapshot {
  name: string;
  visibility: ExcelSheetVisibility;
  range: string | null;
  /** Number of populated cell objects emitted by the sparse reader. */
  populatedCellCount: number;
  /** Highest physical row and column represented by the declared range/cells. */
  rowCount: number;
  columnCount: number;
  cells: ExcelCellSnapshot[];
  merges: ExcelMergeSnapshot[];
  /** Hidden physical rows, expressed as 1-based row numbers. */
  hiddenRows: number[];
  /** Hidden physical columns, expressed as 1-based column numbers. */
  hiddenColumns: number[];
  /** Workbook print-area names that refer to this sheet. */
  printAreas: string[];
}

export interface ExcelWorkbookSnapshot {
  fileName: string;
  workbookType: string;
  sheets: ExcelWorksheetSnapshot[];
  sheetCount: number;
  populatedCellCount: number;
  /** True when a workbook contains defined names that were not print areas. */
  hasDefinedNames: boolean;
}

export interface WorkbookReadLimits {
  maxFileBytes: number;
  maxWorksheets: number;
  maxPopulatedCells: number;
  maxSelectedRows: number;
  maxSelectedColumns: number;
  maxParseMilliseconds: number;
}

export const DEFAULT_WORKBOOK_READ_LIMITS: WorkbookReadLimits = Object.freeze({
  maxFileBytes: 20 * 1024 * 1024,
  maxWorksheets: 100,
  maxPopulatedCells: 250_000,
  maxSelectedRows: 20_000,
  maxSelectedColumns: 100,
  maxParseMilliseconds: 30_000
});

export interface WorkbookReadProgress {
  phase: "reading" | "sheet";
  sheetName?: string;
  sheetIndex?: number;
  sheetCount?: number;
  populatedCellCount: number;
}

export interface ReadWorkbookOptions {
  fileName: string;
  limits?: Partial<WorkbookReadLimits>;
  signal?: AbortSignal;
  onProgress?: (progress: WorkbookReadProgress) => void;
}

export type WorkbookReadErrorCode =
  | "cancelled"
  | "file-too-large"
  | "unsupported-extension"
  | "unsupported-format"
  | "encrypted-workbook"
  | "too-many-worksheets"
  | "too-many-cells"
  | "parse-timeout"
  | "parse-failed";

export interface WorkbookReadError {
  code: WorkbookReadErrorCode;
  message: string;
  causeMessage?: string;
}

export interface ExcelImportWorkerReadRequest {
  type: "read";
  requestId: string;
  fileName: string;
  data: ArrayBuffer;
  limits?: Partial<WorkbookReadLimits>;
}

export interface ExcelImportWorkerCancelRequest {
  type: "cancel";
  requestId: string;
}

export type ExcelImportWorkerRequest = ExcelImportWorkerReadRequest | ExcelImportWorkerCancelRequest;

export interface ExcelImportWorkerProgressResponse {
  type: "progress";
  requestId: string;
  progress: WorkbookReadProgress;
}

export interface ExcelImportWorkerSuccessResponse {
  type: "success";
  requestId: string;
  workbook: ExcelWorkbookSnapshot;
}

export interface ExcelImportWorkerErrorResponse {
  type: "error";
  requestId: string;
  error: WorkbookReadError;
}

export type ExcelImportWorkerResponse =
  | ExcelImportWorkerProgressResponse
  | ExcelImportWorkerSuccessResponse
  | ExcelImportWorkerErrorResponse;

export type ImportField =
  | "itemCode"
  | "description"
  | "unit"
  | "quantity"
  | "unitCost"
  | "sourceTotal"
  | "notes"
  | "group"
  | "costCategory";

export const IMPORT_FIELDS: readonly ImportField[] = [
  "itemCode", "description", "unit", "quantity", "unitCost", "sourceTotal", "notes", "group", "costCategory"
];

export type ImportRowClassification = "item" | "section-heading" | "repeated-header" | "summary" | "blank" | "ambiguous";

export interface ExcelHeaderCandidate {
  rowNumber: number;
  score: number;
  recognizedFields: ImportField[];
  labels: Record<number, string>;
  tied: boolean;
}

export interface ExcelSectionSuggestion {
  sectionId: string;
  startRow: number;
  endRow: number;
  title: string;
  defaultCategory: ProjectCostCategory;
  requiresAlternativeChoice: boolean;
  includedByDefault: boolean;
}

export interface ExcelRegionSuggestion {
  regionId: string;
  sheetName: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  headerCandidates: ExcelHeaderCandidate[];
  suggestedHeaderRow: number | null;
  sections: ExcelSectionSuggestion[];
  hiddenRowCount: number;
  hiddenColumnCount: number;
  printArea: string | null;
  confidence: "suggested" | "review";
}

export interface ExcelLayoutDetection {
  sheetName: string;
  regions: ExcelRegionSuggestion[];
  warnings: string[];
}

export interface ExcelImportSelection {
  sheetName: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  includeHiddenRows: boolean;
  includedSectionIds: string[];
  /** Optional additional ranges. When present, physical rows are deduplicated. */
  ranges?: ExcelImportRangeSelection[];
}

export interface ExcelImportRangeSelection {
  rangeId: string;
  startRow: number;
  endRow: number;
  startColumn: number;
  endColumn: number;
  includeHiddenRows: boolean;
  includedSectionIds: string[];
}

export interface ImportSelectionConflict {
  rowNumber: number;
  regionIds: string[];
  message: string;
}

export interface ExcelImportMapping {
  headerRow: number | null;
  columns: Partial<Record<ImportField, number>>;
  groupSource: "mapped" | "section" | "blank";
  categorySource: "mapped" | "section" | "construction";
}

export interface ImportRowLocator {
  sheetName: string;
  rowNumber: number;
  sourceRange: string;
  addresses: string[];
}

export interface ParsedImportValues {
  itemCode: string;
  description: string;
  unit: string;
  quantity: number | null;
  unitCost: number | null;
  sourceTotal: number | null;
  notes: string;
  group: string;
  costCategory: ProjectCostCategory;
}

export type ImportIssueSeverity = "info" | "warning" | "error";

export interface ImportIssue {
  code: string;
  severity: ImportIssueSeverity;
  message: string;
  field?: ImportField;
}

export interface ParsedImportRow {
  rowId: string;
  locator: ImportRowLocator;
  classification: ImportRowClassification;
  values: ParsedImportValues;
  rawValues: Partial<Record<ImportField, string>>;
  issues: ImportIssue[];
  hidden: boolean;
  selected: boolean;
  contributingLocators?: ImportRowLocator[];
  sectionId?: string;
  continuationOfRowId?: string;
}

export interface ParseRowsOptions {
  selection: ExcelImportSelection;
  mapping: ExcelImportMapping;
  sections?: ExcelSectionSuggestion[];
}

export type DescriptionComparison = "blank" | "equivalent" | "different";
export type UnitComparison = "blank" | "equivalent" | "different";
export type ImportMatchStatus = "catalog-ready" | "needs-review" | "custom-ready" | "unmatched" | "invalid";

export interface MatchedImportRow extends ParsedImportRow {
  matchStatus: ImportMatchStatus;
  candidateAgencyItemIds: string[];
  candidates: AgencyItemRecord[];
  selectedAgencyItemId: string | null;
  descriptionComparison: DescriptionComparison;
  unitComparison: UnitComparison;
  duplicateWarning: boolean;
  matchIssues: ImportIssue[];
}

export interface MatchRowsOptions {
  state: string;
  agencyId: string;
  agencyItems: AgencyItemRecord[];
  existingProject?: UserProject | null;
}

export type ImportResolutionAction =
  | "accept-catalog"
  | "use-catalog-description"
  | "keep-custom"
  | "accept-description-match"
  | "correct-fields"
  | "fixed-allowance"
  | "accept-incomplete"
  | "merge-continuation"
  | "exclude";

export interface ImportRowDecision {
  action: ImportResolutionAction;
  agencyItemId?: string;
  itemCode?: string;
  description?: string;
  unit?: string;
  quantity?: number | null;
  unitCost?: number | null;
  sourceTotal?: number | null;
  group?: string;
  costCategory?: ProjectCostCategory;
  acknowledgeIssueCodes?: string[];
}

export interface ResolvedImportRow {
  rowId: string;
  outcome: "imported" | "imported-incomplete" | "excluded" | "failed";
  lineItem: ProjectLineItem | null;
  importSource: ProjectLineImportSource | null;
  issues: ImportIssue[];
  recalculatedTotal: number | null;
  sourceTotalDifference: number | null;
}

export interface ResolveDraftOptions {
  importId: string;
  fileName: string;
  importedAt: string;
  state?: string;
  decisions?: Record<string, ImportRowDecision>;
  now?: string;
  createLineItemId?: () => string;
}
