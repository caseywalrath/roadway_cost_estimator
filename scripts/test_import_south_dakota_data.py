from __future__ import annotations

import unittest
from decimal import Decimal
from pathlib import Path

from reportlab.lib.pagesizes import landscape, letter
from reportlab.pdfgen import canvas

from scripts.import_south_dakota_data import (
    AbstractContract,
    build_projects,
    normalize_catalog_rows,
    parse_abstract_pdf,
    parse_final_pdf,
    parse_html,
    parse_letting_date,
    promote_letting,
)


def draw_top(pdf: canvas.Canvas, x: float, top: float, value: str, size: float = 8) -> None:
    pdf.setFont("Helvetica", size)
    pdf.drawString(x, landscape(letter)[1] - top, value)


def write_abstract(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=landscape(letter))
    draw_top(pdf, 149, 27, "South Dakota Department of Transportation")
    draw_top(pdf, 195, 39, "Abstract of Bids")
    draw_top(pdf, 48, 51, "Letting Date: 01/16/2019")
    draw_top(pdf, 414, 57, "Bidder:")
    draw_top(pdf, 557, 57, "Bidder:")
    draw_top(pdf, 48, 62, "Item Nbr: 1")
    draw_top(pdf, 160, 62, "PCN: 04UQ")
    draw_top(pdf, 414, 68, "Journey Group Companies")
    draw_top(pdf, 557, 68, "PCIROADS, LLC")
    draw_top(pdf, 48, 72, "Project No: NH 0010(00)17")
    draw_top(pdf, 48, 83, "Project Location: US12 west of Groton")
    draw_top(pdf, 48, 93, "Desc of Construction: Structure Repair")
    draw_top(pdf, 48, 104, "County: Brown")
    draw_top(pdf, 48, 120, "No.")
    draw_top(pdf, 73, 120, "Item No.")
    draw_top(pdf, 112, 120, "Description")
    draw_top(pdf, 305, 120, "Qty")
    draw_top(pdf, 332, 120, "Unit")
    draw_top(pdf, 430, 120, "Unit Price")
    draw_top(pdf, 501, 120, "Amount")
    draw_top(pdf, 573, 120, "Unit Price")
    draw_top(pdf, 644, 120, "Amount")

    rows = [
        ("1", "009E0010", "Mobilization", "1.000", "LS", "$100.00", "$100.00", "$120.00", "$120.00"),
        ("2", "009E1000", "Deleted Item", "0.000", "Del", "$0.00", "$0.00", "$0.00", "$0.00"),
    ]
    for index, row in enumerate(rows):
        top = 139 + index * 18
        x_values = (44, 73, 117, 353, 378, 428, 509, 575, 653)
        for x, value in zip(x_values, row):
            draw_top(pdf, x, top, value)
    pdf.showPage()
    draw_top(pdf, 300, 40, "Total Bid Amount")
    draw_top(pdf, 509, 40, "$100.00")
    draw_top(pdf, 653, 40, "$120.00")
    pdf.save()


def write_final(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=letter)
    draw_top(pdf, 40, 40, "STATE OF SOUTH DAKOTA")
    draw_top(pdf, 40, 60, "--- Structure Repair ---")
    draw_top(pdf, 40, 80, "* 1/ NH 0010(00)17 PCN: 04UQ COUNTIES: Brown")
    draw_top(pdf, 40, 100, "US12 west of Groton")
    draw_top(pdf, 40, 120, "PCIROADS, LLC $120.00")
    draw_top(pdf, 40, 160, "--- Culvert Repair ---")
    draw_top(pdf, 40, 180, "2/ P 0021(151) PCN: 041F COUNTIES: Davison")
    draw_top(pdf, 40, 200, "Withdrawn from letting. $0.00")
    draw_top(pdf, 40, 240, "--- Signing & Delineation ---")
    draw_top(pdf, 40, 260, "3/ PH 0010(147) PCN: 05HC COUNTIES: Edmunds")
    draw_top(pdf, 40, 280, "Cancellation of Award of Contract $0.00")
    draw_top(pdf, 40, 320, "--- County Pavement Markings ---")
    draw_top(pdf, 40, 340, "4/ P 000S(00)230 PCN: 04M4 COUNTIES: Regionwide")
    draw_top(pdf, 40, 360, "No bid received on 5/19/21 letting. $N/A")
    draw_top(pdf, 40, 400, "--- Grading ---")
    draw_top(pdf, 40, 420, "5/ P 0021(151) PCN: 041F COUNTIES: Davison")
    draw_top(pdf, 40, 440, "Moved to 10/21/2022 letting by addendum N/A")
    draw_top(pdf, 40, 480, "--- Re-let Grading ---")
    draw_top(pdf, 40, 500, "6/ P 0021(151) PCN: 041F COUNTIES: Davison")
    draw_top(pdf, 40, 520, "Awarded Bidder, Inc. $500.00")
    draw_top(pdf, 40, 540, "Moved to 10/21/2022 letting by addendum")
    pdf.save()


def write_single_bidder_abstract(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=landscape(letter))
    draw_top(pdf, 149, 27, "South Dakota Department of Transportation")
    draw_top(pdf, 195, 39, "Abstract of Bids")
    draw_top(pdf, 48, 51, "Letting Date: 01/16/2019")
    draw_top(pdf, 414, 57, "Bidder:")
    draw_top(pdf, 48, 62, "Item Nbr: 1")
    draw_top(pdf, 160, 62, "PCN: 04UQ, 041F")
    draw_top(pdf, 414, 68, "Single Bidder, Inc.")
    draw_top(pdf, 48, 72, "Project No: NH 0010(00)17, P 0021(151)")
    draw_top(pdf, 48, 83, "Project Location: Two locations")
    draw_top(pdf, 48, 93, "Desc of Construction: Culvert Repair")
    draw_top(pdf, 48, 104, "County: Brown, Davison")
    draw_top(pdf, 48, 120, "No.")
    draw_top(pdf, 73, 120, "Item No.")
    draw_top(pdf, 112, 120, "Description")
    draw_top(pdf, 305, 120, "Qty")
    draw_top(pdf, 332, 120, "Unit")
    draw_top(pdf, 430, 120, "Unit Price")
    draw_top(pdf, 501, 120, "Amount")
    draw_top(pdf, 44, 139, "1")
    draw_top(pdf, 73, 139, "009E0010")
    draw_top(pdf, 117, 139, "Culvert Repair")
    draw_top(pdf, 117, 151, "Wrapped detail")
    draw_top(pdf, 353, 139, "1.000")
    draw_top(pdf, 378, 139, "LS")
    draw_top(pdf, 428, 139, "$100.00")
    draw_top(pdf, 509, 139, "$100.00")
    draw_top(pdf, 300, 180, "Total Bid Amount")
    draw_top(pdf, 509, 180, "$100.00")
    pdf.save()


def write_malformed_abstract(path: Path) -> None:
    pdf = canvas.Canvas(str(path), pagesize=landscape(letter))
    draw_top(pdf, 195, 39, "Abstract of Bids")
    draw_top(pdf, 48, 62, "Item Nbr: 1")
    pdf.save()


class SouthDakotaImporterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.fixture_dir = Path("tmp/test-sddot-importer")
        cls.fixture_dir.mkdir(parents=True, exist_ok=True)
        cls.abstract_path = cls.fixture_dir / "abstract.pdf"
        cls.single_bidder_path = cls.fixture_dir / "single-bidder-abstract.pdf"
        cls.malformed_abstract_path = cls.fixture_dir / "malformed-abstract.pdf"
        cls.final_path = cls.fixture_dir / "final.pdf"
        write_abstract(cls.abstract_path)
        write_single_bidder_abstract(cls.single_bidder_path)
        write_malformed_abstract(cls.malformed_abstract_path)
        write_final(cls.final_path)

    def test_catalog_form_and_rows_are_parsed(self) -> None:
        html = """
        <input name="__VIEWSTATE" value="state" />
        <select name="ctl00$cpSubContent$ddlBitItemGroup">
          <option value="009">009 Measurement and Payment</option>
        </select>
        <table>
          <tr><th>Bid Item Number</th><th>Item</th><th>Unit</th></tr>
          <tr><td>560e2161</td><td>Test item</td><td>Each</td></tr>
          <tr><td>000E0001</td><td>Deleted Item</td><td>Del</td></tr>
        </table>
        """
        parsed = parse_html(html)
        self.assertEqual(parsed.inputs["__VIEWSTATE"], "state")
        self.assertEqual(parsed.groups, [("009", "009 Measurement and Payment")])
        self.assertEqual(parsed.rows[-1], ["000E0001", "Deleted Item", "Del"])
        catalog = normalize_catalog_rows(parsed.rows)
        self.assertEqual(catalog[0]["item_code"], "560E2161")
        self.assertEqual(catalog[0]["item_code_raw"], "560e2161")
        self.assertEqual(catalog[1]["is_deleted"], "true")

    def test_archive_label_date_allows_extra_text(self) -> None:
        self.assertEqual(parse_letting_date("May 3, 2019 University Class"), "2019-05-03")
        self.assertEqual(parse_letting_date("Februrary 27, 2024"), "2024-02-27")
        self.assertEqual(parse_letting_date("February, 15 2023"), "2023-02-15")
        self.assertEqual(parse_letting_date("Februray 1, 2023"), "2023-02-01")
        self.assertEqual(parse_letting_date("5-3-12 University Class"), "2012-05-03")

    def test_abstract_parser_preserves_bidder_columns_and_deleted_line(self) -> None:
        contracts = parse_abstract_pdf(
            self.abstract_path,
            expected_letting_date="2019-01-16",
        )
        contract = contracts["1"]
        self.assertEqual(contract.project_number, "NH 0010(00)17")
        self.assertEqual(list(contract.bidders), ["Journey Group Companies", "PCIROADS, LLC"])
        self.assertEqual(str(contract.bidders["Journey Group Companies"]["bid_total"]), "100.00")
        self.assertEqual(len(contract.items), 2)
        self.assertEqual(len(contract.prices), 4)
        self.assertEqual(contract.review_exceptions, [])

    def test_abstract_parser_supports_one_bidder_wrapped_description_and_multiple_ids(self) -> None:
        contract = parse_abstract_pdf(self.single_bidder_path)["1"]
        self.assertEqual(list(contract.bidders), ["Single Bidder, Inc."])
        self.assertEqual(contract.project_number, "NH 0010(00)17, P 0021(151)")
        self.assertEqual(contract.pcn, "04UQ, 041F")
        self.assertEqual(contract.items["1"]["description_raw"], "Culvert Repair Wrapped detail")

        reviews: list[dict[str, str]] = []
        projects = build_projects(
            "contract",
            contract.project_number,
            contract.pcn,
            contract.work_type,
            contract.county,
            contract.location,
            reviews,
        )
        self.assertEqual(
            [(row["project_number"], row["project_control_number"]) for row in projects],
            [("NH 0010(00)17", "04UQ"), ("P 0021(151)", "041F")],
        )
        self.assertEqual(reviews, [])

    def test_project_pcn_cardinality_mismatch_is_not_fabricated(self) -> None:
        reviews: list[dict[str, str]] = []
        projects = build_projects(
            "contract",
            "NH 0010(00)17, P 0021(151)",
            "04UQ",
            "Culvert Repair",
            "Brown",
            "Two locations",
            reviews,
        )
        self.assertEqual(len(projects), 1)
        self.assertEqual(projects[0]["project_number"], "NH 0010(00)17, P 0021(151)")
        self.assertEqual(projects[0]["project_control_number"], "04UQ")
        self.assertEqual(reviews[0]["category"], "project_pcn_cardinality")

    def test_malformed_abstract_raises_explicitly(self) -> None:
        with self.assertRaisesRegex(ValueError, "missing letting date"):
            parse_abstract_pdf(self.malformed_abstract_path)

    def test_final_parser_preserves_non_low_award_and_non_award_statuses(self) -> None:
        records = parse_final_pdf(self.final_path)
        self.assertEqual(records["1"]["awarded_vendor"], "PCIROADS, LLC")
        self.assertEqual(str(records["1"]["awarded_amount"]), "120.00")
        self.assertEqual(records["2"]["letting_status"], "WITHDRAWN")
        self.assertEqual(records["3"]["letting_status"], "CANCELLED")
        self.assertEqual(records["4"]["letting_status"], "NO BIDS")
        self.assertEqual(records["5"]["letting_status"], "CANCELLED")
        self.assertEqual(records["6"]["letting_status"], "AWARDED")
        self.assertEqual(records["6"]["awarded_vendor"], "Awarded Bidder, Inc.")

    def test_no_bids_abstract_placeholder_is_status_not_bidder(self) -> None:
        abstract = AbstractContract(
            letting_date="2019-01-16",
            item_number="1",
            bidders={
                "No Bids Received": {
                    "bidder_name": "No Bids Received",
                    "bid_total": Decimal("0"),
                    "source_page": 1,
                }
            },
        )
        entry = {
            "letting_date": "2019-01-16",
            "source_id": "source",
            "letting_id": "letting",
            "abstract_file_name": "abstract.pdf",
        }
        promoted = promote_letting(entry, {"1": abstract}, {}, set(), set(), {})
        self.assertEqual(promoted["contracts"][0]["letting_status"], "NO BIDS")
        self.assertEqual(promoted["bids"], [])

    def test_promotion_keeps_apparent_low_separate_from_confirmed_award(self) -> None:
        abstract = parse_abstract_pdf(self.abstract_path)
        final = parse_final_pdf(self.final_path)
        entry = {
            "letting_date": "2019-01-16",
            "source_id": "sd_sddot_bid_tabs_2019_01_16",
            "letting_id": "sd_sddot_2019_01_16",
            "abstract_file_name": "abstract.pdf",
        }
        promoted = promote_letting(
            entry,
            abstract,
            final,
            {"009E0010"},
            set(),
            {},
        )
        bids = [row for row in promoted["bids"] if row["contract_id"].endswith("_001")]
        self.assertTrue(bids[0]["is_apparent_low"] == "true")
        self.assertTrue(bids[0]["is_awarded"] == "false")
        self.assertTrue(bids[1]["is_awarded"] == "true")
        deleted = next(row for row in promoted["contract_items"] if row["source_item_code"] == "009E1000")
        self.assertEqual(deleted["mapping_status"], "source_deleted")
        self.assertEqual(deleted["agency_item_id"], "")
        self.assertFalse(any(
            row["agency_item_code"] == "009E1000" for row in promoted["observations"]
        ))

    def test_reviewed_override_can_resolve_vendor_name_variance(self) -> None:
        abstract = parse_abstract_pdf(self.abstract_path)
        final = parse_final_pdf(self.final_path)
        final["1"]["awarded_vendor"] = "Unmatched source spelling"
        entry = {
            "letting_date": "2019-01-16",
            "source_id": "source",
            "letting_id": "letting",
            "abstract_file_name": "abstract.pdf",
        }
        promoted = promote_letting(
            entry,
            abstract,
            final,
            {"009E0010"},
            set(),
            {("2019-01-16", "1"): "PCIROADS, LLC"},
        )
        awarded = [row for row in promoted["bids"] if row["is_awarded"] == "true"]
        self.assertEqual([row["bidder_name"] for row in awarded], ["PCIROADS, LLC"])


if __name__ == "__main__":
    unittest.main()
