import { describe, expect, it } from "vitest";
import { buildPlanningEngineerCsv, PLANNING_ENGINEER_CSV_FIELDS } from "./planningEngineerCsv";
import { createPlanningScenario } from "./planningWorkspace";
import { calculateScenarioCosts } from "./costEngine";

describe("compact Planning engineer CSV", () => {
  it("emits the fixed readable columns and explicit unknown impact amounts", () => {
    const created = createPlanningScenario({ scenarioId: "compact", state: "NE", name: "Alt, A", now: "2026-01-01T00:00:00.000Z" });
    if (!created.ok) throw new Error("fixture scenario failed");
    const scenario = created.value;
    scenario.externalScopes[0] = { scopeId: "right_of_way", decision: "none_assumed", amount: null, reason: "No acquisition expected" };
    const csv = buildPlanningEngineerCsv(scenario, "Road, project");
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(PLANNING_ENGINEER_CSV_FIELDS.join(","));
    expect(lines.some((line) => line.includes('"Road, project"') && line.includes("Property acquisition") && line.includes(",0,"))).toBe(true);
    expect(lines[lines.length - 1]).toContain("Choose an improvement");
    expect(lines[lines.length - 1]).toContain(",incomplete,");
  });

  it("includes allowances, impacts, and formula-safe user text without internal IDs", () => {
    const created = createPlanningScenario({ scenarioId: "compact", state: "CO", name: "=review", now: "2026-01-01T00:00:00.000Z" });
    if (!created.ok) throw new Error("fixture scenario failed");
    const scenario = created.value;
    scenario.externalScopes[1] = { scopeId: "major_utilities", decision: "manual", amount: 1250, reason: "@utility note, verify" };
    const csv = buildPlanningEngineerCsv(scenario, "=Project");
    expect(csv).toContain("'=Project");
    expect(csv).toContain("'=review");
    expect(csv).toContain("Major utility relocation");
    expect(csv).toContain('"\'@utility note, verify"');
    expect(csv).toContain("Mobilization");
    expect(csv).not.toContain("scenario_id");
    expect(csv).not.toContain("compact");
  });

  it("preserves explicit zero amounts while leaving unpriced values blank", () => {
    const created = createPlanningScenario({ scenarioId: "zero", state: "NE", name: "Zero", now: "2026-01-01T00:00:00.000Z" });
    if (!created.ok) throw new Error("fixture scenario failed");
    const scenario = created.value;
    scenario.externalScopes[0] = { scopeId: "right_of_way", decision: "manual", amount: 0, reason: "No acquisition cost" };
    const csv = buildPlanningEngineerCsv(scenario);
    const rows = csv.trimEnd().split("\r\n");
    const impact = rows.find((line) => line.includes("Property acquisition"));
    expect(impact).toContain(",0,external,priced,");
    const utility = rows.find((line) => line.includes("Major utility relocation"));
    expect(utility).toContain(",external,unpriced,");
    expect(utility).not.toMatch(/,0,external,unpriced,/);
    expect(calculateScenarioCosts(scenario).complete).toBe(false);
  });
});
