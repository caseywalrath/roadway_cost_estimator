import type { EvidenceResult, StateConfig } from "../data/schema";
import {
  DEFAULT_PROJECT_SORT,
  calculateProject,
  projectConstructionCost,
  projectContingencyCost,
  projectLineTotal,
  projectOtherCost,
  projectGroupSuggestions,
  projectTotal,
  sortProjectLineItems,
  type ProjectCostCategory,
  type ProjectLineItem,
  type ProjectSort,
  type ProjectSortKey,
  type UserProject
} from "../projects/projectWorkspace";

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

const PROJECT_SORTABLE_COLUMNS: Array<{ key: ProjectSortKey; label: string }> = [
  { key: "group", label: "Group" },
  { key: "costCategory", label: "Cost Category" },
  { key: "itemCode", label: "Item Code" },
  { key: "description", label: "Description" },
  { key: "preferredUnitCost", label: "Unit Cost" },
  { key: "unit", label: "Unit / Base" },
  { key: "quantity", label: "Quantity" },
  { key: "totalItemCost", label: "Total Item Cost" },
  { key: "notes", label: "Notes" }
];

export function renderAddToProjectPanel(
  result: EvidenceResult,
  activeProject: UserProject | null,
  pendingDuplicateLine: PendingDuplicateProjectLine | null,
  projectLineNotice: string | null,
  sourceLine: ProjectLineItem | null = null
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
        <div class="add-project-title">
          <div class="step-heading add-project-step-heading" aria-label="Step 4 Add Item to Project">
            <span class="step-number" aria-hidden="true">4</span>
            <h3>${sourceLine ? "Update Project Item" : "Add Item to Project"}</h3>
          </div>
          <p class="query-line">${escapeHtml(projectLabel(activeProject))} | ${escapeHtml(activeProject.location.trim() || "Location not specified")}</p>
          ${sourceLine ? `<p class="query-line">Editing ${escapeHtml(sourceLine.itemCode)} — ${escapeHtml(sourceLine.description)}</p>` : ""}
        </div>
        <button type="button" class="secondary-button project-tab-shortcut" data-app-view="project">View Project</button>
      </div>
      ${projectLineNotice ? `<p class="project-line-notice" role="status" aria-live="polite" aria-atomic="true" data-project-line-notice>${escapeHtml(projectLineNotice)}</p>` : ""}
      ${renderProjectGroupDatalist(activeProject)}
      <form id="add-project-item-form" class="add-project-form">
        <input type="hidden" name="costSource" value="manual" />
        <label class="add-project-group-field"><span>Group</span><input name="group" list="${escapeHtml(projectGroupListId(activeProject))}" autocomplete="off" value="${escapeHtml(sourceLine?.group ?? "")}" /></label>
        <label class="add-project-cost-field"><span>Unit cost</span><input name="preferredUnitCost" type="text" inputmode="decimal" value="${sourceLine?.preferredUnitCost ?? ""}" ${sourceLine ? "" : "required"} /></label>
        <label><span>Quantity</span><input name="quantity" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" value="${sourceLine?.quantity ?? ""}" ${sourceLine ? "" : "required"} /></label>
        <label class="add-project-notes-field"><span>Line notes</span><textarea name="notes" rows="2">${escapeHtml(sourceLine?.notes ?? "")}</textarea></label>
        <button type="submit" class="primary-button add-project-submit">${sourceLine ? "Update Item" : "Add to Project"}</button>
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
  editor: ProjectMetadataEditorView | null,
  projectSort: ProjectSort = DEFAULT_PROJECT_SORT
): string {
  const workspaceEditor = editor?.context === "workspace" ? editor : null;
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
              : `<div class="project-empty-heading"><h2>No Active Project</h2></div>`}
          <div class="project-header-actions">
            ${renderProjectActions(project, projects, "workspace", readOnly)}
          </div>
        </div>
      </section>

      ${!project && !workspaceEditor ? `<section class="panel-block project-empty-workspace"><button type="button" class="primary-button" data-start-new-project>New Project</button></section>` : ""}
      ${project && workspaceEditor?.mode !== "create" ? `<section class="panel-block project-lines-panel">
        <div class="panel-heading project-lines-heading">
          <div>
            <p class="eyebrow">Project Items</p>
            ${project.lineItems.length === 0 ? `<button type="button" class="secondary-button project-add-item-button" data-add-custom-project-line ${readOnly ? "disabled" : ""}>+Add Item</button>` : ""}
          </div>
          ${renderProjectCostSummary(project, readOnly)}
        </div>
        ${project.lineItems.length === 0 ? "" : renderProjectLineTable(project, readOnly, projectSort)}
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
        <div><h2>Project Manager</h2></div>
        <div class="project-manager-heading-actions">
          <button type="button" class="primary-button" data-start-new-project>New Project</button>
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
        </div>
        <div class="project-switcher-actions">
          <button type="button" data-start-excel-import>Import from Excel</button>
          <button type="button" data-import-project>Import Project Backup</button>
        </div>
        <div class="project-switcher-actions">
          <button type="button" id="download-project-csv" ${!activeProject || activeProject.lineItems.length === 0 ? "disabled" : ""}>Download Project CSV</button>
          <button type="button" data-backup-project="${activeProject ? escapeHtml(activeProject.projectId) : ""}" ${!activeProject ? "disabled" : ""}>Download Project Backup</button>
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
  const isCreate = editor.mode === "create";
  const stateCode = editor.state || currentStateCode;
  const actionLabel = editor.mode === "create" ? "Create Project" : "Save Changes";
  return `
    <form id="${formId}" class="project-metadata-editor-form" data-project-editor-context="${editor.context}" data-project-editor-mode="${editor.mode}">
      <div class="project-editor-heading"><h2>${editor.mode === "create" ? "New Project" : escapeHtml(editor.name.trim() || "Unnamed Project")}</h2></div>
      <label><span>Project name</span><input name="name" value="${escapeHtml(editor.name)}" required autocomplete="off" /></label>
      <label><span>State</span>${isCreate
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
        <button type="button" class="text-button" data-backup-project="${escapeHtml(project.projectId)}">Download Project Backup</button>
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
        <p class="query-line">${pendingDuplicateLine.lineItem.group ? `Group: ${escapeHtml(pendingDuplicateLine.lineItem.group)}` : "No Group specified"}</p>
        <div class="duplicate-line-list">${existingLines.map((lineItem, index) => `<label class="duplicate-line-option"><input type="radio" name="lineItemId" value="${escapeHtml(lineItem.lineItemId)}" ${index === 0 ? "checked" : ""} /><span><strong>${escapeHtml(lineItem.itemCode)} - ${escapeHtml(lineItem.description)}</strong><small>${lineItem.group ? `Group: ${escapeHtml(lineItem.group)} | ` : ""}${formatNumber(lineItem.quantity ?? 0)} ${escapeHtml(lineItem.unit)} at ${formatCurrency(lineItem.preferredUnitCost ?? 0)}</small></span></label>`).join("")}</div>
        <div class="duplicate-project-actions"><button type="button" class="secondary-button" data-duplicate-project-action="cancel">Cancel</button><button type="button" class="secondary-button" data-duplicate-project-action="add">Add as new line</button><button type="button" class="primary-button" data-duplicate-project-action="update">Update selected existing line</button></div>
      </form>
    </section>
  `;
}

function renderProjectLineTable(project: UserProject, readOnly: boolean, projectSort: ProjectSort): string {
  const sortedLineItems = sortProjectLineItems(project.lineItems, projectSort, project);
  const groupListId = projectGroupListId(project);
  const calculation = calculateProject(project);
  return `<div class="table-scroll-shell project-table-shell">${renderProjectGroupDatalist(project)}<div class="table-scroll table-scroll--sticky-results" tabindex="0" aria-label="Project item table"><table class="project-line-table"><thead><tr>${PROJECT_SORTABLE_COLUMNS.map((column) => renderProjectSortableHeader(column, projectSort)).join("")}<th>Remove</th></tr></thead><tbody>${sortedLineItems.map((lineItem) => renderProjectLineRow(lineItem, project, calculation, readOnly, groupListId)).join("")}</tbody></table></div><button type="button" class="primary-button project-add-item-dock" data-add-custom-project-line aria-label="Add item to Project" title="Add item to Project" ${readOnly ? "disabled" : ""} hidden><span aria-hidden="true">+</span><span class="project-add-item-dock__label" aria-hidden="true">Project Item</span></button></div>`;
}

function renderProjectCostSummary(project: UserProject, readOnly: boolean): string {
  return `
    <div class="project-cost-summary" aria-label="Project cost summary">
      <div class="project-cost-breakdown">
        <div class="project-cost-metric">
          <span>Construction Costs</span>
          <strong data-project-construction-cost>${formatCurrency(projectConstructionCost(project))}</strong>
        </div>
        <div class="project-cost-metric">
          <span>Other costs</span>
          <strong data-project-other-cost>${formatCurrency(projectOtherCost(project))}</strong>
        </div>
        <div class="project-cost-metric project-cost-metric--contingency">
          <span>Contingencies</span>
          <div class="project-contingency-value">
            <strong data-project-contingency-cost>${formatCurrency(projectContingencyCost(project))}</strong>
          </div>
        </div>
      </div>
      <div class="project-total"><span>Total Project Cost</span><strong data-project-total>${formatCurrency(projectTotal(project))}</strong></div>
    </div>
  `;
}

function renderProjectSortableHeader(column: { key: ProjectSortKey; label: string }, sort: ProjectSort): string {
  const isActive = sort.key === column.key;
  const ariaSort = isActive ? (sort.direction === "asc" ? "ascending" : "descending") : "none";
  const nextDirection = isActive && sort.direction === "asc" ? "descending" : "ascending";
  return `
    <th aria-sort="${ariaSort}" class="${isActive ? "table-sorted-column" : ""}">
      <button
        type="button"
        class="table-sort-button"
        data-project-sort-key="${column.key}"
        aria-label="Sort by ${escapeHtml(column.label)} ${nextDirection}"
      >
        <span>${escapeHtml(column.label)}</span>
        <span class="sort-indicator sort-indicator--${isActive ? sort.direction : "inactive"}" aria-hidden="true"></span>
      </button>
    </th>
  `;
}

function renderProjectLineRow(lineItem: ProjectLineItem, project: UserProject, calculation: ReturnType<typeof calculateProject>, readOnly: boolean, groupListId: string): string {
  const custom = lineItem.lineItemType === "custom";
  if (lineItem.pricingMode === "percentage") return renderPercentageLineRow(lineItem, project, calculation, readOnly, groupListId);
  const catalog = lineItem.lineItemType === "catalog";
  const descriptionEditable = custom || lineItem.descriptionOverrideEnabled;
  const disabled = readOnly ? "disabled" : "";
  return `<tr class="${custom ? "project-line-row--custom" : ""}">
    <td>${renderProjectLineInput(lineItem, "group", "Group", "project-line-group-input", disabled, "text", groupListId)}</td>
    <td>${renderProjectCostCategorySelect(lineItem, disabled)}</td>
    <td>${custom ? renderProjectLineInput(lineItem, "itemCode", "Item Code", "project-line-text-input", disabled) : catalog ? renderCatalogExplorerLink(lineItem) : escapeHtml(lineItem.itemCode)}</td>
    <td class="project-line-description-cell"><div class="project-description-main">${descriptionEditable
      ? renderProjectLineInput(lineItem, "description", "Description", "project-line-text-input", disabled)
      : `${escapeHtml(lineItem.description)}${readOnly ? "" : renderDescriptionOverrideButton(lineItem)}`}</div></td>
    <td><span class="project-line-currency">${custom ? renderProjectPricingModeControl(lineItem, disabled) : `<span aria-hidden="true" data-currency-prefix>$</span>`}${renderProjectLineInput(lineItem, "preferredUnitCost", "Unit Cost", "project-line-number-input project-line-cost-input", disabled, "decimal")}</span></td>
    <td>${custom ? renderProjectLineInput(lineItem, "unit", "Unit", "project-line-unit-input", disabled) : escapeHtml(lineItem.unit)}</td>
    <td>${renderProjectLineInput(lineItem, "quantity", "Quantity", "project-line-number-input", disabled, "decimal")}</td>
    <td data-project-line-total-id="${escapeHtml(lineItem.lineItemId)}">${formatCurrency(calculation.amountByLineId[lineItem.lineItemId] ?? 0)}</td>
    <td>${renderProjectLineInput(lineItem, "notes", "Notes", "project-line-notes-input", disabled)}</td>
    <td><button type="button" class="project-line-remove-button" data-remove-project-line-id="${escapeHtml(lineItem.lineItemId)}" aria-label="Remove ${escapeHtml(lineItem.itemCode || "custom item")} from project" title="Remove line" ${disabled}>${trashIcon()}</button></td>
  </tr>`;
}

function renderPercentageLineRow(line: ProjectLineItem, project: UserProject, calculation: ReturnType<typeof calculateProject>, readOnly: boolean, groupListId: string): string {
  const disabled = readOnly ? "disabled" : "";
  return `<tr class="project-line-row--custom project-line-row--percentage">
    <td>${renderProjectLineInput(line, "group", "Group", "project-line-group-input", disabled, "text", groupListId)}</td>
    <td>${renderProjectCostCategorySelect(line, disabled)}</td>
    <td>${renderProjectLineInput(line, "itemCode", "Item Code", "project-line-text-input", disabled)}</td>
    <td class="project-line-description-cell"><div class="project-description-main">${renderProjectLineInput(line, "description", "Description", "project-line-text-input", disabled)}</div>
      <small class="project-percentage-warning" data-project-percentage-warning="${escapeHtml(line.lineItemId)}" ${calculation.warningsByLineId[line.lineItemId] ? "" : "hidden"}>${escapeHtml(calculation.warningsByLineId[line.lineItemId] ?? "")}</small>
    </td>
    <td><span class="project-line-currency">${renderProjectPricingModeControl(line, disabled)}</span></td>
    <td>${renderProjectPercentageBaseControl(project, line, disabled)}</td>
    <td><span class="project-percentage-rate-field"><input type="text" inputmode="decimal" class="project-line-number-input" data-project-percentage-rate="${escapeHtml(line.lineItemId)}" aria-label="Percentage rate" value="${escapeHtml(String(line.percentageRate ?? 0))}" ${disabled} /><span aria-hidden="true">%</span></span></td>
    <td data-project-line-total-id="${escapeHtml(line.lineItemId)}">${formatCurrency(calculation.amountByLineId[line.lineItemId] ?? 0)}</td>
    <td>${renderProjectLineInput(line, "notes", "Notes", "project-line-notes-input", disabled)}</td>
    <td><button type="button" class="project-line-remove-button" data-remove-project-line-id="${escapeHtml(line.lineItemId)}" aria-label="Remove percentage item" title="Remove line" ${disabled}>${trashIcon()}</button></td>
  </tr>`;
}

function renderProjectPricingModeControl(line: ProjectLineItem, disabled: string): string {
  const percentage = line.pricingMode === "percentage";
  const targetMode = percentage ? "fixed" : "percentage";
  const targetLabel = percentage ? "dollar figure" : "percentage";
  const symbol = percentage ? "%" : "$";
  return `<span class="project-pricing-mode">
    <button type="button" data-project-pricing-mode="${targetMode}" data-project-line-id="${escapeHtml(line.lineItemId)}" aria-label="Switch to ${targetLabel}" title="Click to switch to ${targetLabel}" ${disabled}>${symbol}</button>
  </span>`;
}

function renderProjectPercentageBaseControl(project: UserProject, line: ProjectLineItem, disabled: string): string {
  const base = line.percentageBase ?? { kind: "construction_fixed" as const };
  const baseValue = base.kind === "group" ? `group:${base.group}` : base.kind === "selected_lines" ? "selected_lines-current" : base.kind;
  const fixed = project.lineItems.filter((item) => item.pricingMode !== "percentage");
  const groups = projectGroupSuggestions({ ...project, lineItems: fixed });
  if (base.kind === "group" && !groups.some((group) => group.toLocaleLowerCase() === base.group.toLocaleLowerCase())) groups.push(base.group);
  const options: Array<{ value: string; label: string; hidden?: boolean }> = [
        { value: "all_fixed", label: "All fixed costs" },
    { value: "construction_fixed", label: "Construction costs" },
    { value: "other_fixed", label: "Other costs" },
    ...groups.map((group) => ({ value: `group:${group}`, label: `Group: ${group}` })),
    ...(base.kind === "selected_lines" ? [{ value: "selected_lines-current", label: "Selected Items", hidden: true }] : []),
    { value: "selected_lines", label: "Selected Items" }
  ];
  const baseLabel = options.find((option) => option.value === baseValue)?.label ?? "Construction costs";
  return `<div class="project-percentage-base-control">
    <select class="project-percentage-base-select" data-project-percentage-base="${escapeHtml(line.lineItemId)}" aria-label="Percentage base" title="${escapeHtml(baseLabel)}" ${disabled}>${options.map((option) => `<option value="${escapeHtml(option.value)}" ${option.hidden ? "hidden disabled" : ""} ${option.value === baseValue ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}</select>
  </div>`;
}

export function renderProjectFixedItemSelector(project: UserProject, line: ProjectLineItem): string {
  const fixed = project.lineItems.filter((item) => item.pricingMode !== "percentage");
  const selectedIds = new Set(line.percentageBase?.kind === "selected_lines" ? line.percentageBase.lineItemIds : []);
  const missingCount = [...selectedIds].filter((id) => !fixed.some((item) => item.lineItemId === id)).length;
  const groups = projectGroupSuggestions({ ...project, lineItems: fixed });
  return `<aside class="project-fixed-items-panel" role="dialog" aria-modal="false" aria-labelledby="project-fixed-items-title">
    <div class="project-fixed-items-heading">
      <div><p class="eyebrow">Percentage base</p><h3 id="project-fixed-items-title">Select Items</h3><p>${escapeHtml(line.description || "Percentage item")} · Fixed-cost items only</p></div>
      <button type="button" class="project-fixed-items-close" data-project-fixed-items-cancel aria-label="Close fixed item selector">×</button>
    </div>
    <div class="project-fixed-items-filters">
      <label>Search<input type="search" data-project-fixed-items-search placeholder="Code or description" /></label>
      <label>Group<select data-project-fixed-items-group><option value="">All groups</option>${groups.map((group) => `<option value="${escapeHtml(group)}">${escapeHtml(group)}</option>`).join("")}</select></label>
      <label>Cost category<select data-project-fixed-items-category><option value="">All categories</option><option value="construction">Construction</option><option value="other">Other</option><option value="contingency">Contingency</option></select></label>
    </div>
    ${missingCount ? `<p class="project-fixed-items-warning" role="status">${missingCount} previously selected item${missingCount === 1 ? " is" : "s are"} no longer available. Applying will remove ${missingCount === 1 ? "it" : "them"} from this base.</p>` : ""}
    <div class="project-fixed-items-list" role="group" aria-label="Fixed project items">
      ${fixed.length ? fixed.map((item) => `<label class="project-fixed-item-option" data-project-fixed-item-row data-search="${escapeHtml(`${item.itemCode} ${item.description}`.toLocaleLowerCase())}" data-group="${escapeHtml(item.group.toLocaleLowerCase())}" data-category="${escapeHtml(item.costCategory)}">
        <input type="checkbox" value="${escapeHtml(item.lineItemId)}" data-project-fixed-item-choice ${selectedIds.has(item.lineItemId) ? "checked" : ""} />
        <span><strong>${escapeHtml(item.itemCode || "Custom item")}</strong><span>${escapeHtml(item.description || "Unnamed item")}</span><small>${escapeHtml(item.group || "No group")} · ${item.costCategory === "construction" ? "Construction" : item.costCategory === "contingency" ? "Contingency" : "Other"}</small></span>
        <span class="project-fixed-item-amount">${formatCurrency(projectLineTotal(item))}</span>
      </label>`).join("") : `<p class="muted">This Project has no fixed items.</p>`}
      <p class="project-fixed-items-empty" data-project-fixed-items-empty hidden>No fixed items match these filters.</p>
    </div>
    <div class="project-fixed-items-footer"><span data-project-fixed-items-summary></span><div><button type="button" class="secondary-button" data-project-fixed-items-cancel>Cancel</button><button type="button" class="primary-button" data-project-fixed-items-apply>Apply</button></div></div>
  </aside>`;
}

function renderDescriptionOverrideButton(lineItem: ProjectLineItem): string {
  const label = `Edit description for ${lineItem.itemCode || "catalog item"}`;
  return `<button type="button" class="project-line-description-edit-button" data-enable-project-line-description="${escapeHtml(lineItem.lineItemId)}" aria-label="${escapeHtml(label)}" title="Edit description">${editIcon()}</button>`;
}

function renderCatalogExplorerLink(lineItem: ProjectLineItem): string {
  const label = `Open Explorer results for ${lineItem.itemCode}${lineItem.description ? ` — ${lineItem.description}` : ""}`;
  return `<a href="#explorer" class="project-catalog-explorer-link" data-open-catalog-explorer data-project-line-id="${escapeHtml(lineItem.lineItemId)}" aria-label="${escapeHtml(label)}">${escapeHtml(lineItem.itemCode)}</a>`;
}

function renderProjectLineInput(
  lineItem: ProjectLineItem,
  field: "group" | "itemCode" | "description" | "preferredUnitCost" | "unit" | "quantity" | "notes",
  label: string,
  className: string,
  disabled: string,
  inputMode = "text",
  listId?: string
): string {
  const value = lineItem[field] ?? "";
  return `<input name="${field}" aria-label="${label}" class="${className}" data-project-line-id="${escapeHtml(lineItem.lineItemId)}" data-project-line-field="${field}" value="${escapeHtml(String(value))}" inputmode="${inputMode}" ${listId ? `list="${escapeHtml(listId)}"` : ""} ${disabled} />`;
}

function renderProjectCostCategorySelect(lineItem: ProjectLineItem, disabled: string): string {
  const options: Array<{ value: ProjectCostCategory; label: string }> = [
    { value: "construction", label: "Construction" },
    { value: "contingency", label: "Contingency" },
    { value: "other", label: "Other" }
  ];
  return `<select name="costCategory" aria-label="Cost Category" class="project-line-category-select" data-project-line-id="${escapeHtml(lineItem.lineItemId)}" data-project-line-field="costCategory" ${disabled}>${options.map((option) => `<option value="${option.value}" ${lineItem.costCategory === option.value ? "selected" : ""}>${option.label}</option>`).join("")}</select>`;
}

function renderProjectGroupDatalist(project: UserProject): string {
  return `<datalist id="${escapeHtml(projectGroupListId(project))}" data-project-group-options>${projectGroupSuggestions(project).map((group) => `<option value="${escapeHtml(group)}"></option>`).join("")}</datalist>`;
}

function projectGroupListId(project: UserProject): string {
  return `project-group-options-${project.projectId}`;
}

function trashIcon(): string { return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" /><path d="M6 9h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" /></svg>`; }
function editIcon(): string { return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m4 16.5-.8 4.3 4.3-.8L19 8.5 15.5 5 4 16.5Zm12.2-12.2 1.3-1.3a1.8 1.8 0 0 1 2.5 0l1 1a1.8 1.8 0 0 1 0 2.5l-1.3 1.3-3.5-3.5Z" /></svg>`; }
function projectLabel(project: UserProject): string { return project.name.trim() || "Unnamed Project"; }
function formatCurrency(value: number): string { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value); }
function formatNumber(value: number): string { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value); }
function formatDateTime(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "—" : date.toLocaleString([], { dateStyle: "short", timeStyle: "short" }); }
function stateName(states: StateConfig[], stateCode: string): string { return states.find((state) => state.code === stateCode)?.name ?? stateCode; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char); }
