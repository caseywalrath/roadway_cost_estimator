import type { UserProject, ProjectLineItem } from "../projects/projectWorkspace";
import type {
  BackupComparison,
  BackupLineAction,
  BackupLineComparison,
  BackupLineStatus,
  BackupMergeChoices,
  BackupMetadataKey
} from "../projects/backupImport/compare";

export type BackupImportStage = "file" | "review" | "confirm";
export type BackupImportReviewFilter = "needs-review" | "reviewed" | "all";
export type BackupImportIssueFilter = "all" | BackupLineStatus;

export interface ProjectBackupImportViewModel {
  stage: BackupImportStage;
  fileName: string | null;
  fileSize: number | null;
  readStatus: "idle" | "reading" | "ready" | "error";
  errorMessage: string | null;
  backupProject: UserProject | null;
  destinationProjectMode: "active" | "new";
  destinationProjectId: string | null;
  availableProjects: Array<Pick<UserProject, "projectId" | "name" | "state">>;
  newProjectName: string;
  comparison: BackupComparison | null;
  choices: BackupMergeChoices;
  reviewFilter: BackupImportReviewFilter;
  issueFilter: BackupImportIssueFilter;
  reviewPage: number;
  selectedRowKeys: string[];
  confirmation: {
    counts: { kept: number; updated: number; added: number; deleted: number };
    totalAfter: number;
    totalDelta: number | null;
    canCommit: boolean;
    noChanges?: boolean;
  } | null;
  commitStatus: "idle" | "committing" | "committed" | "failed";
  commitMessage: string | null;
}

const PAGE_SIZE = 50;
const METADATA_LABELS: Record<BackupMetadataKey, string> = {
  name: "Project name",
  location: "Location",
  notes: "Project notes"
};
const ISSUE_LABELS: Array<[BackupImportIssueFilter, string]> = [
  ["all", "All issues"],
  ["changed", "Changed"],
  ["unchanged", "Unchanged"],
  ["added", "New in backup"],
  ["unpaired", "Unpaired"],
  ["removed", "Missing from backup"]
];

/** Pure markup renderer. The controller owns all decisions and save operations. */
export function renderProjectBackupImportWizard(view: ProjectBackupImportViewModel): string {
  return `<section class="panel-block excel-import-wizard" data-backup-import-wizard aria-labelledby="backup-import-title">
    <div class="excel-import-heading"><div><p class="eyebrow">Project Actions</p><h2 id="backup-import-title" tabindex="-1">Import Project Backup</h2>
      <p class="muted">Choose a backup, review Project differences, and confirm the items to import.</p></div>
      <button type="button" class="secondary-button" data-backup-import-cancel>${view.commitStatus === "committed" ? "Close" : "Cancel import"}</button></div>
    ${renderSteps(view.stage)}
    ${view.errorMessage ? `<p class="excel-import-error" role="alert">${escapeHtml(view.errorMessage)}</p>` : ""}
    ${view.stage === "file" ? renderFile(view) : view.stage === "review" ? renderReview(view) : renderConfirm(view)}
  </section>`;
}

function renderSteps(stage: BackupImportStage): string {
  const steps: Array<[BackupImportStage, string]> = [["file", "Choose file"], ["review", "Review items"], ["confirm", "Confirm import"]];
  const current = steps.findIndex(([value]) => value === stage);
  return `<ol class="excel-import-steps" aria-label="Project Backup import steps">${steps.map(([value, label], index) =>
    `<li class="${index === current ? "is-current" : index < current ? "is-complete" : ""}"><button type="button" data-backup-import-step="${value}" ${index < current ? "" : "disabled"} ${index === current ? 'aria-current="step"' : ""}><span>${index + 1}</span><span>${label}</span></button></li>`
  ).join("")}</ol>`;
}

function renderFile(view: ProjectBackupImportViewModel): string {
  const state = view.backupProject?.state;
  const destinations = view.availableProjects.filter((project) => !state || project.state === state);
  const selected = destinations.find((project) => project.projectId === view.destinationProjectId);
  const fileStatus = view.readStatus === "reading" ? "Reading Project Backup…"
    : view.fileName ? `<strong>${escapeHtml(view.fileName)}</strong>${view.fileSize === null ? "" : `<span>${formatFileSize(view.fileSize)}</span>`}<span>${view.readStatus === "ready" ? "Backup ready for review." : "Backup could not be read."}</span>`
      : "No backup selected.";
  return `<div class="excel-import-stage" data-backup-import-stage="file">
    <section class="excel-import-file-choice" aria-labelledby="backup-import-file-title"><h3 id="backup-import-file-title">Project Backup file</h3>
      <label class="excel-import-file-picker"><input type="file" accept=".json,.rce-project.json,application/json" data-backup-import-file /><span class="excel-import-file-picker-content"><strong>Browse files</strong><small>Select a .rce-project.json Project Backup.</small></span></label>
      <div class="excel-import-read-status" role="status" aria-live="polite">${fileStatus}</div>
      ${view.backupProject ? `<p class="muted">${escapeHtml(view.backupProject.name || "Untitled Project")} · ${escapeHtml(view.backupProject.state)} · ${view.backupProject.lineItems.length} item${view.backupProject.lineItems.length === 1 ? "" : "s"}</p>` : ""}
    </section>
    <section class="excel-import-destination" aria-labelledby="backup-import-destination-title"><div><h3 id="backup-import-destination-title">Where should the items go?</h3>
      <p class="muted">A backup can be compared with an existing Project in the same state or copied into a new Project.</p></div>
      <div class="excel-import-destination-options">
        ${destinations.length ? `<label><input type="radio" name="backupImportProjectMode" value="active" data-backup-import-project-mode ${view.destinationProjectMode === "active" ? "checked" : ""} /><span><strong>Add items to an existing Project</strong><small>Review differences before saving changes.</small></span></label>` : ""}
        <label><input type="radio" name="backupImportProjectMode" value="new" data-backup-import-project-mode ${view.destinationProjectMode === "new" ? "checked" : ""} /><span><strong>Create a new Project</strong><small>Import the complete backup as a separate Project.</small></span></label>
      </div>
      ${view.destinationProjectMode === "active" && destinations.length ? `<div class="excel-import-new-project-fields"><label class="excel-import-new-project-name"><span>Destination Project</span><select data-backup-import-destination-project><option value="">Choose Project…</option>${destinations.map((project) => `<option value="${escapeHtml(project.projectId)}" ${project.projectId === selected?.projectId ? "selected" : ""}>${escapeHtml(project.name || "Untitled Project")}</option>`).join("")}</select></label></div>` : ""}
      ${view.destinationProjectMode === "new" ? `<div class="excel-import-new-project-fields"><label class="excel-import-new-project-name"><span>New Project name</span><input type="text" value="${escapeHtml(view.newProjectName)}" data-backup-import-new-project-name /></label></div>` : ""}
    </section>
    <div class="excel-import-actions excel-import-actions--split"><span></span><button type="button" class="primary-button" data-backup-import-next="review" ${view.readStatus !== "ready" || (view.destinationProjectMode === "active" && !selected) || (view.destinationProjectMode === "new" && !view.newProjectName.trim()) ? "disabled" : ""}>Next: Review items</button></div>
  </div>`;
}

function renderReview(view: ProjectBackupImportViewModel): string {
  if (!view.backupProject) return missingBackup();
  if (view.destinationProjectMode === "new") return renderNewProjectReview(view);
  const comparison = view.comparison;
  if (!comparison) return `<div class="excel-import-stage" data-backup-import-stage="review"><p class="excel-import-error" role="alert">The comparison is unavailable. Return to Choose file and select a destination Project.</p>${backButton("file")}</div>`;
  const needsReview = comparison.lines.filter((row) => !isReviewed(row, view.choices));
  const reviewed = comparison.lines.filter((row) => isReviewed(row, view.choices));
  const baseRows = view.reviewFilter === "needs-review" ? needsReview : view.reviewFilter === "reviewed" ? reviewed : comparison.lines;
  const filtered = baseRows.filter((row) => view.issueFilter === "all" || row.status === view.issueFilter);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(view.reviewPage, pages - 1));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const selectable = view.reviewFilter === "needs-review" ? pageRows : [];
  const selected = new Set(view.selectedRowKeys);
  const selectedRows = comparison.lines.filter((row) => selected.has(row.key));
  const metadataChanges = comparison.metadata.filter((entry) => entry.changed);
  return `<div class="excel-import-stage" data-backup-import-stage="review">
    <div class="excel-import-review-task" role="status"><h3>${needsReview.length ? `${needsReview.length} item${needsReview.length === 1 ? " needs" : "s need"} attention.` : "All items reviewed. Continue to confirm import."}</h3></div>
    ${comparison.crossProject ? `<p class="muted">This backup came from a different Project. Match suggested items only when they are the same line.</p>` : ""}
    <div class="excel-import-review-tabs" aria-label="Review views">${([ ["needs-review", "Needs attention", needsReview.length], ["reviewed", "Reviewed", reviewed.length], ["all", "All items", comparison.lines.length] ] as const).map(([key, label, count]) => `<button type="button" class="secondary-button ${view.reviewFilter === key ? "is-active" : ""}" data-backup-import-review-filter="${key}" aria-pressed="${view.reviewFilter === key}">${label} <span>${count}</span></button>`).join("")}</div>
    <div class="excel-import-selection-tools"><label class="excel-import-compact-filter"><span>Issue type</span><select data-backup-import-issue-filter>${ISSUE_LABELS.map(([key, label]) => `<option value="${key}" ${view.issueFilter === key ? "selected" : ""}>${label} (${baseRows.filter((row) => key === "all" || row.status === key).length})</option>`).join("")}</select></label>
      ${selectedRows.length ? `<label class="excel-import-review-action"><select aria-label="Choose action for selected rows" data-backup-import-bulk-action><option value="">Choose action…</option>${bulkOptions(selectedRows).map(([action, label]) => `<option value="${action}">${label}</option>`).join("")}</select></label>` : ""}</div>
    <div class="table-scroll excel-import-table-shell" tabindex="0" aria-label="Project Backup item review"><table class="excel-import-table excel-import-review-table"><thead><tr><th>${view.reviewFilter === "needs-review" ? `<label class="excel-import-select-all"><input type="checkbox" aria-label="Select all visible rows" data-backup-import-select-visible ${selectable.length && selectable.every((row) => selected.has(row.key)) ? "checked" : ""} ${selectable.length ? "" : "disabled"} /></label>` : ""}</th><th>#</th><th>Item</th><th>Backup comparison</th><th>Your choice</th></tr></thead><tbody>${pageRows.length ? pageRows.map((row, index) => renderComparisonRow(row, view, page * PAGE_SIZE + index + 1, selected.has(row.key))).join("") : `<tr><td colspan="5" class="muted">No items match this view.</td></tr>`}</tbody></table></div>
    <div class="excel-import-pagination" aria-label="Table pages"><button type="button" class="secondary-button excel-import-page-button" data-backup-import-review-page="prev" ${page <= 0 ? "disabled" : ""}>Previous 50</button><span>Page ${page + 1} of ${pages}</span><button type="button" class="secondary-button excel-import-page-button" data-backup-import-review-page="next" ${page >= pages - 1 ? "disabled" : ""}>Next 50</button></div>
    ${metadataChanges.length ? `<section class="excel-import-existing-items" aria-labelledby="backup-import-metadata-title"><div class="excel-import-existing-heading"><h4 id="backup-import-metadata-title">Project details</h4><span>${metadataChanges.length} difference${metadataChanges.length === 1 ? "" : "s"}</span></div><p class="muted">Choose whether to keep each Project value or use the backup value.</p><div class="table-scroll"><table><thead><tr><th>Field</th><th>Project</th><th>Backup</th><th>Your choice</th></tr></thead><tbody>${metadataChanges.map((entry) => `<tr><th scope="row">${METADATA_LABELS[entry.key]}</th><td>${escapeHtml(metadataValue(entry.current))}</td><td>${escapeHtml(metadataValue(entry.backup))}</td><td><div class="excel-import-match-choices" role="group" aria-label="${METADATA_LABELS[entry.key]} choice">${metadataButton(entry.key, false, Boolean(view.choices.useBackupMetadata?.[entry.key]))}${metadataButton(entry.key, true, Boolean(view.choices.useBackupMetadata?.[entry.key]))}</div></td></tr>`).join("")}</tbody></table></div></section>` : ""}
    <div class="excel-import-actions excel-import-actions--split"><button type="button" class="secondary-button" data-backup-import-back="file">Back: Choose file</button><button type="button" class="primary-button" data-backup-import-next="confirm" ${needsReview.length ? "disabled" : ""}>Next: Confirm import</button></div>
  </div>`;
}

function renderNewProjectReview(view: ProjectBackupImportViewModel): string {
  const backup = view.backupProject!;
  const pages = Math.max(1, Math.ceil(backup.lineItems.length / PAGE_SIZE));
  const page = Math.max(0, Math.min(view.reviewPage, pages - 1));
  const lines = backup.lineItems.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  return `<div class="excel-import-stage" data-backup-import-stage="review"><div class="excel-import-review-task"><h3>${backup.lineItems.length} backup item${backup.lineItems.length === 1 ? "" : "s"} ready for the new Project.</h3><p>The complete backup will be copied into ${escapeHtml(view.newProjectName || "the new Project")}.</p></div>
    <div class="table-scroll excel-import-table-shell" tabindex="0" aria-label="Project Backup items"><table class="excel-import-table"><thead><tr><th>#</th><th>Item code</th><th>Description</th><th>Quantity</th><th>Unit cost</th></tr></thead><tbody>${lines.map((line, index) => `<tr><td>${page * PAGE_SIZE + index + 1}</td><td>${escapeHtml(line.itemCode || "—")}</td><td>${escapeHtml(line.description || "—")}</td><td>${formatNumber(line.quantity)}</td><td>${formatMoney(line.preferredUnitCost)}</td></tr>`).join("")}</tbody></table></div>
    <div class="excel-import-pagination" aria-label="Table pages"><button type="button" class="secondary-button excel-import-page-button" data-backup-import-review-page="prev" ${page <= 0 ? "disabled" : ""}>Previous 50</button><span>Page ${page + 1} of ${pages}</span><button type="button" class="secondary-button excel-import-page-button" data-backup-import-review-page="next" ${page >= pages - 1 ? "disabled" : ""}>Next 50</button></div>
    <div class="excel-import-actions excel-import-actions--split"><button type="button" class="secondary-button" data-backup-import-back="file">Back: Choose file</button><button type="button" class="primary-button" data-backup-import-next="confirm">Next: Confirm import</button></div></div>`;
}

function renderComparisonRow(row: BackupLineComparison, view: ProjectBackupImportViewModel, number: number, selected: boolean): string {
  const backup = row.backup;
  const current = row.current;
  const item = backup ?? current;
  const action = view.choices.lineActions?.[row.key] ?? "keep_project";
  const statusLabel: Record<BackupLineStatus, string> = {
    changed: row.changedFields.length ? `${row.changedFields.map(fieldLabel).join(", ")} changed` : "Item changed",
    unchanged: "Values match",
    added: "New in backup",
    removed: "Missing from backup",
    unpaired: "Potential match needs confirmation"
  };
  const candidates = row.candidateCurrentLineIds.map((id) => view.comparison?.lines.find((candidate) => candidate.current?.lineItemId === id)?.current).filter((line): line is ProjectLineItem => Boolean(line));
  const selectable = view.reviewFilter === "needs-review";
  return `<tr class="excel-import-row--project"><td>${selectable ? `<label class="excel-import-row-select"><input type="checkbox" aria-label="Select item ${number}" data-backup-import-select-row="${escapeHtml(row.key)}" ${selected ? "checked" : ""} /></label>` : ""}</td><td>${number}</td>
    <td><strong>${escapeHtml(item?.itemCode || "No item code")}</strong><div>${escapeHtml(item?.description || "No description")}</div><small>${escapeHtml(item?.group || "No group")}</small></td>
    <td><strong>${escapeHtml(statusLabel[row.status])}</strong><dl class="excel-import-comparison">${current ? comparisonValue("Project", current) : ""}${backup ? comparisonValue("Backup", backup) : ""}</dl>${row.status === "unpaired" && backup && candidates.length === 1 ? `<button type="button" class="secondary-button" data-backup-import-pair="${escapeHtml(backup.lineItemId)}" data-backup-target="${escapeHtml(candidates[0].lineItemId)}">Pair with suggested Project item</button><small>${escapeHtml(candidates[0].itemCode)} · ${escapeHtml(candidates[0].description)}</small>` : row.status === "unpaired" && backup && candidates.length > 1 ? `<label class="excel-import-compact-filter"><span>Pair with Project item</span><select data-backup-import-pair="${escapeHtml(backup.lineItemId)}"><option value="">Choose item…</option>${candidates.map((candidate, index) => `<option value="${escapeHtml(candidate.lineItemId)}">${index + 1}: ${escapeHtml(candidate.itemCode)} · ${escapeHtml(candidate.description)} · ${formatNumber(candidate.quantity)} × ${formatMoney(candidate.preferredUnitCost)}</option>`).join("")}</select></label>` : ""}${row.status === "changed" && current && backup ? renderChangedFields(row, current, backup) : ""}</td>
    <td>${row.status === "unchanged" && !view.choices.lineActions?.[row.key] ? `<span class="muted">Keep Project</span><details class="excel-import-item-details"><summary>Change choice</summary>${lineButtons(row, action)}</details>` : lineButtons(row, action)}</td></tr>`;
}

function lineButtons(row: BackupLineComparison, selected: BackupLineAction): string {
  const options: Array<[BackupLineAction, string]> = row.status === "removed" || (row.status === "unpaired" && !row.backup)
    ? [["keep_project", "Keep Project"], ["delete", "Delete"]]
    : row.status === "added" || row.status === "unpaired"
      ? [["keep_project", "Skip"], ["add_separate", "Add"]]
      : [["keep_project", "Keep Project"], ["use_backup", "Use Backup"], ["add_separate", "Duplicate"]];
  return `<div class="excel-import-match-choices" role="group" aria-label="Your choice">${options.map(([action, label]) => `<button type="button" class="secondary-button ${selected === action ? "is-selected" : ""}" aria-pressed="${selected === action}" data-backup-import-line-action="${escapeHtml(row.key)}" data-backup-action="${action}">${label}</button>`).join("")}</div>`;
}

function metadataButton(key: BackupMetadataKey, useBackup: boolean, selectedUseBackup: boolean): string {
  const label = useBackup ? "Use Backup" : "Keep Project";
  const selected = useBackup === selectedUseBackup;
  return `<button type="button" class="secondary-button ${selected ? "is-selected" : ""}" aria-pressed="${selected}" data-backup-import-metadata-choice="${key}" data-backup-use-metadata="${useBackup}">${label}</button>`;
}

function renderConfirm(view: ProjectBackupImportViewModel): string {
  const summary = view.confirmation;
  if (!summary) return `<div class="excel-import-stage" data-backup-import-stage="confirm"><p class="excel-import-error" role="alert">The import summary is unavailable. Return to review.</p>${backButton("review")}</div>`;
  const completed = view.commitStatus === "committed";
  const failed = view.commitStatus === "failed";
  const destination = view.destinationProjectMode === "new" ? view.newProjectName : view.availableProjects.find((project) => project.projectId === view.destinationProjectId)?.name ?? "Project";
  const selectedMetadata = view.comparison?.metadata.filter((entry) => entry.changed && view.choices.useBackupMetadata?.[entry.key]) ?? [];
  return `<div class="excel-import-stage" data-backup-import-stage="confirm"><div class="excel-import-result ${completed ? "excel-import-result--success" : failed ? "excel-import-result--failure" : ""}" role="status" aria-live="polite"><h3>${completed ? summary.noChanges ? "Review complete" : "Project Backup imported" : failed ? "Import could not be completed" : summary.noChanges ? "No changes selected" : "Ready to import"}</h3>
    <p class="excel-import-confirmation-destination">${view.destinationProjectMode === "new" ? "New Project" : "Project"}: <strong>${escapeHtml(destination)}</strong></p>
    ${failed ? `<p>${escapeHtml(view.commitMessage ?? "Review the import and try again.")}</p>` : ""}
    <dl class="excel-import-outcome-counts" aria-label="Import outcome"><div><dt>Add</dt><dd>${summary.counts.added}</dd></div><div><dt>Update</dt><dd>${summary.counts.updated}</dd></div><div><dt>Keep</dt><dd>${summary.counts.kept}</dd></div><div><dt>Delete</dt><dd>${summary.counts.deleted}</dd></div></dl></div>
    <section class="excel-import-confirmation-costs" aria-labelledby="backup-import-costs-title"><div class="excel-import-cost-heading"><h4 id="backup-import-costs-title">Project cost after import</h4><strong>${formatMoney(summary.totalAfter)}</strong></div>${summary.totalDelta !== null ? `<p class="muted">Change from import: ${formatSignedMoney(summary.totalDelta)}</p>` : ""}</section>
    ${selectedMetadata.length ? `<section class="excel-import-existing-items"><h4>Project details from backup</h4><p>${escapeHtml(selectedMetadata.map((entry) => METADATA_LABELS[entry.key]).join(", "))}</p></section>` : ""}
    ${completed ? "" : `<div class="excel-import-actions"><button type="button" class="secondary-button" data-backup-import-back="review" ${view.commitStatus === "committing" ? "disabled" : ""}>Back to review</button><button type="button" class="primary-button" data-backup-import-commit ${view.commitStatus === "committing" || !summary.canCommit ? "disabled" : ""}>${view.commitStatus === "committing" ? "Saving import…" : failed ? "Try import again" : summary.noChanges ? "Finish review" : "Import Project Backup"}</button></div>`}
  </div>`;
}

function backButton(stage: BackupImportStage): string {
  return `<div class="excel-import-actions"><button type="button" class="secondary-button" data-backup-import-back="${stage}">Back to ${stage === "file" ? "Choose file" : "review"}</button></div>`;
}

function missingBackup(): string {
  return `<div class="excel-import-stage" data-backup-import-stage="review"><p class="excel-import-error" role="alert">Choose a Project Backup file first.</p>${backButton("file")}</div>`;
}

function isReviewed(row: BackupLineComparison, choices: BackupMergeChoices): boolean {
  return row.status === "unchanged" || Boolean(choices.lineActions?.[row.key]);
}

function bulkOptions(rows: BackupLineComparison[]): Array<[BackupLineAction, string]> {
  const options: Array<[BackupLineAction, string]> = [["keep_project", "Keep or skip selected"]];
  if (rows.every((row) => Boolean(row.backup))) options.push(["add_separate", "Add selected separately"]);
  if (rows.every((row) => Boolean(row.backup && row.current))) options.push(["use_backup", "Use Backup for selected"]);
  if (rows.every((row) => Boolean(row.current && !row.backup))) options.push(["delete", "Delete selected"]);
  return options;
}

function comparisonValue(label: string, line: ProjectLineItem): string {
  return `<div><dt>${label}</dt><dd>Quantity ${formatNumber(line.quantity)} · Unit cost ${formatMoney(line.preferredUnitCost)}</dd></div>`;
}

function renderChangedFields(row: BackupLineComparison, current: ProjectLineItem, backup: ProjectLineItem): string {
  return `<details class="excel-import-item-details"><summary>Compare changed fields</summary><dl class="excel-import-comparison">${row.changedFields.map((field) => {
    const key = field as keyof ProjectLineItem;
    return `<div><dt>${escapeHtml(fieldLabel(field))}</dt><dd><strong>Project:</strong> ${escapeHtml(lineFieldValue(key, current[key]))}<br /><strong>Backup:</strong> ${escapeHtml(lineFieldValue(key, backup[key]))}</dd></div>`;
  }).join("")}</dl></details>`;
}

function lineFieldValue(field: keyof ProjectLineItem, value: ProjectLineItem[keyof ProjectLineItem]): string {
  if (value === null || value === undefined || value === "") return "—";
  if (field === "preferredUnitCost" && typeof value === "number") return formatMoney(value);
  if (field === "percentageRate" && typeof value === "number") return `${value}%`;
  if (field === "percentageBase" && typeof value === "object" && "kind" in value) {
    if (value.kind === "group") return `Group: ${value.group}`;
    if (value.kind === "selected_lines") return `Selected items: ${value.lineItemIds.length}`;
    const labels = { all_fixed: "All fixed-cost items", construction_fixed: "Construction fixed-cost items", other_fixed: "Other fixed-cost items" };
    return labels[value.kind];
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function fieldLabel(value: string): string {
  const names: Record<string, string> = { preferredUnitCost: "unit cost", costCategory: "cost category", pricingMode: "pricing mode", percentageRate: "percentage rate", percentageBase: "percentage base", itemCode: "item code", lineItemType: "item type", agencyItemId: "item identity", importSource: "import source", evidenceContext: "evidence" };
  return names[value] ?? value.replace(/([A-Z])/g, " $1").toLowerCase();
}

function metadataValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function formatNumber(value: number | null): string { return value === null ? "Blank" : value.toLocaleString(); }
function formatMoney(value: number | null): string { return value === null ? "Blank" : value.toLocaleString(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }); }
function formatSignedMoney(value: number): string { return `${value >= 0 ? "+" : "−"}${formatMoney(Math.abs(value))}`; }
function formatFileSize(bytes: number): string { return bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1048576).toFixed(1)} MB`; }
function escapeHtml(value: string): string { return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character] ?? character); }
