import type { PlanningResult, PlanningUnit } from "./types";

const ALIASES: Record<string, PlanningUnit> = {
  LF: "LF",
  "LIN FT": "LF",
  "LIN. FT.": "LF",
  FT: "LF",
  SF: "SF",
  "SQ FT": "SF",
  "SQ. FT.": "SF",
  SY: "SY",
  "SQ YD": "SY",
  "SQ. YD.": "SY",
  CY: "CY",
  "CU YD": "CY",
  "CU. YD.": "CY",
  TON: "TON",
  TONS: "TON",
  GAL: "GAL",
  GALLON: "GAL",
  GALLONS: "GAL",
  EACH: "EACH",
  EA: "EACH",
  LS: "LS",
  "L S": "LS",
  "L.S.": "LS",
  "LUMP SUM": "LS",
};

export function normalizePlanningUnit(raw: string): PlanningUnit | null {
  return ALIASES[raw.trim().toUpperCase()] ?? null;
}

export function convertPlanningQuantity(
  value: number,
  from: PlanningUnit,
  to: PlanningUnit,
): PlanningResult<number> {
  if (!Number.isFinite(value)) {
    return {
      ok: false,
      issues: [{ code: "invalid_number", path: "quantity", message: "Quantity must be a finite number.", severity: "error" }],
    };
  }
  if (value < 0) {
    return {
      ok: false,
      issues: [{ code: "invalid_number", path: "quantity", message: "Quantity cannot be negative.", severity: "error" }],
    };
  }
  if (from === to) return { ok: true, value, issues: [] };
  if ((from === "SF" && to === "SY") || (from === "SY" && to === "SF")) {
    const converted = from === "SF" ? value / 9 : value * 9;
    if (!Number.isFinite(converted)) {
      return {
        ok: false,
        issues: [{ code: "invalid_number", path: "quantity", message: "Converted quantity is not finite.", severity: "error" }],
      };
    }
    return { ok: true, value: converted, issues: [] };
  }
  return {
    ok: false,
    issues: [{ code: "unit_mismatch", path: "unit", message: `Cannot convert ${from} to ${to} in Planning.`, severity: "error" }],
  };
}
