import type { SearchQuery, SourceScope } from "../data/schema";
import { helpTip } from "./helpTip";

export function renderExplorer(query: SearchQuery): string {
  return `
    <form id="explorer-form" class="search-panel">
      <div class="panel-heading">
        <p class="eyebrow">Item Explorer</p>
        <h2>
          Search one roadway bid item
          ${helpTip("About the item explorer", "This is a one-item lookup. It is meant to test whether the app can find comparable historical records before building a full estimate worksheet.")}
        </h2>
      </div>

      <label>
        <span class="label-row">
          Item code
          ${helpTip("About item code", "Agency bid item number. For Colorado roadway work this may be a CDOT item code. It is chosen as the strongest match key because it is more reliable than description text alone. Source: agency item code books or historical estimate line items.")}
        </span>
        <input name="itemCode" value="${escapeHtml(query.itemCode)}" placeholder="304-06007" />
      </label>

      <label>
        <span class="label-row">
          Description
          ${helpTip("About item description", "Human-readable bid item name. The app normalizes this text and compares it to approved aliases and keywords when the item code is missing or incomplete. Source: estimate rows, bid tabs, or agency item catalogs.")}
        </span>
        <input name="description" value="${escapeHtml(query.description)}" placeholder="Aggregate Base Course Class 6" />
      </label>

      <div class="field-grid">
        <label>
          <span class="label-row">
            Unit
            ${helpTip("About unit", "Measurement basis such as CY, TON, SY, LF, or EA. The prototype requires same-unit records for price recommendations because unit conversions can change the meaning of a cost comparison. Source: estimate rows and bid tabs.")}
          </span>
          <input name="unit" value="${escapeHtml(query.unit)}" placeholder="CY" />
        </label>
        <label>
          <span class="label-row">
            Quantity
            ${helpTip("About quantity", "Planned amount of work for this line item. It is used to rank projects with a similar scale of work higher than very small or very large examples. Source: current estimate line item.")}
          </span>
          <input name="quantity" type="number" min="0" step="0.01" value="${query.quantity ?? ""}" placeholder="1800" />
        </label>
      </div>

      <div class="field-grid">
        <label>
          <span class="label-row">
            County / region
            ${helpTip("About county or region", "Geographic context for the estimate. It is used as a ranking signal, not a hard requirement in the demo, because nearby projects may be more comparable than statewide records. Source: project setup, project metadata, or bid tab location.")}
          </span>
          <input name="countyRegion" value="${escapeHtml(query.countyRegion)}" placeholder="Douglas" />
        </label>
        <label>
          <span class="label-row">
            Estimate year
            ${helpTip("About estimate year", "Target year for the estimate. Recent records receive a higher score. Future versions may use this field for escalation, but this prototype does not apply automatic inflation factors.")}
          </span>
          <input name="estimateYear" type="number" min="1990" max="2100" value="${query.estimateYear}" />
        </label>
      </div>

      <div class="field-grid">
        <label>
          <span class="label-row">
            State
            ${helpTip("About state", "Initial prototype scope is Colorado only. State is a hard filter because cost data, item codes, and construction markets vary by agency and geography.")}
          </span>
          <select name="state">
            <option value="CO" ${query.state === "CO" ? "selected" : ""}>Colorado</option>
          </select>
        </label>
        <label>
          <span class="label-row">
            Work type
            ${helpTip("About work type", "Discipline or project type. Roadway is the first scope because the initial design brief identified roadway items as the best place to validate the comparable engine.")}
          </span>
          <select name="workType">
            <option value="Roadway" ${query.workType === "Roadway" ? "selected" : ""}>Roadway</option>
          </select>
        </label>
      </div>

      <label>
        <span class="label-row">
          Source scope
          ${helpTip("About source scope", "Controls whether results come from public-style demo records, internal-style demo records, or both. Real FHU internal data should not be committed to a public GitHub Pages repository.")}
        </span>
        <select name="sourceScope">
          <option value="both" ${query.sourceScope === "both" ? "selected" : ""}>Public + internal demo data</option>
          <option value="public" ${query.sourceScope === "public" ? "selected" : ""}>Public demo data only</option>
          <option value="internal" ${query.sourceScope === "internal" ? "selected" : ""}>Internal demo data only</option>
        </select>
      </label>

      <button type="submit" class="primary-button">Search comparables</button>
      <div class="form-action-grid">
        <button type="button" id="clear-query" class="secondary-button">Clear</button>
        <button type="button" id="reset-example" class="secondary-button">Reset example</button>
      </div>
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
