from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


DEFAULT_SOURCE = Path("CDOTRM_EEMA_Cost_Data_Book_-_2026_-_1st_Qtr_-_4-29-2026.pdf")
DEFAULT_OUTPUT = Path("public/data/imports/cdot_cost_data_book_2026_q1_item_unit_costs.csv")
DEFAULT_SOURCE_PERIOD = "2026 Q1"
DEFAULT_ITEM_SECTION_MARKER = "Item Unit Costs by Projects -- 2026 Cost Data"

ITEM_HEADER_PATTERN = re.compile(r"^(?P<code>\d{3}-\d{5})\s+(?P<rest>.+)$")
PROJECT_ROW_PATTERN = re.compile(
    r"^(?P<project_location>.+?)\s+"
    r"(?P<date_let>\d{2}/\d{2}/\d{2})\s+"
    r"(?P<quantity>[\d,]+\.\d{2})\s+"
    r"(?P<engineer_estimate_unit_price>[\d,]+\.\d{2})\s+"
    r"(?P<average_bid_unit_price>[\d,]+\.\d{2})\s+"
    r"(?P<awarded_bid_unit_price>[\d,]+\.\d{2})$"
)
PROJECT_VALUES_PATTERN = re.compile(
    r"^(?P<date_let>\d{2}/\d{2}/\d{2})\s+"
    r"(?P<quantity>[\d,]+\.\d{2})\s+"
    r"(?P<engineer_estimate_unit_price>[\d,]+\.\d{2})\s+"
    r"(?P<average_bid_unit_price>[\d,]+\.\d{2})\s+"
    r"(?P<awarded_bid_unit_price>[\d,]+\.\d{2})$"
)
CONTINUATION_PATTERN = re.compile(r"^[A-Z][A-Z0-9 ]*[- ][A-Z0-9-]+(?:\s+|$)")
ORPHAN_PROJECT_LINE_PATTERN = re.compile(
    r"^(?:[A-Z]+\s+[A-Z]?\d{3,}[A-Z]?-\d{3}|[A-Z0-9]+-\d{3}|\d{3,}-\d{3})\s+"
)
WEIGHTED_AVERAGE_PATTERN = re.compile(r"^Weighted Average for")

FOOTER_PREFIXES = (
    "Colorado Department of Transportation",
    "Item Unit Costs by Projects --",
    "Item Number/",
    "Project Number ",
)

UNIT_SUFFIXES = sorted(
    [
        "Thousand Foot Board Measure",
        "Cubic Foot",
        "Cubic Yard",
        "Lump Sum",
        "Lin Foot",
        "M Gallon",
        "Sq Foot",
        "Sq Yard",
        "Gallon",
        "Dollar",
        "Pound",
        "Acre",
        "Each",
        "Hour",
        "Mile",
        "Week",
        "Day",
        "Ton",
    ],
    key=len,
    reverse=True,
)

UNIT_NORMALIZATION = {
    "ACRE": "ACRE",
    "CUBIC FOOT": "CF",
    "CUBIC YARD": "CY",
    "DAY": "DAY",
    "DOLLAR": "DOL",
    "EACH": "EACH",
    "GALLON": "GAL",
    "HOUR": "HOUR",
    "LIN FOOT": "LF",
    "LUMP SUM": "L S",
    "M GALLON": "MGAL",
    "MILE": "MILE",
    "POUND": "LB",
    "SQ FOOT": "SF",
    "SQ YARD": "SY",
    "THOUSAND FOOT BOARD MEASURE": "MFBM",
    "TON": "TON",
    "WEEK": "WK",
}

FIELDNAMES = [
    "source_file",
    "source_period",
    "page_number",
    "item_code",
    "item_description",
    "unit_raw",
    "unit_normalized",
    "project_location_raw",
    "date_let",
    "quantity",
    "engineer_estimate_unit_price",
    "average_bid_unit_price",
    "awarded_bid_unit_price",
    "raw_text",
]


@dataclass
class CurrentItem:
    item_code: str
    item_description: str
    unit_raw: str
    unit_normalized: str


@dataclass
class ParseStats:
    item_headers: int = 0
    project_rows: int = 0
    weighted_average_rows: int = 0
    continuation_lines: int = 0
    orphan_project_lines: int = 0
    unparsed_lines: list[tuple[int, str]] = field(default_factory=list)


def clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def split_item_header(rest: str) -> tuple[str, str]:
    for unit in UNIT_SUFFIXES:
        suffix = f" {unit}"
        if rest.endswith(suffix):
            return rest[: -len(suffix)].strip(), unit

    parts = rest.rsplit(" ", 1)
    if len(parts) == 2:
        return parts[0].strip(), parts[1].strip()

    return rest.strip(), ""


def normalize_unit(unit_raw: str) -> str:
    key = clean_line(unit_raw).upper()
    return UNIT_NORMALIZATION.get(key, key)


def normalize_number(value: str) -> str:
    return value.replace(",", "")


def normalize_date(value: str) -> str:
    month, day, year = value.split("/")
    return f"20{year}-{month}-{day}"


def should_skip_line(line: str) -> bool:
    return (
        not line
        or any(line.startswith(prefix) for prefix in FOOTER_PREFIXES)
        or re.match(r"^\d{4} Cost Data$", line) is not None
    )


def row_from_match(
    match: re.Match[str],
    current_item: CurrentItem,
    source_file: str,
    source_period: str,
    page_number: int,
    project_location_raw: str,
    raw_text: str,
) -> dict[str, str]:
    return {
        "source_file": source_file,
        "source_period": source_period,
        "page_number": str(page_number),
        "item_code": current_item.item_code,
        "item_description": current_item.item_description,
        "unit_raw": current_item.unit_raw,
        "unit_normalized": current_item.unit_normalized,
        "project_location_raw": project_location_raw.strip(),
        "date_let": normalize_date(match.group("date_let")),
        "quantity": normalize_number(match.group("quantity")),
        "engineer_estimate_unit_price": normalize_number(
            match.group("engineer_estimate_unit_price")
        ),
        "average_bid_unit_price": normalize_number(
            match.group("average_bid_unit_price")
        ),
        "awarded_bid_unit_price": normalize_number(
            match.group("awarded_bid_unit_price")
        ),
        "raw_text": raw_text,
    }


def parse_pages(
    pages: Iterable[tuple[int, str]],
    source_file: str,
    source_period: str,
    item_section_marker: str = DEFAULT_ITEM_SECTION_MARKER,
) -> tuple[list[dict[str, str]], ParseStats]:
    rows: list[dict[str, str]] = []
    stats = ParseStats()
    current_item: CurrentItem | None = None
    last_row: dict[str, str] | None = None
    in_item_section = False
    pending_project_lines: list[tuple[int, str]] = []
    pending_can_attach_to_last_row = False

    def flush_pending_project_lines() -> None:
        nonlocal pending_project_lines, pending_can_attach_to_last_row, last_row
        if not pending_project_lines:
            return

        if pending_can_attach_to_last_row and last_row:
            for _, pending_line in pending_project_lines:
                last_row["project_location_raw"] = f"{last_row['project_location_raw']} | {pending_line}"
                last_row["raw_text"] = f"{last_row['raw_text']} | {pending_line}"
                stats.continuation_lines += 1
        elif all(ORPHAN_PROJECT_LINE_PATTERN.match(pending_line) for _, pending_line in pending_project_lines):
            stats.orphan_project_lines += len(pending_project_lines)
        else:
            stats.unparsed_lines.extend(pending_project_lines)

        pending_project_lines = []
        pending_can_attach_to_last_row = False

    for page_number, page_text in pages:
        if item_section_marker in page_text:
            in_item_section = True

        if not in_item_section:
            continue

        for raw_line in page_text.splitlines():
            line = clean_line(raw_line)
            if should_skip_line(line):
                continue

            item_header_match = ITEM_HEADER_PATTERN.match(line)
            if item_header_match:
                flush_pending_project_lines()
                description, unit_raw = split_item_header(item_header_match.group("rest"))
                current_item = CurrentItem(
                    item_code=item_header_match.group("code"),
                    item_description=description,
                    unit_raw=unit_raw,
                    unit_normalized=normalize_unit(unit_raw),
                )
                stats.item_headers += 1
                last_row = None
                continue

            if WEIGHTED_AVERAGE_PATTERN.match(line):
                flush_pending_project_lines()
                stats.weighted_average_rows += 1
                last_row = None
                continue

            project_row_match = PROJECT_ROW_PATTERN.match(line)
            if project_row_match and current_item:
                flush_pending_project_lines()
                row = row_from_match(
                    project_row_match,
                    current_item,
                    source_file,
                    source_period,
                    page_number,
                    project_row_match.group("project_location"),
                    line,
                )
                rows.append(row)
                stats.project_rows += 1
                last_row = row
                continue

            project_values_match = PROJECT_VALUES_PATTERN.match(line)
            if project_values_match and current_item and pending_project_lines:
                pending_text = [pending_line for _, pending_line in pending_project_lines]
                project_location = " ".join(pending_text)
                raw_text = " | ".join([*pending_text, line])
                row = row_from_match(
                    project_values_match,
                    current_item,
                    source_file,
                    source_period,
                    page_number,
                    project_location,
                    raw_text,
                )
                pending_project_lines = []
                pending_can_attach_to_last_row = False
                rows.append(row)
                stats.project_rows += 1
                last_row = row
                continue

            if current_item and CONTINUATION_PATTERN.match(line):
                if not pending_project_lines:
                    pending_can_attach_to_last_row = last_row is not None
                pending_project_lines.append((page_number, line))
                continue

            flush_pending_project_lines()
            stats.unparsed_lines.append((page_number, line))

    flush_pending_project_lines()
    return rows, stats


def extract_pdf_pages(path: Path) -> list[tuple[int, str]]:
    try:
        from pypdf import PdfReader
    except ImportError as error:
        raise SystemExit(
            "Missing Python dependency: pypdf. In Codex, run this script with the bundled "
            "workspace Python runtime. In another environment, install pypdf first."
        ) from error

    reader = PdfReader(str(path))
    return [(index, page.extract_text() or "") for index, page in enumerate(reader.pages, start=1)]


def write_csv(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=FIELDNAMES)
        writer.writeheader()
        writer.writerows(rows)


def print_stats(stats: ParseStats, rows: list[dict[str, str]], output: Path) -> None:
    print(f"Wrote {len(rows)} item unit cost rows to {output}.")
    print(f"Found {stats.item_headers} item header row(s).")
    print(f"Skipped {stats.weighted_average_rows} weighted average row(s).")
    print(f"Attached {stats.continuation_lines} continuation line(s).")
    print(f"Skipped {stats.orphan_project_lines} orphan project line(s).")

    if stats.unparsed_lines:
        print(f"WARNING: {len(stats.unparsed_lines)} non-empty item-section line(s) were not parsed.")
        for page_number, line in stats.unparsed_lines[:20]:
            print(f"WARNING: page {page_number}: {line}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract item-level rows from a CDOT Cost Data Book PDF."
    )
    parser.add_argument("--source", default=DEFAULT_SOURCE, type=Path)
    parser.add_argument("--output", default=DEFAULT_OUTPUT, type=Path)
    parser.add_argument("--source-period", default=DEFAULT_SOURCE_PERIOD)
    parser.add_argument("--item-section-marker", default=DEFAULT_ITEM_SECTION_MARKER)
    parser.add_argument("--min-row-count", default=2000, type=int)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source PDF not found: {args.source}")

    pages = extract_pdf_pages(args.source)
    rows, stats = parse_pages(pages, args.source.name, args.source_period, args.item_section_marker)

    if len(rows) < args.min_row_count:
        raise SystemExit(f"Expected at least {args.min_row_count} item rows, found {len(rows)}.")

    write_csv(args.output, rows)
    print_stats(stats, rows, args.output)


if __name__ == "__main__":
    main()
