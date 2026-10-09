import { describe, expect, it } from "vitest";
import { buildProjectBackup, createImportedCopy, parseProjectBackup } from "./projectBackup";
import { createCustomProjectLineItem, createUserProject, duplicateUserProject, parseUserProjectV10, parseUserProjectV9, type UserProject } from "./projectWorkspace";
import { buildProjectCsv } from "../ui/exportProjectCsv";

const origin = {
  planningProjectId: "plan-1",
  planningProjectName: "Lucerne Ave",
  alternativeId: "alt-a",
  alternativeName: "Alternative A",
  createdAt: "2026-10-09T12:00:00.000Z",
  planningTotal: 11960123.45
};

function projectWithOrigin(): UserProject {
  const line = { ...createCustomProjectLineItem("CO", "construction"), description: "Sidewalk", unit: "LS", quantity: 1, preferredUnitCost: 1000 };
  return { ...createUserProject("Lucerne Ave – Alternative A", "CO"), lineItems: [line], planningOrigin: origin };
}

describe("Project planningOrigin", () => {
  it("is kept by the v10 parser", () => {
    const project = projectWithOrigin();
    expect(parseUserProjectV10(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("is absent on Projects without it and on older schema versions", () => {
    const plain = createUserProject("Plain", "CO");
    const parsed = parseUserProjectV10(JSON.parse(JSON.stringify(plain)));
    expect(parsed).toEqual(plain);
    expect(parsed && "planningOrigin" in parsed).toBe(false);
    expect(parseUserProjectV9(JSON.parse(JSON.stringify(projectWithOrigin())))?.planningOrigin).toBeUndefined();
  });

  it("drops a malformed origin without rejecting the Project", () => {
    const raw = { ...JSON.parse(JSON.stringify(projectWithOrigin())), planningOrigin: { planningProjectId: 5 } };
    const parsed = parseUserProjectV10(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.planningOrigin).toBeUndefined();
  });

  it("survives a backup round trip, an imported copy, and a duplicate", () => {
    const project = projectWithOrigin();
    const backup = parseProjectBackup(JSON.parse(JSON.stringify(buildProjectBackup(project))));
    expect(backup?.project.planningOrigin).toEqual(origin);
    expect(createImportedCopy(project).planningOrigin).toEqual(origin);
    expect(duplicateUserProject(project).planningOrigin).toEqual(origin);
  });

  it("is listed in the Project CSV summary only when present", () => {
    const csv = buildProjectCsv(projectWithOrigin());
    expect(csv).toContain("Created from Planning,Lucerne Ave - Alternative A");
    expect(csv).toContain("Planning total at creation,11960123.45");
    expect(csv).toContain("Created from Planning at,2026-10-09T12:00:00.000Z");
    expect(buildProjectCsv(createUserProject("Plain", "CO"))).not.toContain("Created from Planning");
  });
});
