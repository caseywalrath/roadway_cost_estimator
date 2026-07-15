export type SourceScope = "both" | "public" | "internal";
export type PriceTypeScope = "awarded" | "average" | "engineer" | "all";
export type EvidenceSourceTypeFilter = string;
export type MatchType = "exact_code" | "canonical_alias" | "keyword_fallback";
export type ConfidenceLevel = "High" | "Medium" | "Low" | "Not supportable";

export interface StateCapabilities {
  districtFilter: boolean;
  engineerEstimate: boolean;
  bidderDetail: boolean;
}

export interface StateDataFiles {
  sources: string;
  lettings: string;
  contracts: string;
  contractProjects: string;
  contractItems: string;
  bids: string;
  bidItemPrices?: string;
  agencyItems: string;
  agencyItemVersions: string;
  itemTaxonomy: string;
  itemMappings: string;
  observations: string;
  canonicalItems?: string;
  aliases?: string;
}

export interface StateConfig {
  code: string;
  name: string;
  defaultAgencyId: string;
  defaultAgencyName: string;
  divisionLabel: string;
  sectionLabel: string;
  sectionPrefixLength: number;
  capabilities: StateCapabilities;
  sourceTypeLabels: Record<string, string>;
  files: StateDataFiles;
}

export interface AppManifest {
  schemaVersion: number;
  productTitle: string;
  common: { inflationIndexes: string };
  states: StateConfig[];
}

export interface SourceRecord {
  sourceId: string;
  sourceType: string;
  agencyId: string;
  agencyName: string;
  state: string;
  sourceLabel: string;
  sourceDate: string;
  dataYear: number | null;
  sourceUrl: string;
  sourceFileName: string;
  sha256: string;
  parserName: string;
  parserVersion: string;
  notes: string;
  /** Compatibility display alias for older rendering helpers. */
  agency: string;
}

export interface LettingRecord {
  lettingId: string;
  sourceId: string;
  state: string;
  agencyId: string;
  lettingDate: string;
  lettingLabel: string;
}

export interface ContractRecord {
  contractId: string;
  lettingId: string;
  sourceId: string;
  state: string;
  agencyId: string;
  officialContractId: string;
  callOrder: string;
  lettingStatus: string;
  awardedVendor: string;
  awardedAmount: number | null;
  primaryCounty: string;
  route: string;
  workType: string;
  contractPeriod: string;
  dbeGoal: string;
  bidCount: number | null;
  location: string;
  district: string;
  terrain: string;
  awardIndex: number | null;
  /** Compatibility aliases retained only while legacy UI modules are migrated. */
  projectId: string;
  projectName: string;
  agencyOwner: string;
  countyRegion: string;
  estimateLetDate: string;
  projectNumber: string;
  projectLocationRaw: string;
  contractor: string;
  awardedBidTotal: number | null;
}

export type ProjectRecord = ContractRecord;

export interface ContractProjectRecord {
  contractProjectId: string;
  contractId: string;
  projectNumber: string;
  projectName: string;
  workType: string;
  countyRegion: string;
  route: string;
  location: string;
  projectAwardAmount: number | null;
}

export interface ItemObservationRecord {
  observationId: string;
  contractId: string;
  sourceId: string;
  agencyItemId: string;
  agencyItemCode: string;
  descriptionRaw: string;
  descriptionNormalized: string;
  unitRaw: string;
  unitNormalized: string;
  quantity: number;
  unitPrice: number;
  extendedPrice: number;
  discipline: string;
  priceType: "awarded_bid" | "average_bid" | "engineer_estimate" | string;
  dateBasis: string;
  derivationMethod: string;
  derivationInputCount: number | null;
  projectId: string;
}

export interface BidRecord {
  bidId: string;
  contractId: string;
  sourceId: string;
  sourceVendorId: string;
  bidderName: string;
  bidRank: number | null;
  bidTotal: number;
  percentOfLow: number | null;
  isApparentLow: boolean;
  isAwarded: boolean;
  sourcePage: number | null;
  projectId: string;
  apparentLow: boolean;
}

export type BidderBidRecord = BidRecord;

export interface ContractItemRecord {
  contractItemId: string;
  contractId: string;
  sourceId: string;
  sectionNumber: string;
  sectionTitle: string;
  lineNumber: string;
  sourceItemCode: string;
  agencyItemId: string;
  descriptionRaw: string;
  quantity: number;
  unitRaw: string;
  unitNormalized: string;
  alternateSet: string;
  alternateMember: string;
  mappingStatus: string;
  sourcePage: number | null;
  sourceLocator: string;
  bidTabItemId: string;
  projectId: string;
  sourceFile: string;
  sheetName: string;
  workbookRow: number;
  projectNumber: string;
  sourceItemNumber: string;
  sourceItemCodeSystem: string;
  sourceSpecRaw: string;
  sourceItemDescription: string;
  itemCode: string;
  itemDescription: string;
  engineerEstimateUnitPrice: number;
  averageBidUnitPrice: number;
  matchedAgencyItemCode: string;
  matchStatus: "matched" | "unmatched" | "source_cdot_prefix_only";
  dateBasis: string;
}

export type BidTabItemRecord = ContractItemRecord;

export interface BidItemPriceRecord {
  bidItemPriceId: string;
  contractItemId: string;
  bidId: string;
  contractId: string;
  sourceId: string;
  unitPrice: number;
  extendedPrice: number;
  sourcePage: number | null;
  sourceLocator: string;
  bidderItemObservationId: string;
  bidTabItemId: string;
  projectId: string;
  agencyItemCode: string;
  descriptionRaw: string;
  unitRaw: string;
  unitNormalized: string;
  quantity: number;
}

export type BidderItemObservationRecord = BidItemPriceRecord;

export interface CanonicalItemRecord {
  canonicalItemId: string;
  itemFamily: string;
  canonicalDescription: string;
  discipline: string;
  typicalUnits: string[];
  keywordsInclude: string[];
  keywordsExclude: string[];
}

export interface AgencyItemVersionRecord {
  agencyItemVersionId: string;
  agencyItemId: string;
  effectiveFrom: string;
  effectiveTo: string;
  officialDescription: string;
  officialAbbreviatedDescription: string;
  officialUnit: string;
  specReferenceCode: string;
  sourceId: string;
  isCurrent: boolean;
}

export interface AgencyItemRecord {
  agencyItemId: string;
  state: string;
  agencyId: string;
  agencyName: string;
  itemCode: string;
  currentVersionId: string;
  itemStatus: "current" | "historical" | string;
  canonicalItemId: string;
  officialDescription: string;
  officialAbbreviatedDescription: string;
  officialUnit: string;
  specReferenceCode: string;
  agency: string;
}

export interface ItemTaxonomyRecord {
  taxonomyId: string;
  state: string;
  agencyId: string;
  taxonomyLevel: "division" | "section" | string;
  taxonomyCode: string;
  parentTaxonomyId: string;
  taxonomyLabel: string;
  matchPrefix: string;
  sourceYear: number | null;
  sourceUrl: string;
  sectionPrefix: string;
  divisionPrefix: string;
  divisionTitle: string;
  sectionTitle: string;
}

export type SpecSectionRecord = ItemTaxonomyRecord;

export interface ItemMappingRecord {
  mappingId: string;
  state: string;
  sourceAgencyId: string;
  sourceItemCode: string;
  targetAgencyItemId: string;
  matchStatus: string;
  confidence: string;
  reviewedBy: string;
  reviewedOn: string;
  notes: string;
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
  manifest: AppManifest;
  stateConfig: StateConfig;
  sources: SourceRecord[];
  lettings: LettingRecord[];
  contracts: ContractRecord[];
  contractProjects: ContractProjectRecord[];
  observations: ItemObservationRecord[];
  canonicalItems: CanonicalItemRecord[];
  agencyItems: AgencyItemRecord[];
  agencyItemVersions: AgencyItemVersionRecord[];
  itemTaxonomy: ItemTaxonomyRecord[];
  itemMappings: ItemMappingRecord[];
  inflationIndexes: InflationIndexRecord[];
  aliases: AliasRecord[];
  bids: BidRecord[];
  contractItems: ContractItemRecord[];
  bidItemPrices: BidItemPriceRecord[];
  sourceById: Map<string, SourceRecord>;
  contractById: Map<string, ContractRecord>;
  contractProjectsByContractId: Map<string, ContractProjectRecord[]>;
  canonicalById: Map<string, CanonicalItemRecord>;
  agencyItemById: Map<string, AgencyItemRecord>;
  agencyByCode: Map<string, AgencyItemRecord[]>;
  taxonomyById: Map<string, ItemTaxonomyRecord>;
  sectionsByDivisionId: Map<string, ItemTaxonomyRecord[]>;
  specSectionByPrefix: Map<string, ItemTaxonomyRecord>;
  specSectionsByDivision: Map<string, ItemTaxonomyRecord[]>;
  inflationIndexByPeriod: Map<string, InflationIndexRecord>;
  bidsByContractId: Map<string, BidRecord[]>;
  contractItemsByContractId: Map<string, ContractItemRecord[]>;
  bidItemPricesByContractItemId: Map<string, BidItemPriceRecord[]>;
  bidItemPricesByEvidenceKey: Map<string, BidItemPriceRecord[]>;
  ensureBidItemPricesLoaded: () => Promise<void>;
  projects: ContractRecord[];
  projectById: Map<string, ContractRecord>;
  specSections: ItemTaxonomyRecord[];
  bidderBids: BidRecord[];
  bidderItemObservations: BidItemPriceRecord[];
  bidTabItems: ContractItemRecord[];
  bidderBidsByProjectId: Map<string, BidRecord[]>;
  bidderItemsByRowKey: Map<string, BidItemPriceRecord[]>;
  bidTabItemsByProjectId: Map<string, ContractItemRecord[]>;
  bidderItemsByBidTabItemId: Map<string, BidItemPriceRecord[]>;
}

export interface SearchQuery {
  state: string;
  agencyId: string;
  agencyItemId: string;
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

export interface ScoreReason { label: string; points: number }

export interface ComparableMatch {
  observation: ItemObservationRecord;
  project: ContractRecord | null;
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
  | "contractId" | "projectNumber" | "location" | "projectLocation" | "district"
  | "letDate" | "awardedVendor" | "contractor" | "bidCount" | "quantity" | "unit"
  | "description" | "awardedBidUnitPrice" | "averageBidUnitPrice"
  | "engineerEstimateUnitPrice" | "source";

export type SortDirection = "asc" | "desc";
export interface EvidenceSort { key: EvidenceSortKey; direction: SortDirection }

export interface EvidenceRow {
  rowId: string;
  contract: ContractRecord | null;
  project: ContractRecord | null;
  source: SourceRecord | null;
  agencyItemId: string;
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
