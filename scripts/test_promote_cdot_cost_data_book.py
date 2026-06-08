from __future__ import annotations

import unittest

from promote_cdot_cost_data_book import (
    PRICE_TYPES,
    agency_item_codes,
    parse_project_list_pages,
    project_lookup,
    promoted_observation_rows,
    validate_import,
)


class CdotCostDataBookPromotionTests(unittest.TestCase):
    def test_project_list_parses_spaced_project_number(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    5,
                    "\n".join(
                        [
                            "2026 Cost Data",
                            "Projects Bid From 01/01/26 Through 03/31/26",
                            "20260211 AMES CONSTRUCTION, INC. 3 $1,251,000.00 59.90",
                            "C 0852-130 SB SANTA FE TO EASTBOUND C470 1 U",
                        ]
                    ),
                )
            ]
        )

        self.assertEqual(1, len(projects))
        self.assertEqual("C 0852-130", projects[0].project_number)
        self.assertEqual("SB SANTA FE TO EASTBOUND C470", projects[0].project_name)
        self.assertEqual("1", projects[0].district)
        self.assertEqual("U", projects[0].terrain)

    def test_project_list_parses_2025_project_number_shapes(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    4,
                    "\n".join(
                        [
                            "2025 Cost Data",
                            "Projects Bid From 01/01/25 Through 12/31/25",
                            "20250116 KRAEMER NORTH AMERICA, LLC 3 $53,000.00 98.10",
                            "2670252-499 I-25:MOBILITY HUB (LONE TREE) 1 R",
                            "20250626 MODERN RAILWAY SYSTEMS 2 $20,000.00 88.00",
                            "ITSSW03-250 FRONT RANGE 0 P",
                        ]
                    ),
                )
            ],
            "cdot_2025q4",
        )

        self.assertEqual(2, len(projects))
        self.assertEqual("2670252-499", projects[0].project_number)
        self.assertEqual("cdot_2025q4_2670252_499", projects[0].project_id)
        self.assertEqual("ITSSW03-250", projects[1].project_number)
        self.assertEqual("cdot_2025q4_itssw03_250", projects[1].project_id)

    def test_promotion_creates_three_observation_types_without_duplication(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    4,
                    "\n".join(
                        [
                            "Projects Bid From 01/01/26 Through 03/31/26",
                            "20260115 Harper Brothers Construction LLC 4 $20,722,238.45 100.90",
                            "STM006A-076 ATWOOD TO STERLING (MP 398.2-4 4 P",
                            "FBR006A-078 ATWOOD TO STERLING (MP 398.2-4 4 P",
                        ]
                    ),
                )
            ]
        )
        staging_rows = [
            {
                "item_code": "201-00000",
                "item_description": "Clear and Grub",
                "unit_raw": "Lump Sum",
                "unit_normalized": "L S",
                "project_location_raw": "STM006A-076 ATWOOD TO STERLING (MP 398.2- | FBR006A-078 ATWOOD TO STERLING (MP 398.2-",
                "date_let": "2026-01-15",
                "quantity": "1.00",
                "engineer_estimate_unit_price": "23078.47",
                "average_bid_unit_price": "57070.60",
                "awarded_bid_unit_price": "14123.00",
            }
        ]

        observations = promoted_observation_rows(staging_rows, project_lookup(projects))

        self.assertEqual(len(PRICE_TYPES), len(observations))
        self.assertEqual({"cdot_awarded_bid", "cdot_average_bid", "cdot_engineer_estimate"}, {row["price_type"] for row in observations})
        self.assertEqual({"cdot_2026q1_stm006a_076"}, {row["project_id"] for row in observations})

    def test_validation_reports_missing_item_codes_as_warning(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    4,
                    "\n".join(
                        [
                            "Projects Bid From 01/01/26 Through 03/31/26",
                            "20260108 BRANNAN SAND AND GRAVEL, LLC 4 $6,365,969.25 111.68",
                            "NHPP0741-026 SH 74 DOWNTOWN EVERGREEN TO CO 1 M",
                        ]
                    ),
                )
            ]
        )
        staging_rows = [
            {
                "item_code": "202-00826",
                "item_description": "Sample",
                "unit_raw": "Each",
                "unit_normalized": "EACH",
                "project_location_raw": "NHPP0741-026 SH 74 DOWNTOWN EVERGREEN TO C",
                "date_let": "2026-01-08",
                "quantity": "1.00",
                "engineer_estimate_unit_price": "1.00",
                "average_bid_unit_price": "1.00",
                "awarded_bid_unit_price": "1.00",
            }
        ]

        errors, warnings = validate_import(
            staging_rows,
            projects,
            {"201-00000"},
            min_staging_rows=1,
            min_project_rows=1,
        )

        self.assertEqual([], errors)
        self.assertEqual(["Missing agency item codes: 202-00826"], warnings)


if __name__ == "__main__":
    unittest.main()
