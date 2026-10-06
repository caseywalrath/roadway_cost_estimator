import type {
  ImportIssue,
  ImportRowDecision,
  MatchedImportRow,
  ResolveDraftOptions,
  ResolvedImportRow
} from "./types";
import { createId, type ProjectLineImportSource, type ProjectLineItem } from "../projectWorkspace";

export function resolveDraftRows(rows: MatchedImportRow[], options: ResolveDraftOptions): ResolvedImportRow[] {
  return rows.map((row) => resolveDraftRow(row, options));
}

export function resolveDraftRow(row: MatchedImportRow, options: ResolveDraftOptions): ResolvedImportRow {
  const decision = options.decisions?.[row.rowId];
  const baseIssues = [...row.issues, ...row.matchIssues];
  const empty = (outcome: ResolvedImportRow["outcome"], issues: ImportIssue[] = baseIssues): ResolvedImportRow => ({
    rowId: row.rowId,
    outcome,
    lineItem: null,
    importSource: null,
    issues,
    recalculatedTotal: null,
    sourceTotalDifference: null
  });
  if (!row.selected || row.issues.some((issue) => issue.code === "hidden-row-excluded" || issue.code === "section-excluded")) {
    return empty("excluded", [...baseIssues, { code: "not-selected", severity: "info", message: "Row was excluded by the current selection." }]);
  }
  if (row.classification === "blank" || row.classification === "repeated-header" || row.classification === "section-heading" || (row.classification === "summary" && decision?.action !== "fixed-allowance")) {
    return empty("excluded", baseIssues);
  }
  if (decision?.action === "exclude") return empty("excluded", [...baseIssues, decision.leftUnresolved
    ? { code: "left-unresolved", severity: "info", message: "Left unresolved during review and skipped from the import." }
    : decision.automaticallySkipped
      ? { code: "automatically-skipped", severity: "warning", message: "Automatically skipped: no supported import choice is available for this row. Check for missing estimate items." }
      : { code: "excluded-by-user", severity: "info", message: "Excluded by user." }]);
  const action = decision?.action;
  const candidate = chooseCandidate(row, decision);
  if (row.matchStatus === "invalid" && action !== "keep-custom" && action !== "correct-fields" && action !== "fixed-allowance") {
    return empty("failed", [...baseIssues, { code: "unresolved-identity", severity: "error", message: "Resolve the missing or invalid item identity before importing." }]);
  }
  if (row.matchStatus === "needs-review" && !action) {
    return empty("failed", [...baseIssues, { code: "resolution-required", severity: "error", message: "This row requires an explicit catalog/custom decision." }]);
  }
  if ((action === "accept-catalog" || action === "use-catalog-description" || action === "accept-description-match") && !candidate) {
    return empty("failed", [...baseIssues, { code: "catalog-choice-required", severity: "error", message: "Choose one catalog candidate before linking this row." }]);
  }
  const isCatalog = Boolean(candidate && (action === "accept-catalog" || action === "use-catalog-description" || action === "accept-description-match" || (!action && row.matchStatus === "catalog-ready")));
  if (row.matchStatus === "needs-review" && action === "keep-custom") {
    // Explicitly retaining the source description/unit produces a custom row.
  } else if (row.matchStatus === "needs-review" && !isCatalog && action !== "correct-fields" && action !== "fixed-allowance") {
    return empty("failed", [...baseIssues, { code: "resolution-required", severity: "error", message: "Choose the canonical catalog values, keep the source as custom, or exclude the row." }]);
  }
  const values = {
    itemCode: decision?.itemCode ?? row.values.itemCode,
    description: decision?.description ?? (isCatalog && candidate ? candidate.officialDescription : row.values.description),
    unit: decision?.unit ?? (isCatalog && candidate ? candidate.officialUnit : row.values.unit),
    quantity: decision && "quantity" in decision ? decision.quantity ?? null : row.values.quantity,
    unitCost: decision && "unitCost" in decision ? decision.unitCost ?? null : row.values.unitCost,
    group: decision?.group ?? row.values.group,
    costCategory: decision?.costCategory ?? row.values.costCategory,
    notes: row.values.notes
  };
  const sourceTotal = decision && "sourceTotal" in decision ? decision.sourceTotal ?? null : row.values.sourceTotal;
  let fixedAllowance = false;
  if (action === "fixed-allowance") {
    if (sourceTotal === null || !Number.isFinite(sourceTotal)) {
      return empty("failed", [...baseIssues, { code: "allowance-total-required", severity: "error", message: "A fixed allowance requires a valid source total." }]);
    }
    fixedAllowance = true;
    values.quantity = 1;
    values.unit = "LS";
    values.unitCost = sourceTotal;
    values.description = (decision?.description ?? values.description) || "Imported allowance";
  }
  const calculated = values.quantity !== null && values.unitCost !== null ? values.quantity * values.unitCost : null;
  const difference = calculated !== null && sourceTotal !== null ? roundCents(calculated - sourceTotal) : null;
  const issues = [...baseIssues];
  if (difference !== null && Math.abs(difference) > 0.01) {
    const possibleRounding = Math.abs(difference) <= 1;
    issues.push({ code: "source-total-difference", severity: possibleRounding ? "warning" : "error", message: `Source total differs from the recalculated total by ${formatMoney(difference)}${possibleRounding ? " (possible rounding)" : ""}.` });
    if (!possibleRounding && !decision?.acknowledgeIssueCodes?.includes("source-total-difference") && !fixedAllowance) {
      return empty("failed", issues);
    }
  }
  const missingNumeric = values.quantity === null || values.unitCost === null;
  if (missingNumeric && action !== "accept-incomplete" && !decision?.acknowledgeIssueCodes?.includes("incomplete")) {
    return empty("failed", [...issues, { code: "incomplete-acknowledgement-required", severity: "error", message: "Missing quantity or unit cost requires explicit acknowledgement or correction." }]);
  }
  const requiredErrors = row.issues.filter((issue) => issue.severity === "error").map((issue) => issue.code);
  const acknowledged = new Set(decision?.acknowledgeIssueCodes ?? []);
  const unacknowledged = requiredErrors.filter((code) => !acknowledged.has(code) && !decisionCorrectsIssue(row, decision, code) && !(action === "accept-incomplete" && code === "formula-cache-missing"));
  if (unacknowledged.length > 0) return empty("failed", [...issues, { code: "row-errors-unacknowledged", severity: "error", message: `Resolve or acknowledge: ${unacknowledged.join(", ")}.` }]);
  if (!values.description.trim()) return empty("failed", [...issues, { code: "missing-description", severity: "error", message: "A meaningful description is required." }]);
  const now = options.now ?? new Date().toISOString();
  const importSource: ProjectLineImportSource = {
    importId: options.importId,
    fileName: basename(options.fileName),
    sheetName: row.locator.sheetName,
    rowNumber: row.locator.rowNumber,
    sourceRange: row.locator.sourceRange,
    importedAt: options.importedAt,
    original: {
      itemCode: row.values.itemCode,
      description: row.values.description,
      unit: row.values.unit,
      quantity: row.values.quantity,
      unitCost: row.values.unitCost,
      total: row.values.sourceTotal
    },
    decisions: decisionCodes(row, decision, isCatalog, fixedAllowance, difference)
  };
  const lineItem = buildProjectLine(row, candidate, isCatalog, values, importSource, options.createLineItemId?.() ?? createId("line"), now, options.state);
  return {
    rowId: row.rowId,
    outcome: missingNumeric ? "imported-incomplete" : "imported",
    lineItem,
    importSource,
    issues,
    recalculatedTotal: calculated,
    sourceTotalDifference: difference
  };
}

export function buildProjectLine(
  row: MatchedImportRow,
  candidate: MatchedImportRow["candidates"][number] | null,
  isCatalog: boolean,
  values: { itemCode: string; description: string; unit: string; quantity: number | null; unitCost: number | null; group: string; costCategory: ProjectLineItem["costCategory"]; notes: string },
  importSource: ProjectLineImportSource,
  lineItemId: string,
  now: string,
  destinationState = ""
): ProjectLineItem {
  return {
    lineItemId,
    lineItemType: isCatalog && candidate ? "catalog" : "custom",
    costCategory: values.costCategory,
    importSource,
    state: candidate?.state ?? destinationState,
    agencyId: isCatalog && candidate ? candidate.agencyId : "",
    agencyItemId: isCatalog && candidate ? candidate.agencyItemId : "",
    group: values.group.trim(),
    itemCode: isCatalog && candidate ? candidate.itemCode : values.itemCode.trim(),
    description: values.description.trim(),
    descriptionOverrideEnabled: !(isCatalog && candidate),
    unit: values.unit.trim(),
    quantity: values.quantity,
    preferredUnitCost: values.unitCost,
    notes: values.notes.trim(),
    evidenceContext: null,
    createdAt: now,
    updatedAt: now
  };
}

function chooseCandidate(row: MatchedImportRow, decision?: ImportRowDecision): MatchedImportRow["candidates"][number] | null {
  if (!decision?.agencyItemId) return row.candidates.length === 1 ? row.candidates[0] : null;
  return row.candidates.find((candidate) => candidate.agencyItemId === decision.agencyItemId) ?? null;
}

function decisionCodes(row: MatchedImportRow, decision: ImportRowDecision | undefined, isCatalog: boolean, fixedAllowance: boolean, difference: number | null): string[] {
  const codes: string[] = [];
  if (isCatalog) codes.push("catalog-linked");
  if (decision?.action) codes.push(`action:${decision.action}`);
  if (row.descriptionComparison === "blank") codes.push("description-filled-from-catalog");
  if (row.unitComparison === "blank") codes.push("unit-filled-from-catalog");
  if (fixedAllowance) codes.push("fixed-allowance");
  if (difference !== null && Math.abs(difference) > 0.01) codes.push("source-total-difference-acknowledged");
  return codes;
}

function basename(value: string): string {
  return value.trim().split(/[\\/]/).pop() || "workbook.xlsx";
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number): string {
  return `${value < 0 ? "-$" : "$"}${Math.abs(value).toFixed(2)}`;
}

function decisionCorrectsIssue(row: MatchedImportRow, decision: ImportRowDecision | undefined, code: string): boolean {
  if (!decision) return false;
  if (code === "invalid-cost-category") return decision.costCategory !== undefined;
  const issue = row.issues.find((candidate) => candidate.code === code);
  if (!issue?.field) return false;
  if (issue.field === "quantity") return "quantity" in decision;
  if (issue.field === "unitCost") return "unitCost" in decision;
  if (issue.field === "sourceTotal") return "sourceTotal" in decision;
  if (issue.field === "description") return decision.description !== undefined;
  if (issue.field === "unit") return decision.unit !== undefined;
  return false;
}
