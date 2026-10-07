import { describe, expect, it } from "vitest";
import { buildColoradoContractRateSnapshot } from "./coloradoRates";
import type { AppData } from "../../data/schema";

function fixture(): AppData {
  const observations = [10, 20, 30].map((unitPrice, n) => ({ observationId: `a${n}_awarded_bid`, contractId: "A", sourceId: "s1", agencyItemId: "co_cdot_403-34741", agencyItemCode: "403-34741", descriptionRaw: "mix", descriptionNormalized: "mix", unitRaw: "TON", unitNormalized: "TON", quantity: 1, unitPrice, extendedPrice: unitPrice, discipline: "", priceType: "awarded_bid", dateBasis: `2025-01-${String(10 + n).padStart(2, "0")}`, derivationMethod: "", derivationInputCount: null, projectId: "" }));
  observations.push({ ...observations[0], observationId: "b_awarded_bid", contractId: "B", sourceId: "s1", unitPrice: 100, dateBasis: "2025-02-01" });
  const data = { observations, sources: [{ sourceId: "s1", sourceType: "cost_book", agencyId: "co_cdot", agencyName: "CDOT", state: "CO", sourceLabel: "book", sourceDate: "2025", dataYear: 2025, sourceUrl: "", sourceFileName: "", sha256: "", parserName: "", parserVersion: "", notes: "", agency: "CDOT" }], contracts: [{ contractId: "A", state: "CO", agencyId: "co_cdot", district: "", estimateLetDate: "2025-01-10" }, { contractId: "B", state: "CO", agencyId: "co_cdot", district: "", estimateLetDate: "2025-02-01" }] } as unknown as AppData;
  data.sourceById = new Map(data.sources.map((x) => [x.sourceId, x]));
  data.contractById = new Map(data.contracts.map((x) => [x.contractId, x]));
  data.contractItems = observations.map((o) => ({ contractItemId: o.observationId.replace("_awarded_bid", "_item"), bidTabItemId: "", contractId: o.contractId, sourceId: o.sourceId, agencyItemId: o.agencyItemId, unitNormalized: o.unitNormalized, quantity: o.quantity, sourceLocator: "fixture" } as any));
  data.inflationIndexes = [];
  return data;
}

describe("Colorado contract median adapter", () => {
  it("takes the median within each contract, then the median of contracts", () => {
    const result = buildColoradoContractRateSnapshot(fixture(), { agencyItemId: "co_cdot_403-34741", unit: "TON", capturedAt: "2026-10-07T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.contracts.map((x) => x.medianRate)).toEqual([20, 100]);
      expect(result.value.rate).toBe(60);
    }
  });

  it("uses a concrete inclusive three-year window anchored to the latest valid date", () => {
    const result = buildColoradoContractRateSnapshot(fixture(), { agencyItemId: "co_cdot_403-34741", unit: "TON", capturedAt: "2026-10-07T00:00:00Z" });
    expect(result.ok && result.value.requestedFrom).toBe("2022-02-02");
    expect(result.ok && result.value.requestedTo).toBe("2025-02-01");
    expect(result.ok && result.value.limitedEvidence).toBe(true);
  });

  it("rejects impossible request dates and preserves explicit source filters", () => {
    const data = fixture();
    expect(buildColoradoContractRateSnapshot(data, { agencyItemId: "co_cdot_403-34741", unit: "TON", from: "2025-02-31", capturedAt: "2026-10-07T00:00:00Z" }).ok).toBe(false);
    const result = buildColoradoContractRateSnapshot(data, { agencyItemId: "co_cdot_403-34741", unit: "TON", sourceIds: ["missing"], capturedAt: "2026-10-07T00:00:00Z" });
    expect(result.ok).toBe(false);
  });

  it("fails adjusted mode atomically when one source quarter lacks NHCCI coverage", () => {
    const data = fixture();
    data.inflationIndexes = [{ periodLabel: "2025 Q1", indexValue: 100 } as any];
    data.inflationIndexByPeriod = new Map(data.inflationIndexes.map((x: any) => [x.periodLabel, x]));
    const result = buildColoradoContractRateSnapshot(data, { agencyItemId: "co_cdot_403-34741", unit: "TON", targetQuarter: "2025 Q2", capturedAt: "2026-10-07T00:00:00Z" });
    expect(result.ok).toBe(false);
  });

  it("excludes an observation whose derived contract-item identity is unresolved", () => {
    const data = fixture();
    data.contractItems = data.contractItems.filter((x: any) => x.contractItemId !== "b_item");
    const result = buildColoradoContractRateSnapshot(data, { agencyItemId: "co_cdot_403-34741", unit: "TON", capturedAt: "2026-10-07T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.excludedEvidence.some((x) => x.observationId === "b_awarded_bid")).toBe(true);
  });

  it("fails closed on overlapping contract-item imports from different sources", () => {
    const data = fixture();
    data.contracts[0].officialContractId = "C 001";
    const duplicate = { ...data.observations[0], observationId: "a0_copy_awarded_bid", sourceId: "s2" } as any;
    data.observations.push(duplicate);
    data.sources.push({ ...data.sources[0], sourceId: "s2" } as any);
    data.sourceById = new Map(data.sources.map((x: any) => [x.sourceId, x]));
    data.contractItems.push({ ...data.contractItems[0], contractItemId: "a0_copy_item", sourceId: "s2" } as any);
    const result = buildColoradoContractRateSnapshot(data, { agencyItemId: "co_cdot_403-34741", unit: "TON", capturedAt: "2026-10-07T00:00:00Z" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.excludedEvidence.length).toBeGreaterThan(0);
  });
});
