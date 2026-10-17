import {
  DEFAULT_PROJECT_SORT,
  calculateProject,
  sortProjectLineItems,
  type ProjectLineItem,
  type ProjectCalculation,
  type ProjectSort,
  type UserProject
} from "../projects/projectWorkspace";

interface ProjectCsvColumn {
  header: string;
  value: (project: UserProject, lineItem: ProjectLineItem, lineNumber: number, calculation: ProjectCalculation) => string | number | null;
}

const projectCsvColumns: ProjectCsvColumn[] = [
  { header: "Group", value: (_project, lineItem) => lineItem.group },
  { header: "Cost Category", value: (_project, lineItem) => lineItem.costRole === "contingency" ? "Contingency" : lineItem.costCategory === "construction" ? "Construction" : "Other" },
  { header: "Item Code", value: (_project, lineItem) => lineItem.itemCode },
  { header: "Description", value: (_project, lineItem) => lineItem.description },
  { header: "Unit Cost", value: (_project, lineItem) => lineItem.pricingMode === "percentage" ? null : lineItem.preferredUnitCost },
  { header: "Unit", value: (_project, lineItem) => lineItem.unit },
  { header: "Quantity", value: (_project, lineItem) => lineItem.pricingMode === "percentage" ? lineItem.percentageRate ?? null : lineItem.quantity },
  { header: "Total Item Cost", value: (_project, lineItem, _number, calculation) => calculation.amountByLineId[lineItem.lineItemId] ?? 0 },
  { header: "Notes", value: (_project, lineItem) => lineItem.pricingMode === "percentage"
    ? `${lineItem.percentageBase?.kind === "group" ? `Base: Group ${lineItem.percentageBase.group}` : lineItem.percentageBase?.kind === "selected_lines" ? `Base: ${lineItem.percentageBase.lineItemIds.length} selected fixed items` : `Base: ${lineItem.percentageBase?.kind.replace(/_/g, " ") ?? "unspecified"}`}${lineItem.notes ? `; ${lineItem.notes}` : ""}`
    : lineItem.notes }
];

export function buildProjectCsv(project: UserProject, sort: ProjectSort = DEFAULT_PROJECT_SORT): string {
  const lineItems = sortProjectLineItems(project.lineItems, sort, project);
  const calculation = calculateProject(project);
  const summary = calculation.summary;
  const lines = [
    ["Project", project.name].map(escapeCsvValue).join(","),
    ["State", project.state].map(escapeCsvValue).join(","),
    ["Location", project.location].map(escapeCsvValue).join(","),
    ["Notes", project.notes].map(escapeCsvValue).join(","),
    "",
    projectCsvColumns.map((column) => escapeCsvValue(column.header)).join(","),
    ...lineItems.map((lineItem, index) =>
      projectCsvColumns
        .map((column) => escapeCsvValue(column.value(project, lineItem, index + 1, calculation)))
        .join(",")
    ),
    "",
    ["Project Cost Summary", "Value"].map(escapeCsvValue).join(","),
    ["Construction Costs", summary.constructionCost].map(escapeCsvValue).join(","),
    ["Other costs", summary.otherCost].map(escapeCsvValue).join(","),
    ["Contingencies", summary.contingencyCost].map(escapeCsvValue).join(","),
    ["Total Project Cost", summary.totalProjectCost].map(escapeCsvValue).join(","),
    ...(project.planningOrigin
      ? [
          ["Created from Planning", `${project.planningOrigin.planningProjectName} - ${project.planningOrigin.alternativeName}`].map(escapeCsvValue).join(","),
          ["Planning total at creation", project.planningOrigin.planningTotal].map(escapeCsvValue).join(","),
          ["Created from Planning at", project.planningOrigin.createdAt].map(escapeCsvValue).join(",")
        ]
      : [])
  ];

  return lines.join("\r\n");
}

export function downloadProjectCsv(project: UserProject, sort: ProjectSort = DEFAULT_PROJECT_SORT): void {
  if (project.lineItems.length === 0) {
    return;
  }

  const csv = buildProjectCsv(project, sort);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildProjectCsvFilename(project);
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildProjectCsvFilename(project: UserProject): string {
  const projectName = sanitizeFilenamePart(project.name || "project");
  const date = new Date().toISOString().slice(0, 10);
  return `project-${projectName}-${date}.csv`;
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "project";
}

function escapeCsvValue(value: string | number | null): string {
  if (value === null || value === undefined) {
    return "";
  }

  let text = String(value);
  // Text that a spreadsheet would run as a formula gets a leading apostrophe; numbers are written as-is.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text) && !/^-[0-9]+(?:\.[0-9]+)?$/.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
