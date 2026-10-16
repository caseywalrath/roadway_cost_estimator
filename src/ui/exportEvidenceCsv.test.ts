import { describe, expect, it } from "vitest";
import type { EvidenceResult, EvidenceRow } from "../data/schema";
import { buildEvidenceCsv } from "./exportEvidenceCsv";

describe("matching-project evidence CSV", () => {
  it("exports the visible columns with compact project and PCN context", () => {
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
      project: {
        projectNumber: "NH 0010(00)17",
        projectControlNumber: "04UQ",
        projectName: "Main St",
        countyRegion: "Adams",
        estimateLetDate: "2026-01-02",
        contractor: "Bidder",
        bidCount: 3,
        district: "1"
      },
      source: null
    } as unknown as EvidenceRow;
    const result = {
      filteredRows: [row],
      query: { itemCode: "009E0010" }
    } as unknown as EvidenceResult;

    const csv = buildEvidenceCsv(result);

    expect(csv.split("\r\n")[0]).toBe("Contract / project,Location,District,Let date,Awarded vendor,Bids,Quantity,Unit,Item description,Awarded Price,Average Price,Engineer Estimate,Source");
    expect(csv).toContain("NH 0010(00)17 • PCN 04UQ,Main St • Adams,1,2026-01-02,Bidder,3,1,LS,Mobilization,100,110,,Unknown source");
    expect(csv).not.toContain("agencyItemId");
  });
});
