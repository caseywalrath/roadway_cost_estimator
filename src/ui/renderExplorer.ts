import type { AgencyItemRecord, SearchQuery, SourceScope, SpecSectionRecord } from "../data/schema";
import { helpTip } from "./helpTip";

const MAX_VISIBLE_ITEM_RESULTS = 25;

export function renderExplorer(
  query: SearchQuery,
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[]
): string {
  const selectedSectionPrefix = sectionPrefixFromItemCode(query.itemCode);
  const selectedSection = selectedSectionPrefix
    ? findSpecSection(specSections, selectedSectionPrefix)
    : null;
  const selectedDivisionPrefix = selectedSection?.divisionPrefix ?? "";

  return `
    <form id="explorer-form" class="search-panel">
      <div class="panel-heading">
        <p class="eyebrow">Item Explorer</p>
        <h2>
          Search one roadway bid item
          ${helpTip("About the item explorer", "This is a one-item lookup. It is meant to test whether the app can find comparable historical records before building a full estimate worksheet.")}
        </h2>
      </div>

      <input type="hidden" name="itemCode" value="${escapeHtml(query.itemCode)}" />

      <div class="item-picker" data-item-picker>
        <label>
          <span class="label-row">
            Division
            ${helpTip("About division", "CDOT Standard Specifications organize bid items into specification divisions. Division selection narrows the item-code search before choosing a section and item.")}
          </span>
          <select name="divisionPrefix" data-division-select>
            <option value="" ${selectedDivisionPrefix ? "" : "selected"}>Select division</option>
            ${renderDivisionOptions(specSections, selectedDivisionPrefix)}
          </select>
        </label>

        <label>
          <span class="label-row">
            Section / prefix
            ${helpTip("About section prefix", "The first three digits of a CDOT item code correspond to a specification section. Section labels are loaded from the spec section reference table, not inferred from item descriptions.")}
          </span>
          <select name="sectionPrefix" data-section-select ${selectedDivisionPrefix ? "" : "disabled"}>
            <option value="" ${selectedSectionPrefix ? "" : "selected"}>Select section</option>
            ${renderSectionOptions(specSections, selectedDivisionPrefix, selectedSectionPrefix)}
          </select>
        </label>

        <label>
          <span class="label-row">
            Search
            ${helpTip("About search", "Searches loaded agency items by item code, suffix after the hyphen, or official description. Division and section selections narrow the visible results when selected.")}
          </span>
          <input name="itemSearch" data-item-search value="" placeholder="Search code, suffix, or description" />
        </label>

        <div class="selected-item-summary" data-selected-item-summary>
          ${renderSelectedItemSummary(query)}
        </div>

        <div class="item-result-list" data-item-results aria-live="polite">
          ${renderItemResults(agencyItems, specSections, selectedDivisionPrefix, selectedSectionPrefix, "", query.itemCode)}
        </div>
      </div>

      <label>
        <span class="label-row">
          Selected item code
          ${helpTip("About item code", "Agency bid item number. For Colorado roadway work this may be a CDOT item code. It is chosen as the strongest match key because it is more reliable than description text alone. Source: agency item code books or historical estimate line items.")}
        </span>
        <input name="selectedItemCodeDisplay" value="${escapeHtml(query.itemCode)}" placeholder="Select from item search" readonly />
      </label>

      <label>
        <span class="label-row">
          Description
          ${helpTip("About item description", "Official item description filled from the selected agency item code. Description search suggestions are planned for a later increment; this increment keeps pricing centered on item code.")}
        </span>
        <input name="description" value="${escapeHtml(query.description)}" placeholder="Auto-filled from item code" readonly />
      </label>

      <div class="field-grid">
        <label>
          <span class="label-row">
            Unit
            ${helpTip("About unit", "Official measurement basis filled from the selected agency item code. The prototype requires same-unit records for price recommendations because unit conversions can change the meaning of a cost comparison.")}
          </span>
          <input name="unit" value="${escapeHtml(query.unit)}" placeholder="Auto-filled" readonly />
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

export function bindItemPicker(
  form: HTMLFormElement,
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[]
): void {
  const itemCodeInput = form.elements.namedItem("itemCode") as HTMLInputElement | null;
  const itemCodeDisplay = form.elements.namedItem("selectedItemCodeDisplay") as HTMLInputElement | null;
  const descriptionInput = form.elements.namedItem("description") as HTMLInputElement | null;
  const unitInput = form.elements.namedItem("unit") as HTMLInputElement | null;
  const divisionSelect = form.querySelector<HTMLSelectElement>("[data-division-select]");
  const sectionSelect = form.querySelector<HTMLSelectElement>("[data-section-select]");
  const itemSearchInput = form.querySelector<HTMLInputElement>("[data-item-search]");
  const selectedItemSummary = form.querySelector<HTMLElement>("[data-selected-item-summary]");
  const itemResults = form.querySelector<HTMLElement>("[data-item-results]");

  function clearSelectedItem(): void {
    if (itemCodeInput) {
      itemCodeInput.value = "";
    }
    if (itemCodeDisplay) {
      itemCodeDisplay.value = "";
    }
    if (descriptionInput) {
      descriptionInput.value = "";
    }
    if (unitInput) {
      unitInput.value = "";
    }
    if (selectedItemSummary) {
      selectedItemSummary.innerHTML = renderSelectedItemSummary({
        itemCode: "",
        description: "",
        unit: ""
      });
    }
  }

  function renderSectionSelectOptions(): void {
    if (!sectionSelect || !divisionSelect) {
      return;
    }

    const divisionPrefix = divisionSelect.value;
    sectionSelect.innerHTML = `
      <option value="">Select section</option>
      ${renderSectionOptions(specSections, divisionPrefix, "")}
    `;
    sectionSelect.disabled = !divisionPrefix;
  }

  function renderCurrentResults(): void {
    if (!itemResults || !sectionSelect) {
      return;
    }

    const selectedSectionPrefix = sectionSelect.value;
    const selectedDivisionPrefix = divisionSelect?.value ?? "";
    const searchText = itemSearchInput?.value ?? "";
    itemResults.innerHTML = renderItemResults(
      agencyItems,
      specSections,
      selectedDivisionPrefix,
      selectedSectionPrefix,
      searchText,
      itemCodeInput?.value ?? ""
    );
  }

  divisionSelect?.addEventListener("change", () => {
    clearSelectedItem();
    renderSectionSelectOptions();
    renderCurrentResults();
  });

  sectionSelect?.addEventListener("change", () => {
    clearSelectedItem();
    renderCurrentResults();
  });

  itemSearchInput?.addEventListener("input", () => {
    renderCurrentResults();
  });

  itemResults?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-item-result]");

    if (!button) {
      return;
    }

    const itemCode = button.dataset.itemCode ?? "";
    const description = button.dataset.description ?? "";
    const unit = button.dataset.unit ?? "";

    if (itemCodeInput) {
      itemCodeInput.value = itemCode;
    }
    if (itemCodeDisplay) {
      itemCodeDisplay.value = itemCode;
    }
    if (descriptionInput) {
      descriptionInput.value = description;
    }
    if (unitInput) {
      unitInput.value = unit;
    }
    if (selectedItemSummary) {
      selectedItemSummary.innerHTML = renderSelectedItemSummary({
        itemCode,
        description,
        unit
      });
    }

    renderCurrentResults();
  });
}

function renderDivisionOptions(
  specSections: SpecSectionRecord[],
  selectedDivisionPrefix: string
): string {
  const divisions = uniqueSpecDivisions(specSections);

  return divisions
    .map((division) => {
      const selected = division.divisionPrefix === selectedDivisionPrefix ? "selected" : "";
      const label = `${division.divisionPrefix} - ${division.divisionTitle}`;
      return `<option value="${escapeHtml(division.divisionPrefix)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderSectionOptions(
  specSections: SpecSectionRecord[],
  selectedDivisionPrefix: string,
  selectedSectionPrefix: string
): string {
  return specSections
    .filter((specSection) => specSection.divisionPrefix === selectedDivisionPrefix)
    .sort((left, right) => left.sectionPrefix.localeCompare(right.sectionPrefix))
    .map((specSection) => {
      const selected = specSection.sectionPrefix === selectedSectionPrefix ? "selected" : "";
      const label = `${specSection.sectionPrefix} - ${specSection.sectionTitle}`;
      return `<option value="${escapeHtml(specSection.sectionPrefix)}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderItemResults(
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[],
  selectedDivisionPrefix: string,
  selectedSectionPrefix: string,
  searchText: string,
  selectedItemCode: string
): string {
  const sectionByPrefix = new Map(
    specSections.map((specSection) => [specSection.sectionPrefix, specSection])
  );
  const filteredItems = agencyItems
    .filter((agencyItem) =>
      itemMatchesSelectedFilters(
        agencyItem,
        sectionByPrefix,
        selectedDivisionPrefix,
        selectedSectionPrefix
      )
    )
    .sort((left, right) => left.itemCode.localeCompare(right.itemCode));

  const normalizedSearchText = searchText.trim().toUpperCase();
  const matchingItems = filteredItems.filter((agencyItem) => itemMatchesSearch(agencyItem, normalizedSearchText));

  if (matchingItems.length === 0) {
    return `<p class="item-result-message">No loaded items match this search.</p>`;
  }

  const visibleItems = matchingItems.slice(0, MAX_VISIBLE_ITEM_RESULTS);
  const overflowMessage =
    matchingItems.length > MAX_VISIBLE_ITEM_RESULTS
      ? `<p class="item-result-message">Showing first ${MAX_VISIBLE_ITEM_RESULTS} of ${matchingItems.length} matching items.</p>`
      : "";

  return `
    <div class="item-result-count">${matchingItems.length} matching item${matchingItems.length === 1 ? "" : "s"}</div>
    <div class="item-result-buttons">
      ${visibleItems
        .map((agencyItem) => renderItemResultButton(agencyItem, agencyItem.itemCode === selectedItemCode))
        .join("")}
    </div>
    ${overflowMessage}
  `;
}

function renderItemResultButton(agencyItem: AgencyItemRecord, selected: boolean): string {
  return `
    <button
      type="button"
      class="item-result-button ${selected ? "item-result-button--selected" : ""}"
      data-item-result
      data-item-code="${escapeHtml(agencyItem.itemCode)}"
      data-description="${escapeHtml(agencyItem.officialDescription)}"
      data-unit="${escapeHtml(agencyItem.officialUnit)}"
    >
      <strong>${escapeHtml(agencyItem.itemCode)}</strong>
      <span>${escapeHtml(agencyItem.officialDescription)}</span>
      <small>${escapeHtml(agencyItem.officialUnit)}</small>
    </button>
  `;
}

function renderSelectedItemSummary(query: Pick<SearchQuery, "itemCode" | "description" | "unit">): string {
  if (!query.itemCode) {
    return `<p>No item selected.</p>`;
  }

  return `<p><strong>${escapeHtml(query.itemCode)}</strong> | ${escapeHtml(query.description)} | ${escapeHtml(query.unit)}</p>`;
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

function uniqueSpecDivisions(specSections: SpecSectionRecord[]): SpecSectionRecord[] {
  const divisionByPrefix = new Map<string, SpecSectionRecord>();

  for (const specSection of specSections) {
    if (!divisionByPrefix.has(specSection.divisionPrefix)) {
      divisionByPrefix.set(specSection.divisionPrefix, specSection);
    }
  }

  return [...divisionByPrefix.values()].sort((left, right) =>
    left.divisionPrefix.localeCompare(right.divisionPrefix)
  );
}

function itemMatchesSearch(agencyItem: AgencyItemRecord, normalizedSearchText: string): boolean {
  if (!normalizedSearchText) {
    return true;
  }

  const itemCode = agencyItem.itemCode.toUpperCase();
  const suffix = itemCode.split("-")[1] ?? "";
  const description = agencyItem.officialDescription.toUpperCase();

  return (
    itemCode.includes(normalizedSearchText) ||
    suffix.includes(normalizedSearchText) ||
    description.includes(normalizedSearchText)
  );
}

function itemMatchesSelectedFilters(
  agencyItem: AgencyItemRecord,
  sectionByPrefix: Map<string, SpecSectionRecord>,
  selectedDivisionPrefix: string,
  selectedSectionPrefix: string
): boolean {
  const sectionPrefix = sectionPrefixFromItemCode(agencyItem.itemCode);

  if (selectedSectionPrefix && sectionPrefix !== selectedSectionPrefix) {
    return false;
  }

  if (!selectedDivisionPrefix) {
    return true;
  }

  return sectionByPrefix.get(sectionPrefix)?.divisionPrefix === selectedDivisionPrefix;
}

function findSpecSection(
  specSections: SpecSectionRecord[],
  sectionPrefix: string
): SpecSectionRecord | null {
  return specSections.find((specSection) => specSection.sectionPrefix === sectionPrefix) ?? null;
}

function sectionPrefixFromItemCode(itemCode: string): string {
  const match = itemCode.match(/^(\d{3})-/);
  return match?.[1] ?? "";
}
