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

ITEM_SECTION_MARKER = "Item Unit Costs by Projects -- 2026 Cost Data"
ITEM_HEADER_PATTERN = re.compile(r"^(?P<code>\d{3}-\d{5})\s+(?P<rest>.+)$")
PROJECT_ROW_PATTERN = re.compile(
    r"^(?P<project_location>.+?)\s+"
    r"(?P<date_let>\d{2}/\d{2}/\d{2})\s+"
    r"(?P<quantity>[\d,]+\.\d{2})\s+"
    r"(?P<engineer_estimate_unit_price>[\d,]+\.\d{2})\s+"
    r"(?P<average_bid_unit_price>[\d,]+\.\d{2})\s+"
    r"(?P<awarded_bid_unit_price>[\d,]+\.\d{2})$"
)
CONTINUATION_PATTERN = re.compile(r"^[A-Z][A-Z0-9 ]*[- ][A-Z0-9-]+\s+")
WEIGHTED_AVERAGE_PATTERN = re.compile(r"^Weighted Average for")

FOOTER_PREFIXES = (
    "Colorado Department of Transportation",
    ITEM_SECTION_MARKER,
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
    return not line or any(line.startswith(prefix) for prefix in FOOTER_PREFIXES)


def parse_pages(
    pages: Iterable[tuple[int, str]],
    source_file: str,
    source_period: str,
) -> tuple[list[dict[str, str]], ParseStats]:
    rows: list[dict[str, str]] = []
    stats = ParseStats()
    current_item: CurrentItem | None = None
    last_row: dict[str, str] | None = None
    in_item_section = False

    for page_number, page_text in pages:
        if ITEM_SECTION_MARKER in page_text:
            in_item_section = True

        if not in_item_section:
            continue

        for raw_line in page_text.splitlines():
            line = clean_line(raw_line)
            if should_skip_line(line):
                continue

            item_header_match = ITEM_HEADER_PATTERN.match(line)
            if item_header_match:
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
                stats.weighted_average_rows += 1
                last_row = None
                continue

            project_row_match = PROJECT_ROW_PATTERN.match(line)
            if project_row_match and current_item:
                row = {
                    "source_file": source_file,
                    "source_period": source_period,
                    "page_number": str(page_number),
                    "item_code": current_item.item_code,
                    "item_description": current_item.item_description,
                    "unit_raw": current_item.unit_raw,
                    "unit_normalized": current_item.unit_normalized,
                    "project_location_raw": project_row_match.group("project_location").strip(),
                    "date_let": normalize_date(project_row_match.group("date_let")),
                    "quantity": normalize_number(project_row_match.group("quantity")),
                    "engineer_estimate_unit_price": normalize_number(
                        project_row_match.group("engineer_estimate_unit_price")
                    ),
                    "average_bid_unit_price": normalize_number(
                        project_row_match.group("average_bid_unit_price")
                    ),
                    "awarded_bid_unit_price": normalize_number(
                        project_row_match.group("awarded_bid_unit_price")
                    ),
                    "raw_text": line,
                }
                rows.append(row)
                stats.project_rows += 1
                last_row = row
                continue

            if current_item and last_row and CONTINUATION_PATTERN.match(line):
                last_row["project_location_raw"] = f"{last_row['project_location_raw']} | {line}"
                last_row["raw_text"] = f"{last_row['raw_text']} | {line}"
                stats.continuation_lines += 1
                continue

            stats.unparsed_lines.append((page_number, line))

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

    if stats.unparsed_lines:
        print(f"WARNING: {len(stats.unparsed_lines)} non-empty item-section line(s) were not parsed.")
        for page_number, line in stats.unparsed_lines[:20]:
            print(f"WARNING: page {page_number}: {line}")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract item-level rows from the CDOT 2026 Q1 Cost Data Book PDF."
    )
    parser.add_argument("--source", default=DEFAULT_SOURCE, type=Path)
    parser.add_argument("--output", default=DEFAULT_OUTPUT, type=Path)
    parser.add_argument("--source-period", default=DEFAULT_SOURCE_PERIOD)
    parser.add_argument("--min-row-count", default=2000, type=int)
    args = parser.parse_args()

    if not args.source.exists():
        raise SystemExit(f"Source PDF not found: {args.source}")

    pages = extract_pdf_pages(args.source)
    rows, stats = parse_pages(pages, args.source.name, args.source_period)

    if len(rows) < args.min_row_count:
        raise SystemExit(f"Expected at least {args.min_row_count} item rows, found {len(rows)}.")

    write_csv(args.output, rows)
    print_stats(stats, rows, args.output)


if __name__ == "__main__":
    main()
