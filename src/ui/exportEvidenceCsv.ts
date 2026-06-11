import type { EvidenceResult, EvidenceRow } from "../data/schema";

interface CsvColumn {
  header: string;
  value: (row: EvidenceRow) => string | number | null;
}

const csvColumns: CsvColumn[] = [
  { header: "Project no.", value: (row) => row.project?.projectNumber || null },
  { header: "Project / location", value: (row) => row.project?.projectName || null },
  { header: "District", value: (row) => row.project?.district || null },
  { header: "Let date", value: (row) => row.project?.estimateLetDate || row.dateBasis || null },
  { header: "Contractor", value: (row) => row.project?.contractor || null },
  { header: "Bid count", value: (row) => row.project?.bidCount ?? null },
  { header: "Quantity", value: (row) => row.quantity },
  { header: "Unit", value: (row) => row.unit || null },
  { header: "Item description", value: (row) => row.descriptionRaw || null },
  { header: "Awarded bid unit price", value: (row) => row.awardedBidUnitPrice },
  { header: "Average bid unit price", value: (row) => row.averageBidUnitPrice },
  { header: "Engineer estimate unit price", value: (row) => row.engineerEstimateUnitPrice },
  { header: "Source", value: (row) => row.source?.sourceLabel || null },
  { header: "Project location raw", value: (row) => row.project?.projectLocationRaw || null },
  { header: "Terrain", value: (row) => row.project?.terrain || null },
  { header: "Awarded bid total", value: (row) => row.project?.awardedBidTotal ?? null },
  { header: "Award index", value: (row) => row.project?.awardIndex ?? null },
  { header: "Source ID", value: (row) => row.source?.sourceId || null },
  { header: "Observation IDs", value: (row) => row.observationIds.join(";") || null }
];

export function buildEvidenceCsv(result: EvidenceResult): string {
  const lines = [
    csvColumns.map((column) => escapeCsvValue(column.header)).join(","),
    ...result.filteredRows.map((row) =>
      csvColumns.map((column) => escapeCsvValue(column.value(row))).join(",")
    )
  ];

  return lines.join("\r\n");
}

export function downloadEvidenceCsv(result: EvidenceResult): void {
  if (result.filteredRows.length === 0) {
    return;
  }

  const csv = buildEvidenceCsv(result);
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildCsvFilename(result);
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function buildCsvFilename(result: EvidenceResult): string {
  const itemCode = sanitizeFilenamePart(result.query.itemCode || "item");
  const date = new Date().toISOString().slice(0, 10);
  return `matching-projects-${itemCode}-${date}.csv`;
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "item";
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
