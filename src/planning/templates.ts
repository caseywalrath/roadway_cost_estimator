import type { Alternative, PlanningLibrary, PlanningProject, ProjectInputs, ResolvedLibrary, TemplateDefinition } from "./types";

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
  return { id: options.id, name: options.name, description: template?.description ?? "", selections };
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
    engineering: { ...library.engineering },
    budget: null,
    alternatives: [createAlternative(library, options.templateId, { id: options.alternativeId, name: "Alternative A" })],
    selectedAlternativeId: options.alternativeId
  };
}
