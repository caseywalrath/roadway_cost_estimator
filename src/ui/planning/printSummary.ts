// Planning v2 print summary: a pure HTML string builder. Hidden on screen, shown by the print styles in styles.css.
import type { AlternativeResult, ElementResult, PlanningProject, ResolvedLibrary } from "../../planning/types";
import { formatElementAmount, inputBrief } from "./format";
import { budgetInfo, summaryValues } from "./renderPlanning";

const esc = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);

function formatPrintDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const AMOUNT = ` class="planning-print-amount"`;

function elementRows(library: ResolvedLibrary, result: AlternativeResult): string {
  const byId = new Map<string, ElementResult>(result.elements.map((e) => [e.elementId, e]));
  const rows: string[] = [];
  for (const group of library.groups) {
    if (group.id === "other") continue;
    const lines: string[] = [];
    for (const element of library.elements) {
      if (element.group !== group.id) continue;
      const er = byId.get(element.id);
      if (!er || !er.enabled || element.components.length === 0) continue;
      const entered = er.override !== null ? " (entered)" : "";
      lines.push(`<tr><td>${esc(element.label)}</td><td>${esc(inputBrief(element, er.inputs))}</td><td${AMOUNT}>${esc(formatElementAmount(er.amount))}${entered}</td></tr>`);
    }
    if (lines.length > 0) rows.push(`<tr><th colspan="3" scope="colgroup">${esc(group.label)}</th></tr>`, ...lines);
  }
  return rows.join("\n");
}

function summaryRows(result: AlternativeResult): string {
  const s = result.summary;
  const v = summaryValues(s);
  const budget = budgetInfo(s);
  const line = (label: string, value: string) => `<tr><th scope="row">${esc(label)}</th><td${AMOUNT}>${esc(value)}</td></tr>`;
  return [
    line("Construction", v.construction),
    line(`Contingency (${v.contingencyRate})`, v.contingency),
    line(`Design (${summaryPercent(s.designRate)})`, v.design),
    line(`Construction engineering (${summaryPercent(s.constructionEngineeringRate)})`, v.constructionEngineering),
    line("Right-of-way", v.rightOfWay),
    line("Utility relocation", v.utilityRelocation),
    `<tr><th scope="row"><strong>Total</strong></th><td${AMOUNT}><strong>${esc(v.total)}</strong></td></tr>`,
    line("Range", v.range),
    budget ? line(`Budget ${budget.budgetText}`, budget.remainingText) : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function summaryPercent(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

function comparison(project: PlanningProject, results: AlternativeResult[]): string {
  const cols = project.alternatives.map((alt) => ({ alt, result: results.find((r) => r.alternativeId === alt.id) }));
  const head = cols
    .map(({ alt }) => `<th scope="col"${AMOUNT}>${esc(alt.name)}${alt.id === project.selectedAlternativeId ? " (selected)" : ""}</th>`)
    .join("");
  const row = (label: string, pick: (v: Record<string, string>, r: AlternativeResult) => string, strong = false) => {
    const cells = cols
      .map(({ result }) => {
        const text = result ? pick(summaryValues(result.summary), result) : "";
        return `<td${AMOUNT}>${strong ? `<strong>${esc(text)}</strong>` : esc(text)}</td>`;
      })
      .join("");
    return `<tr><th scope="row">${strong ? `<strong>${esc(label)}</strong>` : esc(label)}</th>${cells}</tr>`;
  };
  const hasBudget = project.budget !== null;
  const rows = [
    row("Construction", (v) => v.construction),
    row("Contingency", (v) => v.contingency),
    row("Design", (v) => v.design),
    row("Construction engineering", (v) => v.constructionEngineering),
    row("Right-of-way", (v) => v.rightOfWay),
    row("Utility relocation", (v) => v.utilityRelocation),
    row("Total", (v) => v.total, true),
    row("Range", (v) => v.range),
    hasBudget ? row("Budget remaining", (_v, r) => budgetInfo(r.summary)?.remainingText ?? "") : ""
  ].filter(Boolean);
  return `<section class="planning-print-page">
<h2>Alternatives compared</h2>
<table class="summary-table"><thead><tr><th scope="col">Item</th>${head}</tr></thead><tbody>
${rows.join("\n")}
</tbody></table>
</section>`;
}

export function renderPrintSummary(library: ResolvedLibrary, project: PlanningProject, results: AlternativeResult[], printedAt: string): string {
  const alt = project.alternatives.find((a) => a.id === project.selectedAlternativeId) ?? project.alternatives[0];
  const result = results.find((r) => r.alternativeId === alt?.id) ?? results[0];
  const stage = library.stages.find((s) => s.id === project.stageId);
  const date = formatPrintDate(printedAt);
  const { lengthMiles, roadwayWidthFt, intersections } = project.inputs;
  const meta = ["Colorado", stage?.label ?? project.stageId, library.priceBasisLabel, date ? `Printed ${date}` : ""].filter(Boolean).join(" · ");
  const corridor = `Length ${lengthMiles.toFixed(2)} mi · Roadway width ${roadwayWidthFt} ft · ${intersections} ${intersections === 1 ? "intersection" : "intersections"}`;
  const elements = result ? elementRows(library, result) : "";
  const page = result
    ? `<h2>${esc(alt?.name ?? "")}</h2>
<table class="summary-table"><thead><tr><th scope="col">Element</th><th scope="col">Details</th><th scope="col"${AMOUNT}>Amount</th></tr></thead><tbody>
${elements || `<tr><td colspan="3">No elements included.</td></tr>`}
</tbody></table>
<table class="summary-table"><tbody>
${summaryRows(result)}
</tbody></table>`
    : "";
  return `<div class="planning-print">
<section>
<p class="eyebrow">Planning estimate</p>
<h1>${esc(project.name)}</h1>
<p>${esc(meta)}</p>
<p>${esc(corridor)}</p>
${page}
</section>
${project.alternatives.length > 1 ? comparison(project, results) : ""}
<p class="muted">${esc(`Planning-level estimate for comparing alternatives. Not a design estimate. Unit prices: ${library.priceBasisLabel}.`)}</p>
</div>`;
}
