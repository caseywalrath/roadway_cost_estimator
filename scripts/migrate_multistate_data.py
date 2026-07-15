from __future__ import annotations

import argparse
import csv
import hashlib
import json
import shutil
from collections import defaultdict
from pathlib import Path


LEGACY_DIR = Path("public/data")
OUTPUT_DIR = Path("public/data/states/co")
COMMON_DIR = Path("public/data/common")


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
    if normalized in {"cdot_awarded_bid", "bid_tab_demo"}:
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
    sources = []
    for row in legacy_sources:
        sources.append({
            "source_id": row["source_id"],
            "source_type": source_type(row["source_type"]),
            "agency_id": "co_cdot" if row["agency"].upper() == "CDOT" else "co_local",
            "agency_name": row["agency"],
            "state": "CO",
            "source_label": row["source_label"],
            "source_date": "",
            "data_year": row["data_year"],
            "source_url": "",
            "source_file_name": "",
            "sha256": file_sha256(source_paths[row["source_id"]]),
            "parser_name": "legacy_schema_v1_migration",
            "parser_version": "2.0.0",
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
            "is_awarded": "false",
            "source_page": "",
        })

    contract_items = []
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
