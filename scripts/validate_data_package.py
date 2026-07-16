from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from decimal import Decimal, InvalidOperation
from pathlib import Path


FILE_KEYS = {
    "sources": "sources.csv",
    "lettings": "lettings.csv",
    "contracts": "contracts.csv",
    "contractProjects": "contract_projects.csv",
    "contractItems": "contract_items.csv",
    "bids": "bids.csv",
    "bidItemPrices": "bid_item_prices.csv",
    "agencyItems": "agency_items.csv",
    "agencyItemVersions": "agency_item_versions.csv",
    "itemTaxonomy": "item_taxonomy.csv",
    "itemMappings": "item_mappings.csv",
    "observations": "item_observations.csv",
}

ID_FIELDS = {
    "sources": "source_id",
    "lettings": "letting_id",
    "contracts": "contract_id",
    "contractProjects": "contract_project_id",
    "contractItems": "contract_item_id",
    "bids": "bid_id",
    "bidItemPrices": "bid_item_price_id",
    "agencyItems": "agency_item_id",
    "agencyItemVersions": "agency_item_version_id",
    "itemTaxonomy": "taxonomy_id",
    "itemMappings": "mapping_id",
    "observations": "observation_id",
}

REQUIRED = {
    "sources": ["source_id", "source_type", "agency_id", "agency_name", "state", "source_label", "sha256", "parser_name", "parser_version"],
    "lettings": ["letting_id", "source_id", "state", "agency_id", "letting_date"],
    "contracts": ["contract_id", "letting_id", "source_id", "state", "agency_id"],
    "contractProjects": ["contract_project_id", "contract_id"],
    "contractItems": ["contract_item_id", "contract_id", "source_id", "line_number", "source_item_code", "description_raw", "quantity", "unit_raw", "source_locator"],
    "bids": ["bid_id", "contract_id", "source_id", "bidder_name", "bid_rank", "bid_total"],
    "bidItemPrices": ["bid_item_price_id", "contract_item_id", "bid_id", "contract_id", "source_id", "unit_price", "extended_price", "source_locator"],
    "agencyItems": ["agency_item_id", "state", "agency_id", "item_code", "current_version_id", "item_status"],
    "agencyItemVersions": ["agency_item_version_id", "agency_item_id", "official_description", "official_unit", "source_id", "is_current"],
    "itemTaxonomy": ["taxonomy_id", "state", "agency_id", "taxonomy_level", "taxonomy_code", "taxonomy_label", "match_prefix"],
    "itemMappings": ["mapping_id", "state", "source_agency_id", "source_item_code", "target_agency_item_id", "match_status"],
    "observations": ["observation_id", "contract_id", "source_id", "agency_item_id", "agency_item_code", "description_raw", "unit_raw", "unit_normalized", "quantity", "unit_price", "extended_price", "price_type", "date_basis", "derivation_method"],
}

PRICE_TYPES = {"awarded_bid", "average_bid", "engineer_estimate"}
INFLATION_FIELDS = ["index_id", "index_name", "period_year", "period_quarter", "period_label", "period_start_date", "period_end_date", "index_value", "source_url"]
CONFIRMED_AWARD_STATUSES = {"AWARDED", "SIGNED CONTRACT"}


def read_csv(path: Path) -> tuple[list[str], list[dict[str, str]]]:
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        return reader.fieldnames or [], [
            {key: (value or "").strip() for key, value in row.items() if key is not None}
            for row in reader
        ]


def number(value: str) -> Decimal | None:
    if not value:
        return None
    try:
        return Decimal(value.replace("$", "").replace(",", "").replace("%", ""))
    except InvalidOperation:
        return None


def truth(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "y"}


def normalized_vendor(value: str) -> tuple[str, ...]:
    expanded = value.upper()
    expanded = re.sub(r"\b([A-Z])\.([A-Z])\.", r"\1\2", expanded)
    expanded = re.sub(r"\bCONSTR?\.?\b", "CONSTRUCTION", expanded)
    expanded = re.sub(r"\bEXCAV\.?\b", "EXCAVATING", expanded)
    expanded = re.sub(r"\bSUBSID\.?\b", "SUBSIDIARY", expanded)
    words = re.findall(r"[A-Z0-9]+", expanded)
    ignored = {"INC", "INCORPORATED", "LLC", "LC", "L", "C", "CO", "COMPANY", "CORP", "CORPORATION", "THE", "DBA", "D", "B", "A", "AKA", "JV", "JOINT", "VENTURE"}
    return tuple(sorted(word for word in words if word not in ignored))


def awarded_vendor_matches(awarded_vendor: str, bidder_name: str) -> bool:
    awarded = normalized_vendor(awarded_vendor)
    bidder = normalized_vendor(bidder_name)
    return awarded == bidder or set(awarded).issubset(set(bidder))


def add(error_list: list[str], state: str, table: str, message: str) -> None:
    error_list.append(f"{state}/{table}: {message}")


def validate_state(data_dir: Path, config: dict, errors: list[str], warnings: list[str]) -> dict[str, list[dict[str, str]]]:
    state = config["code"]
    tables: dict[str, list[dict[str, str]]] = {}
    headers_by_key: dict[str, list[str]] = {}

    for key, expected_name in FILE_KEYS.items():
        relative = config["files"].get(key)
        if not relative:
            if key == "bidItemPrices":
                tables[key] = []
                headers_by_key[key] = []
                continue
            add(errors, state, expected_name, "file is not declared in manifest")
            continue
        path = data_dir / relative
        if not path.exists():
            add(errors, state, expected_name, f"declared file does not exist: {relative}")
            continue
        headers, rows = read_csv(path)
        headers_by_key[key] = headers
        tables[key] = rows
        missing_headers = [field for field in REQUIRED[key] if field not in headers]
        if missing_headers:
            add(errors, state, expected_name, f"missing columns: {', '.join(missing_headers)}")
        identifier = ID_FIELDS[key]
        ids = [row.get(identifier, "") for row in rows]
        duplicates = [value for value, count in Counter(ids).items() if value and count > 1]
        for value in duplicates[:20]:
            add(errors, state, expected_name, f"duplicate {identifier} {value}")
        for index, row in enumerate(rows, 2):
            missing = [field for field in REQUIRED[key] if not row.get(field)]
            if missing:
                add(errors, state, expected_name, f"line {index} has blank required fields: {', '.join(missing)}")

    if any(key not in tables for key in FILE_KEYS):
        return tables

    sources = {row["source_id"]: row for row in tables["sources"]}
    lettings = {row["letting_id"]: row for row in tables["lettings"]}
    contracts = {row["contract_id"]: row for row in tables["contracts"]}
    contract_items = {row["contract_item_id"]: row for row in tables["contractItems"]}
    bids = {row["bid_id"]: row for row in tables["bids"]}
    agency_items = {row["agency_item_id"]: row for row in tables["agencyItems"]}
    versions = {row["agency_item_version_id"]: row for row in tables["agencyItemVersions"]}
    taxonomy = {row["taxonomy_id"]: row for row in tables["itemTaxonomy"]}

    for row in tables["lettings"]:
        if row["source_id"] not in sources:
            add(errors, state, "lettings.csv", f"{row['letting_id']} references missing source {row['source_id']}")
    for row in tables["contracts"]:
        if row["letting_id"] not in lettings:
            add(errors, state, "contracts.csv", f"{row['contract_id']} references missing letting {row['letting_id']}")
        if row["source_id"] not in sources:
            add(errors, state, "contracts.csv", f"{row['contract_id']} references missing source {row['source_id']}")
    for row in tables["contractProjects"]:
        if row["contract_id"] not in contracts:
            add(errors, state, "contract_projects.csv", f"{row['contract_project_id']} references missing contract {row['contract_id']}")
    for row in tables["contractItems"]:
        if row["contract_id"] not in contracts or row["source_id"] not in sources:
            add(errors, state, "contract_items.csv", f"{row['contract_item_id']} has a broken contract/source relationship")
        if row.get("agency_item_id") and row["agency_item_id"] not in agency_items:
            add(errors, state, "contract_items.csv", f"{row['contract_item_id']} references missing agency item {row['agency_item_id']}")
        for field in ("quantity",):
            if number(row[field]) is None:
                add(errors, state, "contract_items.csv", f"{row['contract_item_id']} has malformed {field}")
        if row.get("source_page") and number(row["source_page"]) is None:
            add(errors, state, "contract_items.csv", f"{row['contract_item_id']} has malformed source_page")

    ranks_by_contract: dict[str, list[int]] = defaultdict(list)
    apparent_by_contract: Counter[str] = Counter()
    awarded_by_contract: Counter[str] = Counter()
    for row in tables["bids"]:
        rank = number(row["bid_rank"])
        if row["contract_id"] not in contracts or row["source_id"] not in sources:
            add(errors, state, "bids.csv", f"{row['bid_id']} has a broken contract/source relationship")
        if rank is None or rank != rank.to_integral_value():
            add(errors, state, "bids.csv", f"{row['bid_id']} has a bidder header without an integer rank")
        else:
            ranks_by_contract[row["contract_id"]].append(int(rank))
        if number(row["bid_total"]) is None:
            add(errors, state, "bids.csv", f"{row['bid_id']} has malformed bid_total")
        apparent_by_contract[row["contract_id"]] += truth(row.get("is_apparent_low", ""))
        awarded_by_contract[row["contract_id"]] += truth(row.get("is_awarded", ""))
    for contract_id, ranks in ranks_by_contract.items():
        if len(ranks) != len(set(ranks)):
            add(errors, state, "bids.csv", f"{contract_id} has duplicate ranks")
        if apparent_by_contract[contract_id] != 1:
            add(errors, state, "bids.csv", f"{contract_id} has {apparent_by_contract[contract_id]} apparent-low bidders")

    price_sums: defaultdict[str, Decimal] = defaultdict(Decimal)
    added_option_price_sums: defaultdict[str, Decimal] = defaultdict(Decimal)
    price_counts: Counter[str] = Counter()
    prices_by_item: defaultdict[str, list[Decimal]] = defaultdict(list)
    for row in tables["bidItemPrices"]:
        item = contract_items.get(row["contract_item_id"])
        bid = bids.get(row["bid_id"])
        unit_price = number(row["unit_price"])
        extended = number(row["extended_price"])
        if not item or not bid or row["contract_id"] not in contracts or row["source_id"] not in sources:
            add(errors, state, "bid_item_prices.csv", f"{row['bid_item_price_id']} has a broken relationship")
            continue
        if item["contract_id"] != row["contract_id"] or bid["contract_id"] != row["contract_id"]:
            add(errors, state, "bid_item_prices.csv", f"{row['bid_item_price_id']} crosses contracts")
        quantity = number(item["quantity"])
        if quantity is None or unit_price is None or extended is None:
            add(errors, state, "bid_item_prices.csv", f"{row['bid_item_price_id']} has malformed numerics")
            continue
        if abs(quantity * unit_price - extended) > Decimal("0.02"):
            add(errors, state, "bid_item_prices.csv", f"{row['bid_item_price_id']} quantity x unit price does not reconcile")
        price_sums[row["bid_id"]] += extended
        if "ADDED OPTION" in item.get("section_title", "").upper():
            added_option_price_sums[row["bid_id"]] += extended
        price_counts[row["bid_id"]] += 1
        prices_by_item[row["contract_item_id"]].append(unit_price)

    if state == "IA":
        for bid_id, bid in bids.items():
            total = number(bid["bid_total"])
            if total is not None:
                difference = price_sums[bid_id] - total
                if abs(difference) > Decimal("0.02"):
                    if difference > 0 and added_option_price_sums[bid_id] >= difference:
                        warnings.append(f"{state}/bids.csv: {bid_id} item total includes preserved unselected added-option prices; difference {difference}")
                    else:
                        add(errors, state, "bids.csv", f"{bid_id} item total differs from reported bid total by {difference}")

    for row in tables["agencyItems"]:
        if row["current_version_id"] not in versions:
            add(errors, state, "agency_items.csv", f"{row['agency_item_id']} references missing current version")
        if row["item_status"] not in {"current", "historical"}:
            add(errors, state, "agency_items.csv", f"{row['agency_item_id']} has unsupported status {row['item_status']}")
    for row in tables["agencyItemVersions"]:
        if row["agency_item_id"] not in agency_items or row["source_id"] not in sources:
            add(errors, state, "agency_item_versions.csv", f"{row['agency_item_version_id']} has a broken agency-item/source relationship")
    for row in tables["itemTaxonomy"]:
        parent = row.get("parent_taxonomy_id")
        if parent and parent not in taxonomy:
            add(errors, state, "item_taxonomy.csv", f"{row['taxonomy_id']} references missing parent {parent}")
    for row in tables["itemMappings"]:
        if row["target_agency_item_id"] not in agency_items:
            add(errors, state, "item_mappings.csv", f"{row['mapping_id']} references missing target agency item")

    observations_by_item_type: dict[tuple[str, str], dict[str, str]] = {}
    for row in tables["observations"]:
        if row["contract_id"] not in contracts or row["source_id"] not in sources or row["agency_item_id"] not in agency_items:
            add(errors, state, "item_observations.csv", f"{row['observation_id']} has a broken contract/source/agency-item relationship")
        if row["price_type"] not in PRICE_TYPES:
            add(errors, state, "item_observations.csv", f"{row['observation_id']} has unsupported price_type {row['price_type']}")
        for field in ("quantity", "unit_price", "extended_price"):
            if number(row[field]) is None:
                add(errors, state, "item_observations.csv", f"{row['observation_id']} has malformed {field}")
        key = (row["observation_id"].rsplit("_", 1)[0], row["price_type"])
        observations_by_item_type[key] = row

    for contract_id, contract in contracts.items():
        contract_bids = [bid for bid in bids.values() if bid["contract_id"] == contract_id]
        if not contract_bids:
            continue
        if contract.get("letting_status", "").upper() in CONFIRMED_AWARD_STATUSES:
            if awarded_by_contract[contract_id] != 1:
                add(errors, state, "contracts.csv", f"{contract_id} has {awarded_by_contract[contract_id]} awarded bidders")
            awarded = [bid for bid in contract_bids if truth(bid.get("is_awarded", ""))]
            if awarded and not awarded_vendor_matches(contract.get("awarded_vendor", ""), awarded[0]["bidder_name"]):
                add(errors, state, "contracts.csv", f"{contract_id} awarded vendor does not resolve uniquely to awarded bidder")
            if awarded and contract.get("awarded_amount"):
                difference = abs((number(contract["awarded_amount"]) or Decimal()) - (number(awarded[0]["bid_total"]) or Decimal()))
                if difference > Decimal("0.02"):
                    add(errors, state, "contracts.csv", f"{contract_id} award amount differs from awarded bid by {difference}")
                elif difference:
                    warnings.append(f"{state}/contracts.csv: {contract_id} preserves a reported award/bid rounding difference of {difference}")

    return tables


def validate_iowa_acceptance(data_dir: Path, config: dict, tables: dict[str, list[dict[str, str]]], errors: list[str]) -> None:
    minimums = {
        "agencyItems": 3727,
        "contracts": 25,
        "contractProjects": 26,
        "bids": 90,
        "contractItems": 576,
    }
    for key, count in minimums.items():
        if len(tables.get(key, [])) < count:
            add(errors, "IA", FILE_KEYS[key], f"archive acceptance requires at least {count} rows; found {len(tables.get(key, []))}")
    if len(tables.get("lettings", [])) < 43:
        add(errors, "IA", "lettings.csv", f"archive acceptance requires at least 43 parsed lettings; found {len(tables.get('lettings', []))}")
    codes = [row["item_code"] for row in tables.get("agencyItems", [])]
    if len(codes) != len(set(codes)):
        add(errors, "IA", "agency_items.csv", "catalog item codes are not unique")
    if max((int(row["bid_rank"]) for row in tables.get("bids", [])), default=0) < 7:
        add(errors, "IA", "bids.csv", "seven-bidder grouped layout was not preserved")
    project_counts = Counter(row["contract_id"] for row in tables.get("contractProjects", []))
    if sum(count > 1 for count in project_counts.values()) < 1:
        add(errors, "IA", "contract_projects.csv", "expected at least one multi-project contract")
    if not any(row.get("alternate_set") == "AA" and row.get("alternate_member") for row in tables.get("contractItems", [])):
        add(errors, "IA", "contract_items.csv", "alternate set AA members were not preserved")
    native_path = data_dir.parent.parent / "data" / "staging" / "ia" / "item_catalog_native.csv"
    if native_path.exists():
        _, native = read_csv(native_path)
        if {row["item_code"] for row in native} != set(codes):
            add(errors, "IA", "item_catalog_native.csv", "TXT/PDF promoted code set does not match native staging")


def validate_common(data_dir: Path, manifest: dict, errors: list[str]) -> None:
    relative = manifest.get("common", {}).get("inflationIndexes", "")
    path = data_dir / relative
    if not relative or not path.exists():
        errors.append("manifest.json: common inflation index file is missing")
        return
    headers, rows = read_csv(path)
    missing = [field for field in INFLATION_FIELDS if field not in headers]
    if missing:
        errors.append(f"common/inflation_index.csv: missing columns: {', '.join(missing)}")
    ids = [row.get("index_id", "") for row in rows]
    periods = [row.get("period_label", "") for row in rows]
    if len(ids) != len(set(ids)):
        errors.append("common/inflation_index.csv: duplicate index_id")
    if len(periods) != len(set(periods)):
        errors.append("common/inflation_index.csv: duplicate period_label")
    for index, row in enumerate(rows, 2):
        for field in INFLATION_FIELDS:
            if not row.get(field):
                errors.append(f"common/inflation_index.csv: line {index} has blank {field}")
        for field in ("period_year", "period_quarter", "index_value"):
            value = number(row.get(field, ""))
            if value is None or value <= 0:
                errors.append(f"common/inflation_index.csv: line {index} has malformed {field}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate manifest-driven multi-state schema-v2 data.")
    parser.add_argument("--data-dir", type=Path, default=Path("public/data"))
    args = parser.parse_args()
    manifest_path = args.data_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors: list[str] = []
    warnings: list[str] = []
    if manifest.get("schemaVersion") != 2:
        errors.append("manifest.json: schemaVersion must be 2")
    if not manifest.get("states"):
        errors.append("manifest.json: no states are enabled")
    validate_common(args.data_dir, manifest, errors)

    summaries = []
    for config in manifest.get("states", []):
        tables = validate_state(args.data_dir, config, errors, warnings)
        if config["code"] == "IA":
            validate_iowa_acceptance(args.data_dir, config, tables, errors)
        summaries.append({key: len(rows) for key, rows in tables.items()})
        print(f"{config['code']}: " + ", ".join(f"{key}={len(rows):,}" for key, rows in tables.items()))

    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}")
    if errors:
        raise SystemExit(1)
    print("PASS: schema-v2 multi-state data validation completed with no errors.")


if __name__ == "__main__":
    main()
