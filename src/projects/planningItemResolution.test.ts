import { describe, expect, it } from "vitest";
import { buildProjectBackup, parseProjectBackup } from "./projectBackup";
import { addProject, chooseProjectPlanningImpact, createCustomProjectLineItem, createEmptyProjectWorkspaceState,
  createUserProject, projectPlanningIsComplete, removeProjectLineItem, updateProjectLineItem } from "./projectWorkspace";
import { buildProjectCsv } from "../ui/exportProjectCsv";

function fixture() {
  const project = createUserProject("Planning draft", "NE");
  const line = createCustomProjectLineItem("NE", "construction");
  line.description = "Pavement";
  line.quantity = 1;
  line.planningOrigin = { sourceId: "pavement", role: "pavement", packageId: null, packageVersion: null,
    sourceKind: "component" as const, originalQuantity: 1, originalUnitRate: null, originalAmount: null,
    originalUnit: "LS", reason: null, rateBasis: null, allowanceRule: null };
  project.lineItems = [line];
  project.planningOrigin = { token: "token", workspaceId: "workspace", workspaceName: "Planning", scenarioId: "scenario",
    scenarioName: "A", fingerprint: "fingerprint", capturedAt: "2026-10-07T12:00:00Z", includedScope: [], excludedScope: [],
    decisions: [
      { decisionId: "price:pavement", label: "Pavement", kind: "line", lineItemId: line.lineItemId, status: "pending", reason: "", sourceAmount: null },
      { decisionId: "scope:right_of_way", label: "Right-of-way", kind: "scope", lineItemId: null, status: "pending", reason: "", sourceAmount: null }
    ], frozenContingencyLineId: null, planningTotal: null, planningPricedSubtotal: 0 };
  return { project, line, state: addProject(createEmptyProjectWorkspaceState(), project) };
}

describe("Planning-origin Project item decisions", () => {
  it("resolves a positive price, but requires Notes for an explicit zero", () => {
    const { project, line, state } = fixture();
    const zero = updateProjectLineItem(state, project.projectId, line.lineItemId, { preferredUnitCost: 0 });
    expect(zero.projects[0].planningOrigin?.decisions[0].status).toBe("pending");
    const explained = updateProjectLineItem(zero, project.projectId, line.lineItemId, { notes: "Paid by utility" });
    expect(explained.projects[0].planningOrigin?.decisions[0].status).toBe("resolved");
    const cleared = updateProjectLineItem(explained, project.projectId, line.lineItemId, { notes: "" });
    expect(cleared.projects[0].planningOrigin?.decisions[0].status).toBe("pending");
    const priced = updateProjectLineItem(cleared, project.projectId, line.lineItemId, { preferredUnitCost: 250 });
    expect(priced.projects[0].planningOrigin?.decisions[0].status).toBe("resolved");
    expect(projectPlanningIsComplete(priced.projects[0])).toBe(false);
  });

  it("records line removal and major-impact choices without inventing an unknown amount", () => {
    const { project, line, state } = fixture();
    const removed = removeProjectLineItem(state, project.projectId, line.lineItemId);
    expect(removed.projects[0].planningOrigin?.decisions[0]).toMatchObject({ status: "excluded", reason: "Removed in Project" });
    const noImpact = chooseProjectPlanningImpact(removed, project.projectId, "scope:right_of_way", "none");
    expect(projectPlanningIsComplete(noImpact.projects[0])).toBe(true);
    const added = chooseProjectPlanningImpact(noImpact, project.projectId, "scope:right_of_way", "add");
    const impact = added.projects[0].lineItems[0];
    expect(impact).toMatchObject({ costCategory: "other", quantity: 1, preferredUnitCost: null,
      planningOrigin: { sourceKind: "external" } });
    expect(projectPlanningIsComplete(added.projects[0])).toBe(false);
    expect(buildProjectCsv(added.projects[0])).toContain("Priced subtotal");
    const priced = updateProjectLineItem(added, project.projectId, impact.lineItemId, { preferredUnitCost: 1000, notes: "Engineer estimate" });
    expect(priced.projects[0].planningOrigin?.decisions[1].status).toBe("resolved");
    expect(projectPlanningIsComplete(priced.projects[0])).toBe(true);
    expect(buildProjectCsv(priced.projects[0])).toContain("Total Project Cost");
    const backup = parseProjectBackup(JSON.parse(JSON.stringify(buildProjectBackup(priced.projects[0]))));
    expect(backup?.project.planningOrigin?.decisions[1].status).toBe("resolved");
    expect(backup?.project.lineItems[0].notes).toBe("Engineer estimate");
    const revised = chooseProjectPlanningImpact(priced, project.projectId, "scope:right_of_way", "add");
    expect(revised.projects[0].lineItems).toHaveLength(1);
    const removedImpact = removeProjectLineItem(revised, project.projectId, impact.lineItemId);
    expect(removedImpact.projects[0].planningOrigin?.decisions[1]).toMatchObject({ status: "excluded", reason: "Removed in Project" });
  });
});
