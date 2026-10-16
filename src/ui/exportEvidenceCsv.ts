import type { AppData, EvidenceResult, EvidenceRow } from "../data/schema";
import { getEvidenceLocationDisplayValues } from "../matching/projectLocation";

interface CsvColumn {
  header: string;
  value: (row: EvidenceRow, data?: AppData) => string | number | null;
}

const csvColumns: CsvColumn[] = [
  { header: "Contract / project", value: (row) => [row.project?.projectNumber || "Not listed", row.project?.projectControlNumber ? `PCN ${row.project.projectControlNumber}` : ""].filter(Boolean).join(" • ") },
  { header: "Location", value: (row) => getEvidenceLocationDisplayValues(row).join(" • ") || "Unknown project" },
  { header: "District", value: (row) => row.project?.district || "Not listed" },
  { header: "Let date", value: (row) => row.project?.estimateLetDate || row.dateBasis || null },
  { header: "Awarded vendor", value: (row) => row.project?.contractor || "Not listed" },
  { header: "Bids", value: (row) => row.project?.bidCount ?? null },
  { header: "Quantity", value: (row) => row.quantity },
  { header: "Unit", value: (row) => row.unit || null },
  { header: "Item description", value: (row) => row.descriptionRaw || null },
  { header: "Awarded Price", value: (row) => row.awardedBidUnitPrice },
  { header: "Average Price", value: (row) => row.averageBidUnitPrice },
  { header: "Engineer Estimate", value: (row) => row.engineerEstimateUnitPrice },
  { header: "Source", value: (row) => row.source?.sourceLabel || "Unknown source" }
];

export function buildEvidenceCsv(result: EvidenceResult, rows: EvidenceRow[] = result.filteredRows, data?: AppData): string {
  const visibleColumns = csvColumns.filter((column) =>
    (column.header !== "District" || data?.stateConfig.capabilities.districtFilter !== false)
    && (column.header !== "Engineer Estimate" || data?.stateConfig.capabilities.engineerEstimate !== false)
  );
  const lines = [
    visibleColumns.map((column) => escapeCsvValue(column.header)).join(","),
    ...rows.map((row) =>
      visibleColumns.map((column) => escapeCsvValue(column.value(row, data))).join(",")
    )
  ];

  return lines.join("\r\n");
}

export function downloadEvidenceCsv(result: EvidenceResult, rows: EvidenceRow[] = result.filteredRows, data?: AppData): void {
  if (rows.length === 0) {
    return;
  }

  const csv = buildEvidenceCsv(result, rows, data);
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

  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/u.test(text) && !/^-[0-9]+(?:\.[0-9]+)?$/u.test(text)) text = `'${text}`;

  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }

  return text;
}
