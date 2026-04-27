import "./styles.css";
import { loadData } from "./data/loadData";
import { renderApp } from "./ui/renderApp";

const root = document.querySelector<HTMLDivElement>("#app");

if (!root) {
  throw new Error("App root element was not found.");
}

root.innerHTML = `
  <main class="app-shell app-shell--loading">
    <section class="status-panel">
      <p class="eyebrow">Loading demo data</p>
      <h1>Roadway Cost Comparable Explorer</h1>
      <p>Loading static CSV records from the public data package.</p>
    </section>
  </main>
`;

loadData()
  .then((data) => renderApp(root, data))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown data loading error.";
    root.innerHTML = `
      <main class="app-shell app-shell--loading">
        <section class="status-panel status-panel--error">
          <p class="eyebrow">Data load failed</p>
          <h1>Roadway Cost Comparable Explorer</h1>
          <p>${message}</p>
        </section>
      </main>
    `;
  });

