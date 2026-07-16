import type { AppData, EvidenceRow, EvidenceStats, EvidenceSummaryStats, SearchQuery } from "../data/schema";
import type { EvidenceSortKey } from "../data/schema";
import {
  buildEvidenceResult,
  buildEvidenceSummaryStats,
  buildEvidenceStats,
  createDefaultEvidenceFilters,
  createDefaultEvidenceSort
} from "../matching/buildEvidenceResult";
import { buildInflationAdjustedPriceSet, buildInflationAdjustedSummary } from "../matching/inflationAdjustment";
import type { InflationAdjustedSummary } from "../matching/inflationAdjustment";
import type {
  ProjectEvidenceContext,
  ProjectLineItem,
  ProjectWorkspaceState,
  UserProject
} from "../projects/projectWorkspace";
import {
  addProjectLineItem,
  createProjectLineItem,
  ensureActiveProject,
  getActiveProject,
  hasRequiredProjectMetadata,
  loadProjectWorkspaceState,
  removeProjectLineItem,
  replaceProjectLineItem,
  saveProjectWorkspaceState,
  updateActiveProjectMetadata,
  updateProjectLineItem
} from "../projects/projectWorkspace";
import { downloadEvidenceCsv } from "./exportEvidenceCsv";
import { downloadProjectCsv } from "./exportProjectCsv";
import {
  bindItemPicker,
  readQueryFromForm,
  renderExplorer
} from "./renderExplorer";
import {
  renderAddToProjectPanel,
  renderProjectWorkspace
} from "./renderProjectWorkspace";
import type { PendingDuplicateProjectLine } from "./renderProjectWorkspace";
import { readEvidenceFiltersFromForm, renderResults } from "./renderResults";
import { renderSourceReview } from "./renderSourceReview";

type AppView = "explorer" | "project" | "sourceReview";
type PendingFocus = "sourceLauncher" | "sourceList" | "sourceDetail" | { sourceProjectId: string };

export function renderApp(
  root: HTMLElement,
  data: AppData,
  onStateChange: (stateCode: string) => void
): void {
  const emptyQuery: SearchQuery = {
    state: data.stateConfig.code,
    agencyId: data.stateConfig.defaultAgencyId,
    agencyItemId: "",
    countyRegion: "",
    workType: "Roadway",
    estimateYear: new Date().getFullYear(),
    sourceScope: "both",
    priceTypeScope: "awarded",
    itemCode: "",
    description: "",
    unit: "",
    quantity: null
  };
  const loadedProjectState = loadProjectWorkspaceState();
  let projectState: ProjectWorkspaceState = ensureActiveProject(
    loadedProjectState.state,
    data.stateConfig.code
  );
  let projectStorageWarning = loadedProjectState.warning;
  let query = { ...emptyQuery };
  let evidenceFilters = createDefaultEvidenceFilters(query);
  let evidenceSort = createDefaultEvidenceSort();
  let evidenceFiltersExpanded = true;
  let itemSearchCollapsed = false;
  let excludedSummaryRowIds = new Set<string>();
  let inflationAdjustmentEnabled = false;
  let selectedBidderDetailKey: string | null = null;
  let selectedSourceProjectId: string | null = null;
  let activeView: AppView = "explorer";
  let pendingFocus: PendingFocus | null = null;
  let pendingDuplicateLine: PendingDuplicateProjectLine | null = null;

  if (projectState !== loadedProjectState.state) {
    projectStorageWarning = saveProjectWorkspaceState(projectState) ?? projectStorageWarning;
  }

  function render(): void {
    const result = buildEvidenceResult(data, query, evidenceFilters, evidenceSort);
    const includedRows = includedEvidenceRows(result.filteredRows, excludedSummaryRowIds);
    const includedStats = buildEvidenceStats(includedRows);
    const includedSummaryStats = buildEvidenceSummaryStats(includedRows);
    const inflationAdjustedSummary = inflationAdjustmentEnabled
      ? buildInflationAdjustedSummary(includedRows, data.inflationIndexByPeriod)
      : null;
    const inflationAdjustedPriceSet = inflationAdjustmentEnabled
      ? buildInflationAdjustedPriceSet(result.filteredRows, data.inflationIndexByPeriod)
      : null;
    const visibleExcludedCount = result.filteredRows.length - includedRows.length;
    const activeProject = getActiveProject(projectState);
    const addToProjectPanelHtml = renderAddToProjectPanel(
      result,
      activeProject,
      pendingDuplicateLine
    );

    root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <div>
            <h1>${escapeHtml(data.manifest.productTitle)}</h1>
            <label class="state-switcher">
              <span>State</span>
              <select id="state-selector">
                ${data.manifest.states.map((state) => `
                  <option value="${state.code}" ${state.code === data.stateConfig.code ? "selected" : ""}>${escapeHtml(state.name)}</option>
                `).join("")}
              </select>
            </label>
          </div>
          <nav class="app-view-tabs" aria-label="Primary views">
            ${renderViewTab("explorer", "Explorer", activeView)}
            ${renderViewTab("project", `Project (${activeProject?.lineItems.length ?? 0})`, activeView)}
          </nav>
        </header>

        ${projectStorageWarning ? `<p class="storage-warning">${escapeHtml(projectStorageWarning)}</p>` : ""}

        ${activeView === "explorer" ? `
            <section class="workspace-grid ${itemSearchCollapsed ? "workspace-grid--item-search-collapsed" : ""}">
              ${itemSearchCollapsed ? "" : renderExplorer(query, data.agencyItems, data.specSections, data.stateConfig)}
              ${renderResults(
                result,
                evidenceFiltersExpanded,
                itemSearchCollapsed,
                data,
                selectedBidderDetailKey,
                excludedSummaryRowIds,
                includedRows.length,
                visibleExcludedCount,
                includedStats,
                includedSummaryStats,
                inflationAdjustmentEnabled,
                inflationAdjustedSummary,
                inflationAdjustedPriceSet,
                addToProjectPanelHtml
              )}
            </section>
          ` : activeView === "project"
            ? renderProjectWorkspace(activeProject)
            : renderSourceReview(data, selectedSourceProjectId)}
      </main>
    `;

    applyPendingFocus(root, pendingFocus);
    pendingFocus = null;

    root.querySelectorAll<HTMLButtonElement>("[data-app-view]").forEach((button) => {
      button.addEventListener("click", () => {
        const nextView = button.dataset.appView;

        if (nextView !== "explorer" && nextView !== "project") {
          return;
        }

        activeView = nextView;
        selectedBidderDetailKey = null;
        selectedSourceProjectId = null;
        render();
      });
    });

    root.querySelector<HTMLSelectElement>("#state-selector")?.addEventListener("change", (event) => {
      onStateChange((event.currentTarget as HTMLSelectElement).value);
    });

    const form = root.querySelector<HTMLFormElement>("#explorer-form");
    if (form) {
      bindItemPicker(form, data.agencyItems, data.specSections);
    }

    form?.addEventListener("submit", (event) => {
      event.preventDefault();
      query = readQueryFromForm(form, query);
      evidenceFilters = createDefaultEvidenceFilters(query);
      evidenceSort = createDefaultEvidenceSort();
      excludedSummaryRowIds = new Set<string>();
      selectedBidderDetailKey = null;
      selectedSourceProjectId = null;
      evidenceFiltersExpanded = true;
      itemSearchCollapsed = Boolean(query.itemCode);
      render();
    });

    root.querySelector<HTMLButtonElement>("#toggle-evidence-filters")?.addEventListener("click", () => {
      evidenceFiltersExpanded = !evidenceFiltersExpanded;
      render();
    });

    const evidenceFiltersForm = root.querySelector<HTMLFormElement>("#evidence-filters-form");
    evidenceFiltersForm?.querySelectorAll<HTMLInputElement>('input[name="quantityMin"], input[name="quantityMax"]').forEach((input) => {
      input.addEventListener("input", () => {
        input.setCustomValidity("");
      });
    });

    evidenceFiltersForm?.addEventListener("submit", (event) => {
      event.preventDefault();

      if (!validateQuantityRange(evidenceFiltersForm)) {
        return;
      }

      evidenceFilters = readEvidenceFiltersFromForm(evidenceFiltersForm, evidenceFilters);
      selectedBidderDetailKey = null;
      selectedSourceProjectId = null;
      evidenceFiltersExpanded = true;
      render();
    });

    root.querySelector<HTMLButtonElement>("#clear-evidence-filters")?.addEventListener("click", () => {
      evidenceFilters = createDefaultEvidenceFilters(result.query);
      selectedBidderDetailKey = null;
      selectedSourceProjectId = null;
      evidenceFiltersExpanded = true;
      render();
    });

    root.querySelector<HTMLButtonElement>("#clear-query")?.addEventListener("click", () => {
      query = { ...emptyQuery };
      evidenceFilters = createDefaultEvidenceFilters(query);
      evidenceSort = createDefaultEvidenceSort();
      excludedSummaryRowIds = new Set<string>();
      selectedBidderDetailKey = null;
      selectedSourceProjectId = null;
      evidenceFiltersExpanded = true;
      itemSearchCollapsed = false;
      render();
    });

    root.querySelector<HTMLButtonElement>("#edit-item-search")?.addEventListener("click", () => {
      itemSearchCollapsed = false;
      selectedBidderDetailKey = null;
      selectedSourceProjectId = null;
      render();
    });

    root.querySelector<HTMLButtonElement>("#download-matching-projects-csv")?.addEventListener("click", () => {
      downloadEvidenceCsv(result, includedRows, data);
    });

    root.querySelector<HTMLInputElement>("#inflation-adjustment-toggle")?.addEventListener("change", (event) => {
      inflationAdjustmentEnabled = (event.currentTarget as HTMLInputElement).checked;
      render();
    });

    root.querySelectorAll<HTMLInputElement>("[data-exclude-row-id]").forEach((checkbox) => {
      checkbox.addEventListener("change", () => {
        const rowId = checkbox.dataset.excludeRowId;

        if (!rowId) {
          return;
        }

        if (checkbox.checked) {
          excludedSummaryRowIds.add(rowId);
        } else {
          excludedSummaryRowIds.delete(rowId);
        }

        render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-evidence-sort-key]").forEach((button) => {
      button.addEventListener("click", () => {
        const sortKey = button.dataset.evidenceSortKey as EvidenceSortKey | undefined;

        if (!sortKey) {
          return;
        }

        evidenceSort = evidenceSort.key === sortKey
          ? {
              key: sortKey,
              direction: evidenceSort.direction === "asc" ? "desc" : "asc"
            }
          : {
              key: sortKey,
              direction: defaultSortDirection(sortKey)
            };
        render();
      });
    });

    root.querySelectorAll<HTMLButtonElement>("[data-bidder-detail-key]").forEach((button) => {
      button.addEventListener("click", async () => {
        await data.ensureBidItemPricesLoaded();
        selectedBidderDetailKey = button.dataset.bidderDetailKey ?? null;
        selectedSourceProjectId = null;
        render();
      });
    });

    root.querySelector<HTMLAnchorElement>("[data-open-source-review]")?.addEventListener("click", (event) => {
      event.preventDefault();
      activeView = "sourceReview";
      selectedBidderDetailKey = null;
      selectedSourceProjectId = null;
      pendingFocus = "sourceList";
      render();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-bid-tab-project-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        await data.ensureBidItemPricesLoaded();
        selectedSourceProjectId = button.dataset.bidTabProjectId ?? null;
        selectedBidderDetailKey = null;
        pendingFocus = "sourceDetail";
        render();
      });
    });

    root.querySelector<HTMLButtonElement>("[data-close-bidder-detail]")?.addEventListener("click", () => {
      selectedBidderDetailKey = null;
      render();
    });

    root.querySelector<HTMLButtonElement>("[data-back-to-source-list]")?.addEventListener("click", () => {
      const projectId = selectedSourceProjectId;
      selectedSourceProjectId = null;
      pendingFocus = projectId ? { sourceProjectId: projectId } : "sourceList";
      render();
    });

    root.querySelectorAll<HTMLButtonElement>("[data-close-source-review]").forEach((button) => {
      button.addEventListener("click", () => {
        activeView = "explorer";
        selectedSourceProjectId = null;
        pendingFocus = "sourceLauncher";
        render();
      });
    });

    bindAddToProjectForm(
      root,
      result,
      includedRows,
      includedStats,
      includedSummaryStats,
      inflationAdjustmentEnabled,
      inflationAdjustedSummary
    );
    bindDuplicateProjectActions(root);
    bindProjectWorkspace(root);
  }

  function persistProjectState(nextState: ProjectWorkspaceState, renderAfterSave: boolean): void {
    const previousWarning = projectStorageWarning;
    projectState = nextState;
    projectStorageWarning = saveProjectWorkspaceState(nextState);

    if (renderAfterSave || (!previousWarning && projectStorageWarning)) {
      render();
    }
  }

  function bindAddToProjectForm(
    rootElement: HTMLElement,
    result: ReturnType<typeof buildEvidenceResult>,
    includedRows: EvidenceRow[],
    includedStats: EvidenceStats | null,
    includedSummaryStats: EvidenceSummaryStats,
    inflationAdjustmentEnabled: boolean,
    inflationAdjustedSummary: InflationAdjustedSummary | null
  ): void {
    const addForm = rootElement.querySelector<HTMLFormElement>("#add-project-item-form");

    if (!addForm) {
      return;
    }

    const costInput = addForm.elements.namedItem("preferredUnitCost") as HTMLInputElement | null;
    const costSourceInput = addForm.elements.namedItem("costSource") as HTMLInputElement | null;

    costInput?.addEventListener("input", () => {
      if (costSourceInput) {
        costSourceInput.value = "manual";
      }
    });

    rootElement.querySelectorAll<HTMLButtonElement>("[data-project-cost-value]").forEach((button) => {
      button.addEventListener("click", () => {
        const costValue = readOptionalFormNumber(button.dataset.projectCostValue ?? "");

        if (costValue === null || !costInput) {
          return;
        }

        costInput.value = formatDecimalInput(roundToHundredth(costValue));
        if (costSourceInput) {
          costSourceInput.value = "quick_fill";
        }
      });
    });

    addForm.addEventListener("submit", (event) => {
      event.preventDefault();

      const activeProject = getActiveProject(projectState);

      if (!activeProject || !hasRequiredProjectMetadata(activeProject)) {
        activeView = "project";
        render();
        return;
      }

      const quantityInput = addForm.elements.namedItem("quantity") as HTMLInputElement | null;
      const preferredUnitCostInput = addForm.elements.namedItem("preferredUnitCost") as HTMLInputElement | null;
      const notesInput = addForm.elements.namedItem("notes") as HTMLTextAreaElement | null;
      const quantity = readRequiredPositiveNumber(quantityInput, "Enter a quantity greater than zero.");
      const preferredUnitCost = readRequiredPositiveNumber(preferredUnitCostInput, "Enter a preferred unit cost greater than zero.");

      if (quantity === null || preferredUnitCost === null || !result.query.itemCode) {
        return;
      }

      const costSource = costSourceInput?.value === "quick_fill" ? "quick_fill" : "manual";
      const lineItem = createProjectLineItem({
        state: data.stateConfig.code,
        agencyId: result.query.agencyId,
        agencyItemId: result.query.agencyItemId,
        itemCode: result.query.itemCode,
        description: result.interpretedDescription,
        unit: result.query.unit,
        quantity,
        preferredUnitCost,
        notes: notesInput?.value ?? "",
        evidenceContext: buildProjectEvidenceContext(
          result,
          includedRows,
          includedStats,
          includedSummaryStats,
          inflationAdjustmentEnabled,
          inflationAdjustedSummary,
          costSource
        )
      });
      const matchingLineIds = activeProject.lineItems
        .filter((candidate) => candidate.agencyItemId === lineItem.agencyItemId)
        .map((candidate) => candidate.lineItemId);

      if (matchingLineIds.length > 0) {
        pendingDuplicateLine = {
          lineItem,
          matchingLineIds
        };
        render();
        return;
      }

      pendingDuplicateLine = null;
      persistProjectState(addProjectLineItem(projectState, activeProject.projectId, lineItem), true);
    });
  }

  function bindDuplicateProjectActions(rootElement: HTMLElement): void {
    rootElement.querySelectorAll<HTMLButtonElement>("[data-duplicate-project-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.duplicateProjectAction;
        const activeProject = getActiveProject(projectState);

        if (!pendingDuplicateLine || !activeProject) {
          return;
        }

        if (action === "cancel") {
          pendingDuplicateLine = null;
          render();
          return;
        }

        if (action === "add") {
          const lineItem = pendingDuplicateLine.lineItem;
          pendingDuplicateLine = null;
          persistProjectState(addProjectLineItem(projectState, activeProject.projectId, lineItem), true);
          return;
        }

        if (action === "update") {
          const form = rootElement.querySelector<HTMLFormElement>("#duplicate-project-item-form");
          const formData = form ? new FormData(form) : null;
          const selectedLineItemId = String(formData?.get("lineItemId") || "");

          if (!selectedLineItemId) {
            return;
          }

          const lineItem = pendingDuplicateLine.lineItem;
          pendingDuplicateLine = null;
          persistProjectState(
            replaceProjectLineItem(projectState, activeProject.projectId, selectedLineItemId, lineItem),
            true
          );
        }
      });
    });
  }

  function bindProjectWorkspace(rootElement: HTMLElement): void {
    const metadataForm = rootElement.querySelector<HTMLFormElement>("#project-metadata-form");

    metadataForm?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea").forEach((input) => {
      input.addEventListener("input", () => {
        const formData = new FormData(metadataForm);
        persistProjectState(
          updateActiveProjectMetadata(projectState, {
            name: String(formData.get("name") || ""),
            location: String(formData.get("location") || ""),
            notes: String(formData.get("notes") || "")
          }),
          false
        );
      });
    });

    rootElement.querySelector<HTMLButtonElement>("#download-project-csv")?.addEventListener("click", () => {
      const activeProject = getActiveProject(projectState);

      if (activeProject) {
        downloadProjectCsv(activeProject);
      }
    });

    rootElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-project-line-field]").forEach((input) => {
      input.addEventListener("change", () => {
        const lineItemId = input.dataset.projectLineId ?? "";
        const activeProject = getActiveProject(projectState);
        const lineItem = activeProject?.lineItems.find((candidate) => candidate.lineItemId === lineItemId) ?? null;
        const row = input.closest("tr");

        if (!activeProject || !lineItem || !row) {
          return;
        }

        const quantityInput = row.querySelector<HTMLInputElement>('[data-project-line-field="quantity"]');
        const preferredUnitCostInput = row.querySelector<HTMLInputElement>('[data-project-line-field="preferredUnitCost"]');
        const notesInput = row.querySelector<HTMLInputElement>('[data-project-line-field="notes"]');
        const quantity = readRequiredPositiveNumber(quantityInput, "Enter a quantity greater than zero.");
        const preferredUnitCost = readRequiredPositiveNumber(preferredUnitCostInput, "Enter a preferred unit cost greater than zero.");

        if (quantity === null || preferredUnitCost === null) {
          return;
        }

        persistProjectState(
          updateProjectLineItem(projectState, activeProject.projectId, lineItemId, {
            quantity,
            preferredUnitCost,
            notes: notesInput?.value ?? ""
          }),
          true
        );
      });
    });

    rootElement.querySelectorAll<HTMLButtonElement>("[data-remove-project-line-id]").forEach((button) => {
      button.addEventListener("click", () => {
        const activeProject = getActiveProject(projectState);
        const lineItemId = button.dataset.removeProjectLineId ?? "";

        if (!activeProject || !lineItemId) {
          return;
        }

        if (!window.confirm("Remove this project line? This cannot be undone.")) {
          return;
        }

        persistProjectState(removeProjectLineItem(projectState, activeProject.projectId, lineItemId), true);
      });
    });
  }

  render();
}

function applyPendingFocus(root: HTMLElement, pendingFocus: PendingFocus | null): void {
  if (!pendingFocus) {
    return;
  }

  if (pendingFocus === "sourceLauncher") {
    root.querySelector<HTMLElement>("[data-open-source-review]")?.focus();
    return;
  }

  if (pendingFocus === "sourceList") {
    root.querySelector<HTMLElement>("#source-review-title")?.focus();
    return;
  }

  if (pendingFocus === "sourceDetail") {
    root.querySelector<HTMLElement>("#source-review-detail-title")?.focus();
    return;
  }

  const projectButton = [...root.querySelectorAll<HTMLButtonElement>("[data-bid-tab-project-id]")]
    .find((button) => button.dataset.bidTabProjectId === pendingFocus.sourceProjectId);
  projectButton?.focus();
}

function renderViewTab(view: AppView, label: string, activeView: AppView): string {
  const isActive = view === activeView;

  return `
    <button
      type="button"
      class="app-view-tab ${isActive ? "app-view-tab--active" : ""}"
      data-app-view="${view}"
      aria-current="${isActive ? "page" : "false"}"
    >
      ${escapeHtml(label)}
    </button>
  `;
}

function includedEvidenceRows(rows: EvidenceRow[], excludedRowIds: ReadonlySet<string>): EvidenceRow[] {
  return rows.filter((row) => !excludedRowIds.has(row.rowId));
}

function buildProjectEvidenceContext(
  result: ReturnType<typeof buildEvidenceResult>,
  includedRows: EvidenceRow[],
  includedStats: EvidenceStats | null,
  includedSummaryStats: EvidenceSummaryStats,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null,
  costSource: ProjectEvidenceContext["costSource"]
): ProjectEvidenceContext {
  const summaryStats = inflationAdjustmentEnabled
    ? inflationAdjustedSummary?.summaryStats ?? { awarded: null, average: null, engineer: null }
    : includedSummaryStats;
  const inflationTargetPeriodLabel = inflationAdjustedSummary?.targetPeriod?.periodLabel ?? null;

  return {
    query: { ...result.query },
    filters: {
      ...result.filters,
      districts: [...result.filters.districts]
    },
    sort: { ...result.sort },
    includedRowCount: includedRows.length,
    includedObservationIds: uniqueValues(includedRows.flatMap((row) => row.observationIds)),
    summarySnapshot: {
      awarded: inflationAdjustmentEnabled ? inflationAdjustedSummary?.stats ?? null : includedStats,
      average: summaryStats.average,
      engineer: summaryStats.engineer,
      inflationAdjustmentEnabled,
      inflationTargetPeriodLabel,
      valuesAreInflationAdjusted: inflationAdjustmentEnabled && Boolean(inflationTargetPeriodLabel)
    },
    costSource
  };
}

function readRequiredPositiveNumber(input: HTMLInputElement | null, message: string): number | null {
  if (!input) {
    return null;
  }

  input.setCustomValidity("");
  const value = readOptionalFormNumber(input.value);

  if (value === null || value <= 0) {
    input.setCustomValidity(message);
    input.reportValidity();
    return null;
  }

  return value;
}

function validateQuantityRange(form: HTMLFormElement): boolean {
  const quantityMinInput = form.elements.namedItem("quantityMin") as HTMLInputElement | null;
  const quantityMaxInput = form.elements.namedItem("quantityMax") as HTMLInputElement | null;

  if (!quantityMinInput || !quantityMaxInput) {
    return true;
  }

  quantityMinInput.setCustomValidity("");
  quantityMaxInput.setCustomValidity("");

  const quantityMin = readOptionalFormNumber(quantityMinInput.value);
  const quantityMax = readOptionalFormNumber(quantityMaxInput.value);

  if (quantityMinInput.value.trim() && quantityMin === null) {
    quantityMinInput.setCustomValidity("Enter a numeric minimum quantity.");
    quantityMinInput.reportValidity();
    return false;
  }

  if (quantityMaxInput.value.trim() && quantityMax === null) {
    quantityMaxInput.setCustomValidity("Enter a numeric maximum quantity.");
    quantityMaxInput.reportValidity();
    return false;
  }

  if (quantityMin !== null && quantityMax !== null && quantityMin > quantityMax) {
    quantityMaxInput.setCustomValidity("Maximum quantity must be greater than or equal to minimum quantity.");
    quantityMaxInput.reportValidity();
    return false;
  }

  return true;
}

function readOptionalFormNumber(value: string): number | null {
  const trimmedValue = value.trim();

  if (!trimmedValue) {
    return null;
  }

  const numberValue = Number(trimmedValue);
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : null;
}

function roundToHundredth(value: number): number {
  return Math.round(value * 100) / 100;
}

function formatDecimalInput(value: number): string {
  return value.toFixed(2).replace(/\.?0+$/, "");
}

function defaultSortDirection(sortKey: EvidenceSortKey): "asc" | "desc" {
  return sortKey === "letDate" || sortKey.endsWith("Price") || sortKey === "quantity" || sortKey === "bidCount"
    ? "desc"
    : "asc";
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values)];
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
