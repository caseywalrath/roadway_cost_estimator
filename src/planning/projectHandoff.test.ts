import { describe, expect, it } from "vitest";
import type { AgencyItemRecord } from "../data/schema";
import { buildProjectHandoff } from "./projectHandoff";
import { createDefaultAllowances } from "./costEngine";
import { scenarioFingerprint } from "./planningWorkspace";
import type { CustomComponent, PlanningScenario, PlanningWorkspace, PackageDefinition, PackageInstance } from "./types";

const now = "2026-10-07T12:00:00.000Z";

function component(input: Partial<CustomComponent> = {}): CustomComponent {
  return {
    componentId: "direct", segmentId: "segment", scopeId: "roadway", role: "construction",
    description: "Synthetic known scope", category: "construction", unit: "LS", quantity: 1,
    unitRate: 100_000, reason: "Synthetic test value", required: true, tags: [], exclusion: null, ...input,
  };
}

function scenario(state: "NE" | "CO" = "NE", customComponents: CustomComponent[] = [component()]): PlanningScenario {
  return {
    scenarioId: `${state.toLowerCase()}-scenario`, state, name: `${state} fixture`, location: "Test location", notes: "Test notes",
    segments: [{ segmentId: "segment", name: "Roadway" }], packages: [], customComponents, substitutions: [],
    allowances: createDefaultAllowances(state),
    externalScopes: [
      { scopeId: "right_of_way", decision: "none_assumed", amount: null, reason: "No acquisition in fixture." },
      { scopeId: "major_utilities", decision: "none_assumed", amount: null, reason: "No relocation in fixture." },
    ],
    review: null, history: [], projectLink: null, handoffIntent: null, createdAt: now, updatedAt: now,
  };
}

function workspaceFor(value: PlanningScenario): PlanningWorkspace {
  return {
    schemaVersion: 1, workspaceId: "workspace-1", state: value.state, name: "Planning fixture", revision: 2,
    activeScenarioId: value.scenarioId, scenarios: [value], createdAt: now, updatedAt: now,
    lastBackupAt: null, lastBackupRevision: null,
  };
}

function handoff(value: PlanningScenario, catalog: AgencyItemRecord[] = []) {
  return buildProjectHandoff({ workspace: workspaceFor(value), scenario: value, catalog, token: "handoff-token", projectId: "project-1", projectName: "Starting project", now });
}

const catalogItem = (state: "NE" | "CO", agencyItemId = "ne_ndot_item-1", unit = "LS"): AgencyItemRecord => ({
  agencyItemId, state, agencyId: state === "NE" ? "ne_ndot" : "co_cdot", agencyName: state === "NE" ? "Nebraska DOT" : "Colorado DOT",
  itemCode: "100", currentVersionId: "version-1", itemStatus: "current", canonicalItemId: agencyItemId,
  officialDescription: "Synthetic item", officialAbbreviatedDescription: "Synthetic item", officialUnit: unit,
  specReferenceCode: "", agency: state === "NE" ? "NDOT" : "CDOT",
});

describe("project planning handoff", () => {
  it.each(["NE", "CO"] as const)("creates a complete %s project with reconciled totals", (state) => {
    const result = handoff(scenario(state));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost.complete).toBe(true);
    expect(result.cost.total).toBe(169_500);
    expect(result.bridge.differenceFromCompleteTotal).toBe(0);
    expect(result.project.planningOrigin?.planningTotal).toBe(169_500);
    expect(result.project.lineItems).toHaveLength(6);
  });

  it("preserves incomplete scope as a pending decision and keeps null distinct from zero", () => {
    const value = scenario("NE", [component({ componentId: "zero", description: "Zero priced", unitRate: 0, scopeId: "roadway-zero" }), component({ componentId: "missing", description: "Missing quantity", quantity: null, unitRate: 0, scopeId: "roadway-missing" })]);
    const result = handoff(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cost.total).toBeNull();
    expect(result.project.lineItems.find((line) => line.description === "Zero priced")?.preferredUnitCost).toBe(0);
    expect(result.project.lineItems.find((line) => line.description === "Missing quantity")?.quantity).toBeNull();
    expect(result.project.planningOrigin?.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: "Missing quantity", status: "pending", sourceAmount: null }),
    ]));
    expect(result.bridge.withheld).toContain("Missing quantity");
  });

  it("rejects a bound component when catalog identity or unit is unavailable", () => {
    const value = boundScenario();
    const result = handoff(value, [catalogItem("NE", "wrong-item")]);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual(expect.arrayContaining([expect.stringContaining("Catalog identity or unit unavailable")]));
  });

  it("records none-assumed and unassessed external scope decisions", () => {
    const value = scenario("NE");
    value.externalScopes[0] = { scopeId: "right_of_way", decision: "unassessed", amount: null, reason: "Awaiting ROW review." };
    const result = handoff(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.bridge.withheld).toContain("Right-of-way");
    expect(result.project.planningOrigin?.decisions).toEqual(expect.arrayContaining([expect.objectContaining({ decisionId: "scope:right_of_way", kind: "scope", sourceAmount: null })]));
    expect(result.project.planningOrigin?.excludedScope).toContain("Major utilities: none assumed — No relocation in fixture.");
  });

  it("freezes contingency source amount and preserves source snapshot metadata", () => {
    const value = scenario("NE");
    const result = handoff(value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const contingency = result.project.lineItems.find((line) => line.description === "Frozen Planning contingency");
    expect(contingency?.planningOrigin).toMatchObject({ sourceKind: "contingency", originalAmount: 28_250, originalUnit: "LS", allowanceRule: { percent: 25, baseAmount: 113_000 } });
    expect(result.project.planningOrigin?.frozenContingencyLineId).toBe(contingency?.lineItemId);
    expect(result.project.planningOrigin?.fingerprint).toBe(scenarioFingerprint(value));
  });
});

function boundScenario(): PlanningScenario {
  const value = scenario("NE", []);
  const definition: PackageDefinition = {
    packageId: "bound-package", version: "1.0.0", state: "NE", kind: "path", name: "Bound fixture", status: "provisional",
    parameters: [],
    components: [{ role: "bound", description: "Bound catalog scope", category: "construction", quantityRule: { kind: "fixed", value: 2, unit: "LS" },
      binding: { state: "NE", agencyId: "ne_ndot", agencyItemId: "ne_ndot_item-1", description: "Bound catalog scope", unit: "LS", provisional: true, scopeNote: "Fixture" },
      required: true, tags: [], assumptions: [{ id: "a", description: "Fixture", origin: "pilot_assumption" }] }],
    assumptions: [{ id: "package", description: "Fixture", origin: "pilot_assumption" }], exclusions: [],
  };
  const instance: PackageInstance = { instanceId: "bound-instance", segmentId: "segment", scopeId: "roadway", definition,
    parameterOverrides: {}, quantityOverrides: {}, rateOverrides: { bound: { value: 10, reason: "Fixture manual rate" } }, rateSnapshots: {}, exclusions: {} };
  value.packages = [instance];
  return value;
}
