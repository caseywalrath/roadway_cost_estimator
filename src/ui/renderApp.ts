import type { AppData, SearchQuery } from "../data/schema";
import { scoreComparableItems } from "../matching/scoreComparableItems";
import { readQueryFromForm, renderExplorer } from "./renderExplorer";
import { renderResults } from "./renderResults";

const exampleQuery: SearchQuery = {
  state: "CO",
  countyRegion: "Douglas",
  workType: "Roadway",
  estimateYear: 2026,
  sourceScope: "both",
  itemCode: "304-06007",
  description: "Aggregate Base Course Class 6",
  unit: "CY",
  quantity: 1800
};

export function renderApp(root: HTMLElement, data: AppData): void {
  let query = { ...exampleQuery };

  function render(): void {
    const result = scoreComparableItems(data, query);
    root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <div>
            <p class="eyebrow">Static prototype | Demo data only</p>
            <h1>Colorado Roadway Comparable Project Explorer</h1>
          </div>
          <div class="context-bar" aria-label="Project context">
            <span>State: ${escapeHtml(query.state)}</span>
            <span>Region: ${escapeHtml(query.countyRegion || "Statewide")}</span>
            <span>Work type: ${escapeHtml(query.workType)}</span>
            <span>Estimate year: ${query.estimateYear}</span>
            <span>Sources: ${sourceScopeLabel(query.sourceScope)}</span>
          </div>
        </header>

        <section class="prototype-note">
          This prototype uses synthetic demo records to prove the comparable-selection workflow. Do not use these prices for real estimating.
        </section>

        <section class="workspace-grid">
          ${renderExplorer(query)}
          ${renderResults(result)}
        </section>
      </main>
    `;

    const form = root.querySelector<HTMLFormElement>("#explorer-form");
    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      query = readQueryFromForm(form);
      render();
    });

    root.querySelector<HTMLButtonElement>("#reset-example")?.addEventListener("click", () => {
      query = { ...exampleQuery };
      render();
    });
  }

  render();
}

function sourceScopeLabel(sourceScope: string): string {
  if (sourceScope === "public") {
    return "Public demo";
  }

  if (sourceScope === "internal") {
    return "Internal demo";
  }

  return "Public + internal demo";
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
