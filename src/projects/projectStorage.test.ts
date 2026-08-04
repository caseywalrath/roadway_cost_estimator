// @vitest-environment jsdom
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StateConfig } from "../data/schema";
import { buildProjectBackup, createImportedCopy, parseProjectBackup } from "./projectBackup";
import { PROJECT_EDIT_STALE_AFTER_MS, ProjectEditCoordinator } from "./projectEditCoordinator";
import { openProjectRepository, ProjectConflictError, type ProjectRepository } from "./projectRepository";
import { renderAddToProjectPanel, renderProjectManager, renderProjectWorkspace } from "../ui/renderProjectWorkspace";
import {
  addProject,
  addProjectLineItem,
  createEmptyProjectWorkspaceState,
  createCustomProjectLineItem,
  createProjectLineItem,
  createUserProject,
  duplicateUserProject,
  getActiveProject,
  migrateLegacyWorkspace,
  parseUserProjectV7,
  parseUserProjectV6,
  parseUserProjectV5,
  projectConstructionCost,
  projectContingencyCost,
  projectLineTotal,
  projectOtherCost,
  projectTotal,
  setActiveProject,
  sortProjectLineItems,
  updateProjectContingencyPercent,
  updateProjectLineItem
} from "./projectWorkspace";

let repository: ProjectRepository | null = null;

beforeEach(async () => {
  TestBroadcastChannel.reset();
  vi.stubGlobal("BroadcastChannel", TestBroadcastChannel);
  window.localStorage.clear();
  await deleteDatabase();
});

afterEach(async () => {
  repository?.close();
  repository = null;
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await deleteDatabase();
});

describe("Project workspace v7", () => {
  it("renders one Project Actions menu without a duplicate workspace state selector", () => {
    const project = createUserProject("Header test", "CO");
    const html = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);

    expect(html).toContain("Project Actions");
    expect(html).toContain("Export CSV");
    expect(html).not.toContain("Export Project CSV");
    expect(html).toContain("Export Project Backup");
    expect(html).toContain("Import Project Backup");
    expect(html).not.toContain('name="state"');
    expect(html).not.toContain('id="project-name"');
    expect(html).toContain("Edit Active Project");
    expect(html).not.toContain("<span>Active Project</span>");
    expect(html).toContain('class="project-switcher-project-state">CO</span>');
  });

  it("shows Project Actions and explicit creation from both empty workspace states", () => {
    const archived = { ...createUserProject("Archived", "CO"), status: "archived" as const };
    const freshHtml = renderProjectWorkspace(null, [], testStates(), "CO", false, null);
    const archivedHtml = renderProjectWorkspace(null, [archived], testStates(), "CO", false, null);

    for (const html of [freshHtml, archivedHtml]) {
      expect(html).toContain("Project Actions");
      expect(html).toContain("No Active Project");
      expect(html).toContain("New Project");
      expect(html).not.toContain("project-metadata-editor-form");
    }
  });

  it("renders workspace creation without a default manager creation editor", () => {
    const createEditor = {
      context: "workspace" as const,
      mode: "create" as const,
      projectId: null,
      state: "CO",
      name: "",
      location: "",
      notes: ""
    };
    const workspaceHtml = renderProjectWorkspace(null, [], testStates(), "CO", false, createEditor);
    const managerHtml = renderProjectManager([], testStates(), "CO", { query: "", state: "all", status: "active" }, null, false, null);

    expect(workspaceHtml).toContain("<h2>New Project</h2>");
    expect(workspaceHtml).not.toContain("Create a Colorado Project");
    expect(workspaceHtml).not.toContain('class="eyebrow"');
    expect(workspaceHtml).toContain('name="notes"');
    expect(managerHtml).toContain("<h2>Project Manager</h2>");
    expect(managerHtml).not.toContain('class="eyebrow"');
    expect(managerHtml).toContain("Project Actions");
    expect(managerHtml).not.toContain('id="manager-project-editor-form"');
    expect(managerHtml).not.toContain("New Project</p><h2>");
  });

  it("renders the simplified manager and permanent delete only for archived Projects", () => {
    const active = createUserProject("Active", "CO");
    const archived = { ...createUserProject("Archived", "IA"), status: "archived" as const, archivedAt: new Date().toISOString() };
    const activeHtml = renderProjectManager([active, archived], testStates(), "CO", { query: "", state: "all", status: "active" }, active, false, null);
    const archivedHtml = renderProjectManager([active, archived], testStates(), "CO", { query: "", state: "all", status: "archived" }, active, false, null);

    expect(activeHtml).toContain('class="text-button" data-open-project');
    expect(activeHtml).toContain('class="primary-button" data-start-new-project');
    expect(activeHtml).not.toContain("Version history");
    expect(activeHtml).not.toContain("<th>Backup</th>");
    expect(activeHtml).not.toContain("Create, switch, back up, and archive browser Projects.");
    expect(activeHtml.indexOf("Back to active Project")).toBeLessThan(activeHtml.indexOf("Project Actions"));
    expect(activeHtml).not.toContain("data-delete-project");
    expect(archivedHtml).toContain('data-delete-project');
    expect(archivedHtml).toContain('aria-label="Permanently delete Archived"');
  });

  it("does not render an empty-line message for a Project with zero items", () => {
    const project = createUserProject("Empty", "CO");
    const html = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);
    expect(html).not.toContain("0 lines");
    expect(html).toContain(">+Add Item</button>");
    expect(html).not.toContain("No project items have been added");
  });

  it("renders custom rows with editable fields and keeps Explorer identity fields read-only", () => {
    const project = createUserProject("Mixed", "CO");
    const custom = createCustomProjectLineItem("CO");
    custom.itemCode = "SOFT";
    custom.group = "Construction";
    custom.description = "Soft costs";
    custom.unit = "LS";
    custom.quantity = 2;
    custom.preferredUnitCost = 25;
    project.lineItems = [custom];

    const html = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);
    expect(html).toContain('data-project-line-field="itemCode"');
    expect(html).toContain('data-project-line-field="group"');
    expect(html).toContain('value="Construction"');
    expect(html).toContain('data-project-line-field="description"');
    expect(html).toContain('data-project-line-field="unit"');
    expect(html).toContain("$50.00");
    expect(html.indexOf("SOFT")).toBeGreaterThan(html.indexOf("+Add Item"));

    const explorer = { ...custom, lineItemId: "explorer_line", lineItemType: "explorer" as const, agencyId: "co_cdot", agencyItemId: "co_cdot_soft", evidenceContext: {
      query: {} as never,
      filters: {} as never,
      sort: {} as never,
      includedRowCount: 0,
      includedObservationIds: [],
      summarySnapshot: { awarded: null, average: null, engineer: null, inflationAdjustmentEnabled: false, inflationTargetPeriodLabel: null, valuesAreInflationAdjusted: false },
      costSource: "manual" as const
    } };
    project.lineItems = [explorer];
    const explorerHtml = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);
    expect(explorerHtml).toContain('data-project-line-field="group"');
    expect(explorerHtml).not.toContain('data-project-line-field="itemCode"');
    expect(explorerHtml).not.toContain('data-project-line-field="description"');
    expect(explorerHtml).not.toContain('data-project-line-field="unit"');
  });

  it("renders sortable Project headers and keeps custom rows editable after sorting", () => {
    const project = createUserProject("Sortable", "CO");
    const first = createCustomProjectLineItem("CO");
    first.group = "B";
    first.itemCode = "20";
    const second = createCustomProjectLineItem("CO");
    second.group = "A";
    second.itemCode = "3";
    const blank = createCustomProjectLineItem("CO");
    project.lineItems = [first, blank, second];

    const container = document.createElement("div");
    container.innerHTML = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);

    expect(container.querySelectorAll("[data-project-sort-key]")).toHaveLength(8);
    expect(container.querySelector("th:last-child [data-project-sort-key]")).toBeNull();
    expect(container.querySelector('th[aria-sort="ascending"]')?.classList.contains("table-sorted-column")).toBe(true);
    expect(container.querySelector('[data-project-sort-key="group"]')?.textContent).toContain("Group");
    expect(container.querySelector('[data-project-sort-key="group"] .sort-indicator')?.classList.contains("sort-indicator--asc")).toBe(true);
    expect([...container.querySelectorAll("tbody tr")].map((row) => row.querySelector<HTMLInputElement>('[data-project-line-field="itemCode"]')?.value))
      .toEqual(["3", "20", ""]);
    expect(container.querySelectorAll('[data-project-line-field="itemCode"]')).toHaveLength(3);

    container.innerHTML = renderProjectWorkspace(project, [project], testStates(), "CO", false, null, { key: "quantity", direction: "desc" });
    expect(container.querySelector('th[aria-sort="descending"] [data-project-sort-key="quantity"]')).not.toBeNull();
    expect(container.querySelector('[data-project-sort-key="quantity"] .sort-indicator')?.classList.contains("sort-indicator--desc")).toBe(true);
  });

  it("creates, updates, totals, and persists incomplete custom lines", () => {
    const project = createUserProject("Custom", "CO");
    const custom = createCustomProjectLineItem("CO");
    expect(custom.lineItemType).toBe("custom");
    expect(custom.quantity).toBeNull();
    expect(custom.preferredUnitCost).toBeNull();
    expect(projectLineTotal(custom)).toBe(0);

    let state = addProject(createEmptyProjectWorkspaceState(), project);
    state = updateProjectLineItem(state, project.projectId, custom.lineItemId, {
      group: "  Construction  ",
      itemCode: "SOFT",
      description: "Soft costs",
      unit: "LS",
      quantity: 2,
      preferredUnitCost: 25,
      notes: "Manual"
    });
    expect(state.projects[0].lineItems).toHaveLength(0);
    state = addProjectLineItem(state, project.projectId, custom);
    state = updateProjectLineItem(state, project.projectId, custom.lineItemId, {
      group: "  Construction  ",
      itemCode: "SOFT",
      description: "Soft costs",
      unit: "LS",
      quantity: 2,
      preferredUnitCost: 25,
      notes: "Manual"
    });
    const updated = state.projects[0];
    expect(updated.lineItems[0].description).toBe("Soft costs");
    expect(updated.lineItems[0].group).toBe("Construction");
    expect(projectTotal(updated)).toBe(50);
  });

  it("splits Construction and Other Costs and applies persisted contingencies", () => {
    const project = createUserProject("Cost summary", "CO");
    const explorer = createProjectLineItem({
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_001",
      group: "",
      itemCode: "001",
      description: "Construction item",
      unit: "EACH",
      quantity: 2,
      preferredUnitCost: 100,
      notes: "",
      evidenceContext: {} as never
    });
    const custom = createCustomProjectLineItem("CO");
    custom.itemCode = "SOFT";
    custom.quantity = 1;
    custom.preferredUnitCost = 50;
    project.lineItems = [explorer, custom];
    project.contingencyPercent = 15;

    expect(projectConstructionCost(project)).toBe(200);
    expect(projectOtherCost(project)).toBe(50);
    expect(projectContingencyCost(project)).toBe(37.5);
    expect(projectTotal(project)).toBe(287.5);

    const state = updateProjectContingencyPercent(
      addProject(createEmptyProjectWorkspaceState(), project),
      project.projectId,
      20
    );
    const updated = state.projects[0];
    expect(updated.contingencyPercent).toBe(20);
    expect(projectContingencyCost(updated)).toBe(50);
    expect(projectTotal(updated)).toBe(300);

    const html = renderProjectWorkspace(updated, [updated], testStates(), "CO", false, null);
    expect(html).toContain("Construction bid items");
    expect(html).toContain("Other costs");
    expect(html).toContain('data-project-contingency-percent');
    expect(html).toContain('value="20"');
    expect(html).toContain("$50.00");
    expect(html).toContain("$300");
    const readOnlyHtml = renderProjectWorkspace(updated, [updated], testStates(), "CO", true, null);
    expect(readOnlyHtml).toContain('data-project-contingency-percent');
    expect(readOnlyHtml).toContain('data-project-contingency-percent aria-label="Contingency percentage" value="20" disabled');
  });

  it("migrates missing v5 Groups as blank and permits Explorer Group edits", () => {
    const project = createUserProject("Group migration", "CO");
    const custom = createCustomProjectLineItem("CO");
    const rawProject = { ...project, lineItems: [{ ...custom, lineItemType: "custom" as const, group: undefined }] };
    const parsed = parseUserProjectV6(rawProject);
    expect(parsed?.lineItems[0].group).toBe("");

    const explorer = createProjectLineItem({
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_001",
      group: "Construction",
      itemCode: "001",
      description: "Test item",
      unit: "EACH",
      quantity: 1,
      preferredUnitCost: 2,
      notes: "",
      evidenceContext: {} as never
    });
    project.lineItems = [explorer];
    const state = updateProjectLineItem(
      addProject(createEmptyProjectWorkspaceState(), project),
      project.projectId,
      explorer.lineItemId,
      { group: "  Maintenance  " }
    );
    expect(state.projects[0].lineItems[0].group).toBe("Maintenance");
    expect(state.projects[0].lineItems[0].itemCode).toBe("001");
  });

  it("migrates v6 Projects without contingency percentages as zero", () => {
    const project = createUserProject("Legacy v6", "CO");
    const legacyProject = { ...project };
    delete (legacyProject as Partial<typeof legacyProject>).contingencyPercent;

    expect(parseUserProjectV6(legacyProject)?.contingencyPercent).toBe(0);
    expect(parseUserProjectV7(legacyProject)?.contingencyPercent).toBe(0);
  });

  it("renders current-Project Group suggestions in Project and Explorer views", () => {
    const project = createUserProject("Suggestions", "CO");
    const first = createCustomProjectLineItem("CO");
    first.group = "Construction";
    const duplicate = createCustomProjectLineItem("CO");
    duplicate.group = "construction";
    project.lineItems = [first, duplicate];
    const workspaceHtml = renderProjectWorkspace(project, [project], testStates(), "CO", false, null);
    const result = { query: { itemCode: "001", state: "CO", unit: "EACH" } } as never;
    const explorerHtml = renderAddToProjectPanel(result, project, null, null);

    expect(workspaceHtml.match(/<option value="Construction"><\/option>/g)).toHaveLength(1);
    expect(workspaceHtml).toContain('data-project-group-options');
    expect(explorerHtml).toContain('name="group"');
    expect(explorerHtml.indexOf('name="group"')).toBeLessThan(explorerHtml.indexOf('name="preferredUnitCost"'));
    expect(explorerHtml.indexOf('name="preferredUnitCost"')).toBeLessThan(explorerHtml.indexOf('name="quantity"'));
    expect(explorerHtml).toContain('value="Construction"');
  });

  it("normalizes v4 Project lines as Explorer-backed lines", () => {
    const project = createUserProject("Legacy v4", "CO");
    const custom = createCustomProjectLineItem("CO");
    const legacyLine = {
      ...custom,
      lineItemId: "legacy_line",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_001",
      itemCode: "001",
      description: "Legacy item",
      unit: "EACH",
      quantity: 1,
      preferredUnitCost: 2,
      evidenceContext: {
        query: {} as never,
        filters: {} as never,
        sort: {} as never,
        includedRowCount: 0,
        includedObservationIds: [],
        summarySnapshot: { awarded: null, average: null, engineer: null, inflationAdjustmentEnabled: false, inflationTargetPeriodLabel: null, valuesAreInflationAdjusted: false },
        costSource: "manual" as const
      }
    };
    const rawProject = { ...project, lineItems: [{ ...legacyLine, lineItemType: undefined }] };
    const parsed = parseUserProjectV5(rawProject);
    expect(parsed?.lineItems[0].lineItemType).toBe("explorer");
  });

  it("tracks an independent active Project for each state", () => {
    const colorado = createUserProject("Colorado estimate", "CO");
    const iowa = createUserProject("Iowa estimate", "IA");
    let state = addProject(createEmptyProjectWorkspaceState(), colorado);
    state = addProject(state, iowa);
    state = setActiveProject(state, colorado.projectId, "CO");

    expect(getActiveProject(state, "CO")?.projectId).toBe(colorado.projectId);
    expect(getActiveProject(state, "IA")?.projectId).toBe(iowa.projectId);
  });

  it("duplicates Project and line identities without changing evidence", () => {
    const project = createUserProject("Estimate", "CO");
    project.contingencyPercent = 12.5;
    project.lineItems = [{
      lineItemId: "line_original",
      lineItemType: "explorer",
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_001",
      group: "Construction",
      itemCode: "001",
      description: "Test item",
      unit: "EACH",
      quantity: 1,
      preferredUnitCost: 2,
      notes: "",
      evidenceContext: {
        query: {} as never,
        filters: {} as never,
        sort: {} as never,
        includedRowCount: 0,
        includedObservationIds: ["observation_1"],
        summarySnapshot: {
          awarded: null,
          average: null,
          engineer: null,
          inflationAdjustmentEnabled: false,
          inflationTargetPeriodLabel: null,
          valuesAreInflationAdjusted: false
        },
        costSource: "manual"
      },
      createdAt: project.createdAt,
      updatedAt: project.updatedAt
    }];

    const duplicate = duplicateUserProject(project);
    expect(duplicate.projectId).not.toBe(project.projectId);
    expect(duplicate.contingencyPercent).toBe(12.5);
    expect(duplicate.lineItems[0].lineItemId).not.toBe(project.lineItems[0].lineItemId);
    expect(duplicate.lineItems[0].group).toBe("Construction");
    expect(duplicate.lineItems[0].evidenceContext?.includedObservationIds).toEqual(["observation_1"]);
  });

  it("rejects a legacy Project rather than silently dropping an invalid line", () => {
    const result = migrateLegacyWorkspace({
      schemaVersion: 3,
      activeProjectId: "project_bad",
      projects: [{
        projectId: "project_bad",
        state: "CO",
        name: "Bad estimate",
        location: "",
        notes: "",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        lineItems: [{ lineItemId: "line_bad", quantity: "not-a-number" }]
      }]
    }, 3);

    expect(result.state.projects).toHaveLength(0);
    expect(result.rejectedProjectCount).toBe(1);
    expect(result.errors[0]).toContain("without dropping data");
  });

  it("removes only blank zero-line legacy placeholders and reconciles active state", () => {
    const blank = legacyProject("project_blank", "CO", "");
    const named = legacyProject("project_named", "CO", "Named estimate");
    const result = migrateLegacyWorkspace({
      schemaVersion: 3,
      activeProjectId: "project_blank",
      projects: [blank, named]
    }, 3);

    expect(result.state.projects.map((project) => project.projectId)).toEqual(["project_named"]);
    expect(result.state.activeProjectIdByState.CO).toBe("project_named");
    expect(result.removedPlaceholderProjectIds).toEqual(["project_blank"]);
    expect(result.removedPlaceholderProjectCount).toBe(1);
    expect(result.rejectedProjectCount).toBe(0);
    expect(result.state.projects.length + result.rejectedProjectCount + result.removedPlaceholderProjectCount).toBe(result.sourceProjectCount);
  });

  it.each([1, 2] as const)("migrates a v%s workspace into Colorado", (schemaVersion) => {
    const project = legacyProject(`project_v${schemaVersion}`, "CO", `Version ${schemaVersion}`);
    delete project.state;
    const result = migrateLegacyWorkspace({
      schemaVersion,
      activeProjectId: project.projectId,
      projects: [project]
    }, schemaVersion);

    expect(result.errors).toEqual([]);
    expect(result.state.projects[0].state).toBe("CO");
    expect(result.state.activeProjectIdByState.CO).toBe(project.projectId);
  });
});

describe("Project backup format", () => {
  it("round trips a v7 Project with custom lines and creates collision-safe copies", () => {
    const project = { ...createUserProject("Backup test", "IA"), contingencyPercent: 12.5, revision: 7 };
    const custom = createCustomProjectLineItem("IA");
    custom.itemCode = "SOFT";
    custom.description = "Soft costs";
    custom.quantity = 2;
    custom.preferredUnitCost = 25;
    project.lineItems = [custom];
    const parsed = parseProjectBackup(JSON.parse(JSON.stringify(buildProjectBackup(project))) as unknown);
    expect(parsed?.project).toEqual(project);
    expect(parsed?.projectSchemaVersion).toBe(7);
    expect(parsed?.summary).toEqual({
      constructionCost: 0,
      otherCost: 50,
      contingencyPercent: 12.5,
      contingencyCost: 6.25,
      totalProjectCost: 56.25
    });

    const copy = createImportedCopy(parsed!.project);
    expect(copy.projectId).not.toBe(project.projectId);
    expect(copy.name).toBe("Copy of Backup test");
    expect(copy.revision).toBe(0);
  });

  it("accepts v4 Project backups and normalizes them to v7", () => {
    const project = createUserProject("Legacy backup", "CO");
    const backup = buildProjectBackup(project);
    const legacyBackup = { ...backup, projectSchemaVersion: 4 };
    const parsed = parseProjectBackup(legacyBackup);
    expect(parsed?.projectSchemaVersion).toBe(7);
    expect(parsed?.project).toEqual(project);
    expect(parsed?.summary.totalProjectCost).toBe(0);
  });

  it("accepts v5 backups without Group and normalizes the field to blank", () => {
    const project = createUserProject("Legacy v5 backup", "CO");
    const custom = createCustomProjectLineItem("CO");
    custom.itemCode = "SOFT";
    project.lineItems = [custom];
    const backup = buildProjectBackup(project);
    const legacyProject = {
      ...project,
      lineItems: project.lineItems.map(({ group: _group, ...lineItem }) => lineItem)
    };
    const parsed = parseProjectBackup({ ...backup, projectSchemaVersion: 5, project: legacyProject });

    expect(parsed?.projectSchemaVersion).toBe(7);
    expect(parsed?.project.lineItems[0].group).toBe("");
  });

  it("accepts v6 backups without contingency percentages and normalizes them to zero", () => {
    const project = createUserProject("Legacy v6 backup", "CO");
    const backup = buildProjectBackup(project);
    const legacyProject = { ...project };
    delete (legacyProject as Partial<typeof legacyProject>).contingencyPercent;
    const parsed = parseProjectBackup({
      ...backup,
      projectSchemaVersion: 6,
      project: legacyProject
    });

    expect(parsed?.projectSchemaVersion).toBe(7);
    expect(parsed?.project.contingencyPercent).toBe(0);
    expect(parsed?.summary.totalProjectCost).toBe(0);
  });

  it("rejects unsupported JSON files", () => {
    expect(parseProjectBackup({ fileFormat: "other" })).toBeNull();
    const project = { ...createUserProject("Revision mismatch", "CO"), revision: 3 };
    expect(parseProjectBackup({ ...buildProjectBackup(project), revision: 2 })).toBeNull();
  });
});

describe.sequential("IndexedDB Project repository", () => {
  it("migrates v3 Projects, preserves the raw record, and resolves active state", async () => {
    const rawValue = JSON.stringify({
      schemaVersion: 3,
      activeProjectId: "project_co",
      projects: [
        legacyProject("project_co", "CO", "Colorado"),
        legacyProject("project_ia", "IA", "Iowa")
      ]
    });
    window.localStorage.setItem("roadway-cost-estimator:projects:v3", rawValue);

    const initialized = await openProjectRepository();
    repository = initialized.repository;
    expect(initialized.state.projects).toHaveLength(2);
    expect(initialized.state.activeProjectIdByState).toEqual({ CO: "project_co", IA: "project_ia" });
    expect(window.localStorage.getItem("roadway-cost-estimator:projects:v3")).not.toBeNull();
    expect((await readAllRecords<{ rawValue: string }>("migrationBackups"))[0].rawValue).toBe(rawValue);
  });

  it("preserves an invalid legacy Project for recovery without partially migrating it", async () => {
    const rawValue = JSON.stringify({
      schemaVersion: 3,
      activeProjectId: "project_bad",
      projects: [{ ...legacyProject("project_bad", "CO", "Bad"), lineItems: [{ lineItemId: "bad" }] }]
    });
    window.localStorage.setItem("roadway-cost-estimator:projects:v3", rawValue);

    const initialized = await openProjectRepository();
    repository = initialized.repository;
    expect(initialized.state.projects).toEqual([]);
    expect(initialized.warning).toContain("could not be migrated");
    expect((await readAllRecords<{ rawValue: string }>("migrationBackups"))[0].rawValue).toBe(rawValue);
  });

  it("removes an already-migrated legacy placeholder once and clears its active ID", async () => {
    const placeholder = { ...createUserProject("", "CO"), projectId: "project_legacy_placeholder", revision: 1 };
    await seedAlreadyMigratedPlaceholder(placeholder);

    const initialized = await openProjectRepository();
    repository = initialized.repository;
    expect(initialized.state.projects).toEqual([]);
    expect(initialized.state.activeProjectIdByState.CO).toBeNull();
    expect((await readAllRecords<{ rawValue: string }>("migrationBackups"))[0].rawValue).toBe("exact legacy value");
    expect((await readAllRecords<{ placeholderCleanupVersion: number }>("settings"))[0].placeholderCleanupVersion).toBe(1);
  });

  it("stores Projects independently and enforces optimistic revisions", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const first = await repository.createProject(createUserProject("First", "CO"));
    const second = await repository.createProject(createUserProject("Second", "CO"));
    await repository.setActiveProjectId("CO", second.projectId);

    const saved = await repository.saveProject({ ...first, notes: "updated" }, first.revision);
    expect(saved.revision).toBe(first.revision + 1);
    await expect(repository.saveProject(first, first.revision)).rejects.toBeInstanceOf(ProjectConflictError);

    const loaded = await repository.loadWorkspaceState();
    expect(loaded.projects.map((project) => project.name).sort()).toEqual(["First", "Second"]);
    expect(loaded.activeProjectIdByState.CO).toBe(second.projectId);
  });

  it("persists incomplete custom lines through IndexedDB reloads", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const project = createUserProject("Custom persistence", "CO");
    project.contingencyPercent = 12.5;
    const custom = createCustomProjectLineItem("CO");
    custom.group = "Construction";
    custom.itemCode = "SOFT";
    project.lineItems = [custom];
    const saved = await repository.createProject(project);

    const loaded = await repository.getProject(saved.projectId);
    expect(loaded?.lineItems[0].lineItemType).toBe("custom");
    expect(loaded?.lineItems[0].group).toBe("Construction");
    expect(loaded?.lineItems[0].itemCode).toBe("SOFT");
    expect(loaded?.lineItems[0].quantity).toBeNull();
    expect(loaded?.lineItems[0].evidenceContext).toBeNull();
    expect(loaded?.contingencyPercent).toBe(12.5);
  });

  it("retains only the latest 20 snapshots", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    let project = await repository.createProject(createUserProject("History", "CO"));
    for (let index = 0; index < 25; index += 1) {
      project = await repository.saveProject({ ...project, notes: String(index) }, project.revision);
      await repository.createRevision(project, `Snapshot ${index}`);
    }
    const revisions = await repository.listRevisions(project.projectId);
    expect(revisions).toHaveLength(20);
    expect(revisions[0].revision).toBe(project.revision);
  });

  it("records backup status without creating a new Project revision", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const project = await repository.createProject(createUserProject("Backup", "CO"));
    const backedUp = await repository.recordBackup(project.projectId, project.revision);
    expect(backedUp.revision).toBe(project.revision);
    expect(backedUp.lastBackupRevision).toBe(project.revision);
  });

  it("permanently deletes only archived Projects and their snapshots", async () => {
    const initialized = await openProjectRepository();
    repository = initialized.repository;
    const active = await repository.createProject(createUserProject("Active", "CO"));
    await expect(repository.deleteProject(active.projectId)).rejects.toThrow("Only archived Projects");

    const archived = await repository.saveProject({ ...active, status: "archived", archivedAt: new Date().toISOString() }, active.revision);
    await repository.createRevision(archived, "Archived snapshot");
    await repository.deleteProject(archived.projectId);

    expect(await repository.getProject(archived.projectId)).toBeNull();
    expect(await repository.listRevisions(archived.projectId)).toEqual([]);
  });
});

describe("Project edit coordination", () => {
  it("opens a second tab read-only and permits an explicit takeover", async () => {
    const first = new ProjectEditCoordinator();
    const second = new ProjectEditCoordinator();
    const lostOwnership = vi.fn();
    first.setLostOwnershipHandler(lostOwnership);

    const firstClaim = first.claim("project_shared");
    await new Promise((resolve) => window.setTimeout(resolve, 180));
    expect(await firstClaim).toBe(true);
    expect(await second.claim("project_shared")).toBe(false);
    second.takeOver("project_shared");
    expect(lostOwnership).toHaveBeenCalledOnce();

    first.close();
    second.close();
  });

  it("releases a stale editing claim after the heartbeat deadline", async () => {
    vi.useFakeTimers();
    const first = new ProjectEditCoordinator();
    const second = new ProjectEditCoordinator();
    const firstClaim = first.claim("project_stale");
    await vi.advanceTimersByTimeAsync(175);
    expect(await firstClaim).toBe(true);
    expect(await second.claim("project_stale")).toBe(false);
    const available = vi.fn();
    second.setOwnershipAvailableHandler(available);
    first.close();

    await vi.advanceTimersByTimeAsync(PROJECT_EDIT_STALE_AFTER_MS);
    expect(available).toHaveBeenCalledOnce();
    second.close();
  });
});

function legacyProject(projectId: string, state: string, name: string): Record<string, unknown> {
  return {
    projectId,
    state,
    name,
    location: "",
    notes: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: state === "IA" ? "2026-02-01T00:00:00.000Z" : "2026-01-01T00:00:00.000Z",
    lineItems: []
  };
}

function testStates(): StateConfig[] {
  return [{ code: "CO", name: "Colorado" }, { code: "IA", name: "Iowa" }] as unknown as StateConfig[];
}

function seedAlreadyMigratedPlaceholder(project: ReturnType<typeof createUserProject>): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("roadway-cost-estimator", 1);
    request.onerror = () => reject(request.error);
    request.onupgradeneeded = () => {
      const database = request.result;
      const projects = database.createObjectStore("projects", { keyPath: "projectId" });
      projects.createIndex("state", "state");
      projects.createIndex("status", "status");
      projects.createIndex("updatedAt", "updatedAt");
      database.createObjectStore("settings", { keyPath: "key" });
      const revisions = database.createObjectStore("revisions", { keyPath: ["projectId", "revision"] });
      revisions.createIndex("projectId", "projectId");
      revisions.createIndex("createdAt", "createdAt");
      database.createObjectStore("migrationBackups", { keyPath: "backupId" });
    };
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(["projects", "settings", "migrationBackups"], "readwrite");
      transaction.objectStore("projects").put(project);
      transaction.objectStore("settings").put({
        key: "workspace",
        activeProjectIdByState: { CO: project.projectId },
        migrationComplete: true,
        migratedAt: "2026-01-01T00:00:00.000Z"
      });
      transaction.objectStore("migrationBackups").put({
        backupId: "migration_old",
        sourceKey: "roadway-cost-estimator:projects:v3",
        schemaVersion: 3,
        rawValue: "exact legacy value",
        createdAt: "2026-01-01T00:00:00.000Z",
        report: {
          state: { schemaVersion: 4, activeProjectIdByState: { CO: project.projectId }, projects: [project] },
          rejectedProjectCount: 0,
          sourceProjectCount: 1,
          sourceLineItemCount: 0,
          migratedLineItemCount: 0,
          errors: []
        }
      });
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => reject(transaction.error);
    };
  });
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase("roadway-cost-estimator");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
}

function readAllRecords<T>(storeName: string): Promise<T[]> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("roadway-cost-estimator");
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(storeName, "readonly");
      const records = transaction.objectStore(storeName).getAll();
      records.onerror = () => reject(records.error);
      records.onsuccess = () => {
        database.close();
        resolve(records.result as T[]);
      };
    };
  });
}

class TestBroadcastChannel {
  static channels = new Map<string, Set<TestBroadcastChannel>>();
  onmessage: ((event: MessageEvent) => void) | null = null;

  constructor(readonly name: string) {
    const channels = TestBroadcastChannel.channels.get(name) ?? new Set<TestBroadcastChannel>();
    channels.add(this);
    TestBroadcastChannel.channels.set(name, channels);
  }

  postMessage(message: unknown): void {
    for (const channel of TestBroadcastChannel.channels.get(this.name) ?? []) {
      if (channel !== this) channel.onmessage?.({ data: structuredClone(message) } as MessageEvent);
    }
  }

  close(): void {
    TestBroadcastChannel.channels.get(this.name)?.delete(this);
  }

  static reset(): void {
    TestBroadcastChannel.channels.clear();
  }
}
