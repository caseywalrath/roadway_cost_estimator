import type {
  AppData,
  BidderBidRecord,
  BidderItemObservationRecord,
  BidTabItemRecord
} from "../data/schema";

export function renderSourceReview(data: AppData, selectedProjectId: string | null): string {
  return selectedProjectId
    ? renderSourceProjectDetail(data, selectedProjectId)
    : renderSourceProjectList(data);
}

function renderSourceProjectList(data: AppData): string {
  const projects = data.projects
    .filter((project) => ["bid_tab", "estimate"].includes(data.sourceById.get(project.sourceId)?.sourceType ?? ""))
    .filter((project) => (data.bidTabItemsByProjectId.get(project.projectId) ?? []).length > 0)
    .sort((left, right) => (right.estimateLetDate || "").localeCompare(left.estimateLetDate || ""));

  return `
    <section class="source-review-view" aria-labelledby="source-review-title">
      <div class="source-review-heading">
        <div>
          <p class="eyebrow">Source Review</p>
          <h2 id="source-review-title" tabindex="-1">Review source projects</h2>
          <p class="muted">Inspect bid tabs, engineer estimates, and source item mappings for ${escapeHtml(data.stateConfig.name)}.</p>
        </div>
        <button type="button" class="secondary-button" data-close-source-review>Back to Explorer</button>
      </div>
      ${projects.length === 0
        ? `<p class="muted">No reviewable source projects are available for this state.</p>`
        : `
          <div class="bid-tab-project-list">
            ${projects.map((project) => {
              const source = data.sourceById.get(project.sourceId) ?? null;
              const itemCount = data.bidTabItemsByProjectId.get(project.projectId)?.length ?? 0;
              const sourceLabel = source?.sourceLabel.split(" - ")[0] ?? "Bid tab source";
              const projectTitle = [
                project.projectName,
                project.projectNumber,
                project.estimateLetDate
              ].filter(Boolean).join(" - ");

              return `
                <article class="bid-tab-project-row">
                  <div>
                    <strong>${escapeHtml(projectTitle)}</strong>
                    <small>${escapeHtml(sourceLabel)}</small>
                  </div>
                  <div class="bid-tab-project-meta">
                    <span>${formatNumber(itemCount)} source items</span>
                  </div>
                  <button
                    type="button"
                    class="secondary-button bid-tab-open-button"
                    data-bid-tab-project-id="${escapeHtml(project.projectId)}"
                  >
                    Review
                  </button>
                </article>
              `;
            }).join("")}
          </div>
        `}
    </section>
  `;
}

function renderSourceProjectDetail(data: AppData, selectedProjectId: string): string {
  const project = data.projectById.get(selectedProjectId) ?? null;
  const source = project ? data.sourceById.get(project.sourceId) ?? null : null;
  const items = project ? data.bidTabItemsByProjectId.get(project.projectId) ?? [] : [];

  if (!project || items.length === 0) {
    return renderSourceProjectList(data);
  }

  const bidderBids = data.bidderBidsByProjectId.get(project.projectId) ?? [];
  const bidById = new Map(bidderBids.map((bid) => [bid.bidId, bid]));
  const apparentLowBid = bidderBids.find((bid) => bid.apparentLow) ?? null;
  const awardedBid = bidderBids.find((bid) => bid.isAwarded) ?? null;

  return `
    <section class="source-review-view source-review-detail" aria-labelledby="source-review-detail-title">
      <div class="source-review-toolbar">
        <button type="button" class="secondary-button" data-back-to-source-list>Back to source list</button>
        <button type="button" class="secondary-button" data-close-source-review>Back to Explorer</button>
      </div>
      <div class="source-review-detail-heading">
        <p class="eyebrow">${source?.sourceType === "estimate" ? "FHU Engineer Estimate Detail" : "Public Bid Tab Detail"}</p>
        <h2 id="source-review-detail-title" tabindex="-1">${escapeHtml(project.projectNumber || "Project")} - ${escapeHtml(project.projectName)}</h2>
        <p class="query-line">${escapeHtml(source?.sourceLabel ?? "Unknown source")}</p>
      </div>
      <div class="bidder-modal__summary">
        <span>Apparent low: <strong>${escapeHtml(apparentLowBid?.bidderName ?? "Not listed")}</strong></span>
        <span>Confirmed award: <strong>${escapeHtml(awardedBid?.bidderName ?? "Not listed")}</strong></span>
        <span>Bid count: <strong>${formatNumber(bidderBids.length)}</strong></span>
        <span>Source items: <strong>${formatNumber(items.length)}</strong></span>
      </div>
      <div class="table-scroll source-review-table-scroll">
        <table class="bid-tab-detail-table">
          <thead>
            <tr>
              <th>No.</th>
              <th>Source code</th>
              <th>Description</th>
              <th>Qty</th>
              <th>Unit</th>
              ${data.stateConfig.capabilities.engineerEstimate ? "<th>Engineer</th>" : ""}
              <th>Average</th>
              <th>Status</th>
              <th>Bidder unit prices</th>
            </tr>
          </thead>
          <tbody>
            ${items
              .slice()
              .sort((left, right) => left.workbookRow - right.workbookRow)
              .map((item) => renderBidTabItemRow(
                item,
                data.bidderItemsByBidTabItemId.get(item.bidTabItemId) ?? [],
                bidById,
                data.stateConfig.capabilities.engineerEstimate
              ))
              .join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderBidTabItemRow(
  item: BidTabItemRecord,
  bidderItems: BidderItemObservationRecord[],
  bidById: Map<string, BidderBidRecord>,
  supportsEngineerEstimate: boolean
): string {
  const codeLabel = item.sourceSpecRaw || item.sourceItemCode;
  const bidderPrices = bidderItems
    .slice()
    .sort((left, right) => compareBidderItems(left, right, bidById))
    .map((bidderItem) => {
      const bid = bidById.get(bidderItem.bidId) ?? null;
      const apparentLowText = bid?.apparentLow ? " (low)" : "";
      return `${bid?.bidderName ?? bidderItem.bidId}${apparentLowText}: ${formatCurrency(bidderItem.unitPrice)}`;
    });

  return `
    <tr>
      <td>${escapeHtml(item.sourceItemNumber || String(item.workbookRow))}</td>
      <td>
        ${escapeHtml(codeLabel)}
        ${item.matchedAgencyItemCode ? `<div class="row-subtext">Matched: ${escapeHtml(item.matchedAgencyItemCode)}</div>` : ""}
      </td>
      <td>${escapeHtml(item.sourceItemDescription)}</td>
      <td>${formatNumber(item.quantity)}</td>
      <td>${escapeHtml(item.unitNormalized)}</td>
      ${supportsEngineerEstimate ? `<td>${formatCurrency(item.engineerEstimateUnitPrice)}</td>` : ""}
      <td>${formatCurrency(item.averageBidUnitPrice)}</td>
      <td>${escapeHtml(matchStatusLabel(item.matchStatus))}</td>
      <td>${bidderPrices.length > 0 ? escapeHtml(bidderPrices.join("; ")) : "Not listed"}</td>
    </tr>
  `;
}

function compareBidderItems(
  left: BidderItemObservationRecord,
  right: BidderItemObservationRecord,
  bidById: Map<string, BidderBidRecord>
): number {
  const leftRank = bidById.get(left.bidId)?.bidRank ?? Number.MAX_SAFE_INTEGER;
  const rightRank = bidById.get(right.bidId)?.bidRank ?? Number.MAX_SAFE_INTEGER;

  if (leftRank !== rightRank) {
    return leftRank - rightRank;
  }

  return left.bidId.localeCompare(right.bidId);
}

function matchStatusLabel(status: BidTabItemRecord["matchStatus"]): string {
  const labels: Record<BidTabItemRecord["matchStatus"], string> = {
    matched: "Matched",
    unmatched: "Unmatched",
    source_cdot_prefix_only: "CDOT prefix only"
  };

  return labels[status];
}

function formatCurrency(value: number | null): string {
  if (value === null) {
    return "Not listed";
  }
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
