import { describe, expect, it } from "vitest";
import { createCatalogProjectLineItem, createCustomProjectLineItem, createUserProject } from "../projects/projectWorkspace";
import { buildProjectCsv } from "./exportProjectCsv";

describe("Project CSV export", () => {
  it("exports custom lines with calculated totals and blank evidence identity", () => {
    const project = createUserProject("Estimate", "CO");
    const custom = createCustomProjectLineItem("CO");
    custom.itemCode = "SOFT";
    custom.group = "Construction";
    custom.description = "Soft costs";
    custom.quantity = 2;
    custom.unit = "LS";
    custom.preferredUnitCost = 25;
    project.lineItems = [custom];

    const csv = buildProjectCsv(project);
    const rows = csv.split("\r\n");
    const headers = rows[0].split(",");
    const values = rows[1].split(",");
    expect(headers).toContain("Group");
    expect(values[headers.indexOf("Group")]).toBe("Construction");
    expect(values[headers.indexOf("Agency ID")]).toBe("");
    expect(values[headers.indexOf("Agency Item ID")]).toBe("");
    expect(values[headers.indexOf("Total Item Cost")]).toBe("50");
    const summaryStart = rows.indexOf("Project Cost Summary,Value");
    expect(rows[summaryStart + 1]).toBe("Construction bid items,0");
    expect(rows[summaryStart + 2]).toBe("Other costs,50");
    expect(rows[summaryStart + 3]).toBe("Contingency percentage,0");
    expect(rows[summaryStart + 4]).toBe("Contingencies,0");
    expect(rows[summaryStart + 5]).toBe("Total Project Cost,50");
  });

  it("exports catalog lines with optional evidence fields", () => {
    const project = createUserProject("Catalog export", "CO");
    const withoutEvidence = createCatalogProjectLineItem({
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_001",
      group: "Construction",
      itemCode: "001",
      description: "Catalog item",
      unit: "EACH",
      quantity: null,
      preferredUnitCost: null,
      notes: "",
      evidenceContext: null
    });
    const withEvidence = createCatalogProjectLineItem({
      ...withoutEvidence,
      state: "CO",
      agencyId: "co_cdot",
      agencyItemId: "co_cdot_002",
      group: "Construction",
      itemCode: "002",
      description: "Evidence item",
      unit: "LS",
      quantity: 1,
      preferredUnitCost: 25,
      notes: "",
      evidenceContext: {
        query: {} as never,
        filters: {} as never,
        sort: {} as never,
        includedRowCount: 2,
        includedObservationIds: ["observation_1", "observation_2"],
        summarySnapshot: {
          awarded: null,
          average: null,
          engineer: null,
          inflationAdjustmentEnabled: false,
          inflationTargetPeriodLabel: null,
          valuesAreInflationAdjusted: false
        },
        costSource: "manual"
      }
    });
    project.lineItems = [withoutEvidence, withEvidence];

    const rows = buildProjectCsv(project).split("\r\n");
    const headers = rows[0].split(",");
    const evidenceCountColumn = headers.indexOf("Evidence Row Count");
    const observationIdsColumn = headers.indexOf("Included Observation IDs");

    expect(rows[1].split(",")[evidenceCountColumn]).toBe("0");
    expect(rows[1].split(",")[observationIdsColumn]).toBe("");
    expect(rows[2].split(",")[evidenceCountColumn]).toBe("2");
    expect(rows[2].split(",")[observationIdsColumn]).toBe("observation_1;observation_2");
  });

  it("exports the active Project sort without changing stored line order", () => {
    const project = createUserProject("Sortable export", "CO");
    const later = createCustomProjectLineItem("CO");
    later.itemCode = "20";
    const earlier = createCustomProjectLineItem("CO");
    earlier.itemCode = "3";
    project.lineItems = [later, earlier];

    const csv = buildProjectCsv(project, { key: "itemCode", direction: "asc" });
    const rows = csv.split("\r\n");
    const itemCodeColumn = rows[0].split(",").indexOf("Item Code");

    expect(rows.slice(1, 1 + project.lineItems.length).map((row) => row.split(",")[itemCodeColumn])).toEqual(["3", "20"]);
    expect(project.lineItems.map((lineItem) => lineItem.itemCode)).toEqual(["20", "3"]);
  });

  it("exports blank Group values for legacy lines", () => {
    const project = createUserProject("Legacy export", "CO");
    const custom = createCustomProjectLineItem("CO");
    custom.itemCode = "LEGACY";
    project.lineItems = [custom];

    const rows = buildProjectCsv(project).split("\r\n");
    const headers = rows[0].split(",");
    const values = rows[1].split(",");
    expect(values[headers.indexOf("Group")]).toBe("");
  });
});
