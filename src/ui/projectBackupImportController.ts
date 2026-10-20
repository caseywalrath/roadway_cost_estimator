import { createImportedCopy, readProjectBackupFile } from "../projects/projectBackup";
import { compareProjectBackup, buildProjectBackupMerge, type BackupLineAction, type BackupLineStatus, type BackupMergeChoices, type BackupMergeProjection } from "../projects/backupImport/compare";
import { createId, projectCostSummary, type UserProject } from "../projects/projectWorkspace";
import type { ProjectBackupImportViewModel } from "./renderProjectBackupImport";

export interface ProjectBackupImportControllerOptions {
  projects: UserProject[];
  activeProjectId: string | null;
  currentState: string;
  onRender: () => void;
  onClose: () => void;
  onCommit: (project: UserProject, expectedRevision: number | null) => Promise<string>;
}

export class ProjectBackupImportController {
  private view: ProjectBackupImportViewModel;
  private readonly options: ProjectBackupImportControllerOptions;
  private operation = 0;
  private generatedIds = new Map<string, string>();
  private destinationTouched = false;

  constructor(options: ProjectBackupImportControllerOptions) {
    this.options = options;
    const availableProjects = options.projects.filter((project) => project.status === "active" && project.state === options.currentState)
      .map(({ projectId, name, state }) => ({ projectId, name, state }));
    this.view = {
      stage: "file", fileName: null, fileSize: null, readStatus: "idle", errorMessage: null,
      backupProject: null, destinationProjectMode: options.activeProjectId ? "active" : "new",
      destinationProjectId: options.activeProjectId, availableProjects, newProjectName: "",
      comparison: null, choices: {}, reviewFilter: "needs-review", issueFilter: "all", reviewPage: 0,
      selectedRowKeys: [], confirmation: null, commitStatus: "idle", commitMessage: null
    };
  }

  get viewModel(): ProjectBackupImportViewModel { return this.view; }
  get isCommitting(): boolean { return this.view.commitStatus === "committing"; }
  cancel(): void { if (this.isCommitting) return; this.operation++; this.options.onClose(); }

  async selectFile(file: File): Promise<void> {
    const token = ++this.operation;
    this.view = { ...this.view, fileName: file.name, fileSize: file.size, readStatus: "reading", errorMessage: null, backupProject: null, comparison: null, choices: {}, confirmation: null };
    this.options.onRender();
    try {
      const backup = await readProjectBackupFile(file);
      if (token !== this.operation) return;
      const sameState = this.options.projects.filter((project) => project.status === "active" && project.state === backup.project.state);
      const exact = sameState.find((project) => project.projectId === backup.project.projectId);
      const selected = this.destinationTouched && this.view.destinationProjectMode === "new"
        ? null
        : exact ?? (this.destinationTouched ? sameState.find((project) => project.projectId === this.view.destinationProjectId) : null) ?? null;
      this.view = {
        ...this.view, readStatus: "ready", backupProject: backup.project,
        availableProjects: sameState.map(({ projectId, name, state }) => ({ projectId, name, state })),
        destinationProjectId: selected?.projectId ?? null,
        destinationProjectMode: selected ? "active" : "new",
        newProjectName: backup.project.name.trim() || "Imported Project"
      };
      this.refreshComparison();
    } catch (error) {
      if (token !== this.operation) return;
      this.view = { ...this.view, readStatus: "error", errorMessage: error instanceof Error ? error.message : "The Project backup could not be read." };
    }
    this.options.onRender();
  }

  bind(root: HTMLElement): void {
    root.querySelector<HTMLButtonElement>("[data-backup-import-cancel]")?.addEventListener("click", () => this.cancel());
    root.querySelector<HTMLInputElement>("[data-backup-import-file]")?.addEventListener("change", (event) => {
      const file = (event.currentTarget as HTMLInputElement).files?.[0];
      if (file) void this.selectFile(file);
    });
    root.querySelectorAll<HTMLInputElement>("[data-backup-import-project-mode]").forEach((input) => input.addEventListener("change", () => {
      this.destinationTouched = true;
      this.view.destinationProjectMode = input.value === "active" ? "active" : "new";
      this.view.errorMessage = null;
      this.refreshComparison(); this.options.onRender();
    }));
    root.querySelector<HTMLSelectElement>("[data-backup-import-destination-project]")?.addEventListener("change", (event) => {
      this.destinationTouched = true;
      this.view.destinationProjectId = (event.currentTarget as HTMLSelectElement).value || null;
      this.view.choices = {}; this.refreshComparison(); this.options.onRender();
    });
    root.querySelector<HTMLInputElement>("[data-backup-import-new-project-name]")?.addEventListener("input", (event) => {
      this.view.newProjectName = (event.currentTarget as HTMLInputElement).value;
      const next = root.querySelector<HTMLButtonElement>("[data-backup-import-next='review']");
      if (next) next.disabled = !this.view.newProjectName.trim() || this.view.readStatus !== "ready";
    });
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-next]").forEach((button) => button.addEventListener("click", () => {
      if (button.dataset.backupImportNext === "review") this.advanceToReview();
      else if (button.dataset.backupImportNext === "confirm") this.advanceToConfirm();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-back]").forEach((button) => button.addEventListener("click", () => {
      this.view.stage = button.dataset.backupImportBack === "file" ? "file" : "review";
      this.view.errorMessage = null; this.options.onRender();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-review-filter]").forEach((button) => button.addEventListener("click", () => {
      this.view.reviewFilter = button.dataset.backupImportReviewFilter as ProjectBackupImportViewModel["reviewFilter"];
      this.view.issueFilter = "all"; this.view.reviewPage = 0; this.view.selectedRowKeys = []; this.options.onRender();
    }));
    root.querySelector<HTMLSelectElement>("[data-backup-import-issue-filter]")?.addEventListener("change", (event) => {
      this.view.issueFilter = (event.currentTarget as HTMLSelectElement).value as "all" | BackupLineStatus;
      this.view.reviewPage = 0; this.view.selectedRowKeys = []; this.options.onRender();
    });
    root.querySelectorAll<HTMLInputElement>("[data-backup-import-select-row]").forEach((input) => input.addEventListener("change", () => {
      const key = input.dataset.backupImportSelectRow!;
      this.view.selectedRowKeys = input.checked ? [...new Set([...this.view.selectedRowKeys, key])] : this.view.selectedRowKeys.filter((value) => value !== key);
      this.options.onRender();
    }));
    root.querySelector<HTMLInputElement>("[data-backup-import-select-visible]")?.addEventListener("change", (event) => {
      const keys = [...root.querySelectorAll<HTMLInputElement>("[data-backup-import-select-row]")].map((input) => input.dataset.backupImportSelectRow!);
      const selected = new Set(this.view.selectedRowKeys);
      for (const key of keys) (event.currentTarget as HTMLInputElement).checked ? selected.add(key) : selected.delete(key);
      this.view.selectedRowKeys = [...selected]; this.options.onRender();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-line-action]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.backupImportLineAction!;
      const action = button.dataset.backupAction as BackupLineAction;
      this.view.choices = { ...this.view.choices, lineActions: { ...this.view.choices.lineActions, [key]: action } };
      this.view.selectedRowKeys = this.view.selectedRowKeys.filter((selected) => selected !== key);
      this.options.onRender();
    }));
    root.querySelectorAll<HTMLButtonElement>("button[data-backup-import-pair]").forEach((button) => button.addEventListener("click", () => {
      const backupId = button.dataset.backupImportPair!;
      const pairs = { ...this.view.choices.confirmedPairs };
      const targetId = button.dataset.backupTarget;
      if (targetId && Object.entries(pairs).some(([id, target]) => id !== backupId && target === targetId)) {
        this.view.errorMessage = "This Project item is already paired with another backup item.";
        this.options.onRender();
        return;
      }
      if (targetId) pairs[backupId] = targetId;
      this.view.choices = { ...this.view.choices, confirmedPairs: pairs };
      this.view.selectedRowKeys = [];
      this.refreshComparison(); this.options.onRender();
    }));
    root.querySelectorAll<HTMLSelectElement>("select[data-backup-import-pair]").forEach((select) => select.addEventListener("change", () => {
      const backupId = select.dataset.backupImportPair!;
      const pairs = { ...this.view.choices.confirmedPairs };
      if (select.value && Object.entries(pairs).some(([id, target]) => id !== backupId && target === select.value)) {
        this.view.errorMessage = "This Project item is already paired with another backup item.";
        this.options.onRender();
        return;
      }
      if (select.value) pairs[backupId] = select.value;
      else delete pairs[backupId];
      this.view.choices = { ...this.view.choices, confirmedPairs: pairs };
      this.view.selectedRowKeys = [];
      this.refreshComparison(); this.options.onRender();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-step]").forEach((button) => button.addEventListener("click", () => {
      if (button.disabled || this.isCommitting) return;
      this.view.stage = button.dataset.backupImportStep === "file" ? "file" : "review";
      this.view.errorMessage = null;
      this.options.onRender();
    }));
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-metadata-choice]").forEach((button) => button.addEventListener("click", () => {
      const key = button.dataset.backupImportMetadataChoice!;
      const useBackup = button.dataset.backupUseMetadata === "true";
      this.view.choices = { ...this.view.choices, useBackupMetadata: { ...this.view.choices.useBackupMetadata, [key]: useBackup } };
      this.options.onRender();
    }));
    root.querySelector<HTMLSelectElement>("[data-backup-import-bulk-action]")?.addEventListener("change", (event) => {
      const select = event.currentTarget as HTMLSelectElement;
      if (!select.value) return;
      const action = select.value as BackupLineAction;
      const rows = this.view.comparison?.lines.filter((row) => this.view.selectedRowKeys.includes(row.key)) ?? [];
      const lineActions = { ...this.view.choices.lineActions };
      for (const row of rows) {
        if (action === "delete" && (!row.current || row.backup)) continue;
        if ((action === "use_backup" || action === "add_separate") && !row.backup) continue;
        lineActions[row.key] = action;
      }
      this.view.choices = { ...this.view.choices, lineActions };
      this.view.selectedRowKeys = []; this.options.onRender();
    });
    root.querySelectorAll<HTMLButtonElement>("[data-backup-import-review-page]").forEach((button) => button.addEventListener("click", () => {
      this.view.reviewPage = Math.max(0, this.view.reviewPage + (button.dataset.backupImportReviewPage === "next" ? 1 : -1));
      this.options.onRender();
    }));
    root.querySelector<HTMLButtonElement>("[data-backup-import-commit]")?.addEventListener("click", () => { void this.commit(); });
  }

  private destination(): UserProject | null {
    return this.options.projects.find((project) => project.projectId === this.view.destinationProjectId) ?? null;
  }

  private refreshComparison(): void {
    const backup = this.view.backupProject;
    const target = this.destination();
    if (!backup || this.view.destinationProjectMode !== "active" || !target) {
      this.view.comparison = null;
      return;
    }
    try {
      this.view.comparison = compareProjectBackup(target, backup, this.view.choices.confirmedPairs);
      const validKeys = new Set(this.view.comparison.lines.map((line) => line.key));
      this.view.choices = {
        ...this.view.choices,
        lineActions: Object.fromEntries(Object.entries(this.view.choices.lineActions ?? {}).filter(([key]) => validKeys.has(key)))
      };
      this.view.selectedRowKeys = this.view.selectedRowKeys.filter((key) => validKeys.has(key));
      this.view.errorMessage = null;
    } catch (error) {
      this.view.comparison = null;
      this.view.errorMessage = error instanceof Error ? error.message : "These Projects could not be compared.";
    }
  }

  private advanceToReview(): void {
    if (this.view.readStatus !== "ready" || !this.view.backupProject) return;
    if (this.view.destinationProjectMode === "active" && !this.view.comparison) {
      this.view.errorMessage = "Choose an active Project in the backup's state."; this.options.onRender(); return;
    }
    if (this.view.destinationProjectMode === "new" && !this.view.newProjectName.trim()) {
      this.view.errorMessage = "Enter a name for the new Project."; this.options.onRender(); return;
    }
    this.view.stage = "review"; this.view.errorMessage = null; this.options.onRender();
  }

  private projection(): BackupMergeProjection | null {
    const target = this.destination();
    const backup = this.view.backupProject;
    if (!target || !backup) return null;
    return buildProjectBackupMerge(target, backup, this.view.choices, {
      timestamp: new Date().toISOString(),
      newLineId: (backupLineId) => {
        let id = this.generatedIds.get(backupLineId);
        if (!id) { id = createId("line"); this.generatedIds.set(backupLineId, id); }
        return id;
      }
    });
  }

  private advanceToConfirm(): void {
    const backup = this.view.backupProject;
    if (!backup) return;
    try {
      if (this.view.destinationProjectMode === "new") {
        const copy = createImportedCopy(backup);
        copy.name = this.view.newProjectName.trim();
        const summary = projectCostSummary(copy);
        this.view.confirmation = { counts: { kept: 0, updated: 0, added: copy.lineItems.length, deleted: 0 }, totalAfter: summary.totalProjectCost, totalDelta: null, canCommit: true };
      } else {
        const projection = this.projection();
        const target = this.destination();
        if (!projection || !target) throw new Error("The destination Project is unavailable.");
        const metadataChanged = Object.values(this.view.choices.useBackupMetadata ?? {}).some(Boolean);
        const noChanges = !metadataChanged && projection.counts.added === 0 && projection.counts.updated === 0 && projection.counts.deleted === 0;
        this.view.confirmation = { counts: projection.counts, totalAfter: projection.summary.totalProjectCost, totalDelta: projection.summary.totalProjectCost - projectCostSummary(target).totalProjectCost, canCommit: true, noChanges };
      }
      this.view.stage = "confirm"; this.view.errorMessage = null;
    } catch (error) {
      this.view.errorMessage = error instanceof Error ? error.message : "The selected changes cannot be applied.";
    }
    this.options.onRender();
  }

  private async commit(): Promise<void> {
    if (this.isCommitting || this.view.stage !== "confirm" || !this.view.confirmation?.canCommit || !this.view.backupProject) return;
    if (this.view.confirmation.noChanges) {
      this.view.commitStatus = "committed";
      this.view.commitMessage = "No Project changes were selected.";
      this.options.onRender();
      return;
    }
    this.view.commitStatus = "committing"; this.view.errorMessage = null; this.options.onRender();
    try {
      const project = this.view.destinationProjectMode === "new" ? createImportedCopy(this.view.backupProject) : this.projection()?.project;
      if (!project) throw new Error("The destination Project is unavailable.");
      if (this.view.destinationProjectMode === "new") project.name = this.view.newProjectName.trim();
      const message = await this.options.onCommit(project, this.view.destinationProjectMode === "new" ? null : this.destination()!.revision);
      this.view.commitStatus = "committed"; this.view.commitMessage = message;
    } catch (error) {
      this.view.commitStatus = "failed";
      this.view.errorMessage = error instanceof Error ? error.message : "The Project backup could not be imported.";
    }
    this.options.onRender();
  }
}
