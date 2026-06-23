export type SourceScope = "both" | "public" | "internal";

export type PriceTypeScope = "awarded" | "average" | "engineer" | "all";

export type EvidenceSourceTypeFilter = "public_cost_book" | "public_bid_tab" | "all";

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
  projectNumber: string;
  projectLocationRaw: string;
  contractor: string;
  district: string;
  terrain: string;
  bidCount: number | null;
  awardedBidTotal: number | null;
  awardIndex: number | null;
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

export interface BidderBidRecord {
  bidId: string;
  projectId: string;
  sourceId: string;
  bidderName: string;
  bidTotal: number;
  bidRank: number | null;
  apparentLow: boolean;
}

export interface BidderItemObservationRecord {
  bidderItemObservationId: string;
  bidId: string;
  projectId: string;
  sourceId: string;
  agencyItemCode: string;
  descriptionRaw: string;
  unitRaw: string;
  unitNormalized: string;
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
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
  officialAbbreviatedDescription: string;
  officialUnit: string;
  canonicalItemId: string;
}

export interface SpecSectionRecord {
  sectionPrefix: string;
  divisionPrefix: string;
  divisionTitle: string;
  sectionTitle: string;
  sourceYear: number | null;
  sourceUrl: string;
}

export interface InflationIndexRecord {
  indexId: string;
  indexName: string;
  periodYear: number;
  periodQuarter: number;
  periodLabel: string;
  periodStartDate: string;
  periodEndDate: string;
  indexValue: number;
  sourceUrl: string;
  notes: string;
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
  specSections: SpecSectionRecord[];
  inflationIndexes: InflationIndexRecord[];
  aliases: AliasRecord[];
  bidderBids: BidderBidRecord[];
  bidderItemObservations: BidderItemObservationRecord[];
  sourceById: Map<string, SourceRecord>;
  projectById: Map<string, ProjectRecord>;
  canonicalById: Map<string, CanonicalItemRecord>;
  agencyByCode: Map<string, AgencyItemRecord[]>;
  specSectionByPrefix: Map<string, SpecSectionRecord>;
  specSectionsByDivision: Map<string, SpecSectionRecord[]>;
  inflationIndexByPeriod: Map<string, InflationIndexRecord>;
  bidderBidsByProjectId: Map<string, BidderBidRecord[]>;
  bidderItemsByRowKey: Map<string, BidderItemObservationRecord[]>;
}

export interface SearchQuery {
  state: string;
  countyRegion: string;
  workType: string;
  estimateYear: number;
  sourceScope: SourceScope;
  priceTypeScope: PriceTypeScope;
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

export interface EvidenceFilters {
  sourceType: EvidenceSourceTypeFilter;
  geography: string;
  districts: string[];
  yearMin: number | null;
  yearMax: number | null;
  quantityMin: number | null;
  quantityMax: number | null;
  unit: string;
}

export type EvidenceSortKey =
  | "projectNumber"
  | "projectLocation"
  | "district"
  | "letDate"
  | "contractor"
  | "bidCount"
  | "quantity"
  | "unit"
  | "description"
  | "awardedBidUnitPrice"
  | "averageBidUnitPrice"
  | "engineerEstimateUnitPrice"
  | "source";

export type SortDirection = "asc" | "desc";

export interface EvidenceSort {
  key: EvidenceSortKey;
  direction: SortDirection;
}

export interface EvidenceRow {
  rowId: string;
  project: ProjectRecord | null;
  source: SourceRecord | null;
  itemCode: string;
  descriptionRaw: string;
  unit: string;
  quantity: number;
  dateBasis: string;
  awardedBidUnitPrice: number | null;
  averageBidUnitPrice: number | null;
  engineerEstimateUnitPrice: number | null;
  bidderDetailKey: string;
  hasBidderDetails: boolean;
  observationIds: string[];
}

export interface EvidenceStats {
  count: number;
  low: number;
  p25: number;
  median: number;
  average: number;
  p75: number;
  high: number;
}

export interface EvidenceSummaryStats {
  awarded: EvidenceStats | null;
  average: EvidenceStats | null;
  engineer: EvidenceStats | null;
}

export interface EvidenceResult {
  query: SearchQuery;
  filters: EvidenceFilters;
  sort: EvidenceSort;
  interpretedDescription: string;
  allExactRows: EvidenceRow[];
  filteredRows: EvidenceRow[];
  unitExcludedCount: number;
  availableUnits: string[];
  availableDistricts: string[];
  stats: EvidenceStats | null;
  notes: string[];
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

