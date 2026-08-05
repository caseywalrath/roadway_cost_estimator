import type { AppData, ItemPriceSummaryRecord, SearchQuery, SortDirection, SourceRecord } from "../data/schema";

export type ItemPriceHistorySortKey = "period" | "itemCode" | "description" | "quantity" | "unit" | "averageUnitPrice" | "totalBid" | "source";

export interface ItemPriceHistoryFilters {
  reportSeries: "all" | "calendar_year" | "july_june";
  unit: string;
}

export interface ItemPriceHistorySort {
  key: ItemPriceHistorySortKey;
  direction: SortDirection;
}

export interface ItemPriceHistoryRow {
  summary: ItemPriceSummaryRecord;
  source: SourceRecord | null;
}

export interface ItemPriceHistoryResult {
  query: SearchQuery;
  filters: ItemPriceHistoryFilters;
  sort: ItemPriceHistorySort;
  allExactRows: ItemPriceHistoryRow[];
  filteredRows: ItemPriceHistoryRow[];
  availableUnits: string[];
}

export function createDefaultItemPriceHistoryFilters(): ItemPriceHistoryFilters {
  return { reportSeries: "all", unit: "" };
}

export function createDefaultItemPriceHistorySort(): ItemPriceHistorySort {
  return { key: "period", direction: "desc" };
}

export function buildItemPriceHistoryResult(
  data: AppData,
  query: SearchQuery,
  filters: ItemPriceHistoryFilters,
  sort: ItemPriceHistorySort
): ItemPriceHistoryResult {
  const agencyItemId = resolveAgencyItemId(data, query);
  const allExactRows = (agencyItemId ? data.itemPriceSummariesByAgencyItemId.get(agencyItemId) ?? [] : [])
    .map((summary) => ({ summary, source: data.sourceById.get(summary.sourceId) ?? null }));
  const normalizedFilters: ItemPriceHistoryFilters = {
    reportSeries: filters.reportSeries,
    unit: filters.unit.trim()
  };
  const filteredRows = allExactRows
    .filter((row) => normalizedFilters.reportSeries === "all" || row.summary.reportSeries === normalizedFilters.reportSeries)
    .filter((row) => !normalizedFilters.unit || row.summary.unitRaw === normalizedFilters.unit)
    .sort((left, right) => compareRows(left, right, sort));

  return {
    query: agencyItemId ? { ...query, agencyItemId } : query,
    filters: normalizedFilters,
    sort,
    allExactRows,
    filteredRows,
    availableUnits: [...new Set(allExactRows.map((row) => row.summary.unitRaw).filter(Boolean))].sort((left, right) => left.localeCompare(right))
  };
}

function resolveAgencyItemId(data: AppData, query: SearchQuery): string {
  if (query.agencyItemId && data.agencyItemById.has(query.agencyItemId)) return query.agencyItemId;
  const itemCode = query.itemCode.trim().toUpperCase();
  return data.agencyItems.find((item) => item.state === query.state && item.itemCode === itemCode)?.agencyItemId ?? "";
}

function compareRows(left: ItemPriceHistoryRow, right: ItemPriceHistoryRow, sort: ItemPriceHistorySort): number {
  const value = historySortValue(left, sort.key);
  const comparison = typeof value === "number"
    ? value - (historySortValue(right, sort.key) as number)
    : value.localeCompare(historySortValue(right, sort.key) as string, undefined, { numeric: true, sensitivity: "base" });
  if (comparison !== 0) return sort.direction === "asc" ? comparison : -comparison;
  const periodComparison = right.summary.periodEndDate.localeCompare(left.summary.periodEndDate)
    || right.summary.periodStartDate.localeCompare(left.summary.periodStartDate);
  return periodComparison || left.summary.summaryId.localeCompare(right.summary.summaryId);
}

function historySortValue(row: ItemPriceHistoryRow, key: ItemPriceHistorySortKey): string | number {
  switch (key) {
    case "period": return `${row.summary.periodEndDate}|${row.summary.periodStartDate}`;
    case "itemCode": return row.summary.agencyItemCode;
    case "description": return row.summary.descriptionRaw;
    case "quantity": return row.summary.totalQuantity;
    case "unit": return row.summary.unitRaw;
    case "averageUnitPrice": return row.summary.publishedAverageUnitPrice;
    case "totalBid": return row.summary.totalBid;
    case "source": return row.source?.sourceLabel ?? "";
  }
}
