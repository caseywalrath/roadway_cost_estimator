from __future__ import annotations

import argparse
import csv
import json
import re
from collections import Counter, defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path


FILE_KEYS = {
    "sources": "sources.csv",
    "sourceDocuments": "source_documents.csv",
    "lettings": "lettings.csv",
    "contracts": "contracts.csv",
    "contractProjects": "contract_projects.csv",
    "contractItems": "contract_items.csv",
    "bids": "bids.csv",
    "bidItemPrices": "bid_item_prices.csv",
    "agencyItems": "agency_items.csv",
    "agencyItemVersions": "agency_item_versions.csv",
    "itemTaxonomy": "item_taxonomy.csv",
    "itemTaxonomyMemberships": "item_taxonomy_memberships.csv",
    "itemMappings": "item_mappings.csv",
    "observations": "item_observations.csv",
    "itemPriceSummaries": "item_price_summaries.csv",
}

ID_FIELDS = {
    "sources": "source_id",
    "sourceDocuments": "source_document_id",
    "lettings": "letting_id",
    "contracts": "contract_id",
    "contractProjects": "contract_project_id",
    "contractItems": "contract_item_id",
    "bids": "bid_id",
    "bidItemPrices": "bid_item_price_id",
    "agencyItems": "agency_item_id",
    "agencyItemVersions": "agency_item_version_id",
    "itemTaxonomy": "taxonomy_id",
    "itemTaxonomyMemberships": "membership_id",
    "itemMappings": "mapping_id",
    "observations": "observation_id",
    "itemPriceSummaries": "summary_id",
}

REQUIRED = {
    "sources": ["source_id", "source_type", "agency_id", "agency_name", "state", "source_label", "sha256", "parser_name", "parser_version"],
    "sourceDocuments": ["source_document_id", "source_id", "document_role", "source_url", "source_file_name", "sha256", "media_type", "published_on", "retrieved_on"],
    "lettings": ["letting_id", "source_id", "state", "agency_id", "letting_date"],
    "contracts": ["contract_id", "letting_id", "source_id", "state", "agency_id"],
    "contractProjects": ["contract_project_id", "contract_id"],
    "contractItems": ["contract_item_id", "contract_id", "source_id", "line_number", "source_item_code", "description_raw", "quantity", "unit_raw", "source_locator"],
    "bids": ["bid_id", "contract_id", "source_id", "bidder_name", "bid_rank", "bid_total"],
    "bidItemPrices": ["bid_item_price_id", "contract_item_id", "bid_id", "contract_id", "source_id", "unit_price", "extended_price", "source_locator"],
    "agencyItems": ["agency_item_id", "state", "agency_id", "item_code", "current_version_id", "item_status"],
    "agencyItemVersions": ["agency_item_version_id", "agency_item_id", "official_description", "official_unit", "source_id", "is_current"],
    "itemTaxonomy": ["taxonomy_id", "state", "agency_id", "taxonomy_level", "taxonomy_code", "taxonomy_label", "match_prefix"],
    "itemTaxonomyMemberships": ["membership_id", "state", "agency_id", "agency_item_id", "taxonomy_id", "source_id", "match_status", "notes"],
    "itemMappings": ["mapping_id", "state", "source_agency_id", "source_item_code", "target_agency_item_id", "match_status"],
    "observations": ["observation_id", "contract_id", "source_id", "agency_item_id", "agency_item_code", "description_raw", "unit_raw", "unit_normalized", "quantity", "unit_price", "extended_price", "price_type", "date_basis", "derivation_method"],
    "itemPriceSummaries": ["summary_id", "source_id", "state", "agency_id", "agency_item_id", "agency_item_code", "period_start_date", "period_end_date", "period_label", "report_series", "description_raw", "total_quantity", "unit_raw", "unit_normalized", "published_average_unit_price", "total_bid", "source_page", "source_locator", "derivation_method"],
}

PRICE_TYPES = {"awarded_bid", "average_bid", "engineer_estimate"}
INFLATION_FIELDS = ["index_id", "index_name", "period_year", "period_quarter", "period_label", "period_start_date", "period_end_date", "index_value", "source_url"]
CONFIRMED_AWARD_STATUSES = {"AWARDED", "SIGNED CONTRACT"}
OPTIONAL_TABLES = {"sourceDocuments", "bidItemPrices", "itemTaxonomyMemberships", "itemPriceSummaries"}
REPORT_SERIES = {"calendar_year", "july_june"}
TAXONOMY_MEMBERSHIP_STATUSES = {"catalog_exact", "reviewed_override", "unclassified"}
PERIOD_SUMMARY_DERIVATION = "ndot_published_period_aggregate"


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


def validate_period_summary_rows(
    state: str,
    config: dict,
    rows: list[dict[str, str]],
    headers: list[str],
    sources: dict[str, dict[str, str]],
    agency_items: dict[str, dict[str, str]],
    errors: list[str],
) -> None:
    forbidden_fields = {"contract_id", "letting_id", "bid_id", "price_type", "bidder_count"}
    for field in sorted(forbidden_fields.intersection(headers)):
        add(errors, state, "item_price_summaries.csv", f"must not include contract-level field {field}")

    seen_locators: dict[tuple[str, str, str, str, str], set[str]] = defaultdict(set)
    for index, row in enumerate(rows, 2):
        source = sources.get(row.get("source_id", ""))
        item = agency_items.get(row.get("agency_item_id", ""))
        if source is None:
            add(errors, state, "item_price_summaries.csv", f"line {index} references missing source {row.get('source_id', '')}")
        if item is None:
            add(errors, state, "item_price_summaries.csv", f"line {index} references missing agency item {row.get('agency_item_id', '')}")
        if row.get("state", "").upper() != state.upper():
            add(errors, state, "item_price_summaries.csv", f"line {index} has state {row.get('state', '')}")
        if row.get("agency_id", "") != config.get("defaultAgencyId", ""):
            add(errors, state, "item_price_summaries.csv", f"line {index} has agency {row.get('agency_id', '')}")
        if item and (item.get("state", "").upper() != state.upper() or item.get("agency_id", "") != row.get("agency_id", "")):
            add(errors, state, "item_price_summaries.csv", f"line {index} does not match agency item state/agency")
        if source and (source.get("state", "").upper() != state.upper() or source.get("agency_id", "") != row.get("agency_id", "")):
            add(errors, state, "item_price_summaries.csv", f"line {index} does not match source state/agency")

        start = row.get("period_start_date", "")
        end = row.get("period_end_date", "")
        try:
            start_date = date.fromisoformat(start)
            end_date = date.fromisoformat(end)
            if start_date > end_date:
                add(errors, state, "item_price_summaries.csv", f"line {index} period start is after period end")
        except ValueError:
            add(errors, state, "item_price_summaries.csv", f"line {index} has invalid ISO period dates")

        if row.get("report_series", "") not in REPORT_SERIES:
            add(errors, state, "item_price_summaries.csv", f"line {index} has unsupported report_series {row.get('report_series', '')}")
        quantity = number(row.get("total_quantity", ""))
        average = number(row.get("published_average_unit_price", ""))
        total_bid = number(row.get("total_bid", ""))
        if quantity is None or average is None or total_bid is None:
            add(errors, state, "item_price_summaries.csv", f"line {index} has malformed numeric values")
        source_page = number(row.get("source_page", ""))
        if source_page is None or source_page <= 0 or source_page != source_page.to_integral_value():
            add(errors, state, "item_price_summaries.csv", f"line {index} has invalid source_page")
        if not row.get("source_locator", ""):
            add(errors, state, "item_price_summaries.csv", f"line {index} has blank source_locator")
        if row.get("derivation_method", "") != PERIOD_SUMMARY_DERIVATION:
            add(errors, state, "item_price_summaries.csv", f"line {index} has unsupported derivation_method")

        duplicate_key = (
            row.get("source_id", ""),
            row.get("agency_item_id", ""),
            row.get("unit_raw", ""),
            start,
            end,
        )
        locator = row.get("source_locator", "")
        if locator in seen_locators[duplicate_key]:
            add(errors, state, "item_price_summaries.csv", f"line {index} duplicates source/item/unit/period locator")
        seen_locators[duplicate_key].add(locator)

        # NDOT publishes the average unit price and total bid as separate
        # period aggregates.  Their documented calculation method is not
        # available, so a rounded-unit-price multiplication is a QA report,
        # not a validity condition for annual_price_summary sources.
        if quantity is not None and average is not None and total_bid is not None and quantity != 0 and not (source and source.get("source_type") == "annual_price_summary"):
            difference = abs(total_bid - quantity * average)
            tolerance = max(Decimal("0.02"), abs(quantity) * Decimal("0.005") + Decimal("0.01"))
            if difference > tolerance:
                add(errors, state, "item_price_summaries.csv", f"line {index} total_bid does not reconcile to rounded average")


def validate_taxonomy_membership_rows(
    state: str,
    config: dict,
    rows: list[dict[str, str]],
    sources: dict[str, dict[str, str]],
    agency_items: dict[str, dict[str, str]],
    taxonomy: dict[str, dict[str, str]],
    errors: list[str],
) -> None:
    memberships_by_item: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for index, row in enumerate(rows, 2):
        source = sources.get(row.get("source_id", ""))
        item = agency_items.get(row.get("agency_item_id", ""))
        section = taxonomy.get(row.get("taxonomy_id", ""))
        if source is None:
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} references missing source")
        if item is None:
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} references missing agency item")
        if section is None:
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} references missing taxonomy")
        if row.get("state", "").upper() != state.upper():
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} has state {row.get('state', '')}")
        if row.get("agency_id", "") != config.get("defaultAgencyId", ""):
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} has agency {row.get('agency_id', '')}")
        if item and (item.get("state", "").upper() != state.upper() or item.get("agency_id", "") != row.get("agency_id", "")):
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} does not match agency item state/agency")
        if source and (source.get("state", "").upper() != state.upper() or source.get("agency_id", "") != row.get("agency_id", "")):
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} does not match source state/agency")
        if section and (section.get("state", "").upper() != state.upper() or section.get("agency_id", "") != row.get("agency_id", "")):
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} does not match taxonomy state/agency")
        if section and section.get("taxonomy_level", "") != "section":
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} target taxonomy is not a section")
        if row.get("match_status", "") not in TAXONOMY_MEMBERSHIP_STATUSES:
            add(errors, state, "item_taxonomy_memberships.csv", f"line {index} has unsupported match_status")
        memberships_by_item[row.get("agency_item_id", "")].append(row)

    if config.get("files", {}).get("itemTaxonomyMemberships"):
        for item_id, item in agency_items.items():
            if item.get("item_status", "") == "current" and not memberships_by_item.get(item_id):
                add(errors, state, "item_taxonomy_memberships.csv", f"searchable item {item_id} has no taxonomy membership")


def validate_state(data_dir: Path, config: dict, errors: list[str], warnings: list[str]) -> dict[str, list[dict[str, str]]]:
    state = config["code"]
    tables: dict[str, list[dict[str, str]]] = {}
    headers_by_key: dict[str, list[str]] = {}

    for key, expected_name in FILE_KEYS.items():
        relative = config["files"].get(key)
        if not relative:
            if key in OPTIONAL_TABLES:
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
    reviewed_sd_awards: set[tuple[str, str, str]] = set()
    if state == "SD":
        override_path = data_dir.parent.parent / "data" / "overrides" / "sd" / "award_matches.csv"
        if override_path.exists():
            _, override_rows = read_csv(override_path)
            reviewed_sd_awards = {
                (
                    row.get("letting_date", ""),
                    row.get("item_number", ""),
                    row.get("bidder_name", ""),
                )
                for row in override_rows
            }

    for row in tables["sourceDocuments"]:
        if row["source_id"] not in sources:
            add(errors, state, "source_documents.csv", f"{row['source_document_id']} references missing source {row['source_id']}")
        if not re.match(r"^https?://", row["source_url"]):
            add(errors, state, "source_documents.csv", f"{row['source_document_id']} has malformed source_url")
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
            if state == "SD":
                warnings.append(f"{state}/bid_item_prices.csv: {row['bid_item_price_id']} preserves a reported quantity/unit/extension difference")
            else:
                add(errors, state, "bid_item_prices.csv", f"{row['bid_item_price_id']} quantity x unit price does not reconcile")
        price_sums[row["bid_id"]] += extended
        if "ADDED OPTION" in item.get("section_title", "").upper():
            added_option_price_sums[row["bid_id"]] += extended
        price_counts[row["bid_id"]] += 1
        prices_by_item[row["contract_item_id"]].append(unit_price)

    if state in {"IA", "SD"}:
        for bid_id, bid in bids.items():
            total = number(bid["bid_total"])
            if total is not None:
                difference = price_sums[bid_id] - total
                tolerance = (
                    Decimal("0.01") * max(price_counts[bid_id], 2)
                    if state == "SD"
                    else Decimal("0.02")
                )
                if abs(difference) > tolerance:
                    if state == "IA" and difference > 0 and added_option_price_sums[bid_id] >= difference:
                        warnings.append(f"{state}/bids.csv: {bid_id} item total includes preserved unselected added-option prices; difference {difference}")
                    elif state == "SD":
                        warnings.append(f"{state}/bids.csv: {bid_id} preserves a reported item/bid total difference of {difference}")
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

    validate_period_summary_rows(
        state,
        config,
        tables["itemPriceSummaries"],
        headers_by_key.get("itemPriceSummaries", []),
        sources,
        agency_items,
        errors,
    )
    validate_taxonomy_membership_rows(
        state,
        config,
        tables["itemTaxonomyMemberships"],
        sources,
        agency_items,
        taxonomy,
        errors,
    )

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
            letting_date = lettings.get(contract.get("letting_id", ""), {}).get("letting_date", "")
            has_reviewed_override = bool(awarded) and (
                letting_date,
                contract.get("call_order", ""),
                awarded[0]["bidder_name"],
            ) in reviewed_sd_awards
            if (
                awarded
                and not awarded_vendor_matches(contract.get("awarded_vendor", ""), awarded[0]["bidder_name"])
                and not has_reviewed_override
            ):
                add(errors, state, "contracts.csv", f"{contract_id} awarded vendor does not resolve uniquely to awarded bidder")
            if awarded and contract.get("awarded_amount"):
                difference = abs((number(contract["awarded_amount"]) or Decimal()) - (number(awarded[0]["bid_total"]) or Decimal()))
                tolerance = (
                    Decimal("0.01") * max(price_counts[awarded[0]["bid_id"]], 2)
                    if state == "SD"
                    else Decimal("0.02")
                )
                if difference > tolerance:
                    if state == "SD":
                        warnings.append(f"{state}/contracts.csv: {contract_id} preserves a reported award/bid total difference of {difference}")
                    else:
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


def validate_south_dakota_acceptance(
    data_dir: Path,
    config: dict,
    tables: dict[str, list[dict[str, str]]],
    errors: list[str],
) -> None:
    staging_dir = data_dir.parent.parent / "data" / "staging" / "sd"
    inventory_path = staging_dir / "letting_inventory.csv"
    catalog_path = staging_dir / "item_catalog_native.csv"
    annual_path = staging_dir / "annual_price_report_2024.csv"
    annual_reconciliation_path = staging_dir / "annual_price_reconciliation_2024.csv"
    review_path = staging_dir / "review_exceptions.csv"
    summary_path = staging_dir / "import_summary.json"
    summary: dict[str, int] = {}
    if not summary_path.exists():
        add(errors, "SD", "import_summary.json", "import summary is missing")
    else:
        summary = json.loads(summary_path.read_text(encoding="utf-8"))

    if not inventory_path.exists():
        add(errors, "SD", "letting_inventory.csv", "completed-letting inventory is missing")
    else:
        _, inventory = read_csv(inventory_path)
        if len(inventory) < 175:
            add(errors, "SD", "letting_inventory.csv", f"expected at least 175 entries from 2019 forward; found {len(inventory)}")
        if summary and summary.get("archive_entries") != len(inventory):
            add(errors, "SD", "import_summary.json", "archive entry count does not match letting inventory")
        silent = [
            row for row in inventory
            if row.get("parse_status") != "parsed" and not row.get("notes")
        ]
        if silent:
            add(errors, "SD", "letting_inventory.csv", f"{len(silent)} non-parsed entries lack an explicit reason")
        parsed_inventory = sum(row.get("parse_status") == "parsed" for row in inventory)
        if parsed_inventory != len(tables.get("lettings", [])):
            add(errors, "SD", "letting_inventory.csv", "parsed inventory count does not match lettings.csv")

    if not catalog_path.exists():
        add(errors, "SD", "item_catalog_native.csv", "native catalog staging is missing")
    else:
        _, native = read_csv(catalog_path)
        deleted = [
            row for row in native
            if row.get("is_deleted", "").lower() == "true"
        ]
        current = [
            row for row in native
            if row.get("is_deleted", "").lower() != "true"
        ]
        catalog_source = next(
            (row for row in tables.get("sources", []) if row.get("source_type") == "item_catalog"),
            {},
        )
        is_initial_snapshot = catalog_source.get("source_date") == "2026-07-27"
        if is_initial_snapshot and (
            len(native) != 5583 or len(deleted) != 9 or len(current) != 5574
        ):
            add(
                errors,
                "SD",
                "item_catalog_native.csv",
                f"initial catalog snapshot expected 5,583 rows, nine deleted placeholders, and 5,574 current rows; found {len(native)}, {len(deleted)}, {len(current)}",
            )
        if summary and (
            summary.get("catalog_rows") != len(native)
            or summary.get("catalog_deleted_placeholders") != len(deleted)
            or summary.get("catalog_current_items") != len(current)
        ):
            add(errors, "SD", "import_summary.json", "catalog counts do not match native catalog staging")
        current_codes = {row["item_code"] for row in current}
        published_current = {
            row["item_code"] for row in tables.get("agencyItems", [])
            if row.get("item_status") == "current"
        }
        if current_codes != published_current:
            add(errors, "SD", "agency_items.csv", "published current code set does not match native catalog")

    if not annual_path.exists():
        add(errors, "SD", "annual_price_report_2024.csv", "2024 annual-report staging is missing")
    else:
        _, annual = read_csv(annual_path)
        if len(annual) != 1431:
            add(errors, "SD", "annual_price_report_2024.csv", f"expected 1,431 annual rows; found {len(annual)}")
        if not annual_reconciliation_path.exists():
            add(errors, "SD", "annual_price_reconciliation_2024.csv", "annual-report reconciliation is missing")
        else:
            reconciliation_headers, reconciliation = read_csv(annual_reconciliation_path)
            required_reconciliation_fields = {
                "item_code",
                "catalog_code_match",
                "catalog_unit_match",
                "quantity_difference",
                "total_cost_difference",
                "average_low_difference",
            }
            missing_fields = required_reconciliation_fields - set(reconciliation_headers)
            if missing_fields:
                add(
                    errors,
                    "SD",
                    "annual_price_reconciliation_2024.csv",
                    f"missing reconciliation fields: {', '.join(sorted(missing_fields))}",
                )
            if len(reconciliation) != len(annual):
                add(
                    errors,
                    "SD",
                    "annual_price_reconciliation_2024.csv",
                    f"expected one reconciliation row per annual row; found {len(reconciliation)} for {len(annual)} annual rows",
                )
            annual_codes = [row.get("item_code", "") for row in annual]
            reconciliation_codes = [row.get("item_code", "") for row in reconciliation]
            if annual_codes != reconciliation_codes:
                add(errors, "SD", "annual_price_reconciliation_2024.csv", "annual and reconciliation item-code sequences differ")
            for row_number, row in enumerate(reconciliation, 2):
                for field in (
                    "catalog_code_match",
                    "catalog_unit_match",
                    "quantity_difference",
                    "total_cost_difference",
                    "average_low_difference",
                ):
                    if row.get(field, "") == "":
                        add(
                            errors,
                            "SD",
                            "annual_price_reconciliation_2024.csv",
                            f"line {row_number} does not explicitly record {field}",
                        )

    reviews: list[dict[str, str]] = []
    if review_path.exists():
        _, reviews = read_csv(review_path)
        unresolved_awards = [
            row for row in reviews if row.get("category") == "award_resolution"
        ]
        if unresolved_awards:
            add(errors, "SD", "review_exceptions.csv", f"{len(unresolved_awards)} awarded contracts remain unresolved")
    else:
        add(errors, "SD", "review_exceptions.csv", "review exception staging is missing")
    review_details_by_category: defaultdict[str, list[str]] = defaultdict(list)
    review_contracts_by_category: defaultdict[str, set[str]] = defaultdict(set)
    for row in reviews:
        review_details_by_category[row.get("category", "")].append(row.get("details", ""))
        review_contracts_by_category[row.get("category", "")].add(row.get("contract_id", ""))

    codes = [row["item_code"] for row in tables.get("agencyItems", [])]
    if len(codes) != len(set(codes)):
        add(errors, "SD", "agency_items.csv", "catalog item codes are not unique")

    contracts = {row["contract_id"]: row for row in tables.get("contracts", [])}
    allowed_statuses = {"AWARDED", "WITHDRAWN", "NO BIDS", "REJECTED", "CANCELLED"}
    for contract_id, contract in contracts.items():
        if contract.get("letting_status") not in allowed_statuses:
            add(
                errors,
                "SD",
                "contracts.csv",
                f"{contract_id} has unsupported normalized status {contract.get('letting_status')!r}",
            )
    bids = {row["bid_id"]: row for row in tables.get("bids", [])}
    bids_by_contract: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for bid in bids.values():
        bids_by_contract[bid["contract_id"]].append(bid)
    for contract_id, contract in contracts.items():
        contract_bids = bids_by_contract.get(contract_id, [])
        awarded_count = sum(truth(bid.get("is_awarded", "")) for bid in contract_bids)
        if contract.get("letting_status") == "AWARDED" and awarded_count != 1:
            add(errors, "SD", "bids.csv", f"{contract_id} must have one confirmed awarded bidder")
        if contract.get("letting_status") != "AWARDED" and awarded_count:
            add(errors, "SD", "bids.csv", f"{contract_id} is not awarded but has an awarded bidder")
        if contract.get("letting_status") == "NO BIDS" and contract_bids:
            add(errors, "SD", "bids.csv", f"{contract_id} is NO BIDS but contains bidder rows")
    items = {row["contract_item_id"]: row for row in tables.get("contractItems", [])}
    prices_by_item: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    price_sums_by_bid: defaultdict[str, Decimal] = defaultdict(Decimal)
    price_counts_by_bid: Counter[str] = Counter()
    for row in tables.get("bidItemPrices", []):
        prices_by_item[row["contract_item_id"]].append(row)
        price_sums_by_bid[row["bid_id"]] += number(row["extended_price"]) or Decimal()
        price_counts_by_bid[row["bid_id"]] += 1
        item = items.get(row["contract_item_id"])
        if item:
            quantity = number(item["quantity"]) or Decimal()
            unit_price = number(row["unit_price"]) or Decimal()
            extended = number(row["extended_price"]) or Decimal()
            if abs(quantity * unit_price - extended) > Decimal("0.02"):
                if not any(
                    row["bid_item_price_id"] in details
                    for details in review_details_by_category["line_extension_difference"]
                ):
                    add(errors, "SD", "review_exceptions.csv", f"{row['bid_item_price_id']} line-extension difference is not explicitly reviewed")
    for bid_id, bid in bids.items():
        reported_total = number(bid["bid_total"]) or Decimal()
        difference = price_sums_by_bid[bid_id] - reported_total
        tolerance = Decimal("0.01") * max(price_counts_by_bid[bid_id], 2)
        if abs(difference) > tolerance and not any(
            bid_id in details for details in review_details_by_category["bid_total_difference"]
        ):
            add(errors, "SD", "review_exceptions.csv", f"{bid_id} bid-total difference is not explicitly reviewed")
    for contract_id, contract in contracts.items():
        if contract.get("letting_status") != "AWARDED":
            continue
        awarded = [
            bid for bid in bids.values()
            if bid["contract_id"] == contract_id and truth(bid.get("is_awarded", ""))
        ]
        if len(awarded) != 1 or not contract.get("awarded_amount"):
            continue
        difference = abs(
            (number(contract["awarded_amount"]) or Decimal())
            - (number(awarded[0]["bid_total"]) or Decimal())
        )
        tolerance = Decimal("0.01") * max(price_counts_by_bid[awarded[0]["bid_id"]], 2)
        if (
            difference > tolerance
            and contract_id not in review_contracts_by_category["award_amount_difference"]
        ):
            add(errors, "SD", "review_exceptions.csv", f"{contract_id} award/bid difference is not explicitly reviewed")
    observations_by_item: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
    for row in tables.get("observations", []):
        item_id = row["observation_id"].rsplit("_", 1)[0]
        observations_by_item[item_id].append(row)

    for item_id, item in items.items():
        contract = contracts.get(item["contract_id"])
        observations = observations_by_item.get(item_id, [])
        if (
            item.get("mapping_status") in {"source_deleted", "unmatched"}
            or not contract
            or contract.get("letting_status") != "AWARDED"
        ) and observations:
            add(errors, "SD", "item_observations.csv", f"{item_id} has observations despite mapping/status exclusion")
        if not observations:
            continue
        item_prices = prices_by_item[item_id]
        awarded_prices = [
            row for row in item_prices
            if truth(bids.get(row["bid_id"], {}).get("is_awarded", ""))
        ]
        awarded_observations = [row for row in observations if row["price_type"] == "awarded_bid"]
        average_observations = [row for row in observations if row["price_type"] == "average_bid"]
        if len(awarded_prices) != 1 or len(awarded_observations) != 1:
            add(errors, "SD", "item_observations.csv", f"{item_id} does not have one source/observation awarded price")
        elif number(awarded_prices[0]["unit_price"]) != number(awarded_observations[0]["unit_price"]):
            add(errors, "SD", "item_observations.csv", f"{item_id} awarded observation differs from source price")
        if item_prices:
            expected_average = sum((number(row["unit_price"]) or Decimal() for row in item_prices), Decimal()) / len(item_prices)
            if len(average_observations) != 1 or abs((number(average_observations[0]["unit_price"]) or Decimal()) - expected_average) > Decimal("0.00001"):
                add(errors, "SD", "item_observations.csv", f"{item_id} average observation does not equal the all-bid mean")


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
        if "periodPriceHistory" not in config.get("capabilities", {}):
            errors.append(f"{config.get('code', '(unknown)')}/manifest.json: capabilities.periodPriceHistory is required")
        tables = validate_state(args.data_dir, config, errors, warnings)
        if config["code"] == "IA":
            validate_iowa_acceptance(args.data_dir, config, tables, errors)
        if config["code"] == "SD":
            validate_south_dakota_acceptance(args.data_dir, config, tables, errors)
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
