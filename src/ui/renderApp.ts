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
  addProject,
  addProjectLineItem,
  createUserProject,
  createProjectLineItem,
  duplicateUserProject,
  getActiveProject,
  removeProjectLineItem,
  removeProjectFromState,
  replaceProject,
  replaceProjectLineItem,
  setActiveProject,
  updateProjectLineItem
} from "../projects/projectWorkspace";
import { createImportedCopy, downloadProjectBackup, readProjectBackupFile } from "../projects/projectBackup";
import { openProjectRepository, ProjectConflictError, type ProjectRepository } from "../projects/projectRepository";
import { ProjectEditCoordinator } from "../projects/projectEditCoordinator";
import { downloadEvidenceCsv } from "./exportEvidenceCsv";
import { downloadProjectCsv } from "./exportProjectCsv";
import {
  bindItemPicker,
  readQueryFromForm,
  renderExplorer
} from "./renderExplorer";
import {
  renderAddToProjectPanel,
  renderProjectManager,
  renderProjectWorkspace
} from "./renderProjectWorkspace";
import type { PendingDuplicateProjectLine, ProjectManagerFilters, ProjectMetadataEditorView } from "./renderProjectWorkspace";
import { readEvidenceFiltersFromForm, renderResults } from "./renderResults";
import { renderSourceReview } from "./renderSourceReview";

type AppView = "explorer" | "project" | "sourceReview";
type ProjectSubview = "workspace" | "manager";
type SaveStatus = "idle" | "saving" | "saved" | "failed";
type PendingFocus = "sourceLauncher" | "sourceList" | "sourceDetail" | { sourceProjectId: string };

interface ProjectMetadataDraft extends ProjectMetadataEditorView {
  expectedRevision: number | null;
  initialState: string;
  initialName: string;
  initialLocation: string;
  initialNotes: string;
}

export async function renderApp(
  root: HTMLElement,
  data: AppData,
  onStateChange: (stateCode: string, initialView?: "explorer" | "project") => void,
  initialView: "explorer" | "project" = "explorer"
): Promise<void> {
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
  const initializedRepository = await openProjectRepository();
  const projectRepository: ProjectRepository = initializedRepository.repository;
  let projectState: ProjectWorkspaceState = initializedRepository.state;
  let projectStorageWarning = initializedRepository.warning;
  let query = { ...emptyQuery };
  let evidenceFilters = createDefaultEvidenceFilters(query);
  let evidenceSort = createDefaultEvidenceSort();
  let evidenceFiltersExpanded = true;
  let itemSearchCollapsed = false;
  let excludedSummaryRowIds = new Set<string>();
  let inflationAdjustmentEnabled = false;
  let selectedBidderDetailKey: string | null = null;
  let selectedSourceProjectId: string | null = null;
  let activeView: AppView = initialView;
  let projectSubview: ProjectSubview = "workspace";
  let projectManagerFilters: ProjectManagerFilters = { query: "", state: "all", status: "active" };
  let projectReadOnly = false;
  let saveStatus: SaveStatus = "idle";
  let lastSavedAt: string | null = getActiveProject(projectState, data.stateConfig.code)?.updatedAt ?? null;
  let saveTimer: number | null = null;
  let saveQueue: Promise<void> = Promise.resolve();
  let localChangeVersion = 0;
  let persistedChangeVersion = 0;
  let lastSnapshotRevision = 0;
  let snapshotTimer: number | null = null;
  let storagePersistenceRequested = false;
  let pendingFocus: PendingFocus | null = null;
  let pendingDuplicateLine: PendingDuplicateProjectLine | null = null;
  let projectLineNotice: string | null = null;
  let projectLineNoticeToken = 0;
  let projectMetadataDraft: ProjectMetadataDraft | null = null;
  const editCoordinator = new ProjectEditCoordinator();
  editCoordinator.setLostOwnershipHandler(() => {
    projectReadOnly = true;
    render();
  });
  editCoordinator.setOwnershipAvailableHandler(() => {
    const project = getActiveProject(projectState, data.stateConfig.code);
    if (!project) return;
    editCoordinator.takeOver(project.projectId);
    projectReadOnly = false;
    projectStorageWarning = null;
    render();
  });
  const initialProject = getActiveProject(projectState, data.stateConfig.code);
  if (initialProject) lastSnapshotRevision = initialProject.revision;
  if (initialProject) projectReadOnly = !(await editCoordinator.claim(initialProject.projectId));

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
    const activeProject = getActiveProject(projectState, data.stateConfig.code);
    const addToProjectPanelHtml = renderAddToProjectPanel(
      result,
      activeProject,
      pendingDuplicateLine,
      projectLineNotice
    );

    root.innerHTML = `
      <main class="app-shell">
        <header class="app-header">
          <div class="app-brand">
            <img class="app-logo" src="brand/FHU-logo.png" alt="FHU — Felsburg Holt & Ullevig" />
            <span class="app-brand__divider" aria-hidden="true"></span>
            <h1>${escapeHtml(data.manifest.productTitle)}</h1>
          </div>
          <div class="app-header-controls">
            <label class="state-switcher">
              <select id="state-selector" aria-label="Select state">
                ${data.manifest.states.map((state) => `
                  <option value="${state.code}" ${state.code === data.stateConfig.code ? "selected" : ""}>${escapeHtml(state.name)}</option>
                `).join("")}
              </select>
            </label>
            <nav class="app-view-tabs" aria-label="Primary views">
              ${renderViewTab("explorer", "Explorer", activeView)}
              ${renderViewTab("project", "Project", activeView)}
            </nav>
          </div>
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
            ? projectSubview === "manager"
              ? renderProjectManager(projectState.projects, data.manifest.states, data.stateConfig.code, projectManagerFilters, activeProject, projectReadOnly, projectMetadataDraft)
              : renderProjectWorkspace(activeProject, projectState.projects, data.manifest.states, data.stateConfig.code, projectReadOnly, projectMetadataDraft)
            : renderSourceReview(data, selectedSourceProjectId)}

        <footer class="app-footer">
          <span class="app-footer__firm">Felsburg Holt &amp; Ullevig</span>
          <span class="app-footer__dot" aria-hidden="true">•</span>
          <span>${escapeHtml(data.manifest.productTitle)}</span>
          <span class="app-footer__dot" aria-hidden="true">•</span>
          <span>&copy; ${new Date().getFullYear()}</span>
          <span class="app-footer__save-status" data-project-save-status role="status" aria-live="polite">${escapeHtml(saveStatusText(saveStatus, lastSavedAt))}</span>
        </footer>
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
        if (!confirmDiscardProjectMetadataDraft()) return;

        activeView = nextView;
        if (nextView === "project") projectSubview = "workspace";
        selectedBidderDetailKey = null;
        selectedSourceProjectId = null;
        render();
      });
    });

    root.querySelector<HTMLSelectElement>("#state-selector")?.addEventListener("change", (event) => {
      const nextStateCode = (event.currentTarget as HTMLSelectElement).value;
      void (async () => {
        if (!confirmDiscardProjectMetadataDraft()) {
          render();
          return;
        }
        if (!(await flushPendingProjectSave())) {
          render();
          return;
        }
        cleanupProjectSession();
        onStateChange(nextStateCode, "explorer");
      })();
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
    bindProjectMetadataEditor(root);
    bindProjectWorkspace(root);
    bindProjectManager(root);
    bindImportControls(root);
  }

  function persistProjectState(nextState: ProjectWorkspaceState, renderAfterSave: boolean): void {
    projectState = nextState;
    localChangeVersion += 1;
    setSaveStatus("saving");
    ensurePersistentStorageRequested();
    if (renderAfterSave) render();
    if (renderAfterSave) {
      void queueProjectSave();
      return;
    }
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveTimer = null;
      void queueProjectSave();
    }, 400);
  }

  function queueProjectSave(): Promise<void> {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    saveQueue = saveQueue.then(async () => {
      if (localChangeVersion <= persistedChangeVersion) return;
      const project = getActiveProject(projectState, data.stateConfig.code);
      if (!project || projectReadOnly) return;
      const capturedChangeVersion = localChangeVersion;
      const expectedRevision = project.revision;
      try {
        const saved = await projectRepository.saveProject(structuredClone(project), expectedRevision);
        const current = projectState.projects.find((candidate) => candidate.projectId === project.projectId);
        if (current?.revision === expectedRevision) {
          projectState = replaceProject(projectState, {
            ...current,
            revision: saved.revision,
            updatedAt: saved.updatedAt
          });
        }
        if (projectMetadataDraft?.projectId === saved.projectId) {
          projectMetadataDraft = { ...projectMetadataDraft, expectedRevision: saved.revision };
        }
        persistedChangeVersion = Math.max(persistedChangeVersion, capturedChangeVersion);
        lastSavedAt = saved.updatedAt;
        setSaveStatus(projectRepository.isPersistent ? "saved" : "failed");
        if (capturedChangeVersion !== localChangeVersion) void queueProjectSave();
      } catch (error) {
        projectStorageWarning = error instanceof ProjectConflictError
          ? error.message
          : "Project changes could not be saved to browser storage.";
        projectReadOnly = error instanceof ProjectConflictError;
        setSaveStatus("failed");
        render();
      }
    });
    return saveQueue;
  }

  async function flushPendingProjectSave(): Promise<boolean> {
    if (saveTimer !== null) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    await queueProjectSave();
    return localChangeVersion <= persistedChangeVersion;
  }

  function setSaveStatus(status: SaveStatus): void {
    saveStatus = status;
    const statusElement = root.querySelector<HTMLElement>("[data-project-save-status]");
    if (statusElement) statusElement.textContent = saveStatusText(saveStatus, lastSavedAt);
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

      const activeProject = getActiveProject(projectState, data.stateConfig.code);

      if (!activeProject) {
        activeView = "project";
        render();
        return;
      }
      if (projectReadOnly) {
        projectStorageWarning = "This Project is read-only because it is being edited in another browser tab.";
        render();
        return;
      }

      const quantityInput = addForm.elements.namedItem("quantity") as HTMLInputElement | null;
      const preferredUnitCostInput = addForm.elements.namedItem("preferredUnitCost") as HTMLInputElement | null;
      const notesInput = addForm.elements.namedItem("notes") as HTMLTextAreaElement | null;
      const quantity = readRequiredPositiveNumber(quantityInput, "Enter a quantity greater than zero.");
      const preferredUnitCost = readRequiredPositiveNumber(preferredUnitCostInput, "Enter a unit cost greater than zero.");

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
      showProjectLineNotice(`${lineItem.itemCode} added to Project.`);
      persistProjectState(addProjectLineItem(projectState, activeProject.projectId, lineItem), true);
    });
  }

  function bindDuplicateProjectActions(rootElement: HTMLElement): void {
    rootElement.querySelectorAll<HTMLButtonElement>("[data-duplicate-project-action]").forEach((button) => {
      button.addEventListener("click", () => {
        const action = button.dataset.duplicateProjectAction;
        const activeProject = getActiveProject(projectState, data.stateConfig.code);

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
          showProjectLineNotice(`${lineItem.itemCode} added to Project as a new line.`);
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
          showProjectLineNotice(`${lineItem.itemCode} updated in Project.`);
          persistProjectState(
            replaceProjectLineItem(projectState, activeProject.projectId, selectedLineItemId, lineItem),
            true
          );
        }
      });
    });
  }

  function showProjectLineNotice(message: string): void {
    const noticeToken = ++projectLineNoticeToken;
    projectLineNotice = message;

    window.setTimeout(() => {
      if (projectLineNoticeToken !== noticeToken) {
        return;
      }

      projectLineNotice = null;
      root.querySelector<HTMLElement>("[data-project-line-notice]")?.remove();
    }, 4000);
  }

  function bindProjectMetadataEditor(rootElement: HTMLElement): void {
    rootElement.querySelectorAll<HTMLFormElement>("[data-project-editor-context]").forEach((form) => {
      const syncDraft = () => syncProjectMetadataDraft(form);
      form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")
        .forEach((input) => {
          input.addEventListener("input", syncDraft);
          input.addEventListener("change", syncDraft);
        });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        syncDraft();
        void saveProjectMetadataDraft(form);
      });
    });

    rootElement.querySelectorAll<HTMLButtonElement>("[data-cancel-project-editor]").forEach((button) => {
      button.addEventListener("click", () => {
        projectMetadataDraft = null;
        render();
      });
    });
  }

  function syncProjectMetadataDraft(form: HTMLFormElement): void {
    const context = form.dataset.projectEditorContext === "manager" ? "manager" : "workspace";
    const mode = form.dataset.projectEditorMode === "edit" ? "edit" : "create";
    const formData = new FormData(form);
    const existingDraft = projectMetadataDraft?.context === context && projectMetadataDraft.mode === mode
      ? projectMetadataDraft
      : createProjectMetadataDraft(context, mode);
    projectMetadataDraft = {
      ...existingDraft,
      state: String(formData.get("state") || existingDraft.state || data.stateConfig.code),
      name: String(formData.get("name") || ""),
      location: String(formData.get("location") || ""),
      notes: String(formData.get("notes") || "")
    };
  }

  function createProjectMetadataDraft(
    context: "workspace" | "manager",
    mode: "create" | "edit",
    project: UserProject | null = null
  ): ProjectMetadataDraft {
    const state = project?.state ?? data.stateConfig.code;
    const name = project?.name ?? "";
    const location = project?.location ?? "";
    const notes = project?.notes ?? "";
    return {
      context,
      mode,
      projectId: project?.projectId ?? null,
      expectedRevision: project?.revision ?? null,
      state,
      name,
      location,
      notes,
      initialState: state,
      initialName: name,
      initialLocation: location,
      initialNotes: notes
    };
  }

  function isProjectMetadataDraftDirty(): boolean {
    const draft = projectMetadataDraft;
    return Boolean(draft && (
      draft.state !== draft.initialState
      || draft.name !== draft.initialName
      || draft.location !== draft.initialLocation
      || draft.notes !== draft.initialNotes
    ));
  }

  function confirmDiscardProjectMetadataDraft(): boolean {
    if (!projectMetadataDraft) return true;
    if (isProjectMetadataDraftDirty() && !window.confirm("Discard unsaved Project changes?")) return false;
    projectMetadataDraft = null;
    return true;
  }

  async function saveProjectMetadataDraft(form: HTMLFormElement): Promise<void> {
    const draft = projectMetadataDraft;
    if (!draft) return;
    const nameInput = form.elements.namedItem("name") as HTMLInputElement | null;
    const name = draft.name.trim();
    if (!name) {
      nameInput?.setCustomValidity("Enter a Project name.");
      nameInput?.reportValidity();
      return;
    }
    nameInput?.setCustomValidity("");

    if (draft.mode === "create") {
      try {
        await createAndOpenProject(name, draft.state, draft.location.trim(), draft.notes.trim());
      } catch (error) {
        projectStorageWarning = error instanceof Error ? error.message : "The Project could not be created.";
        setSaveStatus("failed");
        render();
      }
      return;
    }

    if (!(await flushPendingProjectSave())) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === draft.projectId);
    if (!project) {
      projectStorageWarning = "The Project being edited is no longer available.";
      setSaveStatus("failed");
      render();
      return;
    }
    const location = draft.location.trim();
    const notes = draft.notes.trim();
    if (name === project.name && location === project.location && notes === project.notes) {
      projectMetadataDraft = null;
      render();
      return;
    }

    ensurePersistentStorageRequested();
    setSaveStatus("saving");
    try {
      const expectedRevision = draft.expectedRevision ?? project.revision;
      const saved = await projectRepository.saveProject({ ...project, name, location, notes }, expectedRevision);
      projectState = replaceProject(projectState, saved);
      if (getActiveProject(projectState, data.stateConfig.code)?.projectId === saved.projectId) {
        lastSavedAt = saved.updatedAt;
      }
      projectMetadataDraft = null;
      setSaveStatus(projectRepository.isPersistent ? "saved" : "failed");
      render();
    } catch (error) {
      projectStorageWarning = error instanceof ProjectConflictError
        ? error.message
        : "Project metadata could not be saved to browser storage.";
      if (error instanceof ProjectConflictError && getActiveProject(projectState, data.stateConfig.code)?.projectId === project.projectId) {
        projectReadOnly = true;
      }
      setSaveStatus("failed");
      render();
    }
  }

  function bindProjectWorkspace(rootElement: HTMLElement): void {
    rootElement.querySelector<HTMLButtonElement>("#download-project-csv")?.addEventListener("click", () => {
      const activeProject = getActiveProject(projectState, data.stateConfig.code);

      if (activeProject) {
        downloadProjectCsv(activeProject);
      }
    });

    rootElement.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-project-line-field]").forEach((input) => {
      const updateLine = (validate: boolean) => {
        const lineItemId = input.dataset.projectLineId ?? "";
        const activeProject = getActiveProject(projectState, data.stateConfig.code);
        const lineItem = activeProject?.lineItems.find((candidate) => candidate.lineItemId === lineItemId) ?? null;
        const row = input.closest("tr");

        if (!activeProject || !lineItem || !row) {
          return;
        }

        const quantityInput = row.querySelector<HTMLInputElement>('[data-project-line-field="quantity"]');
        const preferredUnitCostInput = row.querySelector<HTMLInputElement>('[data-project-line-field="preferredUnitCost"]');
        const notesInput = row.querySelector<HTMLInputElement>('[data-project-line-field="notes"]');
        const quantity = validate
          ? readRequiredPositiveNumber(quantityInput, "Enter a quantity greater than zero.")
          : readOptionalFormNumber(quantityInput?.value ?? "");
        const preferredUnitCost = validate
          ? readRequiredPositiveNumber(preferredUnitCostInput, "Enter a unit cost greater than zero.")
          : readOptionalFormNumber(preferredUnitCostInput?.value ?? "");

        if (quantity === null || preferredUnitCost === null) {
          return;
        }

        persistProjectState(
          updateProjectLineItem(projectState, activeProject.projectId, lineItemId, {
            quantity,
            preferredUnitCost,
            notes: notesInput?.value ?? ""
          }),
          false
        );
      };
      input.addEventListener("input", () => updateLine(false));
      input.addEventListener("blur", () => {
        updateLine(true);
        void queueProjectSave();
      });
    });

    rootElement.querySelectorAll<HTMLButtonElement>("[data-remove-project-line-id]").forEach((button) => {
      button.addEventListener("click", async () => {
        let activeProject = getActiveProject(projectState, data.stateConfig.code);
        const lineItemId = button.dataset.removeProjectLineId ?? "";

        if (!activeProject || !lineItemId) {
          return;
        }

        if (!window.confirm("Remove this project line? This cannot be undone.")) {
          return;
        }

        if (!(await flushPendingProjectSave())) return;
        activeProject = getActiveProject(projectState, data.stateConfig.code);
        if (!activeProject) return;
        await projectRepository.createRevision(activeProject, "Before line removal");
        persistProjectState(removeProjectLineItem(projectState, activeProject.projectId, lineItemId), true);
      });
    });

    rootElement.querySelectorAll<HTMLButtonElement>("[data-open-project-manager], [data-project-manager-shortcut]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!confirmDiscardProjectMetadataDraft()) return;
        activeView = "project";
        projectSubview = "manager";
        render();
      });
    });
    rootElement.querySelectorAll<HTMLButtonElement>("[data-activate-project]").forEach((button) => {
      button.addEventListener("click", () => void activateProject(button.dataset.activateProject ?? ""));
    });
    rootElement.querySelectorAll<HTMLButtonElement>("[data-start-new-project]").forEach((button) => {
      button.addEventListener("click", () => void startNewProject());
    });
    rootElement.querySelectorAll<HTMLButtonElement>("[data-edit-active-project]").forEach((button) => {
      button.addEventListener("click", () => void startProjectMetadataEdit("workspace", getActiveProject(projectState, data.stateConfig.code)?.projectId ?? ""));
    });
    rootElement.querySelector<HTMLButtonElement>("[data-take-over-project]")?.addEventListener("click", (event) => {
      const projectId = (event.currentTarget as HTMLButtonElement).dataset.takeOverProject ?? "";
      editCoordinator.takeOver(projectId);
      projectReadOnly = false;
      projectStorageWarning = null;
      render();
    });
  }

  function bindProjectManager(rootElement: HTMLElement): void {
    rootElement.querySelector<HTMLButtonElement>("[data-close-project-manager]")?.addEventListener("click", () => {
      if (!confirmDiscardProjectMetadataDraft()) return;
      projectSubview = "workspace";
      render();
    });

    const filterForm = rootElement.querySelector<HTMLFormElement>("#project-manager-filter-form");
    filterForm?.querySelectorAll<HTMLInputElement | HTMLSelectElement>("input, select").forEach((input) => {
      input.addEventListener("change", () => {
        const formData = new FormData(filterForm);
        projectManagerFilters = {
          query: String(formData.get("query") || ""),
          state: String(formData.get("state") || "all"),
          status: formData.get("status") === "archived" ? "archived" : "active"
        };
        render();
      });
    });

    rootElement.querySelectorAll<HTMLButtonElement>("[data-open-project]").forEach((button) => button.addEventListener("click", () => void activateProject(button.dataset.openProject ?? "")));
    rootElement.querySelectorAll<HTMLButtonElement>("[data-edit-project]").forEach((button) => button.addEventListener("click", () => void startProjectMetadataEdit("manager", button.dataset.editProject ?? "")));
    rootElement.querySelectorAll<HTMLButtonElement>("[data-duplicate-project]").forEach((button) => button.addEventListener("click", () => void duplicateProject(button.dataset.duplicateProject ?? "")));
    rootElement.querySelectorAll<HTMLButtonElement>("[data-backup-project]").forEach((button) => button.addEventListener("click", () => void backupProject(button.dataset.backupProject ?? "")));
    rootElement.querySelectorAll<HTMLButtonElement>("[data-archive-project]").forEach((button) => button.addEventListener("click", () => void archiveProject(button.dataset.archiveProject ?? "")));
    rootElement.querySelectorAll<HTMLButtonElement>("[data-restore-project]").forEach((button) => button.addEventListener("click", () => void restoreArchivedProject(button.dataset.restoreProject ?? "")));
    rootElement.querySelectorAll<HTMLButtonElement>("[data-delete-project]").forEach((button) => button.addEventListener("click", () => void deleteArchivedProject(button.dataset.deleteProject ?? "")));
  }

  async function startNewProject(): Promise<void> {
    if (!confirmDiscardProjectMetadataDraft()) return;
    if (!(await flushPendingProjectSave())) return;
    projectMetadataDraft = createProjectMetadataDraft("workspace", "create");
    activeView = "project";
    projectSubview = "workspace";
    render();
  }

  async function startProjectMetadataEdit(context: "workspace" | "manager", projectId: string): Promise<void> {
    if (!projectId || !confirmDiscardProjectMetadataDraft()) return;
    if (!(await flushPendingProjectSave())) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) return;
    if (context === "workspace" && projectReadOnly) return;
    projectMetadataDraft = createProjectMetadataDraft(context, "edit", project);
    if (context === "workspace") {
      activeView = "project";
      projectSubview = "workspace";
    }
    render();
  }

  async function createAndOpenProject(name: string, stateCode: string, location = "", notes = ""): Promise<void> {
    if (!(await flushPendingProjectSave())) return;
    const project = await projectRepository.createProject(createUserProject(name, stateCode, location, notes));
    projectState = addProject(projectState, project);
    await projectRepository.setActiveProjectId(stateCode, project.projectId);
    ensurePersistentStorageRequested();
    projectMetadataDraft = null;
    if (stateCode !== data.stateConfig.code) {
      cleanupProjectSession();
      onStateChange(stateCode, "project");
      return;
    }
    projectReadOnly = !(await editCoordinator.claim(project.projectId));
    projectSubview = "workspace";
    lastSavedAt = project.updatedAt;
    saveStatus = "saved";
    render();
  }

  async function activateProject(projectId: string): Promise<void> {
    if (!confirmDiscardProjectMetadataDraft()) return;
    if (!(await flushPendingProjectSave())) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === projectId && candidate.status === "active");
    if (!project) return;
    projectState = setActiveProject(projectState, project.projectId, project.state);
    await projectRepository.setActiveProjectId(project.state, project.projectId);
    if (project.state !== data.stateConfig.code) {
      cleanupProjectSession();
      onStateChange(project.state, "project");
      return;
    }
    projectReadOnly = !(await editCoordinator.claim(project.projectId));
    projectSubview = "workspace";
    lastSavedAt = project.updatedAt;
    saveStatus = "idle";
    render();
  }

  async function duplicateProject(projectId: string): Promise<void> {
    if (!confirmDiscardProjectMetadataDraft()) return;
    if (!(await flushPendingProjectSave())) return;
    const source = projectState.projects.find((project) => project.projectId === projectId);
    if (!source) return;
    const duplicate = await projectRepository.createProject(duplicateUserProject(source));
    projectState = addProject(projectState, duplicate);
    await projectRepository.setActiveProjectId(duplicate.state, duplicate.projectId);
    await activateProject(duplicate.projectId);
  }

  async function archiveProject(projectId: string): Promise<void> {
    if (!confirmDiscardProjectMetadataDraft()) return;
    if (!(await flushPendingProjectSave())) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === projectId);
    if (!project || !window.confirm(`Archive ${project.name || "this Project"}?`)) return;
    await projectRepository.createRevision(project, "Before archive");
    const saved = await projectRepository.saveProject({ ...project, status: "archived", archivedAt: new Date().toISOString() }, project.revision);
    projectState = replaceProject(projectState, saved);
    if (projectState.activeProjectIdByState[project.state] === projectId) {
      editCoordinator.release();
      projectReadOnly = false;
      const replacement = projectState.projects.filter((candidate) => candidate.state === project.state && candidate.status === "active")
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0] ?? null;
      projectState = setActiveProject(projectState, replacement?.projectId ?? null, project.state);
      await projectRepository.setActiveProjectId(project.state, replacement?.projectId ?? null);
    }
    render();
  }

  async function restoreArchivedProject(projectId: string): Promise<void> {
    if (!confirmDiscardProjectMetadataDraft()) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) return;
    const saved = await projectRepository.saveProject({ ...project, status: "active", archivedAt: null }, project.revision);
    projectState = replaceProject(projectState, saved);
    projectManagerFilters = { ...projectManagerFilters, status: "active" };
    render();
  }

  async function deleteArchivedProject(projectId: string): Promise<void> {
    if (!confirmDiscardProjectMetadataDraft()) return;
    if (!(await flushPendingProjectSave())) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === projectId && candidate.status === "archived");
    if (!project || !window.confirm(`Permanently delete ${project.name || "this Project"}? This cannot be undone.`)) return;
    try {
      await projectRepository.deleteProject(projectId);
      projectState = removeProjectFromState(projectState, projectId);
      projectStorageWarning = null;
      render();
    } catch (error) {
      projectStorageWarning = error instanceof Error ? error.message : "The archived Project could not be deleted.";
      render();
    }
  }

  async function backupProject(projectId: string): Promise<void> {
    if (!(await flushPendingProjectSave())) return;
    const project = projectState.projects.find((candidate) => candidate.projectId === projectId);
    if (!project) return;
    downloadProjectBackup(project);
    const saved = await projectRepository.recordBackup(project.projectId, project.revision);
    projectState = replaceProject(projectState, saved);
    render();
  }

  function bindImportControls(rootElement: HTMLElement): void {
    rootElement.querySelectorAll<HTMLButtonElement>("[data-import-project]").forEach((button) => {
      button.addEventListener("click", () => {
        if (!confirmDiscardProjectMetadataDraft()) return;
        button.parentElement?.querySelector<HTMLInputElement>("[data-project-import-input]")?.click();
      });
    });
    rootElement.querySelectorAll<HTMLInputElement>("[data-project-import-input]").forEach((input) => {
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file) void importProjectFile(file);
        input.value = "";
      });
    });
  }

  async function importProjectFile(file: File): Promise<void> {
    try {
      if (!confirmDiscardProjectMetadataDraft()) return;
      if (!(await flushPendingProjectSave())) return;
      const backup = await readProjectBackupFile(file);
      const existing = projectState.projects.find((project) => project.projectId === backup.project.projectId);
      let imported: UserProject = { ...structuredClone(backup.project), status: "active", archivedAt: null };
      if (existing) {
        const choice = window.prompt("A Project with this ID already exists. Enter COPY to import a copy, REPLACE to replace it, or Cancel.", "COPY")?.trim().toUpperCase();
        if (!choice) return;
        if (choice === "COPY") {
          imported = createImportedCopy(imported);
        } else if (choice === "REPLACE") {
          await projectRepository.createRevision(existing, "Before import replacement");
          imported = await projectRepository.saveProject({ ...imported, projectId: existing.projectId, revision: existing.revision }, existing.revision);
          projectState = replaceProject(projectState, imported);
          await activateProject(imported.projectId);
          return;
        } else {
          window.alert("Import canceled. Enter COPY or REPLACE.");
          return;
        }
      } else {
        imported = { ...imported, revision: 0, lastBackupAt: null, lastBackupRevision: null };
      }
      const saved = await projectRepository.createProject(imported);
      projectState = addProject(projectState, saved);
      await projectRepository.setActiveProjectId(saved.state, saved.projectId);
      await activateProject(saved.projectId);
    } catch (error) {
      projectStorageWarning = error instanceof Error ? error.message : "Project backup could not be imported.";
      render();
    }
  }

  async function requestPersistentStorage(): Promise<void> {
    try { await navigator.storage?.persist?.(); } catch { /* Persistence is a best-effort browser permission. */ }
  }

  function ensurePersistentStorageRequested(): void {
    if (storagePersistenceRequested) return;
    storagePersistenceRequested = true;
    void requestPersistentStorage();
  }

  function cleanupProjectSession(): void {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    editCoordinator.close();
    projectRepository.close();
    if (snapshotTimer !== null) window.clearInterval(snapshotTimer);
    snapshotTimer = null;
  }

  snapshotTimer = window.setInterval(() => {
    const project = getActiveProject(projectState, data.stateConfig.code);
    if (project && project.revision > lastSnapshotRevision) {
      lastSnapshotRevision = project.revision;
      void projectRepository.createRevision(project, "Periodic autosave snapshot");
    }
  }, 300000);
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

function saveStatusText(status: SaveStatus, lastSavedAt: string | null): string {
  if (status === "saving") return "Saving…";
  if (status === "failed") return "Project save failed";
  if (!lastSavedAt) return "";
  const date = new Date(lastSavedAt);
  return Number.isNaN(date.valueOf())
    ? "Project saved"
    : `Project saved at ${date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}`;
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
