#!/usr/bin/env python3
"""Create reproducible Phase 1 audit artifacts for NDOT annual price reports."""

from __future__ import annotations

import csv
import hashlib
import re
from collections import defaultdict
from datetime import datetime
from difflib import SequenceMatcher
from pathlib import Path

import pdfplumber
from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "data" / "raw" / "ne" / "annual_price_reports"
CATALOG_DIR = ROOT / "data" / "raw" / "ne" / "catalog"
STAGING_DIR = ROOT / "data" / "staging" / "ne"

REPORTS = [
    ("ne_ndot_aup_calendar_2018", "calendar_year", "2018-01-01", "2018-12-31", "January 2018 - December 2018", "aup-january-2018-december-2018.pdf", "https://dot.nebraska.gov/media/o4gnheao/c-users-royleach-desktop-it-umbraco-docs-aup_j2018_d2018.pdf"),
    ("ne_ndot_aup_calendar_2019", "calendar_year", "2019-01-01", "2019-12-31", "January 2019 - December 2019", "aup-january-2019-december-2019.pdf", "https://dot.nebraska.gov/media/irflf5ie/aupj2019-d2019.pdf"),
    ("ne_ndot_aup_calendar_2020", "calendar_year", "2020-01-01", "2020-12-31", "January 2020 - December 2020", "aup-january-2020-december-2020.pdf", "https://dot.nebraska.gov/media/abahjec0/aup-january-2020-december-2020.pdf"),
    ("ne_ndot_aup_calendar_2021", "calendar_year", "2021-01-01", "2021-12-31", "January 2021 - December 2021", "aup-january-2021-december-2021.pdf", "https://dot.nebraska.gov/media/3uxlzjo1/aup-january-2021-december-2021.pdf"),
    ("ne_ndot_aup_calendar_2022", "calendar_year", "2022-01-01", "2022-12-31", "January 2022 - December 2022", "aup-january-2022-december-2022.pdf", "https://dot.nebraska.gov/media/yv5bn0pv/aup-jan-2022-dec-2022.pdf"),
    ("ne_ndot_aup_calendar_2023", "calendar_year", "2023-01-01", "2023-12-31", "January 2023 - December 2023", "aup-january-2023-december-2023.pdf", "https://dot.nebraska.gov/media/k2eh1k20/aup-january-2023-december-2023.pdf"),
    ("ne_ndot_aup_calendar_2024", "calendar_year", "2024-01-01", "2024-12-31", "January 2024 - December 2024", "aup-january-2024-december-2024.pdf", "https://dot.nebraska.gov/media/m2rdvuuc/aup-january-2024-december-2024.pdf"),
    ("ne_ndot_aup_calendar_2025", "calendar_year", "2025-01-01", "2025-12-31", "January 2025 - December 2025", "aup-january-2025-december-2025.pdf", "https://dot.nebraska.gov/media/xqvdpg0p/aup-january-2025-december-2025.pdf"),
    ("ne_ndot_aup_july_june_2017_2018", "july_june", "2017-07-01", "2018-06-30", "July 2017 - June 2018", "aup-july-2017-june-2018.pdf", "https://dot.nebraska.gov/media/s2nfx2ca/aup_j2017_j2018.pdf"),
    ("ne_ndot_aup_july_june_2018_2019", "july_june", "2018-07-01", "2019-06-30", "July 2018 - June 2019", "aup-july-2018-june-2019.pdf", "https://dot.nebraska.gov/media/5nrobrwj/aupj2018_j2019.pdf"),
    ("ne_ndot_aup_july_june_2019_2020", "july_june", "2019-07-01", "2020-06-30", "July 2019 - June 2020", "aup-july-2019-june-2020.pdf", "https://dot.nebraska.gov/media/53rnpm25/aup-july-2019-june-2020.pdf"),
    ("ne_ndot_aup_july_june_2020_2021", "july_june", "2020-07-01", "2021-06-30", "July 2020 - June 2021", "aup-july-2020-june-2021.pdf", "https://dot.nebraska.gov/media/jzwhlohs/aup-july-2020-june-2021.pdf"),
    ("ne_ndot_aup_july_june_2021_2022", "july_june", "2021-07-01", "2022-06-30", "July 2021 - June 2022", "aup-july-2021-june-2022.pdf", "https://dot.nebraska.gov/media/tqtp0wci/aup-july-2021-june-2022.pdf"),
    ("ne_ndot_aup_july_june_2022_2023", "july_june", "2022-07-01", "2023-06-30", "July 2022 - June 2023", "aup-july-2022-june-2023.pdf", "https://dot.nebraska.gov/media/igigdl0o/aup-july-2022-june-2023.pdf"),
    ("ne_ndot_aup_july_june_2023_2024", "july_june", "2023-07-01", "2024-06-30", "July 2023 - June 2024", "aup-july-2023-june-2024.pdf", "https://dot.nebraska.gov/media/vvsniepk/aup-july-2023-june-2024.pdf"),
    ("ne_ndot_aup_july_june_2024_2025", "july_june", "2024-07-01", "2025-06-30", "July 2024 - June 2025", "aup-july-2024-june-2025.pdf", "https://dot.nebraska.gov/media/qwwdgeuo/aup-july-2024-june-2025.pdf"),
    ("ne_ndot_aup_july_june_2025_2026", "july_june", "2025-07-01", "2026-06-30", "July 2025 - June 2026", "aup-july-2025-june-2026.pdf", "https://dot.nebraska.gov/media/53hgujhu/aup-july-2025-june-2026.pdf"),
    ("ne_ndot_aup_calendar_2017", "calendar_year", "2017-01-01", "2017-12-31", "January 2017 - December 2017", "aup-january-2017-december-2017.pdf", "https://dot.nebraska.gov/media/sjsl1idv/aup-j2017_d2017-english-projects.pdf"),
    ("ne_ndot_aup_july_june_2016_2017", "july_june", "2016-07-01", "2017-06-30", "July 2016 - June 2017", "aup-july-2016-june-2017.pdf", "https://dot.nebraska.gov/media/l4ra5ih4/aup-j2016_j2017-english-projects.pdf"),
]

IN_SCOPE = {source_id for source_id, *_ in REPORTS if source_id not in {"ne_ndot_aup_calendar_2017", "ne_ndot_aup_july_june_2016_2017"}}

CODE_RE = re.compile(r"^[A-Z0-9]+\.\d{2}$")
MONEY_RE = re.compile(r"^\(?\$[\d,]+(?:\.\d+)?\)?$")
NUM_UNIT_RE = re.compile(r"^(\(?-?[\d,]+(?:\.\d+)?\)?)([A-Za-z][A-Za-z/.-]*)$")
CATALOG_RE = re.compile(r"^(\d{4}\.\d{2})\s+(.*?)\s+(\d{2})\s+(.*)$")

# These exact-code conflicts contain one coherent label plus a visibly
# interleaved or adjacent-row PDF extraction. They are safe identity matches,
# but the raw published-text field remains unchanged for provenance.
REVIEWED_EXTRACTION_ARTIFACT_CODES = {
    "7500.38", "7500.69", "7500.93", "7501.02", "7518.05", "7520.03", "7541.15", "7560.01", "9111.00",
    "L010.45", "L376.25", "L376.40", "L455.00", "L559.17", "L595.00", "L619.58", "L619.74", "L705.74",
    "L717.18", "L720.06", "L765.18", "L766.21", "L970.10", "L970.50", "L980.00", "L999.01",
    "A001.73", "A004.70", "A004.71",
}


def write_csv(path: Path, fieldnames: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as handle:
        return [{key: (value or "").strip() for key, value in row.items() if key is not None} for row in csv.DictReader(handle)]


def unit_normalized(unit: str) -> str:
    return {
        "CAL DAY": "DAY",
        "BARR DAY": "DAY",
        "CDAY": "DAY",
        "BDAY": "DAY",
        "LUMP SUM": "LS",
        "LS/MILES": "LS/MILE",
        "LIN FT": "LF",
        "SQ FT": "SF",
        "SQ YD": "SY",
        "CU YD": "CY",
        "POUND": "LB",
        "GALLON": "GAL",
        "M GAL": "MGAL",
        "STATION": "STA",
        "VERT FT": "VFT",
    }.get(unit.upper(), unit.upper())


def row_groups(words: list[dict[str, object]]) -> list[list[dict[str, object]]]:
    groups: list[list[dict[str, object]]] = []
    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        group = next((candidate for candidate in groups if abs(float(candidate[0]["top"]) - float(word["top"])) <= 1.6), None)
        if group is None:
            groups.append([word])
        else:
            group.append(word)
    return [sorted(group, key=lambda item: float(item["x0"])) for group in groups]


def parse_annual_report(path: Path) -> tuple[dict[str, object], list[dict[str, object]]]:
    rows: list[dict[str, object]] = []
    with pdfplumber.open(path) as pdf:
        first_page_text = pdf.pages[0].extract_text() or ""
        generated_match = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", first_page_text)
        if generated_match is None:
            for page in pdf.pages[1:4]:
                generated_match = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", page.extract_text() or "")
                if generated_match:
                    break
        generated_on = ""
        if generated_match:
            generated_on = datetime.strptime(generated_match.group(1), "%m/%d/%Y").date().isoformat()
        first_codes: list[float] = []
        for page_number, page in enumerate(pdf.pages, start=1):
            words = page.extract_words(x_tolerance=1, y_tolerance=2, keep_blank_chars=False)
            groups = row_groups(words)
            for group in groups:
                if not group or not CODE_RE.match(str(group[0]["text"])):
                    continue
                first_codes.append(float(group[0]["top"]))
                money_indexes = [index for index, word in enumerate(group) if MONEY_RE.match(str(word["text"]))]
                if len(money_indexes) < 2:
                    continue
                average_index, total_index = money_indexes[-2:]
                unit_index = average_index - 1
                quantity_index = average_index - 2
                if quantity_index < 1:
                    continue
                unit = str(group[unit_index]["text"])
                quantity = str(group[quantity_index]["text"])
                combined_unit = NUM_UNIT_RE.match(unit)
                if combined_unit:
                    quantity, unit = combined_unit.groups()
                    quantity_index = unit_index
                description = " ".join(str(word["text"]) for word in group[1:quantity_index]).strip()
                rows.append(
                    {
                        "agency_item_code": str(group[0]["text"]),
                        "description_raw": description,
                        "unit_raw": unit,
                        "unit_normalized": unit_normalized(unit),
                        "source_page": page_number,
                        "source_locator": f"{path.name}#page={page_number};item={group[0]['text']}",
                    }
                )
        unique_tops = sorted({round(value, 1) for value in first_codes})
        step = round(unique_tops[1] - unique_tops[0], 1) if len(unique_tops) > 1 else 0
        if step <= 9:
            layout = "coordinate_table_concat"
        elif step >= 17:
            layout = "coordinate_table_legacy"
        else:
            layout = "coordinate_table_compact"
        return {
            "report_generated_on": generated_on,
            "page_count": len(pdf.pages),
            "parser_layout": layout,
            "row_count": len(rows),
        }, rows


def parse_catalog(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            for line in (page.extract_text() or "").splitlines():
                match = CATALOG_RE.match(line)
                if not match:
                    continue
                code, unit, specification_year, rest = match.groups()
                reference_match = re.match(r"^(\d{3}\.\d{2})\s+(.*)$", rest)
                reference = reference_match.group(1) if reference_match else ""
                description = reference_match.group(2) if reference_match else rest
                rows.append(
                    {
                        "catalog_row_id": f"ne_ndot_catalog_{code}",
                        "agency_item_id": f"ne_ndot_{code}",
                        "agency_item_code": code,
                        "description": description.strip(),
                        "unit_raw": unit.strip(),
                        "unit_normalized": unit_normalized(unit.strip()),
                        "specification_year": specification_year,
                        "specification_reference": reference,
                        "item_status": "current",
                        "source_id": "ne_ndot_english_standard_item_list_2010",
                        "source_page": page_number,
                        "source_locator": f"{path.name}#page={page_number};item={code}",
                    }
                )
    return rows


def normalize_description(value: str) -> str:
    value = value.upper().replace("&", " AND ")
    return re.sub(r"[^A-Z0-9]+", " ", value).strip()


def identity_description(value: str) -> str:
    """Normalize harmless description morphology without rewriting source text."""
    tokens = normalize_description(value).split()
    normalized: list[str] = []
    for token in tokens:
        if len(token) > 4 and token.endswith("S") and not token.endswith(("SS", "US")):
            token = token[:-1]
        normalized.append(token)
    return " ".join(normalized)


def ordered_subsequence(shorter: list[str], longer: list[str]) -> bool:
    if not shorter:
        return True
    iterator = iter(longer)
    return all(any(candidate == token for candidate in iterator) for token in shorter)


def high_confidence_description_identity(descriptions: list[str], catalog_description: str) -> bool:
    """Accept only exact, truncation, insertion, or near-spelling variants.

    The rule does not rewrite source wording.  It establishes only that every
    observed label is compatible with at least one well-formed label for the
    same exact NDOT code.
    """
    values = [value for value in [catalog_description, *descriptions] if value.strip()]
    if len(values) < 2:
        return True
    tokenized = [(value, normalize_description(value).split()) for value in values]

    def compatible(left: list[str], right: list[str]) -> bool:
        if ordered_subsequence(left, right) or ordered_subsequence(right, left):
            return True
        left_text = " ".join(left)
        right_text = " ".join(right)
        return SequenceMatcher(None, left_text, right_text).ratio() >= 0.92

    # Require one coherent anchor, not a chain of weak pairwise similarities.
    return any(all(compatible(anchor, candidate) for _, candidate in tokenized) for _, anchor in tokenized)


def automatic_conflict_classification(
    raw_conflict_type: str,
    descriptions: list[str],
    catalog_description: str,
    units: list[str],
    catalog_unit: str,
) -> tuple[str, str, str]:
    description_keys = {identity_description(description) for description in descriptions if description}
    if catalog_description:
        description_keys.add(identity_description(catalog_description))
    unit_keys = {unit_normalized(unit) for unit in units if unit}
    if catalog_unit:
        unit_keys.add(unit_normalized(catalog_unit))

    if len(description_keys) <= 1 and len(unit_keys) > 1:
        return (
            "stable_description_multi_unit",
            "reviewed_multi_unit",
            "Same identity candidate with multiple reported units; retain every raw unit and require unit-aware review.",
        )
    if len(description_keys) <= 1 and len(unit_keys) <= 1:
        return (
            "normalized_equivalent",
            "normalized_equivalent",
            "Raw description or unit variants collapse under the conservative identity normalizer.",
        )
    if raw_conflict_type == "description":
        return (
            "description_variant",
            "source_text_correction_or_reviewed_variant",
            "Description variants remain after conservative normalization; inspect source pages before changing identity.",
        )
    if raw_conflict_type == "unit":
        return (
            "unit_and_description_context",
            "needs_review",
            "Unit variation is accompanied by unresolved description context; do not merge automatically.",
        )
    return (
        "semantic_identity_candidate",
        "needs_review",
        "Description and unit context remain materially different after conservative normalization.",
    )


def main() -> None:
    STAGING_DIR.mkdir(parents=True, exist_ok=True)
    inventory_rows: list[dict[str, object]] = []
    annual_by_code: dict[str, list[dict[str, object]]] = defaultdict(list)
    report_rows_by_source: dict[str, int] = {}

    report_metadata = {source_id: (series, start, end, label, filename, url) for source_id, series, start, end, label, filename, url in REPORTS}
    for source_id, series, start, end, label, filename, url in REPORTS:
        path = REPORT_DIR / filename
        in_scope = source_id in IN_SCOPE
        if not path.exists():
            inventory_rows.append(
                {
                    "source_id": source_id,
                    "report_series": series,
                    "period_start_date": start,
                    "period_end_date": end,
                    "period_label": label,
                    "source_url": url,
                    "source_file_name": filename,
                    "report_generated_on": "",
                    "retrieved_on": "2026-08-05",
                    "sha256": "",
                    "page_count": "",
                    "parser_layout": "",
                    "inventory_status": "download_failed",
                    "failure_reason": "raw source file is missing",
                }
            )
            continue
        parsed_metadata, annual_rows = parse_annual_report(path)
        report_rows_by_source[source_id] = int(parsed_metadata["row_count"])
        if in_scope:
            for row in annual_rows:
                row.update({"source_id": source_id, "period_start_date": start, "period_end_date": end, "period_label": label, "report_series": series})
                annual_by_code[str(row["agency_item_code"])].append(row)
        inventory_rows.append(
            {
                "source_id": source_id,
                "report_series": series,
                "period_start_date": start,
                "period_end_date": end,
                "period_label": label,
                "source_url": url,
                "source_file_name": filename,
                "report_generated_on": parsed_metadata["report_generated_on"],
                "retrieved_on": "2026-08-05",
                "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "page_count": parsed_metadata["page_count"],
                "parser_layout": parsed_metadata["parser_layout"],
                "inventory_status": "parsed" if in_scope else "skipped_out_of_scope",
                "failure_reason": "" if in_scope else "outside approved 2018-2025 calendar and 2017-18 through 2025-26 July-June scope",
            }
        )

    inventory_rows.sort(key=lambda row: (str(row["period_start_date"]), str(row["source_id"])))
    write_csv(
        STAGING_DIR / "annual_price_report_inventory.csv",
        ["source_id", "report_series", "period_start_date", "period_end_date", "period_label", "source_url", "source_file_name", "report_generated_on", "retrieved_on", "sha256", "page_count", "parser_layout", "inventory_status", "failure_reason"],
        inventory_rows,
    )

    # Identity review must use the accepted production-parser rows.  The audit's
    # compact inventory parser is retained for source inventory diagnostics, but
    # it is not authoritative for wrapped or overlapping PDF text.
    accepted_annual_rows = read_csv(STAGING_DIR / "annual_price_rows.csv")
    if accepted_annual_rows:
        accepted_sources = {str(row["source_id"]) for row in accepted_annual_rows}
        if accepted_sources != IN_SCOPE:
            missing = sorted(IN_SCOPE - accepted_sources)
            extra = sorted(accepted_sources - IN_SCOPE)
            raise RuntimeError(f"annual_price_rows.csv source coverage mismatch; missing={missing}, extra={extra}")
        annual_by_code = defaultdict(list)
        for row in accepted_annual_rows:
            annual_by_code[str(row["agency_item_code"])].append(row)

    catalog_rows = parse_catalog(CATALOG_DIR / "stditeme06252010.pdf")
    catalog_by_code = {str(row["agency_item_code"]): row for row in catalog_rows}
    write_csv(
        STAGING_DIR / "item_catalog_rows.csv",
        ["catalog_row_id", "agency_item_id", "agency_item_code", "description", "unit_raw", "unit_normalized", "specification_year", "specification_reference", "item_status", "source_id", "source_page", "source_locator"],
        sorted(catalog_rows, key=lambda row: str(row["agency_item_code"])),
    )

    annual_only_rows: list[dict[str, object]] = []
    conflict_rows: list[dict[str, object]] = []
    resolution_rows: list[dict[str, object]] = []
    human_review_rows: list[dict[str, object]] = []
    for code, rows in sorted(annual_by_code.items()):
        descriptions = sorted({str(row["description_raw"]) for row in rows})
        units = sorted({str(row["unit_raw"]) for row in rows})
        source_ids = sorted({str(row["source_id"]) for row in rows})
        normalized_descriptions = sorted({normalize_description(description) for description in descriptions})
        catalog = catalog_by_code.get(code)
        if catalog is None:
            annual_only_rows.append(
                {
                    "agency_item_code": code,
                    "agency_item_id": f"ne_ndot_{code}",
                    "first_period_start_date": min(str(row["period_start_date"]) for row in rows),
                    "last_period_end_date": max(str(row["period_end_date"]) for row in rows),
                    "description_variants": " | ".join(descriptions),
                    "unit_variants": " | ".join(units),
                    "evidence_report_count": len(source_ids),
                    "item_status": "historical",
                    "source_ids": " | ".join(source_ids),
                    "notes": "Absent from the linked English Standard Item List; historical annual evidence only; do not imply current activity.",
                }
            )
        catalog_unit = str(catalog["unit_raw"]) if catalog else ""
        catalog_description = str(catalog["description"]) if catalog else ""
        raw_unit_conflict = len(units) > 1 or (catalog_unit and any(unit.upper() != catalog_unit.upper() for unit in units))
        raw_description_conflict = len(normalized_descriptions) > 1 or (catalog_description and any(normalize_description(description) != normalize_description(catalog_description) for description in descriptions))
        raw_conflict_type = "unit_and_description" if raw_unit_conflict and raw_description_conflict else "unit" if raw_unit_conflict else "description"
        automatic_classification, recommended_action, classification_note = automatic_conflict_classification(
            raw_conflict_type,
            descriptions,
            catalog_description,
            units,
            catalog_unit,
        ) if raw_unit_conflict or raw_description_conflict else ("none", "none", "No identity variation detected.")
        identity_units = {unit_normalized(unit) for unit in units if unit}
        if catalog_unit:
            identity_units.add(unit_normalized(catalog_unit))
        identity_descriptions = {identity_description(description) for description in descriptions if description}
        if catalog_description:
            identity_descriptions.add(identity_description(catalog_description))
        unit_conflict = len(identity_units) > 1
        description_conflict = len(identity_descriptions) > 1
        material_conflict = unit_conflict or description_conflict
        source_review_action = ""
        source_review_note = ""
        corrected_description = ""
        reviewer_method = ""
        if material_conflict and code == "6001.59":
            source_review_action = "reviewed_multi_unit_and_source_text"
            corrected_description = "BENT NO.10 EXCAVATION"
            reviewer_method = "source_page_visual_review"
            source_review_note = (
                "The annual source pages print BENT NO.10 EXCAVATION; the production parser dropped NO.10. The annual "
                "unit CY is source-published and differs from the older catalog unit LUMP SUM. Retain one exact-code "
                "identity, correct the parsed description, preserve each unit, and never pool prices across units."
            )
        elif material_conflict and automatic_classification == "stable_description_multi_unit":
            source_review_action = "reviewed_multi_unit"
            reviewer_method = "deterministic_source_evidence_rule"
            source_review_note = (
                "Exact NDOT code and stable description support one item identity. Preserve every published unit "
                "on its period row; never pool, compare, or summarize prices across units."
            )
        elif material_conflict and not unit_conflict and high_confidence_description_identity(descriptions, catalog_description):
            source_review_action = "reviewed_description_variant"
            reviewer_method = "deterministic_source_evidence_rule"
            source_review_note = (
                "All descriptions are exact, truncation, insertion, or near-spelling variants anchored by the same "
                "exact NDOT code and normalized unit. Preserve the published row text."
            )
        elif material_conflict and not unit_conflict and code in REVIEWED_EXTRACTION_ARTIFACT_CODES:
            source_review_action = "reviewed_extraction_artifact"
            reviewer_method = "source_page_visual_review"
            source_review_note = (
                "One coherent description is corroborated by the exact NDOT code and unit; the other text visibly "
                "interleaves characters or words from an adjacent PDF row. Identity is retained, while raw text "
                "remains unchanged for provenance and separate parser remediation."
            )
        unresolved = material_conflict and not source_review_action
        if unresolved:
            conflict_type = "unit_and_description" if unit_conflict and description_conflict else "unit" if unit_conflict else "description"
            conflict_rows.append(
                {
                    "conflict_id": f"ne_ndot_identity_conflict_{code}",
                    "agency_item_code": code,
                    "agency_item_id": f"ne_ndot_{code}",
                    "conflict_type": conflict_type,
                    "catalog_description": catalog_description,
                    "catalog_unit": catalog_unit,
                    "annual_description_variants": " | ".join(descriptions),
                    "annual_unit_variants": " | ".join(units),
                    "affected_report_count": len(source_ids),
                    "affected_source_ids": " | ".join(source_ids),
                    "resolution_status": "needs_review",
                    "notes": classification_note,
                }
            )
            human_review_rows.append(
                {
                    "conflict_id": f"ne_ndot_identity_conflict_{code}",
                    "agency_item_code": code,
                    "conflict_type": conflict_type,
                    "catalog_description": catalog_description,
                    "catalog_unit": catalog_unit,
                    "annual_description_variants": " | ".join(descriptions),
                    "annual_unit_variants": " | ".join(units),
                    "affected_report_count": len(source_ids),
                    "source_ids": " | ".join(source_ids),
                    "source_locators": " | ".join(sorted({str(row["source_locator"]) for row in rows})),
                    "human_question": "Do all listed rows represent one NDOT item identity, or was this item code reused for a materially different item?",
                    "allowed_actions": "reviewed_description_variant | reviewed_multi_unit | split_identity | source_text_correction",
                    "reviewer_notes": "",
                    "final_action": "",
                }
            )
        if raw_unit_conflict or raw_description_conflict:
            resolution_status = "source_review_resolved" if source_review_action else "needs_review" if material_conflict else "auto_resolved"
            resolution_rows.append(
                {
                    "conflict_id": f"ne_ndot_identity_conflict_{code}",
                    "agency_item_code": code,
                    "agency_item_id": f"ne_ndot_{code}",
                    "automatic_classification": automatic_classification,
                    "recommended_action": recommended_action,
                    "resolution_action": source_review_action or ("needs_review" if material_conflict else recommended_action),
                    "target_agency_item_id": f"ne_ndot_{code}",
                    "corrected_description": corrected_description,
                    "corrected_unit": "",
                    "effective_from": "",
                    "effective_to": "",
                    "source_ids": " | ".join(source_ids),
                    "source_locators": " | ".join(sorted({str(row["source_locator"]) for row in rows})) if source_review_action else "",
                    "reviewed_by": reviewer_method,
                    "reviewed_on": "2026-08-05" if source_review_action else "",
                    "resolution_status": resolution_status,
                    "notes": source_review_note or classification_note,
                }
            )

    write_csv(
        STAGING_DIR / "annual_only_items.csv",
        ["agency_item_code", "agency_item_id", "first_period_start_date", "last_period_end_date", "description_variants", "unit_variants", "evidence_report_count", "item_status", "source_ids", "notes"],
        annual_only_rows,
    )
    write_csv(
        STAGING_DIR / "item_identity_conflicts.csv",
        ["conflict_id", "agency_item_code", "agency_item_id", "conflict_type", "catalog_description", "catalog_unit", "annual_description_variants", "annual_unit_variants", "affected_report_count", "affected_source_ids", "resolution_status", "notes"],
        conflict_rows,
    )
    write_csv(
        STAGING_DIR / "item_identity_resolutions.csv",
        [
            "conflict_id", "agency_item_code", "agency_item_id", "automatic_classification", "recommended_action",
            "resolution_action", "target_agency_item_id", "corrected_description", "corrected_unit", "effective_from",
            "effective_to", "source_ids", "source_locators", "reviewed_by", "reviewed_on", "resolution_status", "notes",
        ],
        resolution_rows,
    )
    write_csv(
        STAGING_DIR / "item_identity_human_review.csv",
        [
            "conflict_id", "agency_item_code", "conflict_type", "catalog_description", "catalog_unit",
            "annual_description_variants", "annual_unit_variants", "affected_report_count", "source_ids",
            "source_locators", "human_question", "allowed_actions", "reviewer_notes", "final_action",
        ],
        human_review_rows,
    )

    catalog_refs = sorted({str(row["specification_reference"]) for row in catalog_rows if row["specification_reference"]})
    spec_text = "\n".join((page.extract_text() or "") for page in PdfReader(str(CATALOG_DIR / "2017-specbook.pdf")).pages)
    section_numbers = set(re.findall(r"(?mi)^\s*(?:SECTION\s+)?(\d{3})\s+(?:--|[-–—])\s+", spec_text))
    section_numbers.update(re.findall(r"(?mi)^\s*SECTION\s+(\d{3})\b", spec_text))
    taxonomy_rows = []
    for reference in catalog_refs:
        section = reference.split(".", 1)[0]
        found = section in section_numbers
        taxonomy_rows.append(
            {
                "specification_reference": reference,
                "normalized_section": section,
                "section_found_in_2017_specifications": "true" if found else "false",
                "taxonomy_status": "supported" if found else "unclassified_pending_review",
                "notes": "Reference matches a 2017 Standard Specifications section." if found else "No matching 2017 section heading found; keep item in the unclassified fallback until reviewed.",
            }
        )
    write_csv(STAGING_DIR / "taxonomy_reference_audit.csv", ["specification_reference", "normalized_section", "section_found_in_2017_specifications", "taxonomy_status", "notes"], taxonomy_rows)

    write_csv(
        STAGING_DIR / "catalog_source_audit.csv",
        ["source_id", "source_kind", "source_url", "access_status", "machine_readable_status", "selection_decision", "notes"],
        [
            {"source_id": "ne_ndot_item_master", "source_kind": "item_master_search", "source_url": "https://ndorpubreports.nebraska.gov", "access_status": "internal_error_during_audit", "machine_readable_status": "not_verified", "selection_decision": "not_used", "notes": "The live Item History link targets a search endpoint; no stable machine-readable export was verified in Phase 1."},
            {"source_id": "ne_ndot_english_standard_item_list_2010", "source_kind": "english_standard_item_list", "source_url": "https://dot.nebraska.gov/media/qr3pibex/stditeme06252010.pdf", "access_status": "available", "machine_readable_status": "text_extractable_pdf", "selection_decision": "used_as_catalog_authority", "notes": "Linked by the NDOT Item History page; 4,276 item rows extracted."},
            {"source_id": "ne_ndot_2017_standard_specifications", "source_kind": "standard_specifications", "source_url": "https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf", "access_status": "available", "machine_readable_status": "text_extractable_pdf", "selection_decision": "used_for_taxonomy_audit", "notes": "Official 2017 hierarchy used to validate catalog specification references."},
        ],
    )

    print(f"reports={len(inventory_rows)} in_scope_rows={sum(report_rows_by_source.values())} catalog_rows={len(catalog_rows)} annual_only={len(annual_only_rows)} conflicts={len(conflict_rows)} taxonomy_refs={len(taxonomy_rows)}")


if __name__ == "__main__":
    main()
