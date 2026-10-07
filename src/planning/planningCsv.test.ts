import { describe, expect, it } from "vitest";
import { buildPlanningCsv, PLANNING_CSV_FIELDS } from "./planningCsv";
import { createPlanningScenario } from "./planningWorkspace";
import { calculateScenarioCosts } from "./costEngine";

describe("Planning CSV review export", () => {
  it("uses fixed headers and preserves explicit zero versus blank", () => {
    const created = createPlanningScenario({ scenarioId: "csv-scenario", state: "NE", name: "CSV case", now: "2026-01-01T00:00:00.000Z" });
    if (!created.ok) throw new Error("fixture scenario failed");
    const csv = buildPlanningCsv(created.value, calculateScenarioCosts(created.value));
    expect(csv.split("\n")[0]).toBe(PLANNING_CSV_FIELDS.join(","));
    expect(csv).toContain("cost_complete");
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("escapes review text and emits deterministic output", () => {
    const created = createPlanningScenario({ scenarioId: "csv-scenario", state: "CO", name: 'A "quoted", case', now: "2026-01-01T00:00:00.000Z" });
    if (!created.ok) throw new Error("fixture scenario failed");
    const a = buildPlanningCsv(created.value);
    const b = buildPlanningCsv(structuredClone(created.value));
    expect(a).toBe(b);
    expect(a).toContain('"A ""quoted"", case"');
  });

  it("keeps explicit zero distinct from blank values and includes frozen provenance", () => {
    const created = createPlanningScenario({ scenarioId: "csv-zero", state: "NE", name: "Zero", now: "2026-01-01T00:00:00.000Z" });
    if (!created.ok) throw new Error("fixture scenario failed");
    created.value.externalScopes[0] = { scopeId: "right_of_way", decision: "manual", amount: 0, reason: "No right of way cost" };
    const csv = buildPlanningCsv(created.value);
    const rows = csv.trimEnd().split("\n").map((line) => line.split(","));
    const header = rows[0];
    const right = rows.find((row) => row[header.indexOf("row_type")] === "external" && row[header.indexOf("role")] === "right_of_way");
    const utilities = rows.find((row) => row[header.indexOf("row_type")] === "external" && row[header.indexOf("role")] === "major_utilities");
    expect(right?.[header.indexOf("extended_cost")]).toBe("0");
    expect(right?.[header.indexOf("external_reason")]).toBe("No right of way cost");
    expect(utilities?.[header.indexOf("extended_cost")]).toBe("");
  });
});
