import type {
  AppData,
  ComparableMatch,
  ItemObservationRecord,
  MatchResult,
  MatchType,
  ProjectRecord,
  ScoreReason,
  SearchQuery,
  SourceRecord
} from "../data/schema";
import {
  keywordMatches,
  normalizeDescription,
  normalizeUnit,
  similarityScore
} from "./normalizeDescription";
import { buildPriceSummary } from "./priceSummary";
import { determineConfidence } from "./confidence";

interface MatchCandidate {
  canonicalItemId: string | null;
  matchType: MatchType;
  basePoints: number;
  reason: string;
}

export function scoreComparableItems(data: AppData, rawQuery: SearchQuery): MatchResult {
  const query = normalizeQuery(data, rawQuery);
  const queryCanonicalCandidates = findCanonicalCandidates(data, query);
  const warnings: string[] = [];
  const matches: ComparableMatch[] = [];

  if (!query.itemCode && !query.description) {
    return emptyResult(query, "Enter an item code or description to search.", [
      "Enter a CDOT item code when known.",
      "Enter a bid item description if the item code is not known.",
      "Enter a unit before using a price recommendation."
    ]);
  }

  for (const observation of data.observations) {
    const project = data.projectById.get(observation.projectId) ?? null;
    const source = data.sourceById.get(observation.sourceId) ?? null;

    if (!project || project.state !== query.state) {
      continue;
    }

    if (!sourceAllowed(source, query.sourceScope)) {
      continue;
    }

    const candidate = classifyObservation(data, query, queryCanonicalCandidates, observation.agencyItemCode, observation.descriptionNormalized);

    if (!candidate) {
      continue;
    }

    matches.push(scoreObservation(data, query, observation, project, source, candidate));
  }

  const sortedMatches = matches.sort((left, right) => right.score - left.score);
  const sameUnitMatches = query.unit
    ? sortedMatches.filter((match) => match.observation.unitNormalized === query.unit)
    : [];
  const excludedUnitMatches = query.unit
    ? sortedMatches.filter((match) => match.observation.unitNormalized !== query.unit)
    : sortedMatches;
  const comparableMatches = (query.unit ? sameUnitMatches : sortedMatches).slice(0, 5);
  const priceMatches = query.unit ? sameUnitMatches : [];
  const priceSummary = buildPriceSummary(priceMatches, query.unit);
  const confidence = determineConfidence(query, comparableMatches, priceSummary);
  const interpretedDescription = resolveInterpretedDescription(data, query, queryCanonicalCandidates);

  if (!query.unit) {
    warnings.push("Unit is required before the tool can support a unit-price recommendation.");
  }

  if (query.unit && sameUnitMatches.length === 0 && sortedMatches.length > 0) {
    warnings.push("Candidate items were found, but none use the requested unit. Do not use these prices without a unit conversion approved by a roadway reviewer.");
  }

  if (query.unit && excludedUnitMatches.length > 0) {
    warnings.push(`${excludedUnitMatches.length} candidate record(s) were excluded because the unit did not match ${query.unit}.`);
  }

  if (priceSummary && priceSummary.count < 3) {
    warnings.push("Fewer than three same-unit comparable records are available in the demo dataset.");
  }

  if (confidence === "Low") {
    warnings.push("Comparable support is weak. Treat the range as context, not a recommended price.");
  }

  return {
    query,
    interpretedDescription,
    allCandidateMatches: sortedMatches,
    comparableMatches,
    excludedUnitMatches,
    priceSummary,
    confidence,
    warnings,
    improveActions: buildImproveActions(query, sortedMatches, sameUnitMatches, confidence)
  };
}

function normalizeQuery(data: AppData, query: SearchQuery): SearchQuery {
  const state = query.state.trim().toUpperCase() || "CO";
  const itemCode = query.itemCode.trim().toUpperCase();
  const resolvedAgencyItem = itemCode
    ? (data.agencyByCode.get(itemCode) ?? []).find((item) => item.state === state)
    : null;

  return {
    ...query,
    state,
    countyRegion: query.countyRegion.trim(),
    workType: query.workType.trim() || "Roadway",
    itemCode,
    description: resolvedAgencyItem?.officialDescription || query.description.trim(),
    unit: resolvedAgencyItem?.officialUnit
      ? normalizeUnit(resolvedAgencyItem.officialUnit)
      : normalizeUnit(query.unit),
    quantity: query.quantity && query.quantity > 0 ? query.quantity : null
  };
}

function findCanonicalCandidates(data: AppData, query: SearchQuery): MatchCandidate[] {
  const candidates: MatchCandidate[] = [];
  const normalizedDescription = normalizeDescription(query.description);

  if (query.itemCode) {
    const agencyItems = data.agencyByCode.get(query.itemCode) ?? [];
    for (const agencyItem of agencyItems) {
      if (agencyItem.state === query.state) {
        candidates.push({
          canonicalItemId: agencyItem.canonicalItemId,
          matchType: "exact_code",
          basePoints: 50,
          reason: "Same agency item code"
        });
      }
    }
  }

  if (normalizedDescription) {
    for (const alias of data.aliases) {
      if (alias.state !== query.state) {
        continue;
      }

      if (normalizedDescription.includes(alias.rawDescriptionPattern)) {
        candidates.push({
          canonicalItemId: alias.canonicalItemId,
          matchType: "canonical_alias",
          basePoints: 36,
          reason: "Approved alias or description mapping"
        });
      }
    }

    for (const canonicalItem of data.canonicalItems) {
      if (keywordMatches(normalizedDescription, canonicalItem.keywordsInclude, canonicalItem.keywordsExclude)) {
        candidates.push({
          canonicalItemId: canonicalItem.canonicalItemId,
          matchType: "keyword_fallback",
          basePoints: 24,
          reason: "Keyword fallback match"
        });
      }
    }
  }

  return dedupeCandidates(candidates);
}

function classifyObservation(
  data: AppData,
  query: SearchQuery,
  candidates: MatchCandidate[],
  observationItemCode: string,
  observationDescription: string
): MatchCandidate | null {
  if (query.itemCode && observationItemCode === query.itemCode) {
    const agencyItem = (data.agencyByCode.get(query.itemCode) ?? [])[0];
    return {
      canonicalItemId: agencyItem?.canonicalItemId ?? null,
      matchType: "exact_code",
      basePoints: 50,
      reason: "Same agency item code"
    };
  }

  for (const candidate of candidates) {
    if (!candidate.canonicalItemId) {
      continue;
    }

    const canonicalItem = data.canonicalById.get(candidate.canonicalItemId);
    if (!canonicalItem) {
      continue;
    }

    if (keywordMatches(observationDescription, canonicalItem.keywordsInclude, canonicalItem.keywordsExclude)) {
      return candidate;
    }
  }

  if (query.description && similarityScore(query.description, observationDescription) >= 0.45) {
    return {
      canonicalItemId: null,
      matchType: "keyword_fallback",
      basePoints: 18,
      reason: "Description token fallback"
    };
  }

  return null;
}

function scoreObservation(
  data: AppData,
  query: SearchQuery,
  observation: ItemObservationRecord,
  project: ProjectRecord,
  source: SourceRecord | null,
  candidate: MatchCandidate
): ComparableMatch {
  const reasons: ScoreReason[] = [{ label: candidate.reason, points: candidate.basePoints }];
  let score = candidate.basePoints;

  if (query.unit && observation.unitNormalized === query.unit) {
    score += 20;
    reasons.push({ label: `Same unit: ${query.unit}`, points: 20 });
  } else if (query.unit) {
    score -= 30;
    reasons.push({ label: `Different unit: ${observation.unitNormalized}`, points: -30 });
  }

  if (query.quantity && observation.quantity > 0) {
    const ratio = Math.max(query.quantity, observation.quantity) / Math.min(query.quantity, observation.quantity);
    if (ratio <= 1.5) {
      score += 12;
      reasons.push({ label: "Very similar quantity", points: 12 });
    } else if (ratio <= 3) {
      score += 8;
      reasons.push({ label: "Similar quantity band", points: 8 });
    } else if (ratio <= 6) {
      score += 3;
      reasons.push({ label: "Broad quantity comparison", points: 3 });
    } else {
      reasons.push({ label: "Distant quantity comparison", points: 0 });
    }
  }

  if (query.countyRegion && normalizeDescription(project.countyRegion).includes(normalizeDescription(query.countyRegion))) {
    score += 8;
    reasons.push({ label: "Same county or region", points: 8 });
  }

  if (normalizeDescription(project.workType).includes(normalizeDescription(query.workType))) {
    score += 5;
    reasons.push({ label: "Same work type", points: 5 });
  }

  const recordYear = getYear(project.estimateLetDate || observation.dateBasis);
  if (recordYear !== null) {
    const yearGap = Math.abs(query.estimateYear - recordYear);
    if (yearGap <= 2) {
      score += 8;
      reasons.push({ label: "Recent record", points: 8 });
    } else if (yearGap <= 5) {
      score += 5;
      reasons.push({ label: "Moderately recent record", points: 5 });
    } else if (yearGap <= 10) {
      score += 2;
      reasons.push({ label: "Older but usable record", points: 2 });
    }
  }

  if (source?.state === query.state) {
    score += 4;
    reasons.push({ label: "Colorado source", points: 4 });
  }

  return {
    observation,
    project,
    source,
    canonicalItem: candidate.canonicalItemId ? data.canonicalById.get(candidate.canonicalItemId) ?? null : null,
    score,
    matchType: candidate.matchType,
    reasons
  };
}

function sourceAllowed(source: SourceRecord | null, sourceScope: string): boolean {
  if (!source || sourceScope === "both") {
    return true;
  }

  const sourceType = source.sourceType.toLowerCase();
  if (sourceScope === "public") {
    return sourceType.includes("public");
  }

  if (sourceScope === "internal") {
    return sourceType.includes("internal");
  }

  return true;
}

function resolveInterpretedDescription(
  data: AppData,
  query: SearchQuery,
  candidates: MatchCandidate[]
): string {
  if (query.itemCode) {
    const agencyItem = (data.agencyByCode.get(query.itemCode) ?? []).find(
      (item) => item.state === query.state
    );
    if (agencyItem) {
      return agencyItem.officialDescription;
    }
  }

  const firstCanonical = candidates.find((candidate) => candidate.canonicalItemId);
  if (firstCanonical?.canonicalItemId) {
    return data.canonicalById.get(firstCanonical.canonicalItemId)?.canonicalDescription ?? query.description;
  }

  return query.description || "No interpreted item yet";
}

function buildImproveActions(
  query: SearchQuery,
  allMatches: ComparableMatch[],
  sameUnitMatches: ComparableMatch[],
  confidence: string
): string[] {
  const actions: string[] = [];

  if (!query.itemCode) {
    actions.push("Confirm the CDOT item code if one exists.");
  }

  if (!query.unit) {
    actions.push("Enter the intended unit before using a unit-price range.");
  }

  if (!query.countyRegion) {
    actions.push("Use the project relevance controls if geography should influence ranking.");
  }

  if (!query.quantity) {
    actions.push("Add a quantity so the tool can compare scale.");
  }

  if (allMatches.length > 0 && sameUnitMatches.length === 0) {
    actions.push("Confirm unit compatibility or provide an approved conversion rule.");
  }

  if (confidence === "Low" || confidence === "Not supportable") {
    actions.push("Provide a comparable Colorado roadway estimate or bid tab with this item.");
    actions.push("Ask a roadway reviewer to approve or reject the candidate item mapping.");
  }

  if (actions.length === 0) {
    actions.push("Review the top comparable projects and confirm the selected range fits project context.");
  }

  return actions;
}

function emptyResult(query: SearchQuery, warning: string, improveActions: string[]): MatchResult {
  return {
    query,
    interpretedDescription: "No interpreted item yet",
    allCandidateMatches: [],
    comparableMatches: [],
    excludedUnitMatches: [],
    priceSummary: null,
    confidence: "Not supportable",
    warnings: [warning],
    improveActions
  };
}

function dedupeCandidates(candidates: MatchCandidate[]): MatchCandidate[] {
  const bestByKey = new Map<string, MatchCandidate>();

  for (const candidate of candidates) {
    const key = `${candidate.canonicalItemId ?? "none"}:${candidate.matchType}`;
    const existing = bestByKey.get(key);
    if (!existing || candidate.basePoints > existing.basePoints) {
      bestByKey.set(key, candidate);
    }
  }

  return [...bestByKey.values()].sort((left, right) => right.basePoints - left.basePoints);
}

function getYear(value: string): number | null {
  const match = value.match(/\d{4}/);
  return match ? Number(match[0]) : null;
}
