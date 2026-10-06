import { describe, expect, it } from "vitest";
import { convertPlanningQuantity, normalizePlanningUnit } from "./units";

describe("Planning unit normalization and conversion", () => {
  it.each([
    [" lin. ft. ", "LF"], ["FT", "LF"], ["sq. ft.", "SF"], ["SQ YD", "SY"],
    ["cu. yd.", "CY"], ["tons", "TON"], ["ea", "EACH"], ["l.s.", "LS"],
  ])("normalizes %s to %s", (raw, normalized) => {
    expect(normalizePlanningUnit(raw)).toBe(normalized);
  });

  it("uses only identity and square-foot/square-yard conversions", () => {
    expect(convertPlanningQuantity(63_360, "SF", "SY")).toEqual({ ok: true, value: 7_040, issues: [] });
    expect(convertPlanningQuantity(2_933.3333333333335, "SY", "SF")).toEqual({ ok: true, value: 26_400, issues: [] });
    expect(convertPlanningQuantity(12.5, "TON", "TON")).toEqual({ ok: true, value: 12.5, issues: [] });
    expect(convertPlanningQuantity(1, "LF", "SY")).toMatchObject({ ok: false, issues: [{ code: "unit_mismatch" }] });
    expect(convertPlanningQuantity(-1, "SF", "SF")).toMatchObject({ ok: false, issues: [{ code: "invalid_number" }] });
    expect(convertPlanningQuantity(Number.POSITIVE_INFINITY, "SF", "SY")).toMatchObject({ ok: false, issues: [{ code: "invalid_number" }] });
  });
});
