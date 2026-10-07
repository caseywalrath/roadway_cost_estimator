import type { AppData } from "../../data/schema";
import { COLORADO_PILOT_PACKAGES } from "../../planning/recipes/coloradoPilot";
import { NEBRASKA_PILOT_PACKAGES } from "../../planning/recipes/nebraskaPilot";
import { resolveNebraskaAnnualRate } from "../../planning/rates/nebraskaRates";
import { buildColoradoContractRateSnapshot } from "../../planning/rates/coloradoRates";
import { calculateScenarioCosts } from "../../planning/costEngine";
import { comparePlanningScenarios } from "../../planning/compareScenarios";
import { buildPlanningBackup, importPlanningBackup } from "../../planning/planningBackup";
import { buildPlanningCsv } from "../../planning/planningCsv";
import { addPlanningScenario, createPackageInstance, createPlanningScenario, createPlanningWorkspace, duplicatePlanningScenario, editPlanningScenario, getScenarioReviewStatus, recordScenarioReview, replacePlanningScenario, setActivePlanningScenario } from "../../planning/planningWorkspace";
import type { AllowanceDefinition, CustomComponent, DuplicateScenarioIds, PackageKind, PlanningIssue, PlanningScenario, PlanningState, PlanningUnit, PlanningWorkspace, ScenarioEdit } from "../../planning/types";
import { renderPlanningWorkspace, type PlanningViewModel } from "./renderPlanningWorkspace";
import { PlanningEditCoordinator } from "../../planning/storage/planningEditCoordinator";

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const reason = "Planner-adjusted provisional assumption";
const file = (name: string, content: string, type: string) => {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
const issueMessage = (issues: PlanningIssue[]) => issues.map((entry) => entry.message).join(" ");
const numeric = (value: string): number | null => value.trim() === "" ? null : Number(value);

export interface PlanningPersistence {
  isPersistent: boolean;
  listWorkspaces(state?: PlanningState): Promise<PlanningWorkspace[]>;
  getWorkspace(id: string): Promise<PlanningWorkspace | null>;
  createWorkspace(workspace: PlanningWorkspace): Promise<PlanningWorkspace>;
  saveWorkspace(workspace: PlanningWorkspace, expectedRevision: number, reason?: string): Promise<PlanningWorkspace>;
  getActiveWorkspaceId(state: PlanningState): Promise<string | null>;
  setActiveWorkspaceId(state: PlanningState, id: string | null): Promise<void>;
  recordBackup(id: string, revision: number): Promise<PlanningWorkspace>;
  close(): void;
}

/** A controller survives parent shell rerenders and owns the Planning draft. */
export function createPlanningController(data: AppData, injected?: PlanningPersistence) {
  const state = data.stateConfig.code.toUpperCase();
  let host: HTMLElement | null = null;
  let repository: PlanningPersistence | null = injected ?? null;
  let workspace: PlanningWorkspace | null = null;
  let savedRevision = 0;
  let dirty = false;
  let busy = false;
  let closed = false;
  let readOnly = false;
  let message = "";
  let workspaces: PlanningWorkspace[] = [];
  let compareId = "";
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let operation: Promise<unknown> = Promise.resolve();
  let coordinator: PlanningEditCoordinator | null = null;
  let pendingInput: HTMLElement | null = null;
  let initialization: Promise<void> | null = null;
  const invalidInputs = new Map<string, string>();
  const inputKey = (target: HTMLElement) => ["field", "instanceId", "role", "key", "id"].map((name) => target.dataset[name] ?? "").join("|");
  const pilot = state === "NE" || state === "CO";
  const planningState = state as PlanningState;
  const recipes = state === "NE" ? NEBRASKA_PILOT_PACKAGES : COLORADO_PILOT_PACKAGES;
  const selected = () => workspace?.scenarios.find((scenario) => scenario.scenarioId === workspace?.activeScenarioId) ?? null;
  const queue = (fn: () => Promise<void> | void) => { operation = operation.then(fn).catch((error) => { message = String(error); render(); }); return operation; };

  async function initialize() {
    if (!pilot || closed) return;
    try {
      if (!repository) {
        const storage = await import("../../planning/storage/planningRepository");
        const opened = await storage.openPlanningRepository();
        if (closed) { opened.repository.close(); return; }
        repository = opened.repository;
        if (opened.warning) message = opened.warning;
      }
      if (repository.isPersistent) {
        coordinator = new PlanningEditCoordinator();
        coordinator.setLostOwnershipHandler(() => { readOnly = true; message = "Another tab took over this Planning workspace. Export a recovery copy if you have unsaved edits."; render(); });
        coordinator.setOwnershipAvailableHandler(() => { message = "This workspace is available for editing again. Select Take over to resume."; render(); });
      }
      workspaces = await repository.listWorkspaces(planningState);
      const activeId = await repository.getActiveWorkspaceId(planningState);
      if (closed) return;
      workspace = workspaces.find((entry) => entry.workspaceId === activeId) ?? workspaces[0] ?? null;
      savedRevision = workspace?.revision ?? 0;
      if (workspace && coordinator) readOnly = !(await coordinator.claim(workspace.workspaceId));
      render();
    } catch (error) { message = `Planning storage is unavailable: ${String(error)}`; render(); }
  }

  function render() {
    if (!host || closed) return;
    const active = host.contains(document.activeElement) ? document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement : null;
    const identity = active ? { ...active.dataset } : null;
    const parentIdentity = active?.closest<HTMLElement>(".planning-rate-controls")?.dataset;
    const caret = active && "selectionStart" in active ? { start: active.selectionStart, end: active.selectionEnd } : null;
    const uncommitted = active && pendingInput === active ? active.value : null;
    const scenario = selected();
    const cost = scenario ? calculateScenarioCosts(scenario) : null;
    const other = workspace?.scenarios.find((entry) => entry.scenarioId === compareId) ?? null;
    const comparison = scenario && other && other.scenarioId !== scenario.scenarioId ? comparePlanningScenarios(scenario, other) : null;
    const view: PlanningViewModel = { state, workspace, workspaces, scenario, cost, comparison: comparison?.ok ? comparison.value : null, compareId, recipes, message, dirty, busy, readOnly, persistent: repository?.isPersistent ?? false };
    renderPlanningWorkspace(host, view);
    host.querySelectorAll<HTMLInputElement>("[data-field]").forEach((input) => {
      const draft = invalidInputs.get(inputKey(input));
      if (draft !== undefined) { input.value = draft; input.setAttribute("aria-invalid", "true"); }
    });
    if (identity?.field || identity?.rate) {
      const next = [...host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")].find((entry) => {
        if (identity.field !== entry.dataset.field || identity.rate !== entry.dataset.rate) return false;
        for (const key of ["instanceId", "role", "key", "kind", "id"] as const) if (identity[key] !== entry.dataset[key]) return false;
        const parent = entry.closest<HTMLElement>(".planning-rate-controls")?.dataset;
        return parentIdentity?.rateInstance === parent?.rateInstance && parentIdentity?.rateRole === parent?.rateRole;
      });
      if (next) {
        if (uncommitted !== null) { next.value = uncommitted; pendingInput = next; }
        next.focus({ preventScroll: true });
        if (caret && next instanceof HTMLInputElement && next.type !== "number" && next.type !== "date") try { next.setSelectionRange(caret.start, caret.end); } catch { /* Some input types do not support selection. */ }
        if (caret && next instanceof HTMLTextAreaElement) next.setSelectionRange(caret.start, caret.end);
      }
    }
  }

  function setWorkspace(next: PlanningWorkspace) {
    workspace = next; dirty = true; message = "Unsaved changes"; render(); scheduleSave();
  }
  function updateScenario(next: PlanningScenario) {
    if (!workspace) return;
    const result = replacePlanningScenario(workspace, next, now());
    if (result.ok) { setWorkspace(result.value); if (result.issues.length) message = issueMessage(result.issues); }
    else { message = issueMessage(result.issues); render(); }
  }
  function edit(edit: ScenarioEdit) {
    const scenario = selected(); if (!scenario || readOnly) return;
    const result = editPlanningScenario(scenario, edit, now());
    if (result.ok) { updateScenario(result.value); if (result.issues.length) message = issueMessage(result.issues); }
    else { message = issueMessage(result.issues); render(); }
  }
  function scheduleSave() { if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(() => { void flushDraft(); }, 500); }
  async function save() {
    if (pendingInput && host?.contains(pendingInput)) { const input = pendingInput; pendingInput = null; onChange({ target: input } as unknown as Event); }
    if (!dirty || !workspace || !repository || readOnly || busy) return !dirty;
    const draft = workspace;
    busy = true;
    try {
      const saved = await repository.saveWorkspace(draft, savedRevision, "Planning edit");
      savedRevision = saved.revision;
      if (workspace === draft) { workspace = saved; dirty = false; message = repository.isPersistent ? "Saved locally" : "Saved in this tab only. Export recovery JSON."; }
      else { dirty = true; message = "New edits remain unsaved"; scheduleSave(); }
      workspaces = await repository.listWorkspaces(planningState);
      return true;
    } catch (error) { message = `Save failed. Export a JSON recovery copy. ${String(error)}`; return false; }
    finally { busy = false; render(); }
  }
  async function flushDraft() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (invalidInputs.size) { message = "Correct invalid numeric inputs before saving or switching workspaces."; render(); return false; }
    return save();
  }

  async function createWorkspaceAction(name: string) {
    if (!repository) return;
    const result = createPlanningWorkspace({ workspaceId: id(), state: planningState, name, now: now() });
    if (!result.ok) { message = issueMessage(result.issues); render(); return; }
    if (!(await flushDraft())) return;
    workspace = await repository.createWorkspace(result.value); savedRevision = workspace.revision; dirty = false;
    if (coordinator) readOnly = !(await coordinator.claim(workspace.workspaceId));
    workspaces = await repository.listWorkspaces(planningState);
    await repository.setActiveWorkspaceId(planningState, workspace.workspaceId); render();
  }
  async function switchWorkspace(workspaceId: string) {
    if (!repository || !(await flushDraft())) return;
    workspace = await repository.getWorkspace(workspaceId); savedRevision = workspace?.revision ?? 0; dirty = false;
    if (workspace && coordinator) readOnly = !(await coordinator.claim(workspace.workspaceId));
    await repository.setActiveWorkspaceId(planningState, workspaceId); render();
  }
  function createScenarioAction(name: string) {
    if (!workspace) return;
    const result = createPlanningScenario({ scenarioId: id(), state: planningState, name, now: now() });
    if (!result.ok) { message = issueMessage(result.issues); render(); return; }
    const added = addPlanningScenario(workspace, result.value, now());
    if (!added.ok) { message = issueMessage(added.issues); render(); return; }
    const active = setActivePlanningScenario(added.value, result.value.scenarioId, now());
    if (active.ok) setWorkspace(active.value);
  }
  function addPackage(kind: PackageKind) {
    const scenario = selected(); if (!scenario) return;
    if (kind === "sidewalk" && scenario.packages.some((entry) => entry.definition.kind === "sidewalk")) {
      message = "This scenario already has a sidewalk package. Edit its sides and width to change the scope."; render(); return;
    }
    if (kind !== "sidewalk" && scenario.packages.some((entry) => entry.definition.kind !== "sidewalk")) {
      message = "Remove the current base package before choosing another roadway or path package."; render(); return;
    }
    const definition = recipes.find((entry) => entry.kind === kind); if (!definition) return;
    const segmentId = scenario.segments[0]?.segmentId ?? id();
    if (!scenario.segments.length) {
      const segments = editPlanningScenario(scenario, { kind: "set_segments", segments: [{ segmentId, name: "Main segment" }] }, now());
      if (!segments.ok) { message = issueMessage(segments.issues); render(); return; }
      updateScenario(segments.value);
    }
    const current = selected(); if (!current) return;
    const instance = createPackageInstance({ instanceId: id(), segmentId, scopeId: kind === "sidewalk" ? `sidewalk-${id()}` : `base-${id()}`, definition });
    if (!instance.ok) { message = issueMessage(instance.issues); render(); return; }
    edit({ kind: "add_package", instance: instance.value });
    // Freeze exact current evidence; failures stay visibly unpriced.
    for (const component of definition.components) {
      if (!component.binding) continue;
      const request = { agencyItemId: component.binding.agencyItemId, unit: component.binding.unit, capturedAt: now() };
      const rate = planningState === "NE" ? resolveNebraskaAnnualRate(data, request) : buildColoradoContractRateSnapshot(data, request);
      if (rate.ok) edit({ kind: "reprice", instanceId: instance.value.instanceId, role: component.role, snapshot: rate.value });
    }
  }
  function duplicate() {
    const scenario = selected(); if (!workspace || !scenario) return;
    const map = (values: string[]) => Object.fromEntries(values.map((value) => [value, id()]));
    const ids: DuplicateScenarioIds = { scenarioId: id(), segmentIds: map(scenario.segments.map((x) => x.segmentId)), instanceIds: map(scenario.packages.map((x) => x.instanceId)), customComponentIds: map(scenario.customComponents.map((x) => x.componentId)), allowanceIds: map(scenario.allowances.map((x) => x.allowanceId)) };
    const copy = duplicatePlanningScenario(scenario, ids, `${scenario.name} copy`, now());
    if (!copy.ok) { message = issueMessage(copy.issues); render(); return; }
    const added = addPlanningScenario(workspace, copy.value, now());
    if (!added.ok) { message = issueMessage(added.issues); render(); return; }
    const active = setActivePlanningScenario(added.value, copy.value.scenarioId, now()); if (active.ok) setWorkspace(active.value);
  }

  function onChange(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const field = target.dataset.field; if (!field) return;
    const numericFields = new Set(["parameter", "quantity", "rate", "allowance-percent", "external-amount", "custom-quantity", "custom-unitRate"]);
    if (numericFields.has(field)) {
      const key = inputKey(target);
      if (target.value.trim() !== "" && !Number.isFinite(Number(target.value))) {
        invalidInputs.set(key, target.value);
        target.setAttribute("aria-invalid", "true");
        message = "Invalid number. Correct the highlighted input before saving.";
        const notice = host?.querySelector<HTMLElement>(".planning-message");
        if (notice) notice.textContent = message;
        return;
      }
      invalidInputs.delete(key);
      target.removeAttribute("aria-invalid");
    }
    const instanceId = target.dataset.instanceId ?? ""; const role = target.dataset.role ?? "";
    if (pendingInput === target) pendingInput = null;
    const scenario = selected();
    if (field === "workspace-select") { void queue(() => switchWorkspace(target.value)); return; }
    if (field === "scenario-select") { if (workspace) { const result = setActivePlanningScenario(workspace, target.value, now()); if (result.ok) setWorkspace(result.value); } return; }
    if (field === "compare-select") { compareId = target.value; render(); return; }
    if (!scenario) return;
    if (field === "name" || field === "location" || field === "notes") { edit({ kind: "metadata", [field]: target.value }); return; }
    if (field === "parameter" || field === "quantity" || field === "rate") {
      const key = target.dataset.key ?? "";
      const reasonInput = [...(host?.querySelectorAll<HTMLInputElement>("[data-field='override-reason']") ?? [])].find((entry) => entry.dataset.kind === field && entry.dataset.instanceId === instanceId && (field === "parameter" ? entry.dataset.key === key : entry.dataset.role === role));
      const override = { value: numeric(target.value), reason: reasonInput?.value || reason };
      edit(field === "parameter" ? { kind: "parameter", instanceId, key, override } : { kind: field, instanceId, role, override }); return;
    }
    if (field === "override-reason") {
      const kind = target.dataset.kind;
      const instance = scenario.packages.find((entry) => entry.instanceId === instanceId); if (!instance) return;
      if (kind === "parameter") { const key = target.dataset.key ?? ""; const previous = instance.parameterOverrides[key]; if (previous) edit({ kind: "parameter", instanceId, key, override: { ...previous, reason: target.value } }); }
      if (kind === "quantity" || kind === "rate") { const previous = kind === "quantity" ? instance.quantityOverrides[role] : instance.rateOverrides[role]; if (previous) edit({ kind, instanceId, role, override: { ...previous, reason: target.value } }); }
      return;
    }
    if (field === "exclude") {
      const checked = (target as HTMLInputElement).checked;
      const row = target.closest(".planning-edit-row");
      const explanation = row?.querySelector<HTMLInputElement>("[data-field='exclusion-reason']")?.value || "Excluded by planner";
      const effect = row?.querySelector<HTMLInputElement>("[data-field='exclusion-effect']")?.value || "Remove this component from planned scope";
      edit({ kind: "exclusion", instanceId, role, exclusion: checked ? { reason: explanation, sectionEffect: effect } : null }); return;
    }
    if (field === "exclusion-reason" || field === "exclusion-effect") {
      const instance = scenario.packages.find((entry) => entry.instanceId === instanceId); const previous = instance?.exclusions[role]; if (!previous) return;
      edit({ kind: "exclusion", instanceId, role, exclusion: { ...previous, [field === "exclusion-reason" ? "reason" : "sectionEffect"]: target.value } }); return;
    }
    if (field === "allowance-percent" || field === "allowance-enabled") {
      const allowance = scenario.allowances.find((entry) => entry.allowanceId === target.dataset.id); if (!allowance) return;
      const reasonInput = target.closest("tr")?.querySelector<HTMLInputElement>("[data-field='allowance-reason']");
      const updated: AllowanceDefinition = { ...allowance, percent: field === "allowance-percent" ? numeric(target.value) : allowance.percent, enabled: field === "allowance-enabled" ? (target as HTMLInputElement).checked : allowance.enabled, overrideReason: reasonInput?.value || reason };
      edit({ kind: "allowance", allowance: updated }); return;
    }
    if (field === "allowance-reason") { const allowance = scenario.allowances.find((entry) => entry.allowanceId === target.dataset.id); if (allowance && allowance.overrideReason !== null) edit({ kind: "allowance", allowance: { ...allowance, overrideReason: target.value } }); return; }
    if (field === "external-decision" || field === "external-amount") {
      const existing = scenario.externalScopes.find((entry) => entry.scopeId === target.dataset.id); if (!existing) return;
      const decision = field === "external-decision" ? target.value as typeof existing.decision : existing.decision;
      const reasonInput = target.closest(".planning-external")?.querySelector<HTMLInputElement>("[data-field='external-reason']");
      edit({ kind: "external_scope", scope: { ...existing, decision, amount: field === "external-amount" ? numeric(target.value) : decision === "manual" ? existing.amount : null, reason: decision === "unassessed" ? "" : reasonInput?.value || reason } }); return;
    }
    if (field === "external-reason") { const existing = scenario.externalScopes.find((entry) => entry.scopeId === target.dataset.id); if (existing && existing.decision !== "unassessed") edit({ kind: "external_scope", scope: { ...existing, reason: target.value } }); return; }
    if (field.startsWith("custom-")) {
      const existing = scenario.customComponents.find((entry) => entry.componentId === target.dataset.id); if (!existing) return;
      const property = field.slice(7);
      const updated = { ...existing, [property]: property === "quantity" || property === "unitRate" ? numeric(target.value) : target.value } as CustomComponent;
      edit({ kind: "set_custom", component: updated });
    }
  }

  async function onClick(event: Event) {
    const target = (event.target as Element).closest<HTMLElement>("[data-action]"); if (!target) return;
    const action = target.dataset.action;
    if (action === "create-workspace") { const name = prompt("Workspace name"); if (name) await queue(() => createWorkspaceAction(name)); }
    if (action === "create-scenario") { const name = prompt("Scenario name"); if (name) createScenarioAction(name); }
    if (action === "add-package") addPackage(target.dataset.kind as PackageKind);
    if (action === "duplicate") duplicate();
    if (action === "save") await flushDraft();
    if (action === "take-over" && workspace && coordinator) { coordinator.takeOver(workspace.workspaceId); readOnly = false; message = "Editing ownership taken in this tab."; render(); }
    if (action === "export-json" && workspace) {
      const exported = workspace;
      file(`${exported.name}.rce-planning.json`, JSON.stringify(buildPlanningBackup(exported, now()), null, 2), "application/json");
      if (!dirty && repository) {
        try { workspace = await repository.recordBackup(exported.workspaceId, savedRevision); render(); }
        catch { message = "Recovery file prepared, but its backup marker could not be saved."; render(); }
      }
    }
    if (action === "export-csv") { const scenario = selected(); if (scenario) file(`${scenario.name}.planning.csv`, buildPlanningCsv(scenario), "text/csv"); }
    if (action === "import-json") host?.querySelector<HTMLInputElement>("[data-field='import-file']")?.click();
    if (action === "add-custom") {
      const scenario = selected(); if (!scenario) return;
      const segmentId = scenario.segments[0]?.segmentId; if (!segmentId) { message = "Add a package before custom scope."; render(); return; }
      const component: CustomComponent = { componentId: id(), segmentId, scopeId: `custom-${id()}`, role: `custom_${id().slice(0, 8)}`, description: "Custom work", category: "construction", unit: "LS", quantity: null, unitRate: null, reason: "Planner-added scope", required: true, tags: [], exclusion: null };
      edit({ kind: "set_custom", component });
    }
    if (action === "remove-custom") { const componentId = target.dataset.id; if (componentId) edit({ kind: "remove_custom", componentId, reason: "Removed by planner" }); }
    if (action === "remove-package") { const instanceId = target.dataset.id; if (instanceId) edit({ kind: "remove_package", instanceId, reason: "Removed by planner" }); }
    if (action === "review") {
      const scenario = selected(); if (!scenario || !host) return;
      const reviewer = host.querySelector<HTMLInputElement>("[data-field='reviewer']")?.value ?? "";
      const date = host.querySelector<HTMLInputElement>("[data-field='review-date']")?.value ?? "";
      const notes = host.querySelector<HTMLTextAreaElement>("[data-field='review-notes']")?.value ?? "";
      const result = recordScenarioReview(scenario, { reviewer, date, notes }, now());
      if (result.ok) updateScenario(result.value); else { message = issueMessage(result.issues); render(); }
    }
    if (action === "refresh-rate") {
      const scenario = selected(); const instance = scenario?.packages.find((entry) => entry.instanceId === target.dataset.id); const component = instance?.definition.components.find((entry) => entry.role === target.dataset.role);
      if (!instance || !component?.binding) return;
      const controls = [...(host?.querySelectorAll<HTMLElement>(".planning-rate-controls") ?? [])].find((entry) => entry.dataset.rateInstance === instance.instanceId && entry.dataset.rateRole === component.role);
      const value = (key: string) => controls?.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-rate='${key}']`)?.value.trim() ?? "";
      const request = { agencyItemId: component.binding.agencyItemId, unit: component.binding.unit as PlanningUnit, capturedAt: now() };
      const result = planningState === "NE" ? resolveNebraskaAnnualRate(data, { ...request, reportSeries: value("series") === "july_june" ? "july_june" : "calendar_year", ...(value("period-start") ? { periodStart: value("period-start") } : {}), ...(value("period-end") ? { periodEnd: value("period-end") } : {}) }) : buildColoradoContractRateSnapshot(data, { ...request, ...(value("from") ? { from: value("from") } : {}), ...(value("to") ? { to: value("to") } : {}), districts: value("districts") ? value("districts").split(",").map((entry) => entry.trim()).filter(Boolean) : [], sourceIds: value("sources") ? value("sources").split(",").map((entry) => entry.trim()).filter(Boolean) : [] });
      if (result.ok) edit({ kind: "reprice", instanceId: instance.instanceId, role: component.role, snapshot: result.value });
      else { message = issueMessage(result.issues); render(); }
    }
  }

  async function onFile(event: Event) {
    const input = event.target as HTMLInputElement; if (input.dataset.field !== "import-file" || !input.files?.[0] || !repository) return;
    try {
      const json: unknown = JSON.parse(await input.files[0].text());
      const result = importPlanningBackup(json, now(), id());
      if (!result.ok) { message = issueMessage(result.issues); render(); return; }
      if (result.value.state !== planningState) { message = "This recovery file belongs to another state."; render(); return; }
      if (!(await flushDraft())) return;
      workspace = await repository.createWorkspace(result.value); savedRevision = workspace.revision; dirty = false;
      workspaces = await repository.listWorkspaces(planningState); await repository.setActiveWorkspaceId(planningState, workspace.workspaceId); message = "Recovery copy imported"; render();
    } catch (error) { message = `Import failed: ${String(error)}`; render(); }
    finally { input.value = ""; }
  }

  return {
    async mount(root: HTMLElement) {
      if (closed) return;
      if (host) { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); host.removeEventListener("change", onFile); host.removeEventListener("input", onInput); }
      host = root;
      host.addEventListener("change", onChange); host.addEventListener("click", onClick); host.addEventListener("change", onFile); host.addEventListener("input", onInput);
      render(); initialization ??= initialize(); await initialization;
    },
    async flush() {
      if (pendingInput && host?.contains(pendingInput)) { const input = pendingInput; pendingInput = null; onChange({ target: input } as unknown as Event); }
      await operation;
      return flushDraft();
    },
    close() {
      if (pendingInput && host?.contains(pendingInput)) { const input = pendingInput; pendingInput = null; onChange({ target: input } as unknown as Event); }
      closed = true; if (saveTimer) clearTimeout(saveTimer);
      if (host) { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); host.removeEventListener("change", onFile); host.removeEventListener("input", onInput); }
      void operation.then(() => flushDraft()).finally(() => { coordinator?.close(); repository?.close(); });
    },
  };

  function onInput(event: Event) { const target = event.target as HTMLElement; if (target.dataset.field && target.dataset.field !== "import-file") pendingInput = target; }
}
