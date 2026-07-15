import "./styles.css";
import { loadManifest, loadStateData } from "./data/loadData";
import type { AppManifest } from "./data/schema";
import { renderApp } from "./ui/renderApp";

const STATE_PREFERENCE_KEY = "roadway-bid-item-explorer:state:v1";
const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root element was not found.");
}

showLoading("Loading data manifest");

loadManifest()
  .then((manifest) => {
    const savedState = window.localStorage.getItem(STATE_PREFERENCE_KEY)?.toUpperCase() ?? "";
    if (manifest.states.some((state) => state.code === savedState)) {
      return activateState(manifest, savedState);
    }
    renderStateChooser(manifest);
  })
  .catch(showError);

async function activateState(manifest: AppManifest, stateCode: string): Promise<void> {
  showLoading(`Loading ${stateCode} data`);
  try {
    const data = await loadStateData(manifest, stateCode);
    window.localStorage.setItem(STATE_PREFERENCE_KEY, stateCode);
    renderApp(root!, data, (nextState) => {
      if (nextState !== stateCode) {
        void activateState(manifest, nextState);
      }
    });
  } catch (error) {
    showError(error);
  }
}

function renderStateChooser(manifest: AppManifest): void {
  root!.innerHTML = `
    <main class="app-shell app-shell--loading">
      <section class="status-panel state-choice-panel">
        <p class="eyebrow">Select a state</p>
        <h1>${escapeHtml(manifest.productTitle)}</h1>
        <p>Search results remain isolated to the selected state.</p>
        <div class="state-choice-grid">
          ${manifest.states.map((state) => `
            <button type="button" class="primary-button" data-state-choice="${state.code}">
              ${escapeHtml(state.name)}
            </button>
          `).join("")}
        </div>
      </section>
    </main>
  `;
  root!.querySelectorAll<HTMLButtonElement>("[data-state-choice]").forEach((button) => {
    button.addEventListener("click", () => {
      const stateCode = button.dataset.stateChoice;
      if (stateCode) {
        void activateState(manifest, stateCode);
      }
    });
  });
}

function showLoading(label: string): void {
  root!.innerHTML = `
    <main class="app-shell app-shell--loading">
      <section class="status-panel">
        <p class="eyebrow">Loading project data</p>
        <h1>Roadway Bid Item Evidence Explorer</h1>
        <p>${escapeHtml(label)}.</p>
      </section>
    </main>
  `;
}

function showError(error: unknown): void {
  const message = error instanceof Error ? error.message : "Unknown data loading error.";
  root!.innerHTML = `
    <main class="app-shell app-shell--loading">
      <section class="status-panel status-panel--error">
        <p class="eyebrow">Data load failed</p>
        <h1>Roadway Bid Item Evidence Explorer</h1>
        <p>${escapeHtml(message)}</p>
      </section>
    </main>
  `;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
  })[character] ?? character);
}
