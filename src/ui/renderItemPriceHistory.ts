import type { StateConfig } from "../data/schema";
import type { ItemPriceHistoryResult, ItemPriceHistorySort, ItemPriceHistorySortKey } from "../matching/buildItemPriceHistoryResult";
import type { AnnualInflationAdjustedPriceSet } from "../matching/inflationAdjustment";

interface HistoryColumn { key: ItemPriceHistorySortKey; label: string; }

export function renderItemPriceHistory(
  result: ItemPriceHistoryResult,
  stateConfig: StateConfig,
  inflationAdjustmentEnabled: boolean,
  annualInflationAdjustedPriceSet: AnnualInflationAdjustedPriceSet | null,
  showEditButton = false,
  adjacentItems: { previous: { id: string; code: string; description: string } | null; next: { id: string; code: string; description: string } | null } | null = null
): string {
  if (!stateConfig.capabilities.periodPriceHistory || !result.query.itemCode) return "";
  const title = stateConfig.periodPriceHistoryTitle ?? "Item Price History";
  const measureLabel = stateConfig.periodPriceMeasureLabel ?? "Published average unit price";
  const queryLine = `Item code: ${escapeHtml(result.query.itemCode)} | Unit: ${escapeHtml(result.query.unit || "Varies by report")}`;
  return `
    <section class="panel-block panel-block--table item-price-history-panel">
      <div class="panel-heading evidence-table-heading">
        <div>
          <p class="eyebrow">${escapeHtml(title)}</p>
          <h3>${escapeHtml(result.query.description || result.query.itemCode)}</h3>
          <p class="query-line">${queryLine}</p>
          ${adjacentItems ? `<div class="adjacent-item-controls" aria-label="Selected item ${escapeHtml(result.query.itemCode)}: ${escapeHtml(result.query.description)}. Adjacent catalog items" tabindex="-1">
            <button type="button" data-adjacent-item-id="${escapeHtml(adjacentItems.previous?.id ?? "")}" aria-label="${escapeHtml(adjacentItems.previous ? `Previous item ${adjacentItems.previous.code}: ${adjacentItems.previous.description}` : "No previous item")}" ${adjacentItems.previous ? "" : "disabled"}>← Previous</button>
            <button type="button" data-adjacent-item-id="${escapeHtml(adjacentItems.next?.id ?? "")}" aria-label="${escapeHtml(adjacentItems.next ? `Next item ${adjacentItems.next.code}: ${adjacentItems.next.description}` : "No next item")}" ${adjacentItems.next ? "" : "disabled"}>Next →</button>
          </div>` : ""}
        </div>
        <div class="matching-projects-actions">
          <button type="button" id="download-item-price-history-csv" class="secondary-button matching-projects-export-button" ${result.filteredRows.length === 0 ? "disabled" : ""}>Download CSV</button>
          ${showEditButton ? `<button type="button" id="edit-item-search" class="primary-button matching-projects-edit-button">Edit Item Search</button>` : ""}
        </div>
      </div>
      <p class="item-price-history-note">NDOT publishes average item prices for overlapping reporting periods. Some NDOT item numbers share the same official description; use the item number and unit to distinguish them.</p>
      ${renderFilters(result)}
      ${result.filteredRows.length ? renderHistoryTable(result, measureLabel, inflationAdjustmentEnabled, annualInflationAdjustedPriceSet) : `<p class="evidence-empty">No published annual price rows match the selected report series and unit.</p>`}
      ${renderAnnualInflationNote(inflationAdjustmentEnabled, annualInflationAdjustedPriceSet)}
    </section>
  `;
}

export function readItemPriceHistoryFiltersFromForm(form: HTMLFormElement): { reportSeries: "all" | "calendar_year" | "july_june"; unit: string } {
  const reportSeries = String(new FormData(form).get("reportSeries") ?? "all");
  return {
    reportSeries: reportSeries === "calendar_year" || reportSeries === "july_june" ? reportSeries : "all",
    unit: String(new FormData(form).get("unit") ?? "")
  };
}

function renderFilters(result: ItemPriceHistoryResult): string {
  return `
    <form id="item-price-history-filters-form" class="item-price-history-filter-form">
      <label>Report series
        <select name="reportSeries">
          <option value="all" ${result.filters.reportSeries === "all" ? "selected" : ""}>All report series</option>
          <option value="calendar_year" ${result.filters.reportSeries === "calendar_year" ? "selected" : ""}>January–December</option>
          <option value="july_june" ${result.filters.reportSeries === "july_june" ? "selected" : ""}>July–June</option>
        </select>
      </label>
      <label>Reported unit
        <select name="unit">
          <option value="">All units</option>
          ${result.availableUnits.map((unit) => `<option value="${escapeHtml(unit)}" ${unit === result.filters.unit ? "selected" : ""}>${escapeHtml(unit)}</option>`).join("")}
        </select>
      </label>
      <div class="filter-form-actions">
        <button type="submit" class="primary-button">Apply</button>
        <button type="button" id="clear-item-price-history-filters" class="secondary-button">Clear</button>
      </div>
    </form>
  `;
}

function renderHistoryTable(
  result: ItemPriceHistoryResult,
  measureLabel: string,
  inflationAdjustmentEnabled: boolean,
  annualInflationAdjustedPriceSet: AnnualInflationAdjustedPriceSet | null
): string {
  const columns: HistoryColumn[] = [
    { key: "period", label: "Period" }, { key: "itemCode", label: "Item No." }, { key: "description", label: "Item Description" },
    { key: "quantity", label: "Total Quantity" }, { key: "unit", label: "Unit" }, { key: "averageUnitPrice", label: measureLabel },
    { key: "totalBid", label: "Total Bid" }, { key: "source", label: "Source" }
  ];
  return `<div class="table-scroll-shell"><div class="table-scroll-affordance" aria-hidden="true"><span></span></div><div class="table-scroll table-scroll--sticky-results" tabindex="0" aria-label="Annual item price history table"><table class="evidence-table item-price-history-table"><thead><tr>${columns.map((column) => sortableHeader(column, result.sort)).join("")}</tr></thead><tbody>${result.filteredRows.map((row) => `<tr><td class="item-price-history-column--period">${escapeHtml(row.summary.periodLabel)}</td><td class="item-price-history-column--itemCode">${escapeHtml(row.summary.agencyItemCode)}</td><td class="item-price-history-column--description">${escapeHtml(row.summary.descriptionRaw)}</td><td class="item-price-history-column--quantity">${formatNumber(row.summary.totalQuantity)}</td><td class="item-price-history-column--unit">${escapeHtml(row.summary.unitRaw)}</td><td class="item-price-history-column--averageUnitPrice">${renderAnnualUnitPrice(row.summary.publishedAverageUnitPrice, row.summary.summaryId, inflationAdjustmentEnabled, annualInflationAdjustedPriceSet)}</td><td class="item-price-history-column--totalBid">${formatCurrency(row.summary.totalBid)}</td><td class="item-price-history-column--source">${renderSource(row.source?.sourceUrl ?? "", row.source?.sourceLabel ?? "Source not available")}</td></tr>`).join("")}</tbody></table></div></div>`;
}

function renderAnnualUnitPrice(
  publishedValue: number,
  summaryId: string,
  inflationAdjustmentEnabled: boolean,
  annualInflationAdjustedPriceSet: AnnualInflationAdjustedPriceSet | null
): string {
  if (!inflationAdjustmentEnabled) return formatCurrency(publishedValue);
  const adjustedValue = annualInflationAdjustedPriceSet?.adjustedAverageUnitPriceBySummaryId.get(summaryId) ?? null;
  if (adjustedValue === null) {
    const reason = !annualInflationAdjustedPriceSet?.targetPeriod
      ? "No FHWA NHCCI target index is available. The published price is unchanged."
      : "The adjustment requires index values for all four quarters in this report period; at least one is unavailable. The published price is unchanged.";
    return `${formatCurrency(publishedValue)}<span class="adjusted-price-line adjusted-price-line--unavailable" tabindex="0" title="${escapeHtml(reason)}" aria-label="Not adjusted. ${escapeHtml(reason)}">Not adjusted</span>`;
  }
  const targetPeriod = annualInflationAdjustedPriceSet?.targetPeriod?.periodLabel;
  const originalDetail = `Original published price ${formatCurrency(publishedValue)}. Adjusted with FHWA NHCCI to ${targetPeriod ?? "the latest available quarter"}.`;
  return `<span class="adjusted-price-value" tabindex="0" title="${escapeHtml(originalDetail)}" aria-label="Adjusted price ${formatCurrency(adjustedValue)}. ${escapeHtml(originalDetail)}">${formatCurrency(adjustedValue)}</span>`;
}

function renderAnnualInflationNote(enabled: boolean, priceSet: AnnualInflationAdjustedPriceSet | null): string {
  if (!enabled) return "";
  if (!priceSet?.targetPeriod) return `<p class="summary-adjustment-note">Inflation Adjustment is on, but no FHWA NHCCI index values are loaded.</p>`;
  const missing = priceSet.unavailableSummaryIds.size;
  return `<p class="summary-adjustment-note">NDOT published average unit prices are adjusted with FHWA NHCCI to ${escapeHtml(priceSet.targetPeriod.periodLabel)} only when all four report-period quarters are available. Focus or hover on an adjusted value to see its original price. Total Bid and CSV values remain source-published nominal values.${missing ? ` ${formatNumber(missing)} displayed row${missing === 1 ? "" : "s"} could not be adjusted.` : ""}</p>`;
}

function sortableHeader(column: HistoryColumn, sort: ItemPriceHistorySort): string {
  const active = sort.key === column.key;
  const nextDirection = active && sort.direction === "asc" ? "descending" : "ascending";
  return `<th aria-sort="${active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}" class="item-price-history-column--${column.key} ${active ? "table-sorted-column" : ""}"><button type="button" class="table-sort-button" data-item-price-history-sort-key="${column.key}" aria-label="Sort by ${escapeHtml(column.label)} ${nextDirection}"><span>${escapeHtml(column.label)}</span><span class="sort-indicator sort-indicator--${active ? sort.direction : "inactive"}" aria-hidden="true"></span></button></th>`;
}

function renderSource(url: string, label: string): string {
  return url ? `<a class="annual-history-source-link" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)}</a>` : escapeHtml(label);
}
function formatNumber(value: number): string { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value); }
function formatCurrency(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(value); }
function formatWholeCurrency(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value); }
function escapeHtml(value: string): string { return value.replace(/[&<>\"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '\"': "&quot;", "'": "&#039;" }[char] ?? char)); }
