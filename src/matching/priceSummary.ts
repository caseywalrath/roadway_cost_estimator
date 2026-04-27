import type { ComparableMatch, PriceSummary } from "../data/schema";

export function buildPriceSummary(matches: ComparableMatch[], unit: string): PriceSummary | null {
  const prices = matches
    .map((match) => match.observation.unitPrice)
    .filter((price) => Number.isFinite(price) && price > 0)
    .sort((left, right) => left - right);

  if (prices.length === 0) {
    return null;
  }

  return {
    count: prices.length,
    unit,
    low: prices[0],
    p25: quantile(prices, 0.25),
    median: quantile(prices, 0.5),
    p75: quantile(prices, 0.75),
    high: prices[prices.length - 1],
    suggested: quantile(prices, 0.5)
  };
}

function quantile(sortedValues: number[], percentile: number): number {
  if (sortedValues.length === 1) {
    return sortedValues[0];
  }

  const index = (sortedValues.length - 1) * percentile;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const weight = index - lower;

  if (lower === upper) {
    return sortedValues[lower];
  }

  return sortedValues[lower] * (1 - weight) + sortedValues[upper] * weight;
}
