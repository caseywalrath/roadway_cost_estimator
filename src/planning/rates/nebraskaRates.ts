import type { AppData, ItemPriceSummaryRecord, InflationIndexRecord, SourceRecord } from "../../data/schema";
import type { AnnualRateSnapshot, InflationBasis, PlanningResult, PlanningUnit } from "../types";
import { normalizePlanningUnit } from "../units";

export type NebraskaReportSeries = "calendar_year" | "july_june";

export interface NebraskaAnnualRateRequest {
  agencyItemId: string;
  unit: PlanningUnit | string;
  reportSeries?: NebraskaReportSeries;
  periodStart?: string;
  periodEnd?: string;
  /** Required for a reproducible frozen snapshot. */
  capturedAt: string;
  policyVersion?: string;
}

/** Selects one exact NDOT annual row and freezes its complete provenance. */
export function resolveNebraskaAnnualRate(
  data: AppData,
  request: NebraskaAnnualRateRequest,
): PlanningResult<AnnualRateSnapshot> {
  const requestedUnit = normalizePlanningUnit(request.unit);
  if (!requestedUnit) return failure("unit_mismatch", "unit", "The requested Planning unit is not supported.");
  if (!request.agencyItemId.trim()) return failure("missing_rate", "agencyItemId", "An exact Nebraska agency item is required.");
  if (!isIsoDateTime(request.capturedAt)) return failure("invalid_snapshot", "capturedAt", "A valid ISO capture timestamp is required for a frozen rate snapshot.");
  if (Boolean(request.periodStart) !== Boolean(request.periodEnd)) return failure("invalid_snapshot", "window", "Both periodStart and periodEnd are required for an explicit report window.");

  const item = data.agencyItemById.get(request.agencyItemId);
  if (!item || item.state !== "NE" || item.agencyId !== "ne_ndot") {
    return failure("missing_rate", "agencyItemId", "The exact Nebraska agency item is not loaded.");
  }

  const series = request.reportSeries ?? "calendar_year";
  const allSeriesRows = data.itemPriceSummaries.filter((summary) => validSummary(data, summary) && summary.reportSeries === series);
  const globalLatest = allSeriesRows
    .slice().sort((left, right) => right.periodEndDate.localeCompare(left.periodEndDate) || right.periodStartDate.localeCompare(left.periodStartDate))[0];
  const periodStart = request.periodStart ?? globalLatest?.periodStartDate;
  const periodEnd = request.periodEnd ?? globalLatest?.periodEndDate;
  const selected = (data.itemPriceSummariesByAgencyItemId.get(request.agencyItemId) ?? [])
    .filter((summary) => validSummary(data, summary) && summary.reportSeries === series)
    .filter((summary) => summary.periodStartDate === periodStart && summary.periodEndDate === periodEnd);
  if (!periodStart || !periodEnd || selected.length === 0) return failure("missing_rate", "rate", `No ${series} annual report row exists for the exact item and requested window.`);

  const first = selected[0];
  if (selected.length !== 1) return failure("conflicting_rate", "rate", "Duplicate or conflicting annual rows match the exact item, series, and window.");
  const sourceUnit = first.unitRaw;
  const normalizedSourceUnit = normalizePlanningUnit(first.unitNormalized || sourceUnit);
  const interpretedRawUnit = normalizePlanningUnit(sourceUnit);
  if (!sourceUnit.trim() || !normalizedSourceUnit || normalizedSourceUnit !== requestedUnit
    || (interpretedRawUnit !== null && interpretedRawUnit !== normalizedSourceUnit)) {
    return failure("unit_mismatch", "unit", "The annual report unit does not match the requested item unit.");
  }
  if (!Number.isFinite(first.publishedAverageUnitPrice) || first.publishedAverageUnitPrice <= 0) {
    return failure("missing_rate", "rate", "The annual report rate must be positive and finite.");
  }
  const source = data.sourceById.get(first.sourceId);
  if (!source || source.state !== "NE" || source.agencyId !== "ne_ndot" || !source.sourceUrl.trim() || !first.sourceLocator.trim()) {
    return failure("invalid_snapshot", "provenance", "The selected annual row lacks a valid Nebraska source URL or locator.");
  }
  const inflation = annualInflation(data.inflationIndexByPeriod, first);
  const rate = inflation.factor === null ? first.publishedAverageUnitPrice : first.publishedAverageUnitPrice * inflation.factor;
  if (!Number.isFinite(rate) || rate <= 0) return failure("missing_rate", "rate", "The selected annual rate is not positive and finite after adjustment.");

  const snapshot: AnnualRateSnapshot = {
    kind: "ne_annual",
    state: "NE",
    agencyItemId: first.agencyItemId,
    unit: requestedUnit,
    sourceUnit,
    sourceDescription: first.descriptionRaw || item.officialDescription,
    sourceId: first.sourceId,
    summaryId: first.summaryId,
    reportSeries: first.reportSeries,
    periodStart: first.periodStartDate,
    periodEnd: first.periodEndDate,
    sourceUrl: source?.sourceUrl ?? "",
    sourcePage: Number.isFinite(first.sourcePage) ? first.sourcePage : null,
    sourceLocator: first.sourceLocator,
    rawRate: first.publishedAverageUnitPrice,
    rate,
    inflation,
    policyVersion: request.policyVersion ?? "ne-annual-v1",
    capturedAt: request.capturedAt,
  };
  return { ok: true, value: deepFreeze(snapshot), issues: [] };
}

function annualInflation(indexes: ReadonlyMap<string, InflationIndexRecord>, summary: ItemPriceSummaryRecord): InflationBasis {
  const labels = reportWindowQuarters(summary.periodStartDate, summary.periodEndDate);
  const source = labels.map((label) => indexes.get(label));
  const target = [...indexes.values()]
    .filter((row) => Number.isFinite(row.indexValue) && row.indexValue > 0)
    .sort((a, b) => b.periodYear - a.periodYear || b.periodQuarter - a.periodQuarter)[0];
  if (!target || labels.length !== 4 || source.length !== 4 || source.some((row) => !row || row.indexValue <= 0)) {
    return { method: "annual_window_nhcci", availability: "unavailable", targetPeriod: target?.periodLabel ?? null, factor: null, reason: "Complete NHCCI coverage for all four report-window quarters is unavailable." };
  }
  const sourceAverage = source.reduce((sum, row) => sum + row!.indexValue, 0) / 4;
  const factor = target.indexValue / sourceAverage;
  return { method: "annual_window_nhcci", availability: "available", targetPeriod: target.periodLabel, factor, reason: null };
}

function validSummary(data: AppData, summary: ItemPriceSummaryRecord): boolean {
  const source = data.sourceById.get(summary.sourceId);
  return summary.state === "NE" && summary.agencyId === "ne_ndot"
    && isIsoDate(summary.periodStartDate) && isIsoDate(summary.periodEndDate)
    && summary.periodStartDate <= summary.periodEndDate
    && Boolean(summary.sourceLocator.trim())
    && Boolean(source && source.state === "NE" && source.agencyId === "ne_ndot" && source.sourceType === "annual_price_summary" && source.sourceUrl.trim());
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function isIsoDateTime(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(value) && !Number.isNaN(Date.parse(value));
}

function reportWindowQuarters(start: string, end: string): string[] {
  const a = quarter(start), b = quarter(end);
  if (!a || !b) return [];
  const result: string[] = [];
  let year = a.year, q = a.q;
  while (year < b.year || (year === b.year && q <= b.q)) {
    result.push(`${year} Q${q}`); q += 1;
    if (q === 5) { q = 1; year += 1; }
    if (result.length > 4) return [];
  }
  return result;
}

function quarter(value: string): { year: number; q: number } | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value.trim());
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? { year: Number(match[1]), q: Math.floor((month - 1) / 3) + 1 } : null;
}

function failure(code: string, path: string, message: string): PlanningResult<AnnualRateSnapshot> {
  return { ok: false, issues: [{ code, path, message, severity: "error" }] };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
