import { describe, expect, it } from "vitest";
import { createCatalogProjectLineItem, createCustomProjectLineItem, createUserProject } from "../projects/projectWorkspace";
import { buildProjectCsv } from "./exportProjectCsv";

const rows = (csv: string) => csv.split("\r\n");

describe("Project CSV export", () => {
  it("exports the approved context, visible line columns, and cost summary", () => {
    const project = createUserProject("Estimate", "CO");
    project.location = "Main St";
    project.notes = "Review this";
    const custom = createCustomProjectLineItem("CO");
    custom.itemCode = "SOFT";
    custom.group = "Construction";
    custom.description = "Soft costs";
    custom.quantity = 2;
    custom.unit = "LS";
    custom.preferredUnitCost = 25;
    project.lineItems = [custom];

    const output = rows(buildProjectCsv(project));
    expect(output.slice(0, 4)).toEqual(["Project,Estimate", "State,CO", "Location,Main St", "Notes,Review this"]);
    expect(output[5]).toBe("Group,Cost Category,Item Code,Description,Unit Cost,Unit,Quantity,Total Item Cost,Notes");
    expect(output[6]).toBe("Construction,Other,SOFT,Soft costs,25,LS,2,50,");
    expect(output.some((row) => row.includes("Agency ID"))).toBe(false);
    const summaryStart = output.indexOf("Project Cost Summary,Value");
    expect(output.slice(summaryStart, summaryStart + 6)).toEqual([
      "Project Cost Summary,Value", "Construction Costs,0", "Other costs,50",
      "Contingency percentage,0", "Contingencies,0", "Total Project Cost,50"
    ]);
  });

  it("omits evidence and import provenance from the human-facing CSV", () => {
    const project = createUserProject("Catalog export", "CO");
    const line = createCatalogProjectLineItem({
      state: "CO", agencyId: "co_cdot", agencyItemId: "co_cdot_002", group: "Construction",
      itemCode: "002", description: "Evidence item", unit: "LS", quantity: 1,
      preferredUnitCost: 25, notes: "", evidenceContext: {
        query: {} as never, filters: {} as never, sort: {} as never, includedRowCount: 2,
        includedObservationIds: ["observation_1", "observation_2"],
        summarySnapshot: { awarded: null, average: null, engineer: null, inflationAdjustmentEnabled: false,
          inflationTargetPeriodLabel: null, valuesAreInflationAdjusted: false }, costSource: "manual"
      }
    });
    line.importSource = { importId: "import", fileName: "estimate.xlsx", sheetName: "Estimate", rowNumber: 11,
      sourceRange: "B11:H11", importedAt: "2026-09-09T00:00:00.000Z", original: {}, decisions: [] } as never;
    project.lineItems = [line];
    const header = rows(buildProjectCsv(project))[5];
    expect(header).toBe("Group,Cost Category,Item Code,Description,Unit Cost,Unit,Quantity,Total Item Cost,Notes");
    expect(header).not.toMatch(/Agency|Observation|Import|Added Via|Created At|Updated At/u);
  });

  it("exports the active Project sort without changing stored line order", () => {
    const project = createUserProject("Sortable export", "CO");
    const later = createCustomProjectLineItem("CO"); later.itemCode = "20";
    const earlier = createCustomProjectLineItem("CO"); earlier.itemCode = "3";
    project.lineItems = [later, earlier];
    const output = rows(buildProjectCsv(project, { key: "itemCode", direction: "asc" }));
    expect(output.slice(6, 8).map((row) => row.split(",")[2])).toEqual(["3", "20"]);
    expect(project.lineItems.map((lineItem) => lineItem.itemCode)).toEqual(["20", "3"]);
  });

  it("exports blank Group values for legacy lines", () => {
    const project = createUserProject("Legacy export", "CO");
    const custom = createCustomProjectLineItem("CO"); custom.itemCode = "LEGACY"; custom.group = "";
    project.lineItems = [custom];
    expect(rows(buildProjectCsv(project))[6].split(",")[0]).toBe("");
  });
});
