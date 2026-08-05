import { describe, expect, it } from "vitest";
import { buildItemPriceHistoryCsv } from "./exportItemPriceHistoryCsv";

describe("buildItemPriceHistoryCsv", () => {
  it("exports published values and direct source metadata", () => {
    const csv = buildItemPriceHistoryCsv([{ summary: { state: "NE", agencyId: "ne_ndot", reportSeries: "calendar_year", periodStartDate: "2024-01-01", periodEndDate: "2024-12-31", periodLabel: "2024", agencyItemCode: "100", agencyItemId: "ne_ndot:100", descriptionRaw: "Concrete, test", totalQuantity: 12, unitRaw: "CY", publishedAverageUnitPrice: 4.5, totalBid: 54, sourcePage: 3, sourceLocator: "p. 3" } as never, source: { agencyName: "Nebraska DOT", sourceLabel: "2024 report", sourceUrl: "https://example.test/report.pdf", sourceFileName: "report.pdf" } as never }]);
    expect(csv).toContain("Published Average Unit Price");
    expect(csv).toContain('"Concrete, test"');
    expect(csv).toContain("https://example.test/report.pdf");
  });
});
