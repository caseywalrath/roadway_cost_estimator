import { createAlternative } from "./templates";
import type {
  Alternative,
  ElementSelection,
  InputValue,
  PlanningLibrary,
  PlanningProject,
  ProjectInputKey,
  ResolvedLibrary
} from "./types";

type AnyLibrary = PlanningLibrary | ResolvedLibrary;

const emptySelection = (): ElementSelection => ({ enabled: false, inputs: {}, override: null });

/** Returns a new project with the alternative replaced by fn(alternative). Throws on an unknown id. */
function updateAlternative(project: PlanningProject, altId: string, fn: (alt: Alternative) => Alternative): PlanningProject {
  if (!project.alternatives.some((a) => a.id === altId)) throw new Error(`Alternative ${altId} not found in project ${project.id}.`);
  return { ...project, alternatives: project.alternatives.map((a) => (a.id === altId ? fn(a) : a)) };
}

function updateSelection(
  project: PlanningProject,
  altId: string,
  elementId: string,
  fn: (selection: ElementSelection) => ElementSelection
): PlanningProject {
  return updateAlternative(project, altId, (alt) => ({
    ...alt,
    selections: { ...alt.selections, [elementId]: fn(alt.selections[elementId] ?? emptySelection()) }
  }));
}

/** Enables the chosen base element and disables every other base element. */
export function setBaseTreatment(project: PlanningProject, library: AnyLibrary, altId: string, elementId: string): PlanningProject {
  const baseIds = library.elements.filter((e) => e.group === "base").map((e) => e.id);
  if (!baseIds.includes(elementId)) throw new Error(`${elementId} is not a base treatment.`);
  return updateAlternative(project, altId, (alt) => {
    const selections = { ...alt.selections };
    for (const id of baseIds) {
      if (id !== elementId && selections[id]) selections[id] = { ...selections[id], enabled: false };
    }
    selections[elementId] = { ...(selections[elementId] ?? emptySelection()), enabled: true };
    return { ...alt, selections };
  });
}

/** Pass `library` so that enabling a base element routes through select-one. */
export function setElementEnabled(
  project: PlanningProject,
  altId: string,
  elementId: string,
  enabled: boolean,
  library?: AnyLibrary
): PlanningProject {
  const isBase = library?.elements.some((e) => e.id === elementId && e.group === "base");
  if (enabled && library && isBase) return setBaseTreatment(project, library, altId, elementId);
  return updateSelection(project, altId, elementId, (s) => ({ ...s, enabled }));
}

export function setElementInput(project: PlanningProject, altId: string, elementId: string, key: string, value: InputValue): PlanningProject {
  return updateSelection(project, altId, elementId, (s) => ({ ...s, inputs: { ...s.inputs, [key]: value } }));
}

export function resetElementInput(project: PlanningProject, altId: string, elementId: string, key: string): PlanningProject {
  return updateSelection(project, altId, elementId, (s) => {
    const { [key]: _removed, ...inputs } = s.inputs;
    return { ...s, inputs };
  });
}

export function setElementOverride(project: PlanningProject, altId: string, elementId: string, amount: number | null): PlanningProject {
  return updateSelection(project, altId, elementId, (s) => ({ ...s, override: amount }));
}

export function addAlternative(
  project: PlanningProject,
  library: AnyLibrary,
  templateId: string | null,
  options: { id: string; name: string }
): PlanningProject {
  return { ...project, alternatives: [...project.alternatives, createAlternative(library, templateId, options)] };
}

export function duplicateAlternative(project: PlanningProject, altId: string, options: { id: string; name: string }): PlanningProject {
  const source = project.alternatives.find((a) => a.id === altId);
  if (!source) throw new Error(`Alternative ${altId} not found in project ${project.id}.`);
  const selections: Alternative["selections"] = {};
  for (const [id, s] of Object.entries(source.selections)) selections[id] = { ...s, inputs: { ...s.inputs } };
  const copy: Alternative = { id: options.id, name: options.name, description: source.description, selections };
  const index = project.alternatives.indexOf(source);
  const alternatives = [...project.alternatives.slice(0, index + 1), copy, ...project.alternatives.slice(index + 1)];
  return { ...project, alternatives };
}

/** No-op when the alternative is the last one or does not exist. */
export function removeAlternative(project: PlanningProject, altId: string): PlanningProject {
  const index = project.alternatives.findIndex((a) => a.id === altId);
  if (index < 0 || project.alternatives.length <= 1) return project;
  const alternatives = project.alternatives.filter((a) => a.id !== altId);
  const selectedAlternativeId =
    project.selectedAlternativeId === altId ? alternatives[Math.min(index, alternatives.length - 1)].id : project.selectedAlternativeId;
  return { ...project, alternatives, selectedAlternativeId };
}

export function renameAlternative(project: PlanningProject, altId: string, name: string, description?: string): PlanningProject {
  return updateAlternative(project, altId, (alt) => ({ ...alt, name, description: description ?? alt.description }));
}

export function selectAlternative(project: PlanningProject, altId: string): PlanningProject {
  if (!project.alternatives.some((a) => a.id === altId)) throw new Error(`Alternative ${altId} not found in project ${project.id}.`);
  return { ...project, selectedAlternativeId: altId };
}

export function setProjectInput(project: PlanningProject, key: ProjectInputKey, value: number): PlanningProject {
  return { ...project, inputs: { ...project.inputs, [key]: value } };
}

export function setStage(project: PlanningProject, stageId: string): PlanningProject {
  return { ...project, stageId };
}

export function setEngineering(project: PlanningProject, change: { design?: number; constructionEngineering?: number }): PlanningProject {
  return { ...project, engineering: { ...project.engineering, ...change } };
}

export function setBudget(project: PlanningProject, budget: number | null): PlanningProject {
  return { ...project, budget };
}
