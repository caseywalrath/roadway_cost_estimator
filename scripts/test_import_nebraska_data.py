#!/usr/bin/env python3
"""Offline tests for the NDOT coordinate parser and staged NE package."""

from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from scripts.import_nebraska_data import parse_words_page, unit_normalized
from scripts.validate_data_package import validate_state

FIXTURE_DIR = ROOT / "data" / "staging" / "ne" / "parser_fixtures"
STATE_DIR = ROOT / "public" / "data" / "states" / "ne"
STAGING_DIR = ROOT / "data" / "staging" / "ne"


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as handle:
        return list(csv.DictReader(handle))


def run_fixture_tests() -> int:
    checked = 0
    for path in sorted(FIXTURE_DIR.glob("*.json")):
        fixture = json.loads(path.read_text(encoding="utf-8"))
        parsed, failures = parse_words_page(fixture["words"], f"fixture-{path.stem}.pdf", int(fixture["page_number"]))
        if failures:
            raise AssertionError(f"{path.name}: unexpected parser failures: {failures}")
        actual = [
            {key: row.get(key, "") for key in ("agency_item_code", "description_raw", "total_quantity", "unit_raw", "published_average_unit_price", "total_bid")}
            for row in parsed
        ]
        if actual != fixture["expected_rows"]:
            raise AssertionError(f"{path.name}: expected {fixture['expected_rows']!r}, got {actual!r}")
        checked += 1
    print(f"PASS: checked {checked} coordinate parser fixtures.")
    return 0


def run_package_tests() -> int:
    run_fixture_tests()
    if unit_normalized("VERT FT") != "VFT":
        raise AssertionError("VERT FT must normalize to VFT for identity comparison")
    inventory = read_rows(STAGING_DIR / "annual_price_report_inventory.csv")
    in_scope = [row for row in inventory if row.get("inventory_status") == "parsed"]
    if len(in_scope) != 17:
        raise AssertionError(f"expected 17 in-scope inventory reports, found {len(in_scope)}")
    summaries = read_rows(STATE_DIR / "item_price_summaries.csv")
    if not summaries:
        raise AssertionError("item_price_summaries.csv is empty")
    if {row["report_series"] for row in summaries} != {"calendar_year", "july_june"}:
        raise AssertionError("both NDOT report series must be present")
    if any(row["published_average_unit_price"].startswith("-") for row in summaries) is False:
        raise AssertionError("negative published price was not preserved")
    failures = read_rows(STAGING_DIR / "annual_price_parse_failures.csv")
    if failures:
        raise AssertionError(f"parser failures remain: {failures[:2]}")
    acceptance = read_rows(STAGING_DIR / "annual_price_acceptance.csv")
    if len(acceptance) != 17 or any(row["expected_row_count"] != row["parsed_row_count"] or row["acceptance_status"] != "accepted" for row in acceptance):
        raise AssertionError("annual acceptance counts are not frozen and accepted")
    if read_rows(STATE_DIR / "item_observations.csv"):
        raise AssertionError("period summaries must not synthesize observations")
    resolutions = read_rows(STAGING_DIR / "item_identity_resolutions.csv")
    if not resolutions:
        raise AssertionError("item_identity_resolutions.csv is empty")
    resolution_ids = {row.get("conflict_id") for row in resolutions}
    conflict_ids = {row.get("conflict_id") for row in read_rows(STAGING_DIR / "item_identity_conflicts.csv")}
    if not conflict_ids.issubset(resolution_ids):
        raise AssertionError("every material identity conflict must have a resolution row")
    if conflict_ids:
        raise AssertionError(f"unresolved Nebraska identity conflicts remain: {sorted(conflict_ids)[:5]}")
    if read_rows(STAGING_DIR / "item_identity_human_review.csv"):
        raise AssertionError("human-only Nebraska semantic review queue must be empty before enablement")
    if any(not row.get("automatic_classification") or not row.get("resolution_status") for row in resolutions):
        raise AssertionError("identity resolution rows must record automatic classification and status")
    if any(row.get("resolution_status") == "needs_review" for row in resolutions):
        raise AssertionError("identity resolution file contains unresolved rows")
    config = {
        "code": "NE", "defaultAgencyId": "ne_ndot",
        "files": {
            "sources": "states/ne/sources.csv", "lettings": "states/ne/lettings.csv", "contracts": "states/ne/contracts.csv", "contractProjects": "states/ne/contract_projects.csv", "contractItems": "states/ne/contract_items.csv", "bids": "states/ne/bids.csv", "agencyItems": "states/ne/agency_items.csv", "agencyItemVersions": "states/ne/agency_item_versions.csv", "itemTaxonomy": "states/ne/item_taxonomy.csv", "itemTaxonomyMemberships": "states/ne/item_taxonomy_memberships.csv", "itemMappings": "states/ne/item_mappings.csv", "observations": "states/ne/item_observations.csv", "itemPriceSummaries": "states/ne/item_price_summaries.csv",
        },
    }
    errors: list[str] = []
    warnings: list[str] = []
    validate_state(ROOT / "public" / "data", config, errors, warnings)
    if errors:
        raise AssertionError("NE package validation errors: " + " | ".join(errors[:10]))
    print(f"PASS: validated NE package with {len(summaries):,} annual rows and no schema errors.")
    return 0


if __name__ == "__main__":
    raise SystemExit(run_package_tests())
