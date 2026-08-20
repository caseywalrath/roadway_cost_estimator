import { describe, expect, it } from "vitest";
import type { EvidenceRow } from "../data/schema";
import {
  evidenceLocationMatches,
  getEvidenceLocationDisplayValues,
  getEvidenceLocationSearchText
} from "./projectLocation";

function createRow(): EvidenceRow {
  return {
    rowId: "row",
    contract: null,
    project: {
      projectName: "Colorado Boulevard Multimodal Improvements (Arapahoe Road to Dry Creek Road)",
      projectLocationRaw: "Colorado Boulevard Multimodal Improvements (Arapahoe Road to Dry Creek Road)",
      countyRegion: "Arapahoe County",
      route: "Colorado Boulevard",
      contractId: "contract"
    } as EvidenceRow["project"],
    source: { sourceType: "estimate" } as EvidenceRow["source"],
    agencyItemId: "item",
    itemCode: "101",
    descriptionRaw: "Test item",
    unit: "EACH",
    quantity: 1,
    dateBasis: "2026",
    awardedBidUnitPrice: null,
    averageBidUnitPrice: null,
    engineerEstimateUnitPrice: 10,
    bidderDetailKey: "",
    hasBidderDetails: false,
    hasSourceDetails: false,
    observationIds: []
  };
}

describe("project location search", () => {
  it("combines displayed and source location fields while removing duplicates", () => {
    const row = createRow();

    expect(getEvidenceLocationSearchText(row)).toBe(
      "Colorado Boulevard Multimodal Improvements (Arapahoe Road to Dry Creek Road) Arapahoe County Colorado Boulevard"
    );
    expect(getEvidenceLocationDisplayValues(row)).toEqual([
      "Colorado Boulevard Multimodal Improvements (Arapahoe Road to Dry Creek Road)",
      "Arapahoe County"
    ]);
  });

  it.each(["Colorado", "Boulevard", "Multimodal", "Arapahoe", "Dry", "Creek", "Road", "County"]) (
    "matches a search for the location term %s",
    (term) => {
      expect(evidenceLocationMatches(createRow(), term)).toBe(true);
    }
  );

  it("matches location text without requiring original capitalization or punctuation", () => {
    expect(evidenceLocationMatches(createRow(), "dry creek road")).toBe(true);
    expect(evidenceLocationMatches(createRow(), "not in this location")).toBe(false);
  });
});
