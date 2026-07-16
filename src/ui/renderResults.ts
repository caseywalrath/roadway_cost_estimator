import type {
  AppData,
  BidderBidRecord,
  BidderItemObservationRecord,
  EvidenceFilters,
  EvidenceResult,
  EvidenceRow,
  EvidenceSort,
  EvidenceSortKey,
  EvidenceSourceTypeFilter,
  EvidenceStats,
  EvidenceSummaryStats
} from "../data/schema";
import type { InflationAdjustedPriceSet, InflationAdjustedSummary } from "../matching/inflationAdjustment";

export function renderResults(
  result: EvidenceResult,
  filtersExpanded: boolean,
  itemSearchCollapsed: boolean,
  data: AppData,
  selectedBidderDetailKey: string | null,
  excludedSummaryRowIds: ReadonlySet<string>,
  includedRowCount: number,
  visibleExcludedCount: number,
  includedStats: EvidenceStats | null,
  includedSummaryStats: EvidenceSummaryStats,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null,
  inflationAdjustedPriceSet: InflationAdjustedPriceSet | null,
  addToProjectPanelHtml: string
): string {
  const displayedSummaryStats = inflationAdjustmentEnabled
    ? inflationAdjustedSummary?.summaryStats ?? includedSummaryStats
    : includedSummaryStats;
  const displayedStats: EvidenceSummaryStats = {
    awarded: inflationAdjustmentEnabled ? inflationAdjustedSummary?.stats ?? null : includedStats,
    average: displayedSummaryStats.average,
    engineer: displayedSummaryStats.engineer
  };

  return `
    <section class="results-panel">
      ${renderEvidenceTable(result, filtersExpanded, itemSearchCollapsed, excludedSummaryRowIds, includedRowCount, visibleExcludedCount, inflationAdjustedPriceSet, data)}
      ${renderUnitPriceSummaryPanel(
        displayedStats,
        result.filteredRows.length,
        includedRowCount,
        inflationAdjustmentEnabled,
        inflationAdjustedSummary,
        addToProjectPanelHtml,
        data.stateConfig.capabilities.engineerEstimate
      )}
    </section>
    ${renderBidderDetailModal(result, data, selectedBidderDetailKey)}
  `;
}

function renderEvidenceTable(
  result: EvidenceResult,
  filtersExpanded: boolean,
  itemSearchCollapsed: boolean,
  excludedSummaryRowIds: ReadonlySet<string>,
  includedRowCount: number,
  visibleExcludedCount: number,
  inflationAdjustedPriceSet: InflationAdjustedPriceSet | null,
  data: AppData
): string {
  if (!result.query.itemCode) {
    return `
      <section class="panel-block">
        ${renderMatchingProjectsHeader(result, false)}
        <p class="muted">Use Item Search to select a loaded ${escapeHtml(data.stateConfig.defaultAgencyName)} item code before reviewing project evidence.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block panel-block--table">
      ${renderMatchingProjectsHeader(result, itemSearchCollapsed, includedRowCount)}
      ${renderEvidenceControls(result, filtersExpanded, visibleExcludedCount, data)}
      ${result.filteredRows.length === 0 ? renderEmptyTableMessage() : renderTable(result.filteredRows, result.sort, excludedSummaryRowIds, inflationAdjustedPriceSet, data)}
    </section>
  `;
}

function renderMatchingProjectsHeader(result: EvidenceResult, showEditButton: boolean, includedRowCount = result.filteredRows.length): string {
  const showExportButton = Boolean(result.query.itemCode);

  return `
    <div class="panel-heading evidence-table-heading">
      <div>
        <p class="eyebrow">Matching Projects</p>
        <h3>${escapeHtml(result.query.itemCode ? result.interpretedDescription : "Select an official item")}</h3>
        <p class="query-line">
          Item code: ${escapeHtml(result.query.itemCode || "Not selected")} |
          Unit: ${escapeHtml(result.query.unit || "Not selected")}
        </p>
      </div>
      ${showExportButton || showEditButton
        ? `
          <div class="matching-projects-actions">
            ${showExportButton
              ? `<button type="button" id="download-matching-projects-csv" class="secondary-button matching-projects-export-button" ${includedRowCount === 0 ? "disabled" : ""}>Download CSV</button>`
              : ""}
            ${showEditButton ? `<button type="button" id="edit-item-search" class="primary-button matching-projects-edit-button">Edit Item Search</button>` : ""}
          </div>
        `
        : ""}
    </div>
  `;
}

function renderEvidenceControls(result: EvidenceResult, filtersExpanded: boolean, visibleExcludedCount: number, data: AppData): string {
  const unitOptions = uniqueValues([result.filters.unit, ...result.availableUnits].filter(Boolean));

  return `
    <div class="evidence-filter-toolbar">
      <div class="filter-chip-list" aria-label="Active evidence filters">
        ${renderFilterChips(result, data)}
        ${visibleExcludedCount > 0 ? `<span class="filter-chip">Excluded: ${formatNumber(visibleExcludedCount)}</span>` : ""}
      </div>
      <div class="evidence-filter-actions">
        <span class="results-step-cue" aria-label="Step 3 refine results">
          <span class="step-number" aria-hidden="true">3</span>
          <span>Refine results</span>
        </span>
        <button
          type="button"
          id="toggle-evidence-filters"
          class="secondary-button filter-toggle-button"
          aria-expanded="${filtersExpanded}"
          aria-controls="evidence-filter-drawer"
        >
          ${filtersExpanded ? "Hide filters" : "Filters"}
        </button>
      </div>
    </div>
    <div id="evidence-filter-drawer" class="evidence-filter-drawer" ${filtersExpanded ? "" : "hidden"}>
      <form id="evidence-filters-form" class="evidence-filter-form">
        <label>
          <span class="label-row">
            Source
          </span>
          <select name="sourceType">
            ${Object.entries(data.stateConfig.sourceTypeLabels)
              .map(([value, label]) => renderSourceTypeOption(value, label, result.filters.sourceType))
              .join("")}
            ${renderSourceTypeOption("all", "All Sources", result.filters.sourceType)}
          </select>
        </label>

        <label>
          <span class="label-row">
            Geography
          </span>
          <input name="geography" value="${escapeHtml(result.filters.geography)}" placeholder="District, county, or location" />
        </label>

        ${data.stateConfig.capabilities.districtFilter ? `<fieldset class="district-filter-field">
          <legend>District</legend>
          <details class="district-multiselect">
            <summary>${escapeHtml(districtSummaryLabel(result.filters.districts))}</summary>
            <div class="district-multiselect-menu">
              ${renderDistrictCheckboxOptions(result.availableDistricts, result.filters.districts)}
            </div>
          </details>
        </fieldset>` : ""}

        <label>
          <span class="label-row">
            Unit
          </span>
          <select name="unit">
            <option value="">All units</option>
            ${unitOptions
              .map((unit) => `<option value="${escapeHtml(unit)}" ${unit === result.filters.unit ? "selected" : ""}>${escapeHtml(unit)}</option>`)
              .join("")}
          </select>
        </label>

        <fieldset class="filter-range-group">
          <legend>Year range</legend>
          <label>
            <span>From</span>
            <input name="yearMin" type="number" min="1900" max="2100" value="${result.filters.yearMin ?? ""}" />
          </label>
          <label>
            <span>To</span>
            <input name="yearMax" type="number" min="1900" max="2100" value="${result.filters.yearMax ?? ""}" />
          </label>
        </fieldset>

        <fieldset class="filter-range-group">
          <legend>Quantity range</legend>
          <label>
            <span>Min</span>
            ${renderQuantityInput("quantityMin", result.filters.quantityMin)}
          </label>
          <label>
            <span>Max</span>
            ${renderQuantityInput("quantityMax", result.filters.quantityMax)}
          </label>
        </fieldset>

        <div class="filter-form-actions">
          <button type="submit" class="secondary-button">Apply</button>
          <button type="button" id="clear-evidence-filters" class="secondary-button">Clear</button>
        </div>
      </form>
    </div>
  `;
}

interface EvidenceColumn {
  key: EvidenceSortKey;
  label: string;
}

const evidenceColumns: EvidenceColumn[] = [
  { key: "projectNumber", label: "Contract / project" },
  { key: "projectLocation", label: "Location" },
  { key: "district", label: "District" },
  { key: "letDate", label: "Let date" },
  { key: "contractor", label: "Awarded vendor" },
  { key: "bidCount", label: "Bid count" },
  { key: "quantity", label: "Quantity" },
  { key: "unit", label: "Unit" },
  { key: "description", label: "Item description" },
  { key: "awardedBidUnitPrice", label: "Awarded bid unit price" },
  { key: "averageBidUnitPrice", label: "Average bid unit price" },
  { key: "engineerEstimateUnitPrice", label: "Engineer estimate unit price" },
  { key: "source", label: "Source" }
];

function renderTable(
  rows: EvidenceRow[],
  sort: EvidenceSort,
  excludedSummaryRowIds: ReadonlySet<string>,
  inflationAdjustedPriceSet: InflationAdjustedPriceSet | null,
  data: AppData
): string {
  const columns = evidenceColumns.filter((column) =>
    (column.key !== "district" || data.stateConfig.capabilities.districtFilter)
    && (column.key !== "engineerEstimateUnitPrice" || data.stateConfig.capabilities.engineerEstimate)
  );
  return `
    <div class="table-scroll-shell">
      <div class="table-scroll-affordance" aria-hidden="true"><span></span></div>
      <div class="table-scroll" tabindex="0" aria-label="Matching project evidence table">
        <table class="evidence-table">
          <thead>
            <tr>
              <th class="evidence-exclude-header">Exclude from Summary</th>
              ${columns.map((column) => renderSortableHeader(column, sort)).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => renderEvidenceRow(row, excludedSummaryRowIds.has(row.rowId), inflationAdjustedPriceSet, columns)).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderSortableHeader(column: EvidenceColumn, sort: EvidenceSort): string {
  const isActive = sort.key === column.key;
  const ariaSort = isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const nextDirection = isActive && sort.direction === "asc" ? "descending" : "ascending";

  return `
    <th aria-sort="${ariaSort}" class="${isActive ? "evidence-table__sorted-column" : ""}">
      <button
        type="button"
        class="table-sort-button"
        data-evidence-sort-key="${column.key}"
        aria-label="Sort by ${escapeHtml(column.label)} ${nextDirection}"
      >
        <span>${escapeHtml(column.label)}</span>
        <span class="sort-indicator sort-indicator--${isActive ? sort.direction : "inactive"}" aria-hidden="true"></span>
      </button>
    </th>
  `;
}

function renderEvidenceRow(
  row: EvidenceRow,
  isExcluded: boolean,
  inflationAdjustedPriceSet: InflationAdjustedPriceSet | null,
  columns: EvidenceColumn[]
): string {
  const projectLabel = row.project?.projectNumber || row.project?.projectName || row.project?.projectLocationRaw || row.itemCode;
  const adjustedAwardedBidUnitPrice = inflationAdjustedPriceSet?.awardedBidUnitPriceByRowId.get(row.rowId) ?? null;
  const adjustedAverageBidUnitPrice = inflationAdjustedPriceSet?.averageBidUnitPriceByRowId.get(row.rowId) ?? null;
  const adjustedEngineerEstimateUnitPrice = inflationAdjustedPriceSet?.engineerEstimateUnitPriceByRowId.get(row.rowId) ?? null;

  return `
    <tr class="${isExcluded ? "evidence-row--excluded" : ""}">
      <td class="exclude-summary-cell">
        <input
          type="checkbox"
          class="exclude-summary-checkbox"
          data-exclude-row-id="${escapeHtml(row.rowId)}"
          aria-label="Exclude ${escapeHtml(projectLabel)} from summary"
          ${isExcluded ? "checked" : ""}
        />
      </td>
      ${columns.map((column) => {
        if (column.key === "projectNumber") return `<td>${renderProjectNumberCell(row)}</td>`;
        if (column.key === "projectLocation") return `<td>${escapeHtml(row.project?.projectName ?? "Unknown project")}${renderProjectLocationSubtext(row)}</td>`;
        if (column.key === "district") return `<td>${escapeHtml(row.project?.district || "Not listed")}</td>`;
        if (column.key === "letDate") return `<td>${escapeHtml(row.project?.estimateLetDate || row.dateBasis)}</td>`;
        if (column.key === "contractor") return `<td>${escapeHtml(row.project?.contractor || "Not listed")}</td>`;
        if (column.key === "bidCount") return `<td>${row.project?.bidCount ?? "Not listed"}</td>`;
        if (column.key === "quantity") return `<td>${formatNumber(row.quantity)}</td>`;
        if (column.key === "unit") return `<td>${escapeHtml(row.unit)}</td>`;
        if (column.key === "description") return `<td>${escapeHtml(row.descriptionRaw)}</td>`;
        if (column.key === "awardedBidUnitPrice") return `<td>${renderUnitPrice(row.awardedBidUnitPrice, adjustedAwardedBidUnitPrice)}</td>`;
        if (column.key === "averageBidUnitPrice") return `<td>${renderUnitPrice(row.averageBidUnitPrice, adjustedAverageBidUnitPrice)}</td>`;
        if (column.key === "engineerEstimateUnitPrice") return `<td>${renderUnitPrice(row.engineerEstimateUnitPrice, adjustedEngineerEstimateUnitPrice)}</td>`;
        return `<td>${escapeHtml(row.source?.sourceLabel ?? "Unknown source")}</td>`;
      }).join("")}
    </tr>
  `;
}

function renderProjectLocationSubtext(row: EvidenceRow): string {
  const countyRegion = formatProjectLocationSubtext(row);
  return countyRegion ? `<div class="row-subtext">${escapeHtml(countyRegion)}</div>` : "";
}

function formatProjectLocationSubtext(row: EvidenceRow): string {
  const countyRegion = row.project?.countyRegion.trim() ?? "";

  if (!countyRegion) {
    return "";
  }

  if (row.source?.sourceType === "cost_book") {
    return countyRegion.replace(/\s*\/\s*CDOT District \d+\s*$/i, "").trim();
  }

  return countyRegion;
}

function renderProjectNumberCell(row: EvidenceRow): string {
  const label = row.project?.projectNumber || "Not listed";

  if (!row.hasBidderDetails) {
    return escapeHtml(label);
  }

  return `
    <button
      type="button"
      class="link-button project-detail-button"
      data-bidder-detail-key="${escapeHtml(row.bidderDetailKey)}"
      aria-label="Open bidder details for ${escapeHtml(label)}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function renderUnitPriceSummaryPanel(
  stats: EvidenceSummaryStats,
  filteredRowCount: number,
  includedRowCount: number,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null,
  addToProjectPanelHtml: string,
  supportsEngineerEstimate: boolean
): string {
  const inflationControl = renderInflationAdjustmentControl(inflationAdjustmentEnabled);
  const inflationNote = renderInflationAdjustmentNote(inflationAdjustmentEnabled, inflationAdjustedSummary);
  const allRowsExcludedMessage = filteredRowCount > 0 && includedRowCount === 0
    ? `<p class="muted summary-status-note">All current evidence rows are excluded from the Unit Price Summary.</p>`
    : "";
  const noAdjustedAwardedMessage = inflationAdjustmentEnabled
    && !stats.awarded
    && (inflationAdjustedSummary?.awardedRowCount ?? 0) > 0
    ? `<p class="muted summary-status-note">No included awarded bid rows could be adjusted because their source quarters are not loaded in the FHWA NHCCI table.</p>`
    : "";

  return `
    <section class="panel-block unit-price-summary-panel">
      <div class="summary-heading-row">
        <div class="panel-heading">
          <p class="eyebrow">Unit Price Summary</p>
        </div>
        ${inflationControl}
      </div>
      ${allRowsExcludedMessage}
      ${noAdjustedAwardedMessage}
      <div class="summary-table-wrap">
        <table class="summary-table">
          <thead>
            <tr>
              <th>Price type</th>
              <th>Count</th>
              <th>Low</th>
              <th>P25</th>
              <th>Median</th>
              <th>Average</th>
              <th>P75</th>
              <th>High</th>
            </tr>
          </thead>
          <tbody>
            ${renderSummaryRow("Awarded Bid", stats.awarded)}
            ${renderSummaryRow("Average Bid", stats.average)}
            ${supportsEngineerEstimate ? renderSummaryRow("Engineer Estimate", stats.engineer) : ""}
          </tbody>
        </table>
      </div>
      ${inflationNote}
      ${addToProjectPanelHtml}
    </section>
  `;
}

function renderSummaryRow(label: string, stats: EvidenceStats | null): string {
  if (!stats) {
    return `
      <tr>
        <th scope="row">${escapeHtml(label)}</th>
        <td colspan="7" class="summary-table__empty">No ${escapeHtml(label.toLowerCase())} prices available</td>
      </tr>
    `;
  }

  return `
    <tr>
      <th scope="row">${escapeHtml(label)}</th>
      <td>${formatNumber(stats.count)}</td>
      <td>${renderSummaryPriceControl(label, "Low", stats.low)}</td>
      <td>${renderSummaryPriceControl(label, "P25", stats.p25)}</td>
      <td>${renderSummaryPriceControl(label, "Median", stats.median)}</td>
      <td>${renderSummaryPriceControl(label, "Average", stats.average)}</td>
      <td>${renderSummaryPriceControl(label, "P75", stats.p75)}</td>
      <td>${renderSummaryPriceControl(label, "High", stats.high)}</td>
    </tr>
  `;
}

function renderSummaryPriceControl(
  priceTypeLabel: string,
  metricLabel: string,
  value: number
): string {
  const formattedValue = formatCurrency(value);

  return `
    <button
      type="button"
      class="summary-price-button"
      data-project-cost-value="${value}"
      aria-label="Use ${escapeHtml(priceTypeLabel)} ${escapeHtml(metricLabel)} ${escapeHtml(formattedValue)} as preferred unit cost"
    >
      ${formattedValue}
    </button>
  `;
}

function renderInflationAdjustmentControl(enabled: boolean): string {
  return `
    <label class="summary-toggle">
      <input id="inflation-adjustment-toggle" type="checkbox" ${enabled ? "checked" : ""} />
      <span>Inflation Adjustment</span>
    </label>
  `;
}

function renderInflationAdjustmentNote(
  enabled: boolean,
  summary: InflationAdjustedSummary | null
): string {
  if (!enabled) {
    return "";
  }

  if (!summary?.targetPeriod) {
    return `<p class="summary-adjustment-note">Inflation Adjustment is on, but no FHWA NHCCI index values are loaded.</p>`;
  }

  const missingNote = summary.missingIndexCount > 0
    ? ` ${formatNumber(summary.missingIndexCount)} included unit price value(s) could not be adjusted because no NHCCI value is loaded for their source quarter.`
    : "";

  return `
    <p class="summary-adjustment-note">
      Inflation Adjustment is on. Awarded bid, average bid, and engineer estimate unit prices are adjusted with FHWA NHCCI to ${escapeHtml(summary.targetPeriod.periodLabel)}.
      Original Matching Projects prices stay primary and CSV export is unchanged.${missingNote}
    </p>
  `;
}

function renderUnitPrice(value: number | null, adjustedValue: number | null): string {
  if (value === null) {
    return "Not listed";
  }

  const roundedValue = Math.round(value);
  const roundedAdjustedValue = adjustedValue === null ? null : Math.round(adjustedValue);
  const adjustedLine = roundedAdjustedValue !== null && roundedAdjustedValue !== roundedValue
    ? `<div class="adjusted-price-line">(${formatWholeCurrency(roundedAdjustedValue)})</div>`
    : "";

  return `${formatCurrency(value)}${adjustedLine}`;
}

function renderEmptyTableMessage(): string {
  return `<p class="muted evidence-empty">No project-item rows match the current filters.</p>`;
}

function renderFilterChips(result: EvidenceResult, data: AppData): string {
  const chips = [
    `Rows: ${formatNumber(result.filteredRows.length)}`,
    `Source: ${sourceTypeLabel(result.filters.sourceType, data)}`,
    result.filters.geography ? `Geography: ${result.filters.geography}` : "",
    result.filters.districts.length > 0 ? `District: ${districtSummaryLabel(result.filters.districts)}` : "",
    result.filters.unit ? `Unit: ${result.filters.unit}` : "",
    result.filters.yearMin !== null || result.filters.yearMax !== null
      ? `Year: ${rangeLabel(result.filters.yearMin, result.filters.yearMax)}`
      : "",
    result.filters.quantityMin !== null || result.filters.quantityMax !== null
      ? `Quantity: ${rangeLabel(result.filters.quantityMin, result.filters.quantityMax)}`
      : ""
  ].filter(Boolean);

  return chips
    .map((chip) => `<span class="filter-chip">${escapeHtml(chip)}</span>`)
    .join("");
}

function renderSourceTypeOption(
  value: EvidenceSourceTypeFilter,
  label: string,
  selectedValue: EvidenceSourceTypeFilter
): string {
  return `<option value="${value}" ${value === selectedValue ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function sourceTypeLabel(value: EvidenceSourceTypeFilter, data: AppData): string {
  return value === "all" ? "All Sources" : data.stateConfig.sourceTypeLabels[value] ?? value;
}

function rangeLabel(minimum: number | null, maximum: number | null): string {
  if (minimum !== null && maximum !== null) {
    return `${formatNumber(minimum)}-${formatNumber(maximum)}`;
  }

  if (minimum !== null) {
    return `${formatNumber(minimum)}+`;
  }

  if (maximum !== null) {
    return `<= ${formatNumber(maximum)}`;
  }

  return "Any";
}

function renderDistrictCheckboxOptions(districts: string[], selectedDistricts: string[]): string {
  const selectedSet = new Set(selectedDistricts);
  const options = uniqueValues([...selectedDistricts, ...districts].filter(Boolean));

  if (options.length === 0) {
    return `<p class="district-multiselect-empty">No districts available for current source.</p>`;
  }

  return options
    .map((district) => `
      <label class="district-checkbox-label">
        <input name="districts" type="checkbox" value="${escapeHtml(district)}" ${selectedSet.has(district) ? "checked" : ""} />
        <span>${escapeHtml(district)}</span>
      </label>
    `)
    .join("");
}

function districtSummaryLabel(selectedDistricts: string[]): string {
  if (selectedDistricts.length === 0) {
    return "All districts";
  }

  if (selectedDistricts.length === 1) {
    return `District ${selectedDistricts[0]}`;
  }

  return `${selectedDistricts.length} districts`;
}

function renderQuantityInput(name: "quantityMin" | "quantityMax", value: number | null): string {
  return `<input name="${name}" type="text" value="${value ?? ""}" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" />`;
}

export function readEvidenceFiltersFromForm(
  form: HTMLFormElement,
  currentFilters: EvidenceFilters
): EvidenceFilters {
  const formData = new FormData(form);

  return {
    ...currentFilters,
    sourceType: String(formData.get("sourceType") || "all") as EvidenceSourceTypeFilter,
    geography: String(formData.get("geography") || ""),
    districts: formData.getAll("districts").map((value) => String(value)).filter(Boolean),
    yearMin: readOptionalNumber(formData.get("yearMin")),
    yearMax: readOptionalNumber(formData.get("yearMax")),
    quantityMin: readOptionalNumber(formData.get("quantityMin")),
    quantityMax: readOptionalNumber(formData.get("quantityMax")),
    unit: String(formData.get("unit") || "")
  };
}

function renderBidderDetailModal(
  result: EvidenceResult,
  data: AppData,
  selectedBidderDetailKey: string | null
): string {
  if (!selectedBidderDetailKey) {
    return "";
  }

  const row = result.filteredRows.find((candidate) => candidate.bidderDetailKey === selectedBidderDetailKey);
  const bidderItems = data.bidderItemsByRowKey.get(selectedBidderDetailKey) ?? [];

  if (!row || bidderItems.length === 0) {
    return "";
  }

  const bidderBids = data.bidderBidsByProjectId.get(row.project?.projectId ?? "") ?? [];
  const bidById = new Map(bidderBids.map((bid) => [bid.bidId, bid]));
  const apparentLowBid = bidderBids.find((bid) => bid.apparentLow) ?? null;
  const confirmedAwardBid = bidderBids.find((bid) => bid.isAwarded) ?? null;

  return `
    <div class="modal-backdrop" role="presentation">
      <section
        class="bidder-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bidder-modal-title"
      >
        <div class="bidder-modal__header">
          <div>
            <p class="eyebrow">Bidder Detail</p>
            <h3 id="bidder-modal-title">${escapeHtml(row.project?.projectNumber || "Project")} - ${escapeHtml(row.itemCode)}</h3>
            <p class="query-line">${escapeHtml(row.project?.projectName ?? "Unknown project")} | ${escapeHtml(row.descriptionRaw)}</p>
          </div>
          <button type="button" class="secondary-button bidder-modal__close" data-close-bidder-detail>Close</button>
        </div>
        <div class="bidder-modal__summary">
          <span>Apparent low: <strong>${escapeHtml(apparentLowBid?.bidderName ?? "Not listed")}</strong></span>
          <span>Confirmed award: <strong>${escapeHtml(confirmedAwardBid?.bidderName ?? "Not listed")}</strong></span>
          <span>Bid count: <strong>${formatNumber(bidderBids.length)}</strong></span>
          <span>Source: <strong>${escapeHtml(row.source?.sourceLabel ?? "Unknown source")}</strong></span>
        </div>
        <div class="table-scroll bidder-detail-scroll">
          <table class="bidder-detail-table">
            <thead>
              <tr>
                <th>Bidder</th>
                <th>Vendor ID</th>
                <th>Rank</th>
                <th>% of low</th>
                <th>Status</th>
                <th>Unit price</th>
                <th>Extended price</th>
                <th>Bid total</th>
              </tr>
            </thead>
            <tbody>
              ${bidderItems
                .slice()
                .sort((left, right) => compareBidderItems(left, right, bidById))
                .map((item) => renderBidderDetailRow(item, bidById.get(item.bidId) ?? null))
                .join("")}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderBidderDetailRow(item: BidderItemObservationRecord, bid: BidderBidRecord | null): string {
  return `
    <tr>
      <td>
        ${escapeHtml(bid?.bidderName ?? item.bidId)}
        ${bid?.apparentLow ? `<div class="row-subtext">Apparent low</div>` : ""}
      </td>
      <td>${escapeHtml(bid?.sourceVendorId || "Not listed")}</td>
      <td>${bid?.bidRank ?? "Not listed"}</td>
      <td>${bid?.percentOfLow === null || bid?.percentOfLow === undefined ? "Not listed" : `${formatNumber(bid.percentOfLow)}%`}</td>
      <td>${bid?.isAwarded ? "Awarded" : bid?.apparentLow ? "Apparent low" : "Bid"}</td>
      <td>${formatCurrency(item.unitPrice)}</td>
      <td>${formatCurrency(item.extendedPrice)}</td>
      <td>${bid ? formatCurrency(bid.bidTotal) : "Not listed"}</td>
    </tr>
  `;
}

function compareBidderItems(
  left: BidderItemObservationRecord,
  right: BidderItemObservationRecord,
  bidById: Map<string, BidderBidRecord>
): number {
  const leftRank = bidById.get(left.bidId)?.bidRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = bidById.get(right.bidId)?.bidRank ?? Number.MAX_SAFE_INTEGER;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.bidId.localeCompare(right.bidId);
}

function readOptionalNumber(value: FormDataEntryValue | null): number | null {
  const text = String(value || "").trim();

  if (!text) {
    return null;
  }

  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
}

function formatNullableCurrency(value: number | null): string {
  return value === null ? "Not listed" : formatCurrency(value);
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function formatWholeCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return replacements[char];
  });
}
