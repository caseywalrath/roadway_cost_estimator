from __future__ import annotations

import argparse
import csv
import json
from datetime import date
from decimal import Decimal, InvalidOperation
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import urlopen


DATASET_API_URL = "https://data.transportation.gov/resource/r94d-n4f9.json"
DATASET_SOURCE_URL = "https://data.transportation.gov/Research-and-Statistics/NHCCI/r94d-n4f9"
OUTPUT_PATH = Path("public/data/inflation_index.csv")
INDEX_NAME = "FHWA National Highway Construction Cost Index"

FIELDNAMES = [
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


def main() -> None:
    parser = argparse.ArgumentParser(description="Refresh the static FHWA NHCCI inflation index CSV.")
    parser.add_argument("--output", default=OUTPUT_PATH, type=Path)
    args = parser.parse_args()

    source_rows = fetch_nhcci_rows()
    rows = build_output_rows(source_rows)
    write_rows(args.output, rows)
    print(f"Wrote {len(rows)} NHCCI row(s) to {args.output}.")


def fetch_nhcci_rows() -> list[dict[str, str]]:
    query = urlencode({
        "$select": "quarter,nhcci",
        "$order": "quarter",
        "$limit": "5000",
    })
    with urlopen(f"{DATASET_API_URL}?{query}", timeout=30) as response:
        payload = json.loads(response.read().decode("utf-8"))

    if not isinstance(payload, list):
        raise ValueError("Expected DOT NHCCI API to return a JSON list.")

    return payload


def build_output_rows(source_rows: list[dict[str, str]]) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []

    for source_row in source_rows:
        quarter_label = source_row.get("quarter", "").strip()
        index_value = normalize_decimal(source_row.get("nhcci", ""))
        if not quarter_label or index_value is None:
            continue

        year, quarter = parse_quarter_label(quarter_label)
        start_date, end_date = quarter_date_range(year, quarter)
        rows.append({
            "index_id": f"fhwa_nhcci_{year}_q{quarter}",
            "index_name": INDEX_NAME,
            "period_year": str(year),
            "period_quarter": str(quarter),
            "period_label": f"{year} Q{quarter}",
            "period_start_date": start_date.isoformat(),
            "period_end_date": end_date.isoformat(),
            "index_value": str(index_value),
            "source_url": DATASET_SOURCE_URL,
            "notes": "Unadjusted FHWA NHCCI quarterly value from DOT public data portal.",
        })

    return sorted(rows, key=lambda row: (int(row["period_year"]), int(row["period_quarter"])))


def write_rows(path: Path, rows: list[dict[str, str]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=FIELDNAMES, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def parse_quarter_label(value: str) -> tuple[int, int]:
    parts = value.split()
    if len(parts) != 2 or not parts[1].startswith("Q"):
        raise ValueError(f"Invalid quarter label: {value}")

    year = int(parts[0])
    quarter = int(parts[1][1:])
    if quarter < 1 or quarter > 4:
        raise ValueError(f"Invalid quarter in label: {value}")

    return year, quarter


def quarter_date_range(year: int, quarter: int) -> tuple[date, date]:
    start_month = ((quarter - 1) * 3) + 1
    end_month = start_month + 2
    end_day = 31 if end_month in {3, 12} else 30
    return date(year, start_month, 1), date(year, end_month, end_day)


def normalize_decimal(value: str) -> Decimal | None:
    try:
        parsed = Decimal(value)
    except InvalidOperation:
        return None

    if parsed <= 0:
        return None

    return parsed.normalize()


if __name__ == "__main__":
    main()
