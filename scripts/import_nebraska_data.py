#!/usr/bin/env python3
"""Import NDOT annual average unit-price reports into the NE data partition.

The annual reports are period aggregates, not contract evidence.  This importer
therefore writes item_price_summaries.csv and leaves the contract evidence
tables empty.  Cached mode is deliberately offline; --refresh is the only mode
that performs downloads.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import sys
import re
import urllib.request
from collections import defaultdict
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Iterable

import pdfplumber
from pypdf import PdfReader

ROOT = Path(__file__).resolve().parents[1]
RAW_REPORT_DIR = ROOT / "data" / "raw" / "ne" / "annual_price_reports"
RAW_CATALOG_DIR = ROOT / "data" / "raw" / "ne" / "catalog"
STAGING_DIR = ROOT / "data" / "staging" / "ne"
STATE_DIR = ROOT / "public" / "data" / "states" / "ne"
LISTING_URL = "https://dot.nebraska.gov/business-center/hwy-bridge-lp/item-history/"
RETRIEVED_ON = "2026-08-05"

sys.path.insert(0, str(ROOT))
from scripts import audit_nebraska_phase1 as audit

REPORTS = audit.REPORTS
IN_SCOPE = audit.IN_SCOPE
CODE_RE = re.compile(r"^[A-Z0-9]+\.\d{2}$")
MONEY_RE = re.compile(r"^\(?\$[\d,]+(?:\.\d+)?\)?$")
PARTIAL_MONEY_RE = re.compile(r"^\(?\$[\d,]+\.\d\)?$")
NUMERIC_RE = re.compile(r"^\(?-?[\d,]+(?:\.\d+)?\)?$")
NUM_UNIT_RE = re.compile(r"^(\(?-?[\d,]+(?:\.\d+)?\)?)([A-Za-z][A-Za-z/.-]*)$")
UNIT_RE = re.compile(r"^[A-Za-z][A-Za-z/.-]*$")
DATE_HEADING_RE = re.compile(
    r"\b(January|July)\s+\d{1,2},?\s+(\d{4})\s+(?:to|thru|through)\s+"
    r"(December|June)\s+\d{1,2},?\s+(\d{4})\b",
    re.I,
)

SUMMARY_FIELDS = [
    "summary_id", "source_id", "state", "agency_id", "agency_item_id", "agency_item_code",
    "period_start_date", "period_end_date", "period_label", "report_series", "description_raw",
    "total_quantity", "unit_raw", "unit_normalized", "published_average_unit_price", "total_bid",
    "source_page", "source_locator", "derivation_method",
]
ROW_FIELDS = [
    "source_id", "period_start_date", "period_end_date", "period_label", "report_series",
    "source_page", "row_number", "agency_item_code", "description_raw", "total_quantity", "unit_raw",
    "unit_normalized", "published_average_unit_price", "total_bid", "source_locator",
]
FAILURE_FIELDS = [
    "source_id", "source_file_name", "source_page", "row_number", "raw_text", "error_type", "error_message",
]
RECONCILIATION_FIELDS = [
    "source_id", "summary_id", "agency_item_code", "period_label", "total_quantity",
    "published_average_unit_price", "total_bid", "calculated_total_bid", "difference", "within_tolerance",
    "reconciliation_status", "source_page", "source_locator",
]
ACCEPTANCE_FIELDS = [
    "source_id", "report_series", "period_start_date", "period_end_date", "period_label",
    "expected_row_count", "parsed_row_count", "parse_failure_count", "negative_price_row_count", "acceptance_status",
]

CORE_HEADERS = {
    "lettings.csv": "letting_id,source_id,state,agency_id,letting_date,letting_label",
    "contracts.csv": "contract_id,letting_id,source_id,state,agency_id,official_contract_id,call_order,letting_status,awarded_vendor,awarded_amount,primary_county,route,work_type,contract_period,dbe_goal,bid_count,location,district,terrain,award_index",
    "contract_projects.csv": "contract_project_id,contract_id,project_number,project_control_number,project_name,work_type,county_region,route,location,project_award_amount",
    "contract_items.csv": "contract_item_id,contract_id,source_id,section_number,section_title,line_number,source_item_code,agency_item_id,description_raw,quantity,unit_raw,unit_normalized,alternate_set,alternate_member,mapping_status,source_page,source_locator",
    "bids.csv": "bid_id,contract_id,source_id,source_vendor_id,bidder_name,bid_rank,bid_total,percent_of_low,is_apparent_low,is_awarded,source_page",
    "item_mappings.csv": "mapping_id,state,source_agency_id,source_item_code,target_agency_item_id,match_status,confidence,reviewed_by,reviewed_on,notes",
    "item_observations.csv": "observation_id,contract_id,source_id,agency_item_id,agency_item_code,description_raw,description_normalized,unit_raw,unit_normalized,quantity,unit_price,extended_price,discipline,price_type,date_basis,derivation_method,derivation_input_count",
}


def write_csv(path: Path, fields: list[str], rows: Iterable[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields, extrasaction="ignore", lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return [{key: (value or "").strip() for key, value in row.items() if key is not None} for row in csv.DictReader(handle)]


def decimal_value(raw: str) -> Decimal:
    text = raw.strip().replace("$", "").replace(",", "")
    negative = text.startswith("(") and text.endswith(")")
    if negative:
        text = text[1:-1]
    value = Decimal(text)
    return -value if negative else value


def decimal_text(value: Decimal) -> str:
    if value == 0:
        return "0" if value.as_tuple().exponent == 0 else format(abs(value), "f")
    return format(value, "f")


def unit_normalized(unit: str) -> str:
    aliases = {
        "CAL DAY": "DAY", "BARR DAY": "DAY", "CDAY": "DAY", "BDAY": "DAY",
        "LUMP SUM": "LS", "LS/MILES": "LS/MILE", "LIN FT": "LF", "SQ FT": "SF",
        "SQ YD": "SY", "CU YD": "CY", "POUND": "LB", "GALLON": "GAL", "M GAL": "MGAL",
        "STATION": "STA",
    }
    return aliases.get(unit.strip().upper(), unit.strip().upper())


def row_groups(words: list[dict[str, object]]) -> list[list[dict[str, object]]]:
    groups: list[list[dict[str, object]]] = []
    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        group = next((candidate for candidate in groups if abs(float(candidate[0]["top"]) - float(word["top"])) <= 1.6), None)
        if group is None:
            groups.append([word])
        else:
            group.append(word)
    return [sorted(group, key=lambda item: float(item["x0"])) for group in groups]


def combined_currency_words(words: list[dict[str, object]]) -> list[dict[str, object]]:
    """Join a legacy PDF's split final currency digit (e.g. ``$1.2`` + ``3``)."""
    ordered = sorted(words, key=lambda item: (float(item["top"]), float(item["x0"])))
    result: list[dict[str, object]] = []
    skip: set[int] = set()
    for index, word in enumerate(ordered):
        if index in skip:
            continue
        text = str(word["text"])
        if PARTIAL_MONEY_RE.match(text):
            for next_index in range(index + 1, min(index + 8, len(ordered))):
                candidate = ordered[next_index]
                if (
                    str(candidate["text"]).isdigit()
                    and len(str(candidate["text"])) == 1
                    and 0 < float(candidate["top"]) - float(word["top"]) <= 15
                    and float(candidate["x0"]) > float(word["x0"])
                ):
                    merged = dict(word)
                    merged["text"] = text + str(candidate["text"])
                    merged["x1"] = candidate.get("x1", word.get("x1"))
                    skip.add(next_index)
                    result.append(merged)
                    break
            else:
                result.append(word)
        else:
            result.append(word)
    return result


def parse_words_page(
    words: list[dict[str, object]], source_file_name: str, page_number: int, row_offset: int = 0, page_height: float = 612.0
) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    """Parse one PDF page using code anchors and x/y-aware row regions."""
    words = combined_currency_words(words)
    anchors = sorted(
        [word for word in words if float(word.get("x0", 9999)) < 100 and CODE_RE.match(str(word.get("text", "")))],
        key=lambda item: float(item["top"]),
    )
    rows: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    for anchor_index, anchor in enumerate(anchors):
        code = str(anchor["text"])
        content_bottom = page_height - 55.0
        next_top = float(anchors[anchor_index + 1]["top"]) if anchor_index + 1 < len(anchors) else content_bottom + 1.0
        region = [
            word for word in words
            if float(word.get("top", 9999)) >= float(anchor["top"]) - 3.0
            and float(word.get("top", 9999)) < next_top - 1.6
            and float(word.get("top", 9999)) < content_bottom
        ]
        # The extracted word order can place the total-bid word before the
        # average-price word when their baselines differ by less than a point.
        # The visible table's x-columns are authoritative: average price is
        # the left currency column and total bid is the right currency column.
        money_words = sorted(
            [word for word in region if MONEY_RE.match(str(word.get("text", "")))],
            key=lambda item: float(item["x0"]),
        )
        raw_text = " ".join(str(word.get("text", "")) for word in sorted(region, key=lambda item: (float(item["top"]), float(item["x0"]))))
        row_number = row_offset + len(rows) + len(failures) + 1
        if len(money_words) < 2:
            failures.append({"source_file_name": source_file_name, "source_page": page_number, "row_number": row_number, "raw_text": raw_text, "error_type": "missing_currency", "error_message": "Expected average unit price and total bid currency values."})
            continue
        average_word, total_word = money_words[-2:]
        average_top = float(average_word["top"])
        numeric_row = sorted(
            [word for word in region if abs(float(word.get("top", 0)) - average_top) <= 1.6],
            key=lambda item: float(item["x0"]),
        )
        average_index = next((index for index, word in enumerate(numeric_row) if word is average_word), None)
        if average_index is None:
            average_index = next((index for index, word in enumerate(numeric_row) if str(word.get("text")) == str(average_word.get("text")) and float(word.get("x0")) == float(average_word.get("x0"))), None)
        before_average = numeric_row[: average_index if average_index is not None else len(numeric_row)]
        unit_index = next((index for index in range(len(before_average) - 1, -1, -1) if UNIT_RE.match(str(before_average[index].get("text", ""))) or NUM_UNIT_RE.match(str(before_average[index].get("text", "")))), None)
        if unit_index is None:
            failures.append({"source_file_name": source_file_name, "source_page": page_number, "row_number": row_number, "raw_text": raw_text, "error_type": "missing_quantity_unit", "error_message": "Could not locate the quantity and unit before average price."})
            continue
        unit_token = str(before_average[unit_index]["text"])
        combined = NUM_UNIT_RE.match(unit_token)
        if combined:
            quantity_raw, unit_raw = combined.groups()
            quantity_index = unit_index
        else:
            unit_raw = unit_token
            quantity_index = unit_index - 1
            if quantity_index < 0 or not NUMERIC_RE.match(str(before_average[quantity_index].get("text", ""))):
                failures.append({"source_file_name": source_file_name, "source_page": page_number, "row_number": row_number, "raw_text": raw_text, "error_type": "missing_quantity_unit", "error_message": "Unit was found but preceding quantity was not numeric."})
                continue
            quantity_raw = str(before_average[quantity_index]["text"])
        try:
            quantity = decimal_value(quantity_raw)
            average = decimal_value(str(average_word["text"]))
            total_bid = decimal_value(str(total_word["text"]))
        except (InvalidOperation, ValueError):
            failures.append({"source_file_name": source_file_name, "source_page": page_number, "row_number": row_number, "raw_text": raw_text, "error_type": "malformed_numeric", "error_message": "Quantity or currency value was not numeric."})
            continue
        # Keep all non-structural words from the region, including continuation lines.
        excluded = {code, quantity_raw, unit_token, str(average_word["text"]), str(total_word["text"])}
        description_words = []
        for word in sorted(region, key=lambda item: (float(item["top"]), float(item["x0"]))):
            text = str(word.get("text", ""))
            if text in excluded or MONEY_RE.match(text) or CODE_RE.match(text):
                continue
            if text.lower() == "page" or (text.isdigit() and float(word.get("top", 0)) > 540):
                continue
            if float(word.get("x0", 0)) < 75:
                continue
            description_words.append(text)
        description = " ".join(description_words).strip()
        rows.append({
            "agency_item_code": code,
            "description_raw": description,
            "row_number": row_number,
            "total_quantity": decimal_text(quantity),
            "unit_raw": unit_raw,
            "unit_normalized": unit_normalized(unit_raw),
            "published_average_unit_price": decimal_text(average),
            "total_bid": decimal_text(total_bid),
            "source_page": page_number,
            "source_locator": f"{source_file_name}#page={page_number};row={row_number};item={code}",
        })
    return rows, failures


def parse_period_heading(path: Path) -> tuple[str, str] | None:
    with pdfplumber.open(path) as pdf:
        text = "\n".join((page.extract_text() or "") for page in pdf.pages[:3])
    match = DATE_HEADING_RE.search(text)
    if not match:
        return None
    start_month, start_year, end_month, end_year = match.groups()
    start_month_number = "01" if start_month.lower() == "january" else "07"
    end_month_number = "12" if end_month.lower() == "december" else "06"
    start_day = "01"
    end_day = "31" if end_month.lower() == "december" else "30"
    return f"{start_year}-{start_month_number}-{start_day}", f"{end_year}-{end_month_number}-{end_day}"


def parse_report(path: Path, source_id: str, period_start: str, period_end: str, label: str, series: str) -> tuple[dict[str, object], list[dict[str, object]], list[dict[str, object]]]:
    rows: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            page_rows, page_failures = parse_words_page(page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False), path.name, page_number, 0, float(page.height))
            for row in page_rows:
                row.update({"source_id": source_id, "period_start_date": period_start, "period_end_date": period_end, "period_label": label, "report_series": series})
            for failure in page_failures:
                failure["source_id"] = source_id
            rows.extend(page_rows)
            failures.extend(page_failures)
    heading = parse_period_heading(path)
    if heading != (period_start, period_end):
        failures.append({"source_id": source_id, "source_file_name": path.name, "source_page": 1, "row_number": "", "raw_text": "", "error_type": "period_heading_mismatch", "error_message": f"PDF heading {heading!r} does not match inventory {(period_start, period_end)!r}."})
    metadata = {"page_count": len(pdf.pages) if 'pdf' in locals() else 0, "row_count": len(rows), "negative_price_row_count": sum(1 for row in rows if decimal_value(str(row["published_average_unit_price"])) < 0)}
    return metadata, rows, failures


def download(url: str, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(url, timeout=60) as response, destination.open("wb") as handle:
        handle.write(response.read())


def refresh_raw_sources() -> None:
    download(LISTING_URL, RAW_CATALOG_DIR / "item_history_listing.html")
    download("https://dot.nebraska.gov/media/qr3pibex/stditeme06252010.pdf", RAW_CATALOG_DIR / "stditeme06252010.pdf")
    download("https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf", RAW_CATALOG_DIR / "2017-specbook.pdf")
    for source_id, _series, _start, _end, _label, filename, url in REPORTS:
        download(url, RAW_REPORT_DIR / filename)
    audit.main()


def load_catalog_rows() -> list[dict[str, str]]:
    staged = STAGING_DIR / "item_catalog_rows.csv"
    rows = read_csv(staged)
    if rows:
        return rows
    return audit.parse_catalog(RAW_CATALOG_DIR / "stditeme06252010.pdf")


def specification_sections() -> dict[str, str]:
    text = "\n".join((page.extract_text() or "") for page in PdfReader(str(RAW_CATALOG_DIR / "2017-specbook.pdf")).pages)
    sections: dict[str, str] = {}
    for match in re.finditer(r"(?mi)^\s*(\d{3})\s+--\s+([^\n.]+)", text):
        code, title = match.groups()
        sections.setdefault(code, re.sub(r"\s+", " ", title).strip())
    return sections


def source_rows(inventory: list[dict[str, str]]) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for item in inventory:
        if item.get("source_id") not in IN_SCOPE:
            continue
        rows.append({
            "source_id": item["source_id"], "source_type": "annual_price_summary", "agency_id": "ne_ndot",
            "agency_name": "Nebraska Department of Transportation", "state": "NE",
            "source_label": "NDOT average unit price summaries", "source_date": item.get("report_generated_on") or item["period_end_date"],
            "data_year": item["period_end_date"][:4], "source_url": item["source_url"], "source_file_name": item["source_file_name"],
            "sha256": item.get("sha256", ""), "parser_name": "pdfplumber_coordinate_table", "parser_version": "pdfplumber-0.11.9",
            "notes": f"Published {item['period_label']}; annual period aggregate; rows remain independent when periods overlap.",
        })
    for source_id, source_type, label, url, filename, notes in [
        ("ne_ndot_english_standard_item_list_2010", "item_catalog", "NDOT English Standard Item List", "https://dot.nebraska.gov/media/qr3pibex/stditeme06252010.pdf", "stditeme06252010.pdf", "Catalog authority linked from the NDOT Item History page."),
        ("ne_ndot_2017_standard_specifications", "specification_taxonomy", "NDOT 2017 Standard Specifications", "https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf", "2017-specbook.pdf", "Official specification hierarchy used for explicit taxonomy memberships."),
    ]:
        path = RAW_CATALOG_DIR / filename
        rows.append({
            "source_id": source_id, "source_type": source_type, "agency_id": "ne_ndot", "agency_name": "Nebraska Department of Transportation", "state": "NE", "source_label": label, "source_date": "2010-06-25" if source_type == "item_catalog" else "2017-08-01", "data_year": "2010" if source_type == "item_catalog" else "2017", "source_url": url, "source_file_name": filename, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "parser_name": "pdfplumber_catalog" if source_type == "item_catalog" else "pypdf_specification_hierarchy", "parser_version": "pdfplumber-0.11.9" if source_type == "item_catalog" else "pypdf-5", "notes": notes,
        })
    return sorted(rows, key=lambda row: str(row["source_id"]))


def build_taxonomy(catalog_rows: list[dict[str, str]], sections: dict[str, str]) -> tuple[list[dict[str, object]], list[dict[str, object]], dict[str, str]]:
    division_labels = {
        "100": "General Requirements and Covenants", "200": "Earthwork", "300": "Subgrade Preparation, Foundation Courses, Base Courses, Shoulder Construction, and Aggregate Surfacing", "400": "Lighting, Signs, and Traffic Control", "500": "Bituminous Pavement", "600": "Portland Cement Concrete Pavements", "700": "Bridges, Culverts, and Related Construction", "800": "Roadside Development and Erosion Control", "900": "Incidental Construction", "1000": "Material Details",
    }
    taxonomy: list[dict[str, object]] = []
    section_ids: dict[str, str] = {}
    for code, label in division_labels.items():
        taxonomy.append({"taxonomy_id": f"ne_ndot_div_{code}", "state": "NE", "agency_id": "ne_ndot", "taxonomy_level": "division", "taxonomy_code": code, "parent_taxonomy_id": "", "taxonomy_label": f"Division {code} - {label}", "match_prefix": code[0], "source_year": "2017", "source_url": "https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf"})
    taxonomy.append({"taxonomy_id": "ne_ndot_div_unclassified", "state": "NE", "agency_id": "ne_ndot", "taxonomy_level": "division", "taxonomy_code": "UNCLASSIFIED", "parent_taxonomy_id": "", "taxonomy_label": "Unclassified / special items", "match_prefix": "U", "source_year": "2017", "source_url": "https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf"})
    references = sorted({str(row.get("specification_reference", "")) for row in catalog_rows if row.get("specification_reference")})
    seen_sections: set[str] = set()
    for reference in references:
        section = reference.split(".", 1)[0]
        if section not in sections or section in seen_sections:
            continue
        seen_sections.add(section)
        parent = f"{section[0]}00" if section[0] in "123456789" else "UNCLASSIFIED"
        taxonomy_id = f"ne_ndot_sec_{section}"
        section_ids[reference] = taxonomy_id
        taxonomy.append({"taxonomy_id": taxonomy_id, "state": "NE", "agency_id": "ne_ndot", "taxonomy_level": "section", "taxonomy_code": section, "parent_taxonomy_id": f"ne_ndot_div_{parent}", "taxonomy_label": f"Section {section} - {sections[section]}", "match_prefix": section, "source_year": "2017", "source_url": "https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf"})
    taxonomy.append({"taxonomy_id": "ne_ndot_sec_unclassified", "state": "NE", "agency_id": "ne_ndot", "taxonomy_level": "section", "taxonomy_code": "UNCLASSIFIED", "parent_taxonomy_id": "ne_ndot_div_unclassified", "taxonomy_label": "Unclassified / special items", "match_prefix": "U", "source_year": "2017", "source_url": "https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf"})
    return sorted(taxonomy, key=lambda row: (str(row["taxonomy_level"]), str(row["taxonomy_code"]))), [], section_ids


def normalized_items(catalog_rows: list[dict[str, str]], annual_rows: list[dict[str, object]], latest_by_code: dict[str, dict[str, object]], catalog_source_id: str) -> tuple[list[dict[str, object]], list[dict[str, object]]]:
    catalog_by_code = {str(row["agency_item_code"]): row for row in catalog_rows}
    codes = sorted(set(catalog_by_code) | {str(row["agency_item_code"]) for row in annual_rows})
    items: list[dict[str, object]] = []
    versions: list[dict[str, object]] = []
    for code in codes:
        catalog = catalog_by_code.get(code)
        annual = latest_by_code.get(code, {})
        is_current = catalog is not None
        item_id = f"ne_ndot_{code}"
        version_id = f"ne_ndot_version_{code}_{'current' if is_current else 'historical'}"
        items.append({"agency_item_id": item_id, "state": "NE", "agency_id": "ne_ndot", "agency_name": "Nebraska Department of Transportation", "item_code": code, "current_version_id": version_id, "item_status": "current" if is_current else "historical", "canonical_item_id": ""})
        source_id = catalog_source_id if is_current else str(annual.get("source_id", ""))
        versions.append({"agency_item_version_id": version_id, "agency_item_id": item_id, "effective_from": "", "effective_to": "", "official_description": str(catalog.get("description", "") if catalog else annual.get("description_raw", "")), "official_abbreviated_description": "", "official_unit": str(catalog.get("unit_raw", "") if catalog else annual.get("unit_raw", "")), "spec_reference_code": str(catalog.get("specification_reference", "") if catalog else ""), "source_id": source_id, "is_current": "true" if is_current else "false"})
    return items, versions


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--refresh", action="store_true", help="Download official sources before parsing.")
    parser.add_argument("--test-fixtures", action="store_true", help="Run coordinate parser fixtures without reading PDFs or using network.")
    args = parser.parse_args()
    if args.test_fixtures:
        from scripts.test_import_nebraska_data import run_fixture_tests
        return run_fixture_tests()
    if args.refresh:
        refresh_raw_sources()
    missing = [str(RAW_REPORT_DIR / filename) for source_id, _series, _start, _end, _label, filename, _url in REPORTS if not (RAW_REPORT_DIR / filename).exists()]
    if missing:
        raise SystemExit("Cached mode requires raw files; missing: " + ", ".join(missing))
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    inventory: list[dict[str, str]] = []
    parsed_rows: list[dict[str, object]] = []
    failures: list[dict[str, object]] = []
    acceptance: list[dict[str, object]] = []
    for source_id, series, start, end, label, filename, url in REPORTS:
        if source_id not in IN_SCOPE:
            continue
        path = RAW_REPORT_DIR / filename
        metadata, rows, report_failures = parse_report(path, source_id, start, end, label, series)
        parsed_rows.extend(rows)
        failures.extend(report_failures)
        acceptance.append({"source_id": source_id, "report_series": series, "period_start_date": start, "period_end_date": end, "period_label": label, "expected_row_count": str(metadata["row_count"]), "parsed_row_count": str(metadata["row_count"]), "parse_failure_count": str(len(report_failures)), "negative_price_row_count": str(metadata["negative_price_row_count"]), "acceptance_status": "accepted" if not report_failures else "review"})
    write_csv(STAGING_DIR / "annual_price_rows.csv", ROW_FIELDS, sorted(parsed_rows, key=lambda row: (str(row["period_start_date"]), str(row["source_id"]), int(row["source_page"]), str(row["agency_item_code"]))))
    write_csv(STAGING_DIR / "annual_price_parse_failures.csv", FAILURE_FIELDS, sorted(failures, key=lambda row: (str(row.get("source_id", "")), int(row.get("source_page", 0) or 0), str(row.get("row_number", "")))))
    acceptance_path = STAGING_DIR / "annual_price_acceptance.csv"
    previous_acceptance = {row["source_id"]: row for row in read_csv(acceptance_path)}
    if previous_acceptance:
        for row in acceptance:
            previous = previous_acceptance.get(str(row["source_id"]))
            if previous and previous.get("expected_row_count") != row["parsed_row_count"]:
                raise SystemExit(f"Frozen acceptance count changed for {row['source_id']}: {previous.get('expected_row_count')} -> {row['parsed_row_count']}")
    write_csv(acceptance_path, ACCEPTANCE_FIELDS, sorted(acceptance, key=lambda row: str(row["period_start_date"])))
    if failures:
        raise SystemExit(f"NDOT parser produced {len(failures)} review rows; see {STAGING_DIR / 'annual_price_parse_failures.csv'}")

    inventory = read_csv(STAGING_DIR / "annual_price_report_inventory.csv")
    if not inventory:
        inventory = [{"source_id": source_id, "report_series": series, "period_start_date": start, "period_end_date": end, "period_label": label, "source_url": url, "source_file_name": filename, "report_generated_on": "", "sha256": hashlib.sha256((RAW_REPORT_DIR / filename).read_bytes()).hexdigest()} for source_id, series, start, end, label, filename, url in REPORTS]
    write_csv(STATE_DIR / "sources.csv", ["source_id", "source_type", "agency_id", "agency_name", "state", "source_label", "source_date", "data_year", "source_url", "source_file_name", "sha256", "parser_name", "parser_version", "notes"], source_rows(inventory))
    catalog_rows = load_catalog_rows()
    latest_by_code: dict[str, dict[str, object]] = {}
    for row in parsed_rows:
        code = str(row["agency_item_code"])
        if code not in latest_by_code or str(row["period_end_date"]) > str(latest_by_code[code]["period_end_date"]):
            latest_by_code[code] = row
    items, versions = normalized_items(catalog_rows, parsed_rows, latest_by_code, "ne_ndot_english_standard_item_list_2010")
    write_csv(STATE_DIR / "agency_items.csv", ["agency_item_id", "state", "agency_id", "agency_name", "item_code", "current_version_id", "item_status", "canonical_item_id"], items)
    write_csv(STATE_DIR / "agency_item_versions.csv", ["agency_item_version_id", "agency_item_id", "effective_from", "effective_to", "official_description", "official_abbreviated_description", "official_unit", "spec_reference_code", "source_id", "is_current"], versions)
    taxonomy, _unused, section_ids = build_taxonomy(catalog_rows, specification_sections())
    write_csv(STATE_DIR / "item_taxonomy.csv", ["taxonomy_id", "state", "agency_id", "taxonomy_level", "taxonomy_code", "parent_taxonomy_id", "taxonomy_label", "match_prefix", "source_year", "source_url"], taxonomy)
    memberships = []
    catalog_by_code = {str(row["agency_item_code"]): row for row in catalog_rows}
    for item in items:
        code = str(item["item_code"])
        reference = str(catalog_by_code.get(code, {}).get("specification_reference", ""))
        taxonomy_id = section_ids.get(reference, "ne_ndot_sec_unclassified")
        status = "catalog_exact" if taxonomy_id != "ne_ndot_sec_unclassified" else "unclassified"
        note = "Catalog specification reference matched 2017 Standard Specifications." if status == "catalog_exact" else "No supported catalog specification reference; explicit fallback membership."
        memberships.append({"membership_id": f"ne_ndot_membership_{code}", "state": "NE", "agency_id": "ne_ndot", "agency_item_id": item["agency_item_id"], "taxonomy_id": taxonomy_id, "source_id": "ne_ndot_2017_standard_specifications", "match_status": status, "notes": note})
    write_csv(STATE_DIR / "item_taxonomy_memberships.csv", ["membership_id", "state", "agency_id", "agency_item_id", "taxonomy_id", "source_id", "match_status", "notes"], memberships)
    summaries = []
    for row in parsed_rows:
        code = str(row["agency_item_code"])
        summary_id = f"ne_ndot_summary_{row['period_start_date']}_{row['period_end_date']}_{code}_{unit_normalized(str(row['unit_raw']))}"
        summaries.append({"summary_id": summary_id, "source_id": row["source_id"], "state": "NE", "agency_id": "ne_ndot", "agency_item_id": f"ne_ndot_{code}", "agency_item_code": code, "period_start_date": row["period_start_date"], "period_end_date": row["period_end_date"], "period_label": row["period_label"], "report_series": row["report_series"], "description_raw": row["description_raw"], "total_quantity": row["total_quantity"], "unit_raw": row["unit_raw"], "unit_normalized": row["unit_normalized"], "published_average_unit_price": row["published_average_unit_price"], "total_bid": row["total_bid"], "source_page": row["source_page"], "source_locator": row["source_locator"], "derivation_method": "ndot_published_period_aggregate"})
    summaries.sort(key=lambda row: (str(row["period_start_date"]), str(row["agency_item_code"]), int(row["source_page"])))
    write_csv(STATE_DIR / "item_price_summaries.csv", SUMMARY_FIELDS, summaries)
    reconciliation = []
    for row in summaries:
        quantity = decimal_value(str(row["total_quantity"]))
        average = decimal_value(str(row["published_average_unit_price"]))
        total_bid = decimal_value(str(row["total_bid"]))
        calculated = quantity * average
        difference = abs(total_bid - calculated)
        tolerance = max(Decimal("0.02"), abs(quantity) * Decimal("0.005") + Decimal("0.01"))
        reconciliation.append({"source_id": row["source_id"], "summary_id": row["summary_id"], "agency_item_code": row["agency_item_code"], "period_label": row["period_label"], "total_quantity": row["total_quantity"], "published_average_unit_price": row["published_average_unit_price"], "total_bid": row["total_bid"], "calculated_total_bid": decimal_text(calculated), "difference": decimal_text(difference), "within_tolerance": "true" if quantity == 0 or difference <= tolerance else "false", "reconciliation_status": "zero_quantity" if quantity == 0 else ("ok" if difference <= tolerance else "review"), "source_page": row["source_page"], "source_locator": row["source_locator"]})
    write_csv(STAGING_DIR / "annual_price_reconciliation.csv", RECONCILIATION_FIELDS, reconciliation)
    for filename, header in CORE_HEADERS.items():
        write_csv(STATE_DIR / filename, header.split(","), [])
    print(f"Imported {len(summaries)} annual rows across {len(acceptance)} reports; failures={len(failures)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
