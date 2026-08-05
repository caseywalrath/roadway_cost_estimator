import { describe, expect, it } from "vitest";
import { mapItemPriceSummary, mapItemTaxonomyMembership } from "./loadData";

describe("optional period-data CSV mappings", () => {
  it("maps signed annual prices and normalizes the state and unit fields", () => {
    const summary = mapItemPriceSummary({
      summary_id: "ne-summary-1",
      source_id: "ne-source-1",
      state: "ne",
      agency_id: "ne_ndot",
      agency_item_id: "ne_ndot_0005.11",
      agency_item_code: "0005.11",
      period_start_date: "2025-07-01",
      period_end_date: "2026-06-30",
      period_label: "July 2025 - June 2026",
      report_series: "july_june",
      description_raw: "TRAFFIC CONTROL MANAGEMENT DEFICIENCY",
      total_quantity: "55",
      unit_raw: "DAY",
      unit_normalized: "DAY",
      published_average_unit_price: "-500.00",
      total_bid: "-27500.00",
      source_page: "2",
      source_locator: "report.pdf#page=2;item=0005.11",
      derivation_method: "ndot_published_period_aggregate"
    });

    expect(summary.state).toBe("NE");
    expect(summary.publishedAverageUnitPrice).toBe(-500);
    expect(summary.totalBid).toBe(-27500);
    expect(summary.sourcePage).toBe(2);
  });

  it("maps taxonomy membership status without applying prefix inference", () => {
    const membership = mapItemTaxonomyMembership({
      membership_id: "ne-membership-1",
      state: "ne",
      agency_id: "ne_ndot",
      agency_item_id: "ne_ndot_1010.00",
      taxonomy_id: "ne-section-205",
      source_id: "ne-specifications-2017",
      match_status: "catalog_exact",
      notes: "Catalog specification reference 205.00"
    });

    expect(membership).toEqual({
      membershipId: "ne-membership-1",
      state: "NE",
      agencyId: "ne_ndot",
      agencyItemId: "ne_ndot_1010.00",
      taxonomyId: "ne-section-205",
      sourceId: "ne-specifications-2017",
      matchStatus: "catalog_exact",
      notes: "Catalog specification reference 205.00"
    });
  });
});
