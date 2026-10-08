import { describe, expect, it } from "vitest";
import { buildProjectBackup, createImportedCopy, parseProjectBackup } from "./projectBackup";
import { createCustomProjectLineItem, createUserProject, duplicateUserProject, parseUserProjectV10, projectPlanningIsComplete, projectPlanningReviewFingerprint, projectPlanningReviewStatus } from "./projectWorkspace";
import { buildProjectCsv } from "../ui/exportProjectCsv";

function draft() {
  const project = createUserProject("Planning draft", "NE");
  const line = createCustomProjectLineItem("NE", "construction");
  line.description = "Other work";
  line.unit = "LS";
  line.quantity = 1;
  line.preferredUnitCost = null;
  line.planningOrigin = { sourceId: "other", role: "other", packageId: null, packageVersion: null,
    sourceKind: "component", originalQuantity: 1, originalUnitRate: null, originalAmount: null,
    originalUnit: "LS", reason: "Planner identified scope", rateBasis: null, allowanceRule: null };
  project.lineItems = [line];
  project.planningOrigin = { token: "token-1", workspaceId: "planning-1", workspaceName: "Planning",
    scenarioId: "alternative-1", scenarioName: "Alternative", fingerprint: "fingerprint",
    capturedAt: "2026-10-07T12:00:00Z", includedScope: ["Other work"], excludedScope: ["ROW: none assumed"],
    decisions: [{ decisionId: "price:other", label: "Other work", kind: "line", lineItemId: line.lineItemId,
      status: "pending", reason: "", sourceAmount: null }], frozenContingencyLineId: null,
    planningTotal: null, planningPricedSubtotal: 0 };
  return project;
}

describe("Planning-origin Project compatibility", () => {
  it("preserves typed origin and unknown prices through parser, backup and revision-shaped copies", () => {
    const project = draft();
    const parsed = parseUserProjectV10(structuredClone(project));
    expect(parsed?.planningOrigin?.decisions[0].status).toBe("pending");
    expect(parsed?.lineItems[0].planningOrigin?.sourceId).toBe("other");
    const backup = parseProjectBackup(JSON.parse(JSON.stringify(buildProjectBackup(project))));
    expect(backup?.project.planningOrigin?.fingerprint).toBe("fingerprint");
    expect(backup?.project.lineItems[0].preferredUnitCost).toBeNull();
    expect(projectPlanningIsComplete(backup!.project)).toBe(false);
  });

  it("remaps linked decision IDs in imported and duplicated copies", () => {
    const source = draft();
    for (const copy of [createImportedCopy(source), duplicateUserProject(source)]) {
      expect(copy.planningOrigin?.token).not.toBe(source.planningOrigin?.token);
      expect(copy.planningOrigin?.decisions[0].lineItemId).toBe(copy.lineItems[0].lineItemId);
      expect(parseUserProjectV10(copy)).not.toBeNull();
    }
  });

  it("keeps legacy Projects complete and draft CSVs explicit about unknown work", () => {
    const legacy = createUserProject("Legacy", "CO");
    expect(projectPlanningIsComplete(parseUserProjectV10(legacy)!)).toBe(true);
    const csv = buildProjectCsv(draft());
    expect(csv).toContain("Priced subtotal");
    expect(csv).toContain("Work to resolve,Other work");
    expect(csv).not.toContain("Total Project Cost");
    expect(csv).toContain("Total Item Cost");
  });

  it("clears only generated Planning line notes in display and exports", () => {
    const project = draft();
    project.lineItems[0].notes = "Planning starting snapshot; review before use.";
    expect(parseUserProjectV10(project)?.lineItems[0].notes).toBe("");
    expect(buildProjectCsv(project)).not.toContain("Planning starting snapshot; review before use.");
    expect(JSON.stringify(buildProjectBackup(project))).not.toContain("Planning starting snapshot; review before use.");
    project.lineItems[0].notes = "Engineer note";
    expect(parseUserProjectV10(project)?.lineItems[0].notes).toBe("Engineer note");
    expect(buildProjectCsv(project)).toContain("Engineer note");
  });

  it("tracks Project review independently and stales it after a price change", () => {
    const project = draft();
    project.lineItems[0].preferredUnitCost = 250;
    project.planningOrigin!.decisions[0] = { ...project.planningOrigin!.decisions[0], status: "resolved", reason: "Engineer price check" };
    expect(projectPlanningIsComplete(project)).toBe(true);
    project.planningOrigin!.review = { reviewer: "Engineer", date: "2026-10-08", notes: "Checked", fingerprint: projectPlanningReviewFingerprint(project) };
    expect(projectPlanningReviewStatus(project)).toBe("current");
    project.lineItems[0].preferredUnitCost = 300;
    expect(projectPlanningReviewStatus(project)).toBe("stale");
    expect(parseUserProjectV10(project)?.planningOrigin?.review?.reviewer).toBe("Engineer");
  });
});
