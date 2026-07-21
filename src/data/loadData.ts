import type {
  AgencyItemRecord,
  AgencyItemVersionRecord,
  AliasRecord,
  AppData,
  AppManifest,
  BidItemPriceRecord,
  BidRecord,
  CanonicalItemRecord,
  ContractItemRecord,
  ContractProjectRecord,
  ContractRecord,
  InflationIndexRecord,
  ItemMappingRecord,
  ItemObservationRecord,
  ItemTaxonomyRecord,
  LettingRecord,
  SourceRecord,
  StateConfig
} from "./schema";
import { normalizeDescription, normalizeUnit } from "../matching/normalizeDescription";

type CsvRow = Record<string, string>;

export async function loadManifest(): Promise<AppManifest> {
  const response = await fetch(dataUrl("manifest.json"));

  if (!response.ok) {
    throw new Error(`Could not load the data manifest: ${response.status} ${response.statusText}`);
  }

  const manifest = await response.json() as AppManifest;
  if (manifest.schemaVersion !== 2 || !Array.isArray(manifest.states) || manifest.states.length === 0) {
    throw new Error("The data manifest is not a supported schema-v2 manifest.");
  }

  return manifest;
}

/** Compatibility entry point. New callers should load the manifest and choose a state explicitly. */
export async function loadData(stateCode = "CO"): Promise<AppData> {
  const manifest = await loadManifest();
  return loadStateData(manifest, stateCode);
}

export async function loadStateData(manifest: AppManifest, requestedState: string): Promise<AppData> {
  const stateCode = requestedState.trim().toUpperCase();
  const stateConfig = manifest.states.find((state) => state.code === stateCode);

  if (!stateConfig) {
    throw new Error(`State ${stateCode || "(blank)"} is not enabled in the data manifest.`);
  }

  const files = stateConfig.files;
  const [
    sources,
    lettings,
    rawContracts,
    contractProjects,
    rawContractItems,
    bids,
    rawAgencyItems,
    agencyItemVersions,
    rawTaxonomy,
    itemMappings,
    observations,
    inflationIndexes,
    canonicalItems,
    aliases
  ] = await Promise.all([
    loadCsvPath(files.sources, mapSource),
    loadCsvPath(files.lettings, mapLetting),
    loadCsvPath(files.contracts, mapContract),
    loadCsvPath(files.contractProjects, mapContractProject),
    loadCsvPath(files.contractItems, mapContractItem),
    loadCsvPath(files.bids, mapBid),
    loadCsvPath(files.agencyItems, mapAgencyItem),
    loadCsvPath(files.agencyItemVersions, mapAgencyItemVersion),
    loadCsvPath(files.itemTaxonomy, mapTaxonomy),
    loadCsvPath(files.itemMappings, mapItemMapping),
    loadCsvPath(files.observations, mapObservation),
    loadCsvPath(manifest.common.inflationIndexes, mapInflationIndex),
    loadOptionalCsvPath(files.canonicalItems, mapCanonicalItem),
    loadOptionalCsvPath(files.aliases, mapAlias)
  ]);

  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const lettingById = new Map(lettings.map((letting) => [letting.lettingId, letting]));
  const contractProjectsByContractId = groupBy(contractProjects, (project) => project.contractId);
  const agencyItemVersionById = new Map(
    agencyItemVersions.map((version) => [version.agencyItemVersionId, version])
  );
  const agencyItems = rawAgencyItems.map((item) => {
    const version = agencyItemVersionById.get(item.currentVersionId);
    return {
      ...item,
      officialDescription: version?.officialDescription ?? "",
      officialAbbreviatedDescription: version?.officialAbbreviatedDescription ?? "",
      officialUnit: normalizeUnit(version?.officialUnit ?? ""),
      specReferenceCode: version?.specReferenceCode ?? ""
    };
  });
  const agencyItemById = new Map(agencyItems.map((item) => [item.agencyItemId, item]));
  const agencyByCode = groupBy(agencyItems, (item) => item.itemCode.toUpperCase());

  const taxonomyById = new Map(rawTaxonomy.map((row) => [row.taxonomyId, row]));
  const itemTaxonomy = rawTaxonomy.map((row) => enrichTaxonomy(row, taxonomyById));
  const enrichedTaxonomyById = new Map(itemTaxonomy.map((row) => [row.taxonomyId, row]));
  const specSections = itemTaxonomy.filter((row) => row.taxonomyLevel === "section");
  const sectionsByDivisionId = groupBy(specSections, (row) => row.parentTaxonomyId);
  const specSectionByPrefix = new Map(specSections.map((row) => [row.sectionPrefix, row]));
  const specSectionsByDivision = groupBy(specSections, (row) => row.divisionPrefix);

  const contracts = rawContracts.map((contract) => {
    const projects = contractProjectsByContractId.get(contract.contractId) ?? [];
    const letting = lettingById.get(contract.lettingId);
    const projectNumbers = projects.map((project) => project.projectNumber).filter(Boolean).join("; ");
    const projectNames = projects.map((project) => project.projectName).filter(Boolean).join("; ");
    return {
      ...contract,
      projectId: contract.contractId,
      projectName: projectNames || contract.workType || contract.officialContractId,
      agencyOwner: stateConfig.defaultAgencyName,
      countyRegion: contract.primaryCounty,
      estimateLetDate: letting?.lettingDate ?? "",
      projectNumber: projectNumbers || contract.officialContractId,
      projectLocationRaw: contract.location,
      contractor: contract.awardedVendor,
      awardedBidTotal: contract.awardedAmount
    };
  });
  const contractById = new Map(contracts.map((contract) => [contract.contractId, contract]));

  const observationByContractItemShape = new Map<string, ItemObservationRecord[]>();
  const observationByContractItemIdentity = new Map<string, ItemObservationRecord[]>();
  for (const observation of observations) {
    const key = observationShapeKey(
      observation.contractId,
      observation.sourceId,
      observation.agencyItemCode,
      observation.descriptionRaw,
      observation.unitNormalized,
      observation.quantity
    );
    const rows = observationByContractItemShape.get(key) ?? [];
    rows.push(observation);
    observationByContractItemShape.set(key, rows);
    const identityKey = observationIdentityKey(
      observation.contractId,
      observation.sourceId,
      observation.agencyItemCode,
      observation.descriptionRaw,
      observation.unitNormalized
    );
    const identityRows = observationByContractItemIdentity.get(identityKey) ?? [];
    identityRows.push(observation);
    observationByContractItemIdentity.set(identityKey, identityRows);
  }

  const contractItems = rawContractItems.map((item) => {
    const agencyItem = agencyItemById.get(item.agencyItemId);
    const contract = contractById.get(item.contractId);
    const source = sourceById.get(item.sourceId);
    const key = observationShapeKey(
      item.contractId,
      item.sourceId,
      agencyItem?.itemCode || item.sourceItemCode,
      item.descriptionRaw,
      item.unitNormalized,
      item.quantity
    );
    const itemObservations = observationByContractItemShape.get(key) ?? [];
    const identityObservations = observationByContractItemIdentity.get(observationIdentityKey(
      item.contractId,
      item.sourceId,
      agencyItem?.itemCode || item.sourceItemCode,
      item.descriptionRaw,
      item.unitNormalized
    )) ?? [];
    return {
      ...item,
      bidTabItemId: item.contractItemId,
      projectId: item.contractId,
      sourceFile: source?.sourceFileName ?? "",
      sheetName: "",
      workbookRow: item.sourcePage ?? 0,
      projectNumber: contract?.projectNumber ?? "",
      sourceItemNumber: item.lineNumber,
      sourceItemCodeSystem: stateConfig.defaultAgencyId,
      sourceSpecRaw: item.sectionNumber,
      sourceItemDescription: item.descriptionRaw,
      itemCode: agencyItem?.itemCode ?? item.sourceItemCode,
      itemDescription: item.descriptionRaw,
      engineerEstimateUnitPrice: priceFor(itemObservations, "engineer_estimate")
        ?? priceFor(identityObservations, "engineer_estimate"),
      averageBidUnitPrice: priceFor(itemObservations, "average_bid"),
      matchedAgencyItemCode: agencyItem?.itemCode ?? "",
      matchStatus: item.agencyItemId ? "matched" as const : "unmatched" as const,
      dateBasis: contract?.estimateLetDate ?? ""
    };
  });

  const bidsByContractId = groupBy(bids, (bid) => bid.contractId);
  const contractItemsByContractId = groupBy(contractItems, (item) => item.contractId);
  const bidItemPrices: BidItemPriceRecord[] = [];
  const bidItemPricesByContractItemId = new Map<string, BidItemPriceRecord[]>();
  const bidItemPricesByEvidenceKey = new Map<string, BidItemPriceRecord[]>();
  const bidderItemsByRowKey = bidItemPricesByEvidenceKey;
  const bidderItemsByBidTabItemId = bidItemPricesByContractItemId;
  const contractItemById = new Map(contractItems.map((item) => [item.contractItemId, item]));
  let bidderPricesPromise: Promise<void> | null = null;

  const ensureBidItemPricesLoaded = (): Promise<void> => {
    if (!files.bidItemPrices) {
      return Promise.resolve();
    }
    if (bidderPricesPromise) {
      return bidderPricesPromise;
    }

    bidderPricesPromise = loadCsvPath(files.bidItemPrices, mapBidItemPrice).then((rawPrices) => {
      for (const rawPrice of rawPrices) {
        const item = contractItemById.get(rawPrice.contractItemId);
        const agencyItem = item ? agencyItemById.get(item.agencyItemId) : undefined;
        const price: BidItemPriceRecord = {
          ...rawPrice,
          bidderItemObservationId: rawPrice.bidItemPriceId,
          bidTabItemId: rawPrice.contractItemId,
          projectId: rawPrice.contractId,
          agencyItemCode: agencyItem?.itemCode ?? item?.sourceItemCode ?? "",
          descriptionRaw: item?.descriptionRaw ?? "",
          unitRaw: item?.unitRaw ?? "",
          unitNormalized: item?.unitNormalized ?? "",
          quantity: item?.quantity ?? 0
        };
        bidItemPrices.push(price);
        appendToMap(bidItemPricesByContractItemId, price.contractItemId, price);
        appendToMap(
          bidItemPricesByEvidenceKey,
          observationShapeKey(
            price.contractId,
            price.sourceId,
            price.agencyItemCode,
            price.descriptionRaw,
            price.unitNormalized,
            price.quantity
          ),
          price
        );
      }
    });
    return bidderPricesPromise;
  };

  const canonicalById = new Map(
    canonicalItems.map((canonicalItem) => [canonicalItem.canonicalItemId, canonicalItem])
  );
  const inflationIndexByPeriod = new Map(
    inflationIndexes.map((index) => [index.periodLabel, index])
  );

  return {
    manifest,
    stateConfig,
    sources,
    lettings,
    contracts,
    contractProjects,
    observations,
    canonicalItems,
    agencyItems,
    agencyItemVersions,
    itemTaxonomy,
    itemMappings,
    inflationIndexes,
    aliases,
    bids,
    contractItems,
    bidItemPrices,
    sourceById,
    contractById,
    contractProjectsByContractId,
    canonicalById,
    agencyItemById,
    agencyByCode,
    taxonomyById: enrichedTaxonomyById,
    sectionsByDivisionId,
    specSectionByPrefix,
    specSectionsByDivision,
    inflationIndexByPeriod,
    bidsByContractId,
    contractItemsByContractId,
    bidItemPricesByContractItemId,
    bidItemPricesByEvidenceKey,
    ensureBidItemPricesLoaded,
    projects: contracts,
    projectById: contractById,
    specSections,
    bidderBids: bids,
    bidderItemObservations: bidItemPrices,
    bidTabItems: contractItems,
    bidderBidsByProjectId: bidsByContractId,
    bidderItemsByRowKey,
    bidTabItemsByProjectId: contractItemsByContractId,
    bidderItemsByBidTabItemId
  };
}

function dataUrl(path: string): string {
  return `${import.meta.env.BASE_URL}data/${path}`;
}

async function loadCsvPath<T>(path: string, mapper: (row: CsvRow) => T): Promise<T[]> {
  const response = await fetch(dataUrl(path));
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status} ${response.statusText}`);
  }
  return parseCsv(await response.text()).map(mapper);
}

async function loadOptionalCsvPath<T>(
  path: string | undefined,
  mapper: (row: CsvRow) => T
): Promise<T[]> {
  if (!path) {
    return [];
  }
  const response = await fetch(dataUrl(path));
  if (response.status === 404) {
    return [];
  }
  if (!response.ok) {
    throw new Error(`Could not load ${path}: ${response.status} ${response.statusText}`);
  }
  return parseCsv(await response.text()).map(mapper);
}

function parseCsv(text: string): CsvRow[] {
  const rows = parseCsvRows(text.trim());
  if (rows.length === 0) {
    return [];
  }
  const headers = rows[0].map((header) => header.trim());
  return rows.slice(1).map((row) =>
    Object.fromEntries(headers.map((header, index) => [header, row[index]?.trim() ?? ""]))
  );
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const nextCharacter = text[index + 1];
    if (character === '"' && inQuotes && nextCharacter === '"') {
      currentCell += '"';
      index += 1;
    } else if (character === '"') {
      inQuotes = !inQuotes;
    } else if (character === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
    } else if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && nextCharacter === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
    } else {
      currentCell += character;
    }
  }
  currentRow.push(currentCell);
  rows.push(currentRow);
  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

function mapSource(row: CsvRow): SourceRecord {
  return {
    sourceId: row.source_id,
    sourceType: row.source_type,
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    state: row.state.toUpperCase(),
    sourceLabel: row.source_label,
    sourceDate: row.source_date,
    dataYear: optionalNumber(row.data_year),
    sourceUrl: row.source_url,
    sourceFileName: row.source_file_name,
    sha256: row.sha256,
    parserName: row.parser_name,
    parserVersion: row.parser_version,
    notes: row.notes,
    agency: row.agency_name
  };
}

function mapLetting(row: CsvRow): LettingRecord {
  return {
    lettingId: row.letting_id,
    sourceId: row.source_id,
    state: row.state.toUpperCase(),
    agencyId: row.agency_id,
    lettingDate: row.letting_date,
    lettingLabel: row.letting_label
  };
}

function mapContract(row: CsvRow): ContractRecord {
  return {
    contractId: row.contract_id,
    lettingId: row.letting_id,
    sourceId: row.source_id,
    state: row.state.toUpperCase(),
    agencyId: row.agency_id,
    officialContractId: row.official_contract_id,
    callOrder: row.call_order,
    lettingStatus: row.letting_status,
    awardedVendor: row.awarded_vendor,
    awardedAmount: optionalNumber(row.awarded_amount),
    primaryCounty: row.primary_county,
    route: row.route,
    workType: row.work_type,
    contractPeriod: row.contract_period,
    dbeGoal: row.dbe_goal,
    bidCount: optionalNumber(row.bid_count),
    location: row.location,
    district: row.district,
    terrain: row.terrain,
    awardIndex: optionalNumber(row.award_index),
    projectId: row.contract_id,
    projectName: "",
    agencyOwner: "",
    countyRegion: row.primary_county,
    estimateLetDate: "",
    projectNumber: row.official_contract_id,
    projectLocationRaw: row.location,
    contractor: row.awarded_vendor,
    awardedBidTotal: optionalNumber(row.awarded_amount)
  };
}

function mapContractProject(row: CsvRow): ContractProjectRecord {
  return {
    contractProjectId: row.contract_project_id,
    contractId: row.contract_id,
    projectNumber: row.project_number,
    projectName: row.project_name,
    workType: row.work_type,
    countyRegion: row.county_region,
    route: row.route,
    location: row.location,
    projectAwardAmount: optionalNumber(row.project_award_amount)
  };
}

function mapObservation(row: CsvRow): ItemObservationRecord {
  return {
    observationId: row.observation_id,
    contractId: row.contract_id,
    sourceId: row.source_id,
    agencyItemId: row.agency_item_id,
    agencyItemCode: row.agency_item_code.toUpperCase(),
    descriptionRaw: row.description_raw,
    descriptionNormalized: normalizeDescription(row.description_normalized || row.description_raw),
    unitRaw: row.unit_raw,
    unitNormalized: normalizeUnit(row.unit_normalized || row.unit_raw),
    quantity: requiredNumber(row.quantity),
    unitPrice: requiredNumber(row.unit_price),
    extendedPrice: requiredNumber(row.extended_price),
    discipline: row.discipline,
    priceType: row.price_type,
    dateBasis: row.date_basis,
    derivationMethod: row.derivation_method,
    derivationInputCount: optionalNumber(row.derivation_input_count),
    projectId: row.contract_id
  };
}

function mapBid(row: CsvRow): BidRecord {
  return {
    bidId: row.bid_id,
    contractId: row.contract_id,
    sourceId: row.source_id,
    sourceVendorId: row.source_vendor_id,
    bidderName: row.bidder_name,
    bidRank: optionalNumber(row.bid_rank),
    bidTotal: requiredNumber(row.bid_total),
    percentOfLow: optionalNumber(row.percent_of_low),
    isApparentLow: booleanValue(row.is_apparent_low),
    isAwarded: booleanValue(row.is_awarded),
    sourcePage: optionalNumber(row.source_page),
    projectId: row.contract_id,
    apparentLow: booleanValue(row.is_apparent_low)
  };
}

function mapContractItem(row: CsvRow): ContractItemRecord {
  return {
    contractItemId: row.contract_item_id,
    contractId: row.contract_id,
    sourceId: row.source_id,
    sectionNumber: row.section_number,
    sectionTitle: row.section_title,
    lineNumber: row.line_number,
    sourceItemCode: row.source_item_code.toUpperCase(),
    agencyItemId: row.agency_item_id,
    descriptionRaw: row.description_raw,
    quantity: requiredNumber(row.quantity),
    unitRaw: row.unit_raw,
    unitNormalized: normalizeUnit(row.unit_normalized || row.unit_raw),
    alternateSet: row.alternate_set,
    alternateMember: row.alternate_member,
    mappingStatus: row.mapping_status,
    sourcePage: optionalNumber(row.source_page),
    sourceLocator: row.source_locator,
    bidTabItemId: row.contract_item_id,
    projectId: row.contract_id,
    sourceFile: "",
    sheetName: "",
    workbookRow: optionalNumber(row.source_page) ?? 0,
    projectNumber: "",
    sourceItemNumber: row.line_number,
    sourceItemCodeSystem: "",
    sourceSpecRaw: row.section_number,
    sourceItemDescription: row.description_raw,
    itemCode: row.source_item_code.toUpperCase(),
    itemDescription: row.description_raw,
    engineerEstimateUnitPrice: null,
    averageBidUnitPrice: null,
    matchedAgencyItemCode: "",
    matchStatus: row.agency_item_id ? "matched" : "unmatched",
    dateBasis: ""
  };
}

function mapBidItemPrice(row: CsvRow): BidItemPriceRecord {
  return {
    bidItemPriceId: row.bid_item_price_id,
    contractItemId: row.contract_item_id,
    bidId: row.bid_id,
    contractId: row.contract_id,
    sourceId: row.source_id,
    unitPrice: requiredNumber(row.unit_price),
    extendedPrice: requiredNumber(row.extended_price),
    sourcePage: optionalNumber(row.source_page),
    sourceLocator: row.source_locator,
    bidderItemObservationId: row.bid_item_price_id,
    bidTabItemId: row.contract_item_id,
    projectId: row.contract_id,
    agencyItemCode: "",
    descriptionRaw: "",
    unitRaw: "",
    unitNormalized: "",
    quantity: 0
  };
}

function mapAgencyItem(row: CsvRow): AgencyItemRecord {
  return {
    agencyItemId: row.agency_item_id,
    state: row.state.toUpperCase(),
    agencyId: row.agency_id,
    agencyName: row.agency_name,
    itemCode: row.item_code.toUpperCase(),
    currentVersionId: row.current_version_id,
    itemStatus: row.item_status,
    canonicalItemId: row.canonical_item_id,
    officialDescription: "",
    officialAbbreviatedDescription: "",
    officialUnit: "",
    specReferenceCode: "",
    agency: row.agency_name
  };
}

function mapAgencyItemVersion(row: CsvRow): AgencyItemVersionRecord {
  return {
    agencyItemVersionId: row.agency_item_version_id,
    agencyItemId: row.agency_item_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    officialDescription: row.official_description,
    officialAbbreviatedDescription: row.official_abbreviated_description,
    officialUnit: row.official_unit,
    specReferenceCode: row.spec_reference_code,
    sourceId: row.source_id,
    isCurrent: booleanValue(row.is_current)
  };
}

function mapTaxonomy(row: CsvRow): ItemTaxonomyRecord {
  return {
    taxonomyId: row.taxonomy_id,
    state: row.state.toUpperCase(),
    agencyId: row.agency_id,
    taxonomyLevel: row.taxonomy_level,
    taxonomyCode: row.taxonomy_code,
    parentTaxonomyId: row.parent_taxonomy_id,
    taxonomyLabel: row.taxonomy_label,
    matchPrefix: row.match_prefix,
    sourceYear: optionalNumber(row.source_year),
    sourceUrl: row.source_url,
    sectionPrefix: row.match_prefix,
    divisionPrefix: "",
    divisionTitle: "",
    sectionTitle: row.taxonomy_label
  };
}

function enrichTaxonomy(
  row: ItemTaxonomyRecord,
  taxonomyById: Map<string, ItemTaxonomyRecord>
): ItemTaxonomyRecord {
  const division = row.taxonomyLevel === "division"
    ? row
    : taxonomyById.get(row.parentTaxonomyId);
  return {
    ...row,
    sectionPrefix: row.matchPrefix,
    divisionPrefix: division?.matchPrefix ?? "",
    divisionTitle: division?.taxonomyLabel ?? "",
    sectionTitle: row.taxonomyLabel
  };
}

function mapItemMapping(row: CsvRow): ItemMappingRecord {
  return {
    mappingId: row.mapping_id,
    state: row.state.toUpperCase(),
    sourceAgencyId: row.source_agency_id,
    sourceItemCode: row.source_item_code,
    targetAgencyItemId: row.target_agency_item_id,
    matchStatus: row.match_status,
    confidence: row.confidence,
    reviewedBy: row.reviewed_by,
    reviewedOn: row.reviewed_on,
    notes: row.notes
  };
}

function mapCanonicalItem(row: CsvRow): CanonicalItemRecord {
  return {
    canonicalItemId: row.canonical_item_id,
    itemFamily: row.item_family,
    canonicalDescription: row.canonical_description,
    discipline: row.discipline,
    typicalUnits: splitList(row.typical_units).map(normalizeUnit),
    keywordsInclude: splitList(row.keywords_include).map(normalizeDescription),
    keywordsExclude: splitList(row.keywords_exclude).map(normalizeDescription)
  };
}

function mapInflationIndex(row: CsvRow): InflationIndexRecord {
  return {
    indexId: row.index_id,
    indexName: row.index_name,
    periodYear: requiredNumber(row.period_year),
    periodQuarter: requiredNumber(row.period_quarter),
    periodLabel: row.period_label,
    periodStartDate: row.period_start_date,
    periodEndDate: row.period_end_date,
    indexValue: requiredNumber(row.index_value),
    sourceUrl: row.source_url,
    notes: row.notes
  };
}

function mapAlias(row: CsvRow): AliasRecord {
  return {
    aliasId: row.alias_id,
    state: row.state.toUpperCase(),
    agency: row.agency,
    rawDescriptionPattern: normalizeDescription(row.raw_description_pattern),
    canonicalItemId: row.canonical_item_id,
    matchType: row.match_type,
    confidence: row.confidence,
    notes: row.notes
  };
}

function observationShapeKey(
  contractId: string,
  sourceId: string,
  itemCode: string,
  description: string,
  unit: string,
  quantity: number
): string {
  return [contractId, sourceId, itemCode, description, normalizeUnit(unit), quantity].join("|");
}

function observationIdentityKey(
  contractId: string,
  sourceId: string,
  itemCode: string,
  description: string,
  unit: string
): string {
  return [contractId, sourceId, itemCode, description, normalizeUnit(unit)].join("|");
}

function priceFor(observations: ItemObservationRecord[], priceType: string): number | null {
  return observations.find((observation) => observation.priceType === priceType)?.unitPrice ?? null;
}

function groupBy<T>(rows: T[], keyFor: (row: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    appendToMap(grouped, keyFor(row), row);
  }
  return grouped;
}

function appendToMap<T>(map: Map<string, T[]>, key: string, row: T): void {
  const existing = map.get(key) ?? [];
  existing.push(row);
  map.set(key, existing);
}

function splitList(value: string): string[] {
  return value.split(";").map((item) => item.trim()).filter(Boolean);
}

function booleanValue(value: string): boolean {
  return ["1", "true", "yes", "y"].includes(value.trim().toLowerCase());
}

function requiredNumber(value: string): number {
  const number = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
  if (!Number.isFinite(number)) {
    throw new Error(`Expected numeric value, received "${value}".`);
  }
  return number;
}

function optionalNumber(value: string): number | null {
  if (!value) {
    return null;
  }
  const number = Number(value.replace(/[$,%]/g, "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}
