from __future__ import annotations

import unittest
from datetime import date

from scripts.build_planning_prices import (
    adjust,
    build_table,
    compute_window,
    contract_median_stats,
    load_index,
    quarter_of,
    render_json,
)


INDEX_ROWS = [
    {"period_year": str(year), "period_quarter": str(quarter), "index_value": "2"}
    for year in (2022, 2023, 2024)
    for quarter in (1, 2, 3, 4)
] + [
    {"period_year": "2024", "period_quarter": "4", "index_value": "2"},
    {"period_year": "2025", "period_quarter": "1", "index_value": "2.5"},
    {"period_year": "2025", "period_quarter": "2", "index_value": "4"},
]
INDEX = load_index(INDEX_ROWS)


def obs(contract, price, item="i1", unit="EA", when="2025-05-01", source="cdot_cost_data_book_2026_q1",
        price_type="awarded_bid"):
    return {
        "contract_id": contract,
        "source_id": source,
        "agency_item_id": item,
        "agency_item_code": "100-00001",
        "description_raw": "Raw desc",
        "unit_normalized": unit,
        "unit_price": str(price),
        "price_type": price_type,
        "date_basis": when,
    }


def contract_rows(urban: int, rural: int = 0):
    rows = [{"contract_id": f"u{n}", "terrain": "U"} for n in range(urban)]
    rows += [{"contract_id": f"r{n}", "terrain": "P"} for n in range(rural)]
    return rows


def build(observations, contracts, **kwargs):
    versions = [{"agency_item_id": "i1", "official_description": "Official", "is_current": "true"}]
    return build_table(observations, contracts, versions, INDEX_ROWS, **kwargs)


class BuildPlanningPricesTests(unittest.TestCase):
    def test_window_filtering(self) -> None:
        start, end = compute_window([obs("a", 1, when="2025-05-01"), obs("a", 1, when="2022-01-01")], 3)
        self.assertEqual((start, end), (date(2022, 5, 1), date(2025, 5, 1)))

        rows = [
            obs("a", 10, when="2025-05-01"),
            obs("b", 10, when="2022-05-01"),  # exactly at start, included
            obs("c", 10, when="2022-04-30"),  # before start, excluded
            obs("d", 10, when="2024-01-01"),
        ]
        table = build(rows, contract_rows(0, 0), min_contracts=1)
        self.assertEqual(table["window"], {"start": "2022-05-01", "end": "2025-05-01"})
        self.assertEqual(table["items"]["i1"]["contracts"], 3)

    def test_evidence_filter(self) -> None:
        rows = [
            obs("a", 10),
            obs("b", 10, price_type="average_bid"),
            obs("c", 10, source="other_source"),
            obs("d", 0),
        ]
        table = build(rows, [], min_contracts=1)
        self.assertEqual(table["items"]["i1"]["contracts"], 1)

    def test_quarter_mapping_and_adjustment(self) -> None:
        self.assertEqual(quarter_of(date(2025, 3, 31)), (2025, 1))
        self.assertEqual(quarter_of(date(2025, 4, 1)), (2025, 2))
        price, at_latest = adjust(100.0, date(2025, 1, 15), INDEX)
        self.assertAlmostEqual(price, 160.0)
        self.assertFalse(at_latest)
        price, _ = adjust(100.0, date(2024, 11, 1), INDEX)
        self.assertAlmostEqual(price, 200.0)

    def test_later_than_latest_quarter_uses_factor_one(self) -> None:
        price, at_latest = adjust(100.0, date(2026, 2, 1), INDEX)
        self.assertEqual(price, 100.0)
        self.assertTrue(at_latest)
        table = build([obs("a", 100, when="2026-02-01")], [], min_contracts=1)
        self.assertEqual(table["summary"]["rowsAtLatestIndex"], 1)
        self.assertEqual(table["items"]["i1"]["price"], 100.0)

    def test_escalation(self) -> None:
        price, _ = adjust(100.0, date(2025, 1, 15), INDEX, escalation=1.1)
        self.assertAlmostEqual(price, 176.0)
        table = build([obs("a", 100, when="2025-04-10")], [], min_contracts=1, escalation=1.05)
        self.assertEqual(table["items"]["i1"]["price"], 105.0)
        self.assertEqual(table["basis"]["escalationFactor"], 1.05)
        self.assertTrue(table["basis"]["label"].endswith("× 1.05 escalation to 2026"))
        plain = build([obs("a", 100)], [], min_contracts=1)
        self.assertEqual(plain["basis"]["label"], "CDOT awarded bids, NHCCI-adjusted to 2025 Q2")

    def test_dominant_unit_filter(self) -> None:
        rows = [obs("a", 10, unit="EA"), obs("b", 10, unit="EA"), obs("c", 10, unit="EA"),
                obs("d", 999, unit="LF"), obs("e", 999, unit="LF")]
        item = build(rows, [])["items"]["i1"]
        self.assertEqual(item["unit"], "EA")
        self.assertEqual(item["droppedOtherUnitRows"], 2)
        self.assertEqual(item["contracts"], 3)

    def test_median_of_contract_medians(self) -> None:
        stats = contract_median_stats({"a": [1.0, 100.0, 3.0], "b": [10.0], "c": [20.0, 30.0]})
        # contract medians: 3, 10, 25
        self.assertEqual(stats["price"], 10.0)
        self.assertEqual(stats["contracts"], 3)

    def test_percentiles(self) -> None:
        stats = contract_median_stats({"a": [10.0], "b": [20.0], "c": [30.0], "d": [40.0], "e": [50.0]})
        self.assertEqual((stats["p25"], stats["price"], stats["p75"]), (20.0, 30.0, 40.0))
        single = contract_median_stats({"a": [7.0, 9.0]})
        self.assertEqual((single["p25"], single["price"], single["p75"]), (8.0, 8.0, 8.0))

    def test_urban_threshold_switch(self) -> None:
        def run(urban_count: int) -> dict:
            rows = [obs(f"u{n}", 100) for n in range(urban_count)]
            rows += [obs(f"r{n}", 500) for n in range(5)]
            return build(rows, contract_rows(urban_count, 5))["items"]["i1"]

        seven = run(7)
        self.assertEqual(seven["pool"], "statewide")
        self.assertEqual(seven["contracts"], 12)
        self.assertEqual(seven["urbanContracts"], 7)
        eight = run(8)
        self.assertEqual(eight["pool"], "urban")
        self.assertEqual(eight["contracts"], 8)
        self.assertEqual(eight["price"], 100.0)
        self.assertEqual(eight["observations"], 8)

    def test_min_contracts_exclusion(self) -> None:
        rows = [obs("a", 10), obs("a", 12), obs("b", 10)]
        table = build(rows, [])
        self.assertEqual(table["items"], {})
        self.assertEqual(table["summary"]["itemCount"], 0)
        table = build(rows, [], min_contracts=2)
        self.assertIn("i1", table["items"])
        self.assertEqual(table["summary"]["rowsUsed"], 3)

    def test_description_fallback(self) -> None:
        rows = [obs("a", 10), obs("b", 10), obs("c", 10)]
        table = build_table(rows, [], [], INDEX_ROWS)
        self.assertEqual(table["items"]["i1"]["description"], "Raw desc")
        self.assertEqual(build(rows, [])["items"]["i1"]["description"], "Official")

    def test_determinism(self) -> None:
        rows = [obs(c, p, item=i) for i in ("i1", "i2") for c, p in (("a", 5), ("b", 7), ("c", 9))]
        first = render_json(build(rows, contract_rows(2)))
        second = render_json(build(list(reversed(rows)), contract_rows(2)))
        self.assertEqual(first, second)
        self.assertTrue(first.endswith("}\n"))


if __name__ == "__main__":
    unittest.main()
