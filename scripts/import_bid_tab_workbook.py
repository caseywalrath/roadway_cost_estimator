from __future__ import annotations

import argparse
import csv
import re
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Iterable


DEFAULT_WORKBOOK = Path(r"C:\Users\Casey.Walrath\Downloads\2021 12 16 Bid Tabs Watson Ave Roundabout.xlsx")
DEFAULT_SOURCE_ID = "fhu_bid_tab_watson_ave_roundabout_2021_12_16"
DEFAULT_SOURCE_LABEL = "FHU Civil Group Bid Tabs - Watson Avenue Roundabout"
DEFAULT_SOURCE_TYPE = "public_bid_tab"
DEFAULT_SOURCE_YEAR = "2021"
DEFAULT_DATE_BASIS = "2021-12-16"
DEFAULT_PROJECT_ID = "fhu_bid_tab_watson_ave_roundabout_2021_12_16_320150"
DEFAULT_ROW_PREFIX = "fhu_watson_20211216"

DEFAULT_SOURCES = Path("public/data/sources.csv")
DEFAULT_PROJECTS = Path("public/data/projects.csv")
DEFAULT_OBSERVATIONS = Path("public/data/item_observations.csv")
DEFAULT_BIDDER_BIDS = Path("public/data/bidder_bids.csv")
DEFAULT_BIDDER_ITEMS = Path("public/data/bidder_item_observations.csv")
DEFAULT_AGENCY_ITEMS = Path("public/data/agency_items.csv")
DEFAULT_STAGING_ITEMS = Path("public/data/imports/fhu_bid_tab_watson_ave_roundabout_2021_12_16_item_unit_costs.csv")
DEFAULT_STAGING_BIDDER_BIDS = Path("public/data/imports/fhu_bid_tab_watson_ave_roundabout_2021_12_16_bidder_bids.csv")
DEFAULT_STAGING_BIDDER_ITEMS = Path("public/data/imports/fhu_bid_tab_watson_ave_roundabout_2021_12_16_bidder_item_observations.csv")

ITEM_CODE_PATTERN = re.compile(r"^\d{3}-\d{5}$")
BID_FORM_ITEM_CODE_PATTERN = re.compile(r"^(?:\d{3}-\d{5}|\d{3})$")
PROJECT_NAME_PATTERN = re.compile(r"PROJECT NAME:\s*(?P<value>.+)", re.IGNORECASE)
PROJECT_NUMBER_PATTERN = re.compile(r"PROJECT NO\.:\s*(?P<value>.+)", re.IGNORECASE)

SOURCE_FIELDS = ["source_id", "source_type", "agency", "state", "source_label", "data_year", "notes"]
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
STAGING_ITEM_FIELDS = [
    "source_file",
    "sheet_name",
    "workbook_row",
    "project_number",
    "item_code",
    "item_description",
    "unit_raw",
    "unit_normalized",
    "quantity",
    "engineer_estimate_unit_price",
    "average_bid_unit_price",
    "date_basis",
]


@dataclass(frozen=True)
class PriceColumnGroup:
    name: str
    unit_col: int
    total_col: int
    role: str


@dataclass(frozen=True)
class ParsedBidTab:
    project_name: str
    project_number: str
    item_rows: list[dict[str, str]]
    bidder_bids: list[dict[str, str]]
    bidder_items: list[dict[str, str]]
    observations: list[dict[str, str]]
    warnings: list[str]


def normalize_description(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", value.lower().replace("&", " and "))).strip()


def slugify(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def decimal_value(value: object, default: str | None = None) -> Decimal:
    if value is None and default is not None:
        value = default
    if isinstance(value, Decimal):
        return value
    if isinstance(value, (int, float)):
        return Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    if isinstance(value, str):
        cleaned = value.replace("$", "").replace(",", "").strip()
        if not cleaned and default is not None:
            cleaned = default
        try:
            return Decimal(cleaned).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        except InvalidOperation as error:
            raise ValueError(f"Expected numeric value, received {value!r}") from error
    raise ValueError(f"Expected numeric value, received {value!r}")


def decimal_text(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def normalize_unit(value: object) -> str:
    raw = str(value or "").strip().upper()
    compact = re.sub(r"[^A-Z0-9]+", " ", raw).strip()
    mapping = {
        "EA": "EACH",
        "EACH": "EACH",
        "LS": "L S",
        "L S": "L S",
        "LUMP SUM": "L S",
        "LB": "LB",
        "POUND": "LB",
        "POUNDS": "LB",
        "SF": "SF",
        "SQ FT": "SF",
        "SQUARE FOOT": "SF",
        "SY": "SY",
        "SQ YD": "SY",
        "SQUARE YARD": "SY",
        "CY": "CY",
        "CU YD": "CY",
        "CUBIC YARD": "CY",
        "LF": "LF",
        "FOOT": "LF",
        "FEET": "LF",
        "AC": "ACRE",
        "ACRE": "ACRE",
        "HR": "HOUR",
        "HOUR": "HOUR",
        "HOURS": "HOUR",
        "FA": "F A",
        "F A": "F A",
        "F/A": "F A",
        "F A": "F A",
    }
    return mapping.get(compact, raw)


def read_csv(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as source:
        return [dict(row) for row in csv.DictReader(source)]


def write_csv(path: Path, rows: list[dict[str, str]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as output:
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def normalize_existing_rows(rows: Iterable[dict[str, str]], fieldnames: list[str]) -> list[dict[str, str]]:
    return [{field: row.get(field, "") for field in fieldnames} for row in rows]


def agency_item_codes(path: Path) -> set[str]:
    return {row["item_code"].strip().upper() for row in read_csv(path) if row.get("item_code")}


def agency_item_rows(path: Path) -> list[dict[str, str]]:
    return read_csv(path)


def parse_workbook(
    workbook_path: Path,
    source_id: str,
    project_id: str,
    row_prefix: str,
    date_basis: str,
) -> ParsedBidTab:
    try:
        from openpyxl import load_workbook
    except ImportError as error:
        raise SystemExit("Missing dependency: openpyxl. Run with the bundled Codex Python runtime.") from error

    workbook = load_workbook(workbook_path, data_only=True, read_only=False)
    sheet = workbook[workbook.sheetnames[0]]
    formula_workbook = load_workbook(workbook_path, data_only=False, read_only=False)
    formula_sheet = formula_workbook[sheet.title]

    bid_form_header = find_bid_form_header_row(sheet)
    if bid_form_header:
        return parse_bid_form_workbook(
            workbook_path,
            workbook,
            formula_workbook,
            source_id,
            project_id,
            row_prefix,
            date_basis,
            bid_form_header,
        )

    return parse_saq_workbook(
        workbook_path,
        sheet,
        formula_sheet,
        source_id,
        project_id,
        row_prefix,
        date_basis,
    )


def parse_saq_workbook(
    workbook_path: Path,
    sheet,
    formula_sheet,
    source_id: str,
    project_id: str,
    row_prefix: str,
    date_basis: str,
) -> ParsedBidTab:
    project_name = ""
    project_number = ""
    for row in sheet.iter_rows(min_row=1, max_row=min(sheet.max_row, 20)):
        for cell in row:
            if not isinstance(cell.value, str):
                continue
            name_match = PROJECT_NAME_PATTERN.search(cell.value)
            number_match = PROJECT_NUMBER_PATTERN.search(cell.value)
            if name_match:
                project_name = name_match.group("value").strip().title()
            if number_match:
                project_number = number_match.group("value").strip()

    header_row = find_header_row(sheet)
    group_row = header_row - 1
    groups = detect_price_groups(sheet, group_row, header_row)
    engineer_group = next((group for group in groups if group.role == "engineer"), None)
    average_group = next((group for group in groups if group.role == "average"), None)
    bidder_groups = [group for group in groups if group.role == "bidder"]

    if not project_name or not project_number:
        raise ValueError("Workbook header must include PROJECT NAME and PROJECT NO.")
    if not engineer_group or not average_group or not bidder_groups:
        raise ValueError("Workbook must include engineer estimate, at least one bidder, and average bid columns.")

    item_rows: list[dict[str, str]] = []
    observations: list[dict[str, str]] = []
    bidder_items: list[dict[str, str]] = []
    bid_totals: dict[str, Decimal] = {group.name: Decimal("0.00") for group in bidder_groups}
    warnings: list[str] = []

    for row_index in range(header_row + 2, sheet.max_row + 1):
        item_code = sheet.cell(row_index, 3).value
        if not isinstance(item_code, str) or not ITEM_CODE_PATTERN.match(item_code.strip()):
            continue

        item_code = item_code.strip().upper()
        description = str(sheet.cell(row_index, 4).value or "").strip()
        quantity = decimal_value(sheet.cell(row_index, 5).value)
        unit_raw = str(sheet.cell(row_index, 6).value or "").strip()
        unit_normalized = normalize_unit(unit_raw)
        engineer_unit_price = decimal_value(sheet.cell(row_index, engineer_group.unit_col).value)
        average_unit_price = decimal_value(sheet.cell(row_index, average_group.unit_col).value)

        row_id = f"{row_prefix}_row_{row_index:04d}"
        item_rows.append(
            {
                "source_file": workbook_path.name,
                "sheet_name": sheet.title,
                "workbook_row": str(row_index),
                "project_number": project_number,
                "item_code": item_code,
                "item_description": description,
                "unit_raw": unit_raw,
                "unit_normalized": unit_normalized,
                "quantity": decimal_text(quantity),
                "engineer_estimate_unit_price": decimal_text(engineer_unit_price),
                "average_bid_unit_price": decimal_text(average_unit_price),
                "date_basis": date_basis,
            }
        )

        observations.extend(
            [
                promoted_observation(
                    f"{row_id}_engineer_estimate",
                    project_id,
                    source_id,
                    item_code,
                    description,
                    unit_raw,
                    unit_normalized,
                    quantity,
                    engineer_unit_price,
                    "public_bid_tab_engineer_estimate",
                    date_basis,
                ),
                promoted_observation(
                    f"{row_id}_average",
                    project_id,
                    source_id,
                    item_code,
                    description,
                    unit_raw,
                    unit_normalized,
                    quantity,
                    average_unit_price,
                    "public_bid_tab_average",
                    date_basis,
                ),
            ]
        )

        bidder_unit_prices: list[Decimal] = []
        for bidder_group in bidder_groups:
            unit_price = decimal_value(sheet.cell(row_index, bidder_group.unit_col).value)
            extended_price = (quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            bid_id = f"{row_prefix}_{slugify(bidder_group.name)}"
            bidder_unit_prices.append(unit_price)
            bid_totals[bidder_group.name] += extended_price
            bidder_items.append(
                {
                    "bidder_item_observation_id": f"{row_id}_{slugify(bidder_group.name)}",
                    "bid_id": bid_id,
                    "project_id": project_id,
                    "source_id": source_id,
                    "agency_item_code": item_code,
                    "description_raw": description,
                    "unit_raw": unit_raw,
                    "unit_normalized": unit_normalized,
                    "quantity": decimal_text(quantity),
                    "unit_price": decimal_text(unit_price),
                    "extended_price": decimal_text(extended_price),
                }
            )

            validate_line_total(
                sheet.cell(row_index, bidder_group.total_col).value,
                formula_sheet.cell(row_index, bidder_group.total_col).value,
                extended_price,
                warnings,
                row_index,
                bidder_group.name,
            )

        calculated_average = (sum(bidder_unit_prices) / Decimal(len(bidder_unit_prices))).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        if abs(calculated_average - average_unit_price) > Decimal("0.01"):
            warnings.append(
                f"Row {row_index}: average bid {average_unit_price} differs from bidder average {calculated_average}"
            )

    ranked_bidders = sorted(bid_totals.items(), key=lambda item: item[1])
    bidder_bids = [
        {
            "bid_id": f"{row_prefix}_{slugify(name)}",
            "project_id": project_id,
            "source_id": source_id,
            "bidder_name": name,
            "bid_total": decimal_text(total),
            "bid_rank": str(index),
            "apparent_low": "true" if index == 1 else "false",
        }
        for index, (name, total) in enumerate(ranked_bidders, start=1)
    ]

    return ParsedBidTab(project_name, project_number, item_rows, bidder_bids, bidder_items, observations, warnings)


def parse_bid_form_workbook(
    workbook_path: Path,
    workbook,
    formula_workbook,
    source_id: str,
    project_id: str,
    row_prefix: str,
    date_basis: str,
    header_row: int,
) -> ParsedBidTab:
    sheet = workbook["Bid Form"] if "Bid Form" in workbook.sheetnames else workbook[workbook.sheetnames[0]]
    formula_sheet = formula_workbook[sheet.title]
    column_by_header = bid_form_column_map(sheet, header_row)
    groups = detect_bid_form_price_groups(sheet, header_row)
    engineer_group = next((group for group in groups if group.role == "engineer"), None)
    bidder_groups = [group for group in groups if group.role == "bidder"]

    if not engineer_group:
        raise ValueError("Bid-form workbook must include estimated unit price and total cost columns.")
    if not bidder_groups:
        raise ValueError("Bid-form workbook must include at least one bidder unit price / total cost column pair.")

    project_number, project_name, summary_engineer_total = bid_form_summary_metadata(workbook)
    if not project_number or not project_name:
        raise ValueError("Bid-form workbook must include project metadata on Sheet1.")

    item_rows: list[dict[str, str]] = []
    observations: list[dict[str, str]] = []
    bidder_items: list[dict[str, str]] = []
    bid_totals: dict[str, Decimal] = {group.name: Decimal("0.00") for group in bidder_groups}
    engineer_itemized_total = Decimal("0.00")
    warnings: list[str] = []

    for row_index in range(header_row + 1, sheet.max_row + 1):
        item_code_value = sheet.cell(row_index, column_by_header["ITEM NO."]).value
        item_code = normalize_bid_form_item_code(item_code_value)
        if not item_code:
            continue

        description = str(sheet.cell(row_index, column_by_header["ITEM DESCRIPTION"]).value or "").strip()
        quantity = decimal_value(sheet.cell(row_index, column_by_header["QUANTITY"]).value)
        unit_raw = str(sheet.cell(row_index, column_by_header["UNIT"]).value or "").strip()
        unit_normalized = normalize_unit(unit_raw)
        engineer_unit_price = decimal_value(sheet.cell(row_index, engineer_group.unit_col).value)
        engineer_extended_price = (quantity * engineer_unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        engineer_itemized_total += engineer_extended_price

        bidder_unit_prices: list[Decimal] = []
        row_id = f"{row_prefix}_row_{row_index:04d}"

        for bidder_group in bidder_groups:
            unit_price = decimal_value(sheet.cell(row_index, bidder_group.unit_col).value)
            extended_price = (quantity * unit_price).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            bid_id = f"{row_prefix}_{slugify(bidder_group.name)}"
            bidder_unit_prices.append(unit_price)
            bid_totals[bidder_group.name] += extended_price
            bidder_items.append(
                {
                    "bidder_item_observation_id": f"{row_id}_{slugify(bidder_group.name)}",
                    "bid_id": bid_id,
                    "project_id": project_id,
                    "source_id": source_id,
                    "agency_item_code": item_code,
                    "description_raw": description,
                    "unit_raw": unit_raw,
                    "unit_normalized": unit_normalized,
                    "quantity": decimal_text(quantity),
                    "unit_price": decimal_text(unit_price),
                    "extended_price": decimal_text(extended_price),
                }
            )

            validate_line_total(
                sheet.cell(row_index, bidder_group.total_col).value,
                formula_sheet.cell(row_index, bidder_group.total_col).value,
                extended_price,
                warnings,
                row_index,
                bidder_group.name,
            )

        validate_line_total(
            sheet.cell(row_index, engineer_group.total_col).value,
            formula_sheet.cell(row_index, engineer_group.total_col).value,
            engineer_extended_price,
            warnings,
            row_index,
            "Engineer estimate",
        )

        average_unit_price = (sum(bidder_unit_prices) / Decimal(len(bidder_unit_prices))).quantize(
            Decimal("0.01"),
            rounding=ROUND_HALF_UP,
        )
        item_rows.append(
            {
                "source_file": workbook_path.name,
                "sheet_name": sheet.title,
                "workbook_row": str(row_index),
                "project_number": project_number,
                "item_code": item_code,
                "item_description": description,
                "unit_raw": unit_raw,
                "unit_normalized": unit_normalized,
                "quantity": decimal_text(quantity),
                "engineer_estimate_unit_price": decimal_text(engineer_unit_price),
                "average_bid_unit_price": decimal_text(average_unit_price),
                "date_basis": date_basis,
            }
        )

        observations.extend(
            [
                promoted_observation(
                    f"{row_id}_engineer_estimate",
                    project_id,
                    source_id,
                    item_code,
                    description,
                    unit_raw,
                    unit_normalized,
                    quantity,
                    engineer_unit_price,
                    "public_bid_tab_engineer_estimate",
                    date_basis,
                ),
                promoted_observation(
                    f"{row_id}_average",
                    project_id,
                    source_id,
                    item_code,
                    description,
                    unit_raw,
                    unit_normalized,
                    quantity,
                    average_unit_price,
                    "public_bid_tab_average",
                    date_basis,
                ),
            ]
        )

    if summary_engineer_total is not None and abs(summary_engineer_total - engineer_itemized_total) > Decimal("0.01"):
        warnings.append(
            "Sheet1 engineer estimate "
            f"{summary_engineer_total} differs from itemized engineer estimate total {engineer_itemized_total}"
        )

    ranked_bidders = sorted(bid_totals.items(), key=lambda item: item[1])
    bidder_bids = [
        {
            "bid_id": f"{row_prefix}_{slugify(name)}",
            "project_id": project_id,
            "source_id": source_id,
            "bidder_name": name,
            "bid_total": decimal_text(total),
            "bid_rank": str(index),
            "apparent_low": "true" if index == 1 else "false",
        }
        for index, (name, total) in enumerate(ranked_bidders, start=1)
    ]

    return ParsedBidTab(project_name, project_number, item_rows, bidder_bids, bidder_items, observations, warnings)


def find_header_row(sheet) -> int:
    for row_index in range(1, sheet.max_row + 1):
        if str(sheet.cell(row_index, 3).value or "").strip().upper() == "ITEM CODE":
            return row_index
    raise ValueError("Could not find ITEM CODE header in column C.")


def find_bid_form_header_row(sheet) -> int | None:
    required_headers = {"ITEM NO.", "ITEM DESCRIPTION", "UNIT", "QUANTITY"}
    for row_index in range(1, min(sheet.max_row, 25) + 1):
        headers = {str(sheet.cell(row_index, column).value or "").strip().upper() for column in range(1, sheet.max_column + 1)}
        if required_headers.issubset(headers):
            return row_index
    return None


def bid_form_column_map(sheet, header_row: int) -> dict[str, int]:
    columns = {
        str(sheet.cell(header_row, column).value or "").strip().upper(): column
        for column in range(1, sheet.max_column + 1)
    }
    required_headers = ["ITEM NO.", "ITEM DESCRIPTION", "UNIT", "QUANTITY"]
    missing = [header for header in required_headers if header not in columns]
    if missing:
        raise ValueError(f"Bid-form workbook missing required header(s): {', '.join(missing)}")
    return columns


def detect_price_groups(sheet, group_row: int, header_row: int) -> list[PriceColumnGroup]:
    groups: list[PriceColumnGroup] = []
    for column in range(1, sheet.max_column):
        title = sheet.cell(group_row, column).value
        unit_header = str(sheet.cell(header_row, column).value or "").strip().upper()
        total_header = str(sheet.cell(header_row, column + 1).value or "").strip().upper()
        if not title or unit_header != "UNIT COST" or total_header != "TOTAL COST":
            continue

        name = str(title).strip()
        upper_name = name.upper()
        if "ENGINEER" in upper_name:
            role = "engineer"
        elif "AVERAGE" in upper_name:
            role = "average"
        else:
            role = "bidder"
        groups.append(PriceColumnGroup(name, column, column + 1, role))
    return groups


def detect_bid_form_price_groups(sheet, header_row: int) -> list[PriceColumnGroup]:
    groups: list[PriceColumnGroup] = []
    for column in range(1, sheet.max_column):
        unit_header = str(sheet.cell(header_row, column).value or "").strip()
        total_header = str(sheet.cell(header_row, column + 1).value or "").strip().upper()
        if not unit_header.upper().endswith("UNIT PRICE") or total_header != "TOTAL COST BASE BID":
            continue

        name = re.sub(r"\s*UNIT PRICE\s*$", "", unit_header, flags=re.IGNORECASE).strip()
        role = "engineer" if name.upper() == "ESTIMATED" else "bidder"
        groups.append(PriceColumnGroup("Engineer Estimate" if role == "engineer" else name, column, column + 1, role))
    return groups


def normalize_bid_form_item_code(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, (int, float)) and Decimal(str(value)) == Decimal(str(value)).to_integral_value():
        text = str(int(value))
    else:
        text = str(value).strip()
    if BID_FORM_ITEM_CODE_PATTERN.match(text):
        return text.upper()
    return ""


def bid_form_summary_metadata(workbook) -> tuple[str, str, Decimal | None]:
    project_number = ""
    project_name = ""
    engineer_total: Decimal | None = None

    if "Sheet1" not in workbook.sheetnames:
        return project_number, project_name, engineer_total

    sheet = workbook["Sheet1"]
    project_number = str(sheet["A1"].value or "").strip()
    project_name = str(sheet["A2"].value or "").strip()
    for row in sheet.iter_rows(min_row=1, max_row=sheet.max_row):
        for cell in row:
            if str(cell.value or "").strip().upper() == "ENGR EST":
                for candidate_column in range(cell.column + 1, sheet.max_column + 1):
                    value = sheet.cell(cell.row, candidate_column).value
                    if value is not None:
                        engineer_total = decimal_value(value)
                        break
                break

    return project_number, project_name, engineer_total


def validate_line_total(
    cached_total: object,
    formula_or_value: object,
    calculated_total: Decimal,
    warnings: list[str],
    row_index: int,
    party_name: str,
) -> None:
    if isinstance(formula_or_value, str) and formula_or_value.startswith("="):
        return
    if cached_total is None:
        return
    parsed_total = decimal_value(cached_total)
    if abs(parsed_total - calculated_total) > Decimal("0.01"):
        warnings.append(f"Row {row_index}: {party_name} total {parsed_total} differs from calculated {calculated_total}")


def promoted_observation(
    observation_id: str,
    project_id: str,
    source_id: str,
    item_code: str,
    description: str,
    unit_raw: str,
    unit_normalized: str,
    quantity: Decimal,
    unit_price: Decimal,
    price_type: str,
    date_basis: str,
) -> dict[str, str]:
    return {
        "observation_id": observation_id,
        "project_id": project_id,
        "source_id": source_id,
        "agency_item_code": item_code,
        "description_raw": description,
        "description_normalized": normalize_description(description),
        "unit_raw": unit_raw,
        "unit_normalized": unit_normalized,
        "quantity": decimal_text(quantity),
        "unit_price": decimal_text(unit_price),
        "extended_price": decimal_text(quantity * unit_price),
        "discipline": "Roadway",
        "price_type": price_type,
        "date_basis": date_basis,
    }


def source_row(args: argparse.Namespace) -> dict[str, str]:
    return {
        "source_id": args.source_id,
        "source_type": args.source_type,
        "agency": args.agency_owner,
        "state": args.state,
        "source_label": args.source_label,
        "data_year": args.source_year,
        "notes": f"Public bid tab workbook promoted from {Path(args.workbook).name}. Apparent low is not confirmed award.",
    }


def project_row(args: argparse.Namespace, parsed: ParsedBidTab) -> dict[str, str]:
    return {
        "project_id": args.project_id,
        "project_name": parsed.project_name,
        "agency_owner": args.agency_owner,
        "state": args.state,
        "county_region": args.county_region,
        "work_type": args.work_type,
        "estimate_let_date": args.date_basis,
        "source_id": args.source_id,
        "project_number": parsed.project_number,
        "project_location_raw": parsed.project_name,
        "contractor": "",
        "district": args.district,
        "terrain": "",
        "bid_count": str(len(parsed.bidder_bids)),
        "awarded_bid_total": "",
        "award_index": "",
    }


def validate_import(
    parsed: ParsedBidTab,
    known_item_codes: set[str],
    allow_missing_item_codes: bool = False,
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings = list(parsed.warnings)

    if not parsed.item_rows:
        errors.append("No item rows were parsed.")
    if not parsed.bidder_bids:
        errors.append("No bidder columns were parsed.")

    missing_codes = sorted({row["item_code"] for row in parsed.item_rows if row["item_code"] not in known_item_codes})
    if missing_codes:
        message = f"Missing agency item codes: {', '.join(missing_codes)}"
        if allow_missing_item_codes:
            warnings.append(message)
        else:
            errors.append(message)

    unknown_units = sorted(
        {
            row["unit_raw"]
            for row in parsed.item_rows
            if row["unit_raw"].strip().upper() == row["unit_normalized"] and row["unit_normalized"] not in known_normal_units()
        }
    )
    if unknown_units:
        warnings.append(f"Unknown normalized units preserved as raw values: {', '.join(unknown_units)}")

    return errors, warnings


def resolve_short_item_codes(parsed: ParsedBidTab, agency_items: list[dict[str, str]]) -> list[str]:
    warnings: list[str] = []
    candidate_map: dict[tuple[str, str], list[dict[str, str]]] = {}
    for row in agency_items:
        unit = normalize_unit(row.get("official_unit", ""))
        for description_field in ["official_description", "official_abbreviated_description"]:
            description = row.get(description_field, "")
            if not description:
                continue
            candidate_map.setdefault((normalize_description(description), unit), []).append(row)

    replacements: dict[tuple[str, str, str], str] = {}
    for row in parsed.item_rows:
        item_code = row["item_code"]
        if "-" in item_code:
            continue

        key = (normalize_description(row["item_description"]), row["unit_normalized"])
        matches = {
            candidate["item_code"].strip().upper()
            for candidate in candidate_map.get(key, [])
            if candidate.get("item_code", "").strip().upper().startswith(f"{item_code}-")
        }
        replacement_key = (item_code, row["item_description"], row["unit_normalized"])
        if len(matches) == 1:
            replacement = next(iter(matches))
            replacements[replacement_key] = replacement
            warnings.append(
                f"Resolved short agency item code {item_code} for {row['item_description']} ({row['unit_normalized']}) to {replacement}."
            )
        else:
            warnings.append(
                f"Preserved nonstandard item code {item_code} for {row['item_description']} ({row['unit_normalized']}); no exact compatible CDOT item match."
            )

    if not replacements:
        return warnings

    for row in parsed.item_rows:
        replacement = replacements.get((row["item_code"], row["item_description"], row["unit_normalized"]))
        if replacement:
            row["item_code"] = replacement
    for row in parsed.observations:
        replacement = replacements.get((row["agency_item_code"], row["description_raw"], row["unit_normalized"]))
        if replacement:
            row["agency_item_code"] = replacement
    for row in parsed.bidder_items:
        replacement = replacements.get((row["agency_item_code"], row["description_raw"], row["unit_normalized"]))
        if replacement:
            row["agency_item_code"] = replacement

    return warnings


def known_normal_units() -> set[str]:
    return {"EACH", "L S", "LB", "SF", "SY", "CY", "LF", "ACRE", "HOUR", "DAY", "GAL", "CF", "TON", "F A"}


def promote(args: argparse.Namespace) -> None:
    parsed = parse_workbook(Path(args.workbook), args.source_id, args.project_id, args.row_prefix, args.date_basis)
    item_rows = agency_item_rows(args.agency_items)
    mapping_warnings = resolve_short_item_codes(parsed, item_rows)
    errors, warnings = validate_import(
        parsed,
        {row["item_code"].strip().upper() for row in item_rows if row.get("item_code")},
        args.allow_missing_item_codes,
    )
    warnings = mapping_warnings + warnings

    for warning in warnings:
        print(f"WARNING: {warning}")
    if errors:
        for error in errors:
            print(f"ERROR: {error}")
        raise SystemExit(1)

    if args.dry_run:
        print(f"Parsed {len(parsed.item_rows)} item rows.")
        print(f"Parsed {len(parsed.bidder_bids)} bidder bids.")
        print(f"Parsed {len(parsed.bidder_items)} bidder item rows.")
        return

    write_csv(args.staging_items, parsed.item_rows, STAGING_ITEM_FIELDS)
    write_csv(args.staging_bidder_bids, parsed.bidder_bids, BIDDER_BID_FIELDS)
    write_csv(args.staging_bidder_items, parsed.bidder_items, BIDDER_ITEM_FIELDS)

    existing_sources = [row for row in normalize_existing_rows(read_csv(args.sources), SOURCE_FIELDS) if row["source_id"] != args.source_id]
    existing_projects = [row for row in normalize_existing_rows(read_csv(args.projects), PROJECT_FIELDS) if row["source_id"] != args.source_id]
    existing_observations = [row for row in normalize_existing_rows(read_csv(args.observations), OBSERVATION_FIELDS) if row["source_id"] != args.source_id]
    existing_bids = [row for row in normalize_existing_rows(read_csv(args.bidder_bids), BIDDER_BID_FIELDS) if row["source_id"] != args.source_id]
    existing_bidder_items = [row for row in normalize_existing_rows(read_csv(args.bidder_items), BIDDER_ITEM_FIELDS) if row["source_id"] != args.source_id]

    write_csv(args.sources, existing_sources + [source_row(args)], SOURCE_FIELDS)
    write_csv(args.projects, existing_projects + [project_row(args, parsed)], PROJECT_FIELDS)
    write_csv(args.observations, existing_observations + parsed.observations, OBSERVATION_FIELDS)
    write_csv(args.bidder_bids, existing_bids + parsed.bidder_bids, BIDDER_BID_FIELDS)
    write_csv(args.bidder_items, existing_bidder_items + parsed.bidder_items, BIDDER_ITEM_FIELDS)

    print(f"Wrote {len(parsed.item_rows)} staging item rows.")
    print(f"Wrote {len(parsed.observations)} promoted item observations.")
    print(f"Wrote {len(parsed.bidder_bids)} bidder bids.")
    print(f"Wrote {len(parsed.bidder_items)} bidder item observations.")


def main() -> None:
    parser = argparse.ArgumentParser(description="Import SAQ-style public bid tab workbooks into app CSV data.")
    parser.add_argument("--workbook", default=DEFAULT_WORKBOOK, type=Path)
    parser.add_argument("--source-id", default=DEFAULT_SOURCE_ID)
    parser.add_argument("--source-label", default=DEFAULT_SOURCE_LABEL)
    parser.add_argument("--source-type", default=DEFAULT_SOURCE_TYPE)
    parser.add_argument("--source-year", default=DEFAULT_SOURCE_YEAR)
    parser.add_argument("--project-id", default=DEFAULT_PROJECT_ID)
    parser.add_argument("--row-prefix", default=DEFAULT_ROW_PREFIX)
    parser.add_argument("--date-basis", default=DEFAULT_DATE_BASIS)
    parser.add_argument("--agency-owner", default="Town of Breckenridge")
    parser.add_argument("--state", default="CO")
    parser.add_argument("--county-region", default="Summit County")
    parser.add_argument("--work-type", default="Roadway")
    parser.add_argument("--district", default="")
    parser.add_argument("--sources", default=DEFAULT_SOURCES, type=Path)
    parser.add_argument("--projects", default=DEFAULT_PROJECTS, type=Path)
    parser.add_argument("--observations", default=DEFAULT_OBSERVATIONS, type=Path)
    parser.add_argument("--bidder-bids", default=DEFAULT_BIDDER_BIDS, type=Path)
    parser.add_argument("--bidder-items", default=DEFAULT_BIDDER_ITEMS, type=Path)
    parser.add_argument("--agency-items", default=DEFAULT_AGENCY_ITEMS, type=Path)
    parser.add_argument("--staging-items", default=DEFAULT_STAGING_ITEMS, type=Path)
    parser.add_argument("--staging-bidder-bids", default=DEFAULT_STAGING_BIDDER_BIDS, type=Path)
    parser.add_argument("--staging-bidder-items", default=DEFAULT_STAGING_BIDDER_ITEMS, type=Path)
    parser.add_argument("--allow-missing-item-codes", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    promote(args)


if __name__ == "__main__":
    main()
