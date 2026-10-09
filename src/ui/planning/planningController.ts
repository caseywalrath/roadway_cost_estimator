import type { AppData } from "../../data/schema";
import { COLORADO_PILOT_PACKAGES } from "../../planning/recipes/coloradoPilot";
import { NEBRASKA_PILOT_PACKAGES } from "../../planning/recipes/nebraskaPilot";
import { resolveNebraskaAnnualRate } from "../../planning/rates/nebraskaRates";
import { buildColoradoContractRateSnapshot } from "../../planning/rates/coloradoRates";
import { calculateScenarioCosts } from "../../planning/costEngine";
import { comparePlanningScenarios } from "../../planning/compareScenarios";
import { buildPlanningBackup, importPlanningBackup } from "../../planning/planningBackup";
import { buildPlanningEngineerCsv } from "../../planning/planningEngineerCsv";
import { buildPlannerEstimate } from "../../planning/plannerPresentation";
import { pilotManualRate, pilotManualReason } from "../../planning/recipes/pilotDefaults";
import { addPlanningScenario, createPackageInstance, createPlanningScenario, createPlanningWorkspace, duplicatePlanningScenario, editPlanningScenario, getScenarioReviewStatus, recordScenarioReview, replacePlanningScenario, setActivePlanningScenario } from "../../planning/planningWorkspace";
import type { AllowanceDefinition, CustomComponent, DuplicateScenarioIds, PackageInstance, PackageKind, PlanningIssue, PlanningScenario, PlanningState, PlanningUnit, PlanningWorkspace, ScenarioEdit } from "../../planning/types";
import { renderPlanningWorkspace, type PlanningViewModel } from "./renderPlanningWorkspace";
import { PlanningEditCoordinator } from "../../planning/storage/planningEditCoordinator";
import { createProjectFromAlternative } from "../../planning/projectHandoffService";
import { buildProjectHandoff } from "../../planning/projectHandoff";
import type { ProjectRepository } from "../../projects/projectRepository";
import type { UserProject } from "../../projects/projectWorkspace";

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
const isBaseKind = (kind: PackageKind) => kind === "resurfacing" || kind === "reconstruction" || kind === "path";
const latestInflationQuarter = (data: AppData): string | undefined => [...data.inflationIndexByPeriod.values()]
  .filter((row) => Number.isFinite(row.indexValue) && row.indexValue > 0)
  .sort((a, b) => b.periodYear - a.periodYear || b.periodQuarter - a.periodQuarter)[0]?.periodLabel;

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
export function createPlanningController(data: AppData, injected?: PlanningPersistence, handoff?: {
  projectRepository: ProjectRepository;
  onProjectCreated: (project: UserProject) => Promise<void>;
}) {
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
  let updatePreview: { instanceId: string; beforeAmount: number | null; afterAmount: number | null; beforeLabel: string; afterLabel: string } | null = null;
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
    const actionsOpen = host.querySelector<HTMLDetailsElement>(".planning-actions")?.open ?? false;
    const advancedOpen = host.querySelector<HTMLDetailsElement>(".planning-advanced")?.open ?? false;
    const packageDetailsOpen = new Set([...host.querySelectorAll<HTMLDetailsElement>("details[data-detail][open]")].map((entry) => entry.dataset.detail));
    const updateDetailsOpen = new Set([...host.querySelectorAll<HTMLDetailsElement>(".planning-package-update[open]")].map((entry) => entry.querySelector<HTMLElement>("[data-action='preview-package-update']")?.dataset.id));
    const newProjectName = host.querySelector<HTMLInputElement>("[data-field='new-project-name']")?.value ?? "";
    const handoffNameDraft = host.querySelector<HTMLInputElement>("[data-field='handoff-name']")?.value ?? "";
    const active = host.contains(document.activeElement) ? document.activeElement as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement : null;
    const identity = active ? { ...active.dataset } : null;
    const parentIdentity = active?.closest<HTMLElement>(".planning-rate-controls")?.dataset;
    const caret = active && "selectionStart" in active ? { start: active.selectionStart, end: active.selectionEnd } : null;
    const uncommitted = active && pendingInput === active ? active.value : null;
    const scenario = selected();
    const cost = scenario ? calculateScenarioCosts(scenario) : null;
    const other = workspace?.scenarios.find((entry) => entry.scenarioId === compareId) ?? null;
    const comparison = scenario && other && other.scenarioId !== scenario.scenarioId ? comparePlanningScenarios(scenario, other) : null;
    const handoffName = handoffNameDraft || `${scenario?.name ?? "Alternative"} — detailed estimate${scenario?.handoffIntent?.status === "complete" ? ` (${now().slice(0, 10)} snapshot)` : ""}`;
    const pending = scenario?.handoffIntent?.status === "pending" ? scenario.handoffIntent.payload : null;
    const handoffBuilt = scenario && workspace && !pending ? buildProjectHandoff({ workspace, scenario,
      catalog: data.agencyItems, token: "preview", projectId: "preview", projectName: handoffName, now: now() }) : null;
    const handoffPreview = pending ? {
      projectName: pending.name, pricedSubtotal: pending.planningOrigin?.planningPricedSubtotal ?? 0,
      unresolved: pending.planningOrigin?.decisions.filter((entry) => entry.status === "pending").map((entry) => entry.label) ?? [],
      excludedScope: pending.planningOrigin?.excludedScope ?? [], errors: [],
    } : handoffBuilt?.ok ? {
      projectName: handoffBuilt.project.name, pricedSubtotal: handoffBuilt.project.planningOrigin?.planningPricedSubtotal ?? 0,
      unresolved: handoffBuilt.project.planningOrigin?.decisions.filter((entry) => entry.status === "pending").map((entry) => entry.label) ?? [],
      excludedScope: handoffBuilt.project.planningOrigin?.excludedScope ?? [], errors: [],
    } : handoffBuilt ? { projectName: handoffName, pricedSubtotal: 0, unresolved: [], excludedScope: [], errors: handoffBuilt.errors } : null;
    const view: PlanningViewModel = { state, workspace, workspaces, scenario, cost, comparison: comparison?.ok ? comparison.value : null, compareId, recipes, message, dirty, busy, readOnly, persistent: repository?.isPersistent ?? false, handoffPersistent: Boolean(repository?.isPersistent && handoff?.projectRepository.isPersistent), updatePreview, handoffPreview };
    renderPlanningWorkspace(host, view);
    const actions = host.querySelector<HTMLDetailsElement>(".planning-actions"); if (actions) actions.open = actionsOpen;
    const advanced = host.querySelector<HTMLDetailsElement>(".planning-advanced"); if (advanced) advanced.open = advancedOpen;
    host.querySelectorAll<HTMLDetailsElement>("details[data-detail]").forEach((entry) => { if (packageDetailsOpen.has(entry.dataset.detail)) entry.open = true; });
    host.querySelectorAll<HTMLDetailsElement>(".planning-package-update").forEach((entry) => { if (updateDetailsOpen.has(entry.querySelector<HTMLElement>("[data-action='preview-package-update']")?.dataset.id)) entry.open = true; });
    const nameDraft = host.querySelector<HTMLInputElement>("[data-field='new-project-name']"); if (nameDraft) nameDraft.value = newProjectName;
    const handoffNameInput = host.querySelector<HTMLInputElement>("[data-field='handoff-name']"); if (handoffNameInput && handoffNameDraft) handoffNameInput.value = handoffNameDraft;
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
    workspace = next; updatePreview = null; dirty = true; message = "Unsaved changes"; render(); scheduleSave();
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
    await repository.setActiveWorkspaceId(planningState, workspace.workspaceId);
    createScenarioAction("Alternative A");
    render();
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
  function addPackage(kind: PackageKind, requestedLength?: number | null) {
    const scenario = selected(); if (!scenario) return;
    const lengthText = host?.querySelector<HTMLInputElement>("[data-field='planner-length']")?.value ?? "";
    const base = scenario.packages.find((entry) => isBaseKind(entry.definition.kind));
    if (!isBaseKind(kind) && scenario.packages.some((entry) => entry.definition.kind === kind)) {
      message = "This project element is already included. Edit its scope to change the quantity."; render(); return;
    }
    if (!isBaseKind(kind) && !base) { message = "Choose an improvement type before adding project elements."; render(); return; }
    if (kind === "curb_gutter" && base?.definition.kind !== "resurfacing") {
      message = "Curb and gutter can be added to asphalt resurfacing; concrete reconstruction already includes it."; render(); return;
    }
    if (isBaseKind(kind) && base) {
      message = "Remove the current base package before choosing another roadway or path package."; render(); return;
    }
    const definition = recipes.find((entry) => entry.kind === kind); if (!definition) return;
    const segmentId = kind === "curb_gutter" && base ? base.segmentId : scenario.segments[0]?.segmentId ?? id();
    if (!scenario.segments.length) {
      const segments = editPlanningScenario(scenario, { kind: "set_segments", segments: [{ segmentId, name: "Main segment" }] }, now());
      if (!segments.ok) { message = issueMessage(segments.issues); render(); return; }
      updateScenario(segments.value);
    }
    const current = selected(); if (!current) return;
    const scopeId = kind === "sidewalk" ? `sidewalk-${id()}` : kind === "curb_gutter" ? base!.scopeId : `base-${id()}`;
    const instance = createPackageInstance({ instanceId: id(), segmentId, scopeId, definition });
    if (!instance.ok) { message = issueMessage(instance.issues); render(); return; }
    edit({ kind: "add_package", instance: instance.value });
    const baseLength = selected()?.packages.find((entry) => isBaseKind(entry.definition.kind));
    const startingLength = !isBaseKind(kind) ? baseLength?.parameterOverrides.lengthMiles?.value ?? baseLength?.definition.parameters.find((parameter) => parameter.key === "lengthMiles")?.defaultValue : requestedLength ?? numeric(lengthText);
    if (typeof startingLength === "number" && Number.isFinite(startingLength) && startingLength > 0 && startingLength !== 0.5) {
      edit({ kind: "parameter", instanceId: instance.value.instanceId, key: "lengthMiles", override: { value: startingLength, reason: "Planner project length" } });
    }
    // Freeze exact current evidence; failures stay visibly unpriced.
    for (const component of definition.components) {
      if (!component.binding) continue;
      const request = { agencyItemId: component.binding.agencyItemId, unit: component.binding.unit, capturedAt: now() };
      const rate = planningState === "NE" ? resolveNebraskaAnnualRate(data, request) : buildColoradoContractRateSnapshot(data, { ...request, targetQuarter: latestInflationQuarter(data) });
      if (rate.ok) edit({ kind: "reprice", instanceId: instance.value.instanceId, role: component.role, snapshot: rate.value });
    }
    for (const component of definition.components) {
      const provisional = pilotManualRate(planningState, kind, component.role);
      if (provisional && provisional.unit === component.quantityRule.unit && provisional.packageVersion === definition.version) {
        edit({ kind: "rate", instanceId: instance.value.instanceId, role: component.role, override: { value: provisional.rate, reason: pilotManualReason(provisional) } });
      }
    }
  }
  function duplicate() {
    const scenario = selected(); if (!workspace || !scenario) return;
    const map = (values: string[]) => Object.fromEntries(values.map((value) => [value, id()]));
    const ids: DuplicateScenarioIds = { scenarioId: id(), segmentIds: map(scenario.segments.map((x) => x.segmentId)), instanceIds: map(scenario.packages.map((x) => x.instanceId)), customComponentIds: map(scenario.customComponents.map((x) => x.componentId)), allowanceIds: map(scenario.allowances.map((x) => x.allowanceId)) };
    const suffix = String.fromCharCode(65 + Math.min(workspace.scenarios.length, 25));
    const copy = duplicatePlanningScenario(scenario, ids, `Alternative ${suffix}`, now());
    if (!copy.ok) { message = issueMessage(copy.issues); render(); return; }
    const added = addPlanningScenario(workspace, copy.value, now());
    if (!added.ok) { message = issueMessage(added.issues); render(); return; }
    const active = setActivePlanningScenario(added.value, copy.value.scenarioId, now()); if (active.ok) setWorkspace(active.value);
  }

  function proposedPackageUpdate(scenario: PlanningScenario, instanceId: string): PlanningScenario | null {
    const previous = scenario.packages.find((entry) => entry.instanceId === instanceId);
    if (!previous) return null;
    const definition = recipes.find((entry) => entry.kind === previous.definition.kind);
    if (!definition || definition.version === previous.definition.version) return null;
    const created = createPackageInstance({ instanceId, segmentId: previous.segmentId, scopeId: previous.scopeId, definition });
    if (!created.ok) return null;
    const nextInstance: PackageInstance = created.value;
    const keys = new Set(definition.parameters.map((entry) => entry.key));
    for (const [key, override] of Object.entries(previous.parameterOverrides)) if (keys.has(key)) nextInstance.parameterOverrides[key] = override;
    for (const component of definition.components) {
      const old = previous.definition.components.find((entry) => entry.role === component.role);
      if (old?.quantityRule.unit === component.quantityRule.unit) {
        if (previous.quantityOverrides[component.role]) nextInstance.quantityOverrides[component.role] = previous.quantityOverrides[component.role];
        if (previous.rateOverrides[component.role]) nextInstance.rateOverrides[component.role] = previous.rateOverrides[component.role];
      }
      if (previous.exclusions[component.role]) nextInstance.exclusions[component.role] = previous.exclusions[component.role];
      const oldSnapshot = previous.rateSnapshots[component.role];
      if (component.binding && oldSnapshot?.agencyItemId === component.binding.agencyItemId && oldSnapshot.unit === component.binding.unit && !(planningState === "CO" && oldSnapshot.inflation.availability !== "available")) {
        nextInstance.rateSnapshots[component.role] = oldSnapshot;
      } else if (component.binding) {
        const request = { agencyItemId: component.binding.agencyItemId, unit: component.binding.unit, capturedAt: now() };
        const result = planningState === "NE" ? resolveNebraskaAnnualRate(data, request) : buildColoradoContractRateSnapshot(data, { ...request, targetQuarter: latestInflationQuarter(data) });
        if (result.ok) nextInstance.rateSnapshots[component.role] = result.value;
      }
      const manual = pilotManualRate(planningState, definition.kind, component.role);
      if (!nextInstance.rateOverrides[component.role] && manual?.packageVersion === definition.version && manual.unit === component.quantityRule.unit) {
        nextInstance.rateOverrides[component.role] = { value: manual.rate, reason: pilotManualReason(manual) };
      }
    }
    const next: PlanningScenario = JSON.parse(JSON.stringify(scenario));
    next.packages[next.packages.findIndex((entry) => entry.instanceId === instanceId)] = nextInstance;
    return next;
  }

  function onChange(event: Event) {
    const target = event.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const field = target.dataset.field; if (!field) return;
    const numericFields = new Set(["parameter", "quantity", "rate", "allowance-percent", "external-amount", "custom-quantity", "custom-unitRate", "planner-length", "planner-width", "sidewalk-width", "sidewalk-sides", "curb-sides", "ramp-count"]);
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
    if (field === "base-kind") {
      const kind = target.value as PackageKind;
      if (!isBaseKind(kind) || !recipes.some((entry) => entry.kind === kind)) return;
      const current = scenario.packages.find((entry) => isBaseKind(entry.definition.kind));
      if (current?.definition.kind === kind) return;
      const currentLength = current?.parameterOverrides.lengthMiles?.value ?? current?.definition.parameters.find((entry) => entry.key === "lengthMiles")?.defaultValue;
      if (kind !== "resurfacing") {
        const curb = scenario.packages.find((entry) => entry.definition.kind === "curb_gutter");
        if (curb) edit({ kind: "remove_package", instanceId: curb.instanceId, reason: "Planner changed improvement type" });
      }
      if (current) edit({ kind: "remove_package", instanceId: current.instanceId, reason: "Planner changed improvement type" });
      addPackage(kind, currentLength);
      return;
    }
    if (["planner-length", "planner-width", "sidewalk-width", "sidewalk-sides", "curb-sides", "ramp-count"].includes(field)) {
      const value = numeric(target.value);
      if (field === "planner-length") {
        for (const instance of scenario.packages) edit({ kind: "parameter", instanceId: instance.instanceId, key: "lengthMiles", override: { value, reason: "Planner project length" } });
      } else {
        const instance = scenario.packages.find((entry) => field === "planner-width" ? isBaseKind(entry.definition.kind) : field === "curb-sides" ? entry.definition.kind === "curb_gutter" : entry.definition.kind === "sidewalk");
        const key = field === "sidewalk-sides" || field === "curb-sides" ? "sides" : field === "ramp-count" ? "rampCount" : "widthFt";
        if (instance) edit({ kind: "parameter", instanceId: instance.instanceId, key, override: { value, reason: `Planner ${field.replace(/-/g, " ")}` } });
      }
      return;
    }
    if (field === "name" || field === "location" || field === "notes") { edit({ kind: "metadata", [field]: target.value }); return; }
    if (field === "parameter" || field === "quantity" || field === "rate") {
      const key = target.dataset.key ?? "";
      const reasonInput = [...(host?.querySelectorAll<HTMLInputElement>("[data-field='override-reason']") ?? [])].find((entry) => entry.dataset.kind === field && entry.dataset.instanceId === instanceId && (field === "parameter" ? entry.dataset.key === key : entry.dataset.role === role));
      const override = field !== "parameter" && target.value.trim() === "" ? null : { value: numeric(target.value), reason: reasonInput?.value || reason };
      edit(field === "parameter" ? { kind: "parameter", instanceId, key, override } : { kind: field, instanceId, role, override }); return;
    }
    if (field === "override-reason") {
      const kind = target.dataset.kind;
      const instance = scenario.packages.find((entry) => entry.instanceId === instanceId); if (!instance) return;
      if (kind === "parameter") { const key = target.dataset.key ?? ""; const previous = instance.parameterOverrides[key]; if (previous) edit({ kind: "parameter", instanceId, key, override: { ...previous, reason: target.value } }); }
      if (kind === "quantity" || kind === "rate") { const previous = kind === "quantity" ? instance.quantityOverrides[role] : instance.rateOverrides[role]; if (previous) edit({ kind, instanceId, role, override: { ...previous, reason: target.value } }); }
      return;
    }
    if (field === "exclude" || field === "component-scope") {
      const checked = field === "component-scope" ? target.value === "removed" : (target as HTMLInputElement).checked;
      const row = target.closest(".planning-edit-row");
      const explanation = row?.querySelector<HTMLInputElement>("[data-field='exclusion-reason']")?.value || "Excluded by planner";
      const effect = scenario.packages.find((entry) => entry.instanceId === instanceId)?.exclusions[role]?.sectionEffect || "Remove this component from planned scope";
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
      const reasonInput = [...(host?.querySelectorAll<HTMLInputElement>("[data-field='external-reason']") ?? [])].find((entry) => entry.dataset.id === existing.scopeId);
      const decisionReason = decision === "unassessed" ? "" : decision === "none_assumed" && existing.decision !== "none_assumed" ? "Planner expects no project impact" : reasonInput?.value || existing.reason || reason;
      edit({ kind: "external_scope", scope: { ...existing, decision, amount: field === "external-amount" ? numeric(target.value) : decision === "manual" ? existing.amount : null, reason: decisionReason } }); return;
    }
    if (field === "external-reason") { const existing = scenario.externalScopes.find((entry) => entry.scopeId === target.dataset.id); if (existing && existing.decision !== "unassessed") edit({ kind: "external_scope", scope: { ...existing, reason: target.value } }); return; }
    if (field === "custom-scope" || field === "custom-exclusion-reason") {
      const existing = scenario.customComponents.find((entry) => entry.componentId === target.dataset.id); if (!existing) return;
      const exclusion = field === "custom-exclusion-reason" ? existing.exclusion ? { ...existing.exclusion, reason: target.value } : null : target.value === "removed" ? existing.exclusion ?? { reason: "Removed from planned scope; record the scope explanation", sectionEffect: "Remove this custom work from planned scope" } : null;
      edit({ kind: "set_custom", component: { ...existing, exclusion } }); return;
    }
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
    if (action === "create-project-handoff" || action === "create-another-project-handoff") {
      const current = selected();
      if (!workspace || !current || !repository || !handoff || readOnly) return;
      if (!(await flushDraft())) return;
      const saved = selected(); if (!saved || !workspace) return;
      const name = host?.querySelector<HTMLInputElement>("[data-field='handoff-name']")?.value.trim()
        || `${saved.name} — detailed estimate${saved.handoffIntent?.status === "complete" ? ` (${now().slice(0, 10)} snapshot)` : ""}`;
      try {
        busy = true; render();
        const outcome = await createProjectFromAlternative({ planningRepository: repository,
          projectRepository: handoff.projectRepository, workspaceId: workspace.workspaceId,
          scenarioId: saved.scenarioId, expectedRevision: savedRevision, catalog: data.agencyItems,
          projectName: name, now: now(), token: id(), projectId: `project_${id()}`, readOnly,
          secondSnapshot: action === "create-another-project-handoff" });
        workspace = outcome.workspace; savedRevision = workspace.revision; dirty = false;
        workspaces = await repository.listWorkspaces(planningState);
        message = outcome.linkPending ? "Project created. Planning link is pending; retry handoff to finish linking." : "Project created from Planning alternative.";
        await handoff.onProjectCreated(outcome.project);
      } catch (error) { message = `Project handoff failed: ${String(error)}`; render(); }
      finally { busy = false; render(); }
      return;
    }
    if (action === "create-workspace") {
      const name = host?.querySelector<HTMLInputElement>("[data-field='new-project-name']")?.value.trim() ?? "";
      if (name) await queue(() => createWorkspaceAction(name));
      else { message = "Enter a planning project name."; render(); }
    }
    if (action === "create-scenario") createScenarioAction(`Alternative ${String.fromCharCode(65 + Math.min(workspace?.scenarios.length ?? 0, 25))}`);
    if (action === "add-package" && (target.dataset.kind === "sidewalk" || target.dataset.kind === "curb_gutter")) addPackage(target.dataset.kind);
    if (action === "duplicate") duplicate();
    if (action === "preview-package-update") {
      const scenario = selected(); const instanceId = target.dataset.id ?? "";
      const proposal = scenario ? proposedPackageUpdate(scenario, instanceId) : null;
      if (scenario && proposal) {
        const before = buildPlannerEstimate(scenario, calculateScenarioCosts(scenario));
        const after = buildPlannerEstimate(proposal, calculateScenarioCosts(proposal));
        updatePreview = { instanceId, beforeAmount: before.amount, afterAmount: after.amount, beforeLabel: before.amountLabel, afterLabel: after.amountLabel };
        render();
      }
    }
    if (action === "adopt-package-update") {
      const scenario = selected(); const instanceId = target.dataset.id ?? "";
      if (scenario && updatePreview?.instanceId === instanceId) {
        const proposal = proposedPackageUpdate(scenario, instanceId);
        if (proposal) updateScenario(proposal);
      }
    }
    if (action === "save") await flushDraft();
    if (action === "take-over" && workspace && coordinator) { coordinator.takeOver(workspace.workspaceId); readOnly = false; message = "Editing ownership taken in this tab."; render(); }
    if (action === "export-json" && workspace) {
      if (pendingInput && host?.contains(pendingInput)) { const input = pendingInput; pendingInput = null; onChange({ target: input } as unknown as Event); }
      if (invalidInputs.size) { message = "Correct invalid numeric inputs before exporting."; render(); return; }
      const exported = workspace;
      file(`${exported.name}.rce-planning.json`, JSON.stringify(buildPlanningBackup(exported, now()), null, 2), "application/json");
      if (!dirty && repository) {
        try { workspace = await repository.recordBackup(exported.workspaceId, savedRevision); render(); }
        catch { message = "Planning project JSON prepared, but its backup marker could not be saved."; render(); }
      }
    }
    if (action === "export-csv") {
      if (pendingInput && host?.contains(pendingInput)) { const input = pendingInput; pendingInput = null; onChange({ target: input } as unknown as Event); }
      if (invalidInputs.size) { message = "Correct invalid numeric inputs before exporting."; render(); return; }
      const scenario = selected();
      if (scenario) file(`${scenario.name}.planning.csv`, buildPlanningEngineerCsv(scenario, workspace?.name ?? scenario.name), "text/csv");
    }
    if (action === "import-json") host?.querySelector<HTMLInputElement>("[data-field='import-file']")?.click();
    if (action === "remove-custom") { const componentId = target.dataset.id; if (componentId) edit({ kind: "remove_custom", componentId, reason: "Removed by planner" }); }
    if (action === "remove-package") {
      const instanceId = target.dataset.id;
      const instance = selected()?.packages.find((entry) => entry.instanceId === instanceId);
      if (instance && isBaseKind(instance.definition.kind)) {
        const curb = selected()?.packages.find((entry) => entry.definition.kind === "curb_gutter");
        if (curb) edit({ kind: "remove_package", instanceId: curb.instanceId, reason: "Removed with roadway base package" });
      }
      if (instanceId) edit({ kind: "remove_package", instanceId, reason: "Removed by planner" });
    }
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
      const result = planningState === "NE" ? resolveNebraskaAnnualRate(data, { ...request, reportSeries: value("series") === "july_june" ? "july_june" : "calendar_year", ...(value("period-start") ? { periodStart: value("period-start") } : {}), ...(value("period-end") ? { periodEnd: value("period-end") } : {}) }) : buildColoradoContractRateSnapshot(data, { ...request, targetQuarter: latestInflationQuarter(data), ...(value("from") ? { from: value("from") } : {}), ...(value("to") ? { to: value("to") } : {}), districts: value("districts") ? value("districts").split(",").map((entry) => entry.trim()).filter(Boolean) : [], sourceIds: value("sources") ? value("sources").split(",").map((entry) => entry.trim()).filter(Boolean) : [] });
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
      if (result.value.state !== planningState) { message = "This Planning project belongs to another state."; render(); return; }
      if (!(await flushDraft())) return;
      workspace = await repository.createWorkspace(result.value); savedRevision = workspace.revision; dirty = false;
      workspaces = await repository.listWorkspaces(planningState); await repository.setActiveWorkspaceId(planningState, workspace.workspaceId); message = "Planning project copy imported"; render();
    } catch (error) { message = `Import failed: ${String(error)}`; render(); }
    finally { input.value = ""; }
  }

  async function openOrigin(event: Event) {
    const detail = (event as CustomEvent<{ workspaceId: string; scenarioId: string }>).detail;
    if (!repository && initialization) await initialization;
    if (!detail || !repository || !pilot) return;
    if (!(await flushDraft())) return;
    const origin = await repository.getWorkspace(detail.workspaceId);
    if (!origin || origin.state !== planningState || !origin.scenarios.some((entry) => entry.scenarioId === detail.scenarioId)) {
      message = "The originating Planning alternative is unavailable in this browser."; render(); return;
    }
    workspace = { ...origin, activeScenarioId: detail.scenarioId };
    savedRevision = origin.revision; dirty = false;
    if (coordinator) readOnly = !(await coordinator.claim(origin.workspaceId));
    await repository.setActiveWorkspaceId(planningState, origin.workspaceId);
    render();
  }

  return {
    async mount(root: HTMLElement) {
      if (closed) return;
      if (host) { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); host.removeEventListener("change", onFile); host.removeEventListener("input", onInput); }
      host = root;
      window.removeEventListener("planning-open-origin", openOrigin);
      window.addEventListener("planning-open-origin", openOrigin);
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
      window.removeEventListener("planning-open-origin", openOrigin);
      if (host) { host.removeEventListener("change", onChange); host.removeEventListener("click", onClick); host.removeEventListener("change", onFile); host.removeEventListener("input", onInput); }
      void operation.then(() => flushDraft()).finally(() => { coordinator?.close(); repository?.close(); });
    },
  };

  function onInput(event: Event) { const target = event.target as HTMLElement; if (target.dataset.field && target.dataset.field !== "import-file") pendingInput = target; }
}
