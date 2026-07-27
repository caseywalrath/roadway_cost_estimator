import { describe, expect, it } from "vitest";
import type { EvidenceResult, EvidenceRow } from "../data/schema";
import { buildEvidenceCsv } from "./exportEvidenceCsv";

describe("matching-project evidence CSV", () => {
  it("exports project number and project control number separately", () => {
    const row = {
      agencyItemId: "sd_sddot_item_009e0010",
      quantity: 1,
      unit: "LS",
      descriptionRaw: "Mobilization",
      awardedBidUnitPrice: 100,
      averageBidUnitPrice: 110,
      engineerEstimateUnitPrice: null,
      dateBasis: "2026-01-01",
      observationIds: ["observation"],
      contract: {
        state: "SD",
        contractId: "contract",
        officialContractId: "",
        projectNumber: "NH 0010(00)17",
        projectControlNumber: "04UQ",
        callOrder: "1",
        lettingStatus: "AWARDED",
        route: "",
        workType: "",
        awardedVendor: "Bidder"
      },
      project: null,
      source: null
    } as unknown as EvidenceRow;
    const result = {
      filteredRows: [row],
      query: { itemCode: "009E0010" }
    } as unknown as EvidenceResult;

    const csv = buildEvidenceCsv(result);

    expect(csv).toContain("Project no.,Project control no.");
    expect(csv).toContain("NH 0010(00)17,04UQ");
  });
});
