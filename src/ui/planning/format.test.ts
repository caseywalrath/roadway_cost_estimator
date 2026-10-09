import { describe, expect, it } from "vitest";
import rawLibrary from "../../../data/planning/co_element_library.json";
import prices from "../../../public/data/states/co/planning_prices.json";
import { resolveLibrary, validateLibrary } from "../../planning/library";
import type { PriceSource, PriceTable } from "../../planning/types";
import {
  formatClock,
  formatElementAmount,
  formatElementBox,
  formatEntered,
  formatPercent,
  formatQuantity,
  formatTotalAmount,
  formatUnitPrice,
  inputBrief,
  optionLabel,
  parseDollar,
  parseNumber,
  parsePercent,
  sourceNote,
  unitLabel
} from "./format";

const validated = validateLibrary(rawLibrary);
if (!validated.ok) throw new Error("library invalid");
const { library } = resolveLibrary(validated.value, prices as unknown as PriceTable);
const element = (id: string) => {
  const found = library.elements.find((e) => e.id === id);
  if (!found) throw new Error(id);
  return found;
};

describe("amount formatting", () => {
  it("rounds element amounts to $1,000 and totals to $10,000", () => {
    expect(formatElementAmount(1_420_499)).toBe("$1,420,000");
    expect(formatElementAmount(1_420_500)).toBe("$1,421,000");
    expect(formatElementBox(1_420_500)).toBe("1,421,000");
    expect(formatTotalAmount(3_734_999)).toBe("$3,730,000");
    expect(formatTotalAmount(3_735_000)).toBe("$3,740,000");
    expect(formatTotalAmount(23_340_000)).toBe("$23,340,000");
    expect(formatElementAmount(0)).toBe("$0");
  });

  it("formats unit prices with 2 decimals and commas", () => {
    expect(formatUnitPrice(108.789)).toBe("$108.79");
    expect(formatUnitPrice(32000)).toBe("$32,000.00");
  });

  it("formats quantities by unit", () => {
    expect(formatQuantity(5866.6, "SY")).toBe("5,867 SY");
    expect(formatQuantity(0.5, "MILE")).toBe("0.50 mi");
    expect(formatQuantity(24, "EACH")).toBe("24 each");
    expect(formatQuantity(12345.4, "LF")).toBe("12,345 LF");
    expect(unitLabel("CY")).toBe("CY");
  });

  it("formats rates and entered amounts", () => {
    expect(formatPercent(0.3)).toBe("30%");
    expect(formatPercent(0.125)).toBe("12.5%");
    expect(formatEntered(1234567)).toBe("1,234,567");
    expect(formatEntered(1234.5)).toBe("1,234.5");
    expect(formatEntered(0)).toBe("0");
  });

  it("formats a clock time and tolerates bad input", () => {
    expect(formatClock("not a date")).toBe("");
    expect(formatClock("2026-01-01T15:07:00")).toMatch(/3:07\s?PM/);
  });
});

describe("parseDollar", () => {
  it("treats blank as null (use calculated)", () => {
    expect(parseDollar("")).toEqual({ ok: true, value: null });
    expect(parseDollar("   ")).toEqual({ ok: true, value: null });
  });
  it("accepts zero and formatted amounts", () => {
    expect(parseDollar("0")).toEqual({ ok: true, value: 0 });
    expect(parseDollar("$1,200")).toEqual({ ok: true, value: 1200 });
    expect(parseDollar(" 1 200.50 ")).toEqual({ ok: true, value: 1200.5 });
  });
  it("rejects text, negatives, and exponents", () => {
    expect(parseDollar("abc")).toEqual({ ok: false });
    expect(parseDollar("-5")).toEqual({ ok: false });
    expect(parseDollar("1e3")).toEqual({ ok: false });
    expect(parseDollar("1.2.3")).toEqual({ ok: false });
    expect(parseDollar("$")).toEqual({ ok: true, value: null });
  });
});

describe("parseNumber and parsePercent", () => {
  it("rejects decimals for integer fields", () => {
    expect(parseNumber("4", { integer: true })).toEqual({ ok: true, value: 4 });
    expect(parseNumber("4.5", { integer: true })).toEqual({ ok: false });
    expect(parseNumber("4.5")).toEqual({ ok: true, value: 4.5 });
    expect(parseNumber("")).toEqual({ ok: true, value: null });
  });
  it("returns percents as fractions from 0 to 100", () => {
    expect(parsePercent("10")).toEqual({ ok: true, value: 0.1 });
    expect(parsePercent("12.5%")).toEqual({ ok: true, value: 0.125 });
    expect(parsePercent("0")).toEqual({ ok: true, value: 0 });
    expect(parsePercent("100")).toEqual({ ok: true, value: 1 });
    expect(parsePercent("101")).toEqual({ ok: false });
    expect(parsePercent("")).toEqual({ ok: false });
    expect(parsePercent("-1")).toEqual({ ok: false });
  });
});

describe("labels", () => {
  it("capitalizes option values", () => {
    expect(optionLabel("yes")).toBe("Yes");
    expect(optionLabel("asphalt")).toBe("Asphalt");
    expect(optionLabel(2)).toBe("2");
  });

  it("builds the input brief", () => {
    expect(inputBrief(element("base_none"), {})).toBe("Details");
    expect(inputBrief(element("mill_overlay"), { lengthMiles: 0.5, widthFt: 40, thicknessIn: 2, densityLbCf: 145, materialFactor: 1.05 })).toBe("0.50 mi · 40 ft · 2 in");
    expect(inputBrief(element("sidewalk"), { lengthMiles: 0.5, sides: 2, widthFt: 6, existingSidewalk: "yes" })).toBe("0.50 mi · 2 sides · 6 ft · remove existing sidewalk");
    expect(inputBrief(element("sidewalk"), { lengthMiles: 0.5, sides: 1, widthFt: 6, existingSidewalk: "no" })).toBe("0.50 mi · 1 side · 6 ft");
    expect(inputBrief(element("ada_ramps"), { count: 24 })).toBe("24 ramps");
    expect(inputBrief(element("reconstruction"), { lengthMiles: 1, widthFt: 40, existingSurface: "asphalt", newSurface: "concrete", baseDepthIn: 6, excavationDepthIn: 12 })).toContain("new surface: concrete");
  });

  it("describes price sources", () => {
    const item: PriceSource = { kind: "item", itemId: "x", code: "202-00240", description: "d", contracts: 19, pool: "urban", p25: 2.4, p75: 4.1 };
    expect(sourceNote(item)).toEqual({ text: "CDOT 202-00240, median of 19 urban contracts", title: "Middle half of contract prices: $2.40–$4.10" });
    expect(sourceNote({ ...item, pool: "statewide", contracts: 7 }).text).toBe("CDOT 202-00240, median of 7 contracts statewide");
    expect(sourceNote({ kind: "assembly", basis: "Calibration report 4.10" })).toEqual({ text: "Assembly cost, calibration report 4.10", title: "" });
  });
});
