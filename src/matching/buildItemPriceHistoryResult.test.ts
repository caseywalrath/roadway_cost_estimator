import { describe, expect, it } from "vitest";
import { buildItemPriceHistoryResult, createDefaultItemPriceHistoryFilters, createDefaultItemPriceHistorySort } from "./buildItemPriceHistoryResult";
import type { AppData } from "../data/schema";

const query = { state: "NE", agencyId: "ne_ndot", agencyItemId: "ne_ndot:100", itemCode: "100", description: "Test item", unit: "EA", countyRegion: "", workType: "", estimateYear: 2026, sourceScope: "both" as const, priceTypeScope: "awarded" as const, quantity: null };
const summaries = [
  { summaryId: "old", sourceId: "s1", state: "NE", agencyId: "ne_ndot", agencyItemId: query.agencyItemId, agencyItemCode: "100", periodStartDate: "2022-01-01", periodEndDate: "2022-12-31", periodLabel: "2022", reportSeries: "calendar_year", descriptionRaw: "Test item", totalQuantity: 2, unitRaw: "EA", unitNormalized: "EA", publishedAverageUnitPrice: 9, totalBid: 18, sourcePage: 1, sourceLocator: "p. 1", derivationMethod: "published" },
  { summaryId: "new", sourceId: "s2", state: "NE", agencyId: "ne_ndot", agencyItemId: query.agencyItemId, agencyItemCode: "100", periodStartDate: "2022-07-01", periodEndDate: "2023-06-30", periodLabel: "FY 2023", reportSeries: "july_june", descriptionRaw: "Test item", totalQuantity: 3, unitRaw: "LF", unitNormalized: "LF", publishedAverageUnitPrice: 12, totalBid: 36, sourcePage: 2, sourceLocator: "p. 2", derivationMethod: "published" }
];

function data(): AppData {
  return { agencyItemById: new Map([[query.agencyItemId, { agencyItemId: query.agencyItemId }]]), agencyItems: [], itemPriceSummariesByAgencyItemId: new Map([[query.agencyItemId, summaries]]), sourceById: new Map([["s1", { sourceId: "s1", sourceLabel: "Calendar", agencyName: "NDOT" }], ["s2", { sourceId: "s2", sourceLabel: "Rolling", agencyName: "NDOT" }]]) } as unknown as AppData;
}

describe("buildItemPriceHistoryResult", () => {
  it("keeps overlapping report rows and sorts them by period end descending", () => {
    const result = buildItemPriceHistoryResult(data(), query, createDefaultItemPriceHistoryFilters(), createDefaultItemPriceHistorySort());
    expect(result.filteredRows.map((row) => row.summary.summaryId)).toEqual(["new", "old"]);
    expect(result.availableUnits).toEqual(["EA", "LF"]);
  });

  it("filters a single report series and historical unit without deriving a new price", () => {
    const result = buildItemPriceHistoryResult(data(), query, { reportSeries: "calendar_year", unit: "EA" }, createDefaultItemPriceHistorySort());
    expect(result.filteredRows).toHaveLength(1);
    expect(result.filteredRows[0].summary.publishedAverageUnitPrice).toBe(9);
  });
});
