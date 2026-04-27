import type { SearchQuery, SourceScope } from "../data/schema";

export function renderExplorer(query: SearchQuery): string {
  return `
    <form id="explorer-form" class="search-panel">
      <div class="panel-heading">
        <p class="eyebrow">Item Explorer</p>
        <h2>Search one roadway bid item</h2>
      </div>

      <label>
        <span>Item code</span>
        <input name="itemCode" value="${escapeHtml(query.itemCode)}" placeholder="304-06007" />
      </label>

      <label>
        <span>Description</span>
        <input name="description" value="${escapeHtml(query.description)}" placeholder="Aggregate Base Course Class 6" />
      </label>

      <div class="field-grid">
        <label>
          <span>Unit</span>
          <input name="unit" value="${escapeHtml(query.unit)}" placeholder="CY" />
        </label>
        <label>
          <span>Quantity</span>
          <input name="quantity" type="number" min="0" step="0.01" value="${query.quantity ?? ""}" placeholder="1800" />
        </label>
      </div>

      <div class="field-grid">
        <label>
          <span>County / region</span>
          <input name="countyRegion" value="${escapeHtml(query.countyRegion)}" placeholder="Douglas" />
        </label>
        <label>
          <span>Estimate year</span>
          <input name="estimateYear" type="number" min="1990" max="2100" value="${query.estimateYear}" />
        </label>
      </div>

      <div class="field-grid">
        <label>
          <span>State</span>
          <select name="state">
            <option value="CO" ${query.state === "CO" ? "selected" : ""}>Colorado</option>
          </select>
        </label>
        <label>
          <span>Work type</span>
          <select name="workType">
            <option value="Roadway" ${query.workType === "Roadway" ? "selected" : ""}>Roadway</option>
          </select>
        </label>
      </div>

      <label>
        <span>Source scope</span>
        <select name="sourceScope">
          <option value="both" ${query.sourceScope === "both" ? "selected" : ""}>Public + internal demo data</option>
          <option value="public" ${query.sourceScope === "public" ? "selected" : ""}>Public demo data only</option>
          <option value="internal" ${query.sourceScope === "internal" ? "selected" : ""}>Internal demo data only</option>
        </select>
      </label>

      <button type="submit" class="primary-button">Search comparables</button>
      <button type="button" id="reset-example" class="secondary-button">Reset example</button>
    </form>
  `;
}

export function readQueryFromForm(form: HTMLFormElement): SearchQuery {
  const formData = new FormData(form);
  const quantity = Number(formData.get("quantity") || 0);
  const estimateYear = Number(formData.get("estimateYear") || new Date().getFullYear());

  return {
    state: String(formData.get("state") || "CO"),
    countyRegion: String(formData.get("countyRegion") || ""),
    workType: String(formData.get("workType") || "Roadway"),
    estimateYear: Number.isFinite(estimateYear) ? estimateYear : new Date().getFullYear(),
    sourceScope: String(formData.get("sourceScope") || "both") as SourceScope,
    itemCode: String(formData.get("itemCode") || ""),
    description: String(formData.get("description") || ""),
    unit: String(formData.get("unit") || ""),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : null
  };
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
