import type {
  EvidenceFilters,
  EvidenceResult,
  EvidenceRow,
  EvidenceSourceTypeFilter,
  EvidenceStats
} from "../data/schema";
import { helpTip } from "./helpTip";

export function renderResults(result: EvidenceResult, filtersExpanded: boolean): string {
  return `
    <section class="results-panel">
      ${renderEvidenceIntro(result)}
      ${renderEvidenceTable(result, filtersExpanded)}
      ${renderAwardedBidSummary(result.stats)}
      ${renderDataNotes(result.notes)}
    </section>
  `;
}

function renderEvidenceIntro(result: EvidenceResult): string {
  return `
    <section class="evidence-intro panel-block">
      <div>
        <p class="eyebrow">Project Evidence Browser</p>
        <h2>
          ${escapeHtml(result.interpretedDescription)}
          ${helpTip("About project evidence", "The app lists exact item-code project evidence and leaves filtering and interpretation to the engineer. It does not choose a suggested unit price.")}
        </h2>
        <p class="query-line">
          Item code: ${escapeHtml(result.query.itemCode || "Not selected")} |
          Unit: ${escapeHtml(result.query.unit || "Not selected")} |
          Quantity: ${result.query.quantity ? formatNumber(result.query.quantity) : "Not entered"}
        </p>
      </div>
      <div class="evidence-counts" aria-label="Evidence counts">
        <div class="metric">
          <span>Exact-code evidence rows</span>
          <strong>${result.allExactRows.length}</strong>
        </div>
        <div class="metric">
          <span>Rows after filters</span>
          <strong>${result.filteredRows.length}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderEvidenceTable(result: EvidenceResult, filtersExpanded: boolean): string {
  if (!result.query.itemCode) {
    return `
      <section class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Matching Projects</p>
          <h3>Select an official item</h3>
        </div>
        <p class="muted">Use Item Book Search to select a loaded CDOT item code before reviewing project evidence.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block panel-block--table">
      <div class="panel-heading evidence-table-heading">
        <div>
          <p class="eyebrow">Matching Projects</p>
          <h3>
            ${result.filteredRows.length} filtered project-item row${result.filteredRows.length === 1 ? "" : "s"}
            ${helpTip("About matching projects", "Rows are exact item-code matches grouped by project, source, item description, unit, quantity, and date. Default results use public CDOT cost-book rows with the same unit as the selected item.")}
          </h3>
        </div>
      </div>
      ${renderEvidenceControls(result, filtersExpanded)}
      ${result.filteredRows.length === 0 ? renderEmptyTableMessage() : renderTable(result.filteredRows)}
    </section>
  `;
}

function renderEvidenceControls(result: EvidenceResult, filtersExpanded: boolean): string {
  const unitOptions = uniqueValues([result.filters.unit, ...result.availableUnits].filter(Boolean));

  return `
    <div class="evidence-filter-toolbar">
      <div class="filter-chip-list" aria-label="Active evidence filters">
        ${renderFilterChips(result)}
      </div>
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
    <div id="evidence-filter-drawer" class="evidence-filter-drawer" ${filtersExpanded ? "" : "hidden"}>
      <form id="evidence-filters-form" class="evidence-filter-form">
        <label>
          <span class="label-row">
            Source
            ${helpTip("About source filter", "Public CDOT cost-book rows are the default evidence source. Demo rows can be included for prototype review only.")}
          </span>
          <select name="sourceType">
            ${renderSourceTypeOption("public_cost_book", "Public CDOT cost book", result.filters.sourceType)}
            ${renderSourceTypeOption("all", "All loaded sources", result.filters.sourceType)}
            ${renderSourceTypeOption("public_demo", "Public demo rows", result.filters.sourceType)}
            ${renderSourceTypeOption("internal_demo", "Internal demo rows", result.filters.sourceType)}
          </select>
        </label>

        <label>
          <span class="label-row">
            Geography
            ${helpTip("About geography filter", "Text filter against project location, project name, and county or region fields. It filters rows directly instead of changing a relevance score.")}
          </span>
          <input name="geography" value="${escapeHtml(result.filters.geography)}" placeholder="District, county, or location" />
        </label>

        <label>
          <span class="label-row">
            District
            ${helpTip("About district filter", "CDOT district parsed from project metadata when available. Demo rows may not include a district.")}
          </span>
          <select name="district">
            <option value="">All districts</option>
            ${renderDistrictOptions(result.availableDistricts, result.filters.district)}
          </select>
        </label>

        <label>
          <span class="label-row">
            Unit
            ${helpTip("About unit filter", "Defaults to the selected official item unit. Other exact-code units are excluded unless the unit filter is changed.")}
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
            <input name="quantityMin" type="number" min="0" step="0.01" value="${result.filters.quantityMin ?? ""}" />
          </label>
          <label>
            <span>Max</span>
            <input name="quantityMax" type="number" min="0" step="0.01" value="${result.filters.quantityMax ?? ""}" />
          </label>
        </fieldset>

        <label class="checkbox-label">
          <input name="requireAwardedPrice" type="checkbox" ${result.filters.requireAwardedPrice ? "checked" : ""} />
          <span>Only rows with awarded bid price</span>
        </label>

        <button type="submit" class="secondary-button">Apply filters</button>
      </form>
    </div>
  `;
}

function renderTable(rows: EvidenceRow[]): string {
  return `
    <div class="table-scroll">
      <table class="evidence-table">
        <thead>
          <tr>
            <th>Project no. ${helpTip("About project number", "Public CDOT project number when available. Demo records may not have a project number.")}</th>
            <th>Project / location ${helpTip("About project location", "Project location or name from project metadata.")}
            </th>
            <th>District ${helpTip("About district", "CDOT district parsed from public cost-book project pages when available.")}</th>
            <th>Let date ${helpTip("About let date", "Project letting or estimate date from source metadata.")}</th>
            <th>Contractor ${helpTip("About contractor", "Awarded contractor when available from the public cost book.")}</th>
            <th>Bid count ${helpTip("About bid count", "Number of bids listed for the project when parsed from the cost book.")}</th>
            <th>Quantity ${helpTip("About quantity", "Quantity for this item on the historical project row.")}</th>
            <th>Unit ${helpTip("About unit", "Historical item unit. Default results show the same unit as the selected item.")}</th>
            <th>Item description ${helpTip("About item description", "Raw source description for the matching item code.")}</th>
            <th>Awarded bid unit price ${helpTip("About awarded bid unit price", "Awarded bid evidence. Summary statistics use this column only.")}</th>
            <th>Average bid unit price ${helpTip("About average bid unit price", "Average bid evidence when available. It is shown for review but not included in the phase 1 summary statistics.")}</th>
            <th>Engineer estimate unit price ${helpTip("About engineer estimate unit price", "Engineer estimate evidence when available. It is shown separately from bid evidence.")}</th>
            <th>Source ${helpTip("About source", "Source label for provenance. Review source type before using any value for estimating support.")}</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(renderEvidenceRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderEvidenceRow(row: EvidenceRow): string {
  return `
    <tr>
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

function renderAwardedBidSummary(stats: EvidenceStats | null): string {
  if (!stats) {
    return `
      <section class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Awarded Bid Summary</p>
          <h3>No awarded bid statistics available</h3>
        </div>
        <p class="muted">The current evidence rows do not include awarded bid unit prices.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block">
      <div class="panel-heading">
        <p class="eyebrow">Awarded Bid Summary</p>
        <h3>
          Statistics for currently filtered awarded bid prices
          ${helpTip("About awarded bid summary", "These statistics summarize the awarded bid unit price column for the rows currently visible in the table. They are not a suggested price.")}
        </h3>
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
    </section>
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

function renderEmptyTableMessage(): string {
  return `<p class="muted evidence-empty">No project-item rows match the current filters.</p>`;
}

function renderFilterChips(result: EvidenceResult): string {
  const chips = [
    `Rows: ${formatNumber(result.filteredRows.length)}`,
    `Source: ${sourceTypeLabel(result.filters.sourceType)}`,
    result.filters.geography ? `Geography: ${result.filters.geography}` : "",
    result.filters.district ? `District: ${result.filters.district}` : "",
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
    all: "All loaded sources",
    public_demo: "Public demo rows",
    internal_demo: "Internal demo rows"
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

function renderDistrictOptions(districts: string[], selectedDistrict: string): string {
  const options = uniqueValues([selectedDistrict, ...districts].filter(Boolean));

  return options
    .map((district) => `<option value="${escapeHtml(district)}" ${district === selectedDistrict ? "selected" : ""}>${escapeHtml(district)}</option>`)
    .join("");
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
    district: String(formData.get("district") || ""),
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
