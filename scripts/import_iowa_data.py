from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
import re
import statistics
import urllib.request
from collections import defaultdict
from datetime import date, datetime
from html import unescape
from pathlib import Path
from urllib.parse import urljoin

import pdfplumber


ITEM_MASTER_URL = "https://iowadot.gov/media/14945/download?inline="
ITEM_INFO_URL = "https://iowadot.gov/consultants-contractors/contracts/general-letting-information/bid-item-information"
BID_TABS_URL = "https://iowadot.gov/consultants-contractors/contracts/historical-completed-lettings/bid-tabulations"
ERL_URL = "https://ia.iowadot.gov/erl/current/GS/Navigation/nav.htm"
ITEM_CATALOG_SOURCE_ID = "ia_idot_item_catalog_2026_07_06"
AGENCY_ID = "ia_idot"
CONFIRMED_AWARD_STATUSES = {"AWARDED", "SIGNED CONTRACT"}

DIVISION_TITLES = {
    "21": "Earthwork, Subgrades, and Subbases",
    "22": "Base Courses",
    "23": "Surface Courses",
    "24": "Structures",
    "25": "Miscellaneous Construction",
    "26": "Roadside Development",
    "60": "Special Bid Items",
    "61": "Bid Item Adjustments",
    "62": "Price Adjustments",
}


def download(url: str, path: Path) -> None:
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, headers={"User-Agent": "roadway-cost-estimator/2.0"})
    with urllib.request.urlopen(request) as response:
        path.write_bytes(response.read())


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


def clean(value: str) -> str:
    return re.sub(r"\s+", " ", value or "").strip()


def slug(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.lower())).strip("_")


def date_slug(value: str) -> str:
    return value.replace("-", "_")


def compact_date(value: str) -> str:
    return value.replace("-", "")


def bid_tabs_source_id(letting_date: str) -> str:
    return f"ia_idot_bid_tabs_{date_slug(letting_date)}"


def letting_id(letting_date: str) -> str:
    return f"ia_idot_{date_slug(letting_date)}"


def normalize_description(value: str) -> str:
    return clean(re.sub(r"[^a-z0-9]+", " ", value.lower()))


def normalize_unit(value: str) -> str:
    normalized = clean(value).upper()
    aliases = {"LS": "L S", "LUMP SUM": "L S", "EAC": "EACH"}
    return aliases.get(normalized, normalized)


def parse_money(value: str) -> float:
    return float(value.replace("$", "").replace(",", "").replace("(", "").replace(")", ""))


def parse_number(value: str) -> float:
    return float(value.replace(",", "").replace("(", "").replace(")", ""))


def format_decimal(value: float | None, places: int = 5) -> str:
    if value is None:
        return ""
    return f"{value:.{places}f}".rstrip("0").rstrip(".")


def parse_date(value: str) -> str:
    return datetime.strptime(clean(value), "%B %d, %Y").date().isoformat()


def parse_archive_date(value: str) -> str:
    match = re.search(r"\b(\d{1,2})/(\d{1,2})/(\d{2,4})\b", value)
    if not match:
        raise ValueError(f"Could not parse letting date from archive label: {value}")
    month, day, year = match.groups()
    full_year = int(year)
    if full_year < 100:
        full_year += 2000
    return date(full_year, int(month), int(day)).isoformat()


def item_id(code: str) -> str:
    return f"ia_idot_{code.replace('-', '_')}"


def contract_id(official_id: str, letting_date: str) -> str:
    return f"ia_idot_{compact_date(letting_date)}_{slug(official_id)}"


def parse_item_master(path: Path, expected_count: int = 3727) -> list[dict[str, str]]:
    return parse_item_master_lines(
        path.read_text(encoding="utf-8-sig").splitlines(),
        expected_count=expected_count,
    )


def parse_item_master_lines(lines: list[str], expected_count: int = 3727) -> list[dict[str, str]]:
    rows = []
    for line_number, raw_line in enumerate(lines, start=1):
        if not re.match(r"^\d{4}-\d{7}\s", raw_line):
            continue
        rows.append({
            "item_code": raw_line[0:12].strip(),
            "official_abbreviated_description": clean(raw_line[13:53]),
            "official_unit": clean(raw_line[53:57]),
            "official_description": clean(raw_line[57:]),
            "master_line": str(line_number),
        })
    if len(rows) != expected_count:
        raise ValueError(f"Expected {expected_count:,} Iowa item-master rows; parsed {len(rows)}.")
    return rows


def parse_item_pdf(path: Path, expected_count: int = 3727) -> dict[str, dict[str, str]]:
    parsed: dict[str, dict[str, str]] = {}
    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages[2:], start=3):
            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            anchors = [word for word in words if word["x0"] < 70 and re.fullmatch(r"\d{4}-\d{7}", word["text"])]
            anchors.sort(key=lambda word: word["top"])
            for index, anchor in enumerate(anchors):
                top = anchor["top"] - 1
                bottom = anchors[index + 1]["top"] - 1 if index + 1 < len(anchors) else page.height - 18
                row_words = [word for word in words if top <= word["top"] < bottom]
                description = clean(" ".join(word["text"] for word in row_words if 80 <= word["x0"] < 660))
                unit = clean(" ".join(word["text"] for word in row_words if 660 <= word["x0"] < 710))
                spec = clean(" ".join(word["text"] for word in row_words if word["x0"] >= 710))
                parsed[anchor["text"]] = {
                    "pdf_description": description,
                    "pdf_unit": unit,
                    "spec_reference_code": spec,
                    "source_page": str(page_number),
                }
    if len(parsed) != expected_count:
        raise ValueError(f"Expected {expected_count:,} Iowa item-book PDF rows; parsed {len(parsed)}.")
    return parsed


def load_erl_section_titles(raw_dir: Path) -> dict[str, str]:
    titles: dict[str, str] = {}
    for division in ("21", "22", "23", "24", "25", "26"):
        path = raw_dir / f"erl_nav_{division}.html"
        download(f"https://ia.iowadot.gov/erl/current/GS/Navigation/nav{division}.htm", path)
        html = path.read_text(encoding="utf-8", errors="replace")
        plain = clean(unescape(re.sub(r"<[^>]+>", " ", html)))
        matches = list(re.finditer(r"Section\s+(\d{4})\s+(.+?)(?=\s+Section\s+\d{4}|\s+\*Changes|$)", plain, re.IGNORECASE))
        for match in matches:
            title = clean(match.group(2))
            title = re.sub(r"\s+(Overview|Table of Contents).*$", "", title, flags=re.IGNORECASE)
            titles[match.group(1)] = title
    return titles


def parse_bid_tab_archive_page(html: str, page_url: str) -> list[dict[str, str]]:
    entries: list[dict[str, str]] = []
    link_pattern = re.compile(r"<a\b[^>]*href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.IGNORECASE | re.DOTALL)
    for match in link_pattern.finditer(html):
        href = unescape(match.group(1))
        label = clean(unescape(re.sub(r"<[^>]+>", " ", match.group(2))))
        if "Bid Tab" not in label or ".pdf" not in label.lower():
            continue
        letting_date = parse_archive_date(label)
        entries.append({
            "letting_date": letting_date,
            "label": label,
            "url": urljoin(page_url, href),
        })
    return entries


def discover_bid_tab_archive(raw_dir: Path, refresh: bool = False) -> list[dict[str, str]]:
    archive_dir = raw_dir / "bid_tabs"
    page_dir = archive_dir / "archive_pages"
    page_dir.mkdir(parents=True, exist_ok=True)
    page_urls = [BID_TABS_URL, f"{BID_TABS_URL}?page=1", f"{BID_TABS_URL}?page=2"]
    entries: list[dict[str, str]] = []
    for index, page_url in enumerate(page_urls, start=1):
        path = page_dir / f"bid_tabulations_page_{index}.html"
        if refresh and path.exists():
            path.unlink()
        download(page_url, path)
        entries.extend(parse_bid_tab_archive_page(path.read_text(encoding="utf-8", errors="replace"), page_url))

    deduped: dict[str, dict[str, str]] = {}
    for entry in entries:
        deduped.setdefault(entry["url"], entry)

    dated_counts: defaultdict[str, int] = defaultdict(int)
    archive_entries = []
    for entry in sorted(deduped.values(), key=lambda row: row["letting_date"], reverse=True):
        dated_counts[entry["letting_date"]] += 1
        suffix = f"_{dated_counts[entry['letting_date']]}" if dated_counts[entry["letting_date"]] > 1 else ""
        file_name = f"bid_tabs_{entry['letting_date'].replace('-', '_')}{suffix}.pdf"
        archive_entries.append({
            **entry,
            "source_id": bid_tabs_source_id(entry["letting_date"]),
            "letting_id": letting_id(entry["letting_date"]),
            "file_name": file_name,
            "raw_path": str(archive_dir / file_name),
        })
    return archive_entries


def download_bid_tab_archive(raw_dir: Path, refresh_index: bool = False) -> list[dict[str, str]]:
    entries = discover_bid_tab_archive(raw_dir, refresh=refresh_index)
    seen_lettings: set[str] = set()
    for entry in entries:
        if entry["letting_date"] in seen_lettings:
            entry["duplicate_letting_date"] = "true"
        else:
            entry["duplicate_letting_date"] = "false"
            seen_lettings.add(entry["letting_date"])
        pdf_path = Path(entry["raw_path"])
        download(entry["url"], pdf_path)
        entry["sha256"] = sha256(pdf_path)
        entry["file_size_bytes"] = str(pdf_path.stat().st_size)
    return entries


def normalized_vendor_tokens(value: str) -> tuple[str, ...]:
    expanded = value.upper()
    expanded = re.sub(r"\b([A-Z])\.([A-Z])\.", r"\1\2", expanded)
    expanded = re.sub(r"\bCONSTR?\.?\b", "CONSTRUCTION", expanded)
    expanded = re.sub(r"\bEXCAV\.?\b", "EXCAVATING", expanded)
    expanded = re.sub(r"\bSUBSID\.?\b", "SUBSIDIARY", expanded)
    tokens = re.findall(r"[A-Z0-9]+", expanded)
    ignored = {"INC", "INCORPORATED", "LLC", "LC", "L", "C", "CO", "COMPANY", "CORP", "CORPORATION", "THE", "DBA", "D", "B", "A", "AKA", "JV", "JOINT", "VENTURE"}
    return tuple(sorted(token for token in tokens if token not in ignored))


def resolve_awarded_bids(awarded_vendor: str, bids: list[dict[str, object]]) -> list[dict[str, object]]:
    awarded_tokens = normalized_vendor_tokens(awarded_vendor)
    exact = [bid for bid in bids if normalized_vendor_tokens(str(bid["bidder_name"])) == awarded_tokens]
    if exact:
        return exact
    awarded_set = set(awarded_tokens)
    return [
        bid for bid in bids
        if awarded_set and awarded_set.issubset(set(normalized_vendor_tokens(str(bid["bidder_name"]))))
    ]


def clean_awarded_vendor(value: str) -> str:
    lines = [clean(line) for line in value.splitlines() if clean(line)]
    if len(lines) <= 1:
        return clean(value)
    kept = [lines[0]]
    vendor_markers = {"INC", "LLC", "LC", "CO", "CORP", "JV", "CONSTR", "CONSTRUCTION", "COMPANY", "DBA"}
    for line in lines[1:]:
        line_tokens = set(re.findall(r"[A-Z]+", line.replace("D/B/A", "DBA")))
        if re.fullmatch(r"[A-Z ,.'-]+", line) and not (line_tokens & vendor_markers):
            break
        kept.append(line)
    return clean(" ".join(kept))


def parse_contract_projects(text: str, official_contract_id: str, letting_date: str = "2026-06-16") -> list[dict[str, str]]:
    pattern = re.compile(
        r"Project:\s*(\S+)\s+WorkType:\s*(.*?)\n"
        r"County:\s*(.*?)\s+Prj Awd Amt:\s*\$([\d,]+\.\d{2})\n"
        r"Route:\s*(.*?)\nLocation:\s*(.*?)(?=\nProject:|\Z)",
        re.DOTALL,
    )
    projects = []
    internal_contract_id = contract_id(official_contract_id, letting_date)
    for index, match in enumerate(pattern.finditer(text), start=1):
        projects.append({
            "contract_project_id": f"{internal_contract_id}_project_{index}",
            "contract_id": internal_contract_id,
            "project_number": clean(match.group(1)),
            "project_name": clean(match.group(6)),
            "work_type": clean(match.group(2)),
            "county_region": clean(match.group(3)),
            "route": clean(match.group(5)),
            "location": clean(match.group(6)),
            "project_award_amount": format_decimal(parse_money(match.group(4)), 2),
        })
    return projects


def page_lines(page: pdfplumber.page.Page) -> list[str]:
    return [clean(line) for line in (page.extract_text(x_tolerance=2, y_tolerance=3) or "").splitlines() if clean(line)]


def group_words_by_top(words: list[dict[str, object]], tolerance: float = 2.0) -> list[list[dict[str, object]]]:
    rows: list[list[dict[str, object]]] = []
    for word in sorted(words, key=lambda item: (float(item["top"]), float(item["x0"]))):
        if not rows or abs(float(rows[-1][0]["top"]) - float(word["top"])) > tolerance:
            rows.append([word])
        else:
            rows[-1].append(word)
    return rows


def price_text_in_range(
    all_words: list[dict[str, object]],
    row_words: list[dict[str, object]],
    value_range: tuple[int, int],
    row_top: float,
    row_bottom: float,
) -> str | None:
    value_word = next(
        (
            word for word in row_words
            if value_range[0] <= float(word["x0"]) < value_range[1]
            and re.fullmatch(r"[\d,]+\.\d+", str(word["text"]))
        ),
        None,
    )
    if value_word:
        return str(value_word["text"])
    partial_word = next(
        (
            word for word in row_words
            if value_range[0] <= float(word["x0"]) < value_range[1]
            and re.fullmatch(r"[\d,]+\.", str(word["text"]))
        ),
        None,
    )
    if not partial_word:
        return None
    continuation = next(
        (
            word for word in all_words
            if row_top < float(word["top"]) < row_bottom
            and float(partial_word["x0"]) - 2 <= float(word["x0"]) <= float(partial_word["x1"]) + 2
            and re.fullmatch(r"\d{2,5}", str(word["text"]))
        ),
        None,
    )
    if not continuation:
        return None
    return f"{partial_word['text']}{continuation['text']}"


def parse_bid_tabs(
    path: Path,
    catalog_by_code: dict[str, dict[str, str]],
    source_id: str | None = None,
    default_letting_date: str | None = None,
) -> tuple[list[dict[str, object]], list[dict[str, object]], list[dict[str, object]], list[dict[str, object]], list[dict[str, object]]]:
    contracts_by_official: dict[str, dict[str, object]] = {}
    projects_by_id: dict[str, dict[str, object]] = {}
    bids_by_contract_rank: dict[tuple[str, int], dict[str, object]] = {}
    items_by_key: dict[tuple[str, str, str, str], dict[str, object]] = {}
    prices_by_key: dict[tuple[str, str], dict[str, object]] = {}

    with pdfplumber.open(path) as pdf:
        for page_number, page in enumerate(pdf.pages, start=1):
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            official_match = re.search(r"Contract ID:\s*([A-Z0-9.-]+)", text)
            if not official_match:
                continue
            official_id = official_match.group(1)
            letting_match = re.search(r"Letting Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})", text)
            page_letting_date = parse_date(letting_match.group(1)) if letting_match else default_letting_date
            if not page_letting_date:
                raise ValueError(f"{path.name}: could not parse letting date for contract {official_id}")
            page_source_id = source_id or bid_tabs_source_id(page_letting_date)
            internal_contract_id = contract_id(official_id, page_letting_date)
            lines = page_lines(page)

            if "Project(s) and Vendor Ranking" in text:
                contract = contracts_by_official.setdefault(official_id, {
                    "contract_id": internal_contract_id,
                    "letting_id": letting_id(page_letting_date),
                    "source_id": page_source_id,
                    "state": "IA",
                    "agency_id": AGENCY_ID,
                    "official_contract_id": official_id,
                    "call_order": "",
                    "letting_status": "",
                    "awarded_vendor": "",
                    "awarded_amount": "",
                    "primary_county": "",
                    "route": "",
                    "work_type": "",
                    "contract_period": "",
                    "dbe_goal": "",
                    "bid_count": "",
                    "location": "",
                    "district": "",
                    "terrain": "",
                    "award_index": "",
                })
                header = re.search(r"Call Order:\s*(\S+)\s+Contract ID:\s*\S+\s+Primary County:\s*([^\n]+)", text)
                if header:
                    contract["call_order"] = clean(header.group(1))
                    contract["primary_county"] = clean(header.group(2))
                status = re.search(r"Letting Status:\s*([A-Z ]+?)\s+Awarded Vendor:\s*(.*?)\nContract Period:", text, re.DOTALL)
                if status:
                    contract["letting_status"] = clean(status.group(1))
                    contract["awarded_vendor"] = clean_awarded_vendor(status.group(2))
                period = re.search(r"Contract Period:\s*(.*?)\n(?:Project Information:|Percent Of Low)", text, re.DOTALL)
                if period:
                    contract["contract_period"] = clean(period.group(1))
                dbe = re.search(r"DBE Goal:\s*([\d.]+%)", text)
                if dbe:
                    contract["dbe_goal"] = dbe.group(1)

                for project in parse_contract_projects(text, official_id, page_letting_date):
                    projects_by_id[str(project["contract_project_id"])] = project
                    if not contract["work_type"]:
                        contract["work_type"] = project["work_type"]
                        contract["route"] = project["route"]
                        contract["location"] = project["location"]
                    current_award = float(contract["awarded_amount"] or 0)
                    contract["awarded_amount"] = format_decimal(current_award + float(project["project_award_amount"]), 2)

                rank_pattern = re.compile(r"^(\d+)\s+(\S+)\s+(.+?)\s+\$([\d,]+\.\d{2})\s+([\d.]+)%$")
                line_index = 0
                while line_index < len(lines):
                    line = lines[line_index]
                    rank = rank_pattern.match(line)
                    if not rank:
                        line_index += 1
                        continue
                    continuation: list[str] = []
                    next_index = line_index + 1
                    while next_index < len(lines):
                        next_line = lines[next_index]
                        if rank_pattern.match(next_line):
                            break
                        if "$" in next_line or ":" in next_line or next_line.startswith(("Percent ", "Rank ", "Project(")):
                            break
                        if re.fullmatch(r"[A-Z0-9&.,' -]{3,}", next_line):
                            continuation.append(next_line)
                            next_index += 1
                            continue
                        break
                    rank_number = int(rank.group(1))
                    bid_id = f"{internal_contract_id}_bid_{rank_number}"
                    bids_by_contract_rank[(internal_contract_id, rank_number)] = {
                        "bid_id": bid_id,
                        "contract_id": internal_contract_id,
                        "source_id": page_source_id,
                        "source_vendor_id": rank.group(2),
                        "bidder_name": clean(" ".join([rank.group(3), *continuation])),
                        "bid_rank": str(rank_number),
                        "bid_total": format_decimal(parse_money(rank.group(4)), 2),
                        "percent_of_low": rank.group(5),
                        "is_apparent_low": "true" if rank_number == 1 else "false",
                        "is_awarded": "false",
                        "source_page": str(page_number),
                    }
                    line_index = next_index
                continue

            if "Tabulation of Construction and Material Bids" not in text:
                continue

            words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
            bidder_header_words = [
                word for word in words
                if 150 <= float(word["top"]) <= 235 and re.fullmatch(r"\(\d+\)", str(word["text"]))
            ]
            bidder_ranks = [int(str(word["text"])[1:-1]) for word in sorted(bidder_header_words, key=lambda word: float(word["x0"]))]
            if not bidder_ranks:
                continue

            section_anchors = [word for word in words if str(word["text"]).upper() == "SECTION:"]
            item_anchors = []
            word_rows = group_words_by_top(words)
            for word_row in word_rows:
                line_word = next((word for word in word_row if 70 <= float(word["x0"]) <= 105 and re.fullmatch(r"\d{4}", str(word["text"]))), None)
                code_word = next((word for word in word_row if 105 <= float(word["x0"]) <= 180 and re.fullmatch(r"\d{4}-\d{7}", str(word["text"]))), None)
                if line_word and code_word:
                    item_anchors.append((line_word, code_word))
            item_anchors.sort(key=lambda pair: float(pair[0]["top"]))

            for index, (line_word, code_word) in enumerate(item_anchors):
                top = float(line_word["top"])
                next_top = float(item_anchors[index + 1][0]["top"]) if index + 1 < len(item_anchors) else page.height - 60
                later_sections = [float(word["top"]) for word in section_anchors if float(word["top"]) > top]
                if later_sections:
                    next_top = min(next_top, min(later_sections))
                total_words = [word for word in words if float(word["top"]) > top and str(word["text"]).startswith("Totals:")]
                if total_words:
                    next_top = min(next_top, min(float(word["top"]) for word in total_words))

                preceding_sections = [word for word in section_anchors if float(word["top"]) < top]
                section_anchor = max(preceding_sections, key=lambda word: float(word["top"])) if preceding_sections else None
                section_number = ""
                section_title = ""
                alternate_set = ""
                alternate_member = ""
                if section_anchor:
                    section_top = float(section_anchor["top"])
                    # Section metadata is confined to its header row. Reading through the
                    # first item row can absorb an entire repeated table page into the title.
                    section_words = [word for word in words if section_top - 2 <= float(word["top"]) <= section_top + 12]
                    title_words = [word for word in section_words if float(word["x0"]) < 520]
                    metadata_words = [word for word in section_words if float(word["x0"]) >= 520]
                    section_text = clean(" ".join(str(word["text"]) for word in sorted(title_words, key=lambda word: (float(word["top"]), float(word["x0"])))))
                    alternate_text = clean(" ".join(str(word["text"]) for word in sorted(metadata_words, key=lambda word: float(word["x0"]))))
                    section_match = re.search(r"SECTION:\s*(\d+)\s+(.*?)(?=\s+Cat Alt Set:|$)", section_text)
                    if section_match:
                        section_number = section_match.group(1)
                        section_title = clean(section_match.group(2))
                    set_match = re.search(r"Cat Alt Set:\s*(?!Cat\b)([A-Z0-9]+)", alternate_text)
                    member_match = re.search(r"Cat Alt Member:\s*(?!Cat\b)([A-Z0-9]+)", alternate_text)
                    alternate_set = set_match.group(1) if set_match else ""
                    alternate_member = member_match.group(1) if member_match else ""

                row_words = [word for word in words if abs(float(word["top"]) - top) <= 2]
                quantity_word = next((word for word in row_words if 185 <= float(word["x0"]) < 260 and re.fullmatch(r"\(?[\d,]+(?:\.\d+)?\)?", str(word["text"]))), None)
                unit_word = next((word for word in row_words if 255 <= float(word["x0"]) < 295 and re.fullmatch(r"[A-Z]+", str(word["text"]))), None)
                if not quantity_word or not unit_word:
                    continue
                quantity = parse_number(str(quantity_word["text"]))
                source_code = str(code_word["text"])
                description_words = [
                    word for word in words
                    if top + 3 < float(word["top"]) < next_top - 1 and 70 <= float(word["x0"]) < 290
                ]
                description = clean(" ".join(str(word["text"]) for word in sorted(description_words, key=lambda word: (float(word["top"]), float(word["x0"])))))
                if not description:
                    description = catalog_by_code.get(source_code, {}).get("official_description", "")
                key = (internal_contract_id, section_number, str(line_word["text"]), source_code)
                contract_item_id = f"{internal_contract_id}_sec_{section_number or 'none'}_line_{line_word['text']}"
                item = items_by_key.setdefault(key, {
                    "contract_item_id": contract_item_id,
                    "contract_id": internal_contract_id,
                    "source_id": page_source_id,
                    "section_number": section_number,
                    "section_title": section_title,
                    "line_number": str(line_word["text"]),
                    "source_item_code": source_code,
                    "agency_item_id": item_id(source_code) if source_code in catalog_by_code else "",
                    "description_raw": description,
                    "quantity": format_decimal(quantity, 3),
                    "unit_raw": str(unit_word["text"]),
                    "unit_normalized": normalize_unit(str(unit_word["text"])),
                    "alternate_set": alternate_set,
                    "alternate_member": alternate_member,
                    "mapping_status": "direct" if source_code in catalog_by_code else "unmatched",
                    "source_page": str(page_number),
                    "source_locator": f"page:{page_number}:section:{section_number}:line:{line_word['text']}",
                })
                if len(description) > len(str(item["description_raw"])):
                    item["description_raw"] = description

                # Long currency values extend left of the nominal column boundary. Slightly
                # overlap the unit-price slots with the preceding gutter and keep extended
                # price slots separated by their right-aligned positions.
                slots = [((290, 370), (370, 435)), ((430, 515), (515, 580)), ((575, 660), (660, 730))]
                for slot_index, rank_number in enumerate(bidder_ranks[:3]):
                    unit_range, extended_range = slots[slot_index]
                    unit_price_text = price_text_in_range(words, row_words, unit_range, top, next_top)
                    extended_text = price_text_in_range(words, row_words, extended_range, top, next_top)
                    bid = bids_by_contract_rank.get((internal_contract_id, rank_number))
                    if not unit_price_text or not extended_text or not bid:
                        continue
                    price_key = (contract_item_id, str(bid["bid_id"]))
                    prices_by_key[price_key] = {
                        "bid_item_price_id": f"{contract_item_id}_bid_{rank_number}",
                        "contract_item_id": contract_item_id,
                        "bid_id": bid["bid_id"],
                        "contract_id": internal_contract_id,
                        "source_id": page_source_id,
                        "unit_price": format_decimal(parse_number(unit_price_text), 5),
                        "extended_price": format_decimal(parse_number(extended_text), 2),
                        "source_page": str(page_number),
                        "source_locator": f"page:{page_number}:rank:{rank_number}:line:{line_word['text']}",
                    }

    for official_id, contract in contracts_by_official.items():
        bids = [bid for (cid, _), bid in bids_by_contract_rank.items() if cid == contract["contract_id"]]
        contract["bid_count"] = str(len(bids))
        matches = resolve_awarded_bids(str(contract["awarded_vendor"]), bids)
        if str(contract["letting_status"]).upper() in CONFIRMED_AWARD_STATUSES and len(matches) != 1:
            raise ValueError(f"Contract {official_id} awarded vendor matched {len(matches)} bidders: {contract['awarded_vendor']}")
        for bid in matches:
            bid["is_awarded"] = "true"
            contract["awarded_amount"] = bid["bid_total"]

    return (
        list(contracts_by_official.values()),
        list(projects_by_id.values()),
        list(bids_by_contract_rank.values()),
        list(items_by_key.values()),
        list(prices_by_key.values()),
    )


def read_pdf_letting_date(path: Path) -> str:
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:5]:
            text = page.extract_text(x_tolerance=2, y_tolerance=3) or ""
            match = re.search(r"Letting Date:\s*([A-Za-z]+\s+\d{1,2},\s+\d{4})", text)
            if match:
                return parse_date(match.group(1))
    raise ValueError(f"{path.name}: could not find a letting date")


def sort_rows(rows: list[dict[str, object]], *keys: str) -> list[dict[str, object]]:
    return sorted(rows, key=lambda row: tuple(str(row.get(key, "")) for key in keys))


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the Iowa DOT item catalog and bid-tab lettings into schema-v2 CSVs.")
    parser.add_argument("--item-pdf", required=True, type=Path)
    parser.add_argument("--bid-tabs-pdf", action="append", type=Path, default=[])
    parser.add_argument("--all-bid-tabs", action="store_true", help="Download and parse every PDF listed in the IDOT bid-tab archive.")
    parser.add_argument("--refresh-archive-index", action="store_true", help="Refresh cached archive-list HTML before discovering PDFs.")
    parser.add_argument("--raw-dir", type=Path, default=Path("data/raw/ia"))
    parser.add_argument("--staging-dir", type=Path, default=Path("data/staging/ia"))
    parser.add_argument("--output-dir", type=Path, default=Path("public/data/states/ia"))
    args = parser.parse_args()
    if not args.all_bid_tabs and not args.bid_tabs_pdf:
        raise SystemExit("Provide --bid-tabs-pdf at least once or use --all-bid-tabs.")

    item_master_path = args.raw_dir / "ItemMaster_2026_07_06.txt"
    download(ITEM_MASTER_URL, item_master_path)
    master_rows = parse_item_master(item_master_path)
    pdf_rows = parse_item_pdf(args.item_pdf)
    if {row["item_code"] for row in master_rows} != set(pdf_rows):
        raise ValueError("Iowa Item master and item-book PDF code sets differ.")

    catalog_native = []
    catalog_by_code: dict[str, dict[str, str]] = {}
    for master in master_rows:
        pdf = pdf_rows[master["item_code"]]
        if normalize_unit(master["official_unit"]) != normalize_unit(pdf["pdf_unit"]):
            raise ValueError(f"Unit mismatch for {master['item_code']}: {master['official_unit']} vs {pdf['pdf_unit']}")
        row = {**master, **pdf}
        catalog_native.append(row)
        catalog_by_code[master["item_code"]] = row

    section_titles = load_erl_section_titles(args.raw_dir)

    archive_inventory: list[dict[str, str]] = []
    bid_tab_inputs: list[dict[str, str]] = []
    if args.all_bid_tabs:
        archive_inventory = download_bid_tab_archive(args.raw_dir, refresh_index=args.refresh_archive_index)
        seen_dates: set[str] = set()
        for entry in archive_inventory:
            if entry["letting_date"] in seen_dates:
                entry["parse_status"] = "skipped_duplicate_letting_date"
                continue
            seen_dates.add(entry["letting_date"])
            entry["parse_status"] = "selected"
            bid_tab_inputs.append(entry)

    for pdf_path in args.bid_tabs_pdf:
        letting_date = read_pdf_letting_date(pdf_path)
        bid_tab_inputs.append({
            "letting_date": letting_date,
            "label": f"Iowa DOT {letting_date} Bid Tabulations",
            "url": BID_TABS_URL,
            "source_id": bid_tabs_source_id(letting_date),
            "letting_id": letting_id(letting_date),
            "file_name": pdf_path.name,
            "raw_path": str(pdf_path),
            "sha256": sha256(pdf_path),
            "file_size_bytes": str(pdf_path.stat().st_size),
            "duplicate_letting_date": "false",
            "parse_status": "selected",
        })

    unique_inputs: dict[str, dict[str, str]] = {}
    for entry in bid_tab_inputs:
        unique_inputs.setdefault(entry["letting_date"], entry)
    bid_tab_inputs = sorted(unique_inputs.values(), key=lambda row: row["letting_date"], reverse=True)

    contracts: list[dict[str, object]] = []
    projects: list[dict[str, object]] = []
    bids: list[dict[str, object]] = []
    contract_items: list[dict[str, object]] = []
    bid_item_prices: list[dict[str, object]] = []
    for entry in bid_tab_inputs:
        parsed = parse_bid_tabs(
            Path(entry["raw_path"]),
            catalog_by_code,
            source_id=entry["source_id"],
            default_letting_date=entry["letting_date"],
        )
        contracts.extend(parsed[0])
        projects.extend(parsed[1])
        bids.extend(parsed[2])
        contract_items.extend(parsed[3])
        bid_item_prices.extend(parsed[4])

    agency_items = []
    agency_versions = []
    for row in catalog_native:
        agency_item_id = item_id(row["item_code"])
        version_id = f"{agency_item_id}_v20260706"
        agency_items.append({
            "agency_item_id": agency_item_id,
            "state": "IA",
            "agency_id": AGENCY_ID,
            "agency_name": "Iowa DOT",
            "item_code": row["item_code"],
            "current_version_id": version_id,
            "item_status": "current",
            "canonical_item_id": "",
        })
        agency_versions.append({
            "agency_item_version_id": version_id,
            "agency_item_id": agency_item_id,
            "effective_from": "2026-07-06",
            "effective_to": "",
            "official_description": row["official_description"],
            "official_abbreviated_description": row["official_abbreviated_description"],
            "official_unit": normalize_unit(row["official_unit"]),
            "spec_reference_code": row["spec_reference_code"],
            "source_id": ITEM_CATALOG_SOURCE_ID,
            "is_current": "true",
        })

    taxonomy = []
    prefixes = sorted({row["item_code"][:4] for row in catalog_native})
    divisions = sorted({prefix[:2] for prefix in prefixes})
    for division in divisions:
        taxonomy.append({
            "taxonomy_id": f"ia_idot_div_{division}",
            "state": "IA",
            "agency_id": AGENCY_ID,
            "taxonomy_level": "division",
            "taxonomy_code": division,
            "parent_taxonomy_id": "",
            "taxonomy_label": DIVISION_TITLES.get(division, f"Division {division}"),
            "match_prefix": division,
            "source_year": "2026",
            "source_url": ERL_URL,
        })
    for prefix in prefixes:
        taxonomy.append({
            "taxonomy_id": f"ia_idot_sec_{prefix}",
            "state": "IA",
            "agency_id": AGENCY_ID,
            "taxonomy_level": "section",
            "taxonomy_code": prefix,
            "parent_taxonomy_id": f"ia_idot_div_{prefix[:2]}",
            "taxonomy_label": section_titles.get(prefix, f"Section {prefix}"),
            "match_prefix": prefix,
            "source_year": "2026",
            "source_url": f"https://ia.iowadot.gov/erl/current/GS/Navigation/nav{prefix[:2]}.htm" if prefix[:2] in {"21", "22", "23", "24", "25", "26"} else ITEM_INFO_URL,
        })

    bid_by_id = {str(row["bid_id"]): row for row in bids}
    contracts_by_id = {str(row["contract_id"]): row for row in contracts}
    letting_dates_by_id = {entry["letting_id"]: entry["letting_date"] for entry in bid_tab_inputs}
    prices_by_item: dict[str, list[dict[str, object]]] = defaultdict(list)
    for price in bid_item_prices:
        prices_by_item[str(price["contract_item_id"])].append(price)
    observations = []
    for item in contract_items:
        agency_item_id = str(item["agency_item_id"])
        if not agency_item_id:
            continue
        prices = prices_by_item[str(item["contract_item_id"])]
        awarded_prices = [price for price in prices if str(bid_by_id[str(price["bid_id"])]["is_awarded"]).lower() == "true"]
        contract = contracts_by_id[str(item["contract_id"])]
        date_basis = letting_dates_by_id[str(contract["letting_id"])]
        if len(awarded_prices) == 1:
            price = awarded_prices[0]
            observations.append({
                "observation_id": f"{item['contract_item_id']}_awarded",
                "contract_id": item["contract_id"],
                "source_id": item["source_id"],
                "agency_item_id": agency_item_id,
                "agency_item_code": item["source_item_code"],
                "description_raw": item["description_raw"],
                "description_normalized": normalize_description(str(item["description_raw"])),
                "unit_raw": item["unit_raw"],
                "unit_normalized": item["unit_normalized"],
                "quantity": item["quantity"],
                "unit_price": price["unit_price"],
                "extended_price": price["extended_price"],
                "discipline": "Roadway",
                "price_type": "awarded_bid",
                "date_basis": date_basis,
                "derivation_method": "explicit_awarded_vendor",
                "derivation_input_count": "1",
            })
        if prices:
            mean_price = statistics.fmean(float(price["unit_price"]) for price in prices)
            quantity = float(item["quantity"])
            observations.append({
                "observation_id": f"{item['contract_item_id']}_average",
                "contract_id": item["contract_id"],
                "source_id": item["source_id"],
                "agency_item_id": agency_item_id,
                "agency_item_code": item["source_item_code"],
                "description_raw": item["description_raw"],
                "description_normalized": normalize_description(str(item["description_raw"])),
                "unit_raw": item["unit_raw"],
                "unit_normalized": item["unit_normalized"],
                "quantity": item["quantity"],
                "unit_price": format_decimal(mean_price, 5),
                "extended_price": format_decimal(mean_price * quantity, 2),
                "discipline": "Roadway",
                "price_type": "average_bid",
                "date_basis": date_basis,
                "derivation_method": "unweighted_bidder_mean",
                "derivation_input_count": str(len(prices)),
            })

    sources = [
        {
            "source_id": ITEM_CATALOG_SOURCE_ID,
            "source_type": "item_catalog",
            "agency_id": AGENCY_ID,
            "agency_name": "Iowa DOT",
            "state": "IA",
            "source_label": "Iowa DOT Bid Item Descriptions 2026-07-06",
            "source_date": "2026-07-06",
            "data_year": "2026",
            "source_url": ITEM_INFO_URL,
            "source_file_name": args.item_pdf.name,
            "sha256": sha256(args.item_pdf),
            "parser_name": "import_iowa_data.py",
            "parser_version": "2.0.0",
            "notes": "Item master text is primary; PDF adds SPEC code and validates catalog coverage.",
        },
    ]
    for entry in bid_tab_inputs:
        sources.append({
            "source_id": entry["source_id"],
            "source_type": "bid_tab",
            "agency_id": AGENCY_ID,
            "agency_name": "Iowa DOT",
            "state": "IA",
            "source_label": f"Iowa DOT {entry['letting_date']} Bid Tabulations",
            "source_date": entry["letting_date"],
            "data_year": entry["letting_date"][:4],
            "source_url": entry["url"],
            "source_file_name": entry["file_name"],
            "sha256": entry["sha256"],
            "parser_name": "import_iowa_data.py",
            "parser_version": "2.1.0",
            "notes": "Parsed from IDOT historical bid-tab PDF archive with contract, project, bidder, item, alternate, and item-price provenance.",
        })
    lettings = [
        {
            "letting_id": entry["letting_id"],
            "source_id": entry["source_id"],
            "state": "IA",
            "agency_id": AGENCY_ID,
            "letting_date": entry["letting_date"],
            "letting_label": f"Iowa DOT {entry['letting_date']} Letting",
        }
        for entry in bid_tab_inputs
    ]

    field_map = {
        "sources.csv": ["source_id", "source_type", "agency_id", "agency_name", "state", "source_label", "source_date", "data_year", "source_url", "source_file_name", "sha256", "parser_name", "parser_version", "notes"],
        "lettings.csv": ["letting_id", "source_id", "state", "agency_id", "letting_date", "letting_label"],
        "contracts.csv": ["contract_id", "letting_id", "source_id", "state", "agency_id", "official_contract_id", "call_order", "letting_status", "awarded_vendor", "awarded_amount", "primary_county", "route", "work_type", "contract_period", "dbe_goal", "bid_count", "location", "district", "terrain", "award_index"],
        "contract_projects.csv": ["contract_project_id", "contract_id", "project_number", "project_name", "work_type", "county_region", "route", "location", "project_award_amount"],
        "contract_items.csv": ["contract_item_id", "contract_id", "source_id", "section_number", "section_title", "line_number", "source_item_code", "agency_item_id", "description_raw", "quantity", "unit_raw", "unit_normalized", "alternate_set", "alternate_member", "mapping_status", "source_page", "source_locator"],
        "bids.csv": ["bid_id", "contract_id", "source_id", "source_vendor_id", "bidder_name", "bid_rank", "bid_total", "percent_of_low", "is_apparent_low", "is_awarded", "source_page"],
        "bid_item_prices.csv": ["bid_item_price_id", "contract_item_id", "bid_id", "contract_id", "source_id", "unit_price", "extended_price", "source_page", "source_locator"],
        "agency_items.csv": ["agency_item_id", "state", "agency_id", "agency_name", "item_code", "current_version_id", "item_status", "canonical_item_id"],
        "agency_item_versions.csv": ["agency_item_version_id", "agency_item_id", "effective_from", "effective_to", "official_description", "official_abbreviated_description", "official_unit", "spec_reference_code", "source_id", "is_current"],
        "item_taxonomy.csv": ["taxonomy_id", "state", "agency_id", "taxonomy_level", "taxonomy_code", "parent_taxonomy_id", "taxonomy_label", "match_prefix", "source_year", "source_url"],
        "item_mappings.csv": ["mapping_id", "state", "source_agency_id", "source_item_code", "target_agency_item_id", "match_status", "confidence", "reviewed_by", "reviewed_on", "notes"],
        "item_observations.csv": ["observation_id", "contract_id", "source_id", "agency_item_id", "agency_item_code", "description_raw", "description_normalized", "unit_raw", "unit_normalized", "quantity", "unit_price", "extended_price", "discipline", "price_type", "date_basis", "derivation_method", "derivation_input_count"],
    }
    data_map = {
        "sources.csv": sort_rows(sources, "source_id"),
        "lettings.csv": sort_rows(lettings, "letting_date"),
        "contracts.csv": sort_rows(contracts, "contract_id"),
        "contract_projects.csv": sort_rows(projects, "contract_project_id"),
        "contract_items.csv": sort_rows(contract_items, "contract_item_id"),
        "bids.csv": sort_rows(bids, "bid_id"),
        "bid_item_prices.csv": sort_rows(bid_item_prices, "bid_item_price_id"),
        "agency_items.csv": sort_rows(agency_items, "agency_item_id"),
        "agency_item_versions.csv": sort_rows(agency_versions, "agency_item_version_id"),
        "item_taxonomy.csv": sort_rows(taxonomy, "taxonomy_id"),
        "item_mappings.csv": [],
        "item_observations.csv": sort_rows(observations, "observation_id"),
    }
    for name, rows in data_map.items():
        write_csv(args.output_dir / name, field_map[name], rows)

    write_csv(args.staging_dir / "item_catalog_native.csv", list(catalog_native[0]), catalog_native)
    for name in ("contracts.csv", "contract_projects.csv", "contract_items.csv", "bids.csv", "bid_item_prices.csv"):
        write_csv(args.staging_dir / name, field_map[name], data_map[name])
    if archive_inventory:
        inventory_fields = ["letting_date", "label", "url", "source_id", "letting_id", "file_name", "raw_path", "sha256", "file_size_bytes", "duplicate_letting_date", "parse_status"]
        write_csv(args.staging_dir / "bid_tab_archive.csv", inventory_fields, sort_rows(archive_inventory, "letting_date", "url"))

    summary = {
        "archive_entries": len(archive_inventory),
        "parsed_lettings": len(bid_tab_inputs),
        "skipped_duplicate_letting_dates": sum(1 for entry in archive_inventory if entry.get("parse_status") == "skipped_duplicate_letting_date"),
        "catalog_items": len(agency_items),
        "catalog_prefixes": len(prefixes),
        "contracts": len(contracts),
        "contract_projects": len(projects),
        "bids": len(bids),
        "contract_items": len(contract_items),
        "bid_item_prices": len(bid_item_prices),
        "observations": len(observations),
        "multi_project_contracts": sum(1 for contract in contracts if sum(1 for project in projects if project["contract_id"] == contract["contract_id"]) > 1),
    }
    (args.staging_dir / "import_summary.json").write_text(json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
