// Tests for the Planning v2 CSV export.
import { beforeAll, describe, expect, it } from "vitest";
import prices from "../../public/data/states/co/planning_prices.json";
import rawLibrary from "../../data/planning/co_element_library.json";
import { calculateAlternative, roundElementAmount, roundTotalAmount } from "./calculate";
import { setBudget, setElementEnabled, setElementOverride, renameAlternative, addAlternative } from "./edit";
import { buildPlanningCsv, planningCsvFilename } from "./exportCsv";
import { resolveLibrary } from "./library";
import { createProject } from "./templates";
import type { PlanningLibrary, PlanningProject, PriceTable, ResolvedLibrary } from "./types";

let library: ResolvedLibrary;
beforeAll(() => {
  library = resolveLibrary(rawLibrary as unknown as PlanningLibrary, prices as unknown as PriceTable).library;
});

const NOW = "2026-01-01T00:00:00Z";
const make = (templateId: string | null, name = "Test"): PlanningProject =>
  createProject(library, { id: "p1", name, now: NOW, templateId, alternativeId: "a1" });
const EXPORTED = "2026-02-03T04:05:06Z";

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
const HEADER = ["Alternative", "Row type", "Group", "Element", "Item", "Description", "Quantity", "Unit", "Unit price", "Amount", "Note"];
function tableRows(csv: string): string[][] {
  const rows = parseCsv(body(csv));
  const headerIndex = rows.findIndex((r) => r[0] === "Alternative");
  return rows.slice(headerIndex + 1);
}
const summaryAmount = (rows: string[][], alt: string, label: string) =>
  rows.find((r) => r[0] === alt && r[1] === "Summary" && r[3] === label)?.[9];

describe("buildPlanningCsv format", () => {
  it("starts with a BOM, uses CRLF, and ends with CRLF", () => {
    const csv = buildPlanningCsv(library, make("mill_overlay"), EXPORTED);
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(body(csv).replace(/\r\n/gu, "")).not.toMatch(/[\r\n]/u);
  });

  it("writes the preamble, a blank line, and the table header", () => {
    const project = make("mill_overlay", "Main St");
    const rows = parseCsv(body(buildPlanningCsv(library, project, EXPORTED)));
    expect(rows[0]).toEqual(["Field", "Value"]);
    expect(rows.slice(1, 10)).toEqual([
      ["Project", "Main St"],
      ["State", project.state],
      ["Stage", "Concept"],
      ["Length (mi)", String(project.inputs.lengthMiles)],
      ["Roadway width (ft)", String(project.inputs.roadwayWidthFt)],
      ["Intersections", String(project.inputs.intersections)],
      ["Price basis", library.priceBasisLabel],
      ["Exported", EXPORTED],
      ["Note", "Planning-level estimate. Amounts are rounded as shown on screen: element and summary lines to $1,000, total and range to $10,000."]
    ]);
    expect(rows[10]).toEqual([""]);
    expect(rows[11]).toEqual(HEADER);
  });
});

describe("buildPlanningCsv totals", () => {
  for (const template of rawLibrary.templates) {
    it(`matches calculateAlternative for template ${template.id}`, () => {
      const project = make(template.id);
      const { summary } = calculateAlternative(library, project, "a1");
      const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));
      expect(summaryAmount(rows, "Alternative A", "Total")).toBe(String(roundTotalAmount(summary.total)));
      expect(summaryAmount(rows, "Alternative A", "Construction")).toBe(String(roundElementAmount(summary.construction)));
      expect(summaryAmount(rows, "Alternative A", "Range low")).toBe(String(roundTotalAmount(summary.rangeLow)));
      expect(summaryAmount(rows, "Alternative A", "Range high")).toBe(String(roundTotalAmount(summary.rangeHigh)));
    });
  }

  it("labels contingency, design and construction engineering with percentages", () => {
    const rows = tableRows(buildPlanningCsv(library, make("mill_overlay"), EXPORTED));
    const labels = rows.filter((r) => r[1] === "Summary").map((r) => r[3]);
    expect(labels.slice(0, 7)).toEqual([
      "Construction",
      "Contingency (30%)",
      "Design (10%)",
      "Construction engineering (10%)",
      "Right-of-way",
      "Utility relocation",
      "Total"
    ]);
  });
});

describe("element and pay item rows", () => {
  it("lists pay items under each enabled, non-overridden element only", () => {
    const project = make("complete_street");
    const result = calculateAlternative(library, project, "a1");
    const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));
    const enabled = result.elements.filter((e) => e.enabled);
    expect(rows.filter((r) => r[1] === "Element").map((r) => r[3])).toEqual(enabled.map((e) => e.label));
    const payItems = rows.filter((r) => r[1] === "Pay item");
    expect(payItems.length).toBe(enabled.reduce((n, e) => n + e.components.length, 0));
    for (const e of enabled) {
      const own = payItems.filter((r) => r[3] === e.label);
      expect(own).toHaveLength(e.components.length);
      expect(own.map((r) => r[5])).toEqual(e.components.map((c) => c.label));
    }
    const first = payItems[0];
    expect(first[10]).toMatch(/^Direct cost before ×\d+\.\d{2} allowance for minor items, traffic control and mobilization$/u);
  });

  it("puts pay item rows directly after their element row", () => {
    const rows = tableRows(buildPlanningCsv(library, make("complete_street"), EXPORTED));
    const idx = rows.findIndex((r) => r[1] === "Pay item");
    expect(rows[idx - 1][1]).toMatch(/^(Element|Pay item)$/u);
    expect(rows[idx][3]).toBe(rows.slice(0, idx).reverse().find((r) => r[1] === "Element")?.[3]);
  });

  it("omits pay items and adds a note for an overridden element", () => {
    let project = make("complete_street");
    const target = calculateAlternative(library, project, "a1").elements.find((e) => e.enabled && e.group === "corridor")!;
    project = setElementOverride(project, "a1", target.elementId, 123456);
    const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));
    const element = rows.find((r) => r[1] === "Element" && r[3] === target.label)!;
    expect(element[9]).toBe("123000");
    expect(element[10]).toBe(`Entered amount; calculated ${roundElementAmount(target.calculated)}`);
    expect(rows.filter((r) => r[1] === "Pay item" && r[3] === target.label)).toHaveLength(0);
  });

  it("leaves out disabled elements", () => {
    let project = make("complete_street");
    const target = calculateAlternative(library, project, "a1").elements.find((e) => e.enabled && e.group === "corridor")!;
    project = setElementEnabled(project, "a1", target.elementId, false, library);
    const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));
    expect(rows.some((r) => r[3] === target.label)).toBe(false);
  });

  it("writes pay item numbers rounded", () => {
    const rows = tableRows(buildPlanningCsv(library, make("mill_overlay"), EXPORTED));
    for (const r of rows.filter((x) => x[1] === "Pay item")) {
      expect(r[6]).toMatch(/^\d+(\.\d{1,2})?$/u);
      expect(r[8]).toMatch(/^\d+(\.\d{1,2})?$/u);
      expect(r[9]).toMatch(/^\d+$/u);
    }
  });
});

describe("budget rows", () => {
  it("appear only when a budget is set", () => {
    const project = make("mill_overlay");
    expect(summaryAmount(tableRows(buildPlanningCsv(library, project, EXPORTED)), "Alternative A", "Budget")).toBeUndefined();
    const withBudget = setBudget(project, 100);
    const rows = tableRows(buildPlanningCsv(library, withBudget, EXPORTED));
    const { summary } = calculateAlternative(library, withBudget, "a1");
    expect(summaryAmount(rows, "Alternative A", "Budget")).toBe("100");
    expect(summaryAmount(rows, "Alternative A", "Budget remaining")).toBe(String(roundElementAmount(summary.budgetRemaining!)));
    expect(summary.budgetRemaining!).toBeLessThan(0);
  });
});

describe("multiple alternatives", () => {
  it("gives each alternative its own summary block", () => {
    let project = make("mill_overlay");
    project = addAlternative(project, library, "sidewalk_gap", { id: "a2", name: "Option B" });
    const rows = tableRows(buildPlanningCsv(library, project, EXPORTED));
    for (const alt of project.alternatives) {
      const { summary } = calculateAlternative(library, project, alt.id);
      expect(rows.filter((r) => r[0] === alt.name && r[1] === "Summary" && r[3] === "Total")).toHaveLength(1);
      expect(summaryAmount(rows, alt.name, "Total")).toBe(String(roundTotalAmount(summary.total)));
    }
    expect(rows.filter((r) => r[1] === "Summary" && r[3] === "Total")).toHaveLength(2);
  });
});

describe("cell escaping", () => {
  it("prefixes formula-like text with an apostrophe", () => {
    let project = make("mill_overlay", '=HYPERLINK("http://x","y")');
    project = renameAlternative(project, "a1", "+cmd");
    const csv = buildPlanningCsv(library, project, EXPORTED);
    const rows = parseCsv(body(csv));
    expect(rows[1]).toEqual(["Project", `'=HYPERLINK("http://x","y")`]);
    expect(tableRows(csv).every((r) => r[0] === "'+cmd")).toBe(true);
    for (const lead of ["=", "+", "-", "@", "\t"]) {
      const out = parseCsv(body(buildPlanningCsv(library, make("mill_overlay", `${lead}x`), EXPORTED)));
      expect(out[1][1]).toBe(`'${lead}x`);
    }
  });

  it("quotes cells with commas, quotes and newlines", () => {
    const project = renameAlternative(make("mill_overlay", 'A, "B"\nC'), "a1", "x,y");
    const csv = buildPlanningCsv(library, project, EXPORTED);
    expect(csv).toContain('Project,"A, ""B""\nC"');
    expect(parseCsv(body(csv))[1]).toEqual(["Project", 'A, "B"\nC']);
    expect(tableRows(csv)[0][0]).toBe("x,y");
    expect(csv).toContain('"x,y",');
  });

  it("keeps column counts consistent", () => {
    const rows = tableRows(buildPlanningCsv(library, make("complete_street"), EXPORTED));
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r).toHaveLength(HEADER.length);
  });
});

describe("planningCsvFilename", () => {
  it("replaces unsafe characters", () => {
    expect(planningCsvFilename(make(null, 'a\\b/c:d*e?f"g<h>i|j'))).toBe("a_b_c_d_e_f_g_h_i_j.planning.csv");
  });
  it("trims and falls back to planning", () => {
    expect(planningCsvFilename(make(null, "  Main St  "))).toBe("Main St.planning.csv");
    expect(planningCsvFilename(make(null, "   "))).toBe("planning.planning.csv");
    expect(planningCsvFilename(make(null, ""))).toBe("planning.planning.csv");
  });
});
