import type { ComparableMatch, ConfidenceLevel, PriceSummary, SearchQuery } from "../data/schema";

export function determineConfidence(
  query: SearchQuery,
  matches: ComparableMatch[],
  priceSummary: PriceSummary | null
): ConfidenceLevel {
  if (!query.unit.trim() || !priceSummary || matches.length === 0) {
    return "Not supportable";
  }

  const exactCodeMatches = matches.filter((match) => match.matchType === "exact_code").length;
  const strongMatches = matches.filter((match) => match.score >= 78).length;
  const hasRecentMatch = matches.some((match) => {
    const year = getYear(match.project?.estimateLetDate || match.observation.dateBasis);
    return year !== null && Math.abs(query.estimateYear - year) <= 5;
  });

  if (priceSummary.count >= 5 && exactCodeMatches >= 3 && strongMatches >= 3 && hasRecentMatch) {
    return "High";
  }

  if (priceSummary.count >= 3 && (exactCodeMatches >= 1 || strongMatches >= 2)) {
    return "Medium";
  }

  if (priceSummary.count >= 1) {
    return "Low";
  }

  return "Not supportable";
}

function getYear(value: string): number | null {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}
