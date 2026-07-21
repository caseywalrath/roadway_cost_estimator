import type { EvidenceResult, StateConfig } from "../data/schema";
import type { ProjectLineItem, UserProject } from "../projects/projectWorkspace";

export interface PendingDuplicateProjectLine {
  lineItem: ProjectLineItem;
  matchingLineIds: string[];
}

export interface ProjectManagerFilters {
  query: string;
  state: string;
  status: "active" | "archived";
}

export interface ProjectMetadataEditorView {
  context: "workspace" | "manager";
  mode: "create" | "edit";
  projectId: string | null;
  state: string;
  name: string;
  location: string;
  notes: string;
}

export type ProjectWorkspaceSubview = "workspace" | "manager";

export function renderAddToProjectPanel(
  result: EvidenceResult,
  activeProject: UserProject | null,
  pendingDuplicateLine: PendingDuplicateProjectLine | null,
  projectLineNotice: string | null
): string {
  if (!result.query.itemCode) return "";
  if (!activeProject) {
    return `
      <section class="add-project-panel add-project-panel--empty">
        <div>
          <h3>Choose a Project before adding this item</h3>
          <p class="muted">No active ${escapeHtml(result.query.state)} Project is selected.</p>
        </div>
        <button type="button" class="primary-button" data-project-manager-shortcut>Choose or create Project</button>
      </section>
    `;
  }
  if (pendingDuplicateLine) return renderDuplicateProjectLinePanel(activeProject, pendingDuplicateLine);

  return `
    <section class="add-project-panel">
      <div class="panel-heading add-project-heading">
        <div>
          <h3>Add Item to Project</h3>
          <p class="query-line">${escapeHtml(projectLabel(activeProject))} | ${escapeHtml(activeProject.location.trim() || "Location not specified")}</p>
        </div>
        <button type="button" class="secondary-button project-tab-shortcut" data-app-view="project">Project</button>
      </div>
      ${projectLineNotice ? `<p class="project-line-notice" role="status" aria-live="polite" aria-atomic="true" data-project-line-notice>${escapeHtml(projectLineNotice)}</p>` : ""}
      <form id="add-project-item-form" class="add-project-form">
        <input type="hidden" name="costSource" value="manual" />
        <label class="add-project-cost-field"><span>Unit cost</span><input name="preferredUnitCost" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" required /></label>
        <label><span>Quantity</span><input name="quantity" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" required /></label>
        <label class="add-project-notes-field"><span>Line notes</span><textarea name="notes" rows="2"></textarea></label>
        <button type="submit" class="primary-button add-project-submit">Add to Project</button>
      </form>
    </section>
  `;
}

export function renderProjectWorkspace(
  project: UserProject | null,
  projects: UserProject[],
  states: StateConfig[],
  currentStateCode: string,
  readOnly: boolean,
  editor: ProjectMetadataEditorView | null
): string {
  const workspaceEditor = editor?.context === "workspace" ? editor : null;
  const totalProjectCost = project ? projectTotal(project) : 0;
  return `
    <section class="project-workspace">
      ${project && readOnly ? `
        <div class="project-readonly-warning" role="status">
          <span>This Project is being edited in another browser tab.</span>
          <button type="button" class="secondary-button" data-take-over-project="${escapeHtml(project.projectId)}">Take over editing</button>
        </div>
      ` : ""}
      <section class="panel-block project-detail-panel">
        <div class="panel-heading project-workspace-heading">
          ${workspaceEditor
            ? renderMetadataEditor(workspaceEditor, states, currentStateCode, "project-metadata-editor-form")
            : project
              ? renderProjectMetadata(project)
              : `<div class="project-empty-heading"><p class="eyebrow">Project</p><h2>No active Project</h2></div>`}
          <div class="project-header-actions">
            ${renderProjectActions(project, projects, "workspace", readOnly)}
          </div>
        </div>
      </section>

      ${!project && !workspaceEditor ? `<section class="panel-block project-empty-workspace"><button type="button" class="primary-button" data-start-new-project>New Project</button></section>` : ""}
      ${project && workspaceEditor?.mode !== "create" ? `<section class="panel-block project-lines-panel">
        <div class="panel-heading project-lines-heading">
          <div><p class="eyebrow">Project Items</p><h3>${formatNumber(project.lineItems.length)} line${project.lineItems.length === 1 ? "" : "s"}</h3></div>
          <div class="project-total"><span>Total Project Cost</span><strong>${formatCurrency(totalProjectCost)}</strong></div>
        </div>
        ${project.lineItems.length === 0 ? "" : renderProjectLineTable(project, readOnly)}
      </section>` : ""}
    </section>
  `;
}

export function renderProjectManager(
  projects: UserProject[],
  states: StateConfig[],
  currentStateCode: string,
  filters: ProjectManagerFilters,
  activeProject: UserProject | null,
  activeProjectReadOnly: boolean,
  editor: ProjectMetadataEditorView | null
): string {
  const stateNames = new Map(states.map((state) => [state.code, state.name]));
  const query = filters.query.trim().toLowerCase();
  const filtered = projects
    .filter((project) => project.status === filters.status)
    .filter((project) => filters.state === "all" || project.state === filters.state)
    .filter((project) => !query || `${project.name} ${project.location}`.toLowerCase().includes(query))
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  return `
    <section class="project-manager">
      <section class="panel-block project-manager-heading">
        <div><p class="eyebrow">Projects</p><h2>Project manager</h2></div>
        <div class="project-manager-heading-actions">
          <button type="button" class="secondary-button" data-close-project-manager>Back to active Project</button>
          ${renderProjectActions(activeProject, projects, "manager", activeProjectReadOnly)}
        </div>
      </section>

      ${editor?.context === "manager" ? `<section class="panel-block project-create-panel">${renderMetadataEditor(editor, states, currentStateCode, "manager-project-editor-form")}</section>` : ""}

      <section class="panel-block project-manager-list-panel">
        <form id="project-manager-filter-form" class="project-manager-filters">
          <label><span>Search</span><input name="query" value="${escapeHtml(filters.query)}" placeholder="Name or location" /></label>
          <label><span>State</span><select name="state"><option value="all">All states</option>${states.map((state) => `<option value="${escapeHtml(state.code)}" ${filters.state === state.code ? "selected" : ""}>${escapeHtml(state.name)}</option>`).join("")}</select></label>
          <label><span>Status</span><select name="status"><option value="active" ${filters.status === "active" ? "selected" : ""}>Active</option><option value="archived" ${filters.status === "archived" ? "selected" : ""}>Archived</option></select></label>
        </form>
        <div class="table-scroll" tabindex="0" aria-label="Project list">
          <table class="project-manager-table">
            <thead><tr><th>Project</th><th>State</th><th>Location</th><th>Items</th><th>Total</th><th>Updated</th><th>Actions</th></tr></thead>
            <tbody>
              ${filtered.length ? filtered.map((project) => renderManagerRow(project, stateNames, activeProjectReadOnly ? activeProject?.projectId ?? null : null)).join("") : `<tr><td colspan="7" class="muted">No Projects match these filters.</td></tr>`}
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `;
}

function renderProjectActions(
  activeProject: UserProject | null,
  projects: UserProject[],
  subview: ProjectWorkspaceSubview,
  readOnly: boolean
): string {
  const recent = projects.filter((project) => project.status === "active")
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, 5);
  return `
    <details class="project-switcher">
      <summary>Project Actions</summary>
      <div class="project-switcher-menu">
        ${recent.map((project) => `
          <button type="button" class="project-switcher-project" data-activate-project="${escapeHtml(project.projectId)}" ${project.projectId === activeProject?.projectId ? "disabled" : ""}><span>${escapeHtml(projectLabel(project))}</span><span class="project-switcher-project-state">${escapeHtml(project.state)}</span></button>
        `).join("")}
        <div class="project-switcher-actions">
          <button type="button" data-start-new-project>New Project</button>
          <button type="button" data-edit-active-project ${!activeProject || readOnly ? "disabled" : ""}>Edit Active Project</button>
          <button type="button" data-open-project-manager ${subview === "manager" ? "disabled" : ""}>Manage Projects</button>
          <button type="button" id="download-project-csv" ${!activeProject || activeProject.lineItems.length === 0 ? "disabled" : ""}>Export CSV</button>
          <button type="button" data-backup-project="${activeProject ? escapeHtml(activeProject.projectId) : ""}" ${!activeProject ? "disabled" : ""}>Export Project Backup</button>
          <button type="button" data-import-project>Import Project Backup</button>
          <input type="file" accept=".json,.rce-project.json,application/json" data-project-import-input hidden />
        </div>
      </div>
    </details>
  `;
}

function renderProjectMetadata(project: UserProject): string {
  return `
    <div class="project-metadata-display">
      <div class="project-identity-display">
        <h2>${escapeHtml(projectLabel(project))}</h2>
        <p>${escapeHtml(project.location.trim() || "Location not specified")}</p>
      </div>
      <div class="project-notes-display">
        <span>Project notes</span>
        <p>${escapeHtml(project.notes.trim() || "No project notes")}</p>
      </div>
    </div>
  `;
}

function renderMetadataEditor(
  editor: ProjectMetadataEditorView,
  states: StateConfig[],
  currentStateCode: string,
  formId: string
): string {
  const isManagerCreate = editor.context === "manager" && editor.mode === "create";
  const stateCode = editor.state || currentStateCode;
  const actionLabel = editor.mode === "create" ? "Create Project" : "Save Changes";
  return `
    <form id="${formId}" class="project-metadata-editor-form" data-project-editor-context="${editor.context}" data-project-editor-mode="${editor.mode}">
      <div class="project-editor-heading"><p class="eyebrow">${editor.mode === "create" ? "New Project" : "Edit Project"}</p><h2>${editor.mode === "create" ? `Create a ${escapeHtml(stateName(states, stateCode))} Project` : escapeHtml(editor.name.trim() || "Unnamed Project")}</h2></div>
      <label><span>Project name</span><input name="name" value="${escapeHtml(editor.name)}" required autocomplete="off" /></label>
      <label><span>State</span>${isManagerCreate
        ? `<select name="state">${states.map((state) => `<option value="${escapeHtml(state.code)}" ${state.code === stateCode ? "selected" : ""}>${escapeHtml(state.name)}</option>`).join("")}</select>`
        : `<input value="${escapeHtml(stateName(states, stateCode))}" disabled /><input type="hidden" name="state" value="${escapeHtml(stateCode)}" />`}</label>
      <label><span>Location</span><input name="location" value="${escapeHtml(editor.location)}" autocomplete="off" /></label>
      <label class="project-editor-notes"><span>Notes</span><textarea name="notes" rows="3">${escapeHtml(editor.notes)}</textarea></label>
      <div class="project-editor-actions"><button type="submit" class="primary-button">${actionLabel}</button><button type="button" class="secondary-button" data-cancel-project-editor>Cancel</button></div>
    </form>
  `;
}

function renderManagerRow(project: UserProject, stateNames: Map<string, string>, readOnlyProjectId: string | null): string {
  return `
    <tr>
      <td><strong>${escapeHtml(projectLabel(project))}</strong></td>
      <td>${escapeHtml(stateNames.get(project.state) ?? project.state)}</td>
      <td>${escapeHtml(project.location || "—")}</td>
      <td>${formatNumber(project.lineItems.length)}</td>
      <td>${formatCurrency(projectTotal(project))}</td>
      <td>${formatDateTime(project.updatedAt)}</td>
      <td class="project-manager-actions">
        ${project.status === "active" ? `<button type="button" class="text-button" data-open-project="${escapeHtml(project.projectId)}">Open</button>` : `<button type="button" class="text-button" data-restore-project="${escapeHtml(project.projectId)}">Restore</button>`}
        <button type="button" class="text-button" data-edit-project="${escapeHtml(project.projectId)}" ${project.projectId === readOnlyProjectId ? "disabled" : ""}>Edit</button>
        <button type="button" class="text-button" data-duplicate-project="${escapeHtml(project.projectId)}">Duplicate</button>
        <button type="button" class="text-button" data-backup-project="${escapeHtml(project.projectId)}">Export backup</button>
        ${project.status === "active"
          ? `<button type="button" class="text-button" data-archive-project="${escapeHtml(project.projectId)}">Archive</button>`
          : `<button type="button" class="project-line-remove-button project-delete-button" data-delete-project="${escapeHtml(project.projectId)}" aria-label="Permanently delete ${escapeHtml(projectLabel(project))}" title="Permanently delete Project">${trashIcon()}</button>`}
      </td>
    </tr>
  `;
}

function renderDuplicateProjectLinePanel(project: UserProject, pendingDuplicateLine: PendingDuplicateProjectLine): string {
  const existingLines = project.lineItems.filter((lineItem) => pendingDuplicateLine.matchingLineIds.includes(lineItem.lineItemId));
  return `
    <section class="add-project-panel duplicate-project-panel">
      <div class="panel-heading"><h3>${escapeHtml(pendingDuplicateLine.lineItem.itemCode)} already exists in Project</h3></div>
      <form id="duplicate-project-item-form" class="duplicate-project-form">
        <div class="duplicate-line-list">${existingLines.map((lineItem, index) => `<label class="duplicate-line-option"><input type="radio" name="lineItemId" value="${escapeHtml(lineItem.lineItemId)}" ${index === 0 ? "checked" : ""} /><span><strong>${escapeHtml(lineItem.itemCode)} - ${escapeHtml(lineItem.description)}</strong><small>${formatNumber(lineItem.quantity)} ${escapeHtml(lineItem.unit)} at ${formatCurrency(lineItem.preferredUnitCost)}</small></span></label>`).join("")}</div>
        <div class="duplicate-project-actions"><button type="button" class="secondary-button" data-duplicate-project-action="cancel">Cancel</button><button type="button" class="secondary-button" data-duplicate-project-action="add">Add as new line</button><button type="button" class="primary-button" data-duplicate-project-action="update">Update selected existing line</button></div>
      </form>
    </section>
  `;
}

function renderProjectLineTable(project: UserProject, readOnly: boolean): string {
  return `<div class="table-scroll-shell project-table-shell"><div class="table-scroll" tabindex="0" aria-label="Project item table"><table class="project-line-table"><thead><tr><th>Item code</th><th>Description</th><th>Unit Cost</th><th>Unit</th><th>Quantity</th><th>Total Item Cost</th><th>Notes</th><th>Remove</th></tr></thead><tbody>${project.lineItems.map((lineItem) => renderProjectLineRow(lineItem, readOnly)).join("")}</tbody></table></div></div>`;
}

function renderProjectLineRow(lineItem: ProjectLineItem, readOnly: boolean): string {
  return `<tr><td>${escapeHtml(lineItem.itemCode)}</td><td>${escapeHtml(lineItem.description)}</td><td><input name="preferredUnitCost" class="project-line-number-input" data-project-line-id="${escapeHtml(lineItem.lineItemId)}" data-project-line-field="preferredUnitCost" value="${lineItem.preferredUnitCost}" inputmode="decimal" ${readOnly ? "disabled" : ""} /></td><td>${escapeHtml(lineItem.unit)}</td><td><input name="quantity" class="project-line-number-input" data-project-line-id="${escapeHtml(lineItem.lineItemId)}" data-project-line-field="quantity" value="${lineItem.quantity}" inputmode="decimal" ${readOnly ? "disabled" : ""} /></td><td>${formatCurrency(lineItem.quantity * lineItem.preferredUnitCost)}</td><td><input name="notes" class="project-line-notes-input" data-project-line-id="${escapeHtml(lineItem.lineItemId)}" data-project-line-field="notes" value="${escapeHtml(lineItem.notes)}" ${readOnly ? "disabled" : ""} /></td><td><button type="button" class="project-line-remove-button" data-remove-project-line-id="${escapeHtml(lineItem.lineItemId)}" aria-label="Remove ${escapeHtml(lineItem.itemCode)} from project" title="Remove line" ${readOnly ? "disabled" : ""}>${trashIcon()}</button></td></tr>`;
}

function trashIcon(): string { return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" /><path d="M6 9h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" /></svg>`; }
function projectLabel(project: UserProject): string { return project.name.trim() || "Unnamed Project"; }
function projectTotal(project: UserProject): number { return project.lineItems.reduce((sum, line) => sum + line.quantity * line.preferredUnitCost, 0); }
function formatCurrency(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value); }
function formatNumber(value: number): string { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" }); }
function stateName(states: StateConfig[], stateCode: string): string { return states.find((state) => state.code === stateCode)?.name ?? stateCode; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char); }
