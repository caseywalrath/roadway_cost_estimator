import { describe, expect, it } from "vitest";
import { calculateScenarioCosts } from "./costEngine";
import { buildPlannerEstimate, comparePlannerEstimates } from "./plannerPresentation";
import { createPackageInstance, createPlanningScenario, editPlanningScenario } from "./planningWorkspace";
import { NEBRASKA_PILOT_PACKAGES } from "./recipes/nebraskaPilot";
import type { PlanningResult, PlanningScenario } from "./types";

const at = "2026-10-07T12:00:00.000Z";
function value<T>(result: PlanningResult<T>): T { if (!result.ok) throw Error(JSON.stringify(result.issues)); return result.value; }
function pricedPath(): PlanningScenario {
  let scenario = value(createPlanningScenario({ scenarioId: "a", state: "NE", name: "Alternative A", now: at }));
  scenario = value(editPlanningScenario(scenario, { kind: "set_segments", segments: [{ segmentId: "main", name: "Main" }] }, at));
  const definition = NEBRASKA_PILOT_PACKAGES.find((item) => item.kind === "path")!;
  const instance = value(createPackageInstance({ instanceId: "path", segmentId: "main", scopeId: "path", definition }));
  scenario = value(editPlanningScenario(scenario, { kind: "add_package", instance }, at));
  for (const component of definition.components) scenario = value(editPlanningScenario(scenario, { kind: "rate", instanceId: "path", role: component.role, override: { value: 10, reason: "Synthetic source rate" } }, at));
  return scenario;
}

describe("planner estimate presentation", () => {
  it("does not show an initial zero as a project estimate", () => {
    const empty = value(createPlanningScenario({ scenarioId: "empty", state: "NE", name: "A", now: at }));
    const view = buildPlannerEstimate(empty, calculateScenarioCosts(empty));
    expect(view.amount).toBeNull();
    expect(view.notices.map((item) => item.text)).toContain("Choose an improvement type to begin the estimate.");
  });

  it("shows the included-scope subtotal while property and utilities remain unknown", () => {
    const scenario = pricedPath();
    const cost = calculateScenarioCosts(scenario);
    const view = buildPlannerEstimate(scenario, cost);
    expect(cost.total).toBeNull();
    expect(view.amount).toBeGreaterThan(0);
    expect(view.amountLabel).toBe("Planning subtotal for included scope");
    expect(view.excludedScope).toContain("Property acquisition");
    expect(view.excludedScope).toContain("Major utility relocation");
    expect(view.notices.map((item) => item.text).join(" ")).not.toContain("right_of_way");
    expect(view.lines.find((line) => line.label === "Contingency")).toMatchObject({ detail: "25%", amount: cost.contingency });
    expect(view.lines.filter((line) => line.group === "construction").reduce((total, line) => total + (line.amount ?? 0), 0)).toBeCloseTo(view.construction!);
    expect(view.lines.filter((line) => line.group === "other").reduce((total, line) => total + (line.amount ?? 0), 0)).toBeCloseTo(view.otherProjectCosts!);
  });

  it("compares only alternatives with matching included-scope coverage", () => {
    const scenario = pricedPath();
    const left = buildPlannerEstimate(scenario, calculateScenarioCosts(scenario));
    const duplicate = JSON.parse(JSON.stringify(scenario)) as PlanningScenario;
    duplicate.scenarioId = "b";
    const right = buildPlannerEstimate(duplicate, calculateScenarioCosts(duplicate));
    expect(comparePlannerEstimates(left, right)).toBe(0);
    duplicate.externalScopes[0] = { scopeId: "right_of_way", decision: "none_assumed", amount: null, reason: "No purchase expected" };
    const changed = buildPlannerEstimate(duplicate, calculateScenarioCosts(duplicate));
    expect(comparePlannerEstimates(left, changed)).toBeNull();
  });

  it("includes priced external work in other project costs even while property scope is unknown", () => {
    let scenario = pricedPath();
    scenario = value(editPlanningScenario(scenario, { kind: "set_custom", component: {
      componentId: "known-external", segmentId: "main", scopeId: "known-external", role: "known-external",
      description: "Known external work", category: "external", unit: "LS", quantity: 1, unitRate: 5000,
      reason: "Independent reference", required: true, tags: [], exclusion: null,
    } }, at));
    const cost = calculateScenarioCosts(scenario);
    const view = buildPlannerEstimate(scenario, cost);
    expect(cost.external).toBeNull();
    expect(view.otherProjectCosts).toBe((cost.services ?? 0) + 5000);
    expect(view.amount).toBe((view.construction ?? 0) + (view.otherProjectCosts ?? 0));
  });

  it("reconciles displayed lines and total after both major impacts are assessed", () => {
    const scenario = pricedPath();
    scenario.externalScopes = [
      { scopeId: "right_of_way", decision: "none_assumed", amount: null, reason: "No acquisition" },
      { scopeId: "major_utilities", decision: "manual", amount: 12_000, reason: "Known relocation" },
    ];
    const cost = calculateScenarioCosts(scenario);
    const view = buildPlannerEstimate(scenario, cost);
    expect(cost.complete).toBe(true);
    expect(view.lines.find((line) => line.label === "Major utility relocation")?.amount).toBe(12_000);
    expect(view.lines.reduce((total, line) => total + (line.amount ?? 0), 0)).toBeCloseTo(cost.total!);
    expect(view.amount).toBeCloseTo(cost.total!);
  });
});
