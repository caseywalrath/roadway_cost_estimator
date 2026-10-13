import type { Alternative, PlanningLibrary, PlanningProject, ProjectInputKey, ProjectInputs, ResolvedLibrary, TemplateDefinition } from "./types";

type AnyLibrary = PlanningLibrary | ResolvedLibrary;

function findTemplate(library: AnyLibrary, templateId: string | null): TemplateDefinition | null {
  if (templateId === null) return null;
  const template = library.templates.find((t) => t.id === templateId);
  if (!template) throw new Error(`Template ${templateId} not found in the planning library.`);
  return template;
}

export function createAlternative(
  library: AnyLibrary,
  templateId: string | null,
  options: { id: string; name: string }
): Alternative {
  const template = findTemplate(library, templateId);
  const entries = template ? template.elements : [{ id: "base_none" }];
  const selections: Alternative["selections"] = {};
  for (const entry of entries) {
    selections[entry.id] = { enabled: true, inputs: { ...("inputs" in entry ? entry.inputs : undefined) }, override: null };
  }
  return { id: options.id, name: options.name, description: template?.description ?? "", templateId: template ? template.id : null, selections };
}

export function createProject(
  library: AnyLibrary,
  options: { id: string; name: string; now: string; templateId: string | null; alternativeId: string }
): PlanningProject {
  const template = findTemplate(library, options.templateId);
  const inputs = {} as ProjectInputs;
  for (const definition of library.projectInputs) inputs[definition.key] = definition.default;
  Object.assign(inputs, template?.projectInputs);
  return {
    schemaVersion: 1,
    id: options.id,
    name: options.name,
    state: library.state,
    createdAt: options.now,
    updatedAt: options.now,
    revision: 0,
    templateId: options.templateId,
    inputs,
    stageId: library.defaultStage,
    contingencyRate: null,
    engineering: { ...library.engineering },
    budget: null,
    alternatives: [createAlternative(library, options.templateId, { id: options.alternativeId, name: "Alternative A" })],
    selectedAlternativeId: options.alternativeId
  };
}

/** The template an alternative's elements come from. Alternatives saved before templates were tracked per alternative use the project's. */
export function alternativeTemplateId(project: PlanningProject, alt: Alternative | undefined): string | null {
  if (alt && alt.templateId !== undefined) return alt.templateId;
  return project.templateId;
}

export interface TemplateSwitchPlan {
  /** The project after the switch. */
  project: PlanningProject;
  /** Changes the planner made to the alternative that the switch discards, e.g. "Sidewalk (inputs edited)". */
  lostEdits: string[];
  /** Corridor values the planner changed that the new template replaces. */
  replacedInputs: Array<{ key: ProjectInputKey; label: string; from: number; to: number }>;
}

function sameInputs(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Elements of the alternative that differ from what the template alone would give. */
function editsAgainstTemplate(library: AnyLibrary, alt: Alternative, templateId: string | null): string[] {
  const template = library.templates.find((t) => t.id === templateId);
  const pristine = createAlternative(library, template ? template.id : null, { id: alt.id, name: alt.name }).selections;
  const edits: string[] = [];
  for (const element of library.elements) {
    const want = pristine[element.id];
    const have = alt.selections[element.id];
    const haveOn = Boolean(have?.enabled);
    if (want && !haveOn) edits.push(`${element.label} (turned off)`);
    else if (!want && haveOn) edits.push(`${element.label} (added)`);
    else if (want && have) {
      const changes: string[] = [];
      if (!sameInputs(want.inputs, have.inputs)) changes.push("inputs edited");
      if (have.override !== null) changes.push("price overridden");
      if (changes.length > 0) edits.push(`${element.label} (${changes.join(", ")})`);
    }
  }
  return edits;
}

/**
 * Switches one alternative to another template: its elements are replaced by the template's, and corridor
 * values the previous template set follow the new template. Corridor values the planner changed are kept
 * unless the new template sets the same value. The result lists what the planner would lose.
 */
export function planTemplateSwitch(project: PlanningProject, library: AnyLibrary, altId: string, templateId: string | null): TemplateSwitchPlan {
  const alt = project.alternatives.find((a) => a.id === altId);
  if (!alt) throw new Error(`Alternative ${altId} not found in project ${project.id}.`);
  const next = findTemplate(library, templateId);
  const previousId = alternativeTemplateId(project, alt);
  const previous = library.templates.find((t) => t.id === previousId) ?? null;
  const fresh = createAlternative(library, templateId, { id: alt.id, name: alt.name });

  const seed = (template: TemplateDefinition | null, key: ProjectInputKey): number =>
    template?.projectInputs?.[key] ?? library.projectInputs.find((d) => d.key === key)?.default ?? 0;
  const keys = new Set<ProjectInputKey>([
    ...(Object.keys(previous?.projectInputs ?? {}) as ProjectInputKey[]),
    ...(Object.keys(next?.projectInputs ?? {}) as ProjectInputKey[])
  ]);
  const inputs = { ...project.inputs };
  const replacedInputs: TemplateSwitchPlan["replacedInputs"] = [];
  for (const key of keys) {
    const current = project.inputs[key];
    const nextSeed = seed(next, key);
    if (current === seed(previous, key)) inputs[key] = nextSeed;
    else if (next?.projectInputs?.[key] !== undefined && current !== nextSeed) {
      inputs[key] = nextSeed;
      replacedInputs.push({ key, label: library.projectInputs.find((d) => d.key === key)?.label ?? key, from: current, to: nextSeed });
    }
  }

  const keepDescription = alt.description !== "" && alt.description !== (previous?.description ?? "");
  const switched: Alternative = { ...alt, templateId: next ? next.id : null, description: keepDescription ? alt.description : fresh.description, selections: fresh.selections };
  return {
    project: { ...project, inputs, alternatives: project.alternatives.map((a) => (a.id === altId ? switched : a)) },
    lostEdits: editsAgainstTemplate(library, alt, previousId),
    replacedInputs
  };
}
