import type {
  AgencyItemRecord,
  AliasRecord,
  AppData,
  CanonicalItemRecord,
  ItemObservationRecord,
  ProjectRecord,
  SourceRecord
} from "./schema";
import { normalizeDescription, normalizeUnit } from "../matching/normalizeDescription";

type CsvRow = Record<string, string>;

const dataFiles = {
  sources: "sources.csv",
  projects: "projects.csv",
  observations: "item_observations.csv",
  canonicalItems: "canonical_items.csv",
  agencyItems: "agency_items.csv",
  aliases: "aliases.csv"
} as const;

export async function loadData(): Promise<AppData> {
  const [sources, projects, observations, canonicalItems, agencyItems, aliases] =
    await Promise.all([
      loadCsv(dataFiles.sources, mapSource),
      loadCsv(dataFiles.projects, mapProject),
      loadCsv(dataFiles.observations, mapObservation),
      loadCsv(dataFiles.canonicalItems, mapCanonicalItem),
      loadCsv(dataFiles.agencyItems, mapAgencyItem),
      loadCsv(dataFiles.aliases, mapAlias)
    ]);

  const sourceById = new Map(sources.map((source) => [source.sourceId, source]));
  const projectById = new Map(projects.map((project) => [project.projectId, project]));
  const canonicalById = new Map(
    canonicalItems.map((canonicalItem) => [canonicalItem.canonicalItemId, canonicalItem])
  );
  const agencyByCode = new Map<string, AgencyItemRecord[]>();

  for (const agencyItem of agencyItems) {
    const key = agencyItem.itemCode.toUpperCase();
    const existing = agencyByCode.get(key) ?? [];
    existing.push(agencyItem);
    agencyByCode.set(key, existing);
  }

  return {
    sources,
    projects,
    observations,
    canonicalItems,
    agencyItems,
    aliases,
    sourceById,
    projectById,
    canonicalById,
    agencyByCode
  };
}

async function loadCsv<T>(fileName: string, mapper: (row: CsvRow) => T): Promise<T[]> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/${fileName}`);

  if (!response.ok) {
    throw new Error(`Could not load ${fileName}: ${response.status} ${response.statusText}`);
  }

  const text = await response.text();
  return parseCsv(text).map(mapper);
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
    const char = text[index];
    const nextChar = text[index + 1];

    if (char === '"' && inQuotes && nextChar === '"') {
      currentCell += '"';
      index += 1;
      continue;
    }

    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }

    if (char === "," && !inQuotes) {
      currentRow.push(currentCell);
      currentCell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && nextChar === "\n") {
        index += 1;
      }
      currentRow.push(currentCell);
      rows.push(currentRow);
      currentRow = [];
      currentCell = "";
      continue;
    }

    currentCell += char;
  }

  currentRow.push(currentCell);
  rows.push(currentRow);

  return rows.filter((row) => row.some((cell) => cell.trim().length > 0));
}

function mapSource(row: CsvRow): SourceRecord {
  return {
    sourceId: row.source_id,
    sourceType: row.source_type,
    agency: row.agency,
    state: row.state,
    sourceLabel: row.source_label,
    dataYear: parseOptionalNumber(row.data_year),
    notes: row.notes
  };
}

function mapProject(row: CsvRow): ProjectRecord {
  return {
    projectId: row.project_id,
    projectName: row.project_name,
    agencyOwner: row.agency_owner,
    state: row.state.toUpperCase(),
    countyRegion: row.county_region,
    workType: row.work_type,
    estimateLetDate: row.estimate_let_date,
    sourceId: row.source_id
  };
}

function mapObservation(row: CsvRow): ItemObservationRecord {
  return {
    observationId: row.observation_id,
    projectId: row.project_id,
    sourceId: row.source_id,
    agencyItemCode: row.agency_item_code.toUpperCase(),
    descriptionRaw: row.description_raw,
    descriptionNormalized: normalizeDescription(row.description_normalized || row.description_raw),
    unitRaw: row.unit_raw,
    unitNormalized: normalizeUnit(row.unit_normalized || row.unit_raw),
    quantity: parseRequiredNumber(row.quantity),
    unitPrice: parseRequiredNumber(row.unit_price),
    extendedPrice: parseRequiredNumber(row.extended_price),
    discipline: row.discipline,
    priceType: row.price_type,
    dateBasis: row.date_basis
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

function mapAgencyItem(row: CsvRow): AgencyItemRecord {
  return {
    agencyItemId: row.agency_item_id,
    state: row.state.toUpperCase(),
    agency: row.agency,
    itemCode: row.item_code.toUpperCase(),
    officialDescription: row.official_description,
    officialUnit: normalizeUnit(row.official_unit),
    canonicalItemId: row.canonical_item_id
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

function splitList(value: string): string[] {
  return value
    .split(";")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseRequiredNumber(value: string): number {
  const parsed = Number(value.replace(/[$,]/g, ""));

  if (Number.isNaN(parsed)) {
    throw new Error(`Expected numeric value, received "${value}".`);
  }

  return parsed;
}

function parseOptionalNumber(value: string): number | null {
  if (!value) {
    return null;
  }

  const parsed = Number(value.replace(/[$,]/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}
