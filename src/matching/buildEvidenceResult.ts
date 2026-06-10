import type {
  AppData,
  EvidenceFilters,
  EvidenceResult,
  EvidenceRow,
  EvidenceSort,
  EvidenceSortKey,
  EvidenceStats,
  SearchQuery
} from "../data/schema";
import { normalizeDescription, normalizeUnit } from "./normalizeDescription";

const DEFAULT_EVIDENCE_SORT: EvidenceSort = {
  key: "letDate",
  direction: "desc"
};

export function createDefaultEvidenceFilters(query: SearchQuery): EvidenceFilters {
  return {
    sourceType: "public_cost_book",
    geography: "",
    district: "",
    yearMin: null,
    yearMax: null,
    quantityMin: null,
    quantityMax: null,
    unit: normalizeUnit(query.unit),
    requireAwardedPrice: true
  };
}

export function createDefaultEvidenceSort(): EvidenceSort {
  return { ...DEFAULT_EVIDENCE_SORT };
}

export function buildEvidenceResult(
  data: AppData,
  rawQuery: SearchQuery,
  rawFilters: EvidenceFilters,
  rawSort: EvidenceSort = DEFAULT_EVIDENCE_SORT
): EvidenceResult {
  const query = normalizeEvidenceQuery(data, rawQuery);
  const filters = normalizeEvidenceFilters(rawFilters, query);
  const sort = normalizeEvidenceSort(rawSort);
  const interpretedDescription = resolveInterpretedDescription(data, query);

  if (!query.itemCode) {
    return {
      query,
      filters,
      sort,
      interpretedDescription,
      allExactRows: [],
      filteredRows: [],
      unitExcludedCount: 0,
      availableUnits: [],
      availableDistricts: [],
      stats: null,
      notes: ["Select an official item code before reviewing project evidence."]
    };
  }

  const allExactRows = buildExactRows(data, query);
  const sourceRows = allExactRows.filter((row) => sourceMatches(row, filters));
  const availableUnits = uniqueSorted(sourceRows.map((row) => row.unit).filter(Boolean));
  const availableDistricts = uniqueSorted(
    sourceRows
      .map((row) => row.project?.district ?? "")
      .filter(Boolean)
  );
  const nonUnitFilteredRows = sourceRows.filter((row) => rowMatchesNonUnitFilters(row, filters));
  const filteredRows = nonUnitFilteredRows
    .filter((row) => !filters.unit || row.unit === filters.unit)
    .sort((left, right) => compareEvidenceRows(left, right, sort));
  const unitExcludedCount = filters.unit
    ? nonUnitFilteredRows.filter((row) => row.unit !== filters.unit).length
    : 0;
  const stats = buildEvidenceStats(filteredRows);
  const notes = buildNotes(query, filters, allExactRows, filteredRows, unitExcludedCount, stats);

  return {
    query,
    filters,
    sort,
    interpretedDescription,
    allExactRows,
    filteredRows,
    unitExcludedCount,
    availableUnits,
    availableDistricts,
    stats,
    notes
  };
}

function normalizeEvidenceSort(sort: EvidenceSort): EvidenceSort {
  const allowedKeys: EvidenceSortKey[] = [
    "projectNumber",
    "projectLocation",
    "district",
    "letDate",
    "contractor",
    "bidCount",
    "quantity",
    "unit",
    "description",
    "awardedBidUnitPrice",
    "averageBidUnitPrice",
    "engineerEstimateUnitPrice",
    "source"
  ];

  return {
    key: allowedKeys.includes(sort.key) ? sort.key : DEFAULT_EVIDENCE_SORT.key,
    direction: sort.direction === "asc" || sort.direction === "desc"
      ? sort.direction
      : DEFAULT_EVIDENCE_SORT.direction
  };
}

function normalizeEvidenceQuery(data: AppData, query: SearchQuery): SearchQuery {
  const state = query.state.trim().toUpperCase() || "CO";
  const itemCode = query.itemCode.trim().toUpperCase();
  const resolvedAgencyItem = itemCode
    ? (data.agencyByCode.get(itemCode) ?? []).find((item) => item.state === state)
    : null;

  return {
    ...query,
    state,
    itemCode,
    description: resolvedAgencyItem?.officialDescription || query.description.trim(),
    unit: resolvedAgencyItem?.officialUnit
      ? normalizeUnit(resolvedAgencyItem.officialUnit)
      : normalizeUnit(query.unit),
    quantity: query.quantity && query.quantity > 0 ? query.quantity : null
  };
}

function normalizeEvidenceFilters(filters: EvidenceFilters, query: SearchQuery): EvidenceFilters {
  return {
    ...filters,
    geography: filters.geography.trim(),
    district: filters.district.trim(),
    unit: normalizeUnit(filters.unit || query.unit),
    yearMin: positiveNumberOrNull(filters.yearMin),
    yearMax: positiveNumberOrNull(filters.yearMax),
    quantityMin: positiveNumberOrNull(filters.quantityMin),
    quantityMax: positiveNumberOrNull(filters.quantityMax)
  };
}

function buildExactRows(data: AppData, query: SearchQuery): EvidenceRow[] {
  const rowByKey = new Map<string, EvidenceRow>();

  for (const observation of data.observations) {
    if (observation.agencyItemCode !== query.itemCode) {
      continue;
    }

    const project = data.projectById.get(observation.projectId) ?? null;
    const source = data.sourceById.get(observation.sourceId) ?? null;

    if (!project || project.state !== query.state) {
      continue;
    }

    const key = [
      observation.projectId,
      observation.sourceId,
      observation.agencyItemCode,
      observation.descriptionRaw,
      observation.unitNormalized,
      observation.quantity,
      observation.dateBasis
    ].join("|");

    let row = rowByKey.get(key);
    if (!row) {
      row = {
        rowId: key,
        project,
        source,
        itemCode: observation.agencyItemCode,
        descriptionRaw: observation.descriptionRaw,
        unit: observation.unitNormalized,
        quantity: observation.quantity,
        dateBasis: observation.dateBasis,
        awardedBidUnitPrice: null,
        averageBidUnitPrice: null,
        engineerEstimateUnitPrice: null,
        observationIds: []
      };
      rowByKey.set(key, row);
    }

    row.observationIds.push(observation.observationId);
    assignPrice(row, observation.priceType, observation.unitPrice);
  }

  return [...rowByKey.values()];
}

function assignPrice(row: EvidenceRow, priceType: string, unitPrice: number): void {
  const normalizedPriceType = priceType.toLowerCase();

  if (normalizedPriceType === "cdot_awarded_bid" || normalizedPriceType === "bid_tab_demo") {
    row.awardedBidUnitPrice ??= unitPrice;
  }

  if (normalizedPriceType === "cdot_average_bid") {
    row.averageBidUnitPrice ??= unitPrice;
  }

  if (normalizedPriceType === "cdot_engineer_estimate" || normalizedPriceType === "engineers_estimate") {
    row.engineerEstimateUnitPrice ??= unitPrice;
  }
}

function sourceMatches(row: EvidenceRow, filters: EvidenceFilters): boolean {
  if (filters.sourceType === "all") {
    return true;
  }

  return row.source?.sourceType === filters.sourceType;
}

function rowMatchesNonUnitFilters(row: EvidenceRow, filters: EvidenceFilters): boolean {
  if (!sourceMatches(row, filters)) {
    return false;
  }

  if (filters.requireAwardedPrice && row.awardedBidUnitPrice === null) {
    return false;
  }

  if (filters.district && row.project?.district !== filters.district) {
    return false;
  }

  if (filters.geography) {
    const haystack = normalizeDescription(
      [
        row.project?.countyRegion ?? "",
        row.project?.projectName ?? "",
        row.project?.projectLocationRaw ?? ""
      ].join(" ")
    );

    if (!haystack.includes(normalizeDescription(filters.geography))) {
      return false;
    }
  }

  const rowYear = getYear(row.project?.estimateLetDate || row.dateBasis);
  if (filters.yearMin !== null && (rowYear === null || rowYear < filters.yearMin)) {
    return false;
  }
  if (filters.yearMax !== null && (rowYear === null || rowYear > filters.yearMax)) {
    return false;
  }

  if (filters.quantityMin !== null && row.quantity < filters.quantityMin) {
    return false;
  }
  if (filters.quantityMax !== null && row.quantity > filters.quantityMax) {
    return false;
  }

  return true;
}

function buildEvidenceStats(rows: EvidenceRow[]): EvidenceStats | null {
  const prices = rows
    .map((row) => row.awardedBidUnitPrice)
    .filter((price): price is number => price !== null && Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);

  if (prices.length === 0) {
    return null;
  }

  const total = prices.reduce((sum, price) => sum + price, 0);

  return {
    count: prices.length,
    low: prices[0],
    p25: quantile(prices, 0.25),
    median: quantile(prices, 0.5),
    average: total / prices.length,
    p75: quantile(prices, 0.75),
    high: prices[prices.length - 1]
  };
}

function buildNotes(
  query: SearchQuery,
  filters: EvidenceFilters,
  allExactRows: EvidenceRow[],
  filteredRows: EvidenceRow[],
  unitExcludedCount: number,
  stats: EvidenceStats | null
): string[] {
  const notes: string[] = [];

  if (allExactRows.length === 0) {
    notes.push(`No project evidence rows were found for item code ${query.itemCode}.`);
    return notes;
  }

  if (unitExcludedCount > 0 && filters.unit) {
    notes.push(`${unitExcludedCount} exact-code row(s) use a unit other than ${filters.unit} and are not shown.`);
  }

  if (filteredRows.length === 0) {
    notes.push("No evidence rows match the current filters.");
  }

  if (filteredRows.length > 0 && !stats) {
    notes.push("The filtered evidence rows do not include awarded bid unit prices for summary statistics.");
  }

  if (filters.sourceType === "public_demo" || filters.sourceType === "internal_demo" || filters.sourceType === "all") {
    notes.push("Synthetic demo rows may be visible under the current source filter.");
  }

  return notes;
}

function compareEvidenceRows(left: EvidenceRow, right: EvidenceRow, sort: EvidenceSort): number {
  const sortOrder = compareSortValues(sortValue(left, sort.key), sortValue(right, sort.key), sort.direction);

  if (sortOrder !== 0) {
    return sortOrder;
  }

  return compareDefaultEvidenceRows(left, right);
}

function compareDefaultEvidenceRows(left: EvidenceRow, right: EvidenceRow): number {
  const leftDate = left.project?.estimateLetDate || left.dateBasis;
  const rightDate = right.project?.estimateLetDate || right.dateBasis;
  const dateOrder = rightDate.localeCompare(leftDate);

  if (dateOrder !== 0) {
    return dateOrder;
  }

  const leftProject = left.project?.projectNumber || left.project?.projectName || "";
  const rightProject = right.project?.projectNumber || right.project?.projectName || "";
  return leftProject.localeCompare(rightProject);
}

function sortValue(row: EvidenceRow, key: EvidenceSortKey): string | number | null {
  if (key === "projectNumber") {
    return emptyStringAsNull(row.project?.projectNumber);
  }

  if (key === "projectLocation") {
    return emptyStringAsNull(row.project?.projectName || row.project?.projectLocationRaw);
  }

  if (key === "district") {
    return emptyStringAsNull(row.project?.district);
  }

  if (key === "letDate") {
    return emptyStringAsNull(row.project?.estimateLetDate || row.dateBasis);
  }

  if (key === "contractor") {
    return emptyStringAsNull(row.project?.contractor);
  }

  if (key === "bidCount") {
    return row.project?.bidCount ?? null;
  }

  if (key === "quantity") {
    return row.quantity;
  }

  if (key === "unit") {
    return emptyStringAsNull(row.unit);
  }

  if (key === "description") {
    return emptyStringAsNull(row.descriptionRaw);
  }

  if (key === "awardedBidUnitPrice") {
    return row.awardedBidUnitPrice;
  }

  if (key === "averageBidUnitPrice") {
    return row.averageBidUnitPrice;
  }

  if (key === "engineerEstimateUnitPrice") {
    return row.engineerEstimateUnitPrice;
  }

  return emptyStringAsNull(row.source?.sourceLabel);
}

function compareSortValues(
  left: string | number | null,
  right: string | number | null,
  direction: EvidenceSort["direction"]
): number {
  if (left === null && right === null) {
    return 0;
  }

  if (left === null) {
    return 1;
  }

  if (right === null) {
    return -1;
  }

  const order = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });

  return direction === "asc" ? order : -order;
}

function emptyStringAsNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function resolveInterpretedDescription(data: AppData, query: SearchQuery): string {
  if (!query.itemCode) {
    return "No official item selected";
  }

  const agencyItem = (data.agencyByCode.get(query.itemCode) ?? []).find(
    (item) => item.state === query.state
  );

  return agencyItem?.officialDescription || query.description || query.itemCode;
}

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedValues[lower];
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function positiveNumberOrNull(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function getYear(value: string): number | null {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}
