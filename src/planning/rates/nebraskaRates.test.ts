import { describe, expect, it } from "vitest";
import type { AppData, AgencyItemRecord, InflationIndexRecord, ItemPriceSummaryRecord, SourceRecord } from "../../data/schema";
import { resolveNebraskaAnnualRate } from "./nebraskaRates";

const item: AgencyItemRecord = {
  agencyItemId: "ne_ndot_3016.65", state: "NE", agencyId: "ne_ndot", agencyName: "NDOT", itemCode: "3016.65",
  currentVersionId: "v", itemStatus: "historical", canonicalItemId: "", officialDescription: "BIKEWAY", officialAbbreviatedDescription: "BIKEWAY", officialUnit: "SY", specReferenceCode: "", agency: "NDOT"
};
const source: SourceRecord = { sourceId: "src-2025", sourceType: "annual_price_summary", agencyId: "ne_ndot", agencyName: "NDOT", state: "NE", sourceLabel: "NDOT 2025", sourceDate: "2025-12-31", dataYear: 2025, sourceUrl: "https://example.test/2025.pdf", sourceFileName: "2025.pdf", sha256: "", parserName: "", parserVersion: "", notes: "", agency: "NDOT" };
const summary = (overrides: Partial<ItemPriceSummaryRecord> = {}): ItemPriceSummaryRecord => ({
  summaryId: "sum-2025", sourceId: "src-2025", state: "NE", agencyId: "ne_ndot", agencyItemId: item.agencyItemId, agencyItemCode: item.itemCode,
  periodStartDate: "2025-01-01", periodEndDate: "2025-12-31", periodLabel: "2025", reportSeries: "calendar_year", descriptionRaw: "BIKEWAY", totalQuantity: 100, unitRaw: "SY", unitNormalized: "SY", publishedAverageUnitPrice: 12, totalBid: 1200, sourcePage: 4, sourceLocator: "row 1", derivationMethod: "published", ...overrides
});
const data = (rows: ItemPriceSummaryRecord[] = [summary()], indexes: InflationIndexRecord[] = [
  { indexId: "1", indexName: "NHCCI", periodYear: 2025, periodQuarter: 1, periodLabel: "2025 Q1", periodStartDate: "2025-01-01", periodEndDate: "2025-03-31", indexValue: 120, sourceUrl: "", notes: "" },
  { indexId: "2", indexName: "NHCCI", periodYear: 2025, periodQuarter: 2, periodLabel: "2025 Q2", periodStartDate: "2025-04-01", periodEndDate: "2025-06-30", indexValue: 120, sourceUrl: "", notes: "" },
  { indexId: "3", indexName: "NHCCI", periodYear: 2025, periodQuarter: 3, periodLabel: "2025 Q3", periodStartDate: "2025-07-01", periodEndDate: "2025-09-30", indexValue: 120, sourceUrl: "", notes: "" },
  { indexId: "4", indexName: "NHCCI", periodYear: 2025, periodQuarter: 4, periodLabel: "2025 Q4", periodStartDate: "2025-10-01", periodEndDate: "2025-12-31", indexValue: 120, sourceUrl: "", notes: "" },
  { indexId: "5", indexName: "NHCCI", periodYear: 2026, periodQuarter: 1, periodLabel: "2026 Q1", periodStartDate: "2026-01-01", periodEndDate: "2026-03-31", indexValue: 132, sourceUrl: "", notes: "" }
]): AppData => ({ itemPriceSummaries: rows, agencyItemById: new Map([[item.agencyItemId, item]]), itemPriceSummariesByAgencyItemId: new Map([[item.agencyItemId, rows.filter((row) => row.agencyItemId === item.agencyItemId)]]), sourceById: new Map([[source.sourceId, source]]), inflationIndexByPeriod: new Map(indexes.map((x) => [x.periodLabel, x])) } as unknown as AppData);
const request = (extra: Record<string, unknown> = {}) => ({ agencyItemId: item.agencyItemId, unit: "SY", capturedAt: "2026-10-07T00:00:00Z", ...extra });

describe("Nebraska annual rate adapter", () => {
  it("selects the latest calendar report and freezes adjusted provenance", () => {
    const result = resolveNebraskaAnnualRate(data(), request());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.summaryId).toBe("sum-2025");
    expect(result.value.rate).toBeCloseTo(13.2, 10);
    expect(result.value.inflation.availability).toBe("available");
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(result.value.sourceUrl).toContain("2025.pdf");
  });

  it("honors an explicit July-June window", () => {
    const row = summary({ summaryId: "july", reportSeries: "july_june", periodStartDate: "2024-07-01", periodEndDate: "2025-06-30", periodLabel: "2024-25", publishedAverageUnitPrice: 8 });
    const result = resolveNebraskaAnnualRate(data([row], []), request({ reportSeries: "july_june", periodStart: "2024-07-01", periodEnd: "2025-06-30" }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.rate).toBe(8);
  });

  it("does not fall back to an older item row when the latest report omits the item", () => {
    const older = summary({ summaryId: "older", periodStartDate: "2024-01-01", periodEndDate: "2024-12-31" });
    const latestOther = summary({ summaryId: "latest-other", agencyItemId: "ne_ndot_other", periodStartDate: "2025-01-01", periodEndDate: "2025-12-31" });
    const result = resolveNebraskaAnnualRate(data([older, latestOther]), request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("missing_rate");
  });

  it("preserves raw rate when the NHCCI window is incomplete", () => {
    const result = resolveNebraskaAnnualRate(data([summary()], []), request());
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.inflation.factor).toBeNull();
    if (result.ok) expect(result.value.rate).toBe(12);
  });

  it("returns structured unpriced reasons", () => {
    const zero = resolveNebraskaAnnualRate(data([summary({ publishedAverageUnitPrice: 0 })]), request());
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.issues[0].code).toBe("missing_rate");
    const conflict = resolveNebraskaAnnualRate(data([summary(), summary({ summaryId: "other", publishedAverageUnitPrice: 13 })]), request({ periodStart: "2025-01-01", periodEnd: "2025-12-31" }));
    expect(conflict.ok).toBe(false);
    if (!conflict.ok) expect(conflict.issues[0].code).toBe("conflicting_rate");
  });

  it("rejects one-sided windows and invalid capture timestamps", () => {
    const oneSided = resolveNebraskaAnnualRate(data(), request({ periodStart: "2025-01-01" }));
    expect(oneSided.ok).toBe(false);
    const badCapture = resolveNebraskaAnnualRate(data(), request({ capturedAt: "yesterday" }));
    expect(badCapture.ok).toBe(false);
  });
});
