import type { ItemPriceHistoryResult, ItemPriceHistoryRow } from "../matching/buildItemPriceHistoryResult";

const columns: Array<[string, (row: ItemPriceHistoryRow) => string | number | null]> = [
  ["Period", (row) => row.summary.periodLabel],
  ["Item No.", (row) => row.summary.agencyItemCode],
  ["Item Description", (row) => row.summary.descriptionRaw],
  ["Total Quantity", (row) => row.summary.totalQuantity],
  ["Unit", (row) => row.summary.unitRaw],
  ["Published Average Unit Price", (row) => row.summary.publishedAverageUnitPrice],
  ["Total Bid", (row) => row.summary.totalBid],
  ["Source", (row) => row.source?.sourceLabel ?? null]
];

export function buildItemPriceHistoryCsv(rows: ItemPriceHistoryRow[]): string {
  return [columns.map(([header]) => csvValue(header)).join(","), ...rows.map((row) => columns.map(([, value]) => csvValue(value(row))).join(","))].join("\r\n");
}

export function downloadItemPriceHistoryCsv(result: ItemPriceHistoryResult): void {
  if (result.filteredRows.length === 0) return;
  const blob = new Blob([buildItemPriceHistoryCsv(result.filteredRows)], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filenamePart(result.query.state || "state")}-${filenamePart(result.query.itemCode || "item")}-price-history-${new Date().toISOString().slice(0, 10)}.csv`;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvValue(value: string | number | null): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/u.test(text) && !/^-[0-9]+(?:\.[0-9]+)?$/u.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function filenamePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}
