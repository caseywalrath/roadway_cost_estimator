import { describe, expect, it } from "vitest";
import { NEBRASKA_PILOT_PACKAGES } from "./recipes/nebraskaPilot";
import { addPlanningScenario, createPackageInstance, createPlanningScenario, createPlanningWorkspace, duplicatePlanningScenario, editPlanningScenario, getScenarioReviewStatus, recordScenarioReview, replacePlanningScenario, scenarioFingerprint, setActivePlanningScenario } from "./planningWorkspace";
import type { PackageDefinition, PlanningResult, PlanningScenario } from "./types";

const now = "2026-10-06T12:00:00.000Z";
function value<T>(result: PlanningResult<T>): T {
  if (!result.ok) throw new Error(JSON.stringify(result.issues));
  return result.value;
}
function definition(): PackageDefinition {
  return NEBRASKA_PILOT_PACKAGES.find((item) => item.kind === "resurfacing")!;
}
function scenario(packageId = "package/part"): PlanningScenario {
  let item = value(createPlanningScenario({ scenarioId: "scenario", state: "NE", name: "Scenario", now }));
  item = value(editPlanningScenario(item, { kind: "set_segments", segments: [{ segmentId: "segment/part", name: "Roadway" }] }, now));
  const instance = value(createPackageInstance({ instanceId: packageId, segmentId: "segment/part", scopeId: "roadway", definition: definition() }));
  return value(editPlanningScenario(item, { kind: "add_package", instance }, now));
}

describe("Planning workspace and scenario core", () => {
  it("creates caller-identified independent workspaces and scenarios", () => {
    const workspace = value(createPlanningWorkspace({ workspaceId: "workspace", state: "NE", name: "Nebraska", now }));
    const first = value(createPlanningScenario({ scenarioId: "first", state: "NE", name: "First", now }));
    const second = value(createPlanningScenario({ scenarioId: "second", state: "NE", name: "Second", now }));
    expect(workspace).toMatchObject({ revision: 0, activeScenarioId: null, scenarios: [], lastBackupAt: null, lastBackupRevision: null });
    expect(first.allowances).not.toBe(second.allowances);
    expect(first.allowances[0]).not.toBe(second.allowances[0]);
    expect(first.externalScopes.map((scope) => scope.decision)).toEqual(["unassessed", "unassessed"]);
  });

  it("increments workspace revision once and preserves inputs and backup markers", () => {
    const workspace = value(createPlanningWorkspace({ workspaceId: "workspace", state: "NE", name: "Nebraska", now }));
    const item = scenario();
    const added = value(addPlanningScenario(workspace, item, now));
    expect(workspace.scenarios).toHaveLength(0);
    expect(added.revision).toBe(1);
    expect(added.scenarios[0]).not.toBe(item);
    expect(added.createdAt).toBe(workspace.createdAt);
    expect(value(setActivePlanningScenario(added, "scenario", now))).toMatchObject({ revision: 2, activeScenarioId: "scenario" });
    expect(value(replacePlanningScenario(added, { ...item, notes: "Updated" }, now))).toMatchObject({ revision: 2, scenarios: [{ notes: "Updated" }] });
    expect(addPlanningScenario(added, item, now).ok).toBe(false);
    expect(setActivePlanningScenario(added, "missing", now).ok).toBe(false);
  });

  it("retains null and nonfinite numeric drafts while rejecting unknown keys atomically", () => {
    const original = scenario();
    const blank = editPlanningScenario(original, { kind: "parameter", instanceId: "package/part", key: "lengthMiles", override: { value: null, reason: "Awaiting measured length" } }, now);
    expect(blank.ok).toBe(true);
    if (blank.ok) {
      expect(blank.value.packages[0].parameterOverrides.lengthMiles.value).toBeNull();
      expect(blank.issues.some((issue) => issue.code === "invalid_number")).toBe(true);
    }
    const nonfinite = editPlanningScenario(original, { kind: "rate", instanceId: "package/part", role: "asphalt", override: { value: Number.POSITIVE_INFINITY, reason: "Draft rate entry" } }, now);
    expect(nonfinite.ok).toBe(true);
    if (nonfinite.ok) expect(nonfinite.value.packages[0].rateOverrides.asphalt.value).toBe(Number.POSITIVE_INFINITY);
    const unknown = editPlanningScenario(original, { kind: "parameter", instanceId: "package/part", key: "notAParameter", override: { value: 1, reason: "Should reject" } }, now);
    expect(unknown.ok).toBe(false);
    expect(original.packages[0].parameterOverrides).toEqual({});
  });

  it("rejects dangling segment and substitution references without partial edits", () => {
    const original = scenario();
    const removed = editPlanningScenario(original, { kind: "set_segments", segments: [] }, now);
    expect(removed.ok).toBe(false);
    expect(original.segments).toHaveLength(1);
    const invalid = editPlanningScenario(original, { kind: "substitutions", substitutions: [{ replacementComponentId: "missing/replacement", replacedComponentIds: ["missing/target"], replacedAllowanceIds: [], reason: "Invalid" }] }, now);
    expect(invalid.ok).toBe(false);
    expect(original.substitutions).toEqual([]);
  });

  it("preserves an allowance's first basis across later changes and requires each changed basis to have a reason", () => {
    const original = scenario();
    const baseline = original.allowances.find((item) => item.allowanceId === "mobilization")!;
    const first = value(editPlanningScenario(original, { kind: "allowance", allowance: { ...baseline, percent: 10, overrideReason: "Project-specific mobilization" } }, now));
    const afterFirst = first.allowances.find((item) => item.allowanceId === "mobilization")!;
    expect(afterFirst.originalBasis).toMatchObject({ percent: 8, base: { kind: "direct_construction" }, enabled: true });
    const second = value(editPlanningScenario(first, { kind: "allowance", allowance: { ...afterFirst, percent: 12, overrideReason: "Updated project basis" } }, now));
    expect(second.allowances.find((item) => item.allowanceId === "mobilization")?.originalBasis).toEqual(afterFirst.originalBasis);
    const missingReason = editPlanningScenario(original, { kind: "allowance", allowance: { ...baseline, percent: 10, overrideReason: null } }, now);
    expect(missingReason.ok).toBe(false);
    expect(original.allowances.find((item) => item.allowanceId === "mobilization")?.percent).toBe(8);
  });

  it("duplicates IDs and generated references exactly, without rewriting arbitrary text", () => {
    let original = scenario();
    original = value(editPlanningScenario(original, { kind: "parameter", instanceId: "package/part", key: "lengthMiles", override: { value: 0.75, reason: "package/part remains ordinary text" } }, now));
    original = value(editPlanningScenario(original, { kind: "substitutions", substitutions: [{ replacementComponentId: "package/part/asphalt", replacedComponentIds: ["package/part/milling"], replacedAllowanceIds: ["contingency"], reason: "Scope replacement" }] }, now));
    const ids = { scenarioId: "scenario-copy", segmentIds: { "segment/part": "segment/copy" }, instanceIds: { "package/part": "package/copy" }, customComponentIds: {}, allowanceIds: Object.fromEntries(original.allowances.map((a, i) => [a.allowanceId, `allowance-${i}`])) };
    const copy = value(duplicatePlanningScenario(original, ids, "Copy", "2026-10-07T12:00:00.000Z"));
    expect(copy.packages[0].instanceId).toBe("package/copy");
    expect(copy.packages[0].segmentId).toBe("segment/copy");
    expect(copy.substitutions[0]).toMatchObject({ replacementComponentId: "package/copy/asphalt", replacedComponentIds: ["package/copy/milling"], replacedAllowanceIds: [ids.allowanceIds.contingency] });
    expect(copy.packages[0].parameterOverrides.lengthMiles.reason).toBe("package/part remains ordinary text");
    expect(copy.review).toBeNull();
    expect(copy.projectLink).toBeNull();
    expect(copy.handoffIntent).toBeNull();
    expect(copy.packages[0].definition).not.toBe(original.packages[0].definition);
  });

  it("tracks stable material fingerprints and retains stale review records", () => {
    const original = scenario();
    const review = value(recordScenarioReview(original, { reviewer: "Engineer", date: "2026-10-06", notes: "Reviewed incomplete estimate" }, now));
    expect(getScenarioReviewStatus(review)).toBe("current");
    const cosmetic = { ...review, name: "Renamed", location: "Town", notes: "Metadata only" };
    expect(scenarioFingerprint(cosmetic)).toBe(scenarioFingerprint(review));
    expect(getScenarioReviewStatus(cosmetic)).toBe("current");
    const material = value(editPlanningScenario(review, { kind: "parameter", instanceId: "package/part", key: "lengthMiles", override: { value: 0.8, reason: "Measured geometry" } }, now));
    expect(material.review).toEqual(review.review);
    expect(getScenarioReviewStatus(material)).toBe("stale");
    const infinite = value(editPlanningScenario(original, { kind: "parameter", instanceId: "package/part", key: "lengthMiles", override: { value: Number.NaN, reason: "Invalid numeric draft" } }, now));
    expect(scenarioFingerprint(infinite)).not.toBe(scenarioFingerprint(original));
  });
});
