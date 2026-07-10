import type {
  EvidenceResult,
  EvidenceStats,
  EvidenceSummaryStats
} from "../data/schema";
import type { InflationAdjustedSummary } from "../matching/inflationAdjustment";
import type { ProjectLineItem, UserProject } from "../projects/projectWorkspace";
import { hasRequiredProjectMetadata } from "../projects/projectWorkspace";

export interface PendingDuplicateProjectLine {
  lineItem: ProjectLineItem;
  matchingLineIds: string[];
}

interface QuickFillOption {
  label: string;
  value: number;
  costBasis: string;
}

export function renderAddToProjectPanel(
  result: EvidenceResult,
  activeProject: UserProject | null,
  includedStats: EvidenceStats | null,
  includedSummaryStats: EvidenceSummaryStats,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null,
  pendingDuplicateLine: PendingDuplicateProjectLine | null
): string {
  if (!result.query.itemCode || !activeProject) {
    return "";
  }

  if (pendingDuplicateLine) {
    return renderDuplicateProjectLinePanel(activeProject, pendingDuplicateLine);
  }

  const projectReady = hasRequiredProjectMetadata(activeProject);
  const quickFillOptions = buildQuickFillOptions(
    includedStats,
    includedSummaryStats,
    inflationAdjustmentEnabled,
    inflationAdjustedSummary
  );

  return `
    <section class="panel-block add-project-panel">
      <div class="panel-heading add-project-heading">
        <div>
          <p class="eyebrow">Project Workspace</p>
          <h3>Add ${escapeHtml(result.query.itemCode)} to Project</h3>
          <p class="query-line">${escapeHtml(activeProject.name.trim() || "Unnamed project")} | ${escapeHtml(activeProject.location.trim() || "Location required")}</p>
        </div>
        <button type="button" class="secondary-button project-tab-shortcut" data-app-view="project">Project</button>
      </div>
      ${projectReady ? "" : `<p class="project-warning">Project name and location are required before adding items.</p>`}
      <form id="add-project-item-form" class="add-project-form">
        <input type="hidden" name="costBasis" value="Manual entry" />
        <input type="hidden" name="costSource" value="manual" />
        <label>
          <span>Quantity</span>
          <input name="quantity" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" required />
        </label>
        <label>
          <span>Preferred unit cost</span>
          <input name="preferredUnitCost" type="text" inputmode="decimal" pattern="[0-9]*\\.?[0-9]*" required />
        </label>
        <label class="add-project-notes-field">
          <span>Line notes</span>
          <textarea name="notes" rows="2"></textarea>
        </label>
        <div class="quick-fill-group" aria-label="Quick-fill preferred unit cost">
          ${quickFillOptions.length > 0
            ? quickFillOptions.map(renderQuickFillButton).join("")
            : `<p class="muted quick-fill-empty">No included summary values are available.</p>`}
        </div>
        <p id="project-cost-basis-preview" class="cost-basis-preview">Manual entry</p>
        <button type="submit" class="primary-button add-project-submit" ${projectReady ? "" : "disabled"}>Add to Project</button>
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

  const subtotal = project.lineItems.reduce(
    (sum, lineItem) => sum + lineItem.quantity * lineItem.preferredUnitCost,
    0
  );

  return `
    <section class="project-workspace">
      <section class="panel-block project-detail-panel">
        <div class="panel-heading project-workspace-heading">
          <div>
            <p class="eyebrow">Project</p>
            <h2>${escapeHtml(project.name.trim() || "Unnamed Project")}</h2>
            <p class="query-line">${escapeHtml(project.location.trim() || "Location required")}</p>
          </div>
          <button type="button" id="download-project-csv" class="secondary-button" ${project.lineItems.length === 0 ? "disabled" : ""}>Download Project CSV</button>
        </div>

        <form id="project-metadata-form" class="project-metadata-form">
          <label>
            <span>Name</span>
            <input name="name" value="${escapeHtml(project.name)}" required />
          </label>
          <label>
            <span>Location</span>
            <input name="location" value="${escapeHtml(project.location)}" required />
          </label>
          <label class="project-notes-field">
            <span>Notes</span>
            <textarea name="notes" rows="2">${escapeHtml(project.notes)}</textarea>
          </label>
        </form>
      </section>

      <section class="panel-block project-lines-panel">
        <div class="panel-heading project-lines-heading">
          <div>
            <p class="eyebrow">Project Items</p>
            <h3>${formatNumber(project.lineItems.length)} line${project.lineItems.length === 1 ? "" : "s"}</h3>
          </div>
          <div class="project-subtotal">
            <span>Subtotal</span>
            <strong>${formatCurrency(subtotal)}</strong>
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
    <section class="panel-block add-project-panel duplicate-project-panel">
      <div class="panel-heading">
        <p class="eyebrow">Project Workspace</p>
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
              <th>Extended cost</th>
              <th>Cost basis</th>
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
          name="costBasis"
          class="project-line-basis-input"
          data-project-line-id="${escapeHtml(lineItem.lineItemId)}"
          data-project-line-field="costBasis"
          value="${escapeHtml(lineItem.costBasis)}"
        />
      </td>
      <td>
        <textarea
          name="notes"
          class="project-line-notes-input"
          data-project-line-id="${escapeHtml(lineItem.lineItemId)}"
          data-project-line-field="notes"
          rows="2"
        >${escapeHtml(lineItem.notes)}</textarea>
      </td>
      <td>
        <button type="button" class="secondary-button project-line-remove-button" data-remove-project-line-id="${escapeHtml(lineItem.lineItemId)}">Remove</button>
      </td>
    </tr>
  `;
}

function renderEmptyProjectTable(): string {
  return `<p class="muted project-empty">No project items have been added.</p>`;
}

function buildQuickFillOptions(
  includedStats: EvidenceStats | null,
  includedSummaryStats: EvidenceSummaryStats,
  inflationAdjustmentEnabled: boolean,
  inflationAdjustedSummary: InflationAdjustedSummary | null
): QuickFillOption[] {
  const options: QuickFillOption[] = [];
  const targetPeriod = inflationAdjustedSummary?.targetPeriod?.periodLabel ?? null;
  const basisSuffix = inflationAdjustmentEnabled && targetPeriod
    ? `, FHWA NHCCI adjusted to ${targetPeriod}`
    : "";
  const awardedStats = inflationAdjustmentEnabled ? inflationAdjustedSummary?.stats ?? null : includedStats;
  const summaryStats = inflationAdjustmentEnabled
    ? inflationAdjustedSummary?.summaryStats ?? { awarded: null, average: null, engineer: null }
    : includedSummaryStats;

  if (awardedStats) {
    options.push(
      quickFillOption("Awarded low", awardedStats.low, basisSuffix),
      quickFillOption("Awarded median", awardedStats.median, basisSuffix),
      quickFillOption("Awarded average", awardedStats.average, basisSuffix),
      quickFillOption("Awarded high", awardedStats.high, basisSuffix)
    );
  }

  if (summaryStats.average) {
    options.push(quickFillOption("Average bid average", summaryStats.average.average, basisSuffix));
  }

  if (summaryStats.engineer) {
    options.push(quickFillOption("Engineer estimate average", summaryStats.engineer.average, basisSuffix));
  }

  return options;
}

function quickFillOption(label: string, value: number, basisSuffix: string): QuickFillOption {
  return {
    label,
    value,
    costBasis: `${label}${basisSuffix} from current included evidence`
  };
}

function renderQuickFillButton(option: QuickFillOption): string {
  return `
    <button
      type="button"
      class="secondary-button quick-fill-button"
      data-project-cost-value="${option.value}"
      data-project-cost-basis="${escapeHtml(option.costBasis)}"
    >
      ${escapeHtml(option.label)} ${formatCurrency(option.value)}
    </button>
  `;
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
