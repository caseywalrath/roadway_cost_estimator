from __future__ import annotations

import unittest

from scripts.validate_data_package import (
    validate_period_summary_rows,
    validate_taxonomy_membership_rows,
)


CONFIG = {
    "code": "NE",
    "defaultAgencyId": "ne_ndot",
    "files": {"itemTaxonomyMemberships": "states/ne/item_taxonomy_memberships.csv"},
}
SOURCES = {
    "source-1": {"source_id": "source-1", "state": "NE", "agency_id": "ne_ndot"},
}
AGENCY_ITEMS = {
    "item-1": {"agency_item_id": "item-1", "state": "NE", "agency_id": "ne_ndot", "item_status": "current"},
}
TAXONOMY = {
    "section-1": {"taxonomy_id": "section-1", "state": "NE", "agency_id": "ne_ndot", "taxonomy_level": "section"},
}


def summary_row(**overrides: str) -> dict[str, str]:
    row = {
        "summary_id": "summary-1",
        "source_id": "source-1",
        "state": "NE",
        "agency_id": "ne_ndot",
        "agency_item_id": "item-1",
        "agency_item_code": "0005.10",
        "period_start_date": "2025-07-01",
        "period_end_date": "2026-06-30",
        "period_label": "July 2025 - June 2026",
        "report_series": "july_june",
        "description_raw": "TRAFFIC CONTROL MANAGEMENT",
        "total_quantity": "100",
        "unit_raw": "DAY",
        "unit_normalized": "DAY",
        "published_average_unit_price": "12.34",
        "total_bid": "1234.00",
        "source_page": "2",
        "source_locator": "report.pdf#page=2;item=0005.10",
        "derivation_method": "ndot_published_period_aggregate",
    }
    row.update(overrides)
    return row


class PeriodDataValidationTests(unittest.TestCase):
    def test_valid_period_summary_accepts_zero_and_signed_values(self) -> None:
        errors: list[str] = []
        row = summary_row(total_quantity="0", published_average_unit_price="-500.00", total_bid="-27500.00")
        validate_period_summary_rows("NE", CONFIG, [row], list(row), SOURCES, AGENCY_ITEMS, errors)
        self.assertEqual(errors, [])

    def test_period_summary_rejects_bad_reconciliation(self) -> None:
        errors: list[str] = []
        row = summary_row(total_bid="999.00")
        validate_period_summary_rows("NE", CONFIG, [row], list(row), SOURCES, AGENCY_ITEMS, errors)
        self.assertTrue(any("does not reconcile" in error for error in errors))

    def test_taxonomy_membership_requires_sections_and_searchable_items(self) -> None:
        errors: list[str] = []
        row = {
            "membership_id": "membership-1",
            "state": "NE",
            "agency_id": "ne_ndot",
            "agency_item_id": "item-1",
            "taxonomy_id": "section-1",
            "source_id": "source-1",
            "match_status": "catalog_exact",
            "notes": "",
        }
        validate_taxonomy_membership_rows("NE", CONFIG, [row], SOURCES, AGENCY_ITEMS, TAXONOMY, errors)
        self.assertEqual(errors, [])

        missing_errors: list[str] = []
        validate_taxonomy_membership_rows("NE", CONFIG, [], SOURCES, AGENCY_ITEMS, TAXONOMY, missing_errors)
        self.assertTrue(any("has no taxonomy membership" in error for error in missing_errors))


if __name__ == "__main__":
    unittest.main()
