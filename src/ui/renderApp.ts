import type { AppData, SearchQuery } from "../data/schema";
import { scoreComparableItems } from "../matching/scoreComparableItems";
import { helpTip } from "./helpTip";
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

const emptyQuery: SearchQuery = {
  state: "CO",
  countyRegion: "",
  workType: "Roadway",
  estimateYear: new Date().getFullYear(),
  sourceScope: "both",
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
            <p class="eyebrow">Static prototype | Demo data only</p>
            <h1>Colorado Roadway Comparable Project Explorer</h1>
          </div>
          <div class="context-bar" aria-label="Project context">
            <span>State: ${escapeHtml(query.state)} ${helpTip("About context state", "State filters the source data. Colorado is the only active state in this prototype.")}</span>
            <span>Region: ${escapeHtml(query.countyRegion || "Statewide")} ${helpTip("About context region", "Region is used to favor nearby records. If missing, the app searches statewide Colorado demo records.")}</span>
            <span>Work type: ${escapeHtml(query.workType)} ${helpTip("About context work type", "Work type keeps roadway records separate from traffic, drainage, utility, and other disciplines.")}</span>
            <span>Estimate year: ${query.estimateYear} ${helpTip("About context estimate year", "Estimate year is used to rank recent records. This prototype does not yet apply cost escalation.")}</span>
            <span>Sources: ${sourceScopeLabel(query.sourceScope)} ${helpTip("About context sources", "Source scope helps reviewers see whether evidence comes from public-style records, internal-style records, or both. Current data is synthetic demo data.")}</span>
          </div>
        </header>

        <section class="prototype-note">
          This prototype uses synthetic demo records to prove the comparable-selection workflow. Do not use these prices for real estimating.
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

    root.querySelector<HTMLButtonElement>("#clear-query")?.addEventListener("click", () => {
      query = { ...emptyQuery };
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
