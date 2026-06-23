from __future__ import annotations

import argparse
import csv
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path


DATA_DIR = Path("public/data")

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
AGENCY_ITEM_FIELDS = [
    "agency_item_id",
    "state",
    "agency",
    "item_code",
    "official_description",
    "official_abbreviated_description",
    "official_unit",
    "canonical_item_id",
]
SPEC_SECTION_FIELDS = [
    "section_prefix",
    "division_prefix",
    "division_title",
    "section_title",
    "source_year",
    "source_url",
]
INFLATION_INDEX_FIELDS = [
    "index_id",
    "index_name",
    "period_year",
    "period_quarter",
    "period_label",
    "period_start_date",
    "period_end_date",
    "index_value",
    "source_url",
    "notes",
]
BIDDER_BID_FIELDS = [
    "bid_id",
    "project_id",
    "source_id",
    "bidder_name",
    "bid_total",
    "bid_rank",
    "apparent_low",
]
BIDDER_ITEM_FIELDS = [
    "bidder_item_observation_id",
    "bid_id",
    "project_id",
    "source_id",
    "agency_item_code",
    "description_raw",
    "unit_raw",
    "unit_normalized",
    "quantity",
    "unit_price",
    "extended_price",
]

SOURCE_REQUIRED_VALUES = ["source_id", "source_type", "agency", "state", "source_label", "data_year"]
PROJECT_REQUIRED_VALUES = ["project_id", "agency_owner", "state", "county_region", "work_type", "estimate_let_date", "source_id"]
OBSERVATION_REQUIRED_VALUES = [
    "observation_id",
    "project_id",
    "source_id",
    "agency_item_code",
    "description_raw",
    "unit_raw",
    "unit_normalized",
    "quantity",
    "unit_price",
    "extended_price",
    "discipline",
    "price_type",
    "date_basis",
]
AGENCY_ITEM_REQUIRED_VALUES = ["agency_item_id", "state", "agency", "item_code", "official_description", "official_unit"]
SPEC_SECTION_REQUIRED_VALUES = ["section_prefix", "division_prefix", "division_title", "section_title", "source_year", "source_url"]
INFLATION_INDEX_REQUIRED_VALUES = [
    "index_id",
    "index_name",
    "period_year",
    "period_quarter",
    "period_label",
    "period_start_date",
    "period_end_date",
    "index_value",
    "source_url",
]
BIDDER_BID_REQUIRED_VALUES = ["bid_id", "project_id", "source_id", "bidder_name", "bid_total"]
BIDDER_ITEM_REQUIRED_VALUES = [
    "bidder_item_observation_id",
    "bid_id",
    "project_id",
    "source_id",
    "agency_item_code",
    "description_raw",
    "unit_raw",
    "unit_normalized",
    "quantity",
    "unit_price",
    "extended_price",
]
PROJECT_OPTIONAL_METADATA = ["contractor", "district", "terrain", "bid_count", "awarded_bid_total", "award_index"]

KNOWN_PRICE_TYPES = {
    "cdot_awarded_bid",
    "cdot_average_bid",
    "cdot_engineer_estimate",
    "public_bid_tab_average",
    "public_bid_tab_engineer_estimate",
}
DEMO_SOURCE_TYPES = {"public_demo", "internal_demo"}
DEMO_PRICE_TYPES = {"bid_tab_demo", "engineers_estimate"}
SMOKE_BASELINES = {
    "304-06007": 151,
    "626-00000": 422,
    "630-80341": 420,
    "630-00012": 415,
    "630-80342": 411,
    "630-00000": 396,
}


@dataclass
class CsvTable:
    name: str
    path: Path
    headers: list[str]
    rows: list[dict[str, str]]


def read_table(data_dir: Path, name: str) -> CsvTable:
    path = data_dir / name
    with path.open(newline="", encoding="utf-8") as source:
        reader = csv.DictReader(source)
        headers = reader.fieldnames or []
        rows = [{key: (value or "").strip() for key, value in row.items() if key is not None} for row in reader]
    return CsvTable(name=name, path=path, headers=headers, rows=rows)


def main() -> None:
    parser = argparse.ArgumentParser(description="Validate the app-loaded public data CSV package.")
    parser.add_argument("--data-dir", default=DATA_DIR, type=Path)
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []

    sources = read_table(args.data_dir, "sources.csv")
    projects = read_table(args.data_dir, "projects.csv")
    observations = read_table(args.data_dir, "item_observations.csv")
    agency_items = read_table(args.data_dir, "agency_items.csv")
    spec_sections = read_table(args.data_dir, "spec_sections.csv")
    inflation_indexes = read_table(args.data_dir, "inflation_index.csv")
    bidder_bids = read_table(args.data_dir, "bidder_bids.csv")
    bidder_items = read_table(args.data_dir, "bidder_item_observations.csv")

    validate_headers(sources, SOURCE_FIELDS, errors)
    validate_headers(projects, PROJECT_FIELDS, errors)
    validate_headers(observations, OBSERVATION_FIELDS, errors)
    validate_headers(agency_items, AGENCY_ITEM_FIELDS, errors)
    validate_headers(spec_sections, SPEC_SECTION_FIELDS, errors)
    validate_headers(inflation_indexes, INFLATION_INDEX_FIELDS, errors)
    validate_headers(bidder_bids, BIDDER_BID_FIELDS, errors)
    validate_headers(bidder_items, BIDDER_ITEM_FIELDS, errors)

    validate_required_values(sources, SOURCE_REQUIRED_VALUES, "source_id", errors)
    validate_required_values(projects, PROJECT_REQUIRED_VALUES, "project_id", errors)
    validate_required_values(observations, OBSERVATION_REQUIRED_VALUES, "observation_id", errors)
    validate_required_values(agency_items, AGENCY_ITEM_REQUIRED_VALUES, "agency_item_id", errors)
    validate_required_values(spec_sections, SPEC_SECTION_REQUIRED_VALUES, "section_prefix", errors)
    validate_required_values(inflation_indexes, INFLATION_INDEX_REQUIRED_VALUES, "index_id", errors)
    validate_required_values(bidder_bids, BIDDER_BID_REQUIRED_VALUES, "bid_id", errors)
    validate_required_values(bidder_items, BIDDER_ITEM_REQUIRED_VALUES, "bidder_item_observation_id", errors)

    validate_unique_id(sources, "source_id", errors)
    validate_unique_id(projects, "project_id", errors)
    validate_unique_id(observations, "observation_id", errors)
    validate_unique_id(agency_items, "agency_item_id", errors)
    validate_unique_id(spec_sections, "section_prefix", errors)
    validate_unique_id(inflation_indexes, "index_id", errors)
    validate_unique_id(bidder_bids, "bid_id", errors)
    validate_unique_id(bidder_items, "bidder_item_observation_id", errors)

    source_by_id = {row["source_id"]: row for row in sources.rows}
    project_by_id = {row["project_id"]: row for row in projects.rows}
    agency_item_codes = {row["item_code"].upper() for row in agency_items.rows if row.get("item_code")}
    section_prefixes = {row["section_prefix"] for row in spec_sections.rows if row.get("section_prefix")}

    validate_sources(sources, errors)
    validate_projects(projects, source_by_id, errors, warnings)
    validate_observations(observations, source_by_id, project_by_id, agency_item_codes, errors, warnings)
    validate_agency_sections(agency_items, section_prefixes, warnings)
    validate_inflation_indexes(inflation_indexes, projects, errors, warnings)
    validate_bidder_bids(bidder_bids, source_by_id, project_by_id, errors, warnings)
    validate_bidder_items(bidder_items, bidder_bids, source_by_id, project_by_id, agency_item_codes, errors, warnings)
    validate_smoke_items(observations, source_by_id, project_by_id, errors, warnings)

    print_summary(sources, projects, observations, source_by_id, inflation_indexes, bidder_bids, bidder_items)
    print_smoke_summary(observations)
    print_messages("WARNING", warnings)
    print_messages("ERROR", errors)

    if errors:
        raise SystemExit(1)

    print("\nPASS: Data package validation completed with no errors.")


def validate_headers(table: CsvTable, expected: list[str], errors: list[str]) -> None:
    missing = [field for field in expected if field not in table.headers]
    if missing:
        errors.append(f"{table.name}: missing required column(s): {', '.join(missing)}")


def validate_required_values(table: CsvTable, fields: list[str], id_field: str, errors: list[str]) -> None:
    for index, row in enumerate(table.rows, start=2):
        row_id = row.get(id_field) or f"line {index}"
        missing = [field for field in fields if not row.get(field, "").strip()]
        if missing:
            errors.append(f"{table.name} {row_id}: blank required field(s): {', '.join(missing)}")


def validate_unique_id(table: CsvTable, id_field: str, errors: list[str]) -> None:
    counts = Counter(row.get(id_field, "") for row in table.rows if row.get(id_field, ""))
    duplicates = sorted(value for value, count in counts.items() if count > 1)
    for value in duplicates[:20]:
        errors.append(f"{table.name}: duplicate {id_field}: {value}")
    if len(duplicates) > 20:
        errors.append(f"{table.name}: {len(duplicates) - 20} additional duplicate {id_field} value(s).")


def validate_sources(table: CsvTable, errors: list[str]) -> None:
    for row in table.rows:
        source_id = row["source_id"]
        source_type = row["source_type"]
        if is_demo_id(source_id) or source_type in DEMO_SOURCE_TYPES:
            errors.append(f"sources.csv {source_id}: demo source is not allowed in the app-loaded package.")
        if row.get("data_year") and not is_number(row["data_year"]):
            errors.append(f"sources.csv {source_id}: data_year is not numeric.")


def validate_projects(
    table: CsvTable,
    source_by_id: dict[str, dict[str, str]],
    errors: list[str],
    warnings: list[str],
) -> None:
    blank_optional_counts: Counter[str] = Counter()

    for row in table.rows:
        project_id = row["project_id"]
        source_id = row["source_id"]
        if source_id not in source_by_id:
            errors.append(f"projects.csv {project_id}: source_id {source_id} was not found in sources.csv.")
        if is_demo_id(project_id) or is_demo_id(source_id):
            errors.append(f"projects.csv {project_id}: demo project/source ID is not allowed.")
        if row.get("estimate_let_date") and not is_iso_date(row["estimate_let_date"]):
            errors.append(f"projects.csv {project_id}: estimate_let_date is not YYYY-MM-DD.")
        for field in ["bid_count", "awarded_bid_total", "award_index"]:
            if row.get(field) and not is_number(row[field]):
                errors.append(f"projects.csv {project_id}: {field} is not numeric.")
        for field in PROJECT_OPTIONAL_METADATA:
            if not row.get(field):
                blank_optional_counts[field] += 1

    add_optional_metadata_warnings("projects.csv", len(table.rows), blank_optional_counts, warnings)


def validate_observations(
    table: CsvTable,
    source_by_id: dict[str, dict[str, str]],
    project_by_id: dict[str, dict[str, str]],
    agency_item_codes: set[str],
    errors: list[str],
    warnings: list[str],
) -> None:
    missing_agency_codes: Counter[str] = Counter()

    for row in table.rows:
        observation_id = row["observation_id"]
        project_id = row["project_id"]
        source_id = row["source_id"]
        price_type = row["price_type"]

        if project_id not in project_by_id:
            errors.append(f"item_observations.csv {observation_id}: project_id {project_id} was not found in projects.csv.")
        if source_id not in source_by_id:
            errors.append(f"item_observations.csv {observation_id}: source_id {source_id} was not found in sources.csv.")
        if project_id in project_by_id and source_id != project_by_id[project_id]["source_id"]:
            errors.append(
                f"item_observations.csv {observation_id}: source_id {source_id} does not match project {project_id} source_id {project_by_id[project_id]['source_id']}."
            )
        if is_demo_id(observation_id) or is_demo_id(source_id):
            errors.append(f"item_observations.csv {observation_id}: demo observation/source ID is not allowed.")
        if price_type in DEMO_PRICE_TYPES:
            errors.append(f"item_observations.csv {observation_id}: legacy demo price_type {price_type} is not allowed.")
        if price_type not in KNOWN_PRICE_TYPES:
            warnings.append(f"item_observations.csv {observation_id}: unexpected price_type {price_type}.")
        if row.get("date_basis") and not is_iso_date(row["date_basis"]):
            errors.append(f"item_observations.csv {observation_id}: date_basis is not YYYY-MM-DD.")
        for field in ["quantity", "unit_price", "extended_price"]:
            if row.get(field) and not is_number(row[field]):
                errors.append(f"item_observations.csv {observation_id}: {field} is not numeric.")
        if row["agency_item_code"].upper() not in agency_item_codes:
            missing_agency_codes[row["agency_item_code"].upper()] += 1

    if missing_agency_codes:
        preview = ", ".join(f"{code} ({count})" for code, count in missing_agency_codes.most_common(20))
        warnings.append(f"Observation item codes missing from agency_items.csv: {preview}")


def validate_agency_sections(
    agency_items: CsvTable,
    section_prefixes: set[str],
    warnings: list[str],
) -> None:
    missing_prefixes = sorted(
        {
            row["item_code"].split("-", 1)[0]
            for row in agency_items.rows
            if row.get("item_code") and row["item_code"].split("-", 1)[0] not in section_prefixes
        }
    )
    if missing_prefixes:
        warnings.append(f"Agency item prefixes missing from spec_sections.csv: {', '.join(missing_prefixes[:30])}")


def validate_inflation_indexes(
    inflation_indexes: CsvTable,
    projects: CsvTable,
    errors: list[str],
    warnings: list[str],
) -> None:
    period_counts: Counter[str] = Counter()
    index_periods: set[tuple[int, int]] = set()

    for row in inflation_indexes.rows:
        index_id = row["index_id"]
        period_label = row["period_label"]
        period_counts[period_label] += 1

        period = parse_period(row.get("period_year", ""), row.get("period_quarter", ""))
        label_period = parse_period_label(period_label)
        if period is None:
            errors.append(f"inflation_index.csv {index_id}: period_year/period_quarter are invalid.")
            continue
        if label_period is None:
            errors.append(f"inflation_index.csv {index_id}: period_label is not shaped like YYYY Qn.")
        elif label_period != period:
            errors.append(f"inflation_index.csv {index_id}: period_label does not match period_year/period_quarter.")

        index_periods.add(period)

        if row.get("index_value") and not is_number(row["index_value"]):
            errors.append(f"inflation_index.csv {index_id}: index_value is not numeric.")
        elif row.get("index_value") and Decimal(row["index_value"].replace("$", "").replace(",", "")) <= 0:
            errors.append(f"inflation_index.csv {index_id}: index_value must be greater than zero.")
        for field in ["period_start_date", "period_end_date"]:
            if row.get(field) and not is_iso_date(row[field]):
                errors.append(f"inflation_index.csv {index_id}: {field} is not YYYY-MM-DD.")

    for period_label, count in sorted(period_counts.items()):
        if count > 1:
            errors.append(f"inflation_index.csv: duplicate period_label {period_label}.")

    if not index_periods:
        errors.append("inflation_index.csv: no valid NHCCI periods loaded.")
        return

    latest_index_period = max(index_periods)
    project_periods = {
        period
        for period in (period_from_date(row.get("estimate_let_date", "")) for row in projects.rows)
        if period is not None
    }
    missing_project_periods = sorted(project_periods - index_periods)

    for period in missing_project_periods:
        message = f"NHCCI index missing project evidence quarter {format_period(period)}."
        if period > latest_index_period:
            warnings.append(f"{message} Latest loaded NHCCI quarter is {format_period(latest_index_period)}.")
        else:
            errors.append(message)


def validate_bidder_bids(
    table: CsvTable,
    source_by_id: dict[str, dict[str, str]],
    project_by_id: dict[str, dict[str, str]],
    errors: list[str],
    warnings: list[str],
) -> None:
    apparent_low_counts: Counter[str] = Counter()
    bid_counts_by_project: Counter[str] = Counter()

    for row in table.rows:
        bid_id = row["bid_id"]
        project_id = row["project_id"]
        source_id = row["source_id"]
        apparent_low = row.get("apparent_low", "").lower()

        if project_id not in project_by_id:
            errors.append(f"bidder_bids.csv {bid_id}: project_id {project_id} was not found in projects.csv.")
        if source_id not in source_by_id:
            errors.append(f"bidder_bids.csv {bid_id}: source_id {source_id} was not found in sources.csv.")
        if project_id in project_by_id and source_id != project_by_id[project_id]["source_id"]:
            errors.append(
                f"bidder_bids.csv {bid_id}: source_id {source_id} does not match project {project_id} source_id {project_by_id[project_id]['source_id']}."
            )
        if is_demo_id(bid_id) or is_demo_id(source_id):
            errors.append(f"bidder_bids.csv {bid_id}: demo bid/source ID is not allowed.")
        if row.get("bid_total") and not is_number(row["bid_total"]):
            errors.append(f"bidder_bids.csv {bid_id}: bid_total is not numeric.")
        if row.get("bid_rank") and not is_number(row["bid_rank"]):
            errors.append(f"bidder_bids.csv {bid_id}: bid_rank is not numeric.")
        if apparent_low not in {"true", "false"}:
            errors.append(f"bidder_bids.csv {bid_id}: apparent_low must be true or false.")
        if apparent_low == "true":
            apparent_low_counts[project_id] += 1
        bid_counts_by_project[project_id] += 1

    for project_id, count in sorted(apparent_low_counts.items()):
        if count != 1:
            errors.append(f"bidder_bids.csv project {project_id}: expected one apparent low bidder, found {count}.")

    for project_id, count in sorted(bid_counts_by_project.items()):
        project = project_by_id.get(project_id)
        if project and project.get("bid_count") and is_number(project["bid_count"]) and int(Decimal(project["bid_count"])) != count:
            warnings.append(f"bidder_bids.csv project {project_id}: bid_count is {project['bid_count']} but parsed bidder rows are {count}.")


def validate_bidder_items(
    table: CsvTable,
    bids: CsvTable,
    source_by_id: dict[str, dict[str, str]],
    project_by_id: dict[str, dict[str, str]],
    agency_item_codes: set[str],
    errors: list[str],
    warnings: list[str],
) -> None:
    bid_by_id = {row["bid_id"]: row for row in bids.rows}
    missing_agency_codes: Counter[str] = Counter()

    for row in table.rows:
        item_id = row["bidder_item_observation_id"]
        bid_id = row["bid_id"]
        project_id = row["project_id"]
        source_id = row["source_id"]

        bid = bid_by_id.get(bid_id)
        if not bid:
            errors.append(f"bidder_item_observations.csv {item_id}: bid_id {bid_id} was not found in bidder_bids.csv.")
        elif bid["project_id"] != project_id or bid["source_id"] != source_id:
            errors.append(f"bidder_item_observations.csv {item_id}: bid_id {bid_id} project/source does not match item row.")
        if project_id not in project_by_id:
            errors.append(f"bidder_item_observations.csv {item_id}: project_id {project_id} was not found in projects.csv.")
        if source_id not in source_by_id:
            errors.append(f"bidder_item_observations.csv {item_id}: source_id {source_id} was not found in sources.csv.")
        if project_id in project_by_id and source_id != project_by_id[project_id]["source_id"]:
            errors.append(
                f"bidder_item_observations.csv {item_id}: source_id {source_id} does not match project {project_id} source_id {project_by_id[project_id]['source_id']}."
            )
        if is_demo_id(item_id) or is_demo_id(source_id):
            errors.append(f"bidder_item_observations.csv {item_id}: demo item/source ID is not allowed.")
        for field in ["quantity", "unit_price", "extended_price"]:
            if row.get(field) and not is_number(row[field]):
                errors.append(f"bidder_item_observations.csv {item_id}: {field} is not numeric.")
        if all(row.get(field) and is_number(row[field]) for field in ["quantity", "unit_price", "extended_price"]):
            calculated = Decimal(row["quantity"]) * Decimal(row["unit_price"])
            stored = Decimal(row["extended_price"])
            if abs(calculated - stored) > Decimal("0.01"):
                errors.append(f"bidder_item_observations.csv {item_id}: quantity times unit_price does not equal extended_price.")
        if row["agency_item_code"].upper() not in agency_item_codes:
            missing_agency_codes[row["agency_item_code"].upper()] += 1

    if missing_agency_codes:
        preview = ", ".join(f"{code} ({count})" for code, count in missing_agency_codes.most_common(20))
        warnings.append(f"Bidder item codes missing from agency_items.csv: {preview}")


def validate_smoke_items(
    observations: CsvTable,
    source_by_id: dict[str, dict[str, str]],
    project_by_id: dict[str, dict[str, str]],
    errors: list[str],
    warnings: list[str],
) -> None:
    awarded_by_item: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in observations.rows:
        if row["price_type"] == "cdot_awarded_bid":
            awarded_by_item[row["agency_item_code"].upper()].append(row)

    for item_code, baseline_count in SMOKE_BASELINES.items():
        rows = awarded_by_item.get(item_code, [])
        if not rows:
            errors.append(f"Smoke item {item_code}: no cdot_awarded_bid observations found.")
            continue
        if len(rows) != baseline_count:
            warnings.append(
                f"Smoke item {item_code}: awarded-bid count changed from baseline {baseline_count} to {len(rows)}."
            )
        missing_source_count = 0
        missing_project_count = 0
        wrong_source_type_counts: Counter[str] = Counter()
        demo_evidence_count = 0
        for row in rows:
            source = source_by_id.get(row["source_id"])
            project = project_by_id.get(row["project_id"])
            if not source:
                missing_source_count += 1
                continue
            if not project:
                missing_project_count += 1
                continue
            if source["source_type"] != "public_cost_book":
                wrong_source_type_counts[source["source_type"]] += 1
            if row["price_type"] in DEMO_PRICE_TYPES or is_demo_id(row["observation_id"]) or is_demo_id(row["source_id"]):
                demo_evidence_count += 1

        if missing_source_count:
            errors.append(f"Smoke item {item_code}: {missing_source_count} awarded-bid observation(s) have missing sources.")
        if missing_project_count:
            errors.append(f"Smoke item {item_code}: {missing_project_count} awarded-bid observation(s) have missing projects.")
        for source_type, count in sorted(wrong_source_type_counts.items()):
            errors.append(f"Smoke item {item_code}: {count} awarded-bid observation(s) use source_type {source_type}.")
        if demo_evidence_count:
            errors.append(f"Smoke item {item_code}: {demo_evidence_count} awarded-bid observation(s) use demo evidence.")


def add_optional_metadata_warnings(
    table_name: str,
    row_count: int,
    blank_counts: Counter[str],
    warnings: list[str],
) -> None:
    for field, count in sorted(blank_counts.items()):
        if count:
            warnings.append(f"{table_name}: {count} of {row_count} row(s) have blank optional metadata field {field}.")


def print_summary(
    sources: CsvTable,
    projects: CsvTable,
    observations: CsvTable,
    source_by_id: dict[str, dict[str, str]],
    inflation_indexes: CsvTable,
    bidder_bids: CsvTable,
    bidder_items: CsvTable,
) -> None:
    print("Data package summary")
    print(f"- Sources: {len(sources.rows)}")
    print(f"- Projects: {len(projects.rows)}")
    print(f"- Observations: {len(observations.rows)}")
    print(f"- Inflation index rows: {len(inflation_indexes.rows)}")
    print(f"- Bidder bids: {len(bidder_bids.rows)}")
    print(f"- Bidder item observations: {len(bidder_items.rows)}")

    valid_index_periods = [
        period
        for period in (parse_period(row.get("period_year", ""), row.get("period_quarter", "")) for row in inflation_indexes.rows)
        if period is not None
    ]
    if valid_index_periods:
        print(f"- Latest inflation index period: {format_period(max(valid_index_periods))}")

    project_counts = Counter(row["source_id"] for row in projects.rows)
    observation_counts = Counter(row["source_id"] for row in observations.rows)
    print("\nCounts by source")
    for source_id in sorted(source_by_id):
        source = source_by_id[source_id]
        print(
            f"- {source_id}: {source['source_label']}; "
            f"projects={project_counts[source_id]}, observations={observation_counts[source_id]}"
        )


def print_smoke_summary(observations: CsvTable) -> None:
    awarded_counts = Counter(
        row["agency_item_code"].upper()
        for row in observations.rows
        if row["price_type"] == "cdot_awarded_bid"
    )
    print("\nSmoke-test awarded-bid counts")
    for item_code, baseline_count in SMOKE_BASELINES.items():
        print(f"- {item_code}: {awarded_counts[item_code]} (baseline {baseline_count})")


def print_messages(label: str, messages: list[str]) -> None:
    if not messages:
        print(f"\n{label}: none")
        return

    print(f"\n{label}:")
    for message in messages:
        print(f"- {message}")


def is_demo_id(value: str) -> bool:
    return value.startswith("demo_")


def is_number(value: str) -> bool:
    try:
        Decimal(value.replace("$", "").replace(",", ""))
    except InvalidOperation:
        return False
    return True


def is_iso_date(value: str) -> bool:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return False
    return True


def period_from_date(value: str) -> tuple[int, int] | None:
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d")
    except ValueError:
        return None
    return parsed.year, ((parsed.month - 1) // 3) + 1


def parse_period(year_value: str, quarter_value: str) -> tuple[int, int] | None:
    try:
        year = int(year_value)
        quarter = int(quarter_value)
    except ValueError:
        return None
    if quarter < 1 or quarter > 4:
        return None
    return year, quarter


def parse_period_label(value: str) -> tuple[int, int] | None:
    parts = value.split()
    if len(parts) != 2 or not parts[1].startswith("Q"):
        return None
    return parse_period(parts[0], parts[1][1:])


def format_period(period: tuple[int, int]) -> str:
    return f"{period[0]} Q{period[1]}"


if __name__ == "__main__":
    main()
