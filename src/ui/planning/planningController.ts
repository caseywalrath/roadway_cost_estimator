// Planning v2 controller: state, delegated events, targeted DOM patches, autosave, import and export.
// Behavior: docs/planning-v2-ui.md sections 4 and 8. Created once per app session; mount() may be called
// many times on different containers because the app rebuilds its DOM.
import { calculateAlternative } from "../../planning/calculate";
import {
  addAlternative,
  duplicateAlternative,
  removeAlternative,
  renameAlternative,
  resetElementInput,
  selectAlternative,
  setBaseTreatment,
  setBudget,
  setElementEnabled,
  setElementInput,
  setElementOverride,
  setEngineering,
  setProjectInput,
  setStage
} from "../../planning/edit";
import { buildPlanningCsv, planningCsvFilename } from "../../planning/exportCsv";
import { buildShareFile, importProjectCopy, parseShareFile } from "../../planning/shareFile";
import type { PlanningProjectSummary, PlanningStore, SavePlanningResult } from "../../planning/storage";
import { createProject } from "../../planning/templates";
import type {
  AlternativeResult,
  ElementResult,
  ElementSelection,
  PlanningIssue,
  PlanningProject,
  ProjectInputKey,
  ProjectInputs,
  ResolvedElement,
  ResolvedLibrary
} from "../../planning/types";
import { formatEntered, formatPlain, formatTotalAmount, inputBrief, parseDollar, parseNumber, parsePercent, percentNumber } from "./format";
import { renderPrintSummary } from "./printSummary";
import {
  budgetInfo,
  groupSubtotalText,
  inputHint,
  inputSignature,
  otherBoxText,
  renderComponentLines,
  renderElementInputs,
  renderLoadError,
  renderLoading,
  renderNewProjectPanel,
  renderPlanningView,
  renderProjectMenuItems,
  renderResetSlot,
  renderSaveStatus,
  renderTitle,
  rowAmount,
  dollarBoxLabel,
  summaryValues,
  type NewProjectDraft,
  type Notice,
  type PlanningViewModel,
  type SaveStatus
} from "./renderPlanning";

export interface PlanningControllerDeps {
  loadLibrary: () => Promise<{ library: ResolvedLibrary; issues: PlanningIssue[] }>;
  openStore: () => Promise<PlanningStore>;
  /** ISO timestamp. */
  now: () => string;
  newId: () => string;
  /** Delay after the last edit before saving. Default 500. */
  saveDelayMs?: number;
  /** JSON and CSV export. Default: Blob + anchor click. */
  download?: (filename: string, text: string, mimeType: string) => void;
  /** Opens the print dialog. Default: window.print(). */
  print?: () => void;
  /** Creates and opens an engineer Project from one alternative. Absent = the button is hidden. */
  createEngineerProject?: (library: ResolvedLibrary, project: PlanningProject, alternativeId: string) => Promise<void>;
}

export interface PlanningController {
  mount(container: HTMLElement): void;
  unmount(): void;
  /** Resolves when loading and any pending operation are done and pending edits are saved. */
  flush(): Promise<void>;
}

type Phase = "idle" | "loading" | "error" | "new" | "ready";
type EditableField = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

interface FocusState {
  selector: string;
  start: number | null;
  end: number | null;
}

const STORAGE_BLOCKED = "Planning projects cannot be saved in this browser. Changes will be lost when the page closes.";
const CONFLICT_CODES = new Set(["missing_price", "unit_mismatch"]);

const byUpdated = (a: PlanningProjectSummary, b: PlanningProjectSummary) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0);

/** In-memory store used when browser storage is unavailable. Same revision rules as the IndexedDB store. */
function createMemoryStore(): PlanningStore {
  const projects = new Map<string, PlanningProject>();
  let last: string | null = null;
  return {
    async listProjects() {
      return [...projects.values()].map(({ id, name, updatedAt, revision }) => ({ id, name, updatedAt, revision })).sort(byUpdated);
    },
    async getProject(id) {
      const found = projects.get(id);
      return found ? structuredClone(found) : null;
    },
    async saveProject(project, expectedRevision, now): Promise<SavePlanningResult> {
      const current = projects.get(project.id);
      if (current && current.revision !== expectedRevision) return { ok: false, reason: "conflict", current: structuredClone(current) };
      const saved: PlanningProject = { ...structuredClone(project), revision: expectedRevision + 1, updatedAt: now };
      projects.set(saved.id, saved);
      return { ok: true, project: structuredClone(saved) };
    },
    async deleteProject(id) {
      projects.delete(id);
    },
    async getLastProjectId() {
      return last;
    },
    async setLastProjectId(id) {
      last = id;
    },
    close() {}
  };
}

function defaultDownload(filename: string, text: string, mimeType: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === "function") return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(new Error("The file could not be read."));
    reader.readAsText(file);
  });
}

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function createPlanningController(deps: PlanningControllerDeps): PlanningController {
  const saveDelay = deps.saveDelayMs ?? 500;
  const download = deps.download ?? defaultDownload;
  const print = deps.print ?? (() => window.print());

  let container: HTMLElement | null = null;
  let phase: Phase = "idle";
  let loadError = "";
  let library!: ResolvedLibrary;
  let store!: PlanningStore;
  let initPromise: Promise<void> | null = null;

  let project: PlanningProject | null = null;
  let projects: PlanningProjectSummary[] = [];
  let result!: AlternativeResult;
  let altTotals: Record<string, number> = {};
  let basePreview: Record<string, number> = {};
  const openDetails = new Set<string>();
  let addAltOpen = false;
  let addAltName = "";
  let renaming = false;
  let saveStatus: SaveStatus = { kind: "saving" };
  let notice: Notice | null = null;
  let draft: NewProjectDraft = { name: "", templateId: null, inputs: { lengthMiles: 0, roadwayWidthFt: 0, intersections: 0 }, error: "" };

  let dirty = false;
  let conflict: PlanningProject | null = null;
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: Promise<void> | null = null;
  const busy = new Set<Promise<unknown>>();
  let documentListening = false;

  const baselines = new WeakMap<Element, string>();
  const htmlCache = new WeakMap<Element, string>();
  const warned = new Set<string>();

  function track<T>(promise: Promise<T>): Promise<T> {
    busy.add(promise);
    const clear = () => void busy.delete(promise);
    promise.then(clear, clear);
    return promise;
  }

  // ---------- Model helpers ----------

  const selectedId = (): string => project!.selectedAlternativeId;
  const selectedAlt = () => project!.alternatives.find((a) => a.id === selectedId());
  const elementById = (id: string): ResolvedElement | undefined => library.elements.find((e) => e.id === id);

  function warnIssues(issues: PlanningIssue[]): void {
    for (const issue of issues) {
      if (!CONFLICT_CODES.has(issue.code) || warned.has(issue.message)) continue;
      warned.add(issue.message);
      console.warn(`Planning data issue (${issue.code}): ${issue.message}`);
    }
  }

  function recalculate(): void {
    if (!project) return;
    if (!project.alternatives.some((a) => a.id === project!.selectedAlternativeId)) {
      project = { ...project, selectedAlternativeId: project.alternatives[0].id };
    }
    result = calculateAlternative(library, project);
    warnIssues(result.issues);
    altTotals = {};
    for (const alt of project.alternatives) {
      altTotals[alt.id] = alt.id === result.alternativeId ? result.summary.total : calculateAlternative(library, project, alt.id).summary.total;
    }
    basePreview = {};
    for (const element of library.elements) {
      if (element.group !== "base" || element.components.length === 0) continue;
      if (result.elements.find((e) => e.elementId === element.id)?.enabled) continue;
      const preview = calculateAlternative(library, setBaseTreatment(project, library, selectedId(), element.id));
      basePreview[element.id] = preview.elements.find((e) => e.elementId === element.id)?.calculated ?? 0;
    }
  }

  function viewModel(): PlanningViewModel {
    return {
      library,
      project: project!,
      projects,
      result,
      altTotals,
      basePreview,
      openDetails,
      addAltOpen,
      addAltName,
      renaming,
      saveStatus,
      notice,
      canCreateProject: deps.createEngineerProject !== undefined
    };
  }

  function defaultDraft(templateId: string | null): NewProjectDraft {
    const template = library.templates.find((t) => t.id === templateId);
    const inputs = {} as ProjectInputs;
    for (const definition of library.projectInputs) inputs[definition.key] = definition.default;
    Object.assign(inputs, template?.projectInputs);
    return { name: "", templateId: template ? template.id : null, inputs, error: "" };
  }

  // ---------- DOM helpers ----------

  const qs = <T extends Element = HTMLElement>(selector: string, scope: ParentNode | null = container): T | null => (scope ? scope.querySelector<T>(selector) : null);
  const qsa = <T extends Element = HTMLElement>(selector: string, scope: ParentNode | null = container): T[] => (scope ? [...scope.querySelectorAll<T>(selector)] : []);
  const activeElement = (): Element | null => container?.ownerDocument.activeElement ?? null;

  function captureFocus(): FocusState | null {
    const el = activeElement();
    if (!container || !el || el === container || !container.contains(el)) return null;
    const attrs = [...el.attributes]
      .filter((a) => a.name.startsWith("data-"))
      .map((a) => `[${a.name}="${a.value.replace(/["\\]/g, "\\$&")}"]`)
      .join("");
    if (!attrs) return null;
    let start: number | null = null;
    let end: number | null = null;
    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      try {
        start = el.selectionStart;
        end = el.selectionEnd;
      } catch {
        // Input types without a selection range.
      }
    }
    return { selector: `${el.tagName.toLowerCase()}${attrs}`, start, end };
  }

  function restoreFocus(state: FocusState | null): void {
    if (!state) return;
    const el = qs<HTMLElement>(state.selector);
    if (!el) return;
    el.focus({ preventScroll: true });
    if (state.start !== null && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
      try {
        el.setSelectionRange(state.start, state.end ?? state.start);
      } catch {
        // Input types without a selection range.
      }
    }
  }

  function focusSelector(selector: string): void {
    qs<HTMLElement>(selector)?.focus({ preventScroll: true });
  }

  /** Writes a field value from the model and remembers it as the text to restore on Escape. */
  function setValue(el: EditableField, text: string): void {
    el.value = text;
    baselines.set(el, el.value);
  }

  /** Replaces a node's markup only when it changed. Focus inside the node is restored by data-* key. */
  function applyHtml(node: Element, html: string, seedOnly: boolean): void {
    if (htmlCache.get(node) === html) return;
    htmlCache.set(node, html);
    if (seedOnly) return;
    const focus = node.contains(activeElement()) ? captureFocus() : null;
    node.innerHTML = html;
    restoreFocus(focus);
  }

  function setText(selector: string, text: string): void {
    for (const el of qsa(selector)) el.textContent = text;
  }

  function markInvalid(field: HTMLElement, error: HTMLElement | null, message: string): void {
    field.setAttribute("aria-invalid", "true");
    if (error) {
      error.textContent = message;
      error.hidden = false;
    }
  }

  function clearInvalid(field: HTMLElement, error: HTMLElement | null): void {
    field.removeAttribute("aria-invalid");
    if (error) {
      error.textContent = "";
      error.hidden = true;
    }
  }

  function errorFor(field: HTMLElement): HTMLElement | null {
    if (field.dataset.elementAmount) return qs(`[data-element-error="${field.dataset.elementAmount}"]`);
    if (field.dataset.planningRate) return qs("[data-planning-summary-error]");
    if (field.dataset.planningAddAltName !== undefined) return qs("[data-planning-add-alt-error]");
    if (field.dataset.planningNewName !== undefined || field.dataset.planningNewInput) return qs("[data-planning-new-error]");
    if (field.dataset.planningRenameInput !== undefined) return qs("[data-planning-rename-error]");
    return field.closest("label")?.querySelector<HTMLElement>(".filter-validation-message") ?? null;
  }

  function closeMenus(): void {
    for (const menu of qsa<HTMLDetailsElement>("details[data-planning-menu]")) menu.open = false;
  }

  function setNotice(next: Notice | null): void {
    notice = next;
    const el = qs("[data-planning-notice]");
    if (!el) return;
    el.className = next?.kind === "error" ? "filter-validation-message" : "muted";
    el.textContent = next?.text ?? "";
    el.hidden = !next;
  }

  function setSaveStatus(next: SaveStatus): void {
    saveStatus = next;
    const el = qs("[data-planning-save-status]");
    if (el) el.innerHTML = renderSaveStatus(next);
  }

  function announce(): void {
    const values = summaryValues(result.summary);
    const budget = budgetInfo(result.summary);
    const el = qs("[data-planning-announce]");
    if (el) el.textContent = `Total ${values.total}${budget ? `, ${budget.remainingText}` : ""}`;
  }

  // ---------- Rendering ----------

  function pageHtml(): string {
    switch (phase) {
      case "idle":
      case "loading":
        return renderLoading();
      case "error":
        return renderLoadError(loadError);
      case "new":
        return renderNewProjectPanel(library, draft, project !== null, notice);
      case "ready":
        return renderPlanningView(viewModel());
    }
  }

  /** Re-renders the whole Planning view, keeping the focused field and its caret. */
  function renderRoot(): void {
    if (!container) return;
    if (phase === "new") readDraft();
    const focus = captureFocus();
    container.innerHTML = pageHtml();
    if (phase === "ready") patchRows(null, true);
    restoreFocus(focus);
  }

  function rowEntries(): Array<{ row: HTMLElement; element: ResolvedElement }> {
    const entries: Array<{ row: HTMLElement; element: ResolvedElement }> = [];
    for (const row of qsa("[data-element-row]")) {
      const element = elementById(row.dataset.elementRow ?? "");
      if (element) entries.push({ row, element });
    }
    return entries;
  }

  /** Patches every element row and group subtotal. With seedOnly, only records the markup already rendered. */
  function patchRows(committed: Element | null, seedOnly = false): void {
    const alt = selectedAlt();
    if (!alt) return;
    const active = activeElement();
    const writable = (el: Element) => el !== active || el === committed;
    for (const { row, element } of rowEntries()) {
      const box = qs<HTMLInputElement>("[data-element-amount]", row);
      if (element.group === "other") {
        if (box && !seedOnly && writable(box)) setValue(box, otherBoxText(alt.selections[element.id]));
        continue;
      }
      const er = result.elements.find((e) => e.elementId === element.id);
      if (!er) continue;
      const selection = alt.selections[element.id];
      if (!seedOnly) {
        row.className = `planning-row${er.enabled ? "" : " planning-row--off"}`;
        const toggle = qs<HTMLInputElement>("[data-element-toggle]", row);
        if (toggle) toggle.checked = er.enabled;
      }
      if (!box) continue;
      const amount = rowAmount(er, basePreview);
      if (!seedOnly) {
        box.setAttribute("aria-label", dollarBoxLabel(element, er.enabled));
        if (writable(box)) setValue(box, amount.boxText);
      }
      const slot = qs(`[data-element-reset-slot]`, row);
      if (slot) {
        const hadFocus = slot.contains(active);
        applyHtml(slot, renderResetSlot(element, amount), seedOnly);
        if (hadFocus && !slot.contains(activeElement())) box.focus({ preventScroll: true });
      }
      const brief = qs("[data-element-brief]", row);
      if (brief && !seedOnly) brief.textContent = inputBrief(element, er.inputs);
      const components = qs("[data-element-components]", row);
      if (components) applyHtml(components, renderComponentLines(element, er, library, result.summary, amount.calculated), seedOnly);
      const region = qs("[data-element-inputs]", row);
      if (region) patchInputs(region, element, er, selection, committed, seedOnly);
    }
    if (seedOnly) return;
    for (const group of library.groups) setText(`[data-group-subtotal="${group.id}"]`, groupSubtotalText(group, result));
  }

  function patchInputs(
    region: HTMLElement,
    element: ResolvedElement,
    er: ElementResult,
    selection: ElementSelection | undefined,
    committed: Element | null,
    seedOnly: boolean
  ): void {
    if (seedOnly) {
      for (const hint of qsa<HTMLElement>("[data-input-hint]", region)) {
        const input = element.inputs.find((i) => i.key === hint.dataset.inputHint);
        if (input) htmlCache.set(hint, inputHint(element, input, selection, project!.inputs));
      }
      return;
    }
    const signature = inputSignature(element, er);
    if (region.dataset.inputSig !== signature) {
      region.dataset.inputSig = signature;
      const open = openDetails.has(`adv:${element.id}`);
      const focus = region.contains(activeElement()) ? captureFocus() : null;
      region.innerHTML = renderElementInputs(element, er, selection, project!.inputs, open);
      for (const hint of qsa<HTMLElement>("[data-input-hint]", region)) {
        const input = element.inputs.find((i) => i.key === hint.dataset.inputHint);
        if (input) htmlCache.set(hint, inputHint(element, input, selection, project!.inputs));
      }
      restoreFocus(focus);
      return;
    }
    const active = activeElement();
    for (const control of qsa<EditableField>("[data-input-key]", region)) {
      const key = control.dataset.inputKey ?? "";
      const input = element.inputs.find((i) => i.key === key);
      if (!input || !(key in er.inputs)) continue;
      const value = er.inputs[key];
      if (control !== active || control === committed) setValue(control, typeof value === "number" && !input.options ? formatPlain(value) : String(value));
    }
    for (const hint of qsa<HTMLElement>("[data-input-hint]", region)) {
      const input = element.inputs.find((i) => i.key === hint.dataset.inputHint);
      if (!input) continue;
      const html = inputHint(element, input, selection, project!.inputs);
      const focused = hint.contains(active);
      applyHtml(hint, html, false);
      hint.hidden = html === "";
      if (focused && !hint.contains(activeElement())) qs<HTMLElement>(`[data-input-key="${input.key}"]`, region)?.focus({ preventScroll: true });
    }
  }

  function patchSummary(): void {
    const values = summaryValues(result.summary);
    for (const el of qsa("[data-summary]")) {
      const key = el.dataset.summary ?? "";
      if (key in values) el.textContent = values[key];
    }
    const budget = budgetInfo(result.summary);
    for (const key of ["budgetLine", "budgetShort"]) for (const el of qsa(`[data-summary="${key}"]`)) el.hidden = !budget;
    if (budget) {
      setText('[data-summary="budgetValue"]', budget.budgetText);
      const state = budget.over ? "planning-budget--over" : "planning-budget--under";
      for (const el of qsa('[data-summary="budgetRemaining"]')) {
        el.textContent = budget.remainingText;
        el.className = state;
      }
      for (const el of qsa('[data-summary="budgetShort"]')) {
        el.textContent = budget.shortText;
        el.className = state;
      }
    }
    setText('[data-summary="altName"]', selectedAlt()?.name ?? "");
  }

  function patchAlternativeButtons(): void {
    for (const alt of project!.alternatives) {
      setText(`[data-alt-total="${alt.id}"]`, formatTotalAmount(altTotals[alt.id] ?? 0));
      setText(`[data-alt-name="${alt.id}"]`, alt.name);
    }
  }

  function patchProjectMenu(): void {
    const list = qs("[data-planning-project-list]");
    if (list && project) list.innerHTML = renderProjectMenuItems(projects, project);
  }

  /** Recalculates and patches the DOM after an edit; schedules a save when the model changed. */
  function refresh(options: { rows?: boolean; committed?: Element | null; save?: boolean } = {}): void {
    recalculate();
    if (container && phase === "ready") {
      patchSummary();
      patchAlternativeButtons();
      if (options.rows !== false) patchRows(options.committed ?? null);
      announce();
    }
    if (options.save !== false) scheduleSave();
  }

  /** Applies an edited project. Saves only when it differs from the current one. */
  function apply(next: PlanningProject, options: { rows?: boolean; committed?: Element | null } = {}): void {
    const changed = JSON.stringify(next) !== JSON.stringify(project);
    project = next;
    refresh({ ...options, save: changed });
  }

  // ---------- Saving ----------

  function scheduleSave(): void {
    if (!project || conflict) return;
    dirty = true;
    setSaveStatus({ kind: "saving" });
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void track(saveNow());
    }, saveDelay);
  }

  async function runSaves(): Promise<void> {
    while (dirty && project && store && !conflict) {
      const snapshot = project;
      dirty = false;
      let saved: SavePlanningResult;
      try {
        saved = await store.saveProject(snapshot, snapshot.revision, deps.now());
      } catch (error) {
        dirty = true;
        setSaveStatus({ kind: "error", reason: messageOf(error) });
        return;
      }
      if (saved.ok) {
        if (project && project.id === snapshot.id) project = { ...project, revision: saved.project.revision, updatedAt: saved.project.updatedAt };
        if (!dirty) setSaveStatus({ kind: "saved", at: saved.project.updatedAt });
        await refreshProjects();
      } else {
        conflict = saved.current;
        setSaveStatus({ kind: "conflict" });
        return;
      }
    }
  }

  function saveNow(): Promise<void> {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (inFlight) return inFlight;
    if (!dirty) return Promise.resolve();
    inFlight = runSaves().finally(() => {
      inFlight = null;
    });
    return inFlight;
  }

  async function refreshProjects(): Promise<void> {
    try {
      projects = await store.listProjects();
      patchProjectMenu();
    } catch {
      // The menu keeps its last list.
    }
  }

  // ---------- Project lifecycle ----------

  function setCurrent(next: PlanningProject, status?: SaveStatus): void {
    project = next;
    conflict = null;
    dirty = false;
    renaming = false;
    addAltOpen = false;
    openDetails.clear();
    phase = "ready";
    saveStatus = status ?? { kind: "saved", at: next.updatedAt };
    recalculate();
    void store.setLastProjectId(next.id).catch(() => undefined);
    renderRoot();
  }

  async function openProject(id: string): Promise<void> {
    await saveNow();
    const found = await store.getProject(id);
    if (!found) {
      await refreshProjects();
      setNotice({ kind: "error", text: "That planning project could not be found." });
      patchProjectMenu();
      return;
    }
    setNotice(storageBlocked ? { kind: "info", text: STORAGE_BLOCKED } : null);
    setCurrent(found);
  }

  let storageBlocked = false;

  async function initialize(): Promise<void> {
    try {
      const loaded = await deps.loadLibrary();
      library = loaded.library;
      warnIssues(loaded.issues);
    } catch (error) {
      phase = "error";
      loadError = messageOf(error);
      renderRoot();
      return;
    }
    try {
      store = await deps.openStore();
    } catch {
      store = createMemoryStore();
      storageBlocked = true;
      notice = { kind: "info", text: STORAGE_BLOCKED };
    }
    try {
      projects = await store.listProjects();
      const lastId = await store.getLastProjectId();
      const wanted = (lastId && projects.find((p) => p.id === lastId)?.id) ?? projects[0]?.id ?? null;
      const found = wanted ? await store.getProject(wanted) : null;
      if (found) {
        setCurrent(found);
        return;
      }
    } catch (error) {
      notice = { kind: "error", text: `Saved planning projects could not be read: ${messageOf(error)}` };
    }
    draft = defaultDraft(library.templates[0]?.id ?? null);
    phase = "new";
    renderRoot();
  }

  function readDraft(): void {
    const panel = qs("[data-planning-new]");
    if (!panel) return;
    const name = qs<HTMLInputElement>("[data-planning-new-name]", panel);
    if (name) draft.name = name.value;
    const picked = qs<HTMLInputElement>('input[name="planning-template"]:checked', panel);
    if (picked) draft.templateId = picked.value === "" ? null : picked.value;
    for (const field of qsa<HTMLInputElement>("[data-planning-new-input]", panel)) {
      const parsed = parseNumber(field.value);
      if (parsed.ok && parsed.value !== null) draft.inputs[field.dataset.planningNewInput as ProjectInputKey] = parsed.value;
    }
  }

  function showNewPanel(): void {
    if (!project) return;
    draft = defaultDraft(library.templates[0]?.id ?? null);
    phase = "new";
    renderRoot();
    focusSelector("[data-planning-new-name]");
  }

  function createFromPanel(): void {
    const panel = qs("[data-planning-new]");
    if (!panel) return;
    readDraft();
    const fail = (message: string) => {
      draft.error = message;
      const error = qs("[data-planning-new-error]", panel);
      if (error) {
        error.textContent = message;
        error.hidden = false;
      }
    };
    const name = draft.name.trim();
    if (!name) return fail("Enter a project name.");
    const inputs = {} as ProjectInputs;
    for (const definition of library.projectInputs) {
      const field = qs<HTMLInputElement>(`[data-planning-new-input="${definition.key}"]`, panel);
      const parsed = parseNumber(field?.value ?? "", { integer: definition.integer });
      if (!parsed.ok || parsed.value === null) return fail(definition.integer ? "Enter a whole number of 0 or more." : "Enter a number of 0 or more.");
      inputs[definition.key] = parsed.value;
    }
    const created = createProject(library, { id: deps.newId(), name, now: deps.now(), templateId: draft.templateId, alternativeId: deps.newId() });
    draft.error = "";
    setCurrent({ ...created, inputs }, { kind: "saving" });
    dirty = true;
    void store.setLastProjectId(created.id).catch(() => undefined);
    track(saveNow());
  }

  async function deleteCurrentProject(): Promise<void> {
    if (!project) return;
    if (!window.confirm(`Delete planning project ${project.name}? This cannot be undone.`)) return;
    const id = project.id;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    await (inFlight ?? Promise.resolve());
    dirty = false;
    project = null;
    await store.deleteProject(id);
    projects = await store.listProjects();
    if (projects.length > 0) {
      const next = await store.getProject(projects[0].id);
      if (next) {
        setCurrent(next);
        return;
      }
    }
    void store.setLastProjectId(null).catch(() => undefined);
    draft = defaultDraft(library.templates[0]?.id ?? null);
    phase = "new";
    renderRoot();
  }

  async function reloadSaved(): Promise<void> {
    if (!project) return;
    const id = project.id;
    const latest = conflict ?? (await store.getProject(id));
    if (!latest) {
      setNotice({ kind: "error", text: "This planning project no longer exists in storage." });
      return;
    }
    setNotice(storageBlocked ? { kind: "info", text: STORAGE_BLOCKED } : null);
    setCurrent(latest);
  }

  async function importFile(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    if (!file) return;
    closeMenus();
    try {
      const parsed = parseShareFile(await readFileText(file), library);
      try {
        input.value = "";
      } catch {
        // Some environments do not allow clearing a file input.
      }
      if (!parsed.ok) {
        setNotice({ kind: "error", text: `Could not import ${file.name}: ${parsed.issues[0]?.message ?? "The file could not be read."}` });
        return;
      }
      await saveNow();
      const copy = importProjectCopy(parsed.project, { newId: deps.newId, now: deps.now() });
      const saved = await store.saveProject(copy, 0, deps.now());
      if (!saved.ok) throw new Error("A project with this id already exists.");
      projects = await store.listProjects();
      const dropped = parsed.issues.filter((i) => i.code === "unknown_element").length;
      const adjusted = parsed.issues.length - dropped;
      let text = `Imported ${saved.project.name} as a new planning project.`;
      if (dropped > 0) text = `Imported ${saved.project.name}. ${dropped} elements in the file are not in this library and were left out.`;
      if (adjusted > 0) text += ` ${adjusted} other values in the file were adjusted.`;
      notice = { kind: "info", text };
      setCurrent(saved.project);
    } catch (error) {
      setNotice({ kind: "error", text: `Could not import ${file.name}: ${messageOf(error)}` });
    }
  }

  function exportJson(): void {
    if (!project) return;
    closeMenus();
    const filename = `${project.name.replace(/[\\/:*?"<>|]/g, "_").trim() || "planning"}.planning.json`;
    download(filename, buildShareFile(project, library, deps.now()), "application/json");
  }

  function exportCsv(): void {
    if (!project) return;
    closeMenus();
    download(planningCsvFilename(project), buildPlanningCsv(library, project, deps.now()), "text/csv;charset=utf-8");
  }

  // ---------- Print ----------

  let cleanupPrint: (() => void) | null = null;

  /** Removes the print markup and the body class. Safe to call more than once. */
  function removePrintMarkup(): void {
    if (cleanupPrint) cleanupPrint();
    cleanupPrint = null;
    for (const el of document.body.querySelectorAll(".planning-print")) el.remove();
    document.body.classList.remove("planning-printing");
  }

  function printSummary(): void {
    if (!project) return;
    closeMenus();
    removePrintMarkup();
    const results = project.alternatives.map((alt) => calculateAlternative(library, project!, alt.id));
    document.body.insertAdjacentHTML("beforeend", renderPrintSummary(library, project, results, deps.now()));
    document.body.classList.add("planning-printing");
    const onAfterPrint = () => removePrintMarkup();
    window.addEventListener("afterprint", onAfterPrint, { once: true });
    cleanupPrint = () => window.removeEventListener("afterprint", onAfterPrint);
    print();
  }

  async function createEngineerProject(): Promise<void> {
    if (!project || !deps.createEngineerProject) return;
    try {
      await saveNow();
      await deps.createEngineerProject(library, project, selectedId());
    } catch (error) {
      setNotice({ kind: "error", text: `Could not create the engineer Project: ${messageOf(error)}` });
    }
  }

  function exportFrom(kind: string): void {
    if (kind === "print") printSummary();
    else if (kind === "csv") exportCsv();
    else exportJson();
  }

  // ---------- Field commits ----------

  function commitToggle(t: HTMLInputElement): void {
    const id = t.dataset.elementToggle ?? "";
    const next = setElementEnabled(project!, selectedId(), id, t.type === "radio" ? true : t.checked, library);
    apply(next);
  }

  function commitAmount(t: HTMLInputElement): void {
    const id = t.dataset.elementAmount ?? "";
    const element = elementById(id);
    if (!element) return;
    const isOther = element.group === "other";
    const error = errorFor(t);
    const parsed = parseDollar(t.value);
    if (!parsed.ok) {
      markInvalid(t, error, isOther ? "Enter a dollar amount of 0 or more, or leave it blank." : "Enter a dollar amount of 0 or more, or leave it blank to use the calculated amount.");
      return;
    }
    clearInvalid(t, error);
    let next = project!;
    if (!isOther && parsed.value !== null && !selectedAlt()?.selections[id]?.enabled) next = setElementEnabled(next, selectedId(), id, true, library);
    next = setElementOverride(next, selectedId(), id, parsed.value);
    apply(next, { committed: t });
  }

  function commitElementInput(t: HTMLInputElement | HTMLSelectElement): void {
    const id = t.dataset.elementInput ?? "";
    const key = t.dataset.inputKey ?? "";
    const definition = elementById(id)?.inputs.find((i) => i.key === key);
    if (!definition) return;
    const error = errorFor(t);
    let next: PlanningProject;
    if (t instanceof HTMLSelectElement) {
      const option = definition.options?.find((o) => String(o) === t.value);
      if (option === undefined) return;
      next = setElementInput(project!, selectedId(), id, key, option);
    } else {
      const parsed = parseNumber(t.value, { integer: definition.integer });
      if (!parsed.ok) {
        markInvalid(t, error, definition.integer ? "Enter a whole number of 0 or more." : "Enter a number of 0 or more.");
        return;
      }
      next = parsed.value === null ? resetElementInput(project!, selectedId(), id, key) : setElementInput(project!, selectedId(), id, key, parsed.value);
    }
    clearInvalid(t, error);
    apply(next, { committed: t });
  }

  function commitProjectInput(t: HTMLInputElement): void {
    const key = t.dataset.planningProjectInput as ProjectInputKey;
    const definition = library.projectInputs.find((p) => p.key === key);
    if (!definition) return;
    const error = errorFor(t);
    const parsed = parseNumber(t.value, { integer: definition.integer });
    if (!parsed.ok || parsed.value === null) {
      markInvalid(t, error, definition.integer ? "Enter a whole number of 0 or more." : "Enter a number of 0 or more.");
      return;
    }
    clearInvalid(t, error);
    setValue(t, formatPlain(parsed.value));
    apply(setProjectInput(project!, key, parsed.value), { committed: t });
  }

  function commitBudget(t: HTMLInputElement): void {
    const error = errorFor(t);
    const parsed = parseDollar(t.value);
    if (!parsed.ok) {
      markInvalid(t, error, "Enter a dollar amount, or leave it blank for no budget.");
      return;
    }
    clearInvalid(t, error);
    setValue(t, parsed.value === null ? "" : formatEntered(parsed.value));
    apply(setBudget(project!, parsed.value), { rows: false });
  }

  function commitRate(t: HTMLInputElement): void {
    const key = t.dataset.planningRate === "design" ? "design" : "constructionEngineering";
    const error = errorFor(t);
    const parsed = parsePercent(t.value);
    if (!parsed.ok) {
      markInvalid(t, error, "Enter a percent from 0 to 100.");
      return;
    }
    clearInvalid(t, error);
    setValue(t, percentNumber(parsed.value));
    apply(setEngineering(project!, { [key]: parsed.value }), { rows: false });
  }

  function commitAltName(t: HTMLInputElement): void {
    const error = errorFor(t);
    const name = t.value.trim();
    if (!name) {
      markInvalid(t, error, "Enter a name for this alternative.");
      return;
    }
    clearInvalid(t, error);
    setValue(t, name);
    apply(renameAlternative(project!, selectedId(), name), { rows: false });
  }

  function commitAltDescription(t: HTMLTextAreaElement): void {
    const alt = selectedAlt();
    if (alt) apply(renameAlternative(project!, alt.id, alt.name, t.value), { rows: false });
  }

  /** Commits a field by its data-* role. Returns true when the target is a Planning field. */
  function commitField(t: HTMLElement): boolean {
    if (phase !== "ready" || !project) return false;
    const isText = t instanceof HTMLInputElement && t.type === "text";
    // A change event that follows an Enter commit carries the text already committed.
    if (isText && baselines.get(t) === (t as HTMLInputElement).value && !t.hasAttribute("aria-invalid")) {
      return Boolean(t.dataset.elementAmount || t.dataset.elementInput || t.dataset.planningProjectInput || t.dataset.planningBudget !== undefined || t.dataset.planningRate || t.dataset.planningAltName !== undefined);
    }
    let handled = true;
    if (t instanceof HTMLInputElement && t.dataset.elementToggle) commitToggle(t);
    else if (t instanceof HTMLInputElement && t.dataset.elementAmount) commitAmount(t);
    else if ((t instanceof HTMLInputElement || t instanceof HTMLSelectElement) && t.dataset.elementInput) commitElementInput(t);
    else if (t instanceof HTMLInputElement && t.dataset.planningProjectInput) commitProjectInput(t);
    else if (t instanceof HTMLInputElement && t.dataset.planningBudget !== undefined) commitBudget(t);
    else if (t instanceof HTMLInputElement && t.dataset.planningRate) commitRate(t);
    else if (t instanceof HTMLInputElement && t.dataset.planningAltName !== undefined) commitAltName(t);
    else if (t instanceof HTMLTextAreaElement && t.dataset.planningAltDescription !== undefined) commitAltDescription(t);
    else if (t instanceof HTMLSelectElement && t.dataset.planningStage !== undefined) apply(setStage(project, t.value), { rows: false });
    else handled = false;
    if (handled && isText && !t.hasAttribute("aria-invalid")) baselines.set(t, (t as HTMLInputElement).value);
    return handled;
  }

  // ---------- Alternatives ----------

  function nextAlternativeName(): string {
    const used = new Set(project!.alternatives.map((a) => a.name));
    for (let i = 0; i < 26; i += 1) {
      const name = `Alternative ${String.fromCharCode(65 + i)}`;
      if (!used.has(name)) return name;
    }
    return `Alternative ${project!.alternatives.length + 1}`;
  }

  function openAddAlternative(): void {
    addAltOpen = true;
    addAltName = nextAlternativeName();
    const form = qs("[data-planning-add-alt-form]");
    if (!form) return;
    form.hidden = false;
    const name = qs<HTMLInputElement>("[data-planning-add-alt-name]", form);
    if (name) name.value = addAltName;
    const template = qs<HTMLSelectElement>("[data-planning-add-alt-template]", form);
    if (template) template.value = project!.templateId ?? "";
    qs("[data-planning-add-alt]")?.setAttribute("aria-expanded", "true");
    template?.focus({ preventScroll: true });
  }

  function closeAddAlternative(refocus: boolean): void {
    addAltOpen = false;
    const form = qs("[data-planning-add-alt-form]");
    if (form) form.hidden = true;
    const trigger = qs("[data-planning-add-alt]");
    trigger?.setAttribute("aria-expanded", "false");
    if (refocus) trigger?.focus({ preventScroll: true });
  }

  function confirmAddAlternative(): void {
    const form = qs("[data-planning-add-alt-form]");
    const nameField = qs<HTMLInputElement>("[data-planning-add-alt-name]", form);
    const templateField = qs<HTMLSelectElement>("[data-planning-add-alt-template]", form);
    const name = nameField?.value.trim() ?? "";
    if (!nameField || !name) {
      if (nameField) markInvalid(nameField, errorFor(nameField), "Enter a name for this alternative.");
      return;
    }
    const id = deps.newId();
    const next = selectAlternative(addAlternative(project!, library, templateField?.value || null, { id, name }), id);
    project = next;
    addAltOpen = false;
    recalculate();
    renderRoot();
    focusSelector(`[data-planning-alt="${id}"]`);
    scheduleSave();
  }

  function duplicateSelected(): void {
    const alt = selectedAlt();
    if (!alt) return;
    const id = deps.newId();
    project = selectAlternative(duplicateAlternative(project!, alt.id, { id, name: `${alt.name} copy` }), id);
    recalculate();
    renderRoot();
    focusSelector(`[data-planning-alt="${id}"]`);
    scheduleSave();
  }

  function deleteSelected(): void {
    const alt = selectedAlt();
    if (!alt || project!.alternatives.length <= 1) return;
    if (!window.confirm(`Delete ${alt.name}? This cannot be undone.`)) return;
    project = removeAlternative(project!, alt.id);
    recalculate();
    renderRoot();
    focusSelector(`[data-planning-alt="${project.selectedAlternativeId}"]`);
    scheduleSave();
  }

  // ---------- Rename ----------

  function showTitle(): void {
    const title = qs("[data-planning-title]");
    if (title && project) title.innerHTML = renderTitle(project, renaming);
  }

  function startRename(): void {
    renaming = true;
    closeMenus();
    showTitle();
    const input = qs<HTMLInputElement>("[data-planning-rename-input]");
    input?.focus({ preventScroll: true });
    input?.select();
  }

  function finishRename(save: boolean): void {
    if (!project) return;
    if (save) {
      const input = qs<HTMLInputElement>("[data-planning-rename-input]");
      const name = input?.value.trim() ?? "";
      if (!name) {
        if (input) markInvalid(input, errorFor(input), "Enter a project name.");
        input?.focus({ preventScroll: true });
        return;
      }
      project = { ...project, name };
      patchProjectMenu();
      scheduleSave();
    }
    renaming = false;
    showTitle();
  }

  // ---------- Delegated events ----------

  const TEXT_FIELD_SELECTOR = "[data-element-amount], [data-element-input], [data-planning-project-input], [data-planning-budget], [data-planning-rate], [data-planning-alt-name]";

  function onChange(event: Event): void {
    const t = event.target as HTMLElement | null;
    if (!t) return;
    if (t.matches("[data-planning-import-input]")) {
      if (library && store) track(importFile(t as HTMLInputElement));
      return;
    }
    if (phase === "new") {
      if (t.matches('input[name="planning-template"]')) {
        readDraft();
        const defaults = defaultDraft(draft.templateId);
        draft.inputs = defaults.inputs;
        for (const field of qsa<HTMLInputElement>("[data-planning-new-input]")) {
          field.value = formatPlain(draft.inputs[field.dataset.planningNewInput as ProjectInputKey]);
        }
      }
      return;
    }
    commitField(t);
  }

  function onFocusIn(event: FocusEvent): void {
    const t = event.target;
    if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) baselines.set(t, t.value);
  }

  function onKeydown(event: KeyboardEvent): void {
    const t = event.target as HTMLElement | null;
    if (!t) return;
    if (event.key === "Enter" && t instanceof HTMLInputElement && t.type === "text") {
      if (t.matches(TEXT_FIELD_SELECTOR)) {
        event.preventDefault();
        commitField(t);
      } else if (t.matches("[data-planning-rename-input]")) {
        event.preventDefault();
        finishRename(true);
      } else if (t.matches("[data-planning-add-alt-name]")) {
        event.preventDefault();
        confirmAddAlternative();
      } else if (t.matches("[data-planning-new-name], [data-planning-new-input]")) {
        event.preventDefault();
        createFromPanel();
      }
      return;
    }
    if (event.key !== "Escape") return;
    if ((t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement) && t.matches(`${TEXT_FIELD_SELECTOR}, [data-planning-alt-description]`)) {
      const before = baselines.get(t);
      if (before !== undefined && t.value !== before) {
        t.value = before;
        clearInvalid(t, errorFor(t));
        return;
      }
    }
    if (t.matches("[data-planning-rename-input]")) {
      finishRename(false);
      focusSelector("[data-planning-rename-project]");
      return;
    }
    const menu = qsa<HTMLDetailsElement>("details[data-planning-menu]").find((m) => m.open);
    if (menu) {
      menu.open = false;
      menu.querySelector("summary")?.focus({ preventScroll: true });
      return;
    }
    if (addAltOpen) closeAddAlternative(true);
  }

  function onToggle(event: Event): void {
    const t = event.target as HTMLElement | null;
    if (!t || !(t instanceof HTMLDetailsElement)) return;
    const key = t.dataset.elementDetails ?? (t.dataset.elementAdvanced ? `adv:${t.dataset.elementAdvanced}` : null);
    if (!key) return;
    if (t.open) openDetails.add(key);
    else openDetails.delete(key);
  }

  function onClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target) return;
    const hit = (selector: string): HTMLElement | null => target.closest<HTMLElement>(selector);
    let el: HTMLElement | null;

    if ((el = hit("[data-planning-import]"))) {
      closeMenus();
      qs<HTMLInputElement>("[data-planning-import-input]")?.click();
      return;
    }
    if ((el = hit("[data-planning-create]"))) return createFromPanel();
    if ((el = hit("[data-planning-new-cancel]"))) {
      phase = "ready";
      renderRoot();
      return;
    }
    if (phase !== "ready") return;

    if ((el = hit("[data-element-reset]"))) {
      const id = el.dataset.elementReset ?? "";
      apply(setElementOverride(project!, selectedId(), id, null));
      focusSelector(`[data-element-amount="${id}"]`);
    } else if ((el = hit("[data-element-input-reset]"))) {
      const id = el.dataset.elementInputReset ?? "";
      const key = el.dataset.inputKey ?? "";
      apply(resetElementInput(project!, selectedId(), id, key));
      focusSelector(`[data-element-input="${id}"][data-input-key="${key}"]`);
    } else if ((el = hit("[data-planning-alt]"))) {
      const id = el.dataset.planningAlt ?? "";
      if (id === selectedId()) return;
      project = selectAlternative(project!, id);
      addAltOpen = false;
      recalculate();
      renderRoot();
      focusSelector(`[data-planning-alt="${id}"]`);
      scheduleSave();
    } else if ((el = hit("[data-planning-add-alt-confirm]"))) confirmAddAlternative();
    else if ((el = hit("[data-planning-add-alt-cancel]"))) closeAddAlternative(true);
    else if ((el = hit("[data-planning-add-alt]"))) {
      if (addAltOpen) closeAddAlternative(false);
      else openAddAlternative();
    } else if ((el = hit("[data-planning-duplicate-alt]"))) duplicateSelected();
    else if ((el = hit("[data-planning-delete-alt]"))) deleteSelected();
    else if ((el = hit("[data-planning-open-project]"))) {
      closeMenus();
      track(openProject(el.dataset.planningOpenProject ?? ""));
    } else if ((el = hit("[data-planning-new-project]"))) {
      closeMenus();
      showNewPanel();
    } else if ((el = hit("[data-planning-rename-project]"))) startRename();
    else if ((el = hit("[data-planning-rename-save]"))) finishRename(true);
    else if ((el = hit("[data-planning-rename-cancel]"))) finishRename(false);
    else if ((el = hit("[data-planning-delete-project]"))) {
      closeMenus();
      track(deleteCurrentProject());
    } else if ((el = hit("[data-planning-export]"))) exportFrom(el.dataset.planningExport ?? "");
    else if ((el = hit("[data-planning-reload]"))) track(reloadSaved());
    else if ((el = hit("[data-planning-create-project]"))) track(createEngineerProject());
  }

  function onVisibility(): void {
    if (document.visibilityState === "hidden") void flush();
  }

  // ---------- Public API ----------

  function mount(next: HTMLElement): void {
    unmount();
    container = next;
    next.addEventListener("change", onChange);
    next.addEventListener("click", onClick);
    next.addEventListener("keydown", onKeydown);
    next.addEventListener("focusin", onFocusIn);
    next.addEventListener("toggle", onToggle, true);
    if (!documentListening) {
      documentListening = true;
      document.addEventListener("visibilitychange", onVisibility);
    }
    if (phase === "idle") {
      phase = "loading";
      renderRoot();
      initPromise = track(initialize());
    } else {
      renderRoot();
    }
  }

  function unmount(): void {
    if (!container) return;
    container.removeEventListener("change", onChange);
    container.removeEventListener("click", onClick);
    container.removeEventListener("keydown", onKeydown);
    container.removeEventListener("focusin", onFocusIn);
    container.removeEventListener("toggle", onToggle, true);
    container = null;
    removePrintMarkup();
    if (dirty) void track(saveNow());
  }

  async function flush(): Promise<void> {
    if (initPromise) await initPromise;
    while (busy.size > 0) await Promise.allSettled([...busy]);
    await saveNow();
  }

  return { mount, unmount, flush };
}
