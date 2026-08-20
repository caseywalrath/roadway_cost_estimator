import { describe, expect, it } from "vitest";
import type { AppData, ContractRecord, ItemObservationRecord, SourceRecord } from "../data/schema";
import {
  buildEvidenceResult,
  COLORADO_NON_CDOT_PROJECT,
  COLORADO_STATEWIDE_OR_UNASSIGNED_DISTRICT,
  createDefaultEvidenceFilters,
  createDefaultEvidenceSort
} from "./buildEvidenceResult";

function makeContract(contractId: string, estimateLetDate = "2025-01-01"): ContractRecord {
  return {
    contractId,
    lettingId: `letting-${contractId}`,
    sourceId: "source",
    state: "CO",
    agencyId: "CDOT",
    officialContractId: contractId,
    callOrder: "1",
    lettingStatus: "Awarded",
    awardedVendor: "Vendor",
    awardedAmount: 100,
    primaryCounty: "Arapahoe County",
    route: "Route",
    workType: "Roadway",
    contractPeriod: "2025",
    dbeGoal: "",
    bidCount: 3,
    location: "Location",
    district: "1",
    terrain: "",
    awardIndex: null,
    projectId: contractId,
    projectName: `Project ${contractId}`,
    agencyOwner: "CDOT",
    countyRegion: "Arapahoe County",
    estimateLetDate,
    projectNumber: contractId,
    projectControlNumber: "",
    projectLocationRaw: "Location",
    contractor: "Vendor",
    awardedBidTotal: 100
  };
}

function makeObservation(contractId: string, priceType: string, unitPrice: number): ItemObservationRecord {
  return {
    observationId: `${contractId}-${priceType}`,
    contractId,
    sourceId: "source",
    agencyItemId: "item",
    agencyItemCode: "101",
    descriptionRaw: "Test item",
    descriptionNormalized: "test item",
    unitRaw: "EACH",
    unitNormalized: "EACH",
    quantity: 1,
    unitPrice,
    extendedPrice: unitPrice,
    discipline: "Roadway",
    priceType,
    dateBasis: "2025",
    derivationMethod: "test",
    derivationInputCount: null,
    projectId: contractId
  };
}

function makeData(observations: ItemObservationRecord[], dates: Record<string, string> = {}): AppData {
  const contracts = [...new Set(observations.map((observation) => observation.contractId))]
    .map((contractId) => makeContract(contractId, dates[contractId] ?? "2025-01-01"));
  const source = { sourceId: "source", sourceType: "bid_tab", sourceLabel: "Source" } as SourceRecord;
  return {
    stateConfig: {
      code: "CO",
      capabilities: { bidderDetail: false, districtFilter: true, engineerEstimate: true, periodPriceHistory: false },
      sourceTypeLabels: {}
    },
    observations,
    contracts,
    sources: [source],
    sourceById: new Map([[source.sourceId, source]]),
    contractById: new Map(contracts.map((contract) => [contract.contractId, contract])),
    agencyItemById: new Map([["item", { agencyItemId: "item", itemCode: "101", officialDescription: "Test item", officialUnit: "EACH" }]]),
    agencyByCode: new Map([["101", [{ agencyItemId: "item", itemCode: "101", state: "CO", agencyId: "CDOT", officialDescription: "Test item", officialUnit: "EACH" }]]]),
    bidsByContractId: new Map(),
    contractItemsByContractId: new Map()
  } as unknown as AppData;
}

describe("buildEvidenceResult filtering", () => {
  it("filters inclusively by Awarded Price and excludes rows without one", () => {
    const data = makeData([
      makeObservation("low", "awarded_bid", 9.99),
      makeObservation("match", "awarded_bid", 10),
      makeObservation("high", "awarded_bid", 20),
      makeObservation("average-only", "average_bid", 15)
    ]);
    const query = {
      state: "CO",
      agencyId: "CDOT",
      agencyItemId: "item",
      itemCode: "101",
      description: "Test item",
      unit: "EACH",
      countyRegion: "",
      workType: "Roadway",
      estimateYear: 2025,
      sourceScope: "both",
      priceTypeScope: "all",
      quantity: null
    } as const;
    const filters = { ...createDefaultEvidenceFilters(query), priceMin: 10, priceMax: 20 };
    const result = buildEvidenceResult(data, query, filters, createDefaultEvidenceSort());

    expect(result.filteredRows.map((row) => row.project?.contractId)).toEqual(["high", "match"]);
    expect(result.filteredRows.every((row) => row.awardedBidUnitPrice !== null)).toBe(true);
  });

  it("filters inclusively by letting date and converts legacy year bounds", () => {
    const observations = [
      makeObservation("before", "awarded_bid", 10),
      makeObservation("start", "awarded_bid", 10),
      makeObservation("middle", "awarded_bid", 10),
      makeObservation("end", "awarded_bid", 10),
      makeObservation("after", "awarded_bid", 10)
    ];
    const dates = {
      before: "2023-12-31",
      start: "2024-01-01",
      middle: "2024-06-15",
      end: "2024-12-31",
      after: "2025-01-01"
    };
    const data = makeData(observations, dates);
    const query = {
      state: "CO",
      agencyId: "CDOT",
      agencyItemId: "item",
      itemCode: "101",
      description: "Test item",
      unit: "EACH",
      countyRegion: "",
      workType: "Roadway",
      estimateYear: 2025,
      sourceScope: "both",
      priceTypeScope: "all",
      quantity: null
    } as const;
    const baseFilters = createDefaultEvidenceFilters(query);
    const dateResult = buildEvidenceResult(data, query, {
      ...baseFilters,
      letDateMin: "2024-01-01",
      letDateMax: "2024-12-31"
    });
    expect(dateResult.filteredRows.map((row) => row.project?.contractId)).toEqual(["end", "middle", "start"]);

    const legacyResult = buildEvidenceResult(data, query, {
      ...baseFilters,
      yearMin: 2024,
      yearMax: 2024
    });
    expect(legacyResult.filters.letDateMin).toBe("2024-01-01");
    expect(legacyResult.filters.letDateMax).toBe("2024-12-31");
    expect(legacyResult.filters.yearMin).toBeNull();
    expect(legacyResult.filters.yearMax).toBeNull();
    expect(legacyResult.filteredRows.map((row) => row.project?.contractId)).toEqual(["end", "middle", "start"]);
  });

  it("filters Colorado statewide/unassigned and non-CDOT project categories", () => {
    const data = makeData([
      makeObservation("blank", "awarded_bid", 10),
      makeObservation("statewide", "awarded_bid", 11),
      makeObservation("local-blank", "awarded_bid", 12),
      makeObservation("local-district", "awarded_bid", 13)
    ]);
    data.stateConfig.defaultAgencyId = "co_cdot";
    const blank = data.contractById.get("blank")!;
    blank.district = "";
    blank.agencyId = "co_cdot";
    const statewide = data.contractById.get("statewide")!;
    statewide.district = "0";
    statewide.agencyId = "co_cdot";
    const localBlank = data.contractById.get("local-blank")!;
    localBlank.district = "";
    localBlank.agencyId = "co_local";
    const localDistrict = data.contractById.get("local-district")!;
    localDistrict.district = "1";
    localDistrict.agencyId = "co_local";

    const query = {
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "item",
      itemCode: "101",
      description: "Test item",
      unit: "EACH",
      countyRegion: "",
      workType: "Roadway",
      estimateYear: 2025,
      sourceScope: "both",
      priceTypeScope: "all",
      quantity: null
    } as const;
    const baseFilters = createDefaultEvidenceFilters(query);
    const statewideResult = buildEvidenceResult(data, query, {
      ...baseFilters,
      districts: [COLORADO_STATEWIDE_OR_UNASSIGNED_DISTRICT]
    });
    expect(statewideResult.filteredRows.map((row) => row.project?.contractId)).toEqual(["blank", "local-blank", "statewide"]);
    expect(statewideResult.availableDistricts).toContain(COLORADO_STATEWIDE_OR_UNASSIGNED_DISTRICT);
    expect(statewideResult.availableDistricts).toContain(COLORADO_NON_CDOT_PROJECT);
    expect(statewideResult.availableDistricts).not.toContain("0");
    expect(statewideResult.availableDistricts).not.toContain("00");

    const nonCdotResult = buildEvidenceResult(data, query, {
      ...baseFilters,
      districts: [COLORADO_NON_CDOT_PROJECT]
    });
    expect(nonCdotResult.filteredRows.map((row) => row.project?.contractId)).toEqual(["local-blank", "local-district"]);

    const legacySelectedResult = buildEvidenceResult(data, query, {
      ...baseFilters,
      districts: ["00"]
    });
    expect(legacySelectedResult.filters.districts).toEqual([COLORADO_STATEWIDE_OR_UNASSIGNED_DISTRICT]);
  });
});
