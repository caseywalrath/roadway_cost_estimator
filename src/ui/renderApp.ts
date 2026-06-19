import type { AppData, EvidenceRow, SearchQuery } from "../data/schema";
import type { EvidenceSortKey } from "../data/schema";
import {
  buildEvidenceResult,
  buildEvidenceStats,
  createDefaultEvidenceFilters,
  createDefaultEvidenceSort
} from "../matching/buildEvidenceResult";
import { buildInflationAdjustedPriceSet, buildInflationAdjustedSummary } from "../matching/inflationAdjustment";
import { downloadEvidenceCsv } from "./exportEvidenceCsv";
import {
  bindItemPicker,
  readQueryFromForm,
  renderExplorer
} from "./renderExplorer";
import { readEvidenceFiltersFromForm, renderResults } from "./renderResults";

const emptyQuery: SearchQuery = {
  state: "CO",
  countyRegion: "",
  workType: "Roadway",
  estimateYear: new Date().getFullYear(),
  sourceScope: "both",
  priceTypeScope: "awarded",
  itemCode: "",
  description: "",
  unit: "",
  quantity: null
};

export function renderApp(root: HTMLElement, data: AppData): void {
  let query = { ...emptyQuery };
  let evidenceFilters = createDefaultEvidenceFilters(query);
  let evidenceSort = createDefaultEvidenceSort();
  let evidenceFiltersExpanded = false;
  let itemSearchCollapsed = false;
  let excludedSummaryRowIds = new Set<string>();
  let inflationAdjustmentEnabled = false;

  function render(): void {
    const result = buildEvidenceResult(data, query, evidenceFilters, evidenceSort);
    const includedRows = includedEvidenceRows(result.filteredRows, excludedSummaryRowIds);
    const includedStats = buildEvidenceStats(includedRows);
    const inflationAdjustedSummary = inflationAdjustmentEnabled
      ? buildInflationAdjustedSummary(includedRows, data.inflationIndexByPeriod)
      : null;
    const inflationAdjustedPriceSet = inflationAdjustmentEnabled
      ? buildInflationAdjustedPriceSet(result.filteredRows, data.inflationIndexByPeriod)
      : null;
    const visibleExcludedCount = result.filteredRows.length - includedRows.length;
    root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <div>
            <h1>Colorado Roadway Comparable Project Explorer</h1>
          </div>
          <div class="context-bar" aria-label="Prototype scope">
            <span>Scope: Colorado roadway</span>
          </div>
        </header>

        <section class="workspace-grid ${itemSearchCollapsed ? "workspace-grid--item-search-collapsed" : ""}">
          ${itemSearchCollapsed ? "" : renderExplorer(query, data.agencyItems, data.specSections)}
          ${renderResults(
            result,
            evidenceFiltersExpanded,
            itemSearchCollapsed,
            excludedSummaryRowIds,
            includedRows.length,
            visibleExcludedCount,
            includedStats,
            inflationAdjustmentEnabled,
            inflationAdjustedSummary,
            inflationAdjustedPriceSet?.adjustedPriceByRowId ?? null
          )}
        </section>
      </main>
    `;

    const form = root.querySelector<HTMLFormElement>("#explorer-form");
    if (form) {
      bindItemPicker(form, data.agencyItems, data.specSections);
    }

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      query = readQueryFromForm(form, query);
      evidenceFilters = createDefaultEvidenceFilters(query);
      evidenceSort = createDefaultEvidenceSort();
      excludedSummaryRowIds = new Set<string>();
      evidenceFiltersExpanded = false;
      itemSearchCollapsed = Boolean(query.itemCode);
      render();
    });

    root.querySelector<HTMLButtonElement>("#toggle-evidence-filters")?.addEventListener("click", () => {
      evidenceFiltersExpanded = !evidenceFiltersExpanded;
      render();
    });

    const evidenceFiltersForm = root.querySelector<HTMLFormElement>("#evidence-filters-form");
    evidenceFiltersForm?.querySelectorAll<HTMLInputElement>('input[name="quantityMin"], input[name="quantityMax"]').forEach((input) => {
      input.addEventListener("input", () => {
        input.setCustomValidity("");
      });
    });

    evidenceFiltersForm?.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!validateQuantityRange(evidenceFiltersForm)) {
        return;
      }

      evidenceFilters = readEvidenceFiltersFromForm(evidenceFiltersForm, evidenceFilters);
      evidenceFiltersExpanded = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#clear-evidence-filters")?.addEventListener("click", () => {
      evidenceFilters = createDefaultEvidenceFilters(result.query);
      evidenceFiltersExpanded = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#clear-query")?.addEventListener("click", () => {
      query = { ...emptyQuery };
      evidenceFilters = createDefaultEvidenceFilters(query);
      evidenceSort = createDefaultEvidenceSort();
      excludedSummaryRowIds = new Set<string>();
      evidenceFiltersExpanded = false;
      itemSearchCollapsed = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#edit-item-search")?.addEventListener("click", () => {
      itemSearchCollapsed = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#download-matching-projects-csv")?.addEventListener("click", () => {
      downloadEvidenceCsv(result, includedRows);
    });

    root.querySelector<HTMLInputElement>("#inflation-adjustment-toggle")?.addEventListener("change", (event) => {
      inflationAdjustmentEnabled = (event.currentTarget as HTMLInputElement).checked;
      render();
    });

    root.querySelectorAll<HTMLInputElement>("[data-exclude-row-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const rowId = checkbox.dataset.excludeRowId;

        if (!rowId) {
          return;
        }

        if (checkbox.checked) {
          excludedSummaryRowIds.add(rowId);
        } else {
          excludedSummaryRowIds.delete(rowId);
        }

        render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-evidence-sort-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const sortKey = button.dataset.evidenceSortKey as EvidenceSortKey | undefined;

        if (!sortKey) {
          return;
        }

        evidenceSort = evidenceSort.key === sortKey
          ? {
              key: sortKey,
              direction: evidenceSort.direction === "asc" ? "desc" : "asc"
            }
          : {
              key: sortKey,
              direction: defaultSortDirection(sortKey)
            };
        render();
      });
    });
  }

  render();
}

function includedEvidenceRows(rows: EvidenceRow[], excludedRowIds: ReadonlySet<string>): EvidenceRow[] {
  return rows.filter((row) => !excludedRowIds.has(row.rowId));
}

function validateQuantityRange(form: HTMLFormElement): boolean {
  const quantityMinInput = form.elements.namedItem("quantityMin") as HTMLInputElement | null;
  const quantityMaxInput = form.elements.namedItem("quantityMax") as HTMLInputElement | null;

  if (!quantityMinInput || !quantityMaxInput) {
    return true;
  }

  quantityMinInput.setCustomValidity("");
  quantityMaxInput.setCustomValidity("");

  const quantityMin = readOptionalFormNumber(quantityMinInput.value);
  const quantityMax = readOptionalFormNumber(quantityMaxInput.value);

  if (quantityMinInput.value.trim() && quantityMin === null) {
    quantityMinInput.setCustomValidity("Enter a numeric minimum quantity.");
    quantityMinInput.reportValidity();
    return false;
  }

  if (quantityMaxInput.value.trim() && quantityMax === null) {
    quantityMaxInput.setCustomValidity("Enter a numeric maximum quantity.");
    quantityMaxInput.reportValidity();
    return false;
  }

  if (quantityMin !== null && quantityMax !== null && quantityMin > quantityMax) {
    quantityMaxInput.setCustomValidity("Maximum quantity must be greater than or equal to minimum quantity.");
    quantityMaxInput.reportValidity();
    return false;
  }

  return true;
}

function readOptionalFormNumber(value: string): number | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const numberValue = Number(trimmedValue);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function defaultSortDirection(sortKey: EvidenceSortKey): "asc" | "desc" {
  return sortKey === "letDate" || sortKey.endsWith("Price") || sortKey === "quantity" || sortKey === "bidCount"
    ? "desc"
    : "asc";
}
