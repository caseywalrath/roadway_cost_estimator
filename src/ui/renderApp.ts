import type { AppData, EvidenceRow, SearchQuery } from "../data/schema";
import type { EvidenceSortKey } from "../data/schema";
import {
  buildEvidenceResult,
  buildEvidenceStats,
  createDefaultEvidenceFilters,
  createDefaultEvidenceSort
} from "../matching/buildEvidenceResult";
import { buildInflationAdjustedSummary } from "../matching/inflationAdjustment";
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
            inflationAdjustedSummary
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
    evidenceFiltersForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      evidenceFilters = readEvidenceFiltersFromForm(evidenceFiltersForm, evidenceFilters);
      evidenceFiltersExpanded = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#clear-evidence-filters")?.addEventListener("click", () => {
      evidenceFilters = createDefaultEvidenceFilters(result.query);
      evidenceFiltersExpanded = false;
      render();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-quantity-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const targetName = button.dataset.quantityTarget;
        const step = Number(button.dataset.quantityStep ?? 0);
        const input = targetName
          ? root.querySelector<HTMLInputElement>(`input[name="${targetName}"]`)
          : null;

        if (!input || !Number.isFinite(step)) {
          return;
        }

        const currentValue = Number(input.value || 0);
        const nextValue = Math.max(0, (Number.isFinite(currentValue) ? currentValue : 0) + step);
        input.value = Number.isInteger(nextValue) ? String(nextValue) : String(Number(nextValue.toFixed(6)));
      });
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

function defaultSortDirection(sortKey: EvidenceSortKey): "asc" | "desc" {
  return sortKey === "letDate" || sortKey.endsWith("Price") || sortKey === "quantity" || sortKey === "bidCount"
    ? "desc"
    : "asc";
}
