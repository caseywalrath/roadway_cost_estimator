// Planning v2 display formatting and entry parsing. Rules: docs/planning-v2-ui.md sections 2, 3 and 8.
import { roundElementAmount, roundTotalAmount, roundUnitPrice } from "../../planning/calculate";
import type { InputValue, PriceSource, ResolvedElement } from "../../planning/types";

const group = (digits: string): string => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

/** Whole-number text with thousands separators. Negative values keep a leading minus. */
function wholeWithCommas(n: number): string {
  const rounded = Math.round(Math.abs(n));
  return `${n < 0 && rounded !== 0 ? "-" : ""}${group(String(rounded))}`;
}

/** Fixed decimals with thousands separators. */
function fixedWithCommas(n: number, decimals: number): string {
  const text = Math.abs(n).toFixed(decimals);
  const [whole, fraction] = text.split(".");
  const sign = n < 0 && Number(text) !== 0 ? "-" : "";
  return `${sign}${group(whole)}${fraction ? `.${fraction}` : ""}`;
}

const dollars = (n: number): string => (n < 0 ? `-$${wholeWithCommas(-n)}` : `$${wholeWithCommas(n)}`);

/** Nearest $1,000, full dollars with a $ sign: "$1,420,000". */
export const formatElementAmount = (n: number): string => dollars(roundElementAmount(n));

/** Nearest $1,000 without a $ sign, for dollar boxes that show the $ outside: "1,420,000". */
export const formatElementBox = (n: number): string => wholeWithCommas(roundElementAmount(n));

/** Nearest $10,000, full dollars: "$3,730,000". */
export const formatTotalAmount = (n: number): string => dollars(roundTotalAmount(n));

/** Unit price with 2 decimals: "$108.79", "$32,000.00". */
export const formatUnitPrice = (n: number): string => `$${fixedWithCommas(roundUnitPrice(n), 2)}`;

/** Display text for a unit code. */
export function unitLabel(unit: string): string {
  const upper = unit.toUpperCase();
  if (upper === "MILE" || upper === "MI") return "mi";
  if (upper === "EACH" || upper === "EA") return "each";
  return unit;
}

/** Quantity with its unit: "5,867 SY", "0.50 mi", "24 each". */
export function formatQuantity(quantity: number, unit: string): string {
  const label = unitLabel(unit);
  const text = label === "mi" ? fixedWithCommas(quantity, 2) : wholeWithCommas(quantity);
  return `${text} ${label}`;
}

/** Rate as a percent, no decimals unless needed (max 1): 0.3 -> "30%", 0.125 -> "12.5%". */
export function formatPercent(rate: number): string {
  return `${percentNumber(rate)}%`;
}

/** Rate as a bare percent number for an input box: 0.125 -> "12.5". */
export function percentNumber(rate: number): string {
  return String(Math.round(rate * 1000) / 10);
}

/** Multiplier with 2 decimals: "1.86". */
export const formatMultiplier = (n: number): string => n.toFixed(2);

/** A dollar amount exactly as entered, commas added, up to 2 decimals: 1234567 -> "1,234,567". */
export function formatEntered(n: number): string {
  const text = String(Math.round(n * 100) / 100);
  const [whole, fraction] = text.split(".");
  return `${group(whole)}${fraction ? `.${fraction}` : ""}`;
}

/** A plain number for an input box, no commas, up to 4 decimals: 0.5 -> "0.5". */
export function formatPlain(n: number): string {
  return String(Math.round(n * 10000) / 10000);
}

/** Clock time for the save status: "3:07 PM". */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

// ---------- Entry parsing ----------

export type ParsedNumber = { ok: true; value: number | null } | { ok: false };

const NUMBER_PATTERN = /^(\d+(\.\d*)?|\.\d+)$/;

function parseNonNegative(text: string, stripPercent = false): ParsedNumber {
  let cleaned = text.replace(/[$,\s]/g, "");
  if (stripPercent) cleaned = cleaned.replace(/%/g, "");
  if (cleaned === "") return { ok: true, value: null };
  if (!NUMBER_PATTERN.test(cleaned)) return { ok: false };
  const value = Number(cleaned);
  return Number.isFinite(value) ? { ok: true, value } : { ok: false };
}

/** Dollar entry. Blank -> null (use calculated). "0" -> 0. Negative or non-numeric text is invalid. */
export const parseDollar = (text: string): ParsedNumber => parseNonNegative(text);

/** Plain number entry. Blank -> null. With { integer: true }, decimals are invalid. */
export function parseNumber(text: string, options: { integer?: boolean } = {}): ParsedNumber {
  const parsed = parseNonNegative(text);
  if (parsed.ok && parsed.value !== null && options.integer && !Number.isInteger(parsed.value)) return { ok: false };
  return parsed;
}

/** Percent entry, 0 to 100, returned as a fraction (12.5 -> 0.125). Blank is invalid. */
export function parsePercent(text: string): { ok: true; value: number } | { ok: false } {
  const parsed = parseNonNegative(text, true);
  if (!parsed.ok || parsed.value === null || parsed.value > 100) return { ok: false };
  return { ok: true, value: Math.round(parsed.value * 1000) / 100000 };
}

// ---------- Labels ----------

/** Option value for display: yes/no -> Yes/No, strings capitalized, numbers as is. */
export function optionLabel(value: InputValue): string {
  if (typeof value === "number") return String(value);
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}

/** One-line summary of the active, non-advanced inputs for the disclosure line. */
export function inputBrief(element: ResolvedElement, values: Record<string, InputValue>): string {
  const parts: string[] = [];
  for (const input of element.inputs) {
    if (input.advanced || !(input.key in values)) continue;
    const value = values[input.key];
    const label = input.label.toLowerCase();
    if (input.options) {
      if (value === "yes") parts.push(label);
      else if (value === "no") continue;
      else if (typeof value === "number") parts.push(`${formatPlain(value)} ${countLabel(label, value)}`);
      else parts.push(`${label}: ${value}`);
    } else if (typeof value === "number") {
      if (input.unit === "mi") parts.push(`${value.toFixed(2)} mi`);
      else if (input.unit && input.unit !== "count") parts.push(`${formatPlain(value)} ${input.unit}`);
      else parts.push(`${formatPlain(value)} ${countLabel(label, value)}`);
    }
  }
  return parts.length > 0 ? parts.join(" · ") : "Details";
}

/** "1 crossings" → "1 crossing"; labels in the library are plural. */
function countLabel(label: string, value: number): string {
  return value === 1 && label.endsWith("s") ? label.slice(0, -1) : label;
}

/** Source note text and tooltip for a priced component. */
export function sourceNote(source: PriceSource): { text: string; title: string } {
  if (source.kind === "assembly") {
    const basis = source.basis ? source.basis[0].toLowerCase() + source.basis.slice(1) : "";
    return { text: basis ? `Assembly cost, ${basis}` : "Assembly cost", title: "" };
  }
  const pool = source.pool === "urban" ? "urban contracts" : "contracts statewide";
  return {
    text: `CDOT ${source.code}, median of ${source.contracts} ${pool}`,
    title: `Middle half of contract prices: ${formatUnitPrice(source.p25)}–${formatUnitPrice(source.p75)}`
  };
}
