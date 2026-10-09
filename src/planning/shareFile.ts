// Planning v2 share file (JSON). Contract: src/planning/README.md "Share file (JSON)".
// Depends only on ./types. Pure: ids and timestamps are passed in.
import type {
  Alternative,
  ElementSelection,
  InputValue,
  PlanningIssue,
  PlanningLibrary,
  PlanningProject,
  ProjectInputs,
  ResolvedLibrary
} from "./types";

const SHARE_FORMAT = "roadway-cost-estimator/planning";
const SHARE_VERSION = 2;
const BLOCKED_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export type ParseLibrary = Pick<
  PlanningLibrary,
  "state" | "elements" | "stages" | "projectInputs" | "engineering" | "defaultStage"
>;

export type ParseShareResult =
  | { ok: true; project: PlanningProject; issues: PlanningIssue[] }
  | { ok: false; issues: PlanningIssue[] };

export function buildShareFile(
  project: PlanningProject,
  library: Pick<ResolvedLibrary, "state" | "priceBasisLabel">,
  now: string
): string {
  const file = {
    format: SHARE_FORMAT,
    formatVersion: SHARE_VERSION,
    exportedAt: now,
    state: library.state,
    priceBasis: library.priceBasisLabel,
    project
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function parseShareFile(text: string, library: ParseLibrary): ParseShareResult {
  const issues: PlanningIssue[] = [];
  const issue = (code: string, path: string, message: string) => {
    issues.push({ code, path, message });
  };
  const fail = (code: string, path: string, message: string): ParseShareResult => {
    issue(code, path, message);
    return { ok: false, issues };
  };

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail("invalid_json", "", "The file is not valid JSON.");
  }
  if (!isRecord(raw) || raw.format !== SHARE_FORMAT) {
    return fail("wrong_format", "format", "The file is not a Planning share file.");
  }
  if (raw.formatVersion !== SHARE_VERSION) {
    return fail("wrong_version", "formatVersion", "Unsupported share file version.");
  }
  if (raw.state !== library.state) {
    return fail("wrong_state", "state", `The file is for state ${String(raw.state)}, not ${library.state}.`);
  }
  const p = raw.project;
  if (!isRecord(p)) {
    return fail("invalid_project", "project", "The file has no project.");
  }
  if (!Array.isArray(p.alternatives) || p.alternatives.length === 0) {
    return fail("no_alternatives", "project.alternatives", "The project has no alternatives.");
  }

  const elementIds = new Set(library.elements.map((e) => e.id));
  const alternatives: Alternative[] = [];
  const seenIds = new Set<string>();
  for (let i = 0; i < p.alternatives.length; i += 1) {
    const a = p.alternatives[i];
    const path = `project.alternatives[${i}]`;
    if (!isRecord(a) || typeof a.id !== "string" || a.id === "") {
      return fail("invalid_alternative", path, "An alternative is missing its id.");
    }
    if (typeof a.name !== "string") {
      return fail("invalid_alternative", path, "An alternative is missing its name.");
    }
    if (seenIds.has(a.id)) {
      return fail("duplicate_alternative", path, `Duplicate alternative id ${a.id}.`);
    }
    seenIds.add(a.id);

    const selections: Record<string, ElementSelection> = {};
    if (a.selections !== undefined && !isRecord(a.selections)) {
      issue("invalid_selection", `${path}.selections`, "Selections must be an object; ignored.");
    } else if (isRecord(a.selections)) {
      for (const [elementId, sel] of Object.entries(a.selections)) {
        const selPath = `${path}.selections.${elementId}`;
        if (BLOCKED_KEYS.has(elementId)) {
          continue;
        }
        if (!elementIds.has(elementId)) {
          issue("unknown_element", selPath, `Element ${elementId} is not in the library; dropped.`);
          continue;
        }
        if (!isRecord(sel)) {
          issue("invalid_selection", selPath, "Selection must be an object; dropped.");
          continue;
        }
        const inputs: Record<string, InputValue> = {};
        if (sel.inputs !== undefined && !isRecord(sel.inputs)) {
          issue("invalid_input_value", `${selPath}.inputs`, "Inputs must be an object; ignored.");
        } else if (isRecord(sel.inputs)) {
          for (const [key, value] of Object.entries(sel.inputs)) {
            if (BLOCKED_KEYS.has(key)) {
              continue;
            }
            if (isFiniteNumber(value) || typeof value === "string") {
              inputs[key] = value;
            } else {
              issue("invalid_input_value", `${selPath}.inputs.${key}`, "Input must be a finite number or a string; dropped.");
            }
          }
        }
        let override: number | null = null;
        if (isFiniteNumber(sel.override)) {
          override = sel.override;
        } else if (sel.override !== null && sel.override !== undefined) {
          issue("invalid_override", `${selPath}.override`, "Override must be a finite number or null; set to null.");
        }
        selections[elementId] = { enabled: sel.enabled === true, inputs, override };
      }
    }
    alternatives.push({
      id: a.id,
      name: cleanName(a.name),
      description: a.description == null ? "" : String(a.description),
      selections
    });
  }

  const inputs = {} as ProjectInputs;
  const rawInputs = isRecord(p.inputs) ? p.inputs : {};
  for (const def of library.projectInputs) {
    const value = rawInputs[def.key];
    const valid = isFiniteNumber(value)
      && (def.min === undefined || value >= def.min)
      && (!def.integer || Number.isInteger(value));
    if (valid) {
      inputs[def.key] = value;
    } else {
      inputs[def.key] = def.default;
      issue("missing_input", `project.inputs.${def.key}`, `${def.label} is missing or invalid; using the library default.`);
    }
  }

  let stageId = library.defaultStage;
  if (typeof p.stageId === "string" && library.stages.some((s) => s.id === p.stageId)) {
    stageId = p.stageId;
  } else {
    issue("unknown_stage", "project.stageId", `Stage is missing or unknown; using ${library.defaultStage}.`);
  }

  const rawEng = isRecord(p.engineering) ? p.engineering : {};
  const rate = (key: "design" | "constructionEngineering"): number => {
    const value = rawEng[key];
    if (isFiniteNumber(value) && value >= 0 && value <= 1) {
      return value;
    }
    issue("invalid_engineering", `project.engineering.${key}`, "Rate must be between 0 and 1; using the library default.");
    return library.engineering[key];
  };
  const engineering = { design: rate("design"), constructionEngineering: rate("constructionEngineering") };

  let budget: number | null = null;
  if (isFiniteNumber(p.budget) && p.budget >= 0) {
    budget = p.budget;
  } else if (p.budget !== null && p.budget !== undefined) {
    issue("invalid_budget", "project.budget", "Budget must be a number of 0 or more, or null; set to null.");
  }

  const selectedAlternativeId = typeof p.selectedAlternativeId === "string" && seenIds.has(p.selectedAlternativeId)
    ? p.selectedAlternativeId
    : alternatives[0].id;
  if (selectedAlternativeId !== p.selectedAlternativeId) {
    issue("invalid_selected_alternative", "project.selectedAlternativeId", "Selected alternative not found; using the first.");
  }

  const project: PlanningProject = {
    schemaVersion: 1,
    id: typeof p.id === "string" ? p.id : "",
    name: cleanName(p.name),
    state: library.state,
    createdAt: typeof p.createdAt === "string" ? p.createdAt : "",
    updatedAt: typeof p.updatedAt === "string" ? p.updatedAt : "",
    revision: typeof p.revision === "number" && Number.isInteger(p.revision) && p.revision >= 0 ? p.revision : 0,
    templateId: typeof p.templateId === "string" ? p.templateId : null,
    inputs,
    stageId,
    engineering,
    budget,
    alternatives,
    selectedAlternativeId
  };
  return { ok: true, project, issues };
}

function cleanName(value: unknown): string {
  const name = value == null ? "" : String(value).trim();
  return name === "" ? "Untitled" : name;
}

export function importProjectCopy(
  project: PlanningProject,
  options: { newId: () => string; now: string }
): PlanningProject {
  const copy = structuredClone(project);
  const idMap = new Map<string, string>();
  for (const alternative of copy.alternatives) {
    const id = options.newId();
    idMap.set(alternative.id, id);
    alternative.id = id;
  }
  copy.selectedAlternativeId = idMap.get(project.selectedAlternativeId) ?? copy.alternatives[0].id;
  copy.id = options.newId();
  copy.revision = 0;
  copy.createdAt = options.now;
  copy.updatedAt = options.now;
  return copy;
}
