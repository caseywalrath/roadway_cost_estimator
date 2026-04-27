import type { ComparableMatch, MatchResult, PriceSummary } from "../data/schema";
import { helpTip } from "./helpTip";

export function renderResults(result: MatchResult): string {
  return `
    <section class="results-panel">
      ${renderRecommendation(result)}
      ${renderDistribution(result.priceSummary)}
      ${renderComparableTable(result.comparableMatches)}
      ${renderWarnings(result)}
    </section>
  `;
}

function renderRecommendation(result: MatchResult): string {
  const priceSummary = result.priceSummary;
  const range = priceSummary
    ? `${formatCurrency(priceSummary.low)}-${formatCurrency(priceSummary.high)} / ${priceSummary.unit}`
    : "Not supportable";
  const suggested = priceSummary
    ? `${formatCurrency(priceSummary.suggested)} / ${priceSummary.unit}`
    : "No suggested price";

  return `
    <section class="decision-card">
      <div>
        <p class="eyebrow">Recommendation Summary</p>
        <h2>
          ${escapeHtml(result.interpretedDescription)}
          ${helpTip("About interpreted item", "The item name the tool thinks it is evaluating. It comes from the agency item table when an item code is recognized, otherwise from canonical aliases or the entered description.")}
        </h2>
        <p class="query-line">
          Unit: ${escapeHtml(result.query.unit || "Not entered")} |
          Quantity: ${result.query.quantity ? formatNumber(result.query.quantity) : "Not entered"} |
          State: ${escapeHtml(result.query.state)}
        </p>
      </div>
      <div class="metric-grid">
        <div class="metric">
          <span class="label-row">
            Recommended range
            ${helpTip("About recommended range", "Low to high unit prices from same-unit comparable records. This is evidence context, not an automatic estimate. Source: matched item observations in the CSV data package.")}
          </span>
          <strong>${range}</strong>
        </div>
        <div class="metric">
          <span class="label-row">
            Suggested unit price
            ${helpTip("About suggested unit price", "Prototype suggestion based on the median of same-unit comparable records. It is chosen because median is simple, visible, and less sensitive to extreme values than an average.")}
          </span>
          <strong>${suggested}</strong>
        </div>
        <div class="metric">
          <span class="label-row">
            Confidence
            ${helpTip("About confidence", "A plain-language rating from deterministic rules. High requires enough same-unit, recent, strong matches. Low or Not supportable means the app should explain what data is missing instead of guessing.")}
          </span>
          <strong class="${confidenceClass(result.confidence)}">${result.confidence}</strong>
        </div>
        <div class="metric">
          <span class="label-row">
            Comparable records
            ${helpTip("About comparable records", "Number of same-unit records used in the price summary. A small count does not make the record useless, but it should trigger more review.")}
          </span>
          <strong>${result.priceSummary?.count ?? 0}</strong>
        </div>
      </div>
    </section>
  `;
}

function renderDistribution(priceSummary: PriceSummary | null): string {
  if (!priceSummary) {
    return `
      <section class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Price Distribution</p>
          <h3>
            No same-unit price range available
            ${helpTip("About missing price distribution", "The app found no compatible same-unit prices. The likely causes are a unit mismatch, missing source data, or an item description that does not map to the demo catalog.")}
          </h3>
        </div>
        <p class="muted">Enter a compatible unit or provide more source data before using a price recommendation.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block">
      <div class="panel-heading">
        <p class="eyebrow">Price Distribution</p>
        <h3>
          Same-unit comparable prices
          ${helpTip("About price distribution", "Shows the spread of matched unit prices. Percentiles are included so reviewers can see whether the suggestion sits inside a broader evidence range.")}
        </h3>
      </div>
      <div class="distribution-grid">
        ${renderDistributionMetric("Low", priceSummary.low, priceSummary.unit)}
        ${renderDistributionMetric("P25", priceSummary.p25, priceSummary.unit)}
        ${renderDistributionMetric("Median", priceSummary.median, priceSummary.unit)}
        ${renderDistributionMetric("P75", priceSummary.p75, priceSummary.unit)}
        ${renderDistributionMetric("High", priceSummary.high, priceSummary.unit)}
      </div>
    </section>
  `;
}

function renderDistributionMetric(label: string, value: number, unit: string): string {
  return `
    <div class="distribution-metric">
      <span class="label-row">
        ${label}
        ${helpTip(`About ${label}`, distributionHelp(label))}
      </span>
      <strong>${formatCurrency(value)}</strong>
      <small>/${escapeHtml(unit)}</small>
    </div>
  `;
}

function renderComparableTable(matches: ComparableMatch[]): string {
  if (matches.length === 0) {
    return `
      <section class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Comparable Projects</p>
          <h3>
            No comparable records found
            ${helpTip("About no comparable records", "No candidate in the demo data met the state and item matching rules. In real review this is a cue to provide more source data or ask a roadway reviewer to approve a mapping.")}
          </h3>
        </div>
        <p class="muted">The demo dataset does not contain a same-state candidate for this search.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block panel-block--table">
      <div class="panel-heading">
        <p class="eyebrow">Comparable Projects</p>
        <h3>
          Top ${matches.length} ranked records
          ${helpTip("About ranked records", "The table shows the strongest historical item observations found by the scoring rules. It is intended to support reviewer judgment, not replace it.")}
        </h3>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rank ${helpTip("About rank", "Order after scoring. Higher-ranked records better match item code, unit, quantity, recency, geography, and work type.")}</th>
              <th>Project ${helpTip("About project", "Comparable project name. Source: project metadata table loaded from the CSV data package.")}</th>
              <th>Region ${helpTip("About region", "County or market area for the historical record. Used to favor geographically relevant examples.")}</th>
              <th>Date ${helpTip("About date", "Estimate or let date for the record. Recent projects receive more score because pricing conditions change over time.")}</th>
              <th>Item ${helpTip("About item", "Agency item code on the historical record. Exact item-code matches are ranked above alias or keyword matches.")}</th>
              <th>Description ${helpTip("About comparable description", "Raw item description from the historical source row. Kept visible so engineers can check whether the match is truly similar.")}</th>
              <th>Qty ${helpTip("About comparable quantity", "Historical quantity. Similar quantity bands are ranked higher because very small or very large work quantities may price differently.")}</th>
              <th>Unit ${helpTip("About comparable unit", "Historical unit. Same-unit records are required for the price summary.")}</th>
              <th>Unit price ${helpTip("About comparable unit price", "Historical unit cost from the source record. Demo data is synthetic; real data would come from bid tabs, cost books, or reviewed FHU estimates.")}</th>
              <th>Why selected ${helpTip("About why selected", "Human-readable reasons generated from scoring rules. These should help roadway engineers agree, reject, or tune the match logic.")}</th>
              <th>Source ${helpTip("About source", "Source label for provenance. Real implementation should distinguish public CDOT data, FHU estimates, bid tabs, and post-award data.")}</th>
            </tr>
          </thead>
          <tbody>
            ${matches.map(renderComparableRow).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderComparableRow(match: ComparableMatch, index: number): string {
  const reasons = match.reasons
    .filter((reason) => reason.points > 0)
    .slice(0, 5)
    .map((reason) => reason.label)
    .join("; ");

  return `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(match.project?.projectName ?? "Unknown project")}</td>
      <td>${escapeHtml(match.project?.countyRegion ?? "Unknown")}</td>
      <td>${escapeHtml(match.project?.estimateLetDate ?? match.observation.dateBasis)}</td>
      <td>${escapeHtml(match.observation.agencyItemCode)}</td>
      <td>${escapeHtml(match.observation.descriptionRaw)}</td>
      <td>${formatNumber(match.observation.quantity)}</td>
      <td>${escapeHtml(match.observation.unitNormalized)}</td>
      <td>${formatCurrency(match.observation.unitPrice)}</td>
      <td>${escapeHtml(reasons)}</td>
      <td>${escapeHtml(match.source?.sourceLabel ?? "Unknown source")}</td>
    </tr>
  `;
}

function renderWarnings(result: MatchResult): string {
  return `
    <section class="guidance-grid">
      <div class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Warnings</p>
          <h3>
            Review before use
            ${helpTip("About warnings", "Warnings identify reasons not to over-trust the output, such as sparse data, unit mismatch, or weak support. They are written for reviewer triage.")}
          </h3>
        </div>
        ${renderList(result.warnings)}
      </div>
      <div class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Improve Confidence</p>
          <h3>
            Next data or review steps
            ${helpTip("About improve confidence", "Specific actions that would make the result more defensible, such as confirming the item code, adding a comparable bid tab, or asking an engineer to approve a mapping.")}
          </h3>
        </div>
        ${renderList(result.improveActions)}
      </div>
    </section>
  `;
}

function renderList(items: string[]): string {
  if (items.length === 0) {
    return `<p class="muted">No issues identified in this demo search.</p>`;
  }

  return `
    <ul class="guidance-list">
      ${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}
    </ul>
  `;
}

function confidenceClass(confidence: string): string {
  return `confidence confidence--${confidence.toLowerCase().replace(/\s+/g, "-")}`;
}

function distributionHelp(label: string): string {
  const descriptions: Record<string, string> = {
    Low: "Lowest same-unit price in the matched comparable records. It may be an outlier and should not be used alone.",
    P25: "25th percentile. About one quarter of matched records are at or below this value.",
    Median: "Middle value of the matched records. The prototype uses this as the suggested unit price.",
    P75: "75th percentile. About three quarters of matched records are at or below this value.",
    High: "Highest same-unit price in the matched comparable records. It may reflect unusual scope, market conditions, or an outlier."
  };

  return descriptions[label] ?? "Price distribution marker from the matched comparable records.";
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 100 ? 0 : 2
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2
  }).format(value);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    };

    return replacements[char];
  });
}
