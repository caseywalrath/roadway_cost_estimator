from __future__ import annotations

import argparse
import csv
import json
import statistics
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path


DATA_ROOT = Path("public/data")
OUTPUT_PATH = Path("public/data/states/co/planning_prices.json")
STATE_DIR = "co"
SOURCE_PREFIX = "cdot_cost_data_book"
PRICE_TYPE = "awarded_bid"
METHOD = "median of per-contract medians"


def main() -> None:
    parser = argparse.ArgumentParser(description="Build the Colorado planning price table.")
    parser.add_argument("--data-root", default=DATA_ROOT, type=Path)
    parser.add_argument("--output", default=OUTPUT_PATH, type=Path)
    parser.add_argument("--window-years", default=3, type=int)
    parser.add_argument("--escalation", default=1.0, type=float)
    parser.add_argument("--urban-min", default=8, type=int)
    parser.add_argument("--min-contracts", default=3, type=int)
    args = parser.parse_args()

    state_root = args.data_root / "states" / STATE_DIR
    observations = read_csv(state_root / "item_observations.csv")
    contracts = read_csv(state_root / "contracts.csv")
    versions = read_csv(state_root / "agency_item_versions.csv")
    index_rows = read_csv(args.data_root / "inflation_index.csv")

    table = build_table(
        observations,
        contracts,
        versions,
        index_rows,
        window_years=args.window_years,
        escalation=args.escalation,
        urban_min=args.urban_min,
        min_contracts=args.min_contracts,
    )
    write_json(args.output, table)
    print(f"Wrote {table['summary']['itemCount']} planning price item(s) to {args.output}.")


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8") as source:
        return list(csv.DictReader(source))


def write_json(path: Path, table: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_json(table), encoding="utf-8", newline="\n")


def render_json(table: dict) -> str:
    return json.dumps(table, indent=2, sort_keys=True) + "\n"


def parse_date(value: str) -> date:
    return date.fromisoformat(value.strip())


def parse_price(value: str) -> float | None:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None
    return parsed if parsed > 0 else None


def is_evidence(row: dict[str, str]) -> bool:
    return (
        row.get("price_type") == PRICE_TYPE
        and row.get("source_id", "").startswith(SOURCE_PREFIX)
        and parse_price(row.get("unit_price", "")) is not None
        and bool(row.get("date_basis", "").strip())
    )


def subtract_years(value: date, years: int) -> date:
    try:
        return value.replace(year=value.year - years)
    except ValueError:  # Feb 29 -> Feb 28
        return value.replace(year=value.year - years, day=28)


def compute_window(evidence: list[dict[str, str]], window_years: int) -> tuple[date, date]:
    end = max(parse_date(row["date_basis"]) for row in evidence)
    return subtract_years(end, window_years), end


def quarter_of(value: date) -> tuple[int, int]:
    return value.year, (value.month - 1) // 3 + 1


def load_index(index_rows: list[dict[str, str]]) -> dict[tuple[int, int], float]:
    index: dict[tuple[int, int], float] = {}
    for row in index_rows:
        value = parse_price(row.get("index_value", ""))
        if value is None:
            continue
        index[(int(row["period_year"]), int(row["period_quarter"]))] = value
    if not index:
        raise ValueError("Inflation index has no usable rows.")
    return index


def adjust(
    unit_price: float,
    basis_date: date,
    index: dict[tuple[int, int], float],
    escalation: float = 1.0,
) -> tuple[float, bool]:
    """Return (adjusted price, at_latest_index_flag)."""
    latest_key = max(index)
    key = quarter_of(basis_date)
    if key > latest_key:
        return unit_price * escalation, True
    if key not in index:
        raise ValueError(f"No inflation index value for {key[0]} Q{key[1]}.")
    factor = index[latest_key] / index[key]
    return unit_price * factor * escalation, False


def percentile_bounds(values: list[float]) -> tuple[float, float]:
    if len(values) < 2:
        return values[0], values[0]
    quartiles = statistics.quantiles(values, n=4, method="inclusive")
    return quartiles[0], quartiles[2]


def contract_median_stats(prices_by_contract: dict[str, list[float]]) -> dict[str, float | int]:
    medians = [statistics.median(prices) for _, prices in sorted(prices_by_contract.items())]
    p25, p75 = percentile_bounds(medians)
    return {
        "price": statistics.median(medians),
        "p25": p25,
        "p75": p75,
        "contracts": len(medians),
    }


def build_table(
    observations: list[dict[str, str]],
    contracts: list[dict[str, str]],
    versions: list[dict[str, str]],
    index_rows: list[dict[str, str]],
    window_years: int = 3,
    escalation: float = 1.0,
    urban_min: int = 8,
    min_contracts: int = 3,
) -> dict:
    index = load_index(index_rows)
    latest_year, latest_quarter = max(index)
    latest_label = f"{latest_year} Q{latest_quarter}"

    evidence = [row for row in observations if is_evidence(row)]
    if not evidence:
        raise ValueError("No evidence rows found.")
    start, end = compute_window(evidence, window_years)

    urban_contracts = {row["contract_id"] for row in contracts if row.get("terrain") == "U"}
    current_descriptions = {
        row["agency_item_id"]: row["official_description"]
        for row in sorted(versions, key=lambda r: (r["agency_item_id"], r.get("effective_from", "")))
        if row.get("is_current", "").strip().lower() == "true" and row.get("official_description", "").strip()
    }

    by_item: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in evidence:
        if start <= parse_date(row["date_basis"]) <= end:
            by_item[row["agency_item_id"]].append(row)

    items: dict[str, dict] = {}
    rows_used = 0
    rows_at_latest = 0

    for item_id in sorted(by_item):
        rows = by_item[item_id]
        unit_counts = Counter(row["unit_normalized"] for row in rows)
        dominant_unit = sorted(unit_counts.items(), key=lambda pair: (-pair[1], pair[0]))[0][0]
        kept = [row for row in rows if row["unit_normalized"] == dominant_unit]
        dropped = len(rows) - len(kept)

        # (contract_id, adjusted price, at_latest flag)
        adjusted: list[tuple[str, float, bool]] = []
        for row in kept:
            price, at_latest = adjust(float(row["unit_price"]), parse_date(row["date_basis"]), index, escalation)
            adjusted.append((row["contract_id"], price, at_latest))

        all_ids = {contract_id for contract_id, _, _ in adjusted}
        urban_ids = all_ids & urban_contracts
        if len(urban_ids) >= urban_min:
            pool, pool_ids = "urban", urban_ids
        else:
            pool, pool_ids = "statewide", all_ids
        if len(pool_ids) < min_contracts:
            continue

        pool_rows = [entry for entry in adjusted if entry[0] in pool_ids]
        grouped: dict[str, list[float]] = defaultdict(list)
        for contract_id, price, _ in pool_rows:
            grouped[contract_id].append(price)
        stats = contract_median_stats(grouped)

        description = current_descriptions.get(item_id) or sorted(r["description_raw"] for r in kept)[0]
        items[item_id] = {
            "code": kept[0]["agency_item_code"],
            "description": description,
            "unit": dominant_unit,
            "price": round(stats["price"], 2),
            "p25": round(stats["p25"], 2),
            "p75": round(stats["p75"], 2),
            "contracts": stats["contracts"],
            "urbanContracts": len(urban_ids),
            "pool": pool,
            "observations": len(pool_rows),
            "droppedOtherUnitRows": dropped,
        }
        rows_used += len(pool_rows)
        rows_at_latest += sum(1 for entry in pool_rows if entry[2])

    label = f"CDOT awarded bids, NHCCI-adjusted to {latest_label}"
    if escalation != 1:
        label += f" × {escalation:g} escalation to 2026"

    return {
        "schemaVersion": 1,
        "state": "CO",
        "basis": {
            "indexSource": "FHWA NHCCI",
            "indexPeriod": latest_label,
            "escalationFactor": escalation,
            "label": label,
        },
        "window": {"start": start.isoformat(), "end": end.isoformat()},
        "rules": {
            "priceType": PRICE_TYPE,
            "urbanMinContracts": urban_min,
            "minContracts": min_contracts,
            "method": METHOD,
        },
        "items": items,
        "summary": {
            "itemCount": len(items),
            "rowsUsed": rows_used,
            "rowsAtLatestIndex": rows_at_latest,
        },
    }


if __name__ == "__main__":
    main()
