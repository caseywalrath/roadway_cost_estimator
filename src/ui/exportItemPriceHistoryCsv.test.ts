import { describe, expect, it } from "vitest";
import { buildItemPriceHistoryCsv } from "./exportItemPriceHistoryCsv";

describe("buildItemPriceHistoryCsv", () => {
  it("exports the eight visible values and source label", () => {
    const csv = buildItemPriceHistoryCsv([{ summary: { state: "NE", agencyId: "ne_ndot", reportSeries: "calendar_year", periodStartDate: "2024-01-01", periodEndDate: "2024-12-31", periodLabel: "2024", agencyItemCode: "100", agencyItemId: "ne_ndot:100", descriptionRaw: "Concrete, test", totalQuantity: 12, unitRaw: "CY", publishedAverageUnitPrice: 4.5, totalBid: 54, sourcePage: 3, sourceLocator: "p. 3" } as never, source: { agencyName: "Nebraska DOT", sourceLabel: "2024 report", sourceUrl: "https://example.test/report.pdf", sourceFileName: "report.pdf" } as never }]);
    expect(csv).toContain("Published Average Unit Price");
    expect(csv).toContain('"Concrete, test"');
    expect(csv.split("\r\n")[0]).toBe("Period,Item No.,Item Description,Total Quantity,Unit,Published Average Unit Price,Total Bid,Source");
    expect(csv).toContain("2024,100,\"Concrete, test\",12,CY,4.5,54,2024 report");
    expect(csv).not.toContain("https://example.test/report.pdf");
  });
});
