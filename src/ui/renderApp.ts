import type { AppData, SearchQuery } from "../data/schema";
import type { EvidenceSortKey } from "../data/schema";
import {
  buildEvidenceResult,
  createDefaultEvidenceFilters,
  createDefaultEvidenceSort
} from "../matching/buildEvidenceResult";
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

  function render(): void {
    const result = buildEvidenceResult(data, query, evidenceFilters, evidenceSort);
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
          ${renderResults(result, evidenceFiltersExpanded, itemSearchCollapsed)}
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

    root.querySelector<HTMLButtonElement>("#clear-query")?.addEventListener("click", () => {
      query = { ...emptyQuery };
      evidenceFilters = createDefaultEvidenceFilters(query);
      evidenceSort = createDefaultEvidenceSort();
      evidenceFiltersExpanded = false;
      itemSearchCollapsed = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#edit-item-search")?.addEventListener("click", () => {
      itemSearchCollapsed = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#download-matching-projects-csv")?.addEventListener("click", () => {
      downloadEvidenceCsv(result);
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

function defaultSortDirection(sortKey: EvidenceSortKey): "asc" | "desc" {
  return sortKey === "letDate" || sortKey.endsWith("Price") || sortKey === "quantity" || sortKey === "bidCount"
    ? "desc"
    : "asc";
}
