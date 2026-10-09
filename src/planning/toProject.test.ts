// Tests for converting a Planning v2 alternative into an engineer Project.
import { beforeAll, describe, expect, it } from "vitest";
import prices from "../../public/data/states/co/planning_prices.json";
import rawLibrary from "../../data/planning/co_element_library.json";
import { parseUserProjectV10, projectCostSummary } from "../projects/projectWorkspace";
import { calculateAlternative } from "./calculate";
import { setElementOverride, setEngineering, setProjectInput, setStage } from "./edit";
import { resolveLibrary } from "./library";
import { createProject } from "./templates";
import { planningAlternativeToProject, type CatalogEntry, type ToProjectOptions } from "./toProject";
import type { PlanningLibrary, PlanningProject, PriceTable, ResolvedLibrary } from "./types";

const priceTable = prices as unknown as PriceTable;
let library: ResolvedLibrary;
beforeAll(() => {
  library = resolveLibrary(rawLibrary as unknown as PlanningLibrary, priceTable).library;
});

const NOW = "2026-03-04T05:06:07.000Z";
const cents = (x: number) => Math.round(x * 100) / 100;
const make = (templateId: string | null, name = "Main St"): PlanningProject =>
  createProject(library, { id: "p1", name, now: NOW, templateId, alternativeId: "a1" });

const fullCatalog = (id: string): CatalogEntry | null => {
  const item = priceTable.items[id];
  return item ? { agencyId: "co_cdot", agencyItemId: id, itemCode: item.code, description: item.description, unit: item.unit } : null;
};

function makeOptions(catalog: ToProjectOptions["catalog"] = fullCatalog): ToProjectOptions {
  let n = 0;
  return { now: NOW, newId: (prefix) => `${prefix}_${(n += 1)}`, catalog };
}

describe("reconciliation for every template", () => {
  const maxDifference: Record<string, number> = {};
  for (const template of rawLibrary.templates) {
    it(`template ${template.id} reconciles to Planning`, () => {
      const planning = make(template.id);
      const { summary } = calculateAlternative(library, planning, "a1");
      const { project, difference } = planningAlternativeToProject(library, planning, "a1", makeOptions());
      maxDifference[template.id] = Math.abs(difference);
      expect(Math.abs(difference)).toBeLessThan(1);
      expect(Math.abs(projectCostSummary(project).constructionCost - cents(summary.construction))).toBeLessThanOrEqual(0.01);
    });

    it(`variant of ${template.id} (other stage, budget, ROW, utilities, override, design rate) reconciles`, () => {
      let planning = make(template.id);
      planning = setStage(planning, planning.stageId === "concept" ? "planning_study" : "concept");
      planning = { ...planning, budget: 1_000_000 };
      planning = setElementOverride(planning, "a1", "right_of_way", 250_000);
      planning = setElementOverride(planning, "a1", "utility_relocation", 100_000);
      planning = { ...planning, alternatives: planning.alternatives.map((a) => ({
        ...a,
        selections: { ...a.selections, sidewalk: { enabled: true, inputs: {}, override: 123_456.78 } }
      })) };
      planning = setEngineering(planning, { design: 0.137, constructionEngineering: 0.0825 });
      const { difference, project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
      expect(Math.abs(difference)).toBeLessThan(1);
      expect(project.lineItems.filter((l) => l.group === "Sidewalk")).toHaveLength(1);
    });
  }
  it("reports the observed maximum", () => {
    expect(Object.keys(maxDifference).length).toBeGreaterThan(0);
  });
});

describe("line mapping", () => {
  it("builds a catalog line for sidewalk with the exact fields", () => {
    const planning = make("sidewalk_gap");
    const result = calculateAlternative(library, planning, "a1");
    const sidewalk = result.elements.find((e) => e.elementId === "sidewalk")!;
    const component = sidewalk.components.find((c) => c.source.kind === "item" && c.source.itemId === "co_cdot_608-00006")!;
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const line = project.lineItems.find((l) => l.agencyItemId === "co_cdot_608-00006")!;
    const item = priceTable.items["co_cdot_608-00006"];
    expect(line).toMatchObject({
      lineItemType: "catalog",
      costCategory: "construction",
      state: planning.state,
      agencyId: "co_cdot",
      itemCode: item.code,
      description: item.description,
      unit: item.unit,
      group: "Sidewalk",
      descriptionOverrideEnabled: false,
      evidenceContext: null,
      quantity: Math.round(component.quantity * 10000) / 10000,
      preferredUnitCost: cents(component.unitPrice),
      notes: `Planning: ${sidewalk.label} – ${component.label}`,
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(normalize(item.unit)).toBe("SY");
  });

  it("makes assembly elements into custom construction lines", () => {
    const planning = make("complete_street");
    const result = calculateAlternative(library, planning, "a1");
    const assembly = result.elements.find((e) => e.enabled && e.components.some((c) => c.source.kind === "assembly"))!;
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const lines = project.lineItems.filter((l) => l.group === assembly.label);
    const comp = assembly.components.find((c) => c.source.kind === "assembly" && cents(c.quantity) > 0)!;
    const line = lines.find((l) => l.description === `${assembly.label} – ${comp.label}`)!;
    expect(line).toMatchObject({
      lineItemType: "custom",
      costCategory: "construction",
      agencyId: "",
      agencyItemId: "",
      descriptionOverrideEnabled: true,
      unit: comp.unit,
      quantity: Math.round(comp.quantity * 10000) / 10000,
      preferredUnitCost: cents(comp.unitPrice),
      notes: comp.source.kind === "assembly" ? `Planning assembly cost per ${comp.unit}. Basis: ${comp.source.basis}.` : ""
    });
  });

  it("turns an overridden element into exactly one 1 LS line", () => {
    const planning = setElementOverride(make("complete_street"), "a1", "sidewalk", 345_678.9);
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const lines = project.lineItems.filter((l) => l.group === "Sidewalk");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ lineItemType: "custom", unit: "LS", quantity: 1, preferredUnitCost: 345_678.9, costCategory: "construction" });
    expect(lines[0].notes).toContain("includes allowances");
  });

  it("adds the three allowance lines with factor percents", () => {
    const planning = make("mill_overlay");
    const { summary } = calculateAlternative(library, planning, "a1");
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const lines = project.lineItems.filter((l) => l.group === "Allowances");
    const p = (x: number) => String(Math.round(x * 100 * 1000) / 1000);
    expect(lines.map((l) => l.description)).toEqual([
      `Minor items allowance (${p(summary.factors.minor)}% of listed items)`,
      `Traffic control allowance (${p(summary.factors.trafficControl)}%)`,
      `Mobilization allowance (${p(summary.factors.mobilization)}%)`
    ]);
    expect(lines[0].description).toBe("Minor items allowance (56% of listed items)");
    for (const l of lines) {
      expect(l).toMatchObject({ lineItemType: "custom", unit: "LS", quantity: 1, costCategory: "construction", notes: "Planning factor for mill overlay" });
    }
  });

  it("sets contingencyPercent from the stage", () => {
    for (const stage of library.stages) {
      const planning = setStage(make("mill_overlay"), stage.id);
      const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
      expect(project.contingencyPercent).toBe(Math.round(stage.contingency * 100 * 1000) / 1000);
    }
    expect(planningAlternativeToProject(library, make("mill_overlay"), "a1", makeOptions()).project.contingencyPercent).toBe(30);
  });

  it("nets ROW and utilities of contingency to the cent and notes the entered amount", () => {
    let planning = make("mill_overlay");
    planning = setElementOverride(planning, "a1", "right_of_way", 253_456);
    planning = setElementOverride(planning, "a1", "utility_relocation", 100_000);
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const k = 0.3;
    const row = project.lineItems.find((l) => l.description === "Right-of-way")!;
    const util = project.lineItems.find((l) => l.description === "Utility relocation")!;
    expect(row.preferredUnitCost).toBe(cents(253_456 / (1 + k)));
    expect(row).toMatchObject({ costCategory: "other", group: "Engineering and other costs", unit: "LS", quantity: 1 });
    expect(row.notes).toBe(
      "Planning entered $253,456. Shown net of the 30% Project contingency so the Project total matches Planning."
    );
    expect(util.preferredUnitCost).toBe(cents(100_000 / (1 + k)));
  });

  it("omits ROW and utility lines when zero, and engineering lines when the rate is zero", () => {
    const planning = setEngineering(make("mill_overlay"), { design: 0, constructionEngineering: 0 });
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    expect(project.lineItems.filter((l) => l.costCategory === "other")).toHaveLength(0);
    const base = planningAlternativeToProject(library, make("mill_overlay"), "a1", makeOptions()).project;
    const names = base.lineItems.filter((l) => l.costCategory === "other").map((l) => l.description);
    expect(names).toEqual(["Design engineering", "Construction engineering"]);
    expect(base.lineItems.find((l) => l.description === "Design engineering")!.notes).toBe(
      "Planning: 10% of construction plus contingency. The Project contingency is applied to this line, so it shows 10% of construction."
    );
  });

  it("skips zero-quantity components and never emits zero-amount lines", () => {
    const { project } = planningAlternativeToProject(library, make("complete_street"), "a1", makeOptions());
    for (const l of project.lineItems) expect((l.quantity ?? 0) * (l.preferredUnitCost ?? 0)).toBeGreaterThan(0);
    let planning = make("mill_overlay");
    for (const e of calculateAlternative(library, planning, "a1").elements.filter((x) => x.enabled)) {
      planning = setElementOverride(planning, "a1", e.elementId, 0);
    }
    const zero = planningAlternativeToProject(library, planning, "a1", makeOptions()).project;
    expect(zero.lineItems.filter((l) => l.group === "Allowances")).toHaveLength(0);
    expect(zero.lineItems.filter((l) => l.costCategory === "construction")).toHaveLength(0);
  });
});

const normalize = (u: string) => u.trim().toUpperCase();

describe("catalog fallbacks", () => {
  it("uses custom lines with a note when the catalog has no entry", () => {
    const planning = make("sidewalk_gap");
    const { project, difference } = planningAlternativeToProject(library, planning, "a1", makeOptions(() => null));
    expect(project.lineItems.some((l) => l.lineItemType === "catalog")).toBe(false);
    const item = priceTable.items["co_cdot_608-00006"];
    const line = project.lineItems.find((l) => l.itemCode === item.code)!;
    expect(line).toMatchObject({ lineItemType: "custom", agencyId: "", agencyItemId: "", description: item.description, descriptionOverrideEnabled: true });
    expect(line.notes).toMatch(/^Planning: .+\. Not linked to the catalog \(item not found\)\.$/u);
    expect(Math.abs(difference)).toBeLessThan(1);
  });

  it("uses custom lines when the catalog unit differs", () => {
    const planning = make("sidewalk_gap");
    const catalog = (id: string) => {
      const entry = fullCatalog(id);
      return entry ? { ...entry, unit: "ZZ" } : null;
    };
    const { project, difference } = planningAlternativeToProject(library, planning, "a1", makeOptions(catalog));
    expect(project.lineItems.some((l) => l.lineItemType === "catalog")).toBe(false);
    expect(project.lineItems.some((l) => l.notes.endsWith("(catalog unit ZZ)."))).toBe(true);
    expect(Math.abs(difference)).toBeLessThan(1);
  });
});

describe("project fields", () => {
  it("fills project metadata and origin", () => {
    const planning = make("mill_overlay", "Main St");
    const { project, planningTotal, projectTotal, difference } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const { summary } = calculateAlternative(library, planning, "a1");
    expect(project).toMatchObject({
      projectId: "project_1",
      state: planning.state,
      name: "Main St – Alternative A",
      location: "",
      status: "active",
      archivedAt: null,
      revision: 0,
      lastBackupAt: null,
      lastBackupRevision: null,
      createdAt: NOW,
      updatedAt: NOW
    });
    expect(project.notes).toMatch(
      /^Created from Planning estimate "Main St", Alternative A, on 2026-03-04\. Stage: Concept\. Unit prices: .+\. Planning total \$[\d,]+\.$/u
    );
    expect(project.notes).toContain(library.priceBasisLabel);
    expect(project.planningOrigin).toEqual({
      planningProjectId: "p1",
      planningProjectName: "Main St",
      alternativeId: "a1",
      alternativeName: "Alternative A",
      createdAt: NOW,
      planningTotal: summary.total
    });
    expect(planningTotal).toBe(summary.total);
    expect(projectTotal).toBe(projectCostSummary(project).totalProjectCost);
    expect(difference).toBe(projectTotal - planningTotal);
  });

  it("survives a JSON round trip through the v10 parser", () => {
    let planning = setElementOverride(make("complete_street"), "a1", "right_of_way", 250_000);
    planning = setElementOverride(planning, "a1", "sidewalk", 99_999.99);
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    expect(parseUserProjectV10(JSON.parse(JSON.stringify(project)))).toEqual(project);
  });

  it("is deterministic and draws ids from newId", () => {
    const planning = make("complete_street");
    const a = planningAlternativeToProject(library, planning, "a1", makeOptions()).project;
    const b = planningAlternativeToProject(library, planning, "a1", makeOptions()).project;
    expect(a).toEqual(b);
    expect(a.projectId).toBe("project_1");
    expect(a.lineItems.map((l) => l.lineItemId)).toEqual(a.lineItems.map((_, i) => `line_${i + 2}`));
  });

  it("throws on an unknown alternative", () => {
    expect(() => planningAlternativeToProject(library, make("mill_overlay"), "nope", makeOptions())).toThrow(/nope/u);
  });
  it("keeps short per-mile quantities precise so the mobilization line is not distorted", () => {
    const planning = setProjectInput(make("complete_street"), "lengthMiles", 0.125);
    const result = calculateAlternative(library, planning, "a1");
    const { project } = planningAlternativeToProject(library, planning, "a1", makeOptions());
    const direct = result.elements.filter((e) => e.enabled && e.override === null).reduce((sum, e) => sum + e.direct, 0);
    const { minor, trafficControl, mobilization } = result.summary.factors;
    const expected = direct * (1 + minor) * (1 + trafficControl) * mobilization;
    const line = project.lineItems.find((l) => l.description.startsWith("Mobilization allowance"))!;
    expect(Math.abs((line.preferredUnitCost ?? 0) - expected)).toBeLessThan(5);
    expect(project.lineItems.some((l) => l.quantity === 0.125)).toBe(true);
  });
});
