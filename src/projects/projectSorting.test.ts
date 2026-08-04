import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROJECT_SORT,
  createCustomProjectLineItem,
  projectGroupSuggestions,
  sortProjectLineItems,
  type ProjectLineItem,
  type ProjectSortKey
} from "./projectWorkspace";

describe("Project line sorting", () => {
  it.each([
    ["group", ["Alpha", "Alpha", "Beta", ""]],
    ["itemCode", ["3", "10", "20", ""]],
    ["description", ["Alpha", "Alpha 2", "Zeta", ""]],
    ["preferredUnitCost", ["10", "20", "30", ""]],
    ["unit", ["EA", "EA", "LS", ""]],
    ["quantity", ["1", "2", "5", ""]],
    ["totalItemCost", ["20", "50", "60", ""]],
    ["notes", ["Alpha", "Beta", "Zeta", ""]]
  ] as const)("sorts %s ascending with blanks last", (key, expected) => {
    const lineItems = createSortableLines();
    const sorted = sortProjectLineItems(lineItems, { key: key as ProjectSortKey, direction: "asc" });
    expect(sorted.map((lineItem) => valueForSortKey(lineItem, key as ProjectSortKey))).toEqual(expected);
    expect(lineItems.map((lineItem) => lineItem.lineItemId)).toEqual(["line-20", "line-3", "line-blank", "line-10"]);
  });

  it("toggles descending order without moving blanks ahead of populated values", () => {
    const lineItems = createSortableLines();
    const sorted = sortProjectLineItems(lineItems, { key: "itemCode", direction: "desc" });

    expect(sorted.map((lineItem) => lineItem.itemCode)).toEqual(["20", "10", "3", ""]);
    expect(sortProjectLineItems(lineItems, { key: "group", direction: "desc" }).map((lineItem) => lineItem.group))
      .toEqual(["Beta", "Alpha", "Alpha", ""]);
  });

  it("uses Group ascending as the default and suggests unique current-Project values", () => {
    expect(DEFAULT_PROJECT_SORT).toEqual({ key: "group", direction: "asc" });
    const project = {
      lineItems: [
        createLine("construction", { group: "Construction" }),
        createLine("construction-lower", { group: "construction" }),
        createLine("maintenance", { group: " Maintenance " }),
        createLine("blank", { group: "" })
      ]
    } as never;

    expect(projectGroupSuggestions(project)).toEqual(["Construction", "Maintenance"]);
  });

  it("sorts incomplete calculated totals last and preserves stable ties", () => {
    const first = createLine("tie-a", { itemCode: "1", quantity: 2, preferredUnitCost: 5 });
    const second = createLine("tie-b", { itemCode: "2", quantity: 1, preferredUnitCost: 10 });
    const incomplete = createLine("incomplete", { itemCode: "3", quantity: null, preferredUnitCost: 10 });
    const lines = [first, second, incomplete];

    expect(sortProjectLineItems(lines, { key: "totalItemCost", direction: "asc" }).map((lineItem) => lineItem.lineItemId))
      .toEqual(["tie-a", "tie-b", "incomplete"]);
    expect(sortProjectLineItems(lines, { key: "totalItemCost", direction: "desc" }).map((lineItem) => lineItem.lineItemId))
      .toEqual(["tie-a", "tie-b", "incomplete"]);
  });
});

function createSortableLines(): ProjectLineItem[] {
  return [
    createLine("line-20", { group: "Beta", itemCode: "20", description: "Zeta", preferredUnitCost: 30, unit: "LS", quantity: 2, notes: "Beta" }),
    createLine("line-3", { group: "Alpha", itemCode: "3", description: "Alpha", preferredUnitCost: 10, unit: "EA", quantity: 5, notes: "Alpha" }),
    createLine("line-blank", { itemCode: "", description: "", preferredUnitCost: null, unit: "", quantity: null, notes: "" }),
    createLine("line-10", { group: "Alpha", itemCode: "10", description: "Alpha 2", preferredUnitCost: 20, unit: "EA", quantity: 1, notes: "Zeta" })
  ];
}

function createLine(lineItemId: string, values: Partial<ProjectLineItem>): ProjectLineItem {
  return { ...createCustomProjectLineItem("CO"), lineItemId, ...values };
}

function valueForSortKey(lineItem: ProjectLineItem, key: ProjectSortKey): string {
  if (key === "totalItemCost") {
    return lineItem.quantity === null || lineItem.preferredUnitCost === null
      ? ""
      : String(lineItem.quantity * lineItem.preferredUnitCost);
  }
  return String(lineItem[key] ?? "");
}
