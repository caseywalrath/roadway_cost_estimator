from __future__ import annotations

import unittest

from scripts.promote_cdot_cost_data_book import (
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

    def test_project_list_parses_2023_spaced_project_number_shapes(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    7,
                    "\n".join(
                        [
                            "2023 Cost Data",
                            "Projects Bid From 01/01/23 Through 12/31/23",
                            "20230216 ABC CONSTRUCTION 2 $10,000.00 95.00",
                            "STM C440-013 R3 EAGLE RESIDENCY ADA RAMP IM 3 M",
                            "20230330 XYZ CONSTRUCTION 3 $20,000.00 100.00",
                            "NHPP R100-376 VARIOUS LOCATIONS IN REGION 1 1 R",
                        ]
                    ),
                )
            ],
            "cdot_2023q4",
        )

        self.assertEqual(2, len(projects))
        self.assertEqual("NHPP R100-376", projects[0].project_number)
        self.assertEqual("cdot_2023q4_nhpp_r100_376", projects[0].project_id)
        self.assertEqual("STM C440-013", projects[1].project_number)
        self.assertEqual("cdot_2023q4_stm_c440_013", projects[1].project_id)

    def test_project_list_parses_2022_uppercase_pages_and_blank_locations(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    4,
                    "\n".join(
                        [
                            "2022 Cost Data",
                            "PROJECTS BID FROM 01/01/22 THROUGH 12/31/22",
                            "20220106 ROADSAFE TRAFFIC SYSTEMS, INC 2 $1,168,613.00 87.75",
                            "MTCE R500-218 5 U",
                            "20220310 FLATIRON CONSTRUCTORS, INC. 8 $25,426,004.45 87.29",
                            "NHPP 0761-238 I-76 DAHLIA TO YORK 1 R",
                        ]
                    ),
                )
            ],
            "cdot_2022q4",
        )

        self.assertEqual(2, len(projects))
        self.assertEqual("MTCE R500-218", projects[0].project_number)
        self.assertEqual("", projects[0].project_name)
        self.assertEqual("5", projects[0].district)
        self.assertEqual("U", projects[0].terrain)
        self.assertEqual("NHPP 0761-238", projects[1].project_number)
        self.assertEqual("I-76 DAHLIA TO YORK", projects[1].project_name)

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

    def test_promotion_uses_configurable_source_and_row_prefix(self) -> None:
        projects = parse_project_list_pages(
            [
                (
                    4,
                    "\n".join(
                        [
                            "Projects Bid From 01/01/24 Through 12/31/24",
                            "20241212 ABC CONSTRUCTION 2 $10,000.00 95.00",
                            "STR133A-056 SH 133A MM 42.0-66.5 5 R",
                        ]
                    ),
                )
            ],
            "cdot_2024q4",
        )
        staging_rows = [
            {
                "item_code": "201-00000",
                "item_description": "Clear and Grub",
                "unit_raw": "Lump Sum",
                "unit_normalized": "L S",
                "project_location_raw": "STR133A-056 SH 133A MM 42.0-66.5 US 6D MM",
                "date_let": "2024-12-12",
                "quantity": "1.00",
                "engineer_estimate_unit_price": "30000.00",
                "average_bid_unit_price": "12500.00",
                "awarded_bid_unit_price": "10000.00",
            }
        ]

        observations = promoted_observation_rows(
            staging_rows,
            project_lookup(projects),
            "cdot_cost_data_book_2024_q4",
            "cdot_2024q4",
        )

        self.assertEqual("cdot_cost_data_book_2024_q4", observations[0]["source_id"])
        self.assertEqual("cdot_2024q4_0001_awarded_bid", observations[0]["observation_id"])
        self.assertEqual("cdot_2024q4_str133a_056", observations[0]["project_id"])

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
