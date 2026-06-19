import type {
  EvidenceFilters,
  EvidenceResult,
  EvidenceRow,
  EvidenceSort,
  EvidenceSortKey,
  EvidenceSourceTypeFilter,
  EvidenceStats
} from "../data/schema";
import type { InflationAdjustedSummary } from "../matching/inflationAdjustment";

export function renderResults(
  result: EvidenceResult,
  filtersExpanded: boolean,
  itemSearchCollapsed: boolean,
  excludedSummaryRowIds: ReadonlySet<string>,
  includedRowCount: number,
  visibleExcludedCount: number,
  includedStats: EvidenceStats | null,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null
): string {
  return `
    <section class="results-panel">
      ${renderEvidenceTable(result, filtersExpanded, itemSearchCollapsed, excludedSummaryRowIds, includedRowCount, visibleExcludedCount)}
      ${renderAwardedBidSummary(
        inflationAdjustmentEnabled ? inflationAdjustedSummary?.stats ?? null : includedStats,
        result.filteredRows.length,
        includedRowCount,
        inflationAdjustmentEnabled,
        inflationAdjustedSummary
      )}
      ${renderSourceCoverageNote(result)}
      ${renderDataNotes(result.notes)}
    </section>
  `;
}

function renderEvidenceTable(
  result: EvidenceResult,
  filtersExpanded: boolean,
  itemSearchCollapsed: boolean,
  excludedSummaryRowIds: ReadonlySet<string>,
  includedRowCount: number,
  visibleExcludedCount: number
): string {
  if (!result.query.itemCode) {
    return `
      <section class="panel-block">
        ${renderMatchingProjectsHeader(result, false)}
        <p class="muted">Use Item Book Search to select a loaded CDOT item code before reviewing project evidence.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block panel-block--table">
      ${renderMatchingProjectsHeader(result, itemSearchCollapsed, includedRowCount)}
      ${renderEvidenceControls(result, filtersExpanded, visibleExcludedCount)}
      ${result.filteredRows.length === 0 ? renderEmptyTableMessage() : renderTable(result.filteredRows, result.sort, excludedSummaryRowIds)}
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

function renderEvidenceControls(result: EvidenceResult, filtersExpanded: boolean, visibleExcludedCount: number): string {
  const unitOptions = uniqueValues([result.filters.unit, ...result.availableUnits].filter(Boolean));

  return `
    <div class="evidence-filter-toolbar">
      <div class="filter-chip-list" aria-label="Active evidence filters">
        ${renderFilterChips(result)}
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
            ${renderSourceTypeOption("public_cost_book", "Public CDOT cost book", result.filters.sourceType)}
            ${renderSourceTypeOption("all", "All loaded sources", result.filters.sourceType)}
          </select>
        </label>

        <label>
          <span class="label-row">
            Geography
          </span>
          <input name="geography" value="${escapeHtml(result.filters.geography)}" placeholder="District, county, or location" />
        </label>

        <fieldset class="district-filter-field">
          <legend>District</legend>
          <details class="district-multiselect">
            <summary>${escapeHtml(districtSummaryLabel(result.filters.districts))}</summary>
            <div class="district-multiselect-menu">
              ${renderDistrictCheckboxOptions(result.availableDistricts, result.filters.districts)}
            </div>
          </details>
        </fieldset>

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
            ${renderQuantityStepper("quantityMin", result.filters.quantityMin)}
          </label>
          <label>
            <span>Max</span>
            ${renderQuantityStepper("quantityMax", result.filters.quantityMax)}
          </label>
        </fieldset>

        <label class="checkbox-label">
          <input name="requireAwardedPrice" type="checkbox" ${result.filters.requireAwardedPrice ? "checked" : ""} />
          <span>Only rows with awarded bid price</span>
        </label>

        <div class="filter-form-actions">
          <button type="submit" class="secondary-button">Apply filters</button>
          <button type="button" id="clear-evidence-filters" class="secondary-button">Clear Filters</button>
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
  { key: "projectNumber", label: "Project no." },
  { key: "projectLocation", label: "Project / location" },
  { key: "district", label: "District" },
  { key: "letDate", label: "Let date" },
  { key: "contractor", label: "Contractor" },
  { key: "bidCount", label: "Bid count" },
  { key: "quantity", label: "Quantity" },
  { key: "unit", label: "Unit" },
  { key: "description", label: "Item description" },
  { key: "awardedBidUnitPrice", label: "Awarded bid unit price" },
  { key: "averageBidUnitPrice", label: "Average bid unit price" },
  { key: "engineerEstimateUnitPrice", label: "Engineer estimate unit price" },
  { key: "source", label: "Source" }
];

function renderTable(rows: EvidenceRow[], sort: EvidenceSort, excludedSummaryRowIds: ReadonlySet<string>): string {
  return `
    <div class="table-scroll-shell">
      <div class="table-scroll-affordance" aria-hidden="true"><span></span></div>
      <div class="table-scroll" tabindex="0" aria-label="Matching project evidence table">
        <table class="evidence-table">
          <thead>
            <tr>
              <th class="evidence-exclude-header">Exclude from Summary</th>
              ${evidenceColumns.map((column) => renderSortableHeader(column, sort)).join("")}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => renderEvidenceRow(row, excludedSummaryRowIds.has(row.rowId))).join("")}
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

function renderEvidenceRow(row: EvidenceRow, isExcluded: boolean): string {
  const projectLabel = row.project?.projectNumber || row.project?.projectName || row.project?.projectLocationRaw || row.itemCode;

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
      <td>${escapeHtml(row.project?.projectNumber || "Not listed")}</td>
      <td>
        ${escapeHtml(row.project?.projectName ?? "Unknown project")}
        ${row.project?.countyRegion ? `<div class="row-subtext">${escapeHtml(row.project.countyRegion)}</div>` : ""}
      </td>
      <td>${escapeHtml(row.project?.district || "Not listed")}</td>
      <td>${escapeHtml(row.project?.estimateLetDate || row.dateBasis)}</td>
      <td>${escapeHtml(row.project?.contractor || "Not listed")}</td>
      <td>${row.project?.bidCount ?? "Not listed"}</td>
      <td>${formatNumber(row.quantity)}</td>
      <td>${escapeHtml(row.unit)}</td>
      <td>${escapeHtml(row.descriptionRaw)}</td>
      <td>${formatNullableCurrency(row.awardedBidUnitPrice)}</td>
      <td>${formatNullableCurrency(row.averageBidUnitPrice)}</td>
      <td>${formatNullableCurrency(row.engineerEstimateUnitPrice)}</td>
      <td>${escapeHtml(row.source?.sourceLabel ?? "Unknown source")}</td>
    </tr>
  `;
}

function renderAwardedBidSummary(
  stats: EvidenceStats | null,
  filteredRowCount: number,
  includedRowCount: number,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null
): string {
  const inflationControl = renderInflationAdjustmentControl(inflationAdjustmentEnabled);
  const inflationNote = renderInflationAdjustmentNote(inflationAdjustmentEnabled, inflationAdjustedSummary);

  if (filteredRowCount > 0 && includedRowCount === 0) {
    return `
      <section class="panel-block">
        <div class="summary-heading-row">
          <div class="panel-heading">
            <p class="eyebrow">Awarded Bid Summary</p>
            <h3>No included rows in summary</h3>
          </div>
          ${inflationControl}
        </div>
        <p class="muted">All current evidence rows are excluded from the Awarded Bid Summary.</p>
        ${inflationNote}
      </section>
    `;
  }

  if (!stats) {
    const noStatsMessage = inflationAdjustmentEnabled && (inflationAdjustedSummary?.awardedRowCount ?? 0) > 0
      ? "No included awarded bid rows could be adjusted because their source quarters are not loaded in the FHWA NHCCI table."
      : "The included evidence rows do not include awarded bid unit prices.";

    return `
      <section class="panel-block">
        <div class="summary-heading-row">
          <div class="panel-heading">
            <p class="eyebrow">Awarded Bid Summary</p>
            <h3>No awarded bid statistics available</h3>
          </div>
          ${inflationControl}
        </div>
        <p class="muted">${noStatsMessage}</p>
        ${inflationNote}
      </section>
    `;
  }

  return `
    <section class="panel-block">
      <div class="summary-heading-row">
        <div class="panel-heading">
          <p class="eyebrow">Awarded Bid Summary</p>
          <h3>${inflationAdjustmentEnabled ? "Statistics for NHCCI-adjusted awarded bid prices" : "Statistics for included awarded bid prices"}</h3>
        </div>
        ${inflationControl}
      </div>
      <div class="distribution-grid evidence-stats-grid">
        ${renderStatMetric("Count", stats.count, false)}
        ${renderStatMetric("Low", stats.low, true)}
        ${renderStatMetric("P25", stats.p25, true)}
        ${renderStatMetric("Median", stats.median, true)}
        ${renderStatMetric("Average", stats.average, true)}
        ${renderStatMetric("P75", stats.p75, true)}
        ${renderStatMetric("High", stats.high, true)}
      </div>
      ${inflationNote}
    </section>
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
    ? ` ${formatNumber(summary.missingIndexCount)} included awarded bid row(s) could not be adjusted because no NHCCI value is loaded for their source quarter.`
    : "";

  return `
    <p class="summary-adjustment-note">
      Inflation Adjustment is on. Awarded bid unit prices are adjusted with FHWA NHCCI to ${escapeHtml(summary.targetPeriod.periodLabel)}.
      Original Matching Projects prices and CSV export are unchanged.${missingNote}
    </p>
  `;
}

function renderStatMetric(label: string, value: number, currency: boolean): string {
  return `
    <div class="distribution-metric">
      <span>${escapeHtml(label)}</span>
      <strong>${currency ? formatCurrency(value) : formatNumber(value)}</strong>
    </div>
  `;
}

function renderDataNotes(notes: string[]): string {
  if (notes.length === 0) {
    return "";
  }

  return `
    <section class="panel-block">
      <div class="panel-heading">
        <p class="eyebrow">Data Notes</p>
        <h3>Review before use</h3>
      </div>
      <ul class="guidance-list">
        ${notes.map((note) => `<li>${escapeHtml(note)}</li>`).join("")}
      </ul>
    </section>
  `;
}

function renderSourceCoverageNote(result: EvidenceResult): string {
  if (!result.query.itemCode) {
    return "";
  }

  return `
    <section class="panel-block source-coverage-note">
      <div class="panel-heading">
        <p class="eyebrow">Source Coverage</p>
        <h3>Public CDOT Cost Data Books</h3>
      </div>
      <ul class="guidance-list">
        <li>Loaded periods: 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1.</li>
        <li>Default evidence is exact official item-code matching only.</li>
        <li>Optional inflation adjustment applies only to Awarded Bid Summary statistics and uses loaded FHWA NHCCI quarters.</li>
        <li>Not included: private FHU data, demo project evidence, unit conversion, or a final price recommendation.</li>
      </ul>
    </section>
  `;
}

function renderEmptyTableMessage(): string {
  return `<p class="muted evidence-empty">No project-item rows match the current filters.</p>`;
}

function renderFilterChips(result: EvidenceResult): string {
  const chips = [
    `Rows: ${formatNumber(result.filteredRows.length)}`,
    `Source: ${sourceTypeLabel(result.filters.sourceType)}`,
    result.filters.geography ? `Geography: ${result.filters.geography}` : "",
    result.filters.districts.length > 0 ? `District: ${districtSummaryLabel(result.filters.districts)}` : "",
    result.filters.unit ? `Unit: ${result.filters.unit}` : "",
    result.filters.yearMin !== null || result.filters.yearMax !== null
      ? `Year: ${rangeLabel(result.filters.yearMin, result.filters.yearMax)}`
      : "",
    result.filters.quantityMin !== null || result.filters.quantityMax !== null
      ? `Quantity: ${rangeLabel(result.filters.quantityMin, result.filters.quantityMax)}`
      : "",
    result.filters.requireAwardedPrice ? "Awarded price required" : ""
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

function sourceTypeLabel(value: EvidenceSourceTypeFilter): string {
  const labels: Record<EvidenceSourceTypeFilter, string> = {
    public_cost_book: "Public CDOT cost book",
    all: "All loaded sources"
  };

  return labels[value];
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

function renderQuantityStepper(name: "quantityMin" | "quantityMax", value: number | null): string {
  return `
    <div class="filter-number-stepper">
      <button type="button" class="stepper-button" data-quantity-step="-1" data-quantity-target="${name}" aria-label="Decrease ${name === "quantityMin" ? "minimum" : "maximum"} quantity">-</button>
      <input name="${name}" type="number" min="0" step="any" value="${value ?? ""}" inputmode="decimal" />
      <button type="button" class="stepper-button" data-quantity-step="1" data-quantity-target="${name}" aria-label="Increase ${name === "quantityMin" ? "minimum" : "maximum"} quantity">+</button>
    </div>
  `;
}

export function readEvidenceFiltersFromForm(
  form: HTMLFormElement,
  currentFilters: EvidenceFilters
): EvidenceFilters {
  const formData = new FormData(form);

  return {
    ...currentFilters,
    sourceType: String(formData.get("sourceType") || "public_cost_book") as EvidenceSourceTypeFilter,
    geography: String(formData.get("geography") || ""),
    districts: formData.getAll("districts").map((value) => String(value)).filter(Boolean),
    yearMin: readOptionalNumber(formData.get("yearMin")),
    yearMax: readOptionalNumber(formData.get("yearMax")),
    quantityMin: readOptionalNumber(formData.get("quantityMin")),
    quantityMax: readOptionalNumber(formData.get("quantityMax")),
    unit: String(formData.get("unit") || ""),
    requireAwardedPrice: formData.get("requireAwardedPrice") === "on"
  };
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
