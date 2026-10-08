import { describe, expect, it } from "vitest";
import type { AgencyItemRecord } from "../data/schema";
import type { ProjectRepository } from "../projects/projectRepository";
import type { UserProject } from "../projects/projectWorkspace";
import { createDefaultAllowances } from "./costEngine";
import { createProjectFromAlternative } from "./projectHandoffService";
import type { PlanningRepository } from "./storage/planningRepository";
import type { CustomComponent, PlanningScenario, PlanningWorkspace } from "./types";

const now = "2026-10-07T12:00:00.000Z";

function scenario(): PlanningScenario {
  const component: CustomComponent = {
    componentId: "direct", segmentId: "segment", scopeId: "roadway", role: "construction",
    description: "Synthetic known scope", category: "construction", unit: "LS", quantity: 1,
    unitRate: 100_000, reason: "Fixture", required: true, tags: [], exclusion: null,
  };
  return {
    scenarioId: "alternative", state: "NE", name: "Alternative", location: "Test location", notes: "Notes",
    segments: [{ segmentId: "segment", name: "Roadway" }], packages: [{
      instanceId: "package", segmentId: "segment", scopeId: "roadway",
      definition: { packageId: "fixture", version: "1", state: "NE", kind: "path", name: "Fixture", status: "provisional", parameters: [], components: [], assumptions: [], exclusions: [] },
      parameterOverrides: {}, quantityOverrides: {}, rateOverrides: {}, rateSnapshots: {}, exclusions: {},
    }],
    customComponents: [component], substitutions: [], allowances: createDefaultAllowances("NE"),
    externalScopes: [
      { scopeId: "right_of_way", decision: "none_assumed", amount: null, reason: "Fixture" },
      { scopeId: "major_utilities", decision: "none_assumed", amount: null, reason: "Fixture" },
    ],
    review: null, history: [], projectLink: null, handoffIntent: null, createdAt: now, updatedAt: now,
  };
}

function workspace(revision = 2): PlanningWorkspace {
  return { schemaVersion: 1, workspaceId: "planning-1", state: "NE", name: "Planning", revision,
    activeScenarioId: "alternative", scenarios: [scenario()], createdAt: now, updatedAt: now,
    lastBackupAt: null, lastBackupRevision: null };
}

type Stores = { planning: PlanningRepository; projects: ProjectRepository; getWorkspace: () => PlanningWorkspace; getProject: (id: string) => UserProject | null; failPlanningSave?: (reason: string) => boolean; failCreate?: boolean };

function stores(initial = workspace()): Stores {
  let current = structuredClone(initial);
  const projects = new Map<string, UserProject>();
  const control = {} as Stores;
  const planning = {
    isPersistent: true,
    getWorkspace: async (id: string) => id === current.workspaceId ? structuredClone(current) : null,
    saveWorkspace: async (next: PlanningWorkspace, expected: number, reason?: string) => {
      if (control.failPlanningSave?.(reason ?? "")) throw new Error("simulated planning write failure");
      if (expected !== current.revision) throw new Error("revision conflict");
      current = { ...structuredClone(next), revision: expected + 1 };
      return structuredClone(current);
    },
  } as Pick<PlanningRepository, "isPersistent" | "getWorkspace" | "saveWorkspace"> as PlanningRepository;
  const projectRepository = {
    isPersistent: true,
    close: () => undefined,
    loadWorkspaceState: async () => ({ schemaVersion: 10 as const, activeProjectIdByState: {}, projects: [...projects.values()] }),
    createProject: async (project: UserProject) => {
      if (projects.has(project.projectId)) throw new Error("duplicate project");
      const saved = { ...structuredClone(project), revision: 1 };
      projects.set(saved.projectId, saved);
      if (control.failCreate) { control.failCreate = false; throw new Error("simulated crash after create"); }
      return structuredClone(saved);
    },
    getProject: async (id: string) => structuredClone(projects.get(id) ?? null),
    saveProject: async (project: UserProject) => { projects.set(project.projectId, structuredClone(project)); return structuredClone(project); },
    appendProjectLines: async () => { throw new Error("unused"); }, applyProjectImport: async () => { throw new Error("unused"); },
    deleteProject: async (id: string) => { projects.delete(id); }, recordBackup: async (id: string) => structuredClone(projects.get(id)!),
    setActiveProjectId: async () => undefined, createRevision: async () => undefined, listRevisions: async () => [],
  } as unknown as ProjectRepository;
  Object.assign(control, { planning, projects: projectRepository, getWorkspace: () => structuredClone(current), getProject: (id: string) => structuredClone(projects.get(id) ?? null) });
  return control;
}

const request = (s: Stores, extra: Partial<Parameters<typeof createProjectFromAlternative>[0]> = {}) => ({
  planningRepository: s.planning, projectRepository: s.projects, workspaceId: "planning-1", scenarioId: "alternative",
  expectedRevision: s.getWorkspace().revision, catalog: [] as AgencyItemRecord[], projectName: "Detailed estimate",
  now, token: "token-1", projectId: "project-1", readOnly: false, ...extra,
});

describe("durable Project handoff service", () => {
  it("refuses read-only and memory-only handoffs", async () => {
    const s = stores();
    await expect(createProjectFromAlternative(request(s, { readOnly: true }))).rejects.toThrow("Take over editing");
    s.planning = { ...s.planning, isPersistent: false };
    await expect(createProjectFromAlternative(request(s))).rejects.toThrow("persistent browser storage");
  });

  it("does not create a Project when saving the intent fails", async () => {
    const s = stores(); s.failPlanningSave = () => true;
    await expect(createProjectFromAlternative(request(s))).rejects.toThrow("simulated planning write failure");
    expect(s.getProject("project-1")).toBeNull();
  });

  it("leaves a pending intent when Project creation fails, then resumes it", async () => {
    const s = stores(); s.failCreate = true;
    const recovered = await createProjectFromAlternative(request(s));
    expect(recovered.resumed).toBe(true);
    const resumed = await createProjectFromAlternative(request(s));
    expect(resumed.resumed).toBe(true);
    expect(resumed.linkPending).toBe(false);
    expect(s.getWorkspace().scenarios[0].handoffIntent?.status).toBe("complete");
  });

  it("retries a failed final link after Project creation", async () => {
    const s = stores();
    let linkSave = true;
    s.failPlanningSave = (reason) => { if (reason === "Link Project handoff" && linkSave) { linkSave = false; return true; } return false; };
    const first = await createProjectFromAlternative(request(s));
    expect(first.linkPending).toBe(true);
    const second = await createProjectFromAlternative(request(s));
    expect(second.linkPending).toBe(false);
    expect(s.getWorkspace().scenarios[0].projectLink).toMatchObject({ projectId: "project-1", revision: 1 });
  });

  it("reuses a matching token and rejects a mismatched existing Project", async () => {
    const s = stores();
    await createProjectFromAlternative(request(s));
    const existing = s.getProject("project-1")!;
    existing.name = "Engineer edits";
    s.projects.saveProject(existing, existing.revision);
    const retry = await createProjectFromAlternative(request(s));
    expect(retry.project.name).toBe("Engineer edits");
    const staleRetry = await createProjectFromAlternative(request(s, { expectedRevision: 2 }));
    expect(staleRetry.project.name).toBe("Engineer edits");

    const conflict = stores();
    await createProjectFromAlternative(request(conflict));
    const other = conflict.getProject("project-1")!;
    other.planningOrigin!.token = "different-token";
    conflict.projects.saveProject(other, other.revision);
    await expect(createProjectFromAlternative(request(conflict))).rejects.toThrow("different Planning provenance");
  });

  it("preserves independent Project edits and supports a deliberate second snapshot", async () => {
    const s = stores();
    const first = await createProjectFromAlternative(request(s));
    const edited = s.getProject("project-1")!;
    edited.notes = "Independent Project edit";
    await s.projects.saveProject(edited, edited.revision);
    const retry = await createProjectFromAlternative(request(s));
    expect(retry.project.notes).toBe("Independent Project edit");

    const second = await createProjectFromAlternative(request(s, { secondSnapshot: true, token: "token-2", projectId: "project-2", projectName: "Second snapshot" }));
    expect(second.project.projectId).toBe("project-2");
    expect(s.getWorkspace().scenarios[0].projectLink?.projectId).toBe("project-2");
    expect(first.project.projectId).toBe("project-1");
  });

  it("reuses the frozen pending payload after a concurrent intent save", async () => {
    const s = stores();
    let first = true;
    const original = s.planning.saveWorkspace.bind(s.planning);
    s.planning.saveWorkspace = async (workspace, expected, reason) => {
      if (first && reason === "Before Project handoff") {
        first = false;
        const winner = structuredClone(workspace);
        winner.scenarios[0].handoffIntent!.token = "winner-token";
        winner.scenarios[0].handoffIntent!.targetProjectId = "winner-project";
        winner.scenarios[0].handoffIntent!.payload!.projectId = "winner-project";
        winner.scenarios[0].handoffIntent!.payload!.planningOrigin!.token = "winner-token";
        await original(winner, expected, reason);
        throw new Error("revision conflict");
      }
      return original(workspace, expected, reason);
    };
    const result = await createProjectFromAlternative(request(s));
    expect(result.resumed).toBe(true);
    expect(result.project.projectId).toBe("winner-project");
    expect(result.project.planningOrigin?.token).toBe("winner-token");
  });
});
