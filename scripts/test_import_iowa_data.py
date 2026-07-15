from __future__ import annotations

import unittest

from scripts.import_iowa_data import (
    group_words_by_top,
    normalized_vendor_tokens,
    parse_contract_projects,
    parse_item_master_lines,
)


class IowaImportTests(unittest.TestCase):
    def test_fixed_width_item_master_preserves_native_fields(self) -> None:
        rows = [
            "HEADER",
            self._master_line("2101-0850001", "CLEARING", "ACRE", "CLEARING AND GRUBBING"),
            self._master_line("2102-0425070", "SPECIAL BACKFILL", "TON", "SPECIAL BACKFILL"),
        ]

        parsed = parse_item_master_lines(rows, expected_count=2)

        self.assertEqual(parsed[0]["item_code"], "2101-0850001")
        self.assertEqual(parsed[0]["official_abbreviated_description"], "CLEARING")
        self.assertEqual(parsed[0]["official_unit"], "ACRE")
        self.assertEqual(parsed[0]["official_description"], "CLEARING AND GRUBBING")

    def test_awarded_vendor_tokens_allow_last_name_first_printing(self) -> None:
        self.assertEqual(
            normalized_vendor_tokens("GRYP, DAVE CONSTRUCTION, INC."),
            normalized_vendor_tokens("DAVE GRYP CONSTRUCTION, INC."),
        )

    def test_contract_projects_preserve_multiple_project_numbers(self) -> None:
        text = (
            "Project: NHSX-071-6(056)--3H-81 WorkType: HMA RESURFACING\n"
            "County: SAC Prj Awd Amt: $3,000,000.00\n"
            "Route: US 71\nLocation: FIRST LOCATION\n"
            "Project: STP-175-4(021)--2C-81 WorkType: BRIDGE REPAIR\n"
            "County: SAC Prj Awd Amt: $2,238,311.66\n"
            "Route: IA 175\nLocation: SECOND LOCATION"
        )

        projects = parse_contract_projects(text, "81-1754-021")

        self.assertEqual(len(projects), 2)
        self.assertEqual(projects[0]["project_number"], "NHSX-071-6(056)--3H-81")
        self.assertEqual(projects[1]["project_number"], "STP-175-4(021)--2C-81")

    def test_word_rows_tolerate_small_vertical_offsets(self) -> None:
        words = [
            {"text": "1070", "top": 501.37, "x0": 77.5},
            {"text": "2533-4980005", "top": 502.24, "x0": 114.1},
            {"text": "1,000,000.00000", "top": 501.31, "x0": 436.8},
        ]
        grouped = group_words_by_top(words)
        self.assertEqual(len(grouped), 1)

    @staticmethod
    def _master_line(code: str, abbreviation: str, unit: str, description: str) -> str:
        return f"{code:<12} {abbreviation:<40}{unit:<4}{description}"


if __name__ == "__main__":
    unittest.main()
