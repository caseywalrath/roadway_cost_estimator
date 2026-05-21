from __future__ import annotations

import unittest

from parse_cdot_cost_data_book import parse_pages


class CdotCostDataBookParserTests(unittest.TestCase):
    def parse_fixture(self, text: str):
        return parse_pages([(8, text)], "fixture.pdf", "2026 Q1")

    def test_parses_item_header_and_project_row(self) -> None:
        rows, stats = self.parse_fixture(
            "\n".join(
                [
                    "Item Unit Costs by Projects -- 2026 Cost Data",
                    "304-06007 ABC (CL 6) Cubic Yard",
                    "CR400-408 CO157A - MP 0.277; 036B - MP 01/08/26 26.00 152.18 141.35 184.00",
                ]
            )
        )

        self.assertEqual(1, len(rows))
        self.assertEqual("304-06007", rows[0]["item_code"])
        self.assertEqual("ABC (CL 6)", rows[0]["item_description"])
        self.assertEqual("Cubic Yard", rows[0]["unit_raw"])
        self.assertEqual("CY", rows[0]["unit_normalized"])
        self.assertEqual("2026-01-08", rows[0]["date_let"])
        self.assertEqual("26.00", rows[0]["quantity"])
        self.assertEqual(1, stats.item_headers)
        self.assertEqual(1, stats.project_rows)

    def test_excludes_weighted_average_rows(self) -> None:
        rows, stats = self.parse_fixture(
            "\n".join(
                [
                    "Item Unit Costs by Projects -- 2026 Cost Data",
                    "304-06007 ABC (CL 6) Cubic Yard",
                    "CR400-408 CO157A - MP 0.277; 036B - MP 01/08/26 26.00 152.18 141.35 184.00",
                    "Weighted Average for the First  Quarter 26.00 152.18 141.35 184.00",
                    "Weighted Average for the Year 26.00 152.18 141.35 184.00",
                ]
            )
        )

        self.assertEqual(1, len(rows))
        self.assertEqual(2, stats.weighted_average_rows)

    def test_attaches_continuation_line_to_previous_project_row(self) -> None:
        rows, stats = self.parse_fixture(
            "\n".join(
                [
                    "Item Unit Costs by Projects -- 2026 Cost Data",
                    "201-00000 Clear and Grub Lump Sum",
                    "STM006A-076 ATWOOD TO STERLING (MP 398.2- 01/15/26 1.00 23078.47 57070.60 14123.00",
                    "FBR006A-078 ATWOOD TO STERLING (MP 398.2-",
                ]
            )
        )

        self.assertEqual(1, len(rows))
        self.assertIn("FBR006A-078", rows[0]["project_location_raw"])
        self.assertIn("FBR006A-078", rows[0]["raw_text"])
        self.assertEqual(1, stats.continuation_lines)

    def test_keeps_item_context_across_pages(self) -> None:
        rows, stats = parse_pages(
            [
                (
                    88,
                    "\n".join(
                        [
                            "Item Unit Costs by Projects -- 2026 Cost Data",
                            "304-06007 ABC (CL 6) Cubic Yard",
                            "NHPP006A-080 US 6 MP 20-26 Resurfacing 03/19/26 28.00 100.00 286.50 160.00",
                        ]
                    ),
                ),
                (
                    89,
                    "\n".join(
                        [
                            "Item Unit Costs by Projects -- 2026 Cost Data",
                            "304-06007 ABC (CL 6) Cubic Yard",
                            "CM570-071 GREELEY & EVANS 03/26/26 282.00 108.00 138.50 75.00",
                        ]
                    ),
                ),
            ],
            "fixture.pdf",
            "2026 Q1",
        )

        self.assertEqual(2, len(rows))
        self.assertEqual(["304-06007", "304-06007"], [row["item_code"] for row in rows])
        self.assertEqual(2, stats.item_headers)

    def test_reports_unparsed_lines(self) -> None:
        rows, stats = self.parse_fixture(
            "\n".join(
                [
                    "Item Unit Costs by Projects -- 2026 Cost Data",
                    "304-06007 ABC (CL 6) Cubic Yard",
                    "THIS LINE DOES NOT MATCH",
                ]
            )
        )

        self.assertEqual([], rows)
        self.assertEqual([(8, "THIS LINE DOES NOT MATCH")], stats.unparsed_lines)


if __name__ == "__main__":
    unittest.main()
