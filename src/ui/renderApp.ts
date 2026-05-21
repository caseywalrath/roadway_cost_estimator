import type { AppData, SearchQuery } from "../data/schema";
import { scoreComparableItems } from "../matching/scoreComparableItems";
import { helpTip } from "./helpTip";
import { bindItemPicker, readQueryFromForm, renderExplorer } from "./renderExplorer";
import { readProjectFiltersFromForm, renderResults } from "./renderResults";

const exampleQuery: SearchQuery = {
  state: "CO",
  countyRegion: "Douglas",
  workType: "Roadway",
  estimateYear: 2026,
  sourceScope: "both",
  priceTypeScope: "awarded",
  itemCode: "304-06007",
  description: "AGGREGATE BASE COURSE (CLASS 6)",
  unit: "CY",
  quantity: 1800
};

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
  let query = { ...exampleQuery };

  function render(): void {
    const result = scoreComparableItems(data, query);
    root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <div>
            <p class="eyebrow">Static prototype | Public CDOT and demo data</p>
            <h1>Colorado Roadway Comparable Project Explorer</h1>
          </div>
          <div class="context-bar" aria-label="Prototype scope">
            <span>Scope: Colorado roadway ${helpTip("About prototype scope", "State is fixed to Colorado and work type defaults to roadway. The data package now includes public CDOT cost-book records plus synthetic demo records.")}</span>
          </div>
        </header>

        <section class="prototype-note">
          This prototype includes public CDOT cost-book records and synthetic demo records to prove the comparable-selection workflow. Review source and price type before using any value for estimating.
        </section>

        <section class="prototype-guide" aria-label="How to read this prototype">
          <div>
            <p class="eyebrow">Prototype review guide</p>
            <h2>Use the info markers to review data meaning and source assumptions.</h2>
          </div>
          <p>
            The small <span class="inline-info-example">i</span> markers explain what each field means, why it affects matching, and where real data should come from. They are temporary scaffolding for early review with roadway engineers.
          </p>
        </section>

        <section class="workspace-grid">
          ${renderExplorer(query, data.agencyItems, data.specSections)}
          ${renderResults(result)}
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
      render();
    });

    const projectFiltersForm = root.querySelector<HTMLFormElement>("#project-filters-form");
    projectFiltersForm?.addEventListener("submit", (event) => {
      event.preventDefault();
      query = readProjectFiltersFromForm(projectFiltersForm, query);
      render();
    });

    root.querySelector<HTMLButtonElement>("#clear-query")?.addEventListener("click", () => {
      query = { ...emptyQuery };
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
