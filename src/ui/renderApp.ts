import type { AppData, SearchQuery } from "../data/schema";
import { buildEvidenceResult, createDefaultEvidenceFilters } from "../matching/buildEvidenceResult";
import { helpTip } from "./helpTip";
import {
  bindItemPicker,
  readQueryFromForm,
  renderExplorer,
  renderItemSearchSummary
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
  let evidenceFiltersExpanded = false;
  let itemSearchCollapsed = false;

  function render(): void {
    const result = buildEvidenceResult(data, query, evidenceFilters);
    root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <div>
            <h1>Colorado Roadway Comparable Project Explorer</h1>
          </div>
          <div class="context-bar" aria-label="Prototype scope">
            <span>Scope: Colorado roadway ${helpTip("About prototype scope", "State is fixed to Colorado. The primary evidence table defaults to exact item-code matches from public CDOT cost-book rows.")}</span>
          </div>
        </header>

        <section class="workspace-grid ${itemSearchCollapsed ? "workspace-grid--item-search-collapsed" : ""}">
          ${itemSearchCollapsed ? renderItemSearchSummary(query, data.agencyItems) : renderExplorer(query, data.agencyItems, data.specSections)}
          ${renderResults(result, evidenceFiltersExpanded)}
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
      evidenceFiltersExpanded = false;
      itemSearchCollapsed = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#edit-item-search")?.addEventListener("click", () => {
      itemSearchCollapsed = false;
      render();
    });
  }

  render();
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
