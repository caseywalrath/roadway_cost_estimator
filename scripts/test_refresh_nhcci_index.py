from __future__ import annotations

import unittest

from refresh_nhcci_index import build_output_rows, normalize_decimal, parse_quarter_label, quarter_date_range


class RefreshNhcciIndexTests(unittest.TestCase):
    def test_parse_quarter_label(self) -> None:
        self.assertEqual(parse_quarter_label("2025 Q4"), (2025, 4))

    def test_parse_quarter_label_rejects_invalid_quarter(self) -> None:
        with self.assertRaises(ValueError):
            parse_quarter_label("2025 Q5")

    def test_quarter_date_range(self) -> None:
        start_date, end_date = quarter_date_range(2024, 3)
        self.assertEqual(start_date.isoformat(), "2024-07-01")
        self.assertEqual(end_date.isoformat(), "2024-09-30")

    def test_normalize_decimal(self) -> None:
        self.assertEqual(str(normalize_decimal("3.210395449")), "3.210395449")
        self.assertIsNone(normalize_decimal("0"))
        self.assertIsNone(normalize_decimal("not numeric"))

    def test_build_output_rows_sorts_and_maps_fields(self) -> None:
        rows = build_output_rows([
            {"quarter": "2024 Q2", "nhcci": "3.2"},
            {"quarter": "2024 Q1", "nhcci": "3.1"},
        ])

        self.assertEqual([row["period_label"] for row in rows], ["2024 Q1", "2024 Q2"])
        self.assertEqual(rows[0]["index_id"], "fhwa_nhcci_2024_q1")
        self.assertEqual(rows[0]["period_start_date"], "2024-01-01")
        self.assertEqual(rows[0]["period_end_date"], "2024-03-31")


if __name__ == "__main__":
    unittest.main()
