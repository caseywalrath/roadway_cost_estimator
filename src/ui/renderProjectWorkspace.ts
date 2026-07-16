import type { EvidenceResult } from "../data/schema";
import type { ProjectLineItem, UserProject } from "../projects/projectWorkspace";

export interface PendingDuplicateProjectLine {
  lineItem: ProjectLineItem;
  matchingLineIds: string[];
}

export function renderAddToProjectPanel(
  result: EvidenceResult,
  activeProject: UserProject | null,
  pendingDuplicateLine: PendingDuplicateProjectLine | null,
  projectLineNotice: string | null
): string {
  if (!result.query.itemCode || !activeProject) {
    return "";
  }

  if (pendingDuplicateLine) {
    return renderDuplicateProjectLinePanel(activeProject, pendingDuplicateLine);
  }

  return `
    <section class="add-project-panel">
      <div class="panel-heading add-project-heading">
        <div>
          <h3>Add Item to Project</h3>
          <p class="query-line">${escapeHtml(activeProject.name.trim() || "Unnamed Project")} | ${escapeHtml(activeProject.location.trim() || "Location not specified")}</p>
        </div>
        <button type="button" class="secondary-button project-tab-shortcut" data-app-view="project">Project</button>
      </div>
      ${projectLineNotice ? `<p class="project-line-notice" role="status" aria-live="polite" aria-atomic="true" data-project-line-notice>${escapeHtml(projectLineNotice)}</p>` : ""}
      <form id="add-project-item-form" class="add-project-form">
        <input type="hidden" name="costSource" value="manual" />
        <label class="add-project-cost-field">
          <span>Preferred unit cost</span>
          <input name="preferredUnitCost" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" required />
        </label>
        <label>
          <span>Quantity</span>
          <input name="quantity" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" required />
        </label>
        <label class="add-project-notes-field">
          <span>Line notes</span>
          <textarea name="notes" rows="2"></textarea>
        </label>
        <button type="submit" class="primary-button add-project-submit">Add to Project</button>
      </form>
    </section>
  `;
}

export function renderProjectWorkspace(project: UserProject | null): string {
  if (!project) {
    return `
      <section class="project-workspace">
        <section class="panel-block">
          <div class="panel-heading">
            <p class="eyebrow">Project</p>
            <h3>No active project</h3>
          </div>
        </section>
      </section>
    `;
  }

  const totalProjectCost = project.lineItems.reduce(
    (sum, lineItem) => sum + lineItem.quantity * lineItem.preferredUnitCost,
    0
  );

  return `
    <section class="project-workspace">
      <section class="panel-block project-detail-panel">
        <div class="panel-heading project-workspace-heading">
          <form id="project-metadata-form" class="project-metadata-inline-form">
            <h2 class="visually-hidden">Project workspace</h2>
            <div class="project-identity-fields">
              <p class="eyebrow">Project</p>
              <label class="visually-hidden" for="project-name">Project name</label>
              <input id="project-name" class="project-title-input" name="name" value="${escapeHtml(project.name)}" placeholder="Unnamed Project" />
              <label class="visually-hidden" for="project-location">Project location</label>
              <input id="project-location" class="project-location-input" name="location" value="${escapeHtml(project.location)}" placeholder="Add project location" />
            </div>
            <label class="project-notes-compact-field">
              <span>Notes</span>
              <textarea name="notes" rows="2" placeholder="Add project notes (optional)">${escapeHtml(project.notes)}</textarea>
            </label>
          </form>
          <button type="button" id="download-project-csv" class="secondary-button" ${project.lineItems.length === 0 ? "disabled" : ""}>Download Project CSV</button>
        </div>
      </section>

      <section class="panel-block project-lines-panel">
        <div class="panel-heading project-lines-heading">
          <div>
            <p class="eyebrow">Project Items</p>
            <h3>${formatNumber(project.lineItems.length)} line${project.lineItems.length === 1 ? "" : "s"}</h3>
          </div>
          <div class="project-total">
            <span>Total Project Cost</span>
            <strong>${formatCurrency(totalProjectCost)}</strong>
          </div>
        </div>
        ${project.lineItems.length === 0 ? renderEmptyProjectTable() : renderProjectLineTable(project)}
      </section>
    </section>
  `;
}

function renderDuplicateProjectLinePanel(
  project: UserProject,
  pendingDuplicateLine: PendingDuplicateProjectLine
): string {
  const existingLines = project.lineItems.filter((lineItem) =>
    pendingDuplicateLine.matchingLineIds.includes(lineItem.lineItemId)
  );

  return `
    <section class="add-project-panel duplicate-project-panel">
      <div class="panel-heading">
        <h3>${escapeHtml(pendingDuplicateLine.lineItem.itemCode)} already exists in Project</h3>
      </div>
      <form id="duplicate-project-item-form" class="duplicate-project-form">
        <div class="duplicate-line-list">
          ${existingLines.map((lineItem, index) => `
            <label class="duplicate-line-option">
              <input type="radio" name="lineItemId" value="${escapeHtml(lineItem.lineItemId)}" ${index === 0 ? "checked" : ""} />
              <span>
                <strong>${escapeHtml(lineItem.itemCode)} - ${escapeHtml(lineItem.description)}</strong>
                <small>${formatNumber(lineItem.quantity)} ${escapeHtml(lineItem.unit)} at ${formatCurrency(lineItem.preferredUnitCost)}</small>
              </span>
            </label>
          `).join("")}
        </div>
        <div class="duplicate-project-actions">
          <button type="button" class="secondary-button" data-duplicate-project-action="cancel">Cancel</button>
          <button type="button" class="secondary-button" data-duplicate-project-action="add">Add as new line</button>
          <button type="button" class="primary-button" data-duplicate-project-action="update">Update selected existing line</button>
        </div>
      </form>
    </section>
  `;
}

function renderProjectLineTable(project: UserProject): string {
  return `
    <div class="table-scroll-shell project-table-shell">
      <div class="table-scroll" tabindex="0" aria-label="Project item table">
        <table class="project-line-table">
          <thead>
            <tr>
              <th>Item code</th>
              <th>Description</th>
              <th>Quantity</th>
              <th>Unit</th>
              <th>Preferred unit cost</th>
              <th>Total Item Cost</th>
              <th>Notes</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            ${project.lineItems.map(renderProjectLineRow).join("")}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function renderProjectLineRow(lineItem: ProjectLineItem): string {
  return `
    <tr>
      <td>${escapeHtml(lineItem.itemCode)}</td>
      <td>${escapeHtml(lineItem.description)}</td>
      <td>
        <input
          name="quantity"
          class="project-line-number-input"
          data-project-line-id="${escapeHtml(lineItem.lineItemId)}"
          data-project-line-field="quantity"
          value="${lineItem.quantity}"
          inputmode="decimal"
        />
      </td>
      <td>${escapeHtml(lineItem.unit)}</td>
      <td>
        <input
          name="preferredUnitCost"
          class="project-line-number-input"
          data-project-line-id="${escapeHtml(lineItem.lineItemId)}"
          data-project-line-field="preferredUnitCost"
          value="${lineItem.preferredUnitCost}"
          inputmode="decimal"
        />
      </td>
      <td>${formatCurrency(lineItem.quantity * lineItem.preferredUnitCost)}</td>
      <td>
        <input
          name="notes"
          class="project-line-notes-input"
          data-project-line-id="${escapeHtml(lineItem.lineItemId)}"
          data-project-line-field="notes"
          value="${escapeHtml(lineItem.notes)}"
        />
      </td>
      <td>
        <button
          type="button"
          class="project-line-remove-button"
          data-remove-project-line-id="${escapeHtml(lineItem.lineItemId)}"
          aria-label="Remove ${escapeHtml(lineItem.itemCode)} from project"
          title="Remove line"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
            <path d="M9 3h6l1 2h4v2H4V5h4l1-2Z" />
            <path d="M6 9h12l-1 12H7L6 9Zm4 2v8h2v-8h-2Zm4 0v8h2v-8h-2Z" />
          </svg>
        </button>
      </td>
    </tr>
  `;
}

function renderEmptyProjectTable(): string {
  return `<p class="muted project-empty">No project items have been added.</p>`;
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
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
