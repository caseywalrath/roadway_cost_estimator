from __future__ import annotations

import base64
import csv
import hashlib
import json
import re
import shutil
import socket
import ssl
import struct
import subprocess
import tempfile
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Iterable, Mapping, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urljoin, urlparse, urlunparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


USER_AGENT = "roadway-cost-estimator-source-monitor/1.0"
DEFAULT_TIMEOUT = 25.0
DEFAULT_MAX_BYTES = 25 * 1024 * 1024
DEFAULT_MAX_REDIRECTS = 5
STATUSES = {
    "New",
    "Changed",
    "Unchanged",
    "Removed",
    "Unavailable",
    "Review required",
    "Baseline needed",
}


class MonitorError(Exception):
    """Expected, user-facing monitor error."""


class Fetcher(Protocol):
    def fetch(self, url: str, allowed_hosts: set[str], *, max_bytes: int = DEFAULT_MAX_BYTES, data: bytes | None = None) -> "FetchResponse":
        ...


@dataclass
class FetchResponse:
    url: str
    status: int
    headers: dict[str, str]
    body: bytes

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "").split(";", 1)[0].strip().lower()


class HttpFetcher:
    """Small stdlib HTTP client with host and response-size safety checks."""

    def __init__(self, *, timeout: float = DEFAULT_TIMEOUT, max_redirects: int = DEFAULT_MAX_REDIRECTS) -> None:
        self.timeout = timeout
        self.max_redirects = max_redirects

    def fetch(self, url: str, allowed_hosts: set[str], *, max_bytes: int = DEFAULT_MAX_BYTES, data: bytes | None = None) -> FetchResponse:
        current = validate_url(url, allowed_hosts)
        client = self

        class CheckedRedirectHandler(HTTPRedirectHandler):
            count = 0

            def redirect_request(self, request: Request, fp: Any, code: int, msg: str, headers: Any, newurl: str) -> Request | None:
                self.count += 1
                if self.count > client.max_redirects:
                    raise MonitorError(f"Too many redirects while fetching {url}.")
                checked = validate_url(urljoin(request.full_url, newurl), allowed_hosts)
                return super().redirect_request(request, fp, code, msg, headers, checked)

        request = Request(current, data=data, headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/json,application/pdf,application/octet-stream", **({"Content-Type": "application/x-www-form-urlencoded"} if data is not None else {})})
        try:
            with build_opener(CheckedRedirectHandler()).open(request, timeout=self.timeout) as response:
                final_url = validate_url(response.geturl(), allowed_hosts)
                body = response.read(max_bytes + 1)
                if len(body) > max_bytes:
                    raise MonitorError(f"Response exceeded the {max_bytes:,}-byte safety limit.")
                response_headers = {key.lower(): value for key, value in response.headers.items()}
                return FetchResponse(final_url, int(response.status), response_headers, body)
        except MonitorError:
            raise
        except HTTPError as error:
            raise MonitorError(f"HTTP {error.code} while fetching {current}.") from error
        except URLError as error:
            reason = getattr(error, "reason", error)
            raise MonitorError(f"Could not fetch {current}: {reason}") from error
        except TimeoutError as error:
            raise MonitorError(f"Timed out while fetching {current}.") from error


class LinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.links: list[dict[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        values = dict(attrs)
        self._href = values.get("href") or ""
        self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() != "a" or self._href is None:
            return
        self.links.append({"href": self._href, "text": clean_text(" ".join(self._text))})
        self._href = None
        self._text = []


class TextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        self.parts.append(data)


def clean_text(value: str) -> str:
    return re.sub(r"\s+", " ", unescape(value or "")).strip()


def validate_url(url: str, allowed_hosts: set[str]) -> str:
    parsed = urlparse(url)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise MonitorError(f"Blocked non-HTTP source URL: {url}")
    host = (parsed.hostname or "").lower()
    if not host or host not in {item.lower() for item in allowed_hosts}:
        raise MonitorError(f"Blocked redirect or source host not in registry: {host or url}")
    return urlunparse((parsed.scheme.lower(), parsed.netloc, parsed.path, parsed.params, parsed.query, ""))


def normalized_url(url: str, ignored_query_params: Iterable[str] = ()) -> str:
    parsed = urlparse(url)
    ignored = {value.lower() for value in ignored_query_params}
    query_parts = []
    if parsed.query:
        for pair in parsed.query.split("&"):
            key = pair.split("=", 1)[0].lower()
            if key not in ignored:
                query_parts.append(pair)
    return urlunparse((parsed.scheme.lower(), parsed.netloc.lower(), parsed.path, parsed.params, "&".join(query_parts), ""))


def sha256_bytes(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_registry(path: Path) -> list[dict[str, Any]]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise MonitorError(f"Could not read source registry {path}: {error}") from error
    entries = payload.get("sources") if isinstance(payload, dict) else payload
    if not isinstance(entries, list):
        raise MonitorError("Source registry must contain a 'sources' list.")
    errors: list[str] = []
    ids: set[str] = set()
    for index, entry in enumerate(entries):
        prefix = f"registry entry {index + 1}"
        if not isinstance(entry, dict):
            errors.append(f"{prefix} is not an object")
            continue
        for field in ("id", "state", "agency", "label", "sourceType", "indexUrl", "allowedHosts", "importer", "enabled"):
            if field not in entry:
                errors.append(f"{prefix} is missing {field}")
        source_id = str(entry.get("id", ""))
        if source_id in ids:
            errors.append(f"duplicate source id: {source_id}")
        ids.add(source_id)
        if not isinstance(entry.get("allowedHosts"), list) or not entry.get("allowedHosts"):
            errors.append(f"{source_id or prefix} must declare allowedHosts")
        try:
            validate_url(str(entry.get("indexUrl", "")), {str(host) for host in entry.get("allowedHosts", [])})
        except MonitorError as error:
            errors.append(f"{source_id or prefix}: {error}")
        if entry.get("sourceType") not in {"linked_documents", "archive_entries", "html_catalog", "api_records"}:
            errors.append(f"{source_id or prefix} has unsupported sourceType")
    if errors:
        raise MonitorError("Source registry validation failed: " + "; ".join(errors))
    return entries


def read_csv_rows(root: Path, relative_path: str) -> list[dict[str, str]]:
    path = root / relative_path
    if not path.exists():
        return []
    try:
        with path.open(newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))
    except (OSError, UnicodeError, csv.Error):
        return []


def repository_baseline(root: Path, source: Mapping[str, Any]) -> list[dict[str, Any]]:
    config = source.get("baseline") or {}
    paths = config.get("paths", [])
    source_ids = set(config.get("sourceIds", []))
    prefix = str(config.get("sourceIdPrefix", ""))
    records: list[dict[str, Any]] = []
    for relative_path in paths:
        for row in read_csv_rows(root, str(relative_path)):
            row_source_id = row.get("source_id", "")
            if source_ids and row_source_id not in source_ids:
                continue
            if prefix and not row_source_id.startswith(prefix):
                continue
            records.append(baseline_record(row, source))
    return dedupe_records(records)


def baseline_record(row: Mapping[str, str], source: Mapping[str, Any]) -> dict[str, Any]:
    config = source.get("baseline") or {}
    identity_field = str(config.get("identityField", "source_id"))
    url = row.get(str(config.get("urlField", "source_url")), "")
    source_type = source.get("sourceType")
    identity_mode = str((source.get("config") or {}).get("identityMode", ""))
    document_probe = str((source.get("config") or {}).get("documentProbe", ""))
    coverage = cdot_cost_book_coverage(" ".join(row.get(field, "") for field in ("source_label", "label", "period_label", "source_date", "data_year"))) if document_probe == "hyland_pdfpop_title" else None
    if coverage:
        identity = coverage["year"]
    elif source_type == "api_records":
        identity = row.get("period_label") or row.get("quarter") or row.get(identity_field) or ""
    elif source_type == "html_catalog":
        identity = row.get(identity_field) or row.get("item_code") or row.get("agency_item_code") or ""
    elif source_type == "archive_entries":
        candidate = " ".join(row.get(field, "") for field in ("source_label", "label", "letting_label", "letting_date", "period_label", "source_url"))
        match = regex_search((source.get("config") or {}).get("identityPattern"), candidate)
        identity = canonical_date_identity(match.group(0)) if match else (normalized_url(url, config.get("ignoredQueryParams", [])) if url else row.get(identity_field, ""))
    elif identity_mode == "period":
        identity = infer_period(" ".join(row.get(field, "") for field in ("source_label", "label", "period_label", "source_date", "data_year")), source.get("config") or {})
    elif url:
        identity = normalized_url(url, config.get("ignoredQueryParams", []))
    else:
        identity = row.get(identity_field) or row.get("source_id") or row.get("source_document_id") or row.get("letting_date") or row.get("period_label") or ""
    return {
        "recordId": str(identity),
        "title": clean_text(row.get("source_label") or row.get("period_label") or row.get("letting_label") or row.get("label") or ""),
        "discoveredUrl": url,
        "resolvedUrl": url,
        "filename": row.get("source_file_name") or row.get("file_name") or row.get("detail_file_name") or "",
        "period": coverage["period"] if coverage else (row.get("period_label") or row.get("source_date") or row.get("letting_date") or row.get("data_year") or ""),
        "coverageThrough": coverage["through"] if coverage else "",
        "coverageSortKey": coverage["sortKey"] if coverage else "",
        "sha256": "" if (source.get("config") or {}).get("ignoreHash") else (row.get("sha256") or row.get("abstract_sha256") or ""),
        "fingerprint": row.get("fingerprint", ""),
        "baselineEvidence": f"{config.get('paths', ['repository evidence'])[0] if config.get('paths') else 'repository evidence'}:{identity}",
    }


def dedupe_records(records: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    result: dict[str, dict[str, Any]] = {}
    for record in records:
        if record.get("recordId"):
            result[str(record["recordId"])] = record
    return [result[key] for key in sorted(result)]


def parse_links(body: bytes, base_url: str) -> list[dict[str, str]]:
    parser = LinkParser()
    try:
        parser.feed(body.decode("utf-8", errors="replace"))
    except Exception as error:
        raise MonitorError(f"Could not parse official HTML: {error}") from error
    links = []
    for link in parser.links:
        href = link.get("href", "").strip()
        if not href or href.startswith(("#", "mailto:", "javascript:")):
            continue
        links.append({"text": clean_text(link.get("text", "")), "url": urljoin(base_url, href)})
    return links


def parse_form_inputs(body: bytes) -> dict[str, str]:
    text = body.decode("utf-8", errors="replace")
    values: dict[str, str] = {}
    for match in re.finditer(r"<input\b[^>]*>", text, flags=re.IGNORECASE):
        tag = match.group(0)
        name_match = re.search(r"\bname\s*=\s*([\"'])(.*?)\1", tag, flags=re.IGNORECASE)
        if not name_match:
            continue
        value_match = re.search(r"\bvalue\s*=\s*([\"'])(.*?)\1", tag, flags=re.IGNORECASE)
        values[unescape(name_match.group(2))] = unescape(value_match.group(2)) if value_match else ""
    return values


def regex_search(pattern: str | None, value: str) -> re.Match[str] | None:
    if not pattern:
        return None
    try:
        return re.search(pattern, value, flags=re.IGNORECASE)
    except re.error as error:
        raise MonitorError(f"Invalid registry regular expression: {error}") from error


def infer_period(value: str, config: Mapping[str, Any]) -> str:
    match = regex_search(config.get("periodPattern"), value)
    if match:
        groups = match.groupdict()
        if groups.get("period"):
            return groups["period"]
        if groups.get("year") and groups.get("quarter"):
            return f"{groups['year']} Q{groups['quarter']}"
        if groups.get("start") and groups.get("end"):
            return f"{groups['start']} to {groups['end']}"
        if groups.get("year"):
            return groups["year"]
        return match.group(0)
    year_match = re.search(r"\b(20\d{2})\b", value)
    return year_match.group(1) if year_match else ""


def canonical_date_identity(value: str) -> str:
    """Return an ISO date for common agency letting-label formats."""
    value = re.sub(r"\bFebrur(?:ary|ay)\b", "February", value, flags=re.IGNORECASE)
    month_pattern = r"(?:January|February|March|April|May|June|July|August|September|October|November|December)"
    match = re.search(rf"\b({month_pattern})[\s,.]+(\d{{1,2}})[\s,.]+(\d{{4}})\b", value, flags=re.IGNORECASE)
    if match:
        try:
            return datetime.strptime(f"{match.group(1)} {match.group(2)} {match.group(3)}", "%B %d %Y").date().isoformat()
        except ValueError:
            return ""
    match = re.search(r"\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b", value)
    if match:
        year = int(match.group(3))
        if year < 100:
            year += 2000 if year < 70 else 1900
        try:
            return datetime(year, int(match.group(1)), int(match.group(2))).date().isoformat()
        except ValueError:
            return ""
    match = re.search(r"\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b", value)
    if match:
        try:
            return datetime(int(match.group(1)), int(match.group(2)), int(match.group(3))).date().isoformat()
        except ValueError:
            return ""
    return ""


def link_matches(link: Mapping[str, str], config: Mapping[str, Any]) -> bool:
    haystack = f"{link.get('text', '')} {link.get('url', '')}"
    patterns = config.get("includePatterns") or []
    if patterns and not any(regex_search(str(pattern), haystack) for pattern in patterns):
        return False
    exclude_patterns = config.get("excludePatterns") or []
    return not any(regex_search(str(pattern), haystack) for pattern in exclude_patterns)


def link_record(link: Mapping[str, str], source: Mapping[str, Any], *, fetch_content: bool, fetcher: Fetcher) -> dict[str, Any]:
    config = source.get("config") or {}
    url = normalized_url(link["url"], config.get("ignoredQueryParams", []))
    identity_match = regex_search(config.get("identityPattern"), f"{link.get('text', '')} {url}")
    if config.get("identityMode") == "period":
        record_id = infer_period(f"{link.get('text', '')} {url}", config) or url
    else:
        record_id = (identity_match.group(0).lower() if identity_match else url) if config.get("identityMode") != "url" else url
    record: dict[str, Any] = {
        "recordId": record_id,
        "title": clean_text(link.get("text", "")) or Path(urlparse(url).path).name or url,
        "discoveredUrl": link["url"],
        "resolvedUrl": url,
        "filename": Path(urlparse(url).path).name,
        "period": infer_period(f"{link.get('text', '')} {url}", config),
        "mediaType": "application/pdf" if ".pdf" in url.lower() else ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if re.search(r"\.xlsx?(?:$|[?#])", url, re.I) else ""),
        "discoveryEvidence": f"{source.get('indexUrl')} -> {link.get('text', '') or link['url']}",
    }
    if config.get("compareDiscoveredUrl"):
        # Some agency document portals redirect a stable public link through a
        # session-specific viewer. For those sources, the published link—not
        # the transient viewer URL—is the meaningful comparison value.
        record["comparisonUrl"] = url
    if fetch_content:
        response = fetcher.fetch(url, {str(item) for item in source["allowedHosts"]})
        record.update({
            "resolvedUrl": response.url,
            "contentLength": len(response.body),
            "etag": response.headers.get("etag", ""),
            "lastModified": response.headers.get("last-modified", ""),
            "sha256": sha256_bytes(response.body),
        })
    return record


def edge_executable() -> str | None:
    candidates = [
        shutil.which("msedge.exe"),
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    ]
    return next((candidate for candidate in candidates if candidate and Path(candidate).is_file()), None)


def websocket_evaluate(websocket_url: str, expression: str) -> str:
    """Evaluate a small expression through a local Chromium DevTools socket."""
    parsed = urlparse(websocket_url)
    host, port = parsed.hostname, parsed.port or 80
    if not host or host not in {"127.0.0.1", "localhost"}:
        raise MonitorError("Browser probe did not expose a local debugging endpoint.")
    client = socket.create_connection((host, port), timeout=8)
    if parsed.scheme == "wss":
        client = ssl.create_default_context().wrap_socket(client, server_hostname=host)
    try:
        key = base64.b64encode(hashlib.sha1(str(time.time_ns()).encode()).digest()).decode()
        client.sendall((
            f"GET {parsed.path} HTTP/1.1\r\nHost: {host}:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n"
        ).encode())
        if b" 101 " not in client.recv(4096):
            raise MonitorError("Browser probe could not open its local debugging session.")
        payload = json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": expression, "returnByValue": True}}).encode()
        mask = hashlib.sha256(payload).digest()[:4]
        header = bytes([0x81])
        length = len(payload)
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack("!H", length)
        else:
            header += bytes([0x80 | 127]) + struct.pack("!Q", length)
        client.sendall(header + mask + bytes(value ^ mask[index % 4] for index, value in enumerate(payload)))
        while True:
            first, second = client.recv(2)
            length = second & 0x7F
            if length == 126:
                length = struct.unpack("!H", client.recv(2))[0]
            elif length == 127:
                length = struct.unpack("!Q", client.recv(8))[0]
            body = client.recv(length)
            message = json.loads(body.decode("utf-8"))
            if message.get("id") == 1:
                return str(message.get("result", {}).get("result", {}).get("value", ""))
    finally:
        client.close()


def browser_page_title(url: str) -> str:
    """Render a public page with local Edge and return its final document title."""
    executable = edge_executable()
    if not executable:
        raise MonitorError("Microsoft Edge is required to inspect CDOT's public document metadata on this computer.")
    with socket.socket() as reservation:
        reservation.bind(("127.0.0.1", 0))
        port = reservation.getsockname()[1]
    with tempfile.TemporaryDirectory(prefix="roadway-source-monitor-", ignore_cleanup_errors=True) as profile:
        process = subprocess.Popen([executable, "--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check", "--disable-sync", f"--user-data-dir={profile}", f"--remote-debugging-port={port}", url], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            endpoint = f"http://127.0.0.1:{port}/json"
            deadline = time.monotonic() + 20
            websocket_url = ""
            while time.monotonic() < deadline:
                try:
                    with urlopen(endpoint, timeout=2) as response:
                        pages = json.loads(response.read().decode("utf-8"))
                    target_host = urlparse(url).hostname
                    target_docid = re.search(r"(?:[?&])docid=(\d+)", url, flags=re.IGNORECASE)
                    page = next((item for item in pages if item.get("type") == "page" and urlparse(str(item.get("url", ""))).hostname == target_host and (not target_docid or re.search(rf"(?:[?&])docid={target_docid.group(1)}(?:[&#]|$)", str(item.get("url", "")), flags=re.IGNORECASE))), next((item for item in pages if item.get("type") == "page" and str(item.get("url", "")).startswith(url)), next((item for item in pages if item.get("type") == "page"), {})))
                    websocket_url = str(page.get("webSocketDebuggerUrl", ""))
                    if websocket_url:
                        break
                except Exception:
                    time.sleep(.2)
            if not websocket_url:
                raise MonitorError("Microsoft Edge did not start a local metadata probe.")
            title = ""
            title_deadline = time.monotonic() + 15
            while time.monotonic() < title_deadline:
                title = browser_page_title_result(websocket_url)
                if title and not title.lower().startswith("onbase"):
                    break
                time.sleep(.5)
            if not title:
                raise MonitorError("CDOT's public document viewer did not provide a document title.")
            return title
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()


def browser_page_title_result(websocket_url: str) -> str:
    return websocket_evaluate(websocket_url, "document.title")


def cdot_cost_book_coverage(value: str) -> dict[str, str] | None:
    """Extract a CDOT Cost Data Book year and quarter from source metadata."""
    match = re.search(
        r"\b(?P<year>20\d{2})(?:\s*-\s*|\s+)(?:(?P<ordinal>[1-4])(?:st|nd|rd|th)\s*(?:qtr|quarter)|Q(?P<short>[1-4]))\b",
        value,
        flags=re.IGNORECASE,
    )
    if not match:
        return None
    quarter = int(match.group("ordinal") or match.group("short"))
    year = int(match.group("year"))
    return {
        "year": str(year),
        "period": f"{year} Q{quarter}",
        "through": f"{('March', 'June', 'September', 'December')[quarter - 1]} {year}",
        "sortKey": str(year * 4 + quarter),
    }


def hyland_pdfpop_title_record(link: Mapping[str, str], source: Mapping[str, Any], fetcher: Fetcher) -> dict[str, Any]:
    """Read CDOT's rendered OnBase title instead of hashing its changing viewer shell."""
    record = link_record(link, source, fetch_content=False, fetcher=fetcher)
    title = browser_page_title(record["resolvedUrl"])
    coverage = cdot_cost_book_coverage(title)
    if not title or coverage is None:
        raise MonitorError("Official CDOT document viewer did not expose a recognizable Cost Data Book quarter.")
    record.update({
        "recordId": coverage["year"],
        "title": title,
        "period": coverage["period"],
        "coverageThrough": coverage["through"],
        "coverageSortKey": coverage["sortKey"],
        "fingerprint": sha256_bytes(title.lower().encode("utf-8")),
        "metadataTitle": title,
    })
    return record


def archive_record(link: Mapping[str, str], source: Mapping[str, Any], *, fetch_content: bool, fetcher: Fetcher) -> dict[str, Any]:
    config = source.get("config") or {}
    url = normalized_url(link["url"], config.get("ignoredQueryParams", []))
    identity_match = regex_search(config.get("identityPattern"), f"{link.get('text', '')} {url}")
    record_id = canonical_date_identity(identity_match.group(0)) if identity_match else url
    period = canonical_date_identity(f"{link.get('text', '')} {url}") or infer_period(f"{link.get('text', '')} {url}", config)
    record: dict[str, Any] = {
        "recordId": record_id,
        "title": clean_text(link.get("text", "")) or record_id,
        "discoveredUrl": link["url"],
        "resolvedUrl": url,
        "filename": Path(urlparse(url).path).name,
        "period": period,
        "discoveryEvidence": f"{source.get('indexUrl')} -> {link.get('text', '') or link['url']}",
    }
    if fetch_content:
        response = fetcher.fetch(url, {str(item) for item in source["allowedHosts"]})
        record.update({
            "resolvedUrl": response.url,
            "contentLength": len(response.body),
            "etag": response.headers.get("etag", ""),
            "lastModified": response.headers.get("last-modified", ""),
            "sha256": sha256_bytes(response.body),
        })
    return record


def normalized_catalog_records(body: bytes, source: Mapping[str, Any]) -> list[dict[str, Any]]:
    config = source.get("config") or {}
    text_parser = TextParser()
    text_parser.feed(body.decode("utf-8", errors="replace"))
    text = clean_text(" ".join(text_parser.parts))
    code_pattern = config.get("recordPattern")
    records: list[dict[str, Any]] = []
    if code_pattern:
        try:
            matches = list(re.finditer(str(code_pattern), text, flags=re.IGNORECASE))
        except re.error as error:
            raise MonitorError(f"Invalid catalog record pattern: {error}") from error
        for index, match in enumerate(matches):
            code = clean_text(match.group(0)).upper()
            next_match = matches[index + 1] if index + 1 < len(matches) else None
            description = text[match.end(): next_match.start() if next_match else min(len(text), match.end() + 180)]
            description = clean_text(description)[:180]
            semantic = f"{code}|{description.lower()}"
            records.append({"recordId": code, "title": clean_text(f"{code} {description}"), "fingerprint": hashlib.sha256(semantic.encode()).hexdigest()})
    if not records:
        parser = LinkParser()
        parser.feed(body.decode("utf-8", errors="replace"))
        for link in parser.links:
            url = normalized_url(urljoin(str(source["indexUrl"]), link.get("href", "")), config.get("ignoredQueryParams", []))
            if url:
                records.append({"recordId": url, "title": link.get("text", ""), "fingerprint": hashlib.sha256(f"{url}|{link.get('text', '')}".lower().encode()).hexdigest()})
    if not records:
        normalized = re.sub(r"\s+", " ", text).lower()
        if len(normalized) < 40:
            raise MonitorError("Official catalog page did not contain recognizable records.")
        records = [{"recordId": "catalog", "title": str(source.get("label", "Catalog")), "fingerprint": hashlib.sha256(normalized.encode()).hexdigest()}]
    return dedupe_records(records)


def api_records(body: bytes, source: Mapping[str, Any]) -> list[dict[str, Any]]:
    try:
        payload = json.loads(body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise MonitorError(f"Official API did not return valid JSON: {error}") from error
    if not isinstance(payload, list):
        raise MonitorError("Official API did not return a JSON list.")
    config = source.get("config") or {}
    period_field = str(config.get("periodField", "quarter"))
    value_field = str(config.get("valueField", "nhcci"))
    records: list[dict[str, Any]] = []
    for row in payload:
        if not isinstance(row, dict) or not str(row.get(period_field, "")).strip():
            continue
        period = clean_text(str(row.get(period_field, "")))
        value = clean_text(str(row.get(value_field, "")))
        record_id = f"{period}|{value}" if config.get("identityIncludesValue") else period
        records.append({
            "recordId": record_id,
            "title": period,
            "period": period,
            "value": value,
            "fingerprint": hashlib.sha256(f"{period}|{value}".encode()).hexdigest(),
            "discoveryEvidence": str(source.get("indexUrl")),
        })
    if not records:
        raise MonitorError("Official API returned no recognizable period/value records.")
    return dedupe_records(records)


def record_signature(record: Mapping[str, Any], *, compare_fields: Iterable[str] = ()) -> tuple[Any, ...]:
    fields = list(compare_fields) or ["sha256", "fingerprint", "resolvedUrl", "period", "value"]
    return tuple(record.get(field, "") for field in fields)


def compare_records(current: list[dict[str, Any]], baseline: list[dict[str, Any]]) -> dict[str, Any]:
    current_map = {str(row.get("recordId")): row for row in current if row.get("recordId")}
    baseline_map = {str(row.get("recordId")): row for row in baseline if row.get("recordId")}
    new_ids = sorted(set(current_map) - set(baseline_map))
    removed_ids = sorted(set(baseline_map) - set(current_map))
    changed_ids = sorted(record_id for record_id in set(current_map) & set(baseline_map) if not records_equal(current_map[record_id], baseline_map[record_id]))
    if changed_ids:
        status = "Changed"
    elif new_ids:
        status = "New"
    elif removed_ids:
        status = "Removed"
    else:
        status = "Unchanged"
    return {"status": status, "new": [current_map[key] for key in new_ids], "changed": [current_map[key] for key in changed_ids], "removed": [baseline_map[key] for key in removed_ids]}


def records_equal(current: Mapping[str, Any], baseline: Mapping[str, Any]) -> bool:
    """Compare source semantics without treating retrieval metadata as a change."""
    current_hash = current.get("sha256", "")
    baseline_hash = baseline.get("sha256", "")
    if current_hash and baseline_hash:
        return current_hash == baseline_hash
    current_fingerprint = current.get("fingerprint", "")
    baseline_fingerprint = baseline.get("fingerprint", "")
    if current_fingerprint and baseline_fingerprint:
        return current_fingerprint == baseline_fingerprint
    for field in ("period", "value"):
        if current.get(field) and baseline.get(field) and current.get(field) != baseline.get(field):
            return False
    if current.get("comparisonUrl") or baseline.get("comparisonUrl"):
        current_url = current.get("comparisonUrl") or current.get("discoveredUrl") or current.get("resolvedUrl")
        baseline_url = baseline.get("comparisonUrl") or baseline.get("discoveredUrl") or baseline.get("resolvedUrl")
    else:
        current_url = current.get("resolvedUrl") or current.get("discoveredUrl")
        baseline_url = baseline.get("resolvedUrl") or baseline.get("discoveredUrl")
    if current_url and baseline_url and normalized_url(str(current_url)) != normalized_url(str(baseline_url)):
        return False
    return True


def scan_source(source: Mapping[str, Any], root: Path, state: Mapping[str, Any], fetcher: Fetcher | None = None) -> dict[str, Any]:
    fetcher = fetcher or HttpFetcher()
    source_id = str(source["id"])
    started = utc_now()
    local_entry = (state.get("sources") or {}).get(source_id, {}) if isinstance(state, Mapping) else {}
    try:
        override = (state.get("overrides") or {}).get(source_id) if isinstance(state, Mapping) else None
        index_url = str(override or source["indexUrl"])
        allowed_hosts = {str(item) for item in source["allowedHosts"]}
        validate_url(index_url, allowed_hosts)
        index_response = fetcher.fetch(index_url, allowed_hosts, max_bytes=int((source.get("config") or {}).get("indexMaxBytes", DEFAULT_MAX_BYTES)))
        source_type = source["sourceType"]
        config = source.get("config") or {}
        application_records = repository_baseline(root, source)
        needs_content_hash = bool(config.get("hashEveryRecord", source_type == "linked_documents"))
        if source_type in {"linked_documents", "archive_entries"}:
            links = parse_links(index_response.body, index_response.url)
            links = [link for link in links if link_matches(link, config)]
            links = [link for link in links if normalized_url(link["url"]) != normalized_url(index_response.url)]
            if not links:
                raise MonitorError("Official index loaded but no configured publication or archive links were recognized.")
            publication_years = [
                int(value)
                for link in links
                for value in re.findall(r"\b20\d{2}\b", f"{link.get('text', '')} {link.get('url', '')}")
            ]
            newest_publication_year = max(publication_years, default=0)
            record_factory = link_record if source_type == "linked_documents" else archive_record
            prior_records = local_entry.get("records") or application_records
            prior_map = {str(row.get("recordId")): row for row in prior_records if row.get("recordId")}
            records = []
            for link in links:
                preliminary = record_factory(link, source, fetch_content=False, fetcher=fetcher)
                minimum_year = int(config.get("minYear", 0) or 0)
                if minimum_year:
                    years = [int(value) for value in re.findall(r"\b20\d{2}\b", f"{link.get('text', '')} {link.get('url', '')}")]
                    if years and max(years) < minimum_year:
                        continue
                if config.get("currentYearOnly") and newest_publication_year and not re.search(rf"\b{newest_publication_year}\b", f"{link.get('text', '')} {link.get('url', '')}"):
                    continue
                is_new = preliminary["recordId"] not in prior_map
                hash_patterns = config.get("hashPatterns") or []
                targeted_hash = bool(hash_patterns) and any(regex_search(str(pattern), f"{link.get('text', '')} {link.get('url', '')}") for pattern in hash_patterns)
                should_hash = needs_content_hash or targeted_hash or (is_new and bool(config.get("hashNewRecords", True)))
                records.append(hyland_pdfpop_title_record(link, source, fetcher) if config.get("documentProbe") == "hyland_pdfpop_title" else record_factory(link, source, fetch_content=should_hash, fetcher=fetcher))
        elif source_type == "html_catalog":
            catalog_response = index_response
            post_form = config.get("postForm")
            if post_form:
                inputs = parse_form_inputs(index_response.body)
                fields: dict[str, str] = {}
                for key, value in (post_form.get("fields") or {}).items():
                    fields[str(key)] = inputs.get(str(value)[len("__FORM_INPUT__:"):], "") if str(value).startswith("__FORM_INPUT__:") else str(value)
                if any(not value for key, value in fields.items() if str(key).startswith("__VIEWSTATE") or str(key) == "__EVENTVALIDATION"):
                    raise MonitorError("Official catalog form did not expose the required hidden fields.")
                catalog_response = fetcher.fetch(index_response.url, allowed_hosts, max_bytes=int(post_form.get("maxBytes", DEFAULT_MAX_BYTES)), data=urlencode(fields).encode("utf-8"))
            records = normalized_catalog_records(catalog_response.body, source)
            minimum = int(config.get("minRecords", 0) or 0)
            if minimum and len(records) < minimum:
                raise MonitorError(f"Official catalog result contained {len(records):,} record(s); at least {minimum:,} were expected.")
            prior_records = local_entry.get("records") or application_records
        elif source_type == "api_records":
            records = api_records(index_response.body, source)
            prior_records = local_entry.get("records") or application_records
        else:
            raise MonitorError(f"Unsupported source type {source_type}.")
        records = dedupe_records(records)
        baseline_available = bool(prior_records)
        comparison = compare_records(records, prior_records) if baseline_available else {"status": "Baseline needed", "new": records, "changed": [], "removed": []}
        if not config.get("reportRemoved", True):
            comparison["removed"] = []
            if comparison["status"] == "Removed":
                comparison["status"] = "Unchanged"
        result = {
            "sourceId": source_id,
            "state": source["state"],
            "agency": source["agency"],
            "label": source["label"],
            "status": comparison["status"],
            "startedAt": started,
            "completedAt": utc_now(),
            "indexUrl": index_response.url,
            "discoveredCount": len(records),
            "baselineCount": len(prior_records),
            "new": comparison["new"],
            "changed": comparison["changed"],
            "removed": comparison["removed"],
            "records": records,
            "importer": source.get("importer", ""),
            "message": status_message(comparison["status"], len(records), len(prior_records)),
        }
        if config.get("documentProbe") == "hyland_pdfpop_title":
            official = max(records, key=lambda record: int(record.get("coverageSortKey") or 0), default=None)
            loaded = max(application_records, key=lambda record: int(record.get("coverageSortKey") or 0), default=None)
            if official:
                result["officialCoverage"] = official.get("period", "")
                result["officialCoverageThrough"] = official.get("coverageThrough", "")
            if loaded:
                result["applicationCoverage"] = loaded.get("period", "")
                result["applicationCoverageThrough"] = loaded.get("coverageThrough", "")
            if official and loaded and int(official.get("coverageSortKey") or 0) > int(loaded.get("coverageSortKey") or 0):
                result["status"] = "Changed"
                result["changed"] = result["changed"] or [official]
                result["message"] = (
                    f"Official CDOT document metadata identifies {official['period']} (through {official['coverageThrough']}); "
                    f"loaded application Cost Data Book data ends at {loaded['period']} (through {loaded['coverageThrough']})."
                )
        result["importRequest"] = build_import_request(source, result) if comparison["status"] in {"New", "Changed", "Removed", "Review required"} else ""
        if result["status"] == "Changed" and not result["importRequest"]:
            result["importRequest"] = build_import_request(source, result)
        return result
    except MonitorError as error:
        error_text = str(error).lower()
        unavailable = error_text.startswith(("could not fetch", "http ", "timed out", "response exceeded"))
        return {
            "sourceId": source_id,
            "state": source.get("state", ""),
            "agency": source.get("agency", ""),
            "label": source.get("label", source_id),
            "status": "Unavailable" if unavailable else "Review required",
            "startedAt": started,
            "completedAt": utc_now(),
            "indexUrl": source.get("indexUrl", ""),
            "discoveredCount": 0,
            "baselineCount": len(local_entry.get("records") or repository_baseline(root, source)),
            "new": [], "changed": [], "removed": [], "records": [],
            "importer": source.get("importer", ""),
            "message": str(error),
        }
    except Exception as error:
        return {
            "sourceId": source_id, "state": source.get("state", ""), "agency": source.get("agency", ""), "label": source.get("label", source_id),
            "status": "Review required", "startedAt": started, "completedAt": utc_now(), "indexUrl": source.get("indexUrl", ""),
            "discoveredCount": 0, "baselineCount": 0, "new": [], "changed": [], "removed": [], "records": [], "importer": source.get("importer", ""),
            "message": f"Unexpected scanner error: {error}",
        }


def status_message(status: str, discovered: int, baseline: int) -> str:
    if status == "Baseline needed":
        return f"Discovered {discovered} record(s); save a local baseline before the next comparison."
    if status == "Unchanged":
        return f"Compared {discovered} discovered record(s) with {baseline} baseline record(s)."
    return f"{status}: {discovered} discovered record(s), {baseline} baseline record(s)."


def scan_all(sources: list[dict[str, Any]], root: Path, state: Mapping[str, Any], fetcher: Fetcher | None = None, progress: Any = None) -> list[dict[str, Any]]:
    results: list[dict[str, Any]] = []
    for source in sources:
        if not source.get("enabled", True):
            continue
        if progress:
            progress(source["id"], "Scanning")
        result = scan_source(source, root, state, fetcher)
        results.append(result)
        if progress:
            progress(source["id"], result["status"], result)
    return results


def build_import_request(source: Mapping[str, Any], result: Mapping[str, Any]) -> str:
    actionable = list(result.get("new", [])) + list(result.get("changed", []))
    lines = [
        f"Refresh {source.get('state', '')} {source.get('agency', '')} {source.get('label', '')}.",
        "",
        f"Official index: {result.get('indexUrl') or source.get('indexUrl', '')}",
        f"Importer: {source.get('importer') or 'Review the source-specific importer before changing data.'}",
        "",
        "Discovered updates:",
    ]
    for record in actionable:
        lines.append(f"- {record.get('title') or record.get('recordId')}: {record.get('resolvedUrl') or record.get('discoveredUrl')}")
        if record.get("period"):
            lines.append(f"  Period: {record['period']}")
        if record.get("sha256"):
            lines.append(f"  Current SHA-256: {record['sha256']}")
    if not actionable:
        lines.append("- Review the scan result and inspect the official source page.")
    lines.extend([
        "",
        "Download the current official source live, inspect its format, use the established staging and promotion workflow, run the relevant validation and reconciliation checks, and report any source-format or award-resolution issues. Do not treat this request as authorization to commit or publish data.",
    ])
    return "\n".join(lines)
