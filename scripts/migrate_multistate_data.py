from __future__ import annotations

import argparse
import csv
import hashlib
import json
import re
import shutil
from collections import defaultdict
from pathlib import Path


LEGACY_DIR = Path("public/data")
OUTPUT_DIR = Path("public/data/states/co")
COMMON_DIR = Path("public/data/common")
COST_BOOK_OBSERVATION_ID = re.compile(
    r"^(?P<base>.+?_(?P<row_number>\d+))_(?P<price_type>awarded_bid|average_bid|engineer_estimate)$"
)


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return [dict(row) for row in csv.DictReader(source)]


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def slug(value: str) -> str:
    return "".join(character.lower() if character.isalnum() else "_" for character in value).strip("_")


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def map_price_type(value: str) -> str:
    normalized = value.strip().lower()
    if normalized in {"cdot_awarded_bid", "bid_tab_demo", "public_bid_tab_awarded"}:
        return "awarded_bid"
    if normalized in {"cdot_average_bid", "public_bid_tab_average"}:
        return "average_bid"
    if normalized in {"cdot_engineer_estimate", "public_bid_tab_engineer_estimate", "engineers_estimate"}:
        return "engineer_estimate"
    return normalized


def source_type(value: str) -> str:
    if value == "public_cost_book":
        return "cost_book"
    if value == "public_bid_tab":
        return "bid_tab"
    return value


def build_cost_book_contract_items(
    imports_dir: Path,
    legacy_sources: list[dict[str, str]],
    legacy_observations: list[dict[str, str]],
    agency_by_code: dict[str, str],
) -> list[dict[str, str]]:
    cost_book_sources = {
        row["source_id"]: row
        for row in legacy_sources
        if source_type(row["source_type"]) == "cost_book"
    }
    observations_by_source_row: dict[tuple[str, int], dict[str, dict[str, str]]] = defaultdict(dict)
    observation_bases: dict[tuple[str, int], str] = {}

    for observation in legacy_observations:
        source_id = observation["source_id"]
        if source_id not in cost_book_sources:
            continue
        match = COST_BOOK_OBSERVATION_ID.match(observation["observation_id"])
        if not match:
            raise ValueError(f"Unexpected Cost Data Book observation ID: {observation['observation_id']}")
        row_number = int(match.group("row_number"))
        price_type = map_price_type(observation["price_type"])
        if price_type not in {"awarded_bid", "average_bid", "engineer_estimate"}:
            raise ValueError(f"Unexpected Cost Data Book price type: {observation['price_type']}")
        key = (source_id, row_number)
        if price_type in observations_by_source_row[key]:
            raise ValueError(f"Duplicate {price_type} observation for {source_id} staging row {row_number}")
        observations_by_source_row[key][price_type] = observation
        observation_bases[key] = match.group("base")

    contract_items: list[dict[str, str]] = []
    expected_price_types = {"awarded_bid", "average_bid", "engineer_estimate"}
    for source_id, source in cost_book_sources.items():
        staging_path = imports_dir / f"{source_id}_item_unit_costs.csv"
        if not staging_path.exists():
            raise ValueError(f"Missing committed Cost Data Book staging extract: {staging_path}")
        staging_rows = read_csv(staging_path)
        for row_number, staging_row in enumerate(staging_rows, start=1):
            key = (source_id, row_number)
            price_observations = observations_by_source_row.get(key, {})
            if set(price_observations) != expected_price_types:
                missing = sorted(expected_price_types - set(price_observations))
                raise ValueError(
                    f"Cost Data Book {source_id} staging row {row_number} is missing observations: {', '.join(missing)}"
                )
            reference = price_observations["awarded_bid"]
            identity = (
                reference["project_id"],
                reference["agency_item_code"].upper(),
                reference["description_raw"],
                reference["unit_normalized"],
                reference["quantity"],
                reference["date_basis"],
            )
            for price_type, observation in price_observations.items():
                candidate_identity = (
                    observation["project_id"],
                    observation["agency_item_code"].upper(),
                    observation["description_raw"],
                    observation["unit_normalized"],
                    observation["quantity"],
                    observation["date_basis"],
                )
                if candidate_identity != identity:
                    raise ValueError(
                        f"Cost Data Book {source_id} staging row {row_number} has inconsistent {price_type} identity"
                    )

            item_code = reference["agency_item_code"].upper()
            agency_item_id = agency_by_code.get(item_code, "")
            if not agency_item_id:
                raise ValueError(f"Cost Data Book item {item_code} has no agency-item identity")
            source_file = staging_row.get("source_file", "")
            source_page = staging_row.get("page_number", "")
            locator_parts = [part for part in [source_file, f"page {source_page}" if source_page else ""] if part]
            locator = ":".join(locator_parts) + f"; staging row {row_number}"
            contract_items.append({
                "contract_item_id": f"{observation_bases[key]}_item",
                "contract_id": reference["project_id"],
                "source_id": source_id,
                "section_number": staging_row.get("source_period", ""),
                "section_title": source["source_label"],
                "line_number": str(row_number),
                "source_item_code": staging_row.get("item_code", item_code).upper(),
                "agency_item_id": agency_item_id,
                "description_raw": staging_row.get("item_description", reference["description_raw"]),
                "quantity": reference["quantity"],
                "unit_raw": staging_row.get("unit_raw", reference["unit_raw"]),
                "unit_normalized": staging_row.get("unit_normalized", reference["unit_normalized"]),
                "alternate_set": "",
                "alternate_member": "",
                "mapping_status": "matched",
                "source_page": source_page,
                "source_locator": locator,
            })

        source_observation_rows = {
            row_number for observation_source, row_number in observations_by_source_row if observation_source == source_id
        }
        if len(source_observation_rows) != len(staging_rows):
            raise ValueError(
                f"Cost Data Book {source_id} has {len(source_observation_rows)} observation rows but "
                f"{len(staging_rows)} staging rows"
            )

    return contract_items


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Colorado schema-v2 state package from the legacy CSV package.")
    parser.add_argument("--legacy-dir", type=Path, default=LEGACY_DIR)
    parser.add_argument("--output-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--common-dir", type=Path, default=COMMON_DIR)
    args = parser.parse_args()

    legacy = args.legacy_dir
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    args.common_dir.mkdir(parents=True, exist_ok=True)

    legacy_sources = read_csv(legacy / "sources.csv")
    legacy_projects = read_csv(legacy / "projects.csv")
    legacy_observations = read_csv(legacy / "item_observations.csv")
    legacy_agency_items = read_csv(legacy / "agency_items.csv")
    legacy_sections = read_csv(legacy / "spec_sections.csv")
    legacy_bids = read_csv(legacy / "bidder_bids.csv")
    legacy_bid_items = read_csv(legacy / "bid_tab_items.csv")
    legacy_bid_prices = read_csv(legacy / "bidder_item_observations.csv")
    legacy_aliases = read_csv(legacy / "aliases.csv")
    legacy_canonical = read_csv(legacy / "canonical_items.csv")

    source_paths = {row["source_id"]: legacy / "sources.csv" for row in legacy_sources}
    existing_sources_by_id = {
        row["source_id"]: row
        for row in (read_csv(output / "sources.csv") if (output / "sources.csv").exists() else [])
    }
    sources = []
    for row in legacy_sources:
        existing_source = existing_sources_by_id.get(row["source_id"], {})
        sources.append({
            "source_id": row["source_id"],
            "source_type": source_type(row["source_type"]),
            "agency_id": "co_cdot" if row["agency"].upper() == "CDOT" else "co_local",
            "agency_name": row["agency"],
            "state": "CO",
            "source_label": row["source_label"],
            "source_date": row.get("source_date", "") or existing_source.get("source_date", ""),
            "data_year": row["data_year"],
            "source_url": row.get("source_url", "") or existing_source.get("source_url", ""),
            "source_file_name": row.get("source_file_name", "") or existing_source.get("source_file_name", ""),
            "sha256": row.get("sha256", "") or existing_source.get("sha256", "") or file_sha256(source_paths[row["source_id"]]),
            "parser_name": row.get("parser_name", "") or existing_source.get("parser_name", "") or "legacy_schema_v1_migration",
            "parser_version": row.get("parser_version", "") or existing_source.get("parser_version", "") or "2.0.0",
            "notes": row["notes"],
        })
    sources.append({
        "source_id": "cdot_item_code_book_2026",
        "source_type": "item_catalog",
        "agency_id": "co_cdot",
        "agency_name": "CDOT",
        "state": "CO",
        "source_label": "CDOT 2026 Item Code Book",
        "source_date": "2026-01-01",
        "data_year": "2026",
        "source_url": "https://www.codot.gov/business/designsupport/cdot-construction-specifications/2026-construction-specifications",
        "source_file_name": "agency_items.csv",
        "sha256": file_sha256(legacy / "agency_items.csv"),
        "parser_name": "legacy_schema_v1_migration",
        "parser_version": "2.0.0",
        "notes": "Schema-v2 provenance record for the migrated official item catalog.",
    })

    lettings_by_key: dict[tuple[str, str], str] = {}
    lettings = []
    contracts = []
    contract_projects = []
    for project in legacy_projects:
        date = project["estimate_let_date"]
        key = (project["source_id"], date)
        letting_id = lettings_by_key.get(key)
        if not letting_id:
            letting_id = f"co_{slug(project['source_id'])}_{date.replace('-', '')}"
            lettings_by_key[key] = letting_id
            lettings.append({
                "letting_id": letting_id,
                "source_id": project["source_id"],
                "state": "CO",
                "agency_id": "co_cdot" if project["agency_owner"].upper() == "CDOT" else "co_local",
                "letting_date": date,
                "letting_label": f"{project['agency_owner']} {date}",
            })

        contract_id = project["project_id"]
        contracts.append({
            "contract_id": contract_id,
            "letting_id": letting_id,
            "source_id": project["source_id"],
            "state": "CO",
            "agency_id": "co_cdot" if project["agency_owner"].upper() == "CDOT" else "co_local",
            "official_contract_id": project["project_number"],
            "call_order": "",
            "letting_status": "AWARDED" if project["contractor"] else "",
            "awarded_vendor": project["contractor"],
            "awarded_amount": project["awarded_bid_total"],
            "primary_county": project["county_region"],
            "route": "",
            "work_type": project["work_type"],
            "contract_period": "",
            "dbe_goal": "",
            "bid_count": project["bid_count"],
            "location": project["project_location_raw"] or project["project_name"],
            "district": project["district"],
            "terrain": project["terrain"],
            "award_index": project["award_index"],
        })
        contract_projects.append({
            "contract_project_id": f"{contract_id}_project_1",
            "contract_id": contract_id,
            "project_number": project["project_number"],
            "project_name": project["project_name"],
            "work_type": project["work_type"],
            "county_region": project["county_region"],
            "route": "",
            "location": project["project_location_raw"],
            "project_award_amount": project["awarded_bid_total"],
        })

    agency_by_code = {row["item_code"].upper(): row["agency_item_id"] for row in legacy_agency_items}
    agency_items = []
    agency_versions = []
    for row in legacy_agency_items:
        version_id = f"{row['agency_item_id']}_v2026"
        agency_items.append({
            "agency_item_id": row["agency_item_id"],
            "state": "CO",
            "agency_id": "co_cdot",
            "agency_name": row["agency"],
            "item_code": row["item_code"],
            "current_version_id": version_id,
            "item_status": "current",
            "canonical_item_id": row["canonical_item_id"],
        })
        agency_versions.append({
            "agency_item_version_id": version_id,
            "agency_item_id": row["agency_item_id"],
            "effective_from": "2026-01-01",
            "effective_to": "",
            "official_description": row["official_description"],
            "official_abbreviated_description": row["official_abbreviated_description"],
            "official_unit": row["official_unit"],
            "spec_reference_code": row["item_code"].split("-")[0],
            "source_id": "cdot_item_code_book_2026",
            "is_current": "true",
        })

    # Cost books can contain valid retired codes that are absent from the current
    # item catalog. Preserve those as explicit historical agency items so promoted
    # evidence never relies on a raw code as its identity.
    historical_by_code = {}
    for row in legacy_observations:
        code = row["agency_item_code"].upper()
        if code and code not in agency_by_code:
            historical_by_code.setdefault(code, row)
    for code, row in sorted(historical_by_code.items()):
        agency_item_id = f"co_cdot_{code.lower()}"
        version_id = f"{agency_item_id}_historical"
        agency_by_code[code] = agency_item_id
        agency_items.append({
            "agency_item_id": agency_item_id,
            "state": "CO",
            "agency_id": "co_cdot",
            "agency_name": "CDOT",
            "item_code": code,
            "current_version_id": version_id,
            "item_status": "historical",
            "canonical_item_id": "",
        })
        agency_versions.append({
            "agency_item_version_id": version_id,
            "agency_item_id": agency_item_id,
            "effective_from": "",
            "effective_to": row["date_basis"],
            "official_description": row["description_raw"],
            "official_abbreviated_description": "",
            "official_unit": row["unit_normalized"],
            "spec_reference_code": code.split("-")[0],
            "source_id": row["source_id"],
            "is_current": "false",
        })

    observations = []
    for row in legacy_observations:
        agency_item_id = agency_by_code.get(row["agency_item_code"].upper(), "")
        observations.append({
            "observation_id": row["observation_id"],
            "contract_id": row["project_id"],
            "source_id": row["source_id"],
            "agency_item_id": agency_item_id,
            "agency_item_code": row["agency_item_code"],
            "description_raw": row["description_raw"],
            "description_normalized": row["description_normalized"],
            "unit_raw": row["unit_raw"],
            "unit_normalized": row["unit_normalized"],
            "quantity": row["quantity"],
            "unit_price": row["unit_price"],
            "extended_price": row["extended_price"],
            "discipline": row["discipline"],
            "price_type": map_price_type(row["price_type"]),
            "date_basis": row["date_basis"],
            "derivation_method": "source_reported",
            "derivation_input_count": "",
        })

    bids = []
    for row in legacy_bids:
        bids.append({
            "bid_id": row["bid_id"],
            "contract_id": row["project_id"],
            "source_id": row["source_id"],
            "source_vendor_id": "",
            "bidder_name": row["bidder_name"],
            "bid_rank": row["bid_rank"],
            "bid_total": row["bid_total"],
            "percent_of_low": "",
            "is_apparent_low": row["apparent_low"],
            "is_awarded": row.get("is_awarded", "false") or "false",
            "source_page": "",
        })

    contract_items = build_cost_book_contract_items(
        legacy / "imports",
        legacy_sources,
        legacy_observations,
        agency_by_code,
    )
    item_mappings = []
    seen_mappings: set[tuple[str, str, str]] = set()
    for row in legacy_bid_items:
        matched_code = row["matched_agency_item_code"].upper()
        agency_item_id = agency_by_code.get(matched_code, "")
        contract_items.append({
            "contract_item_id": row["bid_tab_item_id"],
            "contract_id": row["project_id"],
            "source_id": row["source_id"],
            "section_number": "",
            "section_title": row["sheet_name"],
            "line_number": row["source_item_number"] or row["workbook_row"],
            "source_item_code": row["source_item_code"],
            "agency_item_id": agency_item_id,
            "description_raw": row["source_item_description"],
            "quantity": row["quantity"],
            "unit_raw": row["unit_raw"],
            "unit_normalized": row["unit_normalized"],
            "alternate_set": "",
            "alternate_member": "",
            "mapping_status": row["match_status"],
            "source_page": "",
            "source_locator": f"{row['sheet_name']}:{row['workbook_row']}",
        })
        mapping_key = (row["source_item_code_system"], row["source_item_code"], agency_item_id)
        if agency_item_id and row["source_item_code_system"] != "CDOT" and mapping_key not in seen_mappings:
            seen_mappings.add(mapping_key)
            item_mappings.append({
                "mapping_id": f"co_map_{slug('_'.join(mapping_key))}",
                "state": "CO",
                "source_agency_id": f"co_{slug(row['source_item_code_system'])}",
                "source_item_code": row["source_item_code"],
                "target_agency_item_id": agency_item_id,
                "match_status": "reviewed",
                "confidence": "reviewed",
                "reviewed_by": "FHU",
                "reviewed_on": "",
                "notes": row["source_spec_raw"],
            })

    bid_item_prices = []
    for row in legacy_bid_prices:
        bid_item_prices.append({
            "bid_item_price_id": row["bidder_item_observation_id"],
            "contract_item_id": row["bid_tab_item_id"],
            "bid_id": row["bid_id"],
            "contract_id": row["project_id"],
            "source_id": row["source_id"],
            "unit_price": row["unit_price"],
            "extended_price": row["extended_price"],
            "source_page": "",
            "source_locator": row["bid_tab_item_id"],
        })

    taxonomy = []
    seen_divisions: set[str] = set()
    for row in legacy_sections:
        division = row["division_prefix"]
        division_id = f"co_cdot_div_{division}"
        if division not in seen_divisions:
            seen_divisions.add(division)
            taxonomy.append({
                "taxonomy_id": division_id,
                "state": "CO",
                "agency_id": "co_cdot",
                "taxonomy_level": "division",
                "taxonomy_code": division,
                "parent_taxonomy_id": "",
                "taxonomy_label": row["division_title"],
                "match_prefix": division,
                "source_year": row["source_year"],
                "source_url": row["source_url"],
            })
        taxonomy.append({
            "taxonomy_id": f"co_cdot_sec_{row['section_prefix']}",
            "state": "CO",
            "agency_id": "co_cdot",
            "taxonomy_level": "section",
            "taxonomy_code": row["section_prefix"],
            "parent_taxonomy_id": division_id,
            "taxonomy_label": row["section_title"],
            "match_prefix": row["section_prefix"],
            "source_year": row["source_year"],
            "source_url": row["source_url"],
        })

    fields = {
        "sources.csv": ["source_id", "source_type", "agency_id", "agency_name", "state", "source_label", "source_date", "data_year", "source_url", "source_file_name", "sha256", "parser_name", "parser_version", "notes"],
        "lettings.csv": ["letting_id", "source_id", "state", "agency_id", "letting_date", "letting_label"],
        "contracts.csv": ["contract_id", "letting_id", "source_id", "state", "agency_id", "official_contract_id", "call_order", "letting_status", "awarded_vendor", "awarded_amount", "primary_county", "route", "work_type", "contract_period", "dbe_goal", "bid_count", "location", "district", "terrain", "award_index"],
        "contract_projects.csv": ["contract_project_id", "contract_id", "project_number", "project_name", "work_type", "county_region", "route", "location", "project_award_amount"],
        "contract_items.csv": ["contract_item_id", "contract_id", "source_id", "section_number", "section_title", "line_number", "source_item_code", "agency_item_id", "description_raw", "quantity", "unit_raw", "unit_normalized", "alternate_set", "alternate_member", "mapping_status", "source_page", "source_locator"],
        "bids.csv": ["bid_id", "contract_id", "source_id", "source_vendor_id", "bidder_name", "bid_rank", "bid_total", "percent_of_low", "is_apparent_low", "is_awarded", "source_page"],
        "bid_item_prices.csv": ["bid_item_price_id", "contract_item_id", "bid_id", "contract_id", "source_id", "unit_price", "extended_price", "source_page", "source_locator"],
        "agency_items.csv": ["agency_item_id", "state", "agency_id", "agency_name", "item_code", "current_version_id", "item_status", "canonical_item_id"],
        "agency_item_versions.csv": ["agency_item_version_id", "agency_item_id", "effective_from", "effective_to", "official_description", "official_abbreviated_description", "official_unit", "spec_reference_code", "source_id", "is_current"],
        "item_taxonomy.csv": ["taxonomy_id", "state", "agency_id", "taxonomy_level", "taxonomy_code", "parent_taxonomy_id", "taxonomy_label", "match_prefix", "source_year", "source_url"],
        "item_mappings.csv": ["mapping_id", "state", "source_agency_id", "source_item_code", "target_agency_item_id", "match_status", "confidence", "reviewed_by", "reviewed_on", "notes"],
        "item_observations.csv": ["observation_id", "contract_id", "source_id", "agency_item_id", "agency_item_code", "description_raw", "description_normalized", "unit_raw", "unit_normalized", "quantity", "unit_price", "extended_price", "discipline", "price_type", "date_basis", "derivation_method", "derivation_input_count"],
    }
    data = {
        "sources.csv": sources,
        "lettings.csv": lettings,
        "contracts.csv": contracts,
        "contract_projects.csv": contract_projects,
        "contract_items.csv": contract_items,
        "bids.csv": bids,
        "bid_item_prices.csv": bid_item_prices,
        "agency_items.csv": agency_items,
        "agency_item_versions.csv": agency_versions,
        "item_taxonomy.csv": taxonomy,
        "item_mappings.csv": item_mappings,
        "item_observations.csv": observations,
    }
    for name, rows in data.items():
        write_csv(output / name, fields[name], rows)

    write_csv(output / "canonical_items.csv", list(legacy_canonical[0].keys()) if legacy_canonical else [], legacy_canonical)
    write_csv(output / "aliases.csv", list(legacy_aliases[0].keys()) if legacy_aliases else [], legacy_aliases)
    shutil.copyfile(legacy / "inflation_index.csv", args.common_dir / "inflation_index.csv")

    print(json.dumps({
        "state": "CO",
        "contracts": len(contracts),
        "contract_projects": len(contract_projects),
        "agency_items": len(agency_items),
        "observations": len(observations),
        "bids": len(bids),
        "contract_items": len(contract_items),
        "bid_item_prices": len(bid_item_prices),
    }, indent=2))


if __name__ == "__main__":
    main()
