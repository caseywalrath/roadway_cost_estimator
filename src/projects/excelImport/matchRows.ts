import type { AgencyItemRecord } from "../../data/schema";
import type {
  DescriptionComparison,
  ImportIssue,
  MatchRowsOptions,
  MatchedImportRow,
  ParsedImportRow,
  UnitComparison
} from "./types";

export function matchRows(rows: ParsedImportRow[], options: MatchRowsOptions): MatchedImportRow[] {
  const destinationItems = options.agencyItems
    .filter((item) => sameState(item.state, options.state) && item.agencyId === options.agencyId)
    .slice()
    .sort((left, right) => left.agencyItemId.localeCompare(right.agencyItemId));
  const seenCodes = new Set<string>();
  return rows.map((row) => {
    const code = normalizeImportCode(row.values.itemCode);
    const description = normalizeImportDescription(row.values.description);
    const unit = normalizeImportUnit(row.values.unit);
    const candidates = code
      ? destinationItems.filter((item) => normalizeImportCode(item.itemCode) === code)
      : description
        ? destinationItems.filter((item) => normalizeImportDescription(item.officialDescription) === description && (!unit || unitsEquivalent(unit, item.officialUnit)))
        : [];
    const selected = candidates.length === 1 && code ? candidates[0] : null;
    const descriptionComparison = selected ? compareDescription(row.values.description, selected.officialDescription) : "blank" as DescriptionComparison;
    const unitComparison = selected ? compareUnit(row.values.unit, selected.officialUnit) : "blank" as UnitComparison;
    const matchIssues: ImportIssue[] = [];
    let matchStatus: MatchedImportRow["matchStatus"];
    if (row.classification !== "item" && row.classification !== "ambiguous") {
      matchStatus = row.classification === "blank" || row.classification === "summary" || row.classification === "repeated-header" || row.classification === "section-heading" ? "invalid" : "needs-review";
    } else if (row.continuationOfRowId) {
      matchStatus = "needs-review";
      matchIssues.push({ code: "continuation-row", severity: "warning", message: `Description-only row can be merged into row ${row.continuationOfRowId} or excluded.` });
    } else if (!description && !code) {
      matchStatus = "invalid";
      matchIssues.push({ code: "missing-identity", severity: "error", message: "Provide an item code or meaningful description." });
    } else if (code && candidates.length === 0) {
      matchStatus = description ? "custom-ready" : "invalid";
      if (!description) matchIssues.push({ code: "unknown-code", severity: "error", message: `No catalog item matched code “${row.values.itemCode}”.` });
      else matchIssues.push({ code: "unknown-code", severity: "warning", message: `No catalog item matched code “${row.values.itemCode}”; this row can remain custom.` });
    } else if (candidates.length > 1) {
      matchStatus = "needs-review";
      matchIssues.push({ code: "ambiguous-catalog-match", severity: "error", message: "More than one catalog identity matches this code; choose one or keep the row custom." });
    } else if (!code && candidates.length === 1) {
      matchStatus = "needs-review";
      matchIssues.push({ code: "description-match-needs-acceptance", severity: "warning", message: "A catalog item matches the description; accept it explicitly to link this row." });
    } else if (selected && (descriptionComparison === "different" || unitComparison === "different")) {
      matchStatus = "needs-review";
      if (descriptionComparison === "different") matchIssues.push({ code: "description-conflict", severity: "error", message: "Source description differs from the catalog description." });
      if (unitComparison === "different") matchIssues.push({ code: "unit-conflict", severity: "error", message: "Source unit differs from the catalog unit." });
    } else {
      matchStatus = "catalog-ready";
    }
    const identity = selected?.agencyItemId ?? (candidates.length === 1 ? candidates[0].agencyItemId : code ? `code:${code}` : "");
    const duplicateWarning = Boolean(identity && (seenCodes.has(identity) || options.existingProject?.lineItems.some((line) => line.lineItemType === "catalog" && line.agencyItemId === identity)));
    if (identity) seenCodes.add(identity);
    if (duplicateWarning) matchIssues.push({ code: "duplicate-catalog-item", severity: "warning", message: "This catalog identity already appears in the import or destination Project; the row will remain separate by default." });
    return {
      ...row,
      matchStatus,
      candidateAgencyItemIds: candidates.map((candidate) => candidate.agencyItemId),
      candidates,
      selectedAgencyItemId: selected?.agencyItemId ?? null,
      descriptionComparison,
      unitComparison,
      duplicateWarning,
      matchIssues
    };
  });
}

export function normalizeImportCode(value: string): string {
  return value.trim().toUpperCase();
}

/** Comparison normalization preserves punctuation and numbers while applying NFC and whitespace/case rules. */
export function normalizeImportDescription(value: string): string {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ").toLowerCase();
}

export function normalizeImportUnit(value: string): string {
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ").toUpperCase();
  if (normalized === "EA" || normalized === "EACH") return "EACH";
  if (normalized === "LS" || normalized === "L S" || normalized === "L.S." || normalized === "LUMP SUM") return "LS";
  return normalized;
}

export function unitsEquivalent(left: string, right: string): boolean {
  return Boolean(left.trim() && right.trim()) && normalizeImportUnit(left) === normalizeImportUnit(right);
}

function compareDescription(source: string, canonical: string): DescriptionComparison {
  if (!source.trim()) return "blank";
  return normalizeImportDescription(source) === normalizeImportDescription(canonical) ? "equivalent" : "different";
}

function compareUnit(source: string, canonical: string): UnitComparison {
  if (!source.trim()) return "blank";
  return unitsEquivalent(source, canonical) ? "equivalent" : "different";
}

function sameState(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}
