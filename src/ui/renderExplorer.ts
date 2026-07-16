import type { AgencyItemRecord, SearchQuery, SpecSectionRecord, StateConfig } from "../data/schema";
import { normalizeDescription } from "../matching/normalizeDescription";

const DEFAULT_STATE = "CO";
const DEFAULT_WORK_TYPE = "Roadway";

export function renderExplorer(
  query: SearchQuery,
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[],
  stateConfig: StateConfig
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
        <h2>${escapeHtml(stateConfig.name)} Item Search</h2>
      </div>

      <input type="hidden" name="itemCode" value="${escapeHtml(query.itemCode)}" />
      <input type="hidden" name="agencyItemId" value="${escapeHtml(query.agencyItemId)}" />
      <input type="hidden" name="unit" value="${escapeHtml(selectedUnit)}" />

      <section class="workflow-step">
        ${renderStepHeading("1", "Locate Item")}
        <div class="item-picker" data-item-picker>
          <label>
            <span class="label-row">
              ${escapeHtml(stateConfig.divisionLabel)}
            </span>
            <select name="divisionPrefix" data-division-select>
              <option value="" ${selectedDivisionPrefix ? "" : "selected"}>Select division</option>
              ${renderDivisionOptions(specSections, selectedDivisionPrefix)}
            </select>
          </label>

          <label>
            <span class="label-row">
              ${escapeHtml(stateConfig.sectionLabel)}
            </span>
            <select name="sectionPrefix" data-section-select ${selectedDivisionPrefix ? "" : "disabled"}>
              <option value="" ${selectedSectionPrefix ? "" : "selected"}>Select section</option>
              ${renderSectionOptions(specSections, selectedDivisionPrefix, selectedSectionPrefix)}
            </select>
          </label>

          <label>
            <span class="label-row">
              Item code or description
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

      <div class="form-action-grid">
        <button type="button" id="clear-query" class="secondary-button">Clear</button>
        <button type="submit" class="primary-button">Search</button>
      </div>
    </form>
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
  const agencyItemIdInput = form.elements.namedItem("agencyItemId") as HTMLInputElement | null;
  const descriptionInput = form.elements.namedItem("description") as HTMLInputElement | null;
  const unitInput = form.elements.namedItem("unit") as HTMLInputElement | null;
  const divisionSelect = form.querySelector<HTMLSelectElement>("[data-division-select]");
  const sectionSelect = form.querySelector<HTMLSelectElement>("[data-section-select]");
  const itemSearchInput = form.querySelector<HTMLInputElement>("[data-item-search]");
  const itemResults = form.querySelector<HTMLElement>("[data-item-results]");

  function clearSelectedItem(options: { clearSearch: boolean } = { clearSearch: false }): void {
    if (itemCodeInput) {
      itemCodeInput.value = "";
    }
    if (agencyItemIdInput) {
      agencyItemIdInput.value = "";
    }
    if (descriptionInput && options.clearSearch) {
      descriptionInput.value = "";
    }
    if (unitInput) {
      unitInput.value = "";
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
    const agencyItemId = button.dataset.agencyItemId ?? "";
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
    if (agencyItemIdInput) {
      agencyItemIdInput.value = agencyItemId;
    }
    if (unitInput) {
      unitInput.value = unit;
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
    <div class="item-result-buttons" data-item-result-scroll>
      ${displayedItems
        .map((agencyItem) => renderItemResultButton(agencyItem, agencyItem.itemCode === selectedItemCode))
        .join("")}
    </div>
  `;
}

function updateItemResultScrollCue(root: HTMLElement): void {
  const scrollContainer = root.querySelector<HTMLElement>("[data-item-result-scroll]");

  if (!scrollContainer) {
    return;
  }

  scrollContainer.setAttribute(
    "aria-label",
    scrollContainer.scrollHeight > scrollContainer.clientHeight + 1
      ? "Scrollable item results"
      : "Item results"
  );
}

function renderItemResultButton(agencyItem: AgencyItemRecord, selected: boolean): string {
  return `
    <button
      type="button"
      class="item-result-button ${selected ? "item-result-button--selected" : ""}"
      data-item-result
      data-item-code="${escapeHtml(agencyItem.itemCode)}"
      data-agency-item-id="${escapeHtml(agencyItem.agencyItemId)}"
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
  const estimateYear = currentQuery?.estimateYear ?? new Date().getFullYear();

  return {
    state: currentQuery?.state ?? DEFAULT_STATE,
    agencyId: currentQuery?.agencyId ?? "",
    agencyItemId: String(formData.get("agencyItemId") || ""),
    countyRegion: currentQuery?.countyRegion ?? "",
    workType: currentQuery?.workType ?? DEFAULT_WORK_TYPE,
    estimateYear,
    sourceScope: currentQuery?.sourceScope ?? "both",
    priceTypeScope: currentQuery?.priceTypeScope ?? "awarded",
    itemCode: String(formData.get("itemCode") || ""),
    description: String(formData.get("description") || ""),
    unit: String(formData.get("unit") || ""),
    quantity: null
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
  const match = itemCode.match(/^(\d{3,4})-/);
  return match?.[1] ?? "";
}
