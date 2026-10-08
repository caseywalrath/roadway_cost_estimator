import type { AgencyItemRecord } from "../data/schema";
import type { ProjectRepository } from "../projects/projectRepository";
import type { UserProject } from "../projects/projectWorkspace";
import { scenarioFingerprint } from "./planningWorkspace";
import type { PlanningRepository } from "./storage/planningRepository";
import type { PlanningWorkspace } from "./types";
import { buildProjectHandoff } from "./projectHandoff";

export interface HandoffRequest {
  planningRepository: Pick<PlanningRepository, "isPersistent" | "getWorkspace" | "saveWorkspace">;
  projectRepository: ProjectRepository;
  workspaceId: string;
  scenarioId: string;
  expectedRevision: number;
  catalog: AgencyItemRecord[];
  projectName: string;
  now: string;
  token: string;
  projectId: string;
  readOnly: boolean;
  /** A deliberate second snapshot is never an update of the first Project. */
  secondSnapshot?: boolean;
}
export interface HandoffOutcome { project: UserProject; workspace: PlanningWorkspace; linkPending: boolean; resumed: boolean }

function matching(project: UserProject, token: string, fingerprint: string): boolean {
  return project.planningOrigin?.token === token && project.planningOrigin.fingerprint === fingerprint;
}

/** Retry-safe across the two independent IndexedDB databases. */
export async function createProjectFromAlternative(request: HandoffRequest): Promise<HandoffOutcome> {
  if (request.readOnly) throw new Error("Take over editing before creating a Project.");
  if (!request.planningRepository.isPersistent || !request.projectRepository.isPersistent) {
    throw new Error("Project handoff requires persistent browser storage for both Planning and Project.");
  }
  let workspace = await request.planningRepository.getWorkspace(request.workspaceId);
  if (!workspace) throw new Error("Planning project was not found.");
  if (workspace.revision !== request.expectedRevision) {
    const latestScenario = workspace.scenarios.find((entry) => entry.scenarioId === request.scenarioId);
    if (!latestScenario?.handoffIntent
      || latestScenario.handoffIntent.fingerprint !== scenarioFingerprint(latestScenario)) {
      throw new Error("Planning project changed. Reload and retry the handoff.");
    }
  }
  const scenario = workspace.scenarios.find((entry) => entry.scenarioId === request.scenarioId);
  if (!scenario) throw new Error("Planning alternative was not found.");
  const currentFingerprint = scenarioFingerprint(scenario);
  if (scenario.handoffIntent?.status === "complete" && !request.secondSnapshot) {
    const existing = await request.projectRepository.getProject(scenario.handoffIntent.targetProjectId);
    if (!existing || !matching(existing, scenario.handoffIntent.token, scenario.handoffIntent.fingerprint)) {
      throw new Error("Linked Project is unavailable or has different Planning provenance.");
    }
    return { project: existing, workspace, linkPending: false, resumed: true };
  }
  if (request.secondSnapshot && scenario.handoffIntent?.status === "pending") {
    throw new Error("Finish the pending Project handoff before taking a second snapshot.");
  }
  let intent = !request.secondSnapshot && scenario.handoffIntent?.status === "pending" ? scenario.handoffIntent : null;
  if (intent && intent.fingerprint !== currentFingerprint) {
    throw new Error("A prior Project handoff is pending for an earlier alternative. Finish that handoff before taking a new snapshot.");
  }
  let resumed = Boolean(intent);
  if (!intent) {
    const built = buildProjectHandoff({ workspace, scenario, catalog: request.catalog,
      token: request.token, projectId: request.projectId, projectName: request.projectName, now: request.now });
    if (!built.ok) throw new Error(built.errors.join(" "));
    intent = { token: request.token, fingerprint: currentFingerprint,
      targetProjectId: request.projectId, payload: built.project, status: "pending" };
    const next = structuredClone(workspace);
    next.scenarios = next.scenarios.map((entry) => entry.scenarioId === scenario.scenarioId ? { ...entry, handoffIntent: intent } : entry);
    try {
      workspace = await request.planningRepository.saveWorkspace(next, workspace.revision, "Before Project handoff");
    } catch (error) {
      const latest = await request.planningRepository.getWorkspace(request.workspaceId);
      const other = latest?.scenarios.find((entry) => entry.scenarioId === request.scenarioId)?.handoffIntent;
      if (!latest || other?.status !== "pending" || other.fingerprint !== currentFingerprint || !other.payload) throw error;
      workspace = latest;
      intent = other;
      resumed = true;
    }
  }
  if (!intent.payload) throw new Error("Pending handoff has no frozen Project payload. Reload a recovery copy or start a new snapshot.");

  let project: UserProject;
  try {
    project = await request.projectRepository.createProject(intent.payload);
  } catch (error) {
    const existing = await request.projectRepository.getProject(intent.targetProjectId);
    if (!existing) throw error;
    if (!matching(existing, intent.token, intent.fingerprint)) {
      throw new Error("Project ID conflict: the existing Project has different Planning provenance.");
    }
    project = existing;
    resumed = true;
  }
  const latest = await request.planningRepository.getWorkspace(request.workspaceId);
  const latestScenario = latest?.scenarios.find((entry) => entry.scenarioId === request.scenarioId);
  if (!latest || latestScenario?.handoffIntent?.token !== intent.token) {
    return { project, workspace, linkPending: true, resumed };
  }
  if (latestScenario.handoffIntent.status === "complete" && latestScenario.projectLink?.projectId === project.projectId) {
    return { project, workspace: latest, linkPending: false, resumed: true };
  }
  const linked = structuredClone(latest);
  linked.scenarios = linked.scenarios.map((entry) => entry.scenarioId === request.scenarioId
    ? { ...entry, handoffIntent: { ...entry.handoffIntent!, status: "complete" },
      projectLink: { projectId: project.projectId, revision: project.revision } }
    : entry);
  try {
    const saved = await request.planningRepository.saveWorkspace(linked, latest.revision, "Link Project handoff");
    return { project, workspace: saved, linkPending: false, resumed };
  } catch {
    return { project, workspace: latest, linkPending: true, resumed };
  }
}
