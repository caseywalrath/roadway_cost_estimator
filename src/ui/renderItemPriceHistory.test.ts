import { describe, expect, it } from "vitest";
import type { StateConfig } from "../data/schema";
import type { ItemPriceHistoryResult } from "../matching/buildItemPriceHistoryResult";
import { renderItemPriceHistory } from "./renderItemPriceHistory";

const config = {
  code: "NE",
  name: "Nebraska",
  capabilities: { periodPriceHistory: true }
} as StateConfig;

const result = {
  query: { itemCode: "7500.69", description: "Yield line", unit: "EACH" },
  filteredRows: [{
    summary: {
      summaryId: "row",
      periodLabel: "2025",
      reportSeries: "calendar_year",
      agencyItemCode: "7500.69",
      descriptionRaw: "Yield line",
      totalQuantity: 1,
      unitRaw: "EACH",
      publishedAverageUnitPrice: 10,
      totalBid: 10
    },
    source: null
  }],
  filters: { reportSeries: "all", unit: "" },
  availableUnits: ["EACH"],
  sort: { key: "period", direction: "desc" }
} as unknown as ItemPriceHistoryResult;

describe("renderItemPriceHistory", () => {
  it("explains repeated official item descriptions without referring to project bids", () => {
    const html = renderItemPriceHistory(result, config, false, null, false);
    expect(html).toContain("NDOT publishes average item prices for overlapping reporting periods.");
    expect(html).toContain("Some NDOT item numbers share the same official description; use the item number and unit to distinguish them.");
    expect(html).not.toContain("individual project bids");
  });

  it("calls the unit filter the reported unit without exposing catalog status", () => {
    const html = renderItemPriceHistory(result, config, false, null, false);
    expect(html).toContain("Reported unit");
    expect(html).not.toContain("Historical unit");
  });

  it("uses the published period label without repeating the report series in each row", () => {
    const html = renderItemPriceHistory(result, config, false, null, false);
    expect(html).toContain("<tbody><tr><td>2025</td>");
  });

  it("uses the Nebraska table measure label without the published qualifier", () => {
    const html = renderItemPriceHistory(result, { ...config, periodPriceMeasureLabel: "Average Unit Price" }, false, null, false);
    expect(html).toContain(">Average Unit Price</span>");
    expect(html).not.toContain(">Published Average Unit Price</span>");
  });

  it("shows Edit Item Search when the search panel is collapsed", () => {
    const html = renderItemPriceHistory(result, config, false, null, true);
    expect(html).toContain('id="edit-item-search"');
  });

  it("does not duplicate Edit Item Search while the search panel is open", () => {
    const html = renderItemPriceHistory(result, config, false, null, false);
    expect(html).not.toContain('id="edit-item-search"');
  });
});
