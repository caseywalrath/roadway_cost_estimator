export type SourceScope = "both" | "public" | "internal";

export type MatchType = "exact_code" | "canonical_alias" | "keyword_fallback";

export type ConfidenceLevel = "High" | "Medium" | "Low" | "Not supportable";

export interface SourceRecord {
  sourceId: string;
  sourceType: string;
  agency: string;
  state: string;
  sourceLabel: string;
  dataYear: number | null;
  notes: string;
}

export interface ProjectRecord {
  projectId: string;
  projectName: string;
  agencyOwner: string;
  state: string;
  countyRegion: string;
  workType: string;
  estimateLetDate: string;
  sourceId: string;
}

export interface ItemObservationRecord {
  observationId: string;
  projectId: string;
  sourceId: string;
  agencyItemCode: string;
  descriptionRaw: string;
  descriptionNormalized: string;
  unitRaw: string;
  unitNormalized: string;
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  discipline: string;
  priceType: string;
  dateBasis: string;
}

export interface CanonicalItemRecord {
  canonicalItemId: string;
  itemFamily: string;
  canonicalDescription: string;
  discipline: string;
  typicalUnits: string[];
  keywordsInclude: string[];
  keywordsExclude: string[];
}

export interface AgencyItemRecord {
  agencyItemId: string;
  state: string;
  agency: string;
  itemCode: string;
  officialDescription: string;
  officialUnit: string;
  canonicalItemId: string;
}

export interface AliasRecord {
  aliasId: string;
  state: string;
  agency: string;
  rawDescriptionPattern: string;
  canonicalItemId: string;
  matchType: string;
  confidence: string;
  notes: string;
}

export interface AppData {
  sources: SourceRecord[];
  projects: ProjectRecord[];
  observations: ItemObservationRecord[];
  canonicalItems: CanonicalItemRecord[];
  agencyItems: AgencyItemRecord[];
  aliases: AliasRecord[];
  sourceById: Map<string, SourceRecord>;
  projectById: Map<string, ProjectRecord>;
  canonicalById: Map<string, CanonicalItemRecord>;
  agencyByCode: Map<string, AgencyItemRecord[]>;
}

export interface SearchQuery {
  state: string;
  countyRegion: string;
  workType: string;
  estimateYear: number;
  sourceScope: SourceScope;
  itemCode: string;
  description: string;
  unit: string;
  quantity: number | null;
}

export interface ScoreReason {
  label: string;
  points: number;
}

export interface ComparableMatch {
  observation: ItemObservationRecord;
  project: ProjectRecord | null;
  source: SourceRecord | null;
  canonicalItem: CanonicalItemRecord | null;
  score: number;
  matchType: MatchType;
  reasons: ScoreReason[];
}

export interface PriceSummary {
  count: number;
  unit: string;
  low: number;
  p25: number;
  median: number;
  p75: number;
  high: number;
  suggested: number;
}

export interface MatchResult {
  query: SearchQuery;
  interpretedDescription: string;
  allCandidateMatches: ComparableMatch[];
  comparableMatches: ComparableMatch[];
  excludedUnitMatches: ComparableMatch[];
  priceSummary: PriceSummary | null;
  confidence: ConfidenceLevel;
  warnings: string[];
  improveActions: string[];
}

