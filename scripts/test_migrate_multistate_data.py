from __future__ import annotations

import csv
import unittest
from collections import Counter
from pathlib import Path

from scripts.migrate_multistate_data import COST_BOOK_OBSERVATION_ID, build_cost_book_contract_items


CO_DATA = Path("public/data/states/co")
IMPORTS_DATA = Path("public/data/imports")


def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open(newline="", encoding="utf-8-sig") as source:
        return [dict(row) for row in csv.DictReader(source)]


class CostBookContractItemMigrationTests(unittest.TestCase):
    def test_reconstruction_preserves_duplicate_source_rows_and_page_locators(self) -> None:
        imports_dir = Path("tmp/test_cost_book_contract_items")
        imports_dir.mkdir(parents=True, exist_ok=True)
        staging_path = imports_dir / "cost_source_item_unit_costs.csv"
        with staging_path.open("w", newline="", encoding="utf-8") as target:
            writer = csv.DictWriter(
                target,
                fieldnames=[
                    "source_file", "source_period", "page_number", "item_code", "item_description",
                    "unit_raw", "unit_normalized", "quantity",
                ],
            )
            writer.writeheader()
            for page in [8, 9]:
                writer.writerow({
                    "source_file": "cost-book.pdf",
                    "source_period": "2026 Q1",
                    "page_number": str(page),
                    "item_code": "201-00000",
                    "item_description": "Clear and Grub",
                    "unit_raw": "Lump Sum",
                    "unit_normalized": "L S",
                    "quantity": "1.00",
                })

        observations = []
        for row_number in [1, 2]:
            for price_type in ["cdot_awarded_bid", "cdot_average_bid", "cdot_engineer_estimate"]:
                observations.append({
                    "observation_id": f"cost_2026q1_{row_number:04d}_{price_type.removeprefix('cdot_')}",
                    "project_id": "project_1",
                    "source_id": "cost_source",
                    "agency_item_code": "201-00000",
                    "description_raw": "Clear and Grub",
                    "unit_raw": "Lump Sum",
                    "unit_normalized": "L S",
                    "quantity": "1.00",
                    "price_type": price_type,
                    "date_basis": "2026-01-01",
                })

        items = build_cost_book_contract_items(
            imports_dir,
            [{"source_id": "cost_source", "source_type": "public_cost_book", "source_label": "Cost Book"}],
            observations,
            {"201-00000": "co_cdot_201-00000"},
        )

        self.assertEqual(2, len(items))
        self.assertEqual(["cost_2026q1_0001_item", "cost_2026q1_0002_item"], [row["contract_item_id"] for row in items])
        self.assertEqual(["8", "9"], [row["source_page"] for row in items])
        self.assertEqual("cost-book.pdf:page 8; staging row 1", items[0]["source_locator"])

    def test_committed_colorado_package_contains_complete_cost_book_review_layer(self) -> None:
        sources = {row["source_id"]: row for row in read_csv(CO_DATA / "sources.csv")}
        cost_source_ids = {source_id for source_id, row in sources.items() if row["source_type"] == "cost_book"}
        contracts = [row for row in read_csv(CO_DATA / "contracts.csv") if row["source_id"] in cost_source_ids]
        items = [row for row in read_csv(CO_DATA / "contract_items.csv") if row["source_id"] in cost_source_ids]
        observations = [row for row in read_csv(CO_DATA / "item_observations.csv") if row["source_id"] in cost_source_ids]
        bids = [row for row in read_csv(CO_DATA / "bids.csv") if row["source_id"] in cost_source_ids]
        bid_prices = [row for row in read_csv(CO_DATA / "bid_item_prices.csv") if row["source_id"] in cost_source_ids]

        self.assertEqual(458, len(contracts))
        self.assertEqual(37_214, len(items))
        self.assertEqual(37_214 * 3, len(observations))
        self.assertEqual(
            {"awarded_bid": 37_214, "average_bid": 37_214, "engineer_estimate": 37_214},
            Counter(row["price_type"] for row in observations),
        )
        self.assertEqual([], bids)
        self.assertEqual([], bid_prices)
        self.assertEqual(len(items), len({row["contract_item_id"] for row in items}))
        self.assertTrue(all(row["source_page"] and row["source_locator"] for row in items))
        observation_groups = Counter(
            COST_BOOK_OBSERVATION_ID.fullmatch(row["observation_id"]).group("base")
            for row in observations
        )
        self.assertEqual(37_214, len(observation_groups))
        self.assertEqual({3}, set(observation_groups.values()))

        items_by_source_row = {
            (row["source_id"], int(row["line_number"])): row
            for row in items
        }
        for source_id in cost_source_ids:
            staging_rows = read_csv(IMPORTS_DATA / f"{source_id}_item_unit_costs.csv")
            source_items = [row for row in items if row["source_id"] == source_id]
            self.assertEqual(len(staging_rows), len(source_items))
            for row_number, staging_row in enumerate(staging_rows, start=1):
                item = items_by_source_row[(source_id, row_number)]
                self.assertEqual(staging_row["page_number"], item["source_page"])
                self.assertEqual(
                    f"{staging_row['source_file']}:page {staging_row['page_number']}; staging row {row_number}",
                    item["source_locator"],
                )

        shapes = Counter(
            (
                row["contract_id"], row["source_item_code"], row["description_raw"],
                row["quantity"], row["unit_normalized"],
            )
            for row in items
        )
        self.assertTrue(any(count > 1 for count in shapes.values()))


if __name__ == "__main__":
    unittest.main()
