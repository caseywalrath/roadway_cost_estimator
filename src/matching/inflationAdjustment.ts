import type { EvidenceRow, EvidenceStats, EvidenceSummaryStats, InflationIndexRecord } from "../data/schema";
import { buildEvidenceStatsFromPrices } from "./buildEvidenceResult";

type InflationAdjustablePriceField =
  | "awardedBidUnitPrice"
  | "averageBidUnitPrice"
  | "engineerEstimateUnitPrice";

export interface InflationAdjustedSummary {
  stats: EvidenceStats | null;
  summaryStats: EvidenceSummaryStats;
  targetPeriod: InflationIndexRecord | null;
  adjustedRowCount: number;
  missingIndexCount: number;
  awardedRowCount: number;
}

export interface InflationAdjustedPriceSet {
  targetPeriod: InflationIndexRecord | null;
  awardedBidUnitPriceByRowId: Map<string, number>;
  averageBidUnitPriceByRowId: Map<string, number>;
  engineerEstimateUnitPriceByRowId: Map<string, number>;
}

export function buildInflationAdjustedSummary(
  rows: EvidenceRow[],
  indexByPeriod: ReadonlyMap<string, InflationIndexRecord>
): InflationAdjustedSummary {
  const targetPeriod = latestInflationIndex([...indexByPeriod.values()]);
  const awarded = buildInflationAdjustedStatsForField(rows, "awardedBidUnitPrice", indexByPeriod, targetPeriod);
  const average = buildInflationAdjustedStatsForField(rows, "averageBidUnitPrice", indexByPeriod, targetPeriod);
  const engineer = buildInflationAdjustedStatsForField(rows, "engineerEstimateUnitPrice", indexByPeriod, targetPeriod);

  return {
    stats: awarded.stats,
    summaryStats: {
      awarded: awarded.stats,
      average: average.stats,
      engineer: engineer.stats
    },
    targetPeriod,
    adjustedRowCount: awarded.adjustedRowCount + average.adjustedRowCount + engineer.adjustedRowCount,
    missingIndexCount: awarded.missingIndexCount + average.missingIndexCount + engineer.missingIndexCount,
    awardedRowCount: awarded.sourcePriceCount
  };
}

export function buildInflationAdjustedPriceSet(
  rows: EvidenceRow[],
  indexByPeriod: ReadonlyMap<string, InflationIndexRecord>
): InflationAdjustedPriceSet {
  const targetPeriod = latestInflationIndex([...indexByPeriod.values()]);
  const priceSet: InflationAdjustedPriceSet = {
    targetPeriod,
    awardedBidUnitPriceByRowId: new Map<string, number>(),
    averageBidUnitPriceByRowId: new Map<string, number>(),
    engineerEstimateUnitPriceByRowId: new Map<string, number>()
  };

  if (!targetPeriod) {
    return priceSet;
  }

  for (const row of rows) {
    const adjustedAwardedPrice = adjustedUnitPrice(row, "awardedBidUnitPrice", indexByPeriod, targetPeriod);
    if (adjustedAwardedPrice !== null) {
      priceSet.awardedBidUnitPriceByRowId.set(row.rowId, adjustedAwardedPrice);
    }

    const adjustedAveragePrice = adjustedUnitPrice(row, "averageBidUnitPrice", indexByPeriod, targetPeriod);
    if (adjustedAveragePrice !== null) {
      priceSet.averageBidUnitPriceByRowId.set(row.rowId, adjustedAveragePrice);
    }

    const adjustedEngineerPrice = adjustedUnitPrice(row, "engineerEstimateUnitPrice", indexByPeriod, targetPeriod);
    if (adjustedEngineerPrice !== null) {
      priceSet.engineerEstimateUnitPriceByRowId.set(row.rowId, adjustedEngineerPrice);
    }
  }

  return priceSet;
}

export function periodLabelFromDate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(value.trim());

  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return null;
  }

  const quarter = Math.floor((month - 1) / 3) + 1;
  return `${year} Q${quarter}`;
}

function buildInflationAdjustedStatsForField(
  rows: EvidenceRow[],
  field: InflationAdjustablePriceField,
  indexByPeriod: ReadonlyMap<string, InflationIndexRecord>,
  targetPeriod: InflationIndexRecord | null
): {
  stats: EvidenceStats | null;
  adjustedRowCount: number;
  missingIndexCount: number;
  sourcePriceCount: number;
} {
  const adjustedPrices: number[] = [];
  let missingIndexCount = 0;
  let sourcePriceCount = 0;

  for (const row of rows) {
    const sourcePrice = row[field];

    if (sourcePrice === null) {
      continue;
    }

    sourcePriceCount += 1;

    if (!targetPeriod) {
      missingIndexCount += 1;
      continue;
    }

    const adjustedPrice = adjustedUnitPrice(row, field, indexByPeriod, targetPeriod);

    if (adjustedPrice === null) {
      missingIndexCount += 1;
      continue;
    }

    adjustedPrices.push(adjustedPrice);
  }

  return {
    stats: buildEvidenceStatsFromPrices(adjustedPrices),
    adjustedRowCount: adjustedPrices.length,
    missingIndexCount,
    sourcePriceCount
  };
}

function adjustedUnitPrice(
  row: EvidenceRow,
  field: InflationAdjustablePriceField,
  indexByPeriod: ReadonlyMap<string, InflationIndexRecord>,
  targetPeriod: InflationIndexRecord
): number | null {
  const sourcePrice = row[field];

  if (sourcePrice === null) {
    return null;
  }

  const sourcePeriodLabel = periodLabelFromDate(row.project?.estimateLetDate || row.dateBasis);
  const sourcePeriod = sourcePeriodLabel ? indexByPeriod.get(sourcePeriodLabel) : null;

  if (!sourcePeriod) {
    return null;
  }

  return sourcePrice * (targetPeriod.indexValue / sourcePeriod.indexValue);
}

function latestInflationIndex(indexes: InflationIndexRecord[]): InflationIndexRecord | null {
  return indexes
    .filter((index) => Number.isFinite(index.indexValue) && index.indexValue > 0)
    .sort((left, right) =>
      right.periodYear - left.periodYear || right.periodQuarter - left.periodQuarter
    )[0] ?? null;
}
