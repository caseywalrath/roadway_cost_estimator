import { describe, expect, it } from "vitest";
import { comparePlanningScenarios } from "./compareScenarios";
import { NEBRASKA_PILOT_PACKAGES } from "./recipes/nebraskaPilot";
import { createPackageInstance, createPlanningScenario, duplicatePlanningScenario, editPlanningScenario } from "./planningWorkspace";
import type { PlanningResult, PlanningScenario } from "./types";

const now = "2026-10-06T12:00:00.000Z";
function value<T>(result: PlanningResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
function scenario(): PlanningScenario {
  let item = value(createPlanningScenario({ scenarioId: "source", state: "NE", name: "Source", now }));
  item = value(editPlanningScenario(item, { kind: "set_segments", segments: [{ segmentId: "segment/source", name: "Corridor" }] }, now));
  const definition = NEBRASKA_PILOT_PACKAGES.find((entry) => entry.kind === "resurfacing")!;
  const instance = value(createPackageInstance({ instanceId: "package/source", segmentId: "segment/source", scopeId: "roadway", definition }));
  return value(editPlanningScenario(item, { kind: "add_package", instance }, now));
}

describe("Planning scenario comparison", () => {
  it("treats a pure duplicate as the same estimate despite fresh reference IDs", () => {
    const left = scenario();
    const right = value(duplicatePlanningScenario(left, {
      scenarioId: "copy", segmentIds: { "segment/source": "segment/copy" }, instanceIds: { "package/source": "package/copy" }, customComponentIds: {},
      allowanceIds: Object.fromEntries(left.allowances.map((item, index) => [item.allowanceId, `allowance/copy/${index}`])),
    }, "Copy", "2026-10-07T12:00:00.000Z"));
    const comparison = comparePlanningScenarios(left, right);
    expect(comparison.ok).toBe(true);
    if (comparison.ok) {
      expect(comparison.value.changes).toEqual([]);
      expect(comparison.value.pricedDirectDifference).toBe(0);
      expect(comparison.value.comparableCompleteTotals).toBe(false);
      expect(comparison.value.totalDifference).toBeNull();
    }
  });

  it("reports changed scope inputs while keeping full-total difference unavailable when incomplete", () => {
    const left = scenario();
    const right = value(editPlanningScenario(left, { kind: "parameter", instanceId: "package/source", key: "lengthMiles", override: { value: 1, reason: "Longer corridor" } }, now));
    const comparison = comparePlanningScenarios(left, right);
    expect(comparison.ok).toBe(true);
    if (comparison.ok) {
      expect(comparison.value.changes.some((change) => change.path.endsWith("parameterOverrides.lengthMiles.value"))).toBe(true);
      expect(comparison.value.totalDifference).toBeNull();
    }
  });

  it("rejects cross-state comparisons", () => {
    const left = scenario();
    const right = { ...left, state: "CO" as const };
    const result = comparePlanningScenarios(left, right);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0].code).toBe("state_mismatch");
  });

  it("returns no priced-direct difference when either subtotal overflows", () => {
    let left = scenario();
    for (const id of ["large-one", "large-two"]) {
      left = value(editPlanningScenario(left, { kind: "set_custom", component: {
        componentId: id, segmentId: "segment/source", scopeId: id, role: id, description: "Synthetic overflow input",
        category: "construction", unit: "LS", quantity: 1, unitRate: 1e308, reason: "Synthetic arithmetic boundary",
        required: true, tags: [], exclusion: null,
      } }, now));
    }
    const result = comparePlanningScenarios(left, scenario());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.left.pricedDirectSubtotal).toBeNull();
      expect(result.value.pricedDirectDifference).toBeNull();
    }
  });

  it("remaps original allowance references and compares their unchanged basis", () => {
    let left = scenario();
    left = value(editPlanningScenario(left, { kind: "allowance", allowance: {
      allowanceId: "reference-fee", name: "Synthetic fee", role: "custom", category: "service", enabled: true, percent: 1,
      base: { kind: "references", componentIds: ["package/source/asphalt"], allowanceIds: ["mobilization"] },
      assumption: { id: "synthetic", description: "Reference remapping fixture", origin: "pilot_assumption" },
      overrideReason: "Synthetic named base", overlapTags: [], exclusion: null,
    } }, now));
    const right = value(duplicatePlanningScenario(left, {
      scenarioId: "copy", segmentIds: { "segment/source": "segment/copy" }, instanceIds: { "package/source": "package/copy" }, customComponentIds: {},
      allowanceIds: Object.fromEntries(left.allowances.map((item, index) => [item.allowanceId, `allowance/copy/${index}`])),
    }, "Copy", now));
    const original = right.allowances.find((item) => item.name === "Synthetic fee")?.originalBasis?.base;
    expect(original?.kind).toBe("references");
    if (original?.kind === "references") {
      expect(original.componentIds).toEqual(["package/copy/asphalt"]);
      expect(original.allowanceIds).toEqual(["allowance/copy/0"]);
    }
    const comparison = value(comparePlanningScenarios(left, right));
    expect(comparison.changes).toEqual([]);
  });
});
