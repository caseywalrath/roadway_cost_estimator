import type { AgencyItemRecord, SearchQuery, SpecSectionRecord } from "../data/schema";
import { normalizeDescription } from "../matching/normalizeDescription";
import { helpTip } from "./helpTip";

const DEFAULT_STATE = "CO";
const DEFAULT_WORK_TYPE = "Roadway";

export function renderExplorer(
  query: SearchQuery,
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[]
): string {
  const resolvedAgencyItem = findAgencyItem(agencyItems, query.itemCode, query.state);
  const hasResolvedItem = Boolean(resolvedAgencyItem);
  const resolvedUnit = resolvedAgencyItem?.officialUnit ?? query.unit;
  const selectedUnit = hasResolvedItem ? resolvedUnit : "";
  const itemSearchValue = hasResolvedItem ? "" : query.description;
  const selectedSectionPrefix = sectionPrefixFromItemCode(query.itemCode);
  const selectedSection = selectedSectionPrefix
    ? findSpecSection(specSections, selectedSectionPrefix)
    : null;
  const selectedDivisionPrefix = selectedSection?.divisionPrefix ?? "";

  return `
    <form id="explorer-form" class="search-panel">
      <div class="panel-heading">
        <h2>
          Item Book Search
          ${helpTip("About the item search", "This panel identifies the official bid item and quantity. The evidence table uses exact item-code matches after an item is selected.")}
        </h2>
      </div>

      <input type="hidden" name="itemCode" value="${escapeHtml(query.itemCode)}" />
      <input type="hidden" name="unit" value="${escapeHtml(selectedUnit)}" />

      <section class="workflow-step">
        ${renderStepHeading("1", "Locate Item")}
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
              Item code or description
              ${helpTip("About item code or description", "Searches loaded agency items by full item code, partial code, suffix after the hyphen, official description, or abbreviated description. Select an official item before reviewing project evidence.")}
            </span>
            <input name="description" data-item-search value="${escapeHtml(itemSearchValue)}" />
          </label>
        </div>
      </section>

      <section class="workflow-step workflow-step--selected">
        ${renderStepHeading("2", "Select Item")}
        <div class="item-result-list" data-item-results aria-live="polite">
          ${renderItemResults(agencyItems, specSections, selectedDivisionPrefix, selectedSectionPrefix, itemSearchValue, query.itemCode)}
        </div>
      </section>

      <section class="workflow-step">
        ${renderStepHeading("3", "Enter quantity")}
        <label>
          <span class="label-row">
            Quantity
            ${helpTip("About quantity", "Planned amount of work for this line item. It is used to rank projects with a similar scale of work higher than very small or very large examples. Source: current estimate line item.")}
          </span>
          <div class="quantity-input-wrap">
            <input name="quantity" type="number" min="0" step="0.01" value="${query.quantity ?? ""}" />
            <span class="quantity-unit" data-quantity-unit aria-hidden="true">${escapeHtml(selectedUnit)}</span>
          </div>
        </label>
      </section>

      <div class="form-action-grid">
        <button type="button" id="clear-query" class="secondary-button">Clear</button>
        <button type="submit" class="primary-button">Search</button>
      </div>
    </form>
  `;
}

export function renderItemSearchSummary(
  query: SearchQuery,
  agencyItems: AgencyItemRecord[]
): string {
  const selectedAgencyItem = findAgencyItem(agencyItems, query.itemCode, query.state);
  const itemCode = selectedAgencyItem?.itemCode ?? query.itemCode;
  const description = selectedAgencyItem?.officialDescription ?? query.description;
  const unit = selectedAgencyItem?.officialUnit ?? query.unit;

  return `
    <section class="item-search-summary panel-block" aria-label="Selected item search">
      <div class="item-search-summary__text">
        <p class="eyebrow">Selected Item</p>
        <h2>${escapeHtml(description || "No item selected")}</h2>
        <p class="query-line">
          Item code: ${escapeHtml(itemCode || "Not selected")} |
          Unit: ${escapeHtml(unit || "Not selected")} |
          Quantity: ${query.quantity ? formatNumber(query.quantity) : "Not entered"}
        </p>
      </div>
      <button type="button" id="edit-item-search" class="secondary-button">Edit Item Search</button>
    </section>
  `;
}

function renderStepHeading(stepNumber: string, label: string): string {
  return `
    <div class="step-heading">
      <span class="step-number">${stepNumber}</span>
      <h3>${escapeHtml(label)}</h3>
    </div>
  `;
}

export function bindItemPicker(
  form: HTMLFormElement,
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[]
): void {
  const itemCodeInput = form.elements.namedItem("itemCode") as HTMLInputElement | null;
  const descriptionInput = form.elements.namedItem("description") as HTMLInputElement | null;
  const unitInput = form.elements.namedItem("unit") as HTMLInputElement | null;
  const divisionSelect = form.querySelector<HTMLSelectElement>("[data-division-select]");
  const sectionSelect = form.querySelector<HTMLSelectElement>("[data-section-select]");
  const itemSearchInput = form.querySelector<HTMLInputElement>("[data-item-search]");
  const itemResults = form.querySelector<HTMLElement>("[data-item-results]");
  const quantityUnit = form.querySelector<HTMLElement>("[data-quantity-unit]");

  function clearSelectedItem(options: { clearSearch: boolean } = { clearSearch: false }): void {
    if (itemCodeInput) {
      itemCodeInput.value = "";
    }
    if (descriptionInput && options.clearSearch) {
      descriptionInput.value = "";
    }
    if (unitInput) {
      unitInput.value = "";
    }
    if (quantityUnit) {
      quantityUnit.textContent = "";
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
    updateItemResultScrollCue(itemResults);
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
    clearSelectedItem();
    renderCurrentResults();
  });

  itemResults?.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-item-result]");

    if (!button) {
      return;
    }

    const itemCode = button.dataset.itemCode ?? "";
    const unit = button.dataset.unit ?? "";
    const selectedItemCode = itemCodeInput?.value ?? "";

    if (selectedItemCode === itemCode) {
      clearSelectedItem();
      renderCurrentResults();
      return;
    }

    if (itemCodeInput) {
      itemCodeInput.value = itemCode;
    }
    if (unitInput) {
      unitInput.value = unit;
    }
    if (quantityUnit) {
      quantityUnit.textContent = unit;
    }
    renderCurrentResults();
  });

  if (itemResults) {
    updateItemResultScrollCue(itemResults);
  }
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
  const normalizedSearchText = searchText.trim().toUpperCase();
  const searchHasStarted = Boolean(
    selectedDivisionPrefix || selectedSectionPrefix || normalizedSearchText || selectedItemCode
  );

  if (!searchHasStarted) {
    return `<p class="item-result-message">Use Locate Item to search by division, section, item code, or description. Matching items will appear here.</p>`;
  }

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

  const matchingItems = filteredItems.filter((agencyItem) => itemMatchesSearch(agencyItem, normalizedSearchText));
  const selectedItem = selectedItemCode
    ? agencyItems.find((agencyItem) => agencyItem.itemCode === selectedItemCode)
    : null;
  const displayedItems = selectedItem ? [selectedItem] : matchingItems;

  if (matchingItems.length === 0) {
    if (selectedDivisionPrefix || selectedSectionPrefix) {
      return `<p class="item-result-message">No loaded items match this search in the selected division or section. Clear Division or Section / prefix to search all loaded items.</p>`;
    }

    return `<p class="item-result-message">No loaded items match this search. Select an official item code before reviewing project evidence.</p>`;
  }

  return `
    <div class="item-result-count">${matchingItems.length} matching item${matchingItems.length === 1 ? "" : "s"}</div>
    <div class="item-result-scroll-wrap" data-item-result-scroll-wrap>
      <div class="item-result-buttons" data-item-result-scroll>
        ${displayedItems
          .map((agencyItem) => renderItemResultButton(agencyItem, agencyItem.itemCode === selectedItemCode))
          .join("")}
      </div>
      <div class="item-result-fade" data-item-result-fade hidden></div>
    </div>
    <p class="item-result-scroll-hint" data-item-result-scroll-hint hidden>Scroll for more matches</p>
  `;
}

function updateItemResultScrollCue(root: HTMLElement): void {
  const scrollContainer = root.querySelector<HTMLElement>("[data-item-result-scroll]");
  const fade = root.querySelector<HTMLElement>("[data-item-result-fade]");
  const hint = root.querySelector<HTMLElement>("[data-item-result-scroll-hint]");

  if (!scrollContainer || !fade || !hint) {
    return;
  }

  const hasOverflow = scrollContainer.scrollHeight > scrollContainer.clientHeight + 1;
  fade.hidden = !hasOverflow;
  hint.hidden = !hasOverflow;
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
      title="${escapeHtml(agencyItem.officialDescription)}"
    >
      <strong>${escapeHtml(agencyItem.itemCode)}</strong>
      <span>${escapeHtml(agencyItem.officialDescription)}</span>
      <small>${escapeHtml(agencyItem.officialUnit)}</small>
    </button>
  `;
}

export function readQueryFromForm(form: HTMLFormElement, currentQuery?: SearchQuery): SearchQuery {
  const formData = new FormData(form);
  const quantity = Number(formData.get("quantity") || 0);
  const estimateYear = currentQuery?.estimateYear ?? new Date().getFullYear();

  return {
    state: currentQuery?.state ?? DEFAULT_STATE,
    countyRegion: currentQuery?.countyRegion ?? "",
    workType: currentQuery?.workType ?? DEFAULT_WORK_TYPE,
    estimateYear,
    sourceScope: currentQuery?.sourceScope ?? "both",
    priceTypeScope: currentQuery?.priceTypeScope ?? "awarded",
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

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
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
  const description = normalizeDescription(agencyItem.officialDescription);
  const abbreviatedDescription = normalizeDescription(agencyItem.officialAbbreviatedDescription);
  const normalizedDescriptionSearch = normalizeDescription(normalizedSearchText);

  return (
    itemCode.includes(normalizedSearchText) ||
    suffix.includes(normalizedSearchText) ||
    description.includes(normalizedDescriptionSearch) ||
    abbreviatedDescription.includes(normalizedDescriptionSearch)
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

function findAgencyItem(
  agencyItems: AgencyItemRecord[],
  itemCode: string,
  state: string
): AgencyItemRecord | null {
  const normalizedItemCode = itemCode.trim().toUpperCase();
  const normalizedState = state.trim().toUpperCase();

  return agencyItems.find((agencyItem) =>
    agencyItem.itemCode === normalizedItemCode && agencyItem.state === normalizedState
  ) ?? null;
}

function sectionPrefixFromItemCode(itemCode: string): string {
  const match = itemCode.match(/^(\d{3})-/);
  return match?.[1] ?? "";
}
