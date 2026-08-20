// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { AppData, EvidenceResult } from "../data/schema";
import { COLORADO_NON_CDOT_PROJECT, COLORADO_STATEWIDE_OR_UNASSIGNED_DISTRICT } from "../matching/buildEvidenceResult";
import { readEvidenceFiltersFromForm, renderResults } from "./renderResults";

const result = {
  query: {
    state: "CO",
    agencyId: "CDOT",
    agencyItemId: "item",
    countyRegion: "",
    workType: "",
    estimateYear: 0,
    sourceScope: "all",
    priceTypeScope: "all",
    itemCode: "101",
    description: "Test item",
    unit: "EACH",
    quantity: null
  },
  filters: {
    sourceType: "all",
    geography: "",
    districts: [],
    letDateMin: null,
    letDateMax: null,
    yearMin: null,
    yearMax: null,
    quantityMin: null,
    quantityMax: null,
    priceMin: null,
    priceMax: null,
    unit: ""
  },
  sort: { key: "projectNumber", direction: "asc" },
  interpretedDescription: "Test item",
  allExactRows: [],
  filteredRows: [{
    rowId: "row",
    contract: null,
    project: null,
    source: null,
    agencyItemId: "item",
    itemCode: "101",
    descriptionRaw: "Test item",
    unit: "EACH",
    quantity: 1,
    dateBasis: "2025",
    awardedBidUnitPrice: 10,
    averageBidUnitPrice: null,
    engineerEstimateUnitPrice: null,
    bidderDetailKey: "",
    hasBidderDetails: false,
    hasSourceDetails: false,
    observationIds: []
  }],
  unitExcludedCount: 0,
  availableUnits: ["EACH"],
  availableDistricts: ["1", COLORADO_STATEWIDE_OR_UNASSIGNED_DISTRICT, COLORADO_NON_CDOT_PROJECT],
  stats: null,
  notes: []
} as unknown as EvidenceResult;

const data = {
  stateConfig: {
    code: "CO",
    capabilities: {
      periodPriceHistory: false,
      districtFilter: true,
      engineerEstimate: true
    },
    sourceTypeLabels: {}
  },
  lettings: [{ lettingDate: "1997-04-15" }],
  contracts: [],
  observations: [{}]
} as unknown as AppData;

const historyResult = { query: {}, allExactRows: [] } as never;

describe("renderResults", () => {
  it("uses the sticky-results scroll region for matching project tables", () => {
    const html = renderResults(
      result,
      false,
      false,
      data,
      null,
      new Set(),
      1,
      0,
      null,
      { awarded: null, average: null, engineer: null },
      false,
      null,
      null,
      "",
      historyResult,
      null
    );

    expect(html).toContain('class="table-scroll table-scroll--sticky-results"');
    expect(html).toContain('<table class="evidence-table matching-projects-table">');
    expect(html).toContain('<th class="evidence-exclude-header">Exclude</th>');
    expect(html).toContain("Location");
    expect(html).toContain('placeholder="Project, county, route, or location"');
    expect(html).toContain('<span>Dist.</span>');
    expect(html).toContain('<span>Bids</span>');
    expect(html).toContain('<span>Qty.</span>');
    expect(html).toContain('aria-label="Sort by District ascending"');
    expect(html).toContain('aria-label="Sort by Bid count ascending"');
    expect(html).toContain('aria-label="Sort by Quantity ascending"');
    expect(html).toContain('<span>Awarded Price</span>');
    expect(html).toContain('<span>Average Price</span>');
    expect(html).toContain('<span>Engineer Estimate</span>');
    expect(html).toContain("Price range");
    expect(html).toContain('name="priceMin"');
    expect(html).toContain('name="priceMax"');
    expect(html).toContain("Statewide / unassigned");
    expect(html).toContain("Non-CDOT project");
    expect(html).not.toContain(">Apply</button>");
    expect(html).toContain('<legend>Let date</legend>');
    expect(html).toContain('<input name="letDateMin" type="date" min="1997-04-15" max="1997-04-15" value="" />');
    const today = new Date();
    const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    expect(html).toContain(`<input name="letDateMax" type="date" min="1997-04-15" max="${todayIso}" value="" />`);
  });

  it("reads the Awarded Price bounds from the filter form", () => {
    const form = document.createElement("form");
    form.innerHTML = `
      <input name="sourceType" value="all" />
      <input name="geography" value="" />
      <input name="letDateMin" value="2024-01-01" />
      <input name="letDateMax" value="2024-06-30" />
      <input name="quantityMin" value="" />
      <input name="quantityMax" value="" />
      <input name="priceMin" value="12.5" />
      <input name="priceMax" value="125" />
      <select name="unit"><option value="CY" selected>CY</option></select>
    `;

    const filters = readEvidenceFiltersFromForm(form, result.filters);

    expect(filters.priceMin).toBe(12.5);
    expect(filters.priceMax).toBe(125);
    expect(filters.letDateMin).toBe("2024-01-01");
    expect(filters.letDateMax).toBe("2024-06-30");
    expect(filters.yearMin).toBeNull();
    expect(filters.yearMax).toBeNull();
  });

  it("labels active letting-date bounds with readable dates", () => {
    const dateResult = {
      ...result,
      filters: { ...result.filters, letDateMin: "2024-01-01", letDateMax: "2024-06-30" }
    } as unknown as EvidenceResult;

    const html = renderResults(
      dateResult,
      false,
      false,
      data,
      null,
      new Set(),
      1,
      0,
      null,
      { awarded: null, average: null, engineer: null },
      false,
      null,
      null,
      "",
      historyResult,
      null
    );

    expect(html).toContain("Let date: Jan 1, 2024-Jun 30, 2024");
  });
});
