import { describe, expect, it } from "vitest";
import { createCustomProjectLineItem, createUserProject, type UserProject } from "../projects/projectWorkspace";
import { renderProjectWorkspace } from "./renderProjectWorkspace";

function fixture(): UserProject {
  const project = createUserProject("Draft", "NE");
  const line = createCustomProjectLineItem("NE");
  line.description = "Other work";
  line.quantity = 1;
  project.lineItems = [line];
  project.planningOrigin = {
    token: "token", workspaceId: "workspace", workspaceName: "Source <project>", scenarioId: "alternative", scenarioName: "Alternative A",
    fingerprint: "fingerprint", capturedAt: "2026-10-07T12:00:00Z", includedScope: ["Roadway"], excludedScope: ["Property: none assumed"],
    decisions: [{ decisionId: "decision", label: "Other work", kind: "line", lineItemId: line.lineItemId, status: "pending", reason: "", sourceAmount: null }],
    frozenContingencyLineId: null, planningTotal: null, planningPricedSubtotal: 0
  };
  return project;
}
const html = (project: UserProject, readOnly = false) => renderProjectWorkspace(project, [project], [], "NE", readOnly, null);

describe("Planning-origin Project presentation", () => {
  it("labels incomplete arithmetic as a priced subtotal and identifies missing work", () => {
    const output = html(fixture());
    expect(output).toContain("Priced subtotal");
    expect(output).not.toContain(">Total Project Cost<");
    expect(output).toContain("Work to resolve (1)");
    expect(output).toContain("Other work");
    expect(output).toContain("Source &lt;project&gt;");
    expect(output).toContain("data-open-planning-origin");
    expect(output).toContain("one-way starting snapshot");
    expect(output).toContain('name="reason"');
  });
  it("keeps decisions pending when a price is entered, then shows a full total after explicit resolution", () => {
    const project = fixture();
    project.lineItems[0].preferredUnitCost = 200;
    expect(html(project)).toContain("Priced subtotal");
    project.planningOrigin!.decisions[0].status = "resolved";
    project.planningOrigin!.decisions[0].reason = "Engineer priced included work";
    expect(html(project)).toContain(">Total Project Cost<");
  });
  it("shows the frozen contingency warning and disables decisions in read-only mode", () => {
    const project = fixture();
    project.planningOrigin!.frozenContingencyLineId = project.lineItems[0].lineItemId;
    project.contingencyPercent = 10;
    const output = html(project, true);
    expect(output).toContain("double count contingency");
    expect(output).toContain("data-review-frozen-contingency");
    expect(output).toContain('value="resolved" class="secondary-button" disabled');
  });
  it("retains legacy Project totals without a Planning panel", () => {
    const output = html(createUserProject("Legacy", "CO"));
    expect(output).toContain(">Total Project Cost<");
    expect(output).not.toContain("From Planning");
  });
});
