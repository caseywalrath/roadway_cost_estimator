// The application intentionally has no Node type dependency; Vitest supplies these runtime modules.
// @ts-expect-error Vitest's Node runtime provides this module without @types/node.
import { readFile } from "node:fs/promises";
// @ts-expect-error Vitest's Node runtime provides this module without @types/node.
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { loadManifest, loadStateData } from "../data/loadData";
import type { AppData } from "../data/schema";
import { calculateScenarioCosts } from "./costEngine";
import { buildPlannerEstimate } from "./plannerPresentation";
import { buildProjectHandoff } from "./projectHandoff";
import { createPackageInstance, createPlanningScenario, editPlanningScenario } from "./planningWorkspace";
import { buildColoradoContractRateSnapshot } from "./rates/coloradoRates";
import { resolveNebraskaAnnualRate } from "./rates/nebraskaRates";
import { COLORADO_PILOT_PACKAGES } from "./recipes/coloradoPilot";
import { NEBRASKA_PILOT_PACKAGES } from "./recipes/nebraskaPilot";
import { pilotManualRate, pilotManualReason } from "./recipes/pilotDefaults";
import type { PackageDefinition, PlanningScenario, PlanningState, RateSnapshot } from "./types";

const capturedAt = "2026-10-07T00:00:00Z";
declare const process: { cwd(): string };
const dataRoot = resolve(process.cwd(), "public", "data");
const originalFetch = globalThis.fetch;

function dataFetch(input: RequestInfo | URL): Promise<Response> {
  const requestUrl = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const relative = new URL(requestUrl, "http://planning.test/").pathname.replace(/^\/+/, "");
  const file = resolve(dataRoot, relative.replace(/^data\//, ""));
  return readFile(file).then((body: Uint8Array) => new Response(body as unknown as BodyInit)).catch(() => new Response("Not found", { status: 404 }));
}

async function loadRealState(state: PlanningState): Promise<AppData> {
  return loadStateData(await loadManifest(), state);
}

function addAndPrice(data: AppData, state: PlanningState, definition: PackageDefinition): PlanningScenario {
  const created = createPlanningScenario({ scenarioId: `${state}-${definition.kind}`, state, name: `${state} ${definition.kind}`, now: capturedAt });
  if (!created.ok) throw new Error(created.issues.map((issue) => issue.message).join("; "));
  let scenario = created.value;
  const segmented = editPlanningScenario(scenario, { kind: "set_segments", segments: [{ segmentId: "segment-1", name: "Half-mile pilot segment" }] }, capturedAt);
  if (!segmented.ok) throw new Error(segmented.issues.map((issue) => issue.message).join("; "));
  scenario = segmented.value;
  const instance = createPackageInstance({ instanceId: `${state}-${definition.kind}-1`, segmentId: "segment-1", scopeId: `${definition.kind}-scope`, definition });
  if (!instance.ok) throw new Error(instance.issues.map((issue) => issue.message).join("; "));
  const added = editPlanningScenario(scenario, { kind: "add_package", instance: instance.value }, capturedAt);
  if (!added.ok) throw new Error(added.issues.map((issue) => issue.message).join("; "));
  scenario = added.value;
  for (const component of definition.components) {
    if (component.binding) {
      const request = { agencyItemId: component.binding.agencyItemId, unit: component.binding.unit, capturedAt };
      const result = state === "NE" ? resolveNebraskaAnnualRate(data, request) : buildColoradoContractRateSnapshot(data, request);
      if (result.ok) {
        const repriced = editPlanningScenario(scenario, { kind: "reprice", instanceId: instance.value.instanceId, role: component.role, snapshot: result.value }, capturedAt);
        if (!repriced.ok) throw new Error(repriced.issues.map((issue) => issue.message).join("; "));
        scenario = repriced.value;
      }
    }
    const manual = pilotManualRate(state, definition.kind, component.role);
    if (manual && manual.unit === component.quantityRule.unit && manual.packageVersion === definition.version) {
      const rated = editPlanningScenario(scenario, { kind: "rate", instanceId: instance.value.instanceId, role: component.role, override: { value: manual.rate, reason: pilotManualReason(manual) } }, capturedAt);
      if (!rated.ok) throw new Error(rated.issues.map((issue) => issue.message).join("; "));
      scenario = rated.value;
    }
  }
  return scenario;
}

describe("pilot packages against loaded public data", () => {
  let ne: AppData;
  let co: AppData;

  beforeAll(async () => {
    globalThis.fetch = vi.fn(dataFetch) as typeof fetch;
    [ne, co] = await Promise.all([loadRealState("NE"), loadRealState("CO")]);
  });

  afterAll(() => { globalThis.fetch = originalFetch; });

  const cases = [
    ...NEBRASKA_PILOT_PACKAGES.map((definition) => ({ state: "NE" as PlanningState, definition, label: `NE ${definition.kind}` })),
    ...COLORADO_PILOT_PACKAGES.map((definition) => ({ state: "CO" as PlanningState, definition, label: `CO ${definition.kind}` })),
  ];

  it.each(cases)("prices every active component in $label with a positive half-mile subtotal", ({ state, definition }) => {
    const scenario = addAndPrice(state === "NE" ? ne : co, state, definition);
    const cost = calculateScenarioCosts(scenario);
    const estimate = buildPlannerEstimate(scenario, cost);
    const active = cost.components.filter((component) => component.status !== "excluded");
    expect(active.length).toBeGreaterThan(0);
    expect(active.every((component) => component.status === "priced")).toBe(true);
    expect(cost.pricedDirectSubtotal).toBeGreaterThan(0);
    if (definition.kind !== "sidewalk") expect(estimate.amount).toBeGreaterThan(0);
    const width = definition.kind === "path" ? 10 : definition.kind === "sidewalk" ? 5 : 24;
    const sides = definition.kind === "sidewalk" ? 2 : 1;
    const halfMileAreaSy = 0.5 * 5280 * width * sides / 9;
    const surface = cost.components.find((component) => component.role === "pavement" || component.role === "milling");
    expect(surface?.quantity).toBeCloseTo(halfMileAreaSy, 8);
    expect(cost.complete).toBe(false);
    expect(estimate.fullScope).toBe(false);
    expect(estimate.notices.some((notice) => /(?:co_|ne_|scenario-|segment-1|instance|agencyItemId)/i.test(notice.text))).toBe(false);
    console.info(`${state} ${definition.kind}: priced=${cost.pricedDirectSubtotal} estimate=${estimate.amount}`);
  });

  it.each(cases)("builds a reviewable Project draft for $label", ({ state, definition }) => {
    const data = state === "NE" ? ne : co;
    const scenario = addAndPrice(data, state, definition);
    const built = buildProjectHandoff({
      workspace: { schemaVersion: 1, workspaceId: `workspace-${state}`, state, name: "Pilot",
        revision: 0, activeScenarioId: scenario.scenarioId, scenarios: [scenario],
        createdAt: capturedAt, updatedAt: capturedAt, lastBackupAt: null, lastBackupRevision: null },
      scenario, catalog: data.agencyItems, token: `token-${state}-${definition.kind}`,
      projectId: `project-${state}-${definition.kind}`, projectName: `${state} ${definition.kind}`,
      now: capturedAt,
    });
    expect(built.ok, built.ok ? undefined : built.errors.join("; ")).toBe(true);
    if (!built.ok) return;
    expect(built.project.planningOrigin?.decisions.some((decision) => decision.status === "pending")).toBe(true);
    expect(built.project.lineItems.some((line) => line.lineItemType === "catalog")).toBe(true);
    expect(built.project.contingencyPercent).toBe(0);
  });

  it("freezes the exact adapter snapshot shape and keeps manual rates separate", () => {
    const scenario = addAndPrice(ne, "NE", NEBRASKA_PILOT_PACKAGES.find((definition) => definition.kind === "resurfacing")!);
    const instance = scenario.packages[0];
    const snapshots = Object.values(instance.rateSnapshots) as RateSnapshot[];
    expect(snapshots.length).toBeGreaterThan(0);
    expect(snapshots.every((snapshot) => snapshot.capturedAt === capturedAt && snapshot.kind === "ne_annual")).toBe(true);
    expect(Object.values(instance.rateOverrides).every((override) => override.reason.includes("pilot-2 provisional default"))).toBe(true);
  });
});
