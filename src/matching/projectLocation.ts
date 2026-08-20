import type { EvidenceRow } from "../data/schema";
import { normalizeDescription } from "./normalizeDescription";

export interface EvidenceLocationParts {
  projectName: string;
  countyRegion: string;
  rawLocation: string;
  route: string;
}

/**
 * Returns the normalized set of source fields shared by the Location filter
 * and column. Values retain their source wording while duplicate normalized
 * values are removed.
 */
export function getEvidenceLocationParts(row: EvidenceRow): EvidenceLocationParts {
  const seen = new Set<string>();
  return {
    projectName: uniqueLocationValue(row.project?.projectName ?? "", seen),
    countyRegion: uniqueLocationValue(formatCountyRegion(row), seen),
    rawLocation: uniqueLocationValue(row.project?.projectLocationRaw ?? "", seen),
    route: uniqueLocationValue(row.project?.route ?? "", seen)
  };
}

export function getEvidenceLocationSearchText(row: EvidenceRow): string {
  const parts = getEvidenceLocationParts(row);
  return [parts.projectName, parts.countyRegion, parts.rawLocation, parts.route]
    .filter(Boolean)
    .join(" ");
}

export function evidenceLocationMatches(row: EvidenceRow, query: string): boolean {
  const normalizedQuery = normalizeDescription(query);
  return !normalizedQuery || normalizeDescription(getEvidenceLocationSearchText(row)).includes(normalizedQuery);
}

/**
 * Returns the values shown in the Location column: project name first and
 * county or region as supporting text when it is distinct.
 */
export function getEvidenceLocationDisplayValues(row: EvidenceRow): string[] {
  const parts = getEvidenceLocationParts(row);
  return [parts.projectName, parts.countyRegion].filter(Boolean);
}

function formatCountyRegion(row: EvidenceRow): string {
  const countyRegion = row.project?.countyRegion.trim() ?? "";

  if (!countyRegion || row.source?.sourceType !== "cost_book") {
    return countyRegion;
  }

  return countyRegion.replace(/\s*\/\s*CDOT District \d+\s*$/i, "").trim();
}

function uniqueLocationValue(value: string, seen: Set<string>): string {
  const trimmed = value.trim();
  const normalized = normalizeDescription(trimmed);
  if (!normalized || seen.has(normalized)) {
    return "";
  }
  seen.add(normalized);
  return trimmed;
}
