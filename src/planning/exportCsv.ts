// Planning v2 CSV export. Pure: builds the file text from a project; the caller handles download. Rules: src/planning/README.md.
import { calculateAlternative, roundElementAmount, roundTotalAmount, roundUnitPrice } from "./calculate";
import type { PlanningProject, ResolvedLibrary } from "./types";

type Cell = string | number | null | undefined;

const BOM = "﻿";
const EOL = "\r\n";
const HEADER = ["Alternative", "Row type", "Group", "Element", "Item", "Description", "Quantity", "Unit", "Unit price", "Amount", "Note"];
const NOTE =
  "Planning-level estimate. Amounts are rounded as shown on screen: element and summary lines to $1,000, total and range to $10,000.";

/** Numbers are written plain. Text that could run as a spreadsheet formula gets a leading apostrophe; then CSV quoting. */
function csvCell(value: Cell): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/u.test(text) && !/^-[0-9]+(?:\.[0-9]+)?$/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replace(/"/gu, '""')}"` : text;
}

const csvLine = (cells: Cell[]) => cells.map(csvCell).join(",");

const percentText = (rate: number) => `${Math.round(rate * 1000) / 10}%`;

export function planningCsvFilename(project: PlanningProject): string {
  const safe = project.name.replace(/[\\/:*?"<>|]/gu, "_").trim();
  return `${safe || "planning"}.planning.csv`;
}

export function buildPlanningCsv(library: ResolvedLibrary, project: PlanningProject, exportedAt: string): string {
  const stageLabel = library.stages.find((s) => s.id === project.stageId)?.label ?? project.stageId;
  const groupLabel = (id: string) => library.groups.find((g) => g.id === id)?.label ?? id;
  const lines: string[] = [
    csvLine(["Field", "Value"]),
    csvLine(["Project", project.name]),
    csvLine(["State", project.state]),
    csvLine(["Stage", stageLabel]),
    csvLine(["Length (mi)", project.inputs.lengthMiles]),
    csvLine(["Roadway width (ft)", project.inputs.roadwayWidthFt]),
    csvLine(["Intersections", project.inputs.intersections]),
    csvLine(["Price basis", library.priceBasisLabel]),
    csvLine(["Exported", exportedAt]),
    csvLine(["Note", NOTE]),
    "",
    csvLine(HEADER)
  ];

  for (const alt of project.alternatives) {
    const result = calculateAlternative(library, project, alt.id);
    const { summary } = result;
    const row = (type: string, group: Cell, element: Cell, item: Cell, description: Cell, quantity: Cell, unit: Cell, unitPrice: Cell, amount: Cell, note: Cell) =>
      lines.push(csvLine([alt.name, type, group, element, item, description, quantity, unit, unitPrice, amount, note]));

    // Right-of-way and utility relocation are not element results; they appear as Summary rows.
    for (const e of result.elements) {
      if (!e.enabled) continue;
      const group = groupLabel(e.group);
      const note = e.override !== null ? `Entered amount; calculated ${roundElementAmount(e.calculated)}` : "";
      row("Element", group, e.label, "", "", "", "", "", roundElementAmount(e.amount), note);
      if (e.override !== null) continue;
      for (const c of e.components) {
        row(
          "Pay item",
          group,
          e.label,
          c.source.kind === "item" ? c.source.code : "Assembly",
          c.label,
          Math.round(c.quantity * 100) / 100,
          c.unit,
          roundUnitPrice(c.unitPrice),
          Math.round(c.amount),
          `Direct cost before ×${summary.multiplier.toFixed(2)} allowance for minor items, traffic control and mobilization`
        );
      }
    }

    const line = (label: string, amount: number | null) => row("Summary", "", label, "", "", "", "", "", amount, "");
    line("Construction", roundElementAmount(summary.construction));
    line(`Contingency (${percentText(summary.contingencyRate)})`, roundElementAmount(summary.contingency));
    line(`Design (${percentText(summary.designRate)})`, roundElementAmount(summary.design));
    line(`Construction engineering (${percentText(summary.constructionEngineeringRate)})`, roundElementAmount(summary.constructionEngineering));
    line("Right-of-way", roundElementAmount(summary.rightOfWay));
    line("Utility relocation", roundElementAmount(summary.utilityRelocation));
    line("Total", roundTotalAmount(summary.total));
    line("Range low", roundTotalAmount(summary.rangeLow));
    line("Range high", roundTotalAmount(summary.rangeHigh));
    if (summary.budget !== null) {
      line("Budget", summary.budget);
      line("Budget remaining", roundElementAmount(summary.budgetRemaining ?? 0));
    }
  }

  return BOM + lines.join(EOL) + EOL;
}
