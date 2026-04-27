import type { ComparableMatch, MatchResult, PriceSummary } from "../data/schema";

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
        <h2>${escapeHtml(result.interpretedDescription)}</h2>
        <p class="query-line">
          Unit: ${escapeHtml(result.query.unit || "Not entered")} |
          Quantity: ${result.query.quantity ? formatNumber(result.query.quantity) : "Not entered"} |
          State: ${escapeHtml(result.query.state)}
        </p>
      </div>
      <div class="metric-grid">
        <div class="metric">
          <span>Recommended range</span>
          <strong>${range}</strong>
        </div>
        <div class="metric">
          <span>Suggested unit price</span>
          <strong>${suggested}</strong>
        </div>
        <div class="metric">
          <span>Confidence</span>
          <strong class="${confidenceClass(result.confidence)}">${result.confidence}</strong>
        </div>
        <div class="metric">
          <span>Comparable records</span>
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
          <h3>No same-unit price range available</h3>
        </div>
        <p class="muted">Enter a compatible unit or provide more source data before using a price recommendation.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block">
      <div class="panel-heading">
        <p class="eyebrow">Price Distribution</p>
        <h3>Same-unit comparable prices</h3>
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
      <span>${label}</span>
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
          <h3>No comparable records found</h3>
        </div>
        <p class="muted">The demo dataset does not contain a same-state candidate for this search.</p>
      </section>
    `;
  }

  return `
    <section class="panel-block panel-block--table">
      <div class="panel-heading">
        <p class="eyebrow">Comparable Projects</p>
        <h3>Top ${matches.length} ranked records</h3>
      </div>
      <div class="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Project</th>
              <th>Region</th>
              <th>Date</th>
              <th>Item</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit price</th>
              <th>Why selected</th>
              <th>Source</th>
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
          <h3>Review before use</h3>
        </div>
        ${renderList(result.warnings)}
      </div>
      <div class="panel-block">
        <div class="panel-heading">
          <p class="eyebrow">Improve Confidence</p>
          <h3>Next data or review steps</h3>
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
