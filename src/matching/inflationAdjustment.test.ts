import { describe, expect, it } from "vitest";
import { buildAnnualInflationAdjustedPriceSet } from "./inflationAdjustment";
import type { InflationIndexRecord } from "../data/schema";
import type { ItemPriceHistoryRow } from "./buildItemPriceHistoryResult";

function index(year: number, quarter: number, value: number): InflationIndexRecord {
  return { indexId: `${year}-${quarter}`, indexName: "NHCCI", periodYear: year, periodQuarter: quarter, periodLabel: `${year} Q${quarter}`, periodStartDate: "", periodEndDate: "", indexValue: value, sourceUrl: "", notes: "" };
}
function row(start: string, end: string, price = 100): ItemPriceHistoryRow {
  return { summary: { summaryId: "annual-1", periodStartDate: start, periodEndDate: end, publishedAverageUnitPrice: price } as never, source: null };
}

describe("buildAnnualInflationAdjustedPriceSet", () => {
  it("uses the arithmetic mean of all four report-window quarters", () => {
    const indexes = [index(2024, 1, 100), index(2024, 2, 110), index(2024, 3, 120), index(2024, 4, 130), index(2025, 1, 150)];
    const result = buildAnnualInflationAdjustedPriceSet([row("2024-01-01", "2024-12-31")], new Map(indexes.map((entry) => [entry.periodLabel, entry])));
    expect(result.adjustedAverageUnitPriceBySummaryId.get("annual-1")).toBeCloseTo(130.4347826);
    expect(result.unavailableSummaryIds).toHaveLength(0);
  });

  it("requires all four quarters and preserves negative values when available", () => {
    const missing = [index(2024, 3, 120), index(2024, 4, 130), index(2025, 1, 140), index(2025, 2, 150)];
    const missingResult = buildAnnualInflationAdjustedPriceSet([row("2024-07-01", "2025-06-30")], new Map(missing.slice(1).map((entry) => [entry.periodLabel, entry])));
    expect(missingResult.adjustedAverageUnitPriceBySummaryId).toHaveLength(0);
    expect(missingResult.unavailableSummaryIds.has("annual-1")).toBe(true);

    const availableResult = buildAnnualInflationAdjustedPriceSet([row("2024-07-01", "2025-06-30", -100)], new Map(missing.map((entry) => [entry.periodLabel, entry])));
    expect(availableResult.adjustedAverageUnitPriceBySummaryId.get("annual-1")).toBeLessThan(0);
  });
});
