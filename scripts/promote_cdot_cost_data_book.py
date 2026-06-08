from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable


DEFAULT_SOURCE_PDF = Path("CDOTRM_EEMA_Cost_Data_Book_-_2026_-_1st_Qtr_-_4-29-2026.pdf")
DEFAULT_STAGING_ITEMS = Path("public/data/imports/cdot_cost_data_book_2026_q1_item_unit_costs.csv")
DEFAULT_PROJECT_LOOKUP = Path("public/data/imports/cdot_cost_data_book_2026_q1_projects.csv")
DEFAULT_SOURCES = Path("public/data/sources.csv")
DEFAULT_PROJECTS = Path("public/data/projects.csv")
DEFAULT_OBSERVATIONS = Path("public/data/item_observations.csv")
DEFAULT_AGENCY_ITEMS = Path("public/data/agency_items.csv")

DEFAULT_SOURCE_ID = "cdot_cost_data_book_2026_q1"
DEFAULT_SOURCE_LABEL = "CDOT 2026 Q1 Cost Data Book"
DEFAULT_SOURCE_TYPE = "public_cost_book"
DEFAULT_SOURCE_YEAR = "2026"
DEFAULT_ROW_PREFIX = "cdot_2026q1"
DEFAULT_SOURCE_NOTES = "Public CDOT Cost Data Book 2026 Q1 item-level project rows promoted from reviewed staging CSV."

CONTRACTOR_LINE_PATTERN = re.compile(
    r"^(?P<letting>\d{8})\s+(?P<contractor>.+)\s+"
    r"(?P<bid_count>\d+)\s+\$(?P<awarded_bid_total>[\d,]+\.\d{2})\s+"
    r"(?P<award_index>[\d.]+)$"
)
PROJECT_LINE_PATTERN = re.compile(
    r"^(?P<project_number>(?:[A-Z]+\s+\d{3,}[A-Z]?-\d{3}|[A-Z0-9]+-\d{3}|\d{3,}-\d{3}))\s+"
    r"(?P<project_location>.+?)"
    r"(?:\s+(?P<district>\d)(?:\s+(?P<terrain>[A-Z]))?)?$"
)

PRICE_TYPES = [
    ("cdot_awarded_bid", "awarded_bid_unit_price"),
    ("cdot_average_bid", "average_bid_unit_price"),
    ("cdot_engineer_estimate", "engineer_estimate_unit_price"),
]

SOURCE_FIELDS = [
    "source_id",
    "source_type",
    "agency",
    "state",
    "source_label",
    "data_year",
    "notes",
]
PROJECT_FIELDS = [
    "project_id",
    "project_name",
    "agency_owner",
    "state",
    "county_region",
    "work_type",
    "estimate_let_date",
    "source_id",
    "project_number",
    "project_location_raw",
    "contractor",
    "district",
    "terrain",
    "bid_count",
    "awarded_bid_total",
    "award_index",
]
OBSERVATION_FIELDS = [
    "observation_id",
    "project_id",
    "source_id",
    "agency_item_code",
    "description_raw",
    "description_normalized",
    "unit_raw",
    "unit_normalized",
    "quantity",
    "unit_price",
    "extended_price",
    "discipline",
    "price_type",
    "date_basis",
]


@dataclass(frozen=True)
class CostBookProject:
    project_number: str
    project_id: str
    project_location_raw: str
    project_name: str
    letting_date: str
    contractor: str
    district: str
    terrain: str
    bid_count: str
    awarded_bid_total: str
    award_index: str


def clean_line(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def normalize_number(value: str) -> str:
    return value.replace(",", "").replace("$", "")


def normalize_description(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower().replace("&", " and "))).strip()


def normalize_yyyymmdd(value: str) -> str:
    return f"{value[0:4]}-{value[4:6]}-{value[6:8]}"


def slugify_project_number(project_number: str, row_prefix: str = DEFAULT_ROW_PREFIX) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", project_number.lower()).strip("_")
    return f"{row_prefix}_{slug}"


def parse_project_list_pages(
    pages: Iterable[tuple[int, str]],
    row_prefix: str = DEFAULT_ROW_PREFIX,
) -> list[CostBookProject]:
    projects: list[CostBookProject] = []
    current_contract: dict[str, str] | None = None

    for _, page_text in pages:
        if "Projects Bid From" not in page_text:
            continue

        for raw_line in page_text.splitlines():
            line = clean_line(raw_line)
            if not line or line.startswith("Colorado Department of Transportation"):
                continue
            if re.match(r"^\d{4} Cost Data$", line) or line.startswith("Projects Bid From"):
                continue
            if line.startswith("Bid Contractor/") or line.startswith("Letting Project Number"):
                continue
            if line.startswith("Totals "):
                continue

            contract_match = CONTRACTOR_LINE_PATTERN.match(line)
            if contract_match:
                current_contract = {
                    "letting_date": normalize_yyyymmdd(contract_match.group("letting")),
                    "contractor": contract_match.group("contractor").strip(),
                    "bid_count": contract_match.group("bid_count"),
                    "awarded_bid_total": normalize_number(contract_match.group("awarded_bid_total")),
                    "award_index": contract_match.group("award_index"),
                }
                continue

            project_match = PROJECT_LINE_PATTERN.match(line)
            if project_match and current_contract:
                project_number = project_match.group("project_number").strip()
                project_location = project_match.group("project_location").strip()
                projects.append(
                    CostBookProject(
                        project_number=project_number,
                        project_id=slugify_project_number(project_number, row_prefix),
                        project_location_raw=f"{project_number} {project_location}",
                        project_name=project_location,
                        letting_date=current_contract["letting_date"],
                        contractor=current_contract["contractor"],
                        district=project_match.group("district") or "",
                        terrain=project_match.group("terrain") or "",
                        bid_count=current_contract["bid_count"],
                        awarded_bid_total=current_contract["awarded_bid_total"],
                        award_index=current_contract["award_index"],
                    )
                )

    return dedupe_projects(projects)


def dedupe_projects(projects: list[CostBookProject]) -> list[CostBookProject]:
    by_number: dict[str, CostBookProject] = {}
    for project in projects:
        by_number.setdefault(project.project_number, project)
    return sorted(by_number.values(), key=lambda project: project.project_number)


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


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as source:
        return [dict(row) for row in csv.DictReader(source)]


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def agency_item_codes(path: Path) -> set[str]:
    return {row["item_code"].strip().upper() for row in read_csv(path) if row.get("item_code")}


def project_lookup(projects: list[CostBookProject]) -> dict[str, CostBookProject]:
    return {project.project_number: project for project in projects}


def find_project_for_item_row(
    item_row: dict[str, str],
    projects_by_number: dict[str, CostBookProject],
) -> CostBookProject | None:
    raw_location = item_row["project_location_raw"].strip()
    for project_number in sorted(projects_by_number, key=len, reverse=True):
        if raw_location == project_number or raw_location.startswith(f"{project_number} "):
            return projects_by_number[project_number]
    return None


def validate_import(
    staging_rows: list[dict[str, str]],
    projects: list[CostBookProject],
    known_item_codes: set[str],
    min_staging_rows: int = 2000,
    min_project_rows: int = 20,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    projects_by_number = project_lookup(projects)
    required_fields = [
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
    ]

    if len(staging_rows) < min_staging_rows:
        errors.append(f"Expected at least {min_staging_rows} staging rows, found {len(staging_rows)}")

    if len(projects) < min_project_rows:
        errors.append(f"Expected at least {min_project_rows} parsed project rows, found {len(projects)}")

    missing_item_codes = sorted(
        {row["item_code"].strip().upper() for row in staging_rows if row["item_code"].strip().upper() not in known_item_codes}
    )
    if missing_item_codes:
        warnings.append(f"Missing agency item codes: {', '.join(missing_item_codes)}")

    unmatched_projects = sorted(
        {
            row["project_location_raw"]
            for row in staging_rows
            if not find_project_for_item_row(row, projects_by_number)
        }
    )
    if unmatched_projects:
        errors.append(f"Unmatched project/location rows: {len(unmatched_projects)}")
        for value in unmatched_projects[:20]:
            errors.append(f"Unmatched project/location: {value}")

    for index, row in enumerate(staging_rows, start=1):
        missing_fields = [field for field in required_fields if not row.get(field, "").strip()]
        if missing_fields:
            errors.append(f"Staging row {index}: missing {', '.join(missing_fields)}")

    return errors, warnings


def project_rows(
    projects: list[CostBookProject],
    source_id: str = DEFAULT_SOURCE_ID,
) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    for project in projects:
        rows.append(
            {
                "project_id": project.project_id,
                "project_name": project.project_name,
                "agency_owner": "CDOT",
                "state": "CO",
                "county_region": f"Colorado / CDOT District {project.district}" if project.district else "Colorado",
                "work_type": "Roadway",
                "estimate_let_date": project.letting_date,
                "source_id": source_id,
                "project_number": project.project_number,
                "project_location_raw": project.project_location_raw,
                "contractor": project.contractor,
                "district": project.district,
                "terrain": project.terrain,
                "bid_count": project.bid_count,
                "awarded_bid_total": project.awarded_bid_total,
                "award_index": project.award_index,
            }
        )
    return rows


def source_row(
    source_id: str = DEFAULT_SOURCE_ID,
    source_label: str = DEFAULT_SOURCE_LABEL,
    source_type: str = DEFAULT_SOURCE_TYPE,
    source_year: str = DEFAULT_SOURCE_YEAR,
    source_notes: str = DEFAULT_SOURCE_NOTES,
) -> dict[str, str]:
    return {
        "source_id": source_id,
        "source_type": source_type,
        "agency": "CDOT",
        "state": "CO",
        "source_label": source_label,
        "data_year": source_year,
        "notes": source_notes,
    }


def decimal_money(value: str) -> Decimal:
    return Decimal(normalize_number(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def promoted_observation_rows(
    staging_rows: list[dict[str, str]],
    projects_by_number: dict[str, CostBookProject],
    source_id: str = DEFAULT_SOURCE_ID,
    row_prefix: str = DEFAULT_ROW_PREFIX,
) -> list[dict[str, str]]:
    observations: list[dict[str, str]] = []

    for row_number, staging_row in enumerate(staging_rows, start=1):
        project = find_project_for_item_row(staging_row, projects_by_number)
        if not project:
            continue

        quantity = decimal_money(staging_row["quantity"])
        for price_type, source_column in PRICE_TYPES:
            unit_price = decimal_money(staging_row[source_column])
            observations.append(
                {
                    "observation_id": f"{row_prefix}_{row_number:04d}_{price_type.replace('cdot_', '')}",
                    "project_id": project.project_id,
                    "source_id": source_id,
                    "agency_item_code": staging_row["item_code"].strip().upper(),
                    "description_raw": staging_row["item_description"],
                    "description_normalized": normalize_description(staging_row["item_description"]),
                    "unit_raw": staging_row["unit_raw"],
                    "unit_normalized": staging_row["unit_normalized"],
                    "quantity": str(quantity),
                    "unit_price": str(unit_price),
                    "extended_price": str((quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
                    "discipline": "Roadway",
                    "price_type": price_type,
                    "date_basis": staging_row["date_let"],
                }
            )

    return observations


def normalize_existing_rows(rows: list[dict[str, str]], fieldnames: list[str]) -> list[dict[str, str]]:
    return [{field: row.get(field, "") for field in fieldnames} for row in rows]


def write_project_lookup(path: Path, projects: list[CostBookProject]) -> None:
    write_csv(path, project_rows(projects), PROJECT_FIELDS)


def promote(args: argparse.Namespace) -> None:
    projects = parse_project_list_pages(extract_pdf_pages(args.source_pdf), args.row_prefix)
    staging_rows = read_csv(args.staging_items)
    known_item_codes = agency_item_codes(args.agency_items)
    errors, warnings = validate_import(staging_rows, projects, known_item_codes)

    for warning in warnings:
        print(f"WARNING: {warning}")

    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)

    projects_by_number = project_lookup(projects)
    promoted_observations = promoted_observation_rows(
        staging_rows,
        projects_by_number,
        args.source_id,
        args.row_prefix,
    )

    if len(promoted_observations) != len(staging_rows) * len(PRICE_TYPES):
        raise SystemExit(
            f"Expected {len(staging_rows) * len(PRICE_TYPES)} promoted observations, "
            f"found {len(promoted_observations)}."
        )

    if args.dry_run:
        print(f"Validated {len(staging_rows)} staging rows.")
        print(f"Parsed {len(projects)} project rows.")
        print(f"Would write {len(promoted_observations)} promoted observations.")
        return

    existing_sources = [
        row for row in normalize_existing_rows(read_csv(args.sources), SOURCE_FIELDS)
        if row["source_id"] != args.source_id
    ]
    existing_projects = [
        row for row in normalize_existing_rows(read_csv(args.projects), PROJECT_FIELDS)
        if row["source_id"] != args.source_id and not row["project_id"].startswith(f"{args.row_prefix}_")
    ]
    existing_observations = [
        row for row in normalize_existing_rows(read_csv(args.observations), OBSERVATION_FIELDS)
        if row["source_id"] != args.source_id and not row["observation_id"].startswith(f"{args.row_prefix}_")
    ]

    write_csv(args.project_lookup_output, project_rows(projects, args.source_id), PROJECT_FIELDS)
    write_csv(
        args.sources,
        existing_sources
        + [
            source_row(
                args.source_id,
                args.source_label,
                args.source_type,
                args.source_year,
                args.source_notes,
            )
        ],
        SOURCE_FIELDS,
    )
    write_csv(args.projects, existing_projects + project_rows(projects, args.source_id), PROJECT_FIELDS)
    write_csv(args.observations, existing_observations + promoted_observations, OBSERVATION_FIELDS)

    print(f"Validated {len(staging_rows)} staging rows.")
    print(f"Parsed {len(projects)} project rows.")
    print(f"Wrote {len(promoted_observations)} promoted observations.")
    print(f"Wrote project lookup to {args.project_lookup_output}.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Validate and promote CDOT Cost Data Book staging rows into app CSV data."
    )
    parser.add_argument("--source-pdf", default=DEFAULT_SOURCE_PDF, type=Path)
    parser.add_argument("--staging-items", default=DEFAULT_STAGING_ITEMS, type=Path)
    parser.add_argument("--project-lookup-output", default=DEFAULT_PROJECT_LOOKUP, type=Path)
    parser.add_argument("--sources", default=DEFAULT_SOURCES, type=Path)
    parser.add_argument("--projects", default=DEFAULT_PROJECTS, type=Path)
    parser.add_argument("--observations", default=DEFAULT_OBSERVATIONS, type=Path)
    parser.add_argument("--agency-items", default=DEFAULT_AGENCY_ITEMS, type=Path)
    parser.add_argument("--source-id", default=DEFAULT_SOURCE_ID)
    parser.add_argument("--source-label", default=DEFAULT_SOURCE_LABEL)
    parser.add_argument("--source-type", default=DEFAULT_SOURCE_TYPE)
    parser.add_argument("--source-year", default=DEFAULT_SOURCE_YEAR)
    parser.add_argument("--source-notes", default=DEFAULT_SOURCE_NOTES)
    parser.add_argument("--row-prefix", default=DEFAULT_ROW_PREFIX)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    promote(args)


if __name__ == "__main__":
    main()
