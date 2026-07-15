import type { ProjectLineItem, UserProject } from "../projects/projectWorkspace";

interface ProjectCsvColumn {
  header: string;
  value: (project: UserProject, lineItem: ProjectLineItem, lineNumber: number) => string | number | null;
}

const projectCsvColumns: ProjectCsvColumn[] = [
  { header: "State", value: (project) => project.state },
  { header: "Project Name", value: (project) => project.name },
  { header: "Project Location", value: (project) => project.location },
  { header: "Project Notes", value: (project) => project.notes },
  { header: "Line Number", value: (_project, _lineItem, lineNumber) => lineNumber },
  { header: "Agency ID", value: (_project, lineItem) => lineItem.agencyId },
  { header: "Agency Item ID", value: (_project, lineItem) => lineItem.agencyItemId },
  { header: "Item Code", value: (_project, lineItem) => lineItem.itemCode },
  { header: "Description", value: (_project, lineItem) => lineItem.description },
  { header: "Quantity", value: (_project, lineItem) => lineItem.quantity },
  { header: "Unit", value: (_project, lineItem) => lineItem.unit },
  { header: "Preferred Unit Cost", value: (_project, lineItem) => lineItem.preferredUnitCost },
  { header: "Total Item Cost", value: (_project, lineItem) => lineItem.quantity * lineItem.preferredUnitCost },
  { header: "Line Notes", value: (_project, lineItem) => lineItem.notes },
  { header: "Evidence Row Count", value: (_project, lineItem) => lineItem.evidenceContext.includedRowCount },
  {
    header: "Included Observation IDs",
    value: (_project, lineItem) => lineItem.evidenceContext.includedObservationIds.join(";")
  },
  { header: "Created At", value: (_project, lineItem) => lineItem.createdAt },
  { header: "Updated At", value: (_project, lineItem) => lineItem.updatedAt }
];

export function buildProjectCsv(project: UserProject): string {
  const lines = [
    projectCsvColumns.map((column) => escapeCsvValue(column.header)).join(","),
    ...project.lineItems.map((lineItem, index) =>
      projectCsvColumns
        .map((column) => escapeCsvValue(column.value(project, lineItem, index + 1)))
        .join(",")
    )
  ];

  return lines.join("\r\n");
}

export function downloadProjectCsv(project: UserProject): void {
  if (project.lineItems.length === 0) {
    return;
  }

  const csv = buildProjectCsv(project);
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

  const text = String(value);

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
