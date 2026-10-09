// Round-trip checks: Planning CSV and JSON share file agree with the on-screen totals and with each other.
import { beforeAll, describe, expect, it } from "vitest";
import prices from "../../public/data/states/co/planning_prices.json";
import rawLibrary from "../../data/planning/co_element_library.json";
import { calculateAlternative } from "./calculate";
import { addAlternative, setBudget, setElementEnabled, setElementOverride } from "./edit";
import { buildPlanningCsv } from "./exportCsv";
import { resolveLibrary } from "./library";
import { buildShareFile, importProjectCopy, parseShareFile } from "./shareFile";
import { createProject } from "./templates";
import type { PlanningLibrary, PlanningProject, PriceTable, ResolvedLibrary } from "./types";
import { formatElementAmount, formatTotalAmount } from "../ui/planning/format";
import { budgetInfo } from "../ui/planning/renderPlanning";

let library: ResolvedLibrary;
beforeAll(() => {
  library = resolveLibrary(rawLibrary as unknown as PlanningLibrary, prices as unknown as PriceTable).library;
});

const NOW = "2026-01-01T00:00:00Z";
const EXPORTED = "2026-02-03T04:05:06Z";
const BUDGET = 5_000_000;
const SIDEWALK_OVERRIDE = 1_000_000;

/** Minimal CSV parser: handles quoted cells, doubled quotes, and CRLF or LF row ends. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

const body = (csv: string) => csv.replace(/^﻿/u, "");
/** Table rows only (after the "Alternative" header). Column 0 = alternative, 1 = row type, 3 = element/label, 9 = amount. */
function tableRows(csv: string): string[][] {
  const rows = parseCsv(body(csv));
  const headerIndex = rows.findIndex((r) => r[0] === "Alternative");
  return rows.slice(headerIndex + 1);
}
const summaryRow = (rows: string[][], alt: string, label: string) =>
  rows.find((r) => r[0] === alt && r[1] === "Summary" && r[3] === label);
const summaryAmount = (rows: string[][], alt: string, label: string) => summaryRow(rows, alt, label)?.[9];

/** Parses the number out of on-screen money text: "$3,730,000" -> 3730000, "-$1,000" -> -1000. */
const screenNumber = (text: string) => Number(text.replace(/[$,]/g, ""));

/** Base project for a template: budget unset, one alternative "a1". */
function baseProject(templateId: string): PlanningProject {
  return createProject(library, { id: "p1", name: "Test", now: NOW, templateId, alternativeId: "a1" });
}

/**
 * Variant project: budget set, sidewalk enabled with a 1,000,000 override (when the element exists),
 * and a second alternative added from the mill_overlay template.
 */
function variantProject(templateId: string): PlanningProject {
  let project = setBudget(baseProject(templateId), BUDGET);
  if (library.elements.some((e) => e.id === "sidewalk")) {
    project = setElementEnabled(project, "a1", "sidewalk", true, library);
    project = setElementOverride(project, "a1", "sidewalk", SIDEWALK_OVERRIDE);
  }
  return addAlternative(project, library, "mill_overlay", { id: "a2", name: "Option B" });
}

const variants: Array<{ label: string; build: (templateId: string) => PlanningProject }> = [
  { label: "base", build: baseProject },
  { label: "variant", build: variantProject }
];

describe("Planning CSV matches on-screen totals", () => {
  for (const template of rawLibrary.templates) {
    for (const variant of variants) {
      it(`template ${template.id} (${variant.label}): summary rows equal the screen text`, () => {
        const project = variant.build(template.id);
        const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));

        for (const alt of project.alternatives) {
          const { summary } = calculateAlternative(library, project, alt.id);

          expect(summaryAmount(rows, alt.name, "Construction")).toBeDefined();
          expect(Number(summaryAmount(rows, alt.name, "Construction"))).toBe(screenNumber(formatElementAmount(summary.construction)));
          expect(Number(summaryAmount(rows, alt.name, "Total"))).toBe(screenNumber(formatTotalAmount(summary.total)));
          expect(Number(summaryAmount(rows, alt.name, "Range low"))).toBe(screenNumber(formatTotalAmount(summary.rangeLow)));
          expect(Number(summaryAmount(rows, alt.name, "Range high"))).toBe(screenNumber(formatTotalAmount(summary.rangeHigh)));

          if (summary.budget === null) {
            expect(summaryRow(rows, alt.name, "Budget")).toBeUndefined();
            expect(summaryRow(rows, alt.name, "Budget remaining")).toBeUndefined();
          } else {
            expect(Number(summaryAmount(rows, alt.name, "Budget"))).toBe(summary.budget);
            // The screen shows the absolute amount with "over budget" or "remaining"; the CSV keeps the sign.
            const info = budgetInfo(summary)!;
            const shown = screenNumber(info.remainingText.split(" ")[0]) * (info.over ? -1 : 1);
            expect(Number(summaryAmount(rows, alt.name, "Budget remaining"))).toBe(shown);
          }
        }
      });

      it(`template ${template.id} (${variant.label}): element amounts equal the screen text and sum correctly`, () => {
        const project = variant.build(template.id);
        const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));

        for (const alt of project.alternatives) {
          const result = calculateAlternative(library, project, alt.id);
          const enabled = result.elements.filter((e) => e.enabled);
          const elementRows = rows.filter((r) => r[0] === alt.name && r[1] === "Element");
          expect(elementRows.map((r) => r[3])).toEqual(enabled.map((e) => e.label));

          let csvSum = 0;
          let screenSum = 0;
          for (const e of enabled) {
            const row = elementRows.find((r) => r[3] === e.label)!;
            const screen = screenNumber(formatElementAmount(e.amount));
            expect(Number(row[9])).toBe(screen);
            csvSum += Number(row[9]);
            screenSum += screen;
          }
          expect(csvSum).toBe(screenSum);
        }

        // The sidewalk override is entered on the selected alternative and must show as written.
        if (variant.label === "variant" && library.elements.some((e) => e.id === "sidewalk")) {
          const row = tableRows(buildPlanningCsv(library, project, EXPORTED)).find((r) => r[0] === "Alternative A" && r[1] === "Element" && r[3] === library.elements.find((e) => e.id === "sidewalk")!.label);
          expect(row?.[9]).toBe(String(SIDEWALK_OVERRIDE));
        }
      });
    }
  }
});

describe("Planning JSON share file round trip", () => {
  for (const template of rawLibrary.templates) {
    for (const variant of variants) {
      it(`template ${template.id} (${variant.label}): export, parse and import keep every total and value`, () => {
        const project = variant.build(template.id);
        const parsed = parseShareFile(buildShareFile(project, library, NOW), library);
        expect(parsed.ok).toBe(true);
        if (!parsed.ok) return;
        expect(parsed.issues).toEqual([]);

        let counter = 0;
        const copy = importProjectCopy(parsed.project, { newId: () => `new-${(counter += 1)}`, now: EXPORTED });

        expect(copy.id).not.toBe(project.id);
        expect(copy.revision).toBe(0);
        expect(copy.stageId).toBe(project.stageId);
        expect(copy.budget).toBe(project.budget);
        expect(copy.inputs).toEqual(project.inputs);
        expect(copy.alternatives).toHaveLength(project.alternatives.length);

        project.alternatives.forEach((orig, i) => {
          const got = copy.alternatives[i];
          expect(got.id).not.toBe(orig.id);
          expect(got.name).toBe(orig.name);
          expect(got.selections).toEqual(orig.selections);

          const a = calculateAlternative(library, project, orig.id).summary;
          const b = calculateAlternative(library, copy, got.id).summary;
          expect(b.construction).toBe(a.construction);
          expect(b.contingency).toBe(a.contingency);
          expect(b.design).toBe(a.design);
          expect(b.constructionEngineering).toBe(a.constructionEngineering);
          expect(b.rightOfWay).toBe(a.rightOfWay);
          expect(b.utilityRelocation).toBe(a.utilityRelocation);
          expect(b.total).toBe(a.total);
        });
      });
    }
  }
});
