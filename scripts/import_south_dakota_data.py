from __future__ import annotations

import argparse
import concurrent.futures
import csv
import hashlib
import json
import re
import statistics
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from html.parser import HTMLParser
from pathlib import Path

import pdfplumber


ARCHIVE_URL = "https://apps.sd.gov/hc65bidletting/bidlettingscomplete.aspx"
ITEM_CATALOG_URL = "https://apps.sd.gov/hc70sbi/main.aspx"
ANNUAL_REPORT_URL = "https://dot.sd.gov/media/qqhgg24h/2024-bid-item-price-report.pdf"
SPEC_BOOK_URL = "https://dot.sd.gov/media/035a1wt1/2025-sddot-specbook-final.pdf"
AGENCY_ID = "sd_sddot"
AGENCY_NAME = "South Dakota Department of Transportation"
PARSER_VERSION = "1.0.0"
USER_AGENT = "roadway-cost-estimator/2.0"
ITEM_CODE_PATTERN = re.compile(r"^\d{3}E\d{4}$", re.IGNORECASE)
MONEY_PATTERN = re.compile(r"^\(?\$?[\d,]+\.\d{2}\)?$")
FINAL_STATUSES = {
    "cancellation of award": "CANCELLED",
    "withdrawn": "WITHDRAWN",
    "no bids received": "NO BIDS",
    "no bids": "NO BIDS",
    "no bid received": "NO BIDS",
    "rejected": "REJECTED",
    "cancelled": "CANCELLED",
    "canceled": "CANCELLED",
}


SOURCE_FIELDS = [
    "source_id", "source_type", "agency_id", "agency_name", "state", "source_label",
    "source_date", "data_year", "source_url", "source_file_name", "sha256",
    "parser_name", "parser_version", "notes",
]
SOURCE_DOCUMENT_FIELDS = [
    "source_document_id", "source_id", "document_role", "source_url", "source_file_name",
    "sha256", "media_type", "published_on", "retrieved_on", "notes",
]
LETTING_FIELDS = [
    "letting_id", "source_id", "state", "agency_id", "letting_date", "letting_label",
]
CONTRACT_FIELDS = [
    "contract_id", "letting_id", "source_id", "state", "agency_id",
    "official_contract_id", "call_order", "letting_status", "awarded_vendor",
    "awarded_amount", "primary_county", "route", "work_type", "contract_period",
    "dbe_goal", "bid_count", "location", "district", "terrain", "award_index",
]
CONTRACT_PROJECT_FIELDS = [
    "contract_project_id", "contract_id", "project_number", "project_control_number",
    "project_name", "work_type", "county_region", "route", "location",
    "project_award_amount",
]
CONTRACT_ITEM_FIELDS = [
    "contract_item_id", "contract_id", "source_id", "section_number", "section_title",
    "line_number", "source_item_code", "agency_item_id", "description_raw", "quantity",
    "unit_raw", "unit_normalized", "alternate_set", "alternate_member", "mapping_status",
    "source_page", "source_locator",
]
BID_FIELDS = [
    "bid_id", "contract_id", "source_id", "source_vendor_id", "bidder_name", "bid_rank",
    "bid_total", "percent_of_low", "is_apparent_low", "is_awarded", "source_page",
]
BID_PRICE_FIELDS = [
    "bid_item_price_id", "contract_item_id", "bid_id", "contract_id", "source_id",
    "unit_price", "extended_price", "source_page", "source_locator",
]
AGENCY_ITEM_FIELDS = [
    "agency_item_id", "state", "agency_id", "agency_name", "item_code",
    "current_version_id", "item_status", "canonical_item_id",
]
AGENCY_VERSION_FIELDS = [
    "agency_item_version_id", "agency_item_id", "effective_from", "effective_to",
    "official_description", "official_abbreviated_description", "official_unit",
    "spec_reference_code", "source_id", "is_current",
]
TAXONOMY_FIELDS = [
    "taxonomy_id", "state", "agency_id", "taxonomy_level", "taxonomy_code",
    "parent_taxonomy_id", "taxonomy_label", "match_prefix", "source_year", "source_url",
]
MAPPING_FIELDS = [
    "mapping_id", "state", "source_agency_id", "source_item_code",
    "target_agency_item_id", "match_status", "confidence", "reviewed_by",
    "reviewed_on", "notes",
]
OBSERVATION_FIELDS = [
    "observation_id", "contract_id", "source_id", "agency_item_id", "agency_item_code",
    "description_raw", "description_normalized", "unit_raw", "unit_normalized",
    "quantity", "unit_price", "extended_price", "discipline", "price_type",
    "date_basis", "derivation_method", "derivation_input_count",
]


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.lower())).strip("_")


def compact_date(value: str) -> str:
    return value.replace("-", "")


def source_id(letting_date: str) -> str:
    return f"sd_sddot_bid_tabs_{letting_date.replace('-', '_')}"


def letting_id(letting_date: str) -> str:
    return f"sd_sddot_{letting_date.replace('-', '_')}"


def contract_id(letting_date: str, item_number: str) -> str:
    return f"sd_sddot_{compact_date(letting_date)}_item_{int(item_number):03d}"


def agency_item_id(code: str) -> str:
    return f"sd_sddot_{code.upper()}"


def normalize_description(value: str) -> str:
    return clean(re.sub(r"[^a-z0-9]+", " ", value.lower()))


def normalize_unit(value: str) -> str:
    normalized = clean(value).upper()
    aliases = {
        "LS": "L S",
        "LUMP SUM": "L S",
        "EA": "EACH",
        "EAC": "EACH",
    }
    return aliases.get(normalized, normalized)


def decimal_value(value: str) -> Decimal:
    text = value.replace("$", "").replace(",", "").replace("(", "-").replace(")", "")
    return Decimal(text)


def decimal_text(value: Decimal | float | int | None, places: int | None = None) -> str:
    if value is None:
        return ""
    decimal = value if isinstance(value, Decimal) else Decimal(str(value))
    if places is not None:
        decimal = decimal.quantize(Decimal(1).scaleb(-places))
    return format(decimal, "f").rstrip("0").rstrip(".") if decimal else "0"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def write_csv(path: Path, fields: list[str], rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as target:
        writer = csv.DictWriter(target, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def fetch(url: str, path: Path, refresh: bool = False) -> Path:
    if path.exists() and not refresh:
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=120) as response:
        path.write_bytes(response.read())
    return path


def read_text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


class SddotHtmlParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.inputs: dict[str, str] = {}
        self.links: list[tuple[str, str]] = []
        self.groups: list[tuple[str, str]] = []
        self.rows: list[list[str]] = []
        self._anchor_href = ""
        self._anchor_text: list[str] = []
        self._select_name = ""
        self._option_value = ""
        self._option_text: list[str] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        values = {name: value or "" for name, value in attrs}
        if tag == "input" and values.get("name"):
            self.inputs[values["name"]] = values.get("value", "")
        elif tag == "a":
            self._anchor_href = values.get("href", "")
            self._anchor_text = []
        elif tag == "select":
            self._select_name = values.get("name", "")
        elif tag == "option":
            self._option_value = values.get("value", "")
            self._option_text = []
        elif tag == "tr":
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []

    def handle_data(self, data: str) -> None:
        if self._anchor_href:
            self._anchor_text.append(data)
        if self._option_value:
            self._option_text.append(data)
        if self._cell is not None:
            self._cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._anchor_href:
            self.links.append((self._anchor_href, clean(" ".join(self._anchor_text))))
            self._anchor_href = ""
            self._anchor_text = []
        elif tag == "option" and self._option_value:
            if self._select_name.endswith("ddlBitItemGroup"):
                self.groups.append((self._option_value, clean(" ".join(self._option_text))))
            self._option_value = ""
            self._option_text = []
        elif tag == "select":
            self._select_name = ""
        elif tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append(clean(" ".join(self._cell)))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.rows.append(self._row)
            self._row = None


def parse_html(html: str) -> SddotHtmlParser:
    parser = SddotHtmlParser()
    parser.feed(html)
    return parser


def normalize_catalog_rows(rows: list[list[str]]) -> list[dict[str, str]]:
    return [
        {
            "item_code_raw": cells[0],
            "item_code": cells[0].upper(),
            "official_description": cells[1],
            "official_unit": cells[2],
            "is_deleted": str(
                cells[1].lower() == "deleted item" or cells[2].lower() == "del"
            ).lower(),
        }
        for cells in rows
        if len(cells) >= 3 and ITEM_CODE_PATTERN.fullmatch(cells[0])
    ]


def submit_item_catalog(raw_dir: Path, refresh: bool = False) -> tuple[list[dict[str, str]], list[dict[str, str]], Path]:
    form_path = fetch(ITEM_CATALOG_URL, raw_dir / "standard_bid_items_form.html", refresh=refresh)
    form = parse_html(read_text(form_path))
    required = ["__VIEWSTATE", "__VIEWSTATEGENERATOR", "__EVENTVALIDATION"]
    missing = [name for name in required if not form.inputs.get(name)]
    if missing:
        raise ValueError(f"SDDOT item form is missing hidden fields: {', '.join(missing)}")
    payload = urllib.parse.urlencode({
        "__VIEWSTATE": form.inputs["__VIEWSTATE"],
        "__VIEWSTATEGENERATOR": form.inputs["__VIEWSTATEGENERATOR"],
        "__EVENTVALIDATION": form.inputs["__EVENTVALIDATION"],
        "ctl00$cpSubContent$UseSBIGroups": "rdoAllSBI",
        "ctl00$cpSubContent$ddlBitItemGroup": form.groups[0][0] if form.groups else "004",
        "ctl00$cpSubContent$btnFind": "Find",
    }).encode("utf-8")
    result_path = raw_dir / "standard_bid_items_all.html"
    if refresh or not result_path.exists():
        request = urllib.request.Request(
            ITEM_CATALOG_URL,
            data=payload,
            headers={
                "User-Agent": USER_AGENT,
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )
        result_path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(request, timeout=180) as response:
            result_path.write_bytes(response.read())
    result = parse_html(read_text(result_path))
    catalog = normalize_catalog_rows(result.rows)
    if len(catalog) < 5000:
        raise ValueError(f"Expected at least 5,000 SDDOT catalog rows; parsed {len(catalog):,}.")
    if len({row["item_code"] for row in catalog}) != len(catalog):
        raise ValueError("SDDOT catalog contains duplicate normalized item codes.")
    groups = [
        {
            "group_code": code.zfill(3),
            "group_label": re.sub(rf"^{re.escape(code)}\s*", "", label).strip(),
        }
        for code, label in form.groups
        if code
    ]
    return catalog, groups, result_path


def parse_letting_date(label: str) -> str:
    normalized_label = re.sub(
        r"\b(?:Februrary|Februray)\b",
        "February",
        label,
        flags=re.IGNORECASE,
    )
    match = re.search(
        r"\b(January|February|March|April|May|June|July|August|September|October|November|December)"
        r"[\s,.]+(\d{1,2})[\s,.]+(\d{4})\b",
        normalized_label,
        re.IGNORECASE,
    )
    if match:
        month = datetime.strptime(match.group(1), "%B").month
        return date(int(match.group(3)), month, int(match.group(2))).isoformat()
    numeric = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", normalized_label)
    if numeric:
        year = int(numeric.group(3))
        if year < 100:
            year += 2000
        return date(year, int(numeric.group(1)), int(numeric.group(2))).isoformat()
    raise ValueError(f"Could not parse SDDOT letting date from {label!r}.")


def discover_lettings(
    raw_dir: Path,
    start_date: str,
    through_date: str,
    refresh: bool = False,
) -> list[dict[str, str]]:
    archive_path = fetch(ARCHIVE_URL, raw_dir / "completed_lettings.html", refresh=refresh)
    page = parse_html(read_text(archive_path))
    entries: list[dict[str, str]] = []
    for href, label in page.links:
        if "bidlettingscompletedetail.aspx" not in href.lower():
            continue
        letting_date = parse_letting_date(label)
        if not (start_date <= letting_date <= through_date):
            continue
        detail_url = urllib.parse.urljoin(ARCHIVE_URL, href)
        entries.append({
            "letting_date": letting_date,
            "label": label,
            "detail_url": detail_url,
            "source_id": source_id(letting_date),
            "letting_id": letting_id(letting_date),
            "detail_file_name": f"{compact_date(letting_date)}_detail.html",
            "abstract_url": "",
            "abstract_file_name": "",
            "abstract_sha256": "",
            "final_url": "",
            "final_file_name": "",
            "final_sha256": "",
            "parse_status": "discovered",
            "notes": "",
        })
    deduped = {entry["detail_url"]: entry for entry in entries}
    return sorted(deduped.values(), key=lambda row: row["letting_date"])


def resolve_report_links(entry: dict[str, str], raw_dir: Path, refresh: bool = False) -> None:
    detail_path = fetch(
        entry["detail_url"],
        raw_dir / "letting_details" / entry["detail_file_name"],
        refresh=refresh,
    )
    detail = parse_html(read_text(detail_path))
    for href, label in detail.links:
        normalized = label.lower()
        url = urllib.parse.urljoin(entry["detail_url"], href)
        if "low bid final report" in normalized:
            entry["final_url"] = url
            entry["final_file_name"] = Path(urllib.parse.urlparse(url).path).name
        elif "abstract of bids" in normalized:
            entry["abstract_url"] = url
            entry["abstract_file_name"] = Path(urllib.parse.urlparse(url).path).name


def download_reports(entry: dict[str, str], raw_dir: Path, refresh: bool = False) -> tuple[Path, Path]:
    if not entry["abstract_url"] or not entry["final_url"]:
        raise ValueError("letting detail page does not expose both abstract and final reports")
    report_dir = raw_dir / "bid_tabs" / compact_date(entry["letting_date"])
    abstract_path = fetch(entry["abstract_url"], report_dir / entry["abstract_file_name"], refresh=refresh)
    final_path = fetch(entry["final_url"], report_dir / entry["final_file_name"], refresh=refresh)
    entry["abstract_sha256"] = sha256(abstract_path)
    entry["final_sha256"] = sha256(final_path)
    return abstract_path, final_path


def words_text(words: list[dict], x_min: float, x_max: float, top: float, bottom: float) -> str:
    selected = [
        word for word in words
        if x_min <= float(word["x0"]) < x_max and top <= float(word["top"]) < bottom
    ]
    selected.sort(key=lambda word: (round(float(word["top"]), 1), float(word["x0"])))
    return clean(" ".join(str(word["text"]) for word in selected))


def extract_abstract_metadata(page) -> dict[str, str]:
    left_text = page.crop((0, 0, min(405, page.width), page.height)).extract_text(
        x_tolerance=2,
        y_tolerance=2,
    ) or ""

    def between(start: str, end: str) -> str:
        match = re.search(re.escape(start) + r"\s*(.*?)\s*" + re.escape(end), left_text, re.DOTALL)
        return clean(match.group(1)) if match else ""

    item_match = re.search(r"Item Nbr:\s*(\d+)\s+PCN:\s*(.*?)\s+Project No:", left_text, re.DOTALL)
    date_match = re.search(r"Letting Date:\s*(\d{2}/\d{2}/\d{4})", left_text)
    if not item_match or not date_match:
        raise ValueError("abstract page is missing letting date, Item Nbr, or PCN")
    return {
        "letting_date": datetime.strptime(date_match.group(1), "%m/%d/%Y").date().isoformat(),
        "item_number": item_match.group(1),
        "pcn": clean(item_match.group(2)),
        "project_number": between("Project No:", "Project Location:"),
        "location": between("Project Location:", "Desc of Construction:"),
        "work_type": between("Desc of Construction:", "County:"),
        "county": clean(re.split(r"\nNo\.\s+Item No\.", left_text, maxsplit=1)[0].split("County:")[-1]),
    }


def bidder_names(words: list[dict]) -> list[str]:
    bidder_labels = [
        word for word in words
        if str(word["text"]).rstrip(":").lower() == "bidder" and float(word["x0"]) >= 390
    ]
    if not bidder_labels:
        return []
    label_top = min(float(word["top"]) for word in bidder_labels)
    header_tops = [
        float(word["top"]) for word in words
        if str(word["text"]) == "No." and float(word["x0"]) < 65 and float(word["top"]) > label_top
    ]
    bottom = min(header_tops) - 2 if header_tops else label_top + 60
    names = []
    for x_min, x_max in ((400, 557), (557, 760)):
        value = words_text(words, x_min, x_max, label_top + 3, bottom)
        if value:
            names.append(value)
    return names


def money_cells(words: list[dict], top: float, bottom: float, x_min: float, x_max: float) -> list[Decimal]:
    values = [
        word for word in words
        if x_min <= float(word["x0"]) < x_max
        and top <= float(word["top"]) < bottom
        and MONEY_PATTERN.fullmatch(str(word["text"]))
    ]
    values.sort(key=lambda word: (float(word["top"]), float(word["x0"])))
    return [decimal_value(str(word["text"])) for word in values]


@dataclass
class AbstractContract:
    letting_date: str
    item_number: str
    pcn: str = ""
    project_number: str = ""
    location: str = ""
    work_type: str = ""
    county: str = ""
    bidders: dict[str, dict[str, object]] = field(default_factory=dict)
    items: dict[str, dict[str, object]] = field(default_factory=dict)
    prices: list[dict[str, object]] = field(default_factory=list)
    review_exceptions: list[str] = field(default_factory=list)


def parse_abstract_pdf(path: Path, expected_letting_date: str | None = None) -> dict[str, AbstractContract]:
    contracts: dict[str, AbstractContract] = {}
    last_item_number = ""
    last_names: list[str] = []
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=2) or ""
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            if "Total Bid Amount" in text and "Item Nbr:" not in text:
                if not last_item_number or last_item_number not in contracts:
                    continue
                contract = contracts[last_item_number]
                total_tops = [
                    float(word["top"]) for word in words
                    if str(word["text"]) == "Total" and float(word["x0"]) < 400
                ]
                for total_top in total_tops:
                    for bidder_index, name in enumerate(last_names):
                        x_min, x_max = ((400, 557), (557, 760))[bidder_index]
                        totals = money_cells(words, total_top - 1, total_top + 18, x_min, x_max)
                        if totals:
                            contract.bidders[name]["bid_total"] = totals[-1]
                            contract.bidders[name]["source_page"] = page_number
                continue
            if "Item Nbr:" not in text or "Abstract of Bids" not in text:
                continue
            metadata = extract_abstract_metadata(page)
            if expected_letting_date and metadata["letting_date"] != expected_letting_date:
                raise ValueError(
                    f"Abstract letting date {metadata['letting_date']} does not match {expected_letting_date}."
                )
            item_number = metadata["item_number"]
            last_item_number = item_number
            contract = contracts.setdefault(
                item_number,
                AbstractContract(
                    letting_date=metadata["letting_date"],
                    item_number=item_number,
                ),
            )
            for key in ("pcn", "project_number", "location", "work_type", "county"):
                if metadata[key] and not getattr(contract, key):
                    setattr(contract, key, metadata[key])

            names = bidder_names(words)
            last_names = names
            for name in names:
                contract.bidders.setdefault(name, {"bidder_name": name, "bid_total": None, "source_page": page_number})

            code_words = [
                word for word in words
                if 60 <= float(word["x0"]) < 115 and ITEM_CODE_PATTERN.fullmatch(str(word["text"]))
            ]
            code_words.sort(key=lambda word: float(word["top"]))
            total_tops = [
                float(word["top"]) for word in words
                if str(word["text"]) == "Total" and float(word["x0"]) < 400
            ]
            for index, code_word in enumerate(code_words):
                top = float(code_word["top"]) - 1
                next_top = float(code_words[index + 1]["top"]) - 1 if index + 1 < len(code_words) else page.height
                total_after = [value for value in total_tops if value > top]
                bottom = min(next_top, min(total_after) if total_after else page.height)
                line_words = [
                    word for word in words
                    if float(word["x0"]) < 65 and abs(float(word["top"]) - float(code_word["top"])) < 2
                    and str(word["text"]).isdigit()
                ]
                if not line_words:
                    contract.review_exceptions.append(
                        f"page {page_number}: item {code_word['text']} has no line number"
                    )
                    continue
                line_number = str(line_words[0]["text"])
                code = str(code_word["text"]).upper()
                quantity_candidates = [
                    (word, re.fullmatch(r"(.*?)([\d,]+\.\d+)", str(word["text"])))
                    for word in words
                    if 220 <= float(word["x0"]) < 376
                    and abs(float(word["top"]) - float(code_word["top"])) < 2
                ]
                quantity_candidates = [
                    (word, match) for word, match in quantity_candidates if match
                ]
                quantity_candidates.sort(key=lambda pair: float(pair[0]["x0"]))
                quantity_word, quantity_match = (
                    quantity_candidates[-1] if quantity_candidates else (None, None)
                )
                quantity_text = quantity_match.group(2) if quantity_match else ""
                quantity_x = float(quantity_word["x0"]) if quantity_word else 300
                description = words_text(words, 110, quantity_x - 2, top, bottom)
                if quantity_match and quantity_match.group(1):
                    description = f"{description}{quantity_match.group(1)}"
                unit = words_text(
                    words,
                    float(quantity_word["x1"]) + 4 if quantity_word else 376,
                    410,
                    top,
                    min(bottom, float(code_word["top"]) + 5),
                )
                try:
                    quantity = decimal_value(quantity_text)
                except InvalidOperation:
                    contract.review_exceptions.append(
                        f"page {page_number} line {line_number}: malformed quantity {quantity_text!r}"
                    )
                    continue
                item_key = line_number
                item = {
                    "line_number": line_number,
                    "source_item_code": code,
                    "description_raw": description,
                    "quantity": quantity,
                    "unit_raw": unit,
                    "source_page": page_number,
                }
                previous = contract.items.get(item_key)
                if previous and (
                    previous["source_item_code"] != code
                    or previous["quantity"] != quantity
                    or previous["unit_raw"] != unit
                ):
                    contract.review_exceptions.append(
                        f"page {page_number} line {line_number}: inconsistent repeated schedule row"
                    )
                    continue
                contract.items.setdefault(item_key, item)

                for bidder_index, name in enumerate(names):
                    x_min, x_max = ((400, 557), (557, 760))[bidder_index]
                    values = money_cells(words, top, bottom, x_min, x_max)
                    if not values:
                        continue
                    if len(values) != 2:
                        contract.review_exceptions.append(
                            f"page {page_number} line {line_number} bidder {name}: expected unit/extension pair; found {len(values)} values"
                        )
                        continue
                    price_row = {
                        "line_number": line_number,
                        "bidder_name": name,
                        "unit_price": values[0],
                        "extended_price": values[1],
                        "source_page": page_number,
                    }
                    duplicate = any(
                        existing["line_number"] == price_row["line_number"]
                        and existing["bidder_name"] == price_row["bidder_name"]
                        and existing["unit_price"] == price_row["unit_price"]
                        and existing["extended_price"] == price_row["extended_price"]
                        and existing["source_page"] == price_row["source_page"]
                        for existing in contract.prices
                    )
                    if not duplicate:
                        contract.prices.append(price_row)

            for total_top in total_tops:
                for bidder_index, name in enumerate(names):
                    x_min, x_max = ((400, 557), (557, 760))[bidder_index]
                    totals = money_cells(words, total_top - 1, total_top + 18, x_min, x_max)
                    if totals:
                        contract.bidders[name]["bid_total"] = totals[-1]
                        contract.bidders[name]["source_page"] = page_number

    for item_number, contract in contracts.items():
        missing_totals = [
            name for name, bidder in contract.bidders.items() if bidder["bid_total"] is None
        ]
        if missing_totals:
            contract.review_exceptions.append(
                f"item {item_number}: missing bid total for {', '.join(missing_totals)}"
            )
    return contracts


def strip_final_headers(text: str) -> str:
    ignored = (
        "STATE OF SOUTH DAKOTA",
        "DEPARTMENT OF TRANSPORTATION",
        "ON THE PROPOSALS RECEIVED ON ",
        "TRANSPORTATION COMMISION AND REQUIRED ENTITIES:",
    )
    lines = []
    for line in text.splitlines():
        cleaned = clean(line)
        if not cleaned or cleaned.startswith(ignored):
            continue
        if re.match(r"^\d{2}/\d{2}/\d{4} .* Page \d+ of \d+ HC65-", cleaned):
            continue
        lines.append(cleaned)
    return "\n".join(lines)


def parse_final_pdf(path: Path) -> dict[str, dict[str, object]]:
    with pdfplumber.open(path) as pdf:
        text = "\n".join(page.extract_text(x_tolerance=2, y_tolerance=2) or "" for page in pdf.pages)
    text = strip_final_headers(text)
    heading_matches = list(re.finditer(r"^---\s*(.*?)\s*---$", text, re.MULTILINE))
    records: dict[str, dict[str, object]] = {}
    for index, heading in enumerate(heading_matches):
        start = heading.end()
        end = heading_matches[index + 1].start() if index + 1 < len(heading_matches) else len(text)
        block = text[start:end].strip()
        item_match = re.search(r"^(?:[*<>#\s]+)?(\d+)/\s*(.+)$", block, re.MULTILINE)
        if not item_match:
            continue
        item_number = item_match.group(1)
        header = clean(item_match.group(2))
        project_number = ""
        pcn = ""
        county = ""
        if " PCN:" in header:
            project_number, remainder = header.split(" PCN:", 1)
            if " COUNTIES:" in remainder:
                pcn, county = remainder.split(" COUNTIES:", 1)
            else:
                pcn = remainder
        normalized = clean(block).lower()
        money_lines = [
            clean(line) for line in block.splitlines()
            if re.search(r"\$[\d,]+\.\d{2}", line)
        ]
        status = "AWARDED"
        for phrase, mapped in FINAL_STATUSES.items():
            if phrase in normalized:
                status = mapped
                break
        if status == "AWARDED" and "moved to" in normalized and not money_lines:
            status = "CANCELLED"
        vendor = ""
        amount: Decimal | None = None
        if status == "AWARDED":
            for line in money_lines:
                match = re.match(r"(.+?)\s+\$([\d,]+\.\d{2})", line)
                if match:
                    vendor = clean(match.group(1))
                    amount = decimal_value(match.group(2))
                    break
            if not vendor or amount is None:
                status = "UNRESOLVED"
        records[item_number] = {
            "item_number": item_number,
            "work_type": clean(heading.group(1)),
            "project_number": clean(project_number),
            "pcn": clean(pcn),
            "county": clean(county),
            "letting_status": status,
            "awarded_vendor": vendor,
            "awarded_amount": amount,
            "raw_block": clean(block),
        }
    return records


def normalized_vendor(value: str) -> tuple[str, ...]:
    expanded = value.upper()
    expanded = re.sub(r"\b([A-Z])\.([A-Z])\.", r"\1\2", expanded)
    expanded = re.sub(r"\bCONSTR?\.?\b", "CONSTRUCTION", expanded)
    words = re.findall(r"[A-Z0-9]+", expanded)
    ignored = {
        "INC", "INCORPORATED", "LLC", "LC", "L", "C", "CO", "COMPANY", "CORP",
        "CORPORATION", "THE", "DBA", "D", "B", "A", "JV", "JOINT", "VENTURE",
    }
    return tuple(sorted(word for word in words if word not in ignored))


def vendor_matches(award_name: str, bidder_name: str) -> bool:
    award = normalized_vendor(award_name)
    bidder = normalized_vendor(bidder_name)
    return bool(award and bidder) and (award == bidder or set(award).issubset(set(bidder)))


def is_no_bid_placeholder(value: str) -> bool:
    return bool(re.fullmatch(r"NO BIDS? RECEIVED", clean(value).upper()))


def load_award_overrides(path: Path) -> dict[tuple[str, str], str]:
    if not path.exists():
        return {}
    with path.open(newline="", encoding="utf-8-sig") as source:
        return {
            (row["letting_date"].strip(), row["item_number"].strip()): row["bidder_name"].strip()
            for row in csv.DictReader(source)
            if row.get("letting_date") and row.get("item_number") and row.get("bidder_name")
        }


def split_identifiers(value: str) -> list[str]:
    return [clean(part) for part in value.split(",") if clean(part)]


def build_projects(
    contract_key: str,
    project_numbers_text: str,
    pcn_text: str,
    work_type: str,
    county: str,
    location: str,
    review_exceptions: list[dict[str, str]],
) -> list[dict[str, object]]:
    project_numbers = split_identifiers(project_numbers_text)
    pcns = split_identifiers(pcn_text)
    if not project_numbers and not pcns:
        return [{
            "contract_project_id": f"{contract_key}_project_001",
            "contract_id": contract_key,
            "project_number": "",
            "project_control_number": "",
            "project_name": work_type,
            "work_type": work_type,
            "county_region": county,
            "route": "",
            "location": location,
            "project_award_amount": "",
        }]
    if project_numbers and pcns and len(project_numbers) != len(pcns):
        review_exceptions.append({
            "contract_id": contract_key,
            "category": "project_pcn_cardinality",
            "details": f"Project No. values {project_numbers_text!r} do not align with PCN values {pcn_text!r}.",
        })
        project_numbers = [project_numbers_text]
        pcns = [pcn_text]
    count = max(len(project_numbers), len(pcns))
    return [
        {
            "contract_project_id": f"{contract_key}_project_{index + 1:03d}",
            "contract_id": contract_key,
            "project_number": project_numbers[index] if index < len(project_numbers) else "",
            "project_control_number": pcns[index] if index < len(pcns) else "",
            "project_name": work_type,
            "work_type": work_type,
            "county_region": county,
            "route": "",
            "location": location,
            "project_award_amount": "",
        }
        for index in range(count)
    ]


def promote_letting(
    entry: dict[str, str],
    abstract_contracts: dict[str, AbstractContract],
    final_records: dict[str, dict[str, object]],
    catalog_codes: set[str],
    historical_codes: set[str],
    overrides: dict[tuple[str, str], str],
) -> dict[str, list[dict[str, object]]]:
    output: dict[str, list[dict[str, object]]] = {
        "contracts": [],
        "projects": [],
        "bids": [],
        "contract_items": [],
        "bid_item_prices": [],
        "observations": [],
        "review_exceptions": [],
    }
    item_numbers = sorted(
        set(abstract_contracts) | set(final_records),
        key=lambda value: int(value),
    )
    for item_number in item_numbers:
        abstract = abstract_contracts.get(item_number)
        final = final_records.get(item_number, {})
        key = contract_id(entry["letting_date"], item_number)
        work_type = str(final.get("work_type") or (abstract.work_type if abstract else ""))
        abstract_project_number = abstract.project_number if abstract else ""
        final_project_number = str(final.get("project_number", ""))
        project_number = max(
            (abstract_project_number, final_project_number),
            key=lambda value: len(split_identifiers(value)),
        )
        abstract_pcn = abstract.pcn if abstract else ""
        final_pcn = str(final.get("pcn", ""))
        pcn = max(
            (abstract_pcn, final_pcn),
            key=lambda value: len(split_identifiers(value)),
        )
        county = abstract.county if abstract else str(final.get("county", ""))
        location = abstract.location if abstract else ""
        status = str(final.get("letting_status", "UNRESOLVED"))
        awarded_vendor = str(final.get("awarded_vendor", ""))
        awarded_amount = final.get("awarded_amount")

        bidder_rows: list[dict[str, object]] = []
        bidder_id_by_name: dict[str, str] = {}
        awarded_name = ""
        if abstract:
            if (
                status == "UNRESOLVED"
                and abstract.bidders
                and all(is_no_bid_placeholder(name) for name in abstract.bidders)
            ):
                status = "NO BIDS"
            ranked = sorted(
                [
                    bidder for bidder in abstract.bidders.values()
                    if (
                        isinstance(bidder.get("bid_total"), Decimal)
                        and not is_no_bid_placeholder(str(bidder.get("bidder_name", "")))
                    )
                ],
                key=lambda bidder: (bidder["bid_total"], str(bidder["bidder_name"]).upper()),
            )
            if status == "AWARDED":
                override_name = overrides.get((entry["letting_date"], item_number), "")
                vendor_candidates = [
                    bidder for bidder in ranked
                    if (
                        override_name and str(bidder["bidder_name"]) == override_name
                    ) or (
                        not override_name
                        and vendor_matches(awarded_vendor, str(bidder["bidder_name"]))
                    )
                ]
                amount_candidates = [
                    bidder for bidder in vendor_candidates
                    if isinstance(awarded_amount, Decimal)
                    and abs(bidder["bid_total"] - awarded_amount) <= Decimal("0.02")
                ]
                if len(amount_candidates) == 1:
                    awarded_name = str(amount_candidates[0]["bidder_name"])
                elif len(vendor_candidates) == 1:
                    awarded_name = str(vendor_candidates[0]["bidder_name"])
                    output["review_exceptions"].append({
                        "contract_id": key,
                        "category": "award_amount_difference",
                        "details": (
                            f"Final award {decimal_text(awarded_amount, 2)} resolves uniquely by vendor "
                            f"to abstract bid {decimal_text(vendor_candidates[0]['bid_total'], 2)} "
                            f"for {awarded_name}."
                        ),
                    })
                else:
                    output["review_exceptions"].append({
                        "contract_id": key,
                        "category": "award_resolution",
                        "details": (
                            f"Could not uniquely resolve {awarded_vendor!r} / "
                            f"{decimal_text(awarded_amount, 2)!r}; "
                            f"vendor_candidates={len(vendor_candidates)}, "
                            f"amount_candidates={len(amount_candidates)}."
                        ),
                    })
            low_total = ranked[0]["bid_total"] if ranked else None
            for rank, bidder in enumerate(ranked, start=1):
                bid_id = f"{key}_bid_{rank:03d}"
                name = str(bidder["bidder_name"])
                bidder_id_by_name[name] = bid_id
                bidder_rows.append({
                    "bid_id": bid_id,
                    "contract_id": key,
                    "source_id": entry["source_id"],
                    "source_vendor_id": "",
                    "bidder_name": name,
                    "bid_rank": rank,
                    "bid_total": decimal_text(bidder["bid_total"], 2),
                    "percent_of_low": "",
                    "is_apparent_low": str(rank == 1).lower(),
                    "is_awarded": str(name == awarded_name).lower(),
                    "source_page": bidder["source_page"],
                })
            for exception in abstract.review_exceptions:
                output["review_exceptions"].append({
                    "contract_id": key,
                    "category": "abstract_parse",
                    "details": exception,
                })

        output["contracts"].append({
            "contract_id": key,
            "letting_id": entry["letting_id"],
            "source_id": entry["source_id"],
            "state": "SD",
            "agency_id": AGENCY_ID,
            "official_contract_id": "",
            "call_order": item_number,
            "letting_status": status,
            "awarded_vendor": awarded_vendor,
            "awarded_amount": decimal_text(awarded_amount, 2),
            "primary_county": county,
            "route": "",
            "work_type": work_type,
            "contract_period": "",
            "dbe_goal": "",
            "bid_count": len(bidder_rows) if bidder_rows else "",
            "location": location,
            "district": "",
            "terrain": "",
            "award_index": "",
        })
        output["projects"].extend(build_projects(
            key, project_number, pcn, work_type, county, location, output["review_exceptions"]
        ))
        output["bids"].extend(bidder_rows)

        if not abstract:
            continue
        contract_price_rows: list[dict[str, object]] = []
        prices_by_line: defaultdict[str, list[dict[str, object]]] = defaultdict(list)
        for price in abstract.prices:
            prices_by_line[str(price["line_number"])].append(price)
        for line_number, item in sorted(abstract.items.items(), key=lambda pair: int(pair[0])):
            code = str(item["source_item_code"]).upper()
            description = str(item["description_raw"])
            is_source_deleted = (
                description.lower() == "deleted item"
                or normalize_unit(str(item["unit_raw"])) == "DEL"
            )
            if is_source_deleted:
                mapped_id = ""
                mapping_status = "source_deleted"
            elif code in catalog_codes:
                mapped_id = agency_item_id(code)
                mapping_status = "direct"
            elif code in historical_codes:
                mapped_id = agency_item_id(code)
                mapping_status = "historical"
            else:
                mapped_id = ""
                mapping_status = "unmatched"
            contract_item_key = f"{key}_line_{int(line_number):04d}"
            quantity = item["quantity"]
            output["contract_items"].append({
                "contract_item_id": contract_item_key,
                "contract_id": key,
                "source_id": entry["source_id"],
                "section_number": "",
                "section_title": "",
                "line_number": line_number,
                "source_item_code": code,
                "agency_item_id": mapped_id,
                "description_raw": description,
                "quantity": decimal_text(quantity, 3),
                "unit_raw": item["unit_raw"],
                "unit_normalized": normalize_unit(str(item["unit_raw"])),
                "alternate_set": "",
                "alternate_member": "",
                "mapping_status": mapping_status,
                "source_page": item["source_page"],
                "source_locator": (
                    f"{entry['abstract_file_name']}#page={item['source_page']};"
                    f"item={item_number};line={line_number}"
                ),
            })
            promoted_prices = []
            for price in prices_by_line[line_number]:
                bid_id = bidder_id_by_name.get(str(price["bidder_name"]))
                if not bid_id:
                    continue
                price_row = {
                    "bid_item_price_id": f"{contract_item_key}_{bid_id.rsplit('_', 1)[-1]}",
                    "contract_item_id": contract_item_key,
                    "bid_id": bid_id,
                    "contract_id": key,
                    "source_id": entry["source_id"],
                    "unit_price": decimal_text(price["unit_price"], 2),
                    "extended_price": decimal_text(price["extended_price"], 2),
                    "source_page": price["source_page"],
                    "source_locator": (
                        f"{entry['abstract_file_name']}#page={price['source_page']};"
                        f"item={item_number};line={line_number};bidder={slug(str(price['bidder_name']))}"
                    ),
                }
                output["bid_item_prices"].append(price_row)
                contract_price_rows.append(price_row)
                promoted_prices.append((price, bid_id))
                extension_difference = (
                    quantity * price["unit_price"] - price["extended_price"]
                )
                if abs(extension_difference) > Decimal("0.02"):
                    output["review_exceptions"].append({
                        "contract_id": key,
                        "category": "line_extension_difference",
                        "details": (
                            f"{price_row['bid_item_price_id']} preserves printed quantity "
                            f"{decimal_text(quantity, 3)}, unit price "
                            f"{decimal_text(price['unit_price'], 2)}, and extension "
                            f"{decimal_text(price['extended_price'], 2)}; "
                            f"difference={decimal_text(extension_difference, 2)}."
                        ),
                    })
            if not mapped_id or status != "AWARDED" or not awarded_name:
                continue
            awarded_prices = [
                price for price, bid_id in promoted_prices
                if next((bid for bid in bidder_rows if bid["bid_id"] == bid_id), {}).get("is_awarded") == "true"
            ]
            if len(awarded_prices) != 1:
                continue
            awarded_price = awarded_prices[0]
            output["observations"].append({
                "observation_id": f"{contract_item_key}_awarded",
                "contract_id": key,
                "source_id": entry["source_id"],
                "agency_item_id": mapped_id,
                "agency_item_code": code,
                "description_raw": description,
                "description_normalized": normalize_description(description),
                "unit_raw": item["unit_raw"],
                "unit_normalized": normalize_unit(str(item["unit_raw"])),
                "quantity": decimal_text(quantity, 3),
                "unit_price": decimal_text(awarded_price["unit_price"], 2),
                "extended_price": decimal_text(awarded_price["extended_price"], 2),
                "discipline": "Roadway",
                "price_type": "awarded_bid",
                "date_basis": entry["letting_date"],
                "derivation_method": "explicit_final_award_vendor",
                "derivation_input_count": "1",
            })
            valid_prices = [price for price, _ in promoted_prices]
            if valid_prices:
                mean = sum((price["unit_price"] for price in valid_prices), Decimal()) / len(valid_prices)
                output["observations"].append({
                    "observation_id": f"{contract_item_key}_average",
                    "contract_id": key,
                    "source_id": entry["source_id"],
                    "agency_item_id": mapped_id,
                    "agency_item_code": code,
                    "description_raw": description,
                    "description_normalized": normalize_description(description),
                    "unit_raw": item["unit_raw"],
                    "unit_normalized": normalize_unit(str(item["unit_raw"])),
                    "quantity": decimal_text(quantity, 3),
                    "unit_price": decimal_text(mean, 5),
                    "extended_price": decimal_text(mean * quantity, 2),
                    "discipline": "Roadway",
                    "price_type": "average_bid",
                    "date_basis": entry["letting_date"],
                    "derivation_method": "unweighted_bidder_mean",
                    "derivation_input_count": str(len(valid_prices)),
                })
        for bid in bidder_rows:
            bid_prices = [
                row for row in contract_price_rows if row["bid_id"] == bid["bid_id"]
            ]
            item_total = sum(
                (Decimal(str(row["extended_price"])) for row in bid_prices),
                Decimal(),
            )
            reported_total = Decimal(str(bid["bid_total"]))
            difference = item_total - reported_total
            tolerance = Decimal("0.01") * max(len(bid_prices), 2)
            if abs(difference) > tolerance:
                output["review_exceptions"].append({
                    "contract_id": key,
                    "category": "bid_total_difference",
                    "details": (
                        f"{bid['bid_id']} preserves printed item total "
                        f"{decimal_text(item_total, 2)} and reported bid total "
                        f"{decimal_text(reported_total, 2)}; "
                        f"difference={decimal_text(difference, 2)}."
                    ),
                })
    return output


def division_for_group(group_code: str) -> tuple[str, str]:
    number = int(group_code)
    if number <= 9:
        return "I", "General Provisions"
    if number < 750:
        return "II", "Construction Details"
    return "III", "Material Requirements"


def build_catalog_tables(
    catalog: list[dict[str, str]],
    groups: list[dict[str, str]],
    catalog_source_id: str,
    catalog_date: str,
    historical: dict[str, dict[str, str]],
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    items: list[dict[str, object]] = []
    versions: list[dict[str, object]] = []
    current_by_code = {
        row["item_code"]: row for row in catalog if row["is_deleted"] != "true"
    }
    for code, row in sorted(current_by_code.items()):
        item_key = agency_item_id(code)
        version_id = f"{item_key}_v{compact_date(catalog_date)}"
        items.append({
            "agency_item_id": item_key,
            "state": "SD",
            "agency_id": AGENCY_ID,
            "agency_name": AGENCY_NAME,
            "item_code": code,
            "current_version_id": version_id,
            "item_status": "current",
            "canonical_item_id": "",
        })
        versions.append({
            "agency_item_version_id": version_id,
            "agency_item_id": item_key,
            "effective_from": catalog_date,
            "effective_to": "",
            "official_description": row["official_description"],
            "official_abbreviated_description": row["official_description"],
            "official_unit": normalize_unit(row["official_unit"]),
            "spec_reference_code": code[:3],
            "source_id": catalog_source_id,
            "is_current": "true",
        })
    for code, row in sorted(historical.items()):
        if code in current_by_code:
            continue
        item_key = agency_item_id(code)
        version_id = f"{item_key}_historical"
        items.append({
            "agency_item_id": item_key,
            "state": "SD",
            "agency_id": AGENCY_ID,
            "agency_name": AGENCY_NAME,
            "item_code": code,
            "current_version_id": version_id,
            "item_status": "historical",
            "canonical_item_id": "",
        })
        versions.append({
            "agency_item_version_id": version_id,
            "agency_item_id": item_key,
            "effective_from": "",
            "effective_to": "",
            "official_description": row["description_raw"],
            "official_abbreviated_description": row["description_raw"],
            "official_unit": normalize_unit(row["unit_raw"]),
            "spec_reference_code": code[:3],
            "source_id": row["source_id"],
            "is_current": "false",
        })
    taxonomy: list[dict[str, object]] = []
    for division_code, title in (
        ("I", "General Provisions"),
        ("II", "Construction Details"),
        ("III", "Material Requirements"),
    ):
        taxonomy.append({
            "taxonomy_id": f"sd_sddot_div_{division_code.lower()}",
            "state": "SD",
            "agency_id": AGENCY_ID,
            "taxonomy_level": "division",
            "taxonomy_code": division_code,
            "parent_taxonomy_id": "",
            "taxonomy_label": f"Division {division_code} - {title}",
            "match_prefix": division_code,
            "source_year": "2025",
            "source_url": SPEC_BOOK_URL,
        })
    for group in groups:
        code = group["group_code"]
        division_code, _ = division_for_group(code)
        taxonomy.append({
            "taxonomy_id": f"sd_sddot_sec_{code}",
            "state": "SD",
            "agency_id": AGENCY_ID,
            "taxonomy_level": "section",
            "taxonomy_code": code,
            "parent_taxonomy_id": f"sd_sddot_div_{division_code.lower()}",
            "taxonomy_label": group["group_label"],
            "match_prefix": code,
            "source_year": str(catalog_date[:4]),
            "source_url": ITEM_CATALOG_URL,
        })
    return items, versions, taxonomy


def parse_annual_price_report(path: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    current: dict[str, str] | None = None
    pattern = re.compile(
        r"^(\d{3}E\d{4})\s+(.+?)\s+(\S+)\s+"
        r"([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+"
        r"([\d,]+\.\d{2})\s+(\d+)$",
        re.IGNORECASE,
    )
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages[3:], start=4):
            for line in (page.extract_text(x_tolerance=2, y_tolerance=2) or "").splitlines():
                line = clean(line)
                match = pattern.match(line)
                if match:
                    current = {
                        "item_code": match.group(1).upper(),
                        "description": match.group(2),
                        "unit": match.group(3),
                        "total_quantity": decimal_text(decimal_value(match.group(4)), 2),
                        "total_cost": decimal_text(decimal_value(match.group(5)), 2),
                        "average_low_bid_price": decimal_text(decimal_value(match.group(6)), 2),
                        "average_three_lowest_bids": decimal_text(decimal_value(match.group(7)), 2),
                        "bid_count": match.group(8),
                        "source_page": str(page_number),
                    }
                    rows.append(current)
                elif (
                    current
                    and line
                    and not line.startswith(("South Dakota", "2024 Average", "Item ", "Number ", "03/"))
                    and not ITEM_CODE_PATTERN.match(line)
                ):
                    current["description"] = clean(f"{current['description']} {line}")
    if len(rows) < 1400:
        raise ValueError(f"Expected at least 1,400 annual price rows; parsed {len(rows):,}.")
    return rows


def build_annual_reconciliation(
    annual_rows: list[dict[str, str]],
    catalog_by_code: dict[str, dict[str, str]],
    contracts: list[dict[str, object]],
    contract_items: list[dict[str, object]],
    bids: list[dict[str, object]],
    prices: list[dict[str, object]],
) -> list[dict[str, object]]:
    contract_by_id = {str(row["contract_id"]): row for row in contracts}
    awarded_bid_ids = {
        str(row["bid_id"]) for row in bids if str(row["is_awarded"]).lower() == "true"
    }
    item_by_id = {str(row["contract_item_id"]): row for row in contract_items}
    quantity_by_code: defaultdict[str, Decimal] = defaultdict(Decimal)
    total_by_code: defaultdict[str, Decimal] = defaultdict(Decimal)
    for price in prices:
        if str(price["bid_id"]) not in awarded_bid_ids:
            continue
        item = item_by_id.get(str(price["contract_item_id"]))
        if not item:
            continue
        contract = contract_by_id.get(str(item["contract_id"]))
        if not contract or not str(contract["contract_id"]).startswith("sd_sddot_2024"):
            continue
        code = str(item["source_item_code"])
        quantity_by_code[code] += Decimal(str(item["quantity"]))
        total_by_code[code] += Decimal(str(price["extended_price"]))
    reconciled = []
    for row in annual_rows:
        code = row["item_code"]
        catalog = catalog_by_code.get(code, {})
        imported_quantity = quantity_by_code.get(code, Decimal())
        imported_total = total_by_code.get(code, Decimal())
        imported_average = imported_total / imported_quantity if imported_quantity else Decimal()
        reconciled.append({
            **row,
            "catalog_description": catalog.get("official_description", ""),
            "catalog_unit": catalog.get("official_unit", ""),
            "catalog_code_match": str(bool(catalog)).lower(),
            "catalog_unit_match": str(
                bool(catalog) and normalize_unit(catalog.get("official_unit", "")) == normalize_unit(row["unit"])
            ).lower(),
            "imported_awarded_quantity": decimal_text(imported_quantity, 2),
            "imported_awarded_total": decimal_text(imported_total, 2),
            "imported_weighted_average": decimal_text(imported_average, 2),
            "quantity_difference": decimal_text(imported_quantity - Decimal(row["total_quantity"]), 2),
            "total_cost_difference": decimal_text(imported_total - Decimal(row["total_cost"]), 2),
            "average_low_difference": decimal_text(
                imported_average - Decimal(row["average_low_bid_price"]), 2
            ),
        })
    return reconciled


def sorted_rows(rows: list[dict[str, object]], *keys: str) -> list[dict[str, object]]:
    return sorted(rows, key=lambda row: tuple(str(row.get(key, "")) for key in keys))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import SDDOT standard bid items and completed letting reports into schema-v2 CSVs."
    )
    parser.add_argument("--start-date", default="2019-01-01")
    parser.add_argument("--through-date", default=date.today().isoformat())
    parser.add_argument("--catalog-date", default=date.today().isoformat())
    parser.add_argument("--refresh-item-catalog", action="store_true")
    parser.add_argument("--refresh-archive-index", action="store_true")
    parser.add_argument("--download-missing-reports", action="store_true")
    parser.add_argument("--refresh-reports", action="store_true")
    parser.add_argument("--refresh-annual-report", action="store_true")
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/sd"))
    parser.add_argument("--staging-dir", type=Path, default=Path("data/staging/sd"))
    parser.add_argument("--output-dir", type=Path, default=Path("public/data/states/sd"))
    parser.add_argument(
        "--award-overrides",
        type=Path,
        default=Path("data/overrides/sd/award_matches.csv"),
    )
    args = parser.parse_args()

    catalog, groups, catalog_path = submit_item_catalog(
        args.raw_dir,
        refresh=args.refresh_item_catalog,
    )
    catalog_source_id = f"sd_sddot_item_catalog_{args.catalog_date.replace('-', '_')}"
    current_catalog = {
        row["item_code"]: row for row in catalog if row["is_deleted"] != "true"
    }
    entries = discover_lettings(
        args.raw_dir,
        args.start_date,
        args.through_date,
        refresh=args.refresh_archive_index,
    )
    if not entries:
        raise ValueError("No SDDOT completed lettings were discovered in the requested date range.")

    overrides = load_award_overrides(args.award_overrides)
    parsed_entries: list[dict[str, str]] = []
    historical_latest: dict[str, dict[str, str]] = {}
    data: dict[str, list[dict[str, object]]] = {
        "contracts": [],
        "projects": [],
        "bids": [],
        "contract_items": [],
        "bid_item_prices": [],
        "observations": [],
        "review_exceptions": [],
    }

    def process_entry(
        entry: dict[str, str],
    ) -> tuple[dict[str, str], dict[str, AbstractContract], dict[str, dict[str, object]]] | None:
        try:
            resolve_report_links(entry, args.raw_dir, refresh=args.refresh_archive_index)
            report_dir = args.raw_dir / "bid_tabs" / compact_date(entry["letting_date"])
            abstract_path = report_dir / entry["abstract_file_name"]
            final_path = report_dir / entry["final_file_name"]
            if args.download_missing_reports or args.refresh_reports:
                abstract_path, final_path = download_reports(
                    entry,
                    args.raw_dir,
                    refresh=args.refresh_reports,
                )
            elif not abstract_path.exists() or not final_path.exists():
                entry["parse_status"] = "missing_cached_reports"
                entry["notes"] = "Run with --download-missing-reports."
                return None
            else:
                entry["abstract_sha256"] = sha256(abstract_path)
                entry["final_sha256"] = sha256(final_path)
            abstract = parse_abstract_pdf(abstract_path, expected_letting_date=entry["letting_date"])
            final = parse_final_pdf(final_path)
            if not abstract and not final:
                raise ValueError("neither report produced a contract record")
            entry["parse_status"] = "parsed"
            print(
                f"parsed {entry['letting_date']}: "
                f"{len(abstract)} abstract contracts, {len(final)} final records",
                flush=True,
            )
            return entry, abstract, final
        except (OSError, ValueError, urllib.error.URLError) as error:
            entry["parse_status"] = "parse_error"
            entry["notes"] = clean(str(error))
            print(f"failed {entry['letting_date']}: {entry['notes']}", flush=True)
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        futures = [executor.submit(process_entry, entry) for entry in entries]
        for future in concurrent.futures.as_completed(futures):
            parsed = future.result()
            if not parsed:
                continue
            entry, abstracts, final = parsed
            parsed_entries.append(entry)
            letting_historical_codes: set[str] = set()
            for abstract in abstracts.values():
                for item in abstract.items.values():
                    code = str(item["source_item_code"]).upper()
                    description = str(item["description_raw"])
                    unit = str(item["unit_raw"])
                    if (
                        code not in current_catalog
                        and description.lower() != "deleted item"
                        and normalize_unit(unit) != "DEL"
                    ):
                        letting_historical_codes.add(code)
                        previous = historical_latest.get(code)
                        if not previous or entry["letting_date"] > previous["letting_date"]:
                            historical_latest[code] = {
                                "description_raw": description,
                                "unit_raw": unit,
                                "source_id": entry["source_id"],
                                "letting_date": entry["letting_date"],
                            }
            promoted = promote_letting(
                entry,
                abstracts,
                final,
                set(current_catalog),
                letting_historical_codes,
                overrides,
            )
            for key in data:
                data[key].extend(promoted[key])

    for entry in parsed_entries:
        entry["parse_status"] = "parsed"

    for entry in entries:
        if entry["parse_status"] == "discovered":
            entry["parse_status"] = "parse_error"
            entry["notes"] = "Importer completed without processing this inventory row."

    for entry in parsed_entries:
        if entry["letting_date"] > args.through_date:
            raise ValueError(f"Parsed letting {entry['letting_date']} exceeds requested through date.")

    for code, historical in historical_latest.items():
        if historical["letting_date"] < args.start_date:
            raise ValueError(f"Historical item {code} came from a letting before the requested start date.")

    for entry in parsed_entries:
        if not entry["abstract_sha256"] or not entry["final_sha256"]:
            raise ValueError(f"Parsed letting {entry['letting_date']} is missing report hashes.")

    for entry in parsed_entries:
        if not entry["abstract_url"] or not entry["final_url"]:
            raise ValueError(f"Parsed letting {entry['letting_date']} is missing report URLs.")

    for entry in parsed_entries:
        if entry["source_id"] != source_id(entry["letting_date"]):
            raise ValueError(f"Parsed letting {entry['letting_date']} has an unstable source ID.")

    for entry in parsed_entries:
        if entry["letting_id"] != letting_id(entry["letting_date"]):
            raise ValueError(f"Parsed letting {entry['letting_date']} has an unstable letting ID.")

    for entry in parsed_entries:
        if entry["parse_status"] != "parsed":
            raise ValueError(f"Parsed letting {entry['letting_date']} does not have parsed status.")

    for entry in parsed_entries:
        if entry["notes"]:
            entry["notes"] = clean(entry["notes"])

    for entry in entries:
        if entry["parse_status"] != "parsed" and not entry["notes"]:
            entry["notes"] = "Not parsed; see source report availability."

    for entry in entries:
        if entry["parse_status"] == "parsed" and entry not in parsed_entries:
            raise ValueError(f"Inventory row {entry['letting_date']} is marked parsed without normalized data.")

    for entry in parsed_entries:
        if entry not in entries:
            raise ValueError(f"Parsed letting {entry['letting_date']} is absent from the archive inventory.")

    for entry in entries:
        if entry["parse_status"] == "parsed" and not any(
            str(contract["letting_id"]) == entry["letting_id"] for contract in data["contracts"]
        ):
            raise ValueError(f"Parsed letting {entry['letting_date']} produced no contracts.")

    for entry in parsed_entries:
        if not any(str(contract["source_id"]) == entry["source_id"] for contract in data["contracts"]):
            raise ValueError(f"Parsed letting {entry['letting_date']} produced no source-linked contracts.")

    for code in list(historical_latest):
        if code in current_catalog:
            del historical_latest[code]

    agency_items, agency_versions, taxonomy = build_catalog_tables(
        catalog,
        groups,
        catalog_source_id,
        args.catalog_date,
        historical_latest,
    )
    sources: list[dict[str, object]] = [{
        "source_id": catalog_source_id,
        "source_type": "item_catalog",
        "agency_id": AGENCY_ID,
        "agency_name": AGENCY_NAME,
        "state": "SD",
        "source_label": f"SDDOT Standard Bid Items {args.catalog_date}",
        "source_date": args.catalog_date,
        "data_year": args.catalog_date[:4],
        "source_url": ITEM_CATALOG_URL,
        "source_file_name": catalog_path.name,
        "sha256": sha256(catalog_path),
        "parser_name": "import_south_dakota_data.py",
        "parser_version": PARSER_VERSION,
        "notes": "Live all-items result from the SDDOT Standard Bid Item search.",
    }]
    source_documents: list[dict[str, object]] = [{
        "source_document_id": f"{catalog_source_id}_snapshot",
        "source_id": catalog_source_id,
        "document_role": "item_catalog_snapshot",
        "source_url": ITEM_CATALOG_URL,
        "source_file_name": catalog_path.name,
        "sha256": sha256(catalog_path),
        "media_type": "text/html",
        "published_on": args.catalog_date,
        "retrieved_on": args.catalog_date,
        "notes": "All-SBI search result snapshot.",
    }]
    lettings: list[dict[str, object]] = []
    for entry in parsed_entries:
        bundle_hash = hashlib.sha256(
            f"{entry['abstract_sha256']}:{entry['final_sha256']}".encode("ascii")
        ).hexdigest()
        sources.append({
            "source_id": entry["source_id"],
            "source_type": "bid_tab",
            "agency_id": AGENCY_ID,
            "agency_name": AGENCY_NAME,
            "state": "SD",
            "source_label": f"SDDOT {entry['letting_date']} Completed Letting",
            "source_date": entry["letting_date"],
            "data_year": entry["letting_date"][:4],
            "source_url": entry["detail_url"],
            "source_file_name": entry["detail_file_name"],
            "sha256": bundle_hash,
            "parser_name": "import_south_dakota_data.py",
            "parser_version": PARSER_VERSION,
            "notes": "Bundle source containing the Abstract of Bids and Low Bid Final Report.",
        })
        lettings.append({
            "letting_id": entry["letting_id"],
            "source_id": entry["source_id"],
            "state": "SD",
            "agency_id": AGENCY_ID,
            "letting_date": entry["letting_date"],
            "letting_label": entry["label"],
        })
        for role in ("abstract", "final"):
            source_documents.append({
                "source_document_id": f"{entry['source_id']}_{role}",
                "source_id": entry["source_id"],
                "document_role": "bid_abstract" if role == "abstract" else "final_award_report",
                "source_url": entry[f"{role}_url"],
                "source_file_name": entry[f"{role}_file_name"],
                "sha256": entry[f"{role}_sha256"],
                "media_type": "application/pdf",
                "published_on": entry["letting_date"],
                "retrieved_on": args.catalog_date,
                "notes": "",
            })

    table_rows = {
        "sources.csv": sorted_rows(sources, "source_id"),
        "source_documents.csv": sorted_rows(source_documents, "source_document_id"),
        "lettings.csv": sorted_rows(lettings, "letting_date"),
        "contracts.csv": sorted_rows(data["contracts"], "contract_id"),
        "contract_projects.csv": sorted_rows(data["projects"], "contract_project_id"),
        "contract_items.csv": sorted_rows(data["contract_items"], "contract_item_id"),
        "bids.csv": sorted_rows(data["bids"], "bid_id"),
        "bid_item_prices.csv": sorted_rows(data["bid_item_prices"], "bid_item_price_id"),
        "agency_items.csv": sorted_rows(agency_items, "agency_item_id"),
        "agency_item_versions.csv": sorted_rows(agency_versions, "agency_item_version_id"),
        "item_taxonomy.csv": sorted_rows(taxonomy, "taxonomy_id"),
        "item_mappings.csv": [],
        "item_observations.csv": sorted_rows(data["observations"], "observation_id"),
    }
    field_map = {
        "sources.csv": SOURCE_FIELDS,
        "source_documents.csv": SOURCE_DOCUMENT_FIELDS,
        "lettings.csv": LETTING_FIELDS,
        "contracts.csv": CONTRACT_FIELDS,
        "contract_projects.csv": CONTRACT_PROJECT_FIELDS,
        "contract_items.csv": CONTRACT_ITEM_FIELDS,
        "bids.csv": BID_FIELDS,
        "bid_item_prices.csv": BID_PRICE_FIELDS,
        "agency_items.csv": AGENCY_ITEM_FIELDS,
        "agency_item_versions.csv": AGENCY_VERSION_FIELDS,
        "item_taxonomy.csv": TAXONOMY_FIELDS,
        "item_mappings.csv": MAPPING_FIELDS,
        "item_observations.csv": OBSERVATION_FIELDS,
    }
    for name, rows in table_rows.items():
        write_csv(args.output_dir / name, field_map[name], rows)

    write_csv(
        args.staging_dir / "item_catalog_native.csv",
        ["item_code_raw", "item_code", "official_description", "official_unit", "is_deleted"],
        catalog,
    )
    write_csv(
        args.staging_dir / "item_groups.csv",
        ["group_code", "group_label"],
        groups,
    )
    write_csv(
        args.staging_dir / "letting_inventory.csv",
        [
            "letting_date", "label", "detail_url", "source_id", "letting_id",
            "detail_file_name", "abstract_url", "abstract_file_name", "abstract_sha256",
            "final_url", "final_file_name", "final_sha256", "parse_status", "notes",
        ],
        entries,
    )
    write_csv(
        args.staging_dir / "review_exceptions.csv",
        ["contract_id", "category", "details"],
        sorted_rows(data["review_exceptions"], "contract_id", "category"),
    )
    for name in (
        "contracts.csv", "contract_projects.csv", "contract_items.csv",
        "bids.csv", "bid_item_prices.csv",
    ):
        write_csv(args.staging_dir / name, field_map[name], table_rows[name])

    annual_path = args.raw_dir / "2024-bid-item-price-report.pdf"
    if args.refresh_annual_report:
        fetch(ANNUAL_REPORT_URL, annual_path, refresh=True)
    if annual_path.exists():
        annual_rows = parse_annual_price_report(annual_path)
        write_csv(
            args.staging_dir / "annual_price_report_2024.csv",
            [
                "item_code", "description", "unit", "total_quantity", "total_cost",
                "average_low_bid_price", "average_three_lowest_bids", "bid_count", "source_page",
            ],
            annual_rows,
        )
        annual_reconciliation = build_annual_reconciliation(
            annual_rows,
            {row["item_code"]: row for row in catalog},
            data["contracts"],
            data["contract_items"],
            data["bids"],
            data["bid_item_prices"],
        )
        write_csv(
            args.staging_dir / "annual_price_reconciliation_2024.csv",
            [
                "item_code", "description", "unit", "total_quantity", "total_cost",
                "average_low_bid_price", "average_three_lowest_bids", "bid_count", "source_page",
                "catalog_description", "catalog_unit", "catalog_code_match", "catalog_unit_match",
                "imported_awarded_quantity", "imported_awarded_total", "imported_weighted_average",
                "quantity_difference", "total_cost_difference", "average_low_difference",
            ],
            annual_reconciliation,
        )

    summary = {
        "archive_entries": len(entries),
        "parsed_lettings": len(parsed_entries),
        "failed_lettings": sum(entry["parse_status"] != "parsed" for entry in entries),
        "catalog_rows": len(catalog),
        "catalog_deleted_placeholders": sum(row["is_deleted"] == "true" for row in catalog),
        "catalog_current_items": len(current_catalog),
        "historical_items": len(historical_latest),
        "item_groups": len(groups),
        "contracts": len(data["contracts"]),
        "contract_projects": len(data["projects"]),
        "bids": len(data["bids"]),
        "contract_items": len(data["contract_items"]),
        "bid_item_prices": len(data["bid_item_prices"]),
        "observations": len(data["observations"]),
        "review_exceptions": len(data["review_exceptions"]),
    }
    args.staging_dir.mkdir(parents=True, exist_ok=True)
    (args.staging_dir / "import_summary.json").write_text(
        json.dumps(summary, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
