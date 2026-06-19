import type { EvidenceRow, EvidenceStats, InflationIndexRecord } from "../data/schema";
import { buildEvidenceStatsFromPrices } from "./buildEvidenceResult";

export interface InflationAdjustedSummary {
  stats: EvidenceStats | null;
  targetPeriod: InflationIndexRecord | null;
  adjustedRowCount: number;
  missingIndexCount: number;
  awardedRowCount: number;
}

export function buildInflationAdjustedSummary(
  rows: EvidenceRow[],
  indexByPeriod: ReadonlyMap<string, InflationIndexRecord>
): InflationAdjustedSummary {
  const targetPeriod = latestInflationIndex([...indexByPeriod.values()]);
  const adjustedPrices: number[] = [];
  let awardedRowCount = 0;
  let missingIndexCount = 0;

  if (!targetPeriod) {
    const awardedRows = rows.filter((row) => row.awardedBidUnitPrice !== null);
    return {
      stats: null,
      targetPeriod: null,
      adjustedRowCount: 0,
      missingIndexCount: awardedRows.length,
      awardedRowCount: awardedRows.length
    };
  }

  for (const row of rows) {
    if (row.awardedBidUnitPrice === null) {
      continue;
    }

    awardedRowCount += 1;

    const sourcePeriodLabel = periodLabelFromDate(row.project?.estimateLetDate || row.dateBasis);
    const sourcePeriod = sourcePeriodLabel ? indexByPeriod.get(sourcePeriodLabel) : null;

    if (!sourcePeriod) {
      missingIndexCount += 1;
      continue;
    }

    adjustedPrices.push(row.awardedBidUnitPrice * (targetPeriod.indexValue / sourcePeriod.indexValue));
  }

  return {
    stats: buildEvidenceStatsFromPrices(adjustedPrices),
    targetPeriod,
    adjustedRowCount: adjustedPrices.length,
    missingIndexCount,
    awardedRowCount
  };
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

function latestInflationIndex(indexes: InflationIndexRecord[]): InflationIndexRecord | null {
  return indexes
    .filter((index) => Number.isFinite(index.indexValue) && index.indexValue > 0)
    .sort((left, right) =>
      right.periodYear - left.periodYear || right.periodQuarter - left.periodQuarter
    )[0] ?? null;
}
