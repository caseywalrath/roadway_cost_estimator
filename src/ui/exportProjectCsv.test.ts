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
    expect(values[headers.indexOf("Added Via")]).toBe("Manual");
    expect(headers).toContain("Group");
    expect(headers.slice(0, 20)).toEqual([
      "State", "Project Name", "Project Location", "Project Notes", "Line Number", "Added Via",
      "Group", "Agency ID", "Agency Item ID", "Item Code", "Description", "Quantity", "Unit",
      "Preferred Unit Cost", "Total Item Cost", "Line Notes", "Evidence Row Count", "Included Observation IDs",
      "Created At", "Updated At"
    ]);
    expect(headers.slice(20)).toEqual(["Item Type", "Cost Category", "Import File", "Import Sheet", "Import Row"]);
    expect(values[headers.indexOf("Group")]).toBe("Construction");
    expect(values[headers.indexOf("Agency ID")]).toBe("");
    expect(values[headers.indexOf("Agency Item ID")]).toBe("");
    expect(values[headers.indexOf("Total Item Cost")]).toBe("50");
    expect(values[headers.indexOf("Item Type")]).toBe("Custom");
    expect(values[headers.indexOf("Cost Category")]).toBe("Other");
    const summaryStart = rows.indexOf("Project Cost Summary,Value");
    expect(rows[summaryStart + 1]).toBe("Construction Costs,0");
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
    const addedViaColumn = headers.indexOf("Added Via");

    expect(rows[1].split(",")[addedViaColumn]).toBe("Roadway Costing Tool");
    expect(rows[2].split(",")[addedViaColumn]).toBe("Roadway Costing Tool");
    expect(rows[1].split(",")[evidenceCountColumn]).toBe("0");
    expect(rows[1].split(",")[observationIdsColumn]).toBe("");
    expect(rows[2].split(",")[evidenceCountColumn]).toBe("2");
    expect(rows[2].split(",")[observationIdsColumn]).toBe("observation_1;observation_2");
  });

  it("exports imported provenance after the existing fixed columns", () => {
    const project = createUserProject("Imported export", "CO");
    const imported = createCustomProjectLineItem("CO", "construction");
    imported.description = "Imported item";
    imported.importSource = {
      importId: "import_test",
      fileName: "estimate.xlsx",
      sheetName: "Estimate",
      rowNumber: 11,
      sourceRange: "B11:H11",
      importedAt: "2026-09-09T00:00:00.000Z",
      original: { itemCode: "", description: "Imported item", unit: "LS", quantity: 1, unitCost: 25, total: 25 },
      decisions: []
    };
    project.lineItems = [imported];

    const rows = buildProjectCsv(project).split("\r\n");
    const headers = rows[0].split(",");
    const values = rows[1].split(",");

    expect(values[headers.indexOf("Added Via")]).toBe("Excel Import");
    expect(values[headers.indexOf("Item Type")]).toBe("Custom");
    expect(values[headers.indexOf("Cost Category")]).toBe("Construction");
    expect(values[headers.indexOf("Import File")]).toBe("estimate.xlsx");
    expect(values[headers.indexOf("Import Sheet")]).toBe("Estimate");
    expect(values[headers.indexOf("Import Row")]).toBe("11");
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
