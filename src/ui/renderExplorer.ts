import type { AgencyItemRecord, ItemTaxonomyMembershipRecord, SearchQuery, SpecSectionRecord, StateConfig } from "../data/schema";
import { normalizeDescription } from "../matching/normalizeDescription";

const DEFAULT_STATE = "CO";
const DEFAULT_WORK_TYPE = "Roadway";
type ItemCodeSeriesOption = NonNullable<StateConfig["itemCodeSeries"]>[number];

export function renderExplorer(
  query: SearchQuery,
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[],
  stateConfig: StateConfig,
  membershipsByAgencyItemId: ReadonlyMap<string, ItemTaxonomyMembershipRecord[]> = new Map()
): string {
  const resolvedAgencyItem = findAgencyItem(agencyItems, query.agencyItemId, query.itemCode, query.state);
  const hasResolvedItem = Boolean(resolvedAgencyItem);
  const resolvedUnit = resolvedAgencyItem?.officialUnit ?? query.unit;
  const selectedUnit = hasResolvedItem ? resolvedUnit : "";
  const itemSearchValue = hasResolvedItem ? "" : query.description;
  const explicitMemberships = Boolean(stateConfig.files.itemTaxonomyMemberships);
  const selectedSectionPrefix = explicitMemberships && resolvedAgencyItem
    ? findMembershipSectionPrefix(resolvedAgencyItem.agencyItemId, membershipsByAgencyItemId, specSections)
    : sectionPrefixFromItemCode(query.itemCode, stateConfig.sectionPrefixLength);
  const selectedSection = selectedSectionPrefix
    ? findSpecSection(specSections, selectedSectionPrefix)
    : null;
  const sectionPickerMode = stateConfig.sectionPickerMode ?? "division-dependent";
  const selectedDivisionPrefix = sectionPickerMode === "division-dependent"
    ? selectedSection?.divisionPrefix ?? ""
    : "";
  const selectedDivision = selectedDivisionPrefix
    ? uniqueSpecDivisions(specSections).find((division) => division.divisionPrefix === selectedDivisionPrefix) ?? null
    : null;
  const selectedItemCodeSeries = resolvedAgencyItem
    ? itemCodeSeriesForCode(resolvedAgencyItem.itemCode, stateConfig.itemCodeSeries ?? [])
    : "";

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
          ${sectionPickerMode === "division-dependent" ? `<label>
            <span class="label-row">
              ${escapeHtml(stateConfig.divisionLabel)}
            </span>
            <select name="divisionPrefix" data-division-select>
              <option value="" ${selectedDivisionPrefix ? "" : "selected"}>Select division</option>
              ${renderDivisionOptions(specSections, selectedDivisionPrefix)}
            </select>
          </label>` : ""}

          <label>
            <span class="label-row">
              ${escapeHtml(stateConfig.sectionLabel)}
            </span>
            <select name="sectionPrefix" data-section-select ${sectionPickerMode === "division-dependent" && !selectedDivisionPrefix ? "disabled" : ""}>
              <option value="" ${selectedSectionPrefix ? "" : "selected"}>Select ${escapeHtml(stateConfig.sectionLabel)}</option>
              ${renderSectionOptions(specSections, selectedDivisionPrefix, selectedSectionPrefix, sectionPickerMode === "independent-flat")}
            </select>
          </label>

          ${renderTaxonomyContext(selectedSection, selectedDivision)}

          ${stateConfig.itemCodeSeries?.length ? `<label>
            <span class="label-row">Item Code Series</span>
            <select name="itemCodeSeries" data-item-code-series-select>
              <option value="" ${selectedItemCodeSeries ? "" : "selected"}>All item code series</option>
              ${renderItemCodeSeriesOptions(stateConfig.itemCodeSeries, selectedItemCodeSeries)}
            </select>
          </label>` : ""}

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
          ${renderItemResults(
            agencyItems,
            specSections,
            selectedDivisionPrefix,
            selectedSectionPrefix,
            selectedItemCodeSeries,
            itemSearchValue,
            query.itemCode,
            stateConfig.sectionPrefixLength,
            membershipsByAgencyItemId,
            explicitMemberships,
            query.agencyItemId,
            stateConfig.itemCodeSeries ?? [],
            stateConfig.showHistoricalItemStatus ?? true
          )}
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
  specSections: SpecSectionRecord[],
  stateConfig: StateConfig,
  membershipsByAgencyItemId: ReadonlyMap<string, ItemTaxonomyMembershipRecord[]> = new Map()
): void {
  const itemCodeInput = form.elements.namedItem("itemCode") as HTMLInputElement | null;
  const agencyItemIdInput = form.elements.namedItem("agencyItemId") as HTMLInputElement | null;
  const descriptionInput = form.elements.namedItem("description") as HTMLInputElement | null;
  const unitInput = form.elements.namedItem("unit") as HTMLInputElement | null;
  const divisionSelect = form.querySelector<HTMLSelectElement>("[data-division-select]");
  const sectionSelect = form.querySelector<HTMLSelectElement>("[data-section-select]");
  const itemCodeSeriesSelect = form.querySelector<HTMLSelectElement>("[data-item-code-series-select]");
  const itemSearchInput = form.querySelector<HTMLInputElement>("[data-item-search]");
  const itemResults = form.querySelector<HTMLElement>("[data-item-results]");
  const taxonomyContext = form.querySelector<HTMLElement>("[data-taxonomy-context]");
  const taxonomyContextText = form.querySelector<HTMLElement>("[data-taxonomy-context-text]");
  const taxonomyContextToggle = form.querySelector<HTMLButtonElement>("[data-taxonomy-context-toggle]");

  function updateTaxonomyContext(): void {
    if (!taxonomyContext || !taxonomyContextText) {
      return;
    }

    const selectedSection = findSpecSection(specSections, sectionSelect?.value ?? "");
    const selectedDivision = uniqueSpecDivisions(specSections).find(
      (division) => division.divisionPrefix === divisionSelect?.value
    ) ?? null;
    const context = taxonomyContextFor(selectedSection, selectedDivision);
    taxonomyContext.hidden = !context;
    taxonomyContext.classList.remove("is-open");
    taxonomyContextToggle?.setAttribute("aria-expanded", "false");
    taxonomyContextText.innerHTML = context ?? "";
  }

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
    const selectedSectionPrefix = sectionSelect.value;
    const selectedSectionStillMatchesDivision = !divisionPrefix || specSections.some(
      (section) => section.sectionPrefix === selectedSectionPrefix && section.divisionPrefix === divisionPrefix
    );
    const preservedSectionPrefix = selectedSectionStillMatchesDivision ? selectedSectionPrefix : "";
    sectionSelect.innerHTML = `
      <option value="">Select ${escapeHtml(stateConfig.sectionLabel)}</option>
      ${renderSectionOptions(
        specSections,
        divisionPrefix,
        preservedSectionPrefix,
        false
      )}
    `;
    sectionSelect.disabled = !divisionPrefix;
    updateTaxonomyContext();
  }

  function renderCurrentResults(): void {
    if (!itemResults || !sectionSelect) {
      return;
    }

    const selectedSectionPrefix = sectionSelect.value;
    const selectedDivisionPrefix = divisionSelect?.value ?? "";
    const selectedItemCodeSeries = itemCodeSeriesSelect?.value ?? "";
    const searchText = itemSearchInput?.value ?? "";
    itemResults.innerHTML = renderItemResults(
      agencyItems,
      specSections,
      selectedDivisionPrefix,
      selectedSectionPrefix,
      selectedItemCodeSeries,
      searchText,
      itemCodeInput?.value ?? "",
      stateConfig.sectionPrefixLength,
      membershipsByAgencyItemId,
      Boolean(stateConfig.files.itemTaxonomyMemberships),
      agencyItemIdInput?.value ?? "",
      stateConfig.itemCodeSeries ?? [],
      stateConfig.showHistoricalItemStatus ?? true
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
    updateTaxonomyContext();
    renderCurrentResults();
  });

  taxonomyContextToggle?.addEventListener("click", () => {
    if (!taxonomyContext) return;
    const isOpen = taxonomyContext.classList.toggle("is-open");
    taxonomyContextToggle.setAttribute("aria-expanded", String(isOpen));
  });

  itemCodeSeriesSelect?.addEventListener("change", () => {
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
    const selectedAgencyItemId = agencyItemIdInput?.value ?? "";

    if (selectedAgencyItemId === agencyItemId || (!selectedAgencyItemId && selectedItemCode === itemCode)) {
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
      const label = divisionLabel(division);
      const title = taxonomyContextFor(null, division) ?? label;
      return `<option value="${escapeHtml(division.divisionPrefix)}" title="${escapeHtml(stripHtml(title))}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");
}

function renderSectionOptions(
  specSections: SpecSectionRecord[],
  selectedDivisionPrefix: string,
  selectedSectionPrefix: string,
  includeDivisionPrefix = false
): string {
  const matchingSections = specSections
    .filter((specSection) => !selectedDivisionPrefix || specSection.divisionPrefix === selectedDivisionPrefix)
    .sort((left, right) => left.sectionPrefix.localeCompare(right.sectionPrefix));

  const renderOptions = (sections: SpecSectionRecord[]): string => sections
    .map((specSection) => {
      const selected = specSection.sectionPrefix === selectedSectionPrefix ? "selected" : "";
      const label = `${includeDivisionPrefix ? `${specSection.divisionPrefix} - ` : ""}${sectionLabel(specSection)}`;
      const title = taxonomyContextFor(specSection, null) ?? label;
      return `<option value="${escapeHtml(specSection.sectionPrefix)}" title="${escapeHtml(stripHtml(title))}" ${selected}>${escapeHtml(label)}</option>`;
    })
    .join("");

  return renderOptions(matchingSections);
}

function divisionLabel(division: SpecSectionRecord): string {
  const title = division.divisionTitle.replace(/^Division\s+\d+\s*-\s*/i, "");
  return `${division.divisionTitle.match(/^Division\s+(\d+)/i)?.[1] ?? division.divisionPrefix} - ${title}`;
}

function sectionLabel(section: SpecSectionRecord): string {
  const title = section.sectionTitle.replace(/^Section\s+\d+\s*-\s*/i, "");
  return `${section.sectionPrefix} - ${title}`;
}

function renderTaxonomyContext(
  section: SpecSectionRecord | null,
  division: SpecSectionRecord | null
): string {
  const context = taxonomyContextFor(section, division);
  return `
    <div class="taxonomy-context" data-taxonomy-context ${context ? "" : "hidden"}>
      <button type="button" class="taxonomy-context__toggle" data-taxonomy-context-toggle aria-expanded="false" aria-controls="taxonomy-context-detail" aria-label="Show selected item group information">i</button>
      <span id="taxonomy-context-detail" class="taxonomy-context__detail" data-taxonomy-context-text role="tooltip">${context ?? ""}</span>
    </div>
  `;
}

function taxonomyContextFor(
  section: SpecSectionRecord | null,
  division: SpecSectionRecord | null
): string | null {
  const hasSectionContext = Boolean(section?.taxonomyDescription);
  const label = hasSectionContext
    ? section?.sectionTitle ?? ""
    : division?.divisionTitle ?? "";
  const description = hasSectionContext
    ? section?.taxonomyDescription ?? ""
    : division?.divisionDescription ?? "";
  if (!description) return null;
  return `<strong>${escapeHtml(label)}.</strong> ${escapeHtml(description)}`;
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, "");
}

function renderItemCodeSeriesOptions(series: ItemCodeSeriesOption[], selectedSeries: string): string {
  return series
    .map((option) => `<option value="${escapeHtml(option.value)}" ${option.value === selectedSeries ? "selected" : ""}>${escapeHtml(option.label)}</option>`)
    .join("");
}

function renderItemResults(
  agencyItems: AgencyItemRecord[],
  specSections: SpecSectionRecord[],
  selectedDivisionPrefix: string,
  selectedSectionPrefix: string,
  selectedItemCodeSeries: string,
  searchText: string,
  selectedItemCode: string,
  sectionPrefixLength: number,
  membershipsByAgencyItemId: ReadonlyMap<string, ItemTaxonomyMembershipRecord[]>,
  useExplicitMemberships: boolean,
  selectedAgencyItemId: string,
  itemCodeSeries: ItemCodeSeriesOption[],
  showHistoricalItemStatus: boolean
): string {
  const normalizedSearchText = searchText.trim().toUpperCase();
  const searchHasStarted = Boolean(
    selectedDivisionPrefix || selectedSectionPrefix || selectedItemCodeSeries || normalizedSearchText || selectedItemCode
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
        selectedSectionPrefix,
        sectionPrefixLength,
        membershipsByAgencyItemId,
        useExplicitMemberships
      )
    )
    .filter((agencyItem) => itemMatchesCodeSeries(agencyItem.itemCode, selectedItemCodeSeries, itemCodeSeries))
    .sort((left, right) => left.itemCode.localeCompare(right.itemCode));

  const matchingItems = filteredItems.filter((agencyItem) => itemMatchesSearch(agencyItem, normalizedSearchText));
  const selectedItem = selectedAgencyItemId || selectedItemCode
    ? agencyItems.find((agencyItem) => agencyItem.agencyItemId === selectedAgencyItemId)
      ?? agencyItems.find((agencyItem) => agencyItem.itemCode === selectedItemCode)
    : null;
  const displayedItems = selectedItem ? [selectedItem] : matchingItems;

  if (matchingItems.length === 0) {
    if (selectedDivisionPrefix || selectedSectionPrefix || selectedItemCodeSeries) {
      return `<p class="item-result-message">No loaded items match the selected filters. Clear Division, Specification Section, or Item Code Series to search all loaded items.</p>`;
    }

    return `<p class="item-result-message">No loaded items match this search. Select an official item code before reviewing project evidence.</p>`;
  }

  return `
    <div class="item-result-count">${matchingItems.length} matching item${matchingItems.length === 1 ? "" : "s"}</div>
    <div class="item-result-buttons" data-item-result-scroll>
      ${displayedItems
        .map((agencyItem) => renderItemResultButton(agencyItem, agencyItem.agencyItemId === selectedAgencyItemId || (!selectedAgencyItemId && agencyItem.itemCode === selectedItemCode), showHistoricalItemStatus))
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

function renderItemResultButton(
  agencyItem: AgencyItemRecord,
  selected: boolean,
  showHistoricalItemStatus: boolean
): string {
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
      <small>${escapeHtml(agencyItem.officialUnit)}${showHistoricalItemStatus && agencyItem.itemStatus === "historical" ? " · Historical" : ""}</small>
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
  selectedSectionPrefix: string,
  sectionPrefixLength: number,
  membershipsByAgencyItemId: ReadonlyMap<string, ItemTaxonomyMembershipRecord[]>,
  useExplicitMemberships: boolean
): boolean {
  if (useExplicitMemberships) {
    const membershipSections = (membershipsByAgencyItemId.get(agencyItem.agencyItemId) ?? [])
      .map((membership) => specSectionForMembership(sectionByPrefix, membership))
      .filter((section): section is SpecSectionRecord => Boolean(section));
    if (selectedSectionPrefix && !membershipSections.some((section) => section.sectionPrefix === selectedSectionPrefix)) return false;
    return !selectedDivisionPrefix || membershipSections.some((section) => section.divisionPrefix === selectedDivisionPrefix);
  }
  const sectionPrefix = sectionPrefixFromItemCode(agencyItem.itemCode, sectionPrefixLength);

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
  agencyItemId: string,
  itemCode: string,
  state: string
): AgencyItemRecord | null {
  const normalizedItemCode = itemCode.trim().toUpperCase();
  const normalizedState = state.trim().toUpperCase();

  return agencyItems.find((agencyItem) => agencyItem.agencyItemId === agencyItemId) ?? agencyItems.find((agencyItem) =>
    agencyItem.itemCode === normalizedItemCode && agencyItem.state === normalizedState
  ) ?? null;
}

function itemMatchesCodeSeries(itemCode: string, selectedSeries: string, series: ItemCodeSeriesOption[]): boolean {
  if (!selectedSeries) return true;
  const option = series.find((candidate) => candidate.value === selectedSeries);
  return Boolean(option?.prefixes.some((prefix) => itemCode.toUpperCase().startsWith(prefix.toUpperCase())));
}

function itemCodeSeriesForCode(itemCode: string, series: ItemCodeSeriesOption[]): string {
  return series.find((option) => option.prefixes.some((prefix) => itemCode.toUpperCase().startsWith(prefix.toUpperCase())))?.value ?? "";
}

function findMembershipSectionPrefix(
  agencyItemId: string,
  membershipsByAgencyItemId: ReadonlyMap<string, ItemTaxonomyMembershipRecord[]>,
  specSections: SpecSectionRecord[]
): string {
  const taxonomyIds = new Set((membershipsByAgencyItemId.get(agencyItemId) ?? []).map((membership) => membership.taxonomyId));
  return specSections.find((section) => taxonomyIds.has(section.taxonomyId))?.sectionPrefix ?? "";
}

function specSectionForMembership(
  sectionByPrefix: Map<string, SpecSectionRecord>,
  membership: ItemTaxonomyMembershipRecord
): SpecSectionRecord | null {
  return [...sectionByPrefix.values()].find((section) => section.taxonomyId === membership.taxonomyId) ?? null;
}

function sectionPrefixFromItemCode(itemCode: string, prefixLength: number): string {
  const match = itemCode.match(new RegExp(`^(\\d{${prefixLength}})`));
  return match?.[1] ?? "";
}
