// Planning v2 string renderers. Markup and wording: docs/planning-v2-ui.md sections 1, 2 and 5.
// Pure functions: no DOM access, no storage. The controller attaches events by data-* attributes.
import { calculateAlternative, combinedMultiplier, countEditedUnitCosts, roundElementAmount } from "../../planning/calculate";
import { alternativeTemplateId, createProject, type TemplateSwitchPlan } from "../../planning/templates";
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
  perUnitLabel,
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

/** Summary line about unit costs the planner edited; empty when none. */
export function editedCostsText(result: AlternativeResult): string {
  const count = countEditedUnitCosts(result);
  return count === 0 ? "" : `Includes ${count} edited unit ${count === 1 ? "cost" : "costs"}.`;
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

/** On the new-project screen nothing is "current", so every project, including the one still open, can be opened. */
export function renderProjectMenuItems(projects: PlanningProjectSummary[], project: PlanningProject | null, current = true): string {
  if (!project) return renderProjectList(projects, "");
  return renderProjectList(projectMenuList(projects, project), current ? project.id : "");
}

export function renderTitle(project: PlanningProject, renaming: boolean, error = ""): string {
  if (!renaming) return `<h2 data-planning-project-name>${esc(project.name)}</h2>`;
  return `<label><span>Project name</span><input type="text" data-planning-rename-input value="${esc(project.name)}" /></label>
<p class="filter-validation-message" data-planning-rename-error role="alert"${error ? "" : " hidden"}>${esc(error)}</p>
<button type="button" class="primary-button" data-planning-rename-save>Save</button>
<button type="button" class="secondary-button" data-planning-rename-cancel>Cancel</button>`;
}

/** The Planning Actions menu. On the new-project screen the actions that need an open project are disabled. */
function renderActionsMenu(projectListHtml: string, isNewScreen: boolean): string {
  const off = isNewScreen ? " disabled" : "";
  return `<details class="project-switcher" data-planning-menu="actions">
      <summary>Planning Actions</summary>
      <div class="project-switcher-menu">
        <div data-planning-project-list>${projectListHtml}</div>
        <div class="project-switcher-actions">
          <button type="button" data-planning-new-project${off}>New planning project</button>
          <button type="button" data-planning-rename-project${off}>Rename project</button>
          <button type="button" data-planning-import>Import JSON</button>
          <input type="file" accept=".json,application/json" data-planning-import-input hidden />
        </div>
        <div class="project-switcher-actions">
          <button type="button" data-planning-export="print"${off}>Print summary</button>
          <button type="button" data-planning-export="csv"${off}>Download CSV</button>
          <button type="button" data-planning-export="json"${off}>Download JSON</button>
        </div>
        <div class="project-switcher-actions">
          <button type="button" class="project-switcher-danger" data-planning-delete-project${off}>Delete project</button>
        </div>
      </div>
    </details>`;
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
${renderActionsMenu(renderProjectMenuItems(vm.projects, project), false)}
  </div>
</section>`;
}

/** Corridor values that feed at least one of the given elements: an element input inherits it or derives its default from it. */
export function usedCorridorInputs(library: ResolvedLibrary, elementIds: Iterable<string>): Set<string> {
  const ids = new Set(elementIds);
  const used = new Set<string>();
  for (const element of library.elements) {
    if (!ids.has(element.id)) continue;
    for (const input of element.inputs) {
      if (input.inherit) used.add(input.inherit);
      if (input.defaultFrom) used.add(input.defaultFrom.input);
    }
  }
  return used;
}

export const UNUSED_IN_PROJECT = "Not used by the elements in this alternative";
export const UNUSED_IN_TEMPLATE = "Not used by this template";

function renderCorridorField(library: ResolvedLibrary, key: string, value: number, attribute: string, unusedText = ""): string {
  const definition = library.projectInputs.find((p) => p.key === key);
  const mode = definition?.integer ? "numeric" : "decimal";
  return `<label class="planning-corridor-field${unusedText ? " planning-corridor-field--unused" : ""}" data-corridor-field="${esc(key)}"><span>${esc(CORRIDOR_LABELS[key] ?? key)}</span><input type="text" inputmode="${mode}" ${attribute}="${esc(key)}" value="${esc(formatPlain(value))}" /><small class="muted" data-corridor-unused${unusedText ? "" : " hidden"}>${esc(unusedText)}</small><p class="filter-validation-message" role="alert" hidden></p></label>`;
}

export function renderCorridorPanel(library: ResolvedLibrary, project: PlanningProject, result?: AlternativeResult): string {
  const used = result ? usedCorridorInputs(library, result.elements.filter((e) => e.enabled).map((e) => e.elementId)) : null;
  const fields = library.projectInputs
    .map((p) => renderCorridorField(library, p.key, project.inputs[p.key], "data-planning-project-input", used && !used.has(p.key) ? UNUSED_IN_PROJECT : ""))
    .join("");
  const stages = library.stages.map((s) => `<option value="${esc(s.id)}"${s.id === project.stageId ? " selected" : ""}>${esc(s.label)}</option>`).join("");
  const alt = project.alternatives.find((a) => a.id === project.selectedAlternativeId);
  const templateId = alternativeTemplateId(project, alt);
  const templates =
    library.templates.map((t) => `<option value="${esc(t.id)}"${t.id === templateId ? " selected" : ""}>${esc(t.label)}</option>`).join("") +
    `<option value=""${library.templates.some((t) => t.id === templateId) ? "" : " selected"}>Blank (no elements)</option>`;
  return `<section class="panel-block">
  <div class="panel-heading"><h3>Corridor</h3></div>
  <div class="planning-corridor-fields">
    ${fields}
    <label><span>Template</span><select data-planning-template>${templates}</select><small class="muted">Applies to <span class="planning-scope-name" data-summary="altName">${esc(alt?.name ?? "")}</span></small></label>
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
  if (input.unitCostFor) {
    const base = input.default as number;
    const edited = changed && selection?.inputs[input.key] !== base;
    return edited ? `<small class="muted">Edited</small> ${reset(`Use default ($${formatEntered(base)})`)}` : "";
  }
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

function renderUnitCostField(element: ResolvedElement, input: ElementInputDefinition, value: InputValue, selection: ElementSelection | undefined, projectInputs: ProjectInputs): string {
  const attrs = `data-element-input="${esc(element.id)}" data-input-key="${esc(input.key)}"`;
  const text = typeof value === "number" ? formatEntered(value) : String(value);
  const unit = perUnitLabel(input.unit ?? "");
  return `<label class="planning-unit-cost"><span>${esc(input.label)}</span><span class="planning-unit-cost-box"><span aria-hidden="true">$</span><input type="text" inputmode="decimal" ${attrs} aria-label="${esc(`${input.label}, dollars ${unit}`)}" value="${esc(text)}" /><span class="muted">${esc(unit)}</span></span>${renderHintSlot(element, input, selection, projectInputs)}<p class="filter-validation-message" role="alert" hidden></p></label>`;
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
  const plain = active.filter((i) => !i.advanced && !i.unitCostFor).map(field).join("");
  const advanced = active.filter((i) => i.advanced && !i.unitCostFor);
  const unitCosts = active.filter((i) => i.unitCostFor);
  const more = advanced.length === 0
    ? ""
    : `<details data-element-advanced="${esc(element.id)}"${advancedOpen ? " open" : ""}><summary class="text-button">More inputs</summary><div class="planning-inputs">${advanced.map(field).join("")}</div></details>`;
  if (unitCosts.length === 0) return plain + more;
  const costs = unitCosts.map((i) => renderUnitCostField(element, i, er.inputs[i.key], selection, projectInputs)).join("");
  return `<p class="eyebrow planning-inputs-heading">Quantities</p>${plain}${more}<div class="planning-unit-costs"><p class="eyebrow planning-inputs-heading">Unit costs</p>${costs}</div>`;
}

/** Inner HTML of an element's `[data-element-components]` list. */
export function renderComponentLines(element: ResolvedElement, er: ElementResult, library: ResolvedLibrary, summary: AlternativeSummary, calculated: number): string {
  const factors = factorsFor(element, library, summary);
  const lines = er.components
    .map((c) => {
      const note = sourceNote(c.source, c.edited);
      const title = note.title ? ` title="${esc(note.title)}"` : "";
      return `<li><span>${esc(c.label)}</span><span>${esc(formatQuantity(c.quantity, c.unit))} × ${esc(formatUnitPrice(c.unitPrice))}</span><strong>${esc(formatElementAmount(c.amount))}</strong><small class="muted"${title}>${esc(note.text)}</small></li>`;
    })
    .join("");
  const factorTitle = `Minor items ${formatPercent(factors.minor)}, traffic control ${formatPercent(factors.trafficControl)}, mobilization ${formatPercent(factors.mobilization)}`;
  const allowance = `<li><span title="${esc(factorTitle)}">Items subtotal ${esc(formatElementAmount(er.direct))} × ${esc(combinedMultiplier(factors).toFixed(2))} allowance for minor items, traffic control and mobilization</span><strong>${esc(formatElementAmount(calculated))}</strong></li>`;
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

/** "database": every pay item is bound to the CDOT bid database. "external": at least one component is a calibrated allowance. */
export type PriceOrigin = "database" | "external";

export function elementPriceOrigin(element: ResolvedElement): PriceOrigin | null {
  if (element.components.length === 0) return null;
  return element.components.some((c) => c.source.kind === "assembly") ? "external" : "database";
}

const ORIGIN_TEXT: Record<PriceOrigin, { short: string; long: string }> = {
  database: { short: "Bid database price", long: "Priced from CDOT bid history." },
  external: { short: "External allowance", long: "Planning allowance. You can edit its unit cost." }
};

function renderOriginMarker(element: ResolvedElement): string {
  const origin = elementPriceOrigin(element);
  if (!origin) return "";
  const text = ORIGIN_TEXT[origin];
  // U+2060 word joiner keeps the dot on the same line as the last word of the label.
  return `\u2060<span class="planning-origin planning-origin--${origin}" role="img" aria-label="${esc(text.short)}" title="${esc(`${text.short}. ${text.long}`)}"></span>`;
}

function renderOriginLegend(): string {
  return `<p class="muted planning-origin-legend"><span class="planning-origin planning-origin--database" aria-hidden="true"></span> ${esc(ORIGIN_TEXT.database.short)} <span class="planning-origin planning-origin--external" aria-hidden="true"></span> ${esc(ORIGIN_TEXT.external.short)}</p>`;
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
  const label = `<label class="checkbox-label">${toggle}<span>${esc(element.label)}${renderOriginMarker(element)}</span></label>`;
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
  return buttons;
}

function renderAddAlternativeForm(vm: PlanningViewModel): string {
  const selected = alternativeTemplateId(vm.project, vm.project.alternatives.find((a) => a.id === vm.project.selectedAlternativeId)) ?? "";
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

const SWITCH_LIST_LIMIT = 6;

/** Confirmation text for a template switch that discards planner edits or corridor values. */
export function templateSwitchMessage(plan: TemplateSwitchPlan, templateLabel: string, altName: string): string {
  const lines = [`Switch ${altName} to ${templateLabel}?`, "", `This replaces the elements in ${altName} with those of the template.`];
  if (plan.lostEdits.length > 0) {
    const shown = plan.lostEdits.slice(0, SWITCH_LIST_LIMIT).map((edit) => `• ${edit}`);
    const more = plan.lostEdits.length - SWITCH_LIST_LIMIT;
    lines.push("", "Your changes to these elements will be lost:", ...shown, ...(more > 0 ? [`• and ${more} more`] : []));
  }
  if (plan.replacedInputs.length > 0) {
    lines.push("", "Corridor values that will change:", ...plan.replacedInputs.map((i) => `• ${i.label}: ${formatPlain(i.from)} → ${formatPlain(i.to)}`));
  }
  lines.push("", "Other alternatives are not changed.");
  return lines.join("\n");
}

/** Name, description and add/duplicate/delete for the selected alternative. Inputs live in the left column; the summary only shows outputs. */
export function renderAlternativePanel(vm: PlanningViewModel): string {
  const { project } = vm;
  const alt = project.alternatives.find((a) => a.id === project.selectedAlternativeId);
  return `<section class="panel-block planning-alternative" aria-label="Selected alternative">
  <div class="panel-heading"><h3>Alternative</h3></div>
  <div class="planning-alternative-fields">
    <label><span>Name</span><input type="text" data-planning-alt-name value="${esc(alt?.name ?? "")}" /><p class="filter-validation-message" role="alert" hidden></p></label>
    <label><span>Description</span><textarea rows="2" data-planning-alt-description placeholder="One line describing this alternative">${esc(alt?.description ?? "")}</textarea></label>
  </div>
  <div class="planning-alternative-actions">
    <button type="button" class="secondary-button" data-planning-add-alt aria-expanded="false">+ Alternative</button>
    <button type="button" class="text-button" data-planning-duplicate-alt>Duplicate</button>
    <button type="button" class="text-button" data-planning-delete-alt${project.alternatives.length <= 1 ? " disabled" : ""}>Delete</button>
  </div>
  ${renderAddAlternativeForm(vm)}
</section>`;
}

export function renderSummary(vm: PlanningViewModel): string {
  const { project, result } = vm;
  const values = summaryValues(result.summary);
  const budget = budgetInfo(result.summary);
  const rate = (key: string, label: string, value: number) =>
    `<label class="project-contingency-percent"><input type="text" inputmode="decimal" class="project-contingency-input" data-planning-rate="${key}" aria-label="${label}" value="${esc(percentNumber(value))}" /><span>%</span></label>`;
  return `<aside class="panel-block planning-summary" id="planning-summary" aria-label="Alternative summary">
  <p class="eyebrow">Alternatives</p>
  <div class="planning-alternatives" role="group" aria-label="Alternatives" data-planning-alternatives>${renderAlternativeButtons(project, vm.altTotals)}</div>

  <dl class="planning-summary-lines">
    <div><dt>Construction</dt><dd data-summary="construction">${esc(values.construction)}</dd></div>
    <div><dt>Contingency</dt><dd class="planning-summary-rate" title="Set by the project stage"><span data-summary="contingencyRate">${esc(values.contingencyRate)}</span></dd><dd data-summary="contingency">${esc(values.contingency)}</dd></div>
    <div><dt>Design</dt><dd class="planning-summary-rate">${rate("design", "Design percentage", result.summary.designRate)}</dd><dd data-summary="design">${esc(values.design)}</dd></div>
    <div><dt>Construction engineering</dt><dd class="planning-summary-rate">${rate("constructionEngineering", "Construction engineering percentage", result.summary.constructionEngineeringRate)}</dd><dd data-summary="constructionEngineering">${esc(values.constructionEngineering)}</dd></div>
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
  <p class="muted" data-planning-edited-costs${editedCostsText(result) ? "" : " hidden"}>${esc(editedCostsText(result))}</p>
  ${vm.canCreateProject ? `<div><button type="button" class="secondary-button" data-planning-create-project>Create engineer Project</button><p class="muted">Copies this alternative into a new Project as pay items and lump-sum lines. Later changes here do not update that Project.</p></div>` : ""}
  <p class="visually-hidden" aria-live="polite" data-planning-announce></p>
</aside>`;
}

export function renderPlanningView(vm: PlanningViewModel): string {
  return `<section class="planning-view" data-planning-root>
${renderHeader(vm)}
${renderNotice(vm.notice)}
${renderTotalBar(vm)}
<div class="planning-layout">
  <div class="planning-main">
  ${renderCorridorPanel(vm.library, vm.project, vm.result)}
  ${renderAlternativePanel(vm)}
  <section class="panel-block" aria-label="Elements">
  ${renderOriginLegend()}
${renderElementGroups(vm)}
  </section>
  </div>
${renderSummary(vm)}
</div>
</section>`;
}

// ---------- New-project panel ----------

/** The estimate a draft would create, calculated the same way as the saved project. */
export function newProjectPreview(library: ResolvedLibrary, draft: NewProjectDraft): AlternativeResult {
  const created = createProject(library, { id: "preview", name: "Preview", now: "2000-01-01T00:00:00.000Z", templateId: draft.templateId, alternativeId: "preview" });
  return calculateAlternative(library, { ...created, inputs: draft.inputs });
}

/** Inner HTML of the top of the preview: template and total. Patched as the draft changes. */
export function renderNewPreviewBody(library: ResolvedLibrary, draft: NewProjectDraft): string {
  const template = library.templates.find((t) => t.id === draft.templateId);
  const values = summaryValues(newProjectPreview(library, draft).summary);
  return `<h3>${esc(template?.label ?? "Blank")}</h3>
  <p class="muted">${esc(template?.description ?? "Start with no elements and add what you need.")}</p>
  <div class="planning-total">
    <span>Total</span><strong>${esc(values.total)}</strong>
    <span class="muted">Range ${esc(values.range)}</span>
  </div>`;
}

/** Inner HTML of the detail below the actions: summary lines and the elements the template includes. */
export function renderNewPreviewDetails(library: ResolvedLibrary, draft: NewProjectDraft): string {
  const result = newProjectPreview(library, draft);
  const values = summaryValues(result.summary);
  const included = result.elements.filter((e) => e.enabled && e.components.length > 0);
  const list =
    included.length === 0
      ? `<p class="muted">No elements selected.</p>`
      : `<ul class="planning-components">${included.map((e) => `<li><span>${esc(e.label)}</span><strong>${esc(formatElementAmount(e.amount))}</strong></li>`).join("")}</ul>`;
  return `<dl class="planning-summary-lines">
    <div><dt>Construction</dt><dd>${esc(values.construction)}</dd></div>
    <div><dt>Contingency</dt><dd class="planning-summary-rate"><span>${esc(values.contingencyRate)}</span></dd><dd>${esc(values.contingency)}</dd></div>
    <div><dt>Design</dt><dd class="planning-summary-rate"><span>${esc(formatPercent(result.summary.designRate))}</span></dd><dd>${esc(values.design)}</dd></div>
    <div><dt>Construction engineering</dt><dd class="planning-summary-rate"><span>${esc(formatPercent(result.summary.constructionEngineeringRate))}</span></dd><dd>${esc(values.constructionEngineering)}</dd></div>
  </dl>
  ${list}`;
}

/** Default project name for a template: "Complete street estimate", or "New planning estimate" for Blank. */
export function defaultProjectName(library: ResolvedLibrary, templateId: string | null): string {
  const template = library.templates.find((t) => t.id === templateId);
  return template ? `${template.label} estimate` : "New planning estimate";
}

/** Corridor values the draft's template does not use. */
export function unusedDraftInputs(library: ResolvedLibrary, draft: NewProjectDraft): Set<string> {
  const template = library.templates.find((t) => t.id === draft.templateId);
  const used = usedCorridorInputs(library, template ? template.elements.map((e) => e.id) : []);
  return new Set(library.projectInputs.map((p) => p.key).filter((key) => !used.has(key)));
}

export function renderNewProjectPanel(
  library: ResolvedLibrary,
  draft: NewProjectDraft,
  project: PlanningProject | null,
  projects: PlanningProjectSummary[],
  notice: Notice | null = null
): string {
  const options = library.templates
    .map(
      (t) => `<label class="checkbox-label planning-template-option"><input type="radio" name="planning-template" value="${esc(t.id)}"${draft.templateId === t.id ? " checked" : ""} />
      <span><strong>${esc(t.label)}</strong><small class="muted">${esc(t.description)}</small></span></label>`
    )
    .join("\n");
  const blank = `<label class="checkbox-label planning-template-option"><input type="radio" name="planning-template" value=""${draft.templateId === null ? " checked" : ""} />
      <span><strong>Blank</strong><small class="muted">No elements selected.</small></span></label>`;
  const unused = unusedDraftInputs(library, draft);
  const fields = library.projectInputs
    .map((p) => renderCorridorField(library, p.key, draft.inputs[p.key], "data-planning-new-input", unused.has(p.key) ? UNUSED_IN_TEMPLATE : ""))
    .join("");
  const total = formatTotalAmount(newProjectPreview(library, draft).summary.total);
  return `<section class="planning-view" data-planning-root>
<div class="planning-new" data-planning-new>
<section class="panel-block planning-header">
  <div class="planning-new-title">
    <p class="eyebrow">Planning estimate</p>
    <label><span class="visually-hidden">Project name</span><input type="text" class="planning-name-input" data-planning-new-name aria-label="Project name" value="${esc(draft.name)}" placeholder="${esc(defaultProjectName(library, draft.templateId))}" /></label>
  </div>
  <div class="planning-header-actions">
${renderActionsMenu(renderProjectMenuItems(projects, project, false), true)}
  </div>
</section>
${renderNotice(notice)}
<div class="planning-total-bar">
  <strong>Preview</strong>
  <span>Total <strong data-planning-new-bar-total>${esc(total)}</strong></span>
  <a class="text-button" href="#planning-summary">Summary</a>
</div>
<div class="planning-layout">
  <div class="planning-main">
    <section class="panel-block" aria-label="Starting template">
      <div class="panel-heading"><h3>1 Starting template</h3></div>
      <p class="muted">You can switch any element on or off afterwards.</p>
      <div class="planning-template-options" role="radiogroup" aria-label="Starting template">
${options}
${blank}
      </div>
    </section>
    <section class="panel-block">
      <div class="panel-heading"><h3>2 Corridor</h3></div>
      <div class="planning-corridor-fields">${fields}</div>
      <p class="filter-validation-message" data-planning-new-error role="alert"${draft.error ? "" : " hidden"}>${esc(draft.error)}</p>
      <div class="planning-new-actions">
        <button type="button" class="primary-button" data-planning-create>Create project</button>
        ${project ? `<button type="button" class="secondary-button" data-planning-new-cancel>Cancel</button>` : ""}
      </div>
    </section>
  </div>
  <aside class="panel-block planning-summary" id="planning-summary" aria-label="Estimate preview">
    <p class="eyebrow">Preview</p>
    <div class="planning-new-preview" data-planning-new-preview>${renderNewPreviewBody(library, draft)}</div>
    <div class="planning-new-preview" data-planning-new-details>${renderNewPreviewDetails(library, draft)}</div>
    <p class="muted">Prices: ${esc(library.priceBasisLabel)}</p>
  </aside>
</div>
</div>
</section>`;
}
