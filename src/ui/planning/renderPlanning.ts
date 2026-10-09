// Planning v2 string renderers. Markup and wording: docs/planning-v2-ui.md sections 1, 2 and 5.
// Pure functions: no DOM access, no storage. The controller attaches events by data-* attributes.
import { combinedMultiplier, roundElementAmount } from "../../planning/calculate";
import type { PlanningProjectSummary } from "../../planning/storage";
import type {
  AlternativeResult,
  AlternativeSummary,
  ElementInputDefinition,
  ElementResult,
  ElementSelection,
  FactorSet,
  GroupDefinition,
  InputValue,
  PlanningProject,
  ProjectInputs,
  ResolvedElement,
  ResolvedLibrary
} from "../../planning/types";
import {
  formatClock,
  formatElementAmount,
  formatElementBox,
  formatEntered,
  formatPercent,
  formatPlain,
  formatQuantity,
  formatTotalAmount,
  formatUnitPrice,
  inputBrief,
  optionLabel,
  percentNumber,
  sourceNote
} from "./format";

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

const esc = escapeHtml;

export type SaveStatus =
  | { kind: "saved"; at: string }
  | { kind: "saving" }
  | { kind: "error"; reason: string }
  | { kind: "conflict" };

export interface Notice {
  text: string;
  kind: "info" | "error";
}

export interface NewProjectDraft {
  name: string;
  templateId: string | null;
  inputs: ProjectInputs;
  error: string;
}

export interface PlanningViewModel {
  library: ResolvedLibrary;
  project: PlanningProject;
  projects: PlanningProjectSummary[];
  result: AlternativeResult;
  /** Total of every alternative, keyed by alternative id. */
  altTotals: Record<string, number>;
  /** Calculated amount an unselected base treatment would have if selected, keyed by element id. */
  basePreview: Record<string, number>;
  /** Open disclosures: element ids, and "adv:<id>" for the "More inputs" disclosure. */
  openDetails: Set<string>;
  addAltOpen: boolean;
  addAltName: string;
  renaming: boolean;
  saveStatus: SaveStatus;
  notice: Notice | null;
  /** Show "Create engineer Project" (the host app supplied the handoff). */
  canCreateProject: boolean;
}

const CORRIDOR_LABELS: Record<string, string> = {
  lengthMiles: "Corridor length (mi)",
  roadwayWidthFt: "Roadway width, curb to curb (ft)",
  intersections: "Intersections"
};

const GROUP_HINTS: Record<string, string> = { one: "Choose one", any: "Add any", amount: "Enter amounts" };

const BASE_HINT = "The base treatment sets the allowance for minor items, traffic control and mobilization on every element.";

// ---------- Shared value helpers (also used by the controller's patches) ----------

export interface RowAmount {
  /** Calculated amount for display (an unselected base uses its own allowance factors). */
  calculated: number;
  /** Text for the dollar box, without the $ sign. */
  boxText: string;
  overridden: boolean;
}

export function rowAmount(er: ElementResult, basePreview: Record<string, number>): RowAmount {
  const preview = er.group === "base" && !er.enabled ? basePreview[er.elementId] : undefined;
  const calculated = preview ?? er.calculated;
  const overridden = er.override !== null;
  return { calculated, overridden, boxText: er.override !== null ? formatEntered(er.override) : formatElementBox(calculated) };
}

export function otherBoxText(selection: ElementSelection | undefined): string {
  return selection && selection.override !== null ? formatEntered(selection.override) : "";
}

export function groupSubtotalText(group: GroupDefinition, result: AlternativeResult): string {
  if (group.id === "other") return formatElementAmount(result.summary.rightOfWay + result.summary.utilityRelocation);
  const sum = result.elements.filter((e) => e.group === group.id && e.enabled).reduce((total, e) => total + e.amount, 0);
  return formatElementAmount(sum);
}

export interface BudgetInfo {
  budgetText: string;
  remainingText: string;
  shortText: string;
  over: boolean;
}

export function budgetInfo(summary: AlternativeSummary): BudgetInfo | null {
  if (summary.budget === null || summary.budgetRemaining === null) return null;
  const over = summary.budgetRemaining < 0;
  const amount = formatElementAmount(Math.abs(roundElementAmount(summary.budgetRemaining)));
  return {
    budgetText: `$${formatEntered(summary.budget)}`,
    remainingText: `${amount} ${over ? "over budget" : "remaining"}`,
    shortText: `${amount} ${over ? "over budget" : "under budget"}`,
    over
  };
}

export function summaryValues(summary: AlternativeSummary): Record<string, string> {
  return {
    construction: formatElementAmount(summary.construction),
    contingencyRate: formatPercent(summary.contingencyRate),
    contingency: formatElementAmount(summary.contingency),
    design: formatElementAmount(summary.design),
    constructionEngineering: formatElementAmount(summary.constructionEngineering),
    rightOfWay: summary.rightOfWay === 0 ? "Not included" : formatElementAmount(summary.rightOfWay),
    utilityRelocation: summary.utilityRelocation === 0 ? "Not included" : formatElementAmount(summary.utilityRelocation),
    total: formatTotalAmount(summary.total),
    range: `${formatTotalAmount(summary.rangeLow)} – ${formatTotalAmount(summary.rangeHigh)}`
  };
}

export function saveStatusText(status: SaveStatus): string {
  switch (status.kind) {
    case "saved": {
      const clock = formatClock(status.at);
      return clock ? `Saved ${clock}` : "Saved";
    }
    case "saving":
      return "Saving…";
    case "error":
      return `Not saved: ${status.reason}`;
    case "conflict":
      return "This planning project was changed in another tab. Reload to see the latest version.";
  }
}

export function renderSaveStatus(status: SaveStatus): string {
  const text = esc(saveStatusText(status));
  return status.kind === "conflict" ? `${text} <button type="button" class="text-button" data-planning-reload>Reload saved version</button>` : text;
}

/** Factors that apply to an element: a base element uses its own set, other elements use the alternative's. */
function factorsFor(element: ResolvedElement, library: ResolvedLibrary, summary: AlternativeSummary): FactorSet {
  return element.group === "base" && element.baseType ? library.factors[element.baseType] : summary.factors;
}

// ---------- Page parts ----------

export function renderLoadError(message: string): string {
  return `<section class="planning-view" data-planning-root>
  <section class="panel-block planning-new">
    <div class="panel-heading"><p class="eyebrow">Planning estimate</p><h2>Planning prices could not be loaded</h2></div>
    <p>Planning prices could not be loaded. Reload the page to try again.</p>
    <p class="muted">${esc(message)}</p>
  </section>
</section>`;
}

export function renderLoading(): string {
  return `<section class="planning-view" data-planning-root>
  <section class="panel-block planning-new"><p class="muted" role="status">Loading planning estimate…</p></section>
</section>`;
}

function renderNotice(notice: Notice | null): string {
  const cls = notice?.kind === "error" ? "filter-validation-message" : "muted";
  return `<p class="${cls}" data-planning-notice role="status"${notice ? "" : " hidden"}>${notice ? esc(notice.text) : ""}</p>`;
}

function renderProjectList(projects: PlanningProjectSummary[], currentId: string): string {
  return projects
    .slice(0, 8)
    .map((p) => `<button type="button" class="project-switcher-project" data-planning-open-project="${esc(p.id)}"${p.id === currentId ? " disabled" : ""}>${esc(p.name)}</button>`)
    .join("");
}

/** Up to 8 most recently updated, with the open project included even before its first save. */
export function projectMenuList(projects: PlanningProjectSummary[], project: PlanningProject): PlanningProjectSummary[] {
  const rest = projects.filter((p) => p.id !== project.id);
  const current = { id: project.id, name: project.name, updatedAt: project.updatedAt, revision: project.revision };
  const merged = [current, ...rest].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  return merged.map((p) => (p.id === project.id ? { ...p, name: project.name } : p));
}

export function renderProjectMenuItems(projects: PlanningProjectSummary[], project: PlanningProject): string {
  return renderProjectList(projectMenuList(projects, project), project.id);
}

export function renderTitle(project: PlanningProject, renaming: boolean, error = ""): string {
  if (!renaming) return `<h2 data-planning-project-name>${esc(project.name)}</h2>`;
  return `<label><span>Project name</span><input type="text" data-planning-rename-input value="${esc(project.name)}" /></label>
<p class="filter-validation-message" data-planning-rename-error role="alert"${error ? "" : " hidden"}>${esc(error)}</p>
<button type="button" class="primary-button" data-planning-rename-save>Save</button>
<button type="button" class="secondary-button" data-planning-rename-cancel>Cancel</button>`;
}

export function renderHeader(vm: PlanningViewModel): string {
  const { library, project } = vm;
  const template = project.templateId ? library.templates.find((t) => t.id === project.templateId) : undefined;
  const started = template ? template.label : "a blank project";
  return `<section class="panel-block planning-header">
  <div>
    <p class="eyebrow">Planning estimate</p>
    <div data-planning-title>${renderTitle(project, vm.renaming)}</div>
    <p class="muted">Started from ${esc(started)} · <span data-planning-save-status role="status">${renderSaveStatus(vm.saveStatus)}</span></p>
  </div>
  <div class="planning-header-actions">
    <details class="project-switcher" data-planning-menu="project">
      <summary>Planning projects</summary>
      <div class="project-switcher-menu">
        <div data-planning-project-list>${renderProjectMenuItems(vm.projects, project)}</div>
        <div class="project-switcher-actions">
          <button type="button" data-planning-new-project>New planning project</button>
          <button type="button" data-planning-rename-project>Rename project</button>
          <button type="button" data-planning-import>Import JSON</button>
          <button type="button" data-planning-delete-project>Delete project</button>
          <input type="file" accept=".json,application/json" data-planning-import-input hidden />
        </div>
      </div>
    </details>
    <details class="project-switcher" data-planning-menu="export">
      <summary>Export</summary>
      <div class="project-switcher-menu"><div class="project-switcher-actions">
        <button type="button" data-planning-export="print">Print summary</button>
        <button type="button" data-planning-export="csv">Download CSV</button>
        <button type="button" data-planning-export="json">Download JSON</button>
      </div></div>
    </details>
  </div>
</section>`;
}

function renderCorridorField(library: ResolvedLibrary, key: string, value: number, attribute: string): string {
  const definition = library.projectInputs.find((p) => p.key === key);
  const mode = definition?.integer ? "numeric" : "decimal";
  return `<label><span>${esc(CORRIDOR_LABELS[key] ?? key)}</span><input type="text" inputmode="${mode}" ${attribute}="${esc(key)}" value="${esc(formatPlain(value))}" /><p class="filter-validation-message" role="alert" hidden></p></label>`;
}

export function renderCorridorPanel(library: ResolvedLibrary, project: PlanningProject): string {
  const fields = library.projectInputs.map((p) => renderCorridorField(library, p.key, project.inputs[p.key], "data-planning-project-input")).join("");
  const stages = library.stages.map((s) => `<option value="${esc(s.id)}"${s.id === project.stageId ? " selected" : ""}>${esc(s.label)}</option>`).join("");
  return `<section class="panel-block">
  <div class="panel-heading"><h3>Corridor</h3></div>
  <div class="planning-corridor-fields">
    ${fields}
    <label><span>Project stage</span><select data-planning-stage>${stages}</select></label>
    <label><span>Budget (optional)</span><input type="text" inputmode="numeric" data-planning-budget placeholder="No budget" value="${project.budget === null ? "" : esc(formatEntered(project.budget))}" /><p class="filter-validation-message" role="alert" hidden></p></label>
  </div>
  <p class="muted">Elements use these values unless you change them in an element's inputs.</p>
</section>`;
}

export function renderTotalBar(vm: PlanningViewModel): string {
  const alt = vm.project.alternatives.find((a) => a.id === vm.project.selectedAlternativeId);
  const values = summaryValues(vm.result.summary);
  const budget = budgetInfo(vm.result.summary);
  return `<div class="planning-total-bar" data-planning-total-bar>
  <strong data-summary="altName">${esc(alt?.name ?? "")}</strong>
  <span>Total <strong data-summary="total">${esc(values.total)}</strong></span>
  <span data-summary="budgetShort" class="${budget?.over ? "planning-budget--over" : "planning-budget--under"}"${budget ? "" : " hidden"}>${esc(budget?.shortText ?? "")}</span>
  <a class="text-button" href="#planning-summary">Summary</a>
</div>`;
}

// ---------- Element rows ----------

function unitSuffix(input: ElementInputDefinition): string {
  return input.unit && input.unit !== "count" ? ` (${input.unit})` : "";
}

export function inputHint(element: ResolvedElement, input: ElementInputDefinition, selection: ElementSelection | undefined, projectInputs: ProjectInputs): string {
  const changed = selection?.inputs[input.key] !== undefined;
  const reset = (text: string) => `<button type="button" class="text-button" data-element-input-reset="${esc(element.id)}" data-input-key="${esc(input.key)}">${esc(text)}</button>`;
  const unit = input.unit && input.unit !== "count" ? ` ${input.unit}` : "";
  if (input.inherit) {
    return changed ? reset(`Use corridor value (${formatPlain(projectInputs[input.inherit])}${unit})`) : `<small class="muted">From corridor</small>`;
  }
  if (input.defaultFrom) {
    const base = projectInputs[input.defaultFrom.input] * input.defaultFrom.multiply;
    return changed ? reset(`Use default (${formatPlain(base)})`) : `<small class="muted">${esc(formatPlain(input.defaultFrom.multiply))} per intersection</small>`;
  }
  if (changed && input.default !== undefined && selection?.inputs[input.key] !== input.default) {
    const text = typeof input.default === "number" ? formatPlain(input.default) : optionLabel(input.default);
    return reset(`Use default (${text}${unit})`);
  }
  return "";
}

function renderHintSlot(element: ResolvedElement, input: ElementInputDefinition, selection: ElementSelection | undefined, projectInputs: ProjectInputs): string {
  const hint = inputHint(element, input, selection, projectInputs);
  return `<div data-input-hint="${esc(input.key)}"${hint ? "" : " hidden"}>${hint}</div>`;
}

/** Identifies which input fields an element shows, so a patch can tell a structure change from a value change. */
export function inputSignature(element: ResolvedElement, er: ElementResult): string {
  return element.inputs.filter((i) => i.key in er.inputs).map((i) => i.key).join(",");
}

function renderInputField(element: ResolvedElement, input: ElementInputDefinition, value: InputValue, selection: ElementSelection | undefined, projectInputs: ProjectInputs): string {
  const attrs = `data-element-input="${esc(element.id)}" data-input-key="${esc(input.key)}"`;
  let control: string;
  if (input.options) {
    const options = input.options.map((o) => `<option value="${esc(String(o))}"${String(o) === String(value) ? " selected" : ""}>${esc(optionLabel(o))}</option>`).join("");
    control = `<select ${attrs}>${options}</select>`;
  } else {
    const text = typeof value === "number" ? formatPlain(value) : String(value);
    control = `<input type="text" inputmode="${input.integer ? "numeric" : "decimal"}" ${attrs} value="${esc(text)}" />`;
  }
  return `<label><span>${esc(input.label + unitSuffix(input))}</span>${control}${renderHintSlot(element, input, selection, projectInputs)}<p class="filter-validation-message" role="alert" hidden></p></label>`;
}

/** Inner HTML of an element's `[data-element-inputs]` region. */
export function renderElementInputs(
  element: ResolvedElement,
  er: ElementResult,
  selection: ElementSelection | undefined,
  projectInputs: ProjectInputs,
  advancedOpen: boolean
): string {
  const active = element.inputs.filter((i) => i.key in er.inputs);
  const field = (i: ElementInputDefinition) => renderInputField(element, i, er.inputs[i.key], selection, projectInputs);
  const plain = active.filter((i) => !i.advanced).map(field).join("");
  const advanced = active.filter((i) => i.advanced);
  const more = advanced.length === 0
    ? ""
    : `<details data-element-advanced="${esc(element.id)}"${advancedOpen ? " open" : ""}><summary class="text-button">More inputs</summary><div class="planning-inputs">${advanced.map(field).join("")}</div></details>`;
  return plain + more;
}

/** Inner HTML of an element's `[data-element-components]` list. */
export function renderComponentLines(element: ResolvedElement, er: ElementResult, library: ResolvedLibrary, summary: AlternativeSummary, calculated: number): string {
  const factors = factorsFor(element, library, summary);
  const lines = er.components
    .map((c) => {
      const note = sourceNote(c.source);
      const title = note.title ? ` title="${esc(note.title)}"` : "";
      return `<li><span>${esc(c.label)}</span><span>${esc(formatQuantity(c.quantity, c.unit))} × ${esc(formatUnitPrice(c.unitPrice))}</span><strong>${esc(formatElementAmount(c.amount))}</strong><small class="muted"${title}>${esc(note.text)}</small></li>`;
    })
    .join("");
  const allowance = `<li><span>Items subtotal ${esc(formatElementAmount(er.direct))} × ${esc(combinedMultiplier(factors).toFixed(2))} allowance (minor items ${esc(formatPercent(factors.minor))}, traffic control ${esc(formatPercent(factors.trafficControl))}, mobilization ${esc(formatPercent(factors.mobilization))})</span><strong>${esc(formatElementAmount(calculated))}</strong></li>`;
  return lines + allowance;
}

/** Inner HTML of an element's `[data-element-reset-slot]`. */
export function renderResetSlot(element: ResolvedElement, amount: RowAmount): string {
  if (!amount.overridden) return "";
  const text = formatElementAmount(amount.calculated);
  return `<button type="button" class="text-button" data-element-reset="${esc(element.id)}" aria-label="${esc(`Reset ${element.label} to calculated amount ${text}`)}">Reset to calculated ${esc(text)}</button>`;
}

export function dollarBoxLabel(element: ResolvedElement, enabled: boolean): string {
  return `${element.label} amount in dollars${enabled ? "" : ", not included"}`;
}

export interface RowContext {
  library: ResolvedLibrary;
  project: PlanningProject;
  result: AlternativeResult;
  basePreview: Record<string, number>;
  openDetails: Set<string>;
}

export function renderElementRow(element: ResolvedElement, er: ElementResult, selection: ElementSelection | undefined, ctx: RowContext): string {
  const id = esc(element.id);
  const isBase = element.group === "base";
  const toggle = isBase
    ? `<input type="radio" name="planning-base" value="${id}" data-element-toggle="${id}"${er.enabled ? " checked" : ""} />`
    : `<input type="checkbox" data-element-toggle="${id}"${er.enabled ? " checked" : ""} />`;
  const label = `<label class="checkbox-label">${toggle}<span>${esc(element.label)}</span></label>`;
  const rowClass = `planning-row${er.enabled ? "" : " planning-row--off"}`;
  if (element.components.length === 0) {
    return `<div class="${rowClass}" data-element-row="${id}">${label}<div class="planning-amount"><span class="muted planning-amount-note">Elements only</span></div></div>`;
  }
  const amount = rowAmount(er, ctx.basePreview);
  const open = ctx.openDetails.has(element.id) ? " open" : "";
  const inputs = renderElementInputs(element, er, selection, ctx.project.inputs, ctx.openDetails.has(`adv:${element.id}`));
  return `<div class="${rowClass}" data-element-row="${id}">
  ${label}
  <div class="planning-amount">
    <span aria-hidden="true">$</span>
    <input type="text" inputmode="numeric" class="planning-amount-input" data-element-amount="${id}" aria-label="${esc(dollarBoxLabel(element, er.enabled))}" value="${esc(amount.boxText)}" />
    <span class="planning-amount-note" data-element-reset-slot="${id}">${renderResetSlot(element, amount)}</span>
    <p class="filter-validation-message planning-amount-note" data-element-error="${id}" role="alert" hidden></p>
  </div>
  <details class="planning-row-details" data-element-details="${id}"${open}>
    <summary><span class="visually-hidden">${esc(element.label)} inputs and pricing: </span><span data-element-brief="${id}">${esc(inputBrief(element, er.inputs))}</span></summary>
    <p class="muted">${esc(element.note)}</p>
    <div class="planning-inputs" data-element-inputs="${id}" data-input-sig="${esc(inputSignature(element, er))}">${inputs}</div>
    <ul class="planning-components" data-element-components="${id}">${renderComponentLines(element, er, ctx.library, ctx.result.summary, amount.calculated)}</ul>
  </details>
</div>`;
}

export function renderOtherRow(element: ResolvedElement, selection: ElementSelection | undefined): string {
  const id = esc(element.id);
  return `<div class="planning-row" data-element-row="${id}">
  <span class="planning-row-label">${esc(element.label)}</span>
  <div class="planning-amount">
    <span aria-hidden="true">$</span>
    <input type="text" inputmode="numeric" class="planning-amount-input" data-element-amount="${id}" aria-label="${esc(`${element.label} amount in dollars`)}" placeholder="Not included" value="${esc(otherBoxText(selection))}" />
    <p class="filter-validation-message planning-amount-note" data-element-error="${id}" role="alert" hidden></p>
  </div>
</div>`;
}

export function renderElementGroups(vm: PlanningViewModel): string {
  const alt = vm.project.alternatives.find((a) => a.id === vm.project.selectedAlternativeId);
  const ctx: RowContext = { library: vm.library, project: vm.project, result: vm.result, basePreview: vm.basePreview, openDetails: vm.openDetails };
  return vm.library.groups
    .map((group) => {
      const rows = vm.library.elements
        .filter((e) => e.group === group.id)
        .map((element) => {
          const selection = alt?.selections[element.id];
          if (group.id === "other") return renderOtherRow(element, selection);
          const er = vm.result.elements.find((r) => r.elementId === element.id);
          return er ? renderElementRow(element, er, selection, ctx) : "";
        })
        .join("\n");
      const hint = group.id === "base" ? `\n  <p class="muted">${esc(BASE_HINT)}</p>` : "";
      return `<fieldset class="planning-group" data-planning-group="${esc(group.id)}">
  <legend class="planning-group-heading"><span class="eyebrow">${esc(group.label)}</span><span class="muted">${esc(GROUP_HINTS[group.selection] ?? "")}</span><strong data-group-subtotal="${esc(group.id)}">${esc(groupSubtotalText(group, vm.result))}</strong></legend>${hint}
${rows}
</fieldset>`;
    })
    .join("\n");
}

// ---------- Summary ----------

export function renderAlternativeButtons(project: PlanningProject, altTotals: Record<string, number>): string {
  const buttons = project.alternatives
    .map((alt) => {
      const active = alt.id === project.selectedAlternativeId;
      return `<button type="button" class="app-view-tab${active ? " app-view-tab--active" : ""} planning-alt-button" data-planning-alt="${esc(alt.id)}" aria-pressed="${active}"><span data-alt-name="${esc(alt.id)}">${esc(alt.name)}</span><small data-alt-total="${esc(alt.id)}">${esc(formatTotalAmount(altTotals[alt.id] ?? 0))}</small></button>`;
    })
    .join("");
  return `${buttons}<button type="button" class="secondary-button" data-planning-add-alt aria-expanded="false">+ Alternative</button>`;
}

function renderAddAlternativeForm(vm: PlanningViewModel): string {
  const selected = vm.project.templateId ?? "";
  const options =
    `<option value=""${selected === "" ? " selected" : ""}>Blank (no elements)</option>` +
    vm.library.templates.map((t) => `<option value="${esc(t.id)}"${t.id === selected ? " selected" : ""}>${esc(t.label)}</option>`).join("");
  return `<div class="planning-add-alternative" data-planning-add-alt-form${vm.addAltOpen ? "" : " hidden"}>
  <label><span>Start from</span><select data-planning-add-alt-template>${options}</select></label>
  <label><span>Name</span><input type="text" data-planning-add-alt-name value="${esc(vm.addAltName)}" /></label>
  <p class="filter-validation-message" data-planning-add-alt-error role="alert" hidden></p>
  <button type="button" class="primary-button" data-planning-add-alt-confirm>Add alternative</button>
  <button type="button" class="secondary-button" data-planning-add-alt-cancel>Cancel</button>
</div>`;
}

export function renderSummary(vm: PlanningViewModel): string {
  const { project, result } = vm;
  const alt = project.alternatives.find((a) => a.id === project.selectedAlternativeId);
  const values = summaryValues(result.summary);
  const budget = budgetInfo(result.summary);
  const rate = (key: string, label: string, value: number) =>
    `<label class="project-contingency-percent"><input type="text" inputmode="decimal" class="project-contingency-input" data-planning-rate="${key}" aria-label="${label}" value="${esc(percentNumber(value))}" /><span>%</span></label>`;
  return `<aside class="panel-block planning-summary" id="planning-summary" aria-label="Alternative summary">
  <p class="eyebrow">Alternatives</p>
  <div class="planning-alternatives" role="group" aria-label="Alternatives" data-planning-alternatives>${renderAlternativeButtons(project, vm.altTotals)}</div>
  ${renderAddAlternativeForm(vm)}
  <label><span>Name</span><input type="text" data-planning-alt-name value="${esc(alt?.name ?? "")}" /><p class="filter-validation-message" role="alert" hidden></p></label>
  <label><span>Description</span><textarea rows="2" data-planning-alt-description placeholder="One line describing this alternative">${esc(alt?.description ?? "")}</textarea></label>
  <div><button type="button" class="text-button" data-planning-duplicate-alt>Duplicate</button> <button type="button" class="text-button" data-planning-delete-alt${project.alternatives.length <= 1 ? " disabled" : ""}>Delete</button></div>

  <dl class="planning-summary-lines">
    <div><dt>Construction</dt><dd data-summary="construction">${esc(values.construction)}</dd></div>
    <div><dt>Contingency <span class="muted" data-summary="contingencyRate">${esc(values.contingencyRate)}</span></dt><dd data-summary="contingency">${esc(values.contingency)}</dd></div>
    <div><dt>Design ${rate("design", "Design percentage", result.summary.designRate)}</dt><dd data-summary="design">${esc(values.design)}</dd></div>
    <div><dt>Construction engineering ${rate("constructionEngineering", "Construction engineering percentage", result.summary.constructionEngineeringRate)}</dt><dd data-summary="constructionEngineering">${esc(values.constructionEngineering)}</dd></div>
    <div><dt>Right-of-way</dt><dd data-summary="rightOfWay">${esc(values.rightOfWay)}</dd></div>
    <div><dt>Utility relocation</dt><dd data-summary="utilityRelocation">${esc(values.utilityRelocation)}</dd></div>
  </dl>
  <p class="filter-validation-message" data-planning-summary-error role="alert" hidden></p>
  <div class="planning-total">
    <span>Total</span><strong data-summary="total">${esc(values.total)}</strong>
    <span class="muted">Range <span data-summary="range">${esc(values.range)}</span></span>
    <span data-summary="budgetLine"${budget ? "" : " hidden"}>Budget <span data-summary="budgetValue">${esc(budget?.budgetText ?? "")}</span> · <strong class="${budget?.over ? "planning-budget--over" : "planning-budget--under"}" data-summary="budgetRemaining">${esc(budget?.remainingText ?? "")}</strong></span>
  </div>
  <p class="muted">Prices: ${esc(vm.library.priceBasisLabel)}</p>
  ${vm.canCreateProject ? `<div><button type="button" class="secondary-button" data-planning-create-project>Create engineer Project</button><p class="muted">Copies this alternative into a new Project as pay items and lump-sum lines. Later changes here do not update that Project.</p></div>` : ""}
  <p class="visually-hidden" aria-live="polite" data-planning-announce></p>
</aside>`;
}

export function renderPlanningView(vm: PlanningViewModel): string {
  return `<section class="planning-view" data-planning-root>
${renderHeader(vm)}
${renderNotice(vm.notice)}
${renderCorridorPanel(vm.library, vm.project)}
${renderTotalBar(vm)}
<div class="planning-layout">
  <section class="panel-block" aria-label="Elements">
${renderElementGroups(vm)}
  </section>
${renderSummary(vm)}
</div>
</section>`;
}

// ---------- New-project panel ----------

export function renderNewProjectPanel(library: ResolvedLibrary, draft: NewProjectDraft, hasProject: boolean, notice: Notice | null = null): string {
  const options = library.templates
    .map(
      (t) => `<label class="checkbox-label planning-template-option"><input type="radio" name="planning-template" value="${esc(t.id)}"${draft.templateId === t.id ? " checked" : ""} />
      <span><strong>${esc(t.label)}</strong><small class="muted">${esc(t.description)}</small></span></label>`
    )
    .join("\n");
  const blank = `<label class="checkbox-label planning-template-option"><input type="radio" name="planning-template" value=""${draft.templateId === null ? " checked" : ""} />
      <span><strong>Blank</strong><small class="muted">No elements selected.</small></span></label>`;
  const fields = library.projectInputs.map((p) => renderCorridorField(library, p.key, draft.inputs[p.key], "data-planning-new-input")).join("");
  return `<section class="planning-view" data-planning-root>
${renderNotice(notice)}
<section class="panel-block planning-new" data-planning-new>
  <div class="panel-heading"><p class="eyebrow">Planning estimate</p><h2>Start a planning estimate</h2></div>
  <p class="muted">Pick a starting template. You can switch any element on or off afterwards.</p>
  <label><span>Project name</span><input type="text" data-planning-new-name required value="${esc(draft.name)}" /></label>
  <div class="planning-template-options" role="radiogroup" aria-label="Starting template">
${options}
${blank}
  </div>
  <div class="planning-corridor-fields">${fields}</div>
  <p class="filter-validation-message" data-planning-new-error role="alert"${draft.error ? "" : " hidden"}>${esc(draft.error)}</p>
  <div>
    <button type="button" class="primary-button" data-planning-create>Create project</button>
    ${hasProject ? `<button type="button" class="secondary-button" data-planning-new-cancel>Cancel</button>` : ""}
  </div>
  <p class="muted">Or <button type="button" class="text-button" data-planning-import>import a planning JSON file</button>.</p>
  <input type="file" accept=".json,application/json" data-planning-import-input hidden />
</section>
</section>`;
}
