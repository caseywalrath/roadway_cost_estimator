import { describe, expect, it } from "vitest";
import { buildPlanningBackup, importPlanningBackup, parsePlanningBackup } from "./planningBackup";
import { createPlanningScenario, createPlanningWorkspace } from "./planningWorkspace";
import type { AnnualRateSnapshot, PlanningWorkspace } from "./types";
import { NEBRASKA_PILOT_PACKAGES } from "./recipes/nebraskaPilot";
import { calculateScenarioCosts } from "./costEngine";

function workspace(): PlanningWorkspace {
  const created = createPlanningWorkspace({ workspaceId: "ws-original", state: "NE", name: "Recovery case", now: "2026-01-01T00:00:00.000Z" });
  if (!created.ok) throw new Error("fixture workspace failed");
  const scenario = createPlanningScenario({ scenarioId: "scenario-original", state: "NE", name: "Scenario", now: "2026-01-01T00:00:00.000Z" });
  if (!scenario.ok) throw new Error("fixture scenario failed");
  return { ...created.value, scenarios: [scenario.value], activeScenarioId: scenario.value.scenarioId, revision: 1 };
}

describe("Planning recovery backup", () => {
  it("round trips a complete versioned record", () => {
    const source = workspace();
    const parsed = parsePlanningBackup(JSON.parse(JSON.stringify(buildPlanningBackup(source, "2026-01-02T00:00:00.000Z"))));
    expect(parsed?.workspace).toEqual(source);
  });

  it("rejects malformed records atomically, including nested malformed arrays", () => {
    const backup = buildPlanningBackup(workspace());
    expect(parsePlanningBackup({ ...backup, fileVersion: 99 })).toBeNull();
    const malformed = structuredClone(backup) as any;
    malformed.workspace.scenarios[0].packages = [null];
    expect(parsePlanningBackup(malformed)).toBeNull();
  });

  it("imports an independent copy with remapped IDs and cleared transfer state", () => {
    const source = workspace();
    const imported = importPlanningBackup(buildPlanningBackup(source), "2026-02-01T00:00:00.000Z", "first");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    expect(imported.value.workspaceId).not.toBe(source.workspaceId);
    expect(imported.value.activeScenarioId).not.toBe(source.activeScenarioId);
    expect(imported.value.revision).toBe(0);
    expect(imported.value.scenarios[0].review).toBeNull();
    expect(imported.value.scenarios[0].projectLink).toBeNull();
    expect(imported.value.scenarios[0].handoffIntent).toBeNull();
    expect(imported.value.scenarios[0].createdAt).toBe("2026-02-01T00:00:00.000Z");
  });

  it("preserves numeric drafts, explicit zero, snapshots, and regenerated cost results", () => {
    const source = workspace();
    const definition = NEBRASKA_PILOT_PACKAGES[0];
    source.scenarios[0].segments = [{ segmentId: "road", name: "Road" }];
    source.scenarios[0].packages = [{ instanceId: "instance", segmentId: "road", scopeId: "roadway", definition, parameterOverrides: { lengthMiles: { value: null, reason: "Pending survey" } }, quantityOverrides: {}, rateOverrides: {}, exclusions: {}, rateSnapshots: {} }];
    const before = calculateScenarioCosts(source.scenarios[0]);
    const backup = buildPlanningBackup(source);
    const parsed = parsePlanningBackup(JSON.parse(JSON.stringify(backup)));
    expect(parsed).not.toBeNull();
    const imported = importPlanningBackup(backup, "2026-02-01T00:00:00.000Z", "second");
    expect(imported.ok).toBe(true);
    if (!imported.ok) return;
    const importedCost = calculateScenarioCosts(imported.value.scenarios[0]);
    expect(importedCost.total).toBe(before.total);
    expect(imported.value.scenarios[0].packages[0].parameterOverrides.lengthMiles.value).toBeNull();
    source.scenarios[0].packages[0].parameterOverrides.lengthMiles = { value: 0, reason: "Explicit zero test" };
    const zeroBackup = parsePlanningBackup(buildPlanningBackup(source));
    expect(zeroBackup?.workspace.scenarios[0].packages[0].parameterOverrides.lengthMiles.value).toBe(0);
    source.scenarios[0].packages[0].parameterOverrides.lengthMiles = { value: -1, reason: "Draft pending correction" };
    expect(parsePlanningBackup(buildPlanningBackup(source))).not.toBeNull();
  });

  it("rejects malformed nested rate provenance", () => {
    const source = workspace();
    const definition = NEBRASKA_PILOT_PACKAGES[0];
    const asphalt = definition.components.find((component) => component.role === "asphalt")!;
    const snapshot: AnnualRateSnapshot = {
      kind: "ne_annual", state: "NE", agencyItemId: asphalt.binding!.agencyItemId,
      unit: asphalt.binding!.unit, sourceUnit: "TON", sourceDescription: "Published asphalt",
      sourceId: "ne-2025", summaryId: "summary-1", reportSeries: "calendar_year",
      periodStart: "2025-01-01", periodEnd: "2025-12-31", sourceUrl: "https://example.test/report.pdf",
      sourcePage: 3, sourceLocator: "page 3 row 2", rawRate: 100, rate: 100,
      inflation: { method: "annual_window_nhcci", availability: "unavailable", targetPeriod: null, factor: null, reason: "No index" },
      policyVersion: "ne-annual-v1", capturedAt: "2026-01-01T00:00:00Z",
    };
    source.scenarios[0].segments = [{ segmentId: "road", name: "Road" }];
    source.scenarios[0].packages = [{ instanceId: "instance", segmentId: "road", scopeId: "roadway", definition, parameterOverrides: {}, quantityOverrides: {}, rateOverrides: {}, exclusions: {}, rateSnapshots: { asphalt: snapshot } }];
    const valid = buildPlanningBackup(source);
    expect(parsePlanningBackup(valid)).not.toBeNull();
    const malformed = structuredClone(valid);
    malformed.workspace.scenarios[0].packages[0].rateSnapshots.asphalt.inflation.reason = null;
    expect(parsePlanningBackup(malformed)).toBeNull();
  });

  it("avoids source IDs that already use the copy suffix and supports seeded repeated imports", () => {
    const source = workspace();
    source.scenarios[0].segments = [{ segmentId: "seg", name: "A" }, { segmentId: "seg-copy", name: "B" }];
    const backup = buildPlanningBackup(source);
    const first = importPlanningBackup(backup, "2026-02-01T00:00:00.000Z", "one");
    const second = importPlanningBackup(backup, "2026-02-01T00:00:00.000Z", "two");
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(first.value.workspaceId).not.toBe(second.value.workspaceId);
      expect(new Set(first.value.scenarios[0].segments.map((segment) => segment.segmentId)).size).toBe(2);
      expect(first.value.scenarios[0].segments.some((segment) => segment.segmentId === "seg-copy")).toBe(false);
    }
  });
});
