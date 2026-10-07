import { describe, expect, it } from "vitest";
import { pilotManualRate, pilotManualReason, PILOT_MANUAL_RATES } from "./pilotDefaults";

describe("pilot-2 manual defaults", () => {
  it("defines exactly the frozen Colorado tack and sidewalk/ramp defaults", () => {
    expect(PILOT_MANUAL_RATES).toHaveLength(3);
    expect(pilotManualRate("CO", "resurfacing", "tack")).toMatchObject({
      packageVersion: "pilot-2",
      unit: "SY",
      rate: 0.5,
    });
    expect(pilotManualRate("NE", "sidewalk", "ramps_crossings")).toMatchObject({
      packageVersion: "pilot-2",
      unit: "EACH",
      rate: 2500,
    });
    expect(pilotManualRate("CO", "sidewalk", "ramps_crossings")).toMatchObject({
      packageVersion: "pilot-2",
      unit: "EACH",
      rate: 4000,
    });
  });

  it("requires evidence, basis, included scope, and exclusions for every default", () => {
    for (const entry of PILOT_MANUAL_RATES) {
      expect(entry.evidence.trim()).not.toBe("");
      expect(entry.basis.trim()).not.toBe("");
      expect(entry.included.trim()).not.toBe("");
      expect(entry.excluded.trim()).not.toBe("");
      expect(pilotManualReason(entry)).toContain("pilot-2 provisional default");
      expect(pilotManualReason(entry)).toContain(entry.basis);
      expect(pilotManualReason(entry)).toContain(entry.evidence);
      expect(pilotManualReason(entry)).toContain(entry.included);
      expect(pilotManualReason(entry)).toContain(entry.excluded);
    }
  });
});
