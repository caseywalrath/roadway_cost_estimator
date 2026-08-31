from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from tools.source_monitor.scanner import (
    FetchResponse,
    MonitorError,
    compare_records,
    load_registry,
    normalized_catalog_records,
    scan_source,
    validate_url,
)


FIXTURES = Path(__file__).parent / "fixtures"


class FixtureFetcher:
    def __init__(self, responses: dict[str, bytes | Exception]) -> None:
        self.responses = responses
        self.calls: list[str] = []

    def fetch(self, url: str, allowed_hosts: set[str], *, max_bytes: int = 25 * 1024 * 1024) -> FetchResponse:
        self.calls.append(url)
        value = self.responses.get(url)
        if isinstance(value, Exception):
            raise value
        if value is None:
            raise MonitorError(f"Could not fetch fixture {url}")
        return FetchResponse(url, 200, {"content-type": "text/html"}, value)


def source(source_type: str, *, source_id: str = "test_source", index_url: str = "https://agency.example/index") -> dict[str, object]:
    return {
        "id": source_id,
        "state": "TEST",
        "agency": "Agency",
        "label": "Test source",
        "sourceType": source_type,
        "indexUrl": index_url,
        "allowedHosts": ["agency.example", "files.example"],
        "importer": "scripts/test_import.py",
        "enabled": True,
        "config": {},
        "baseline": {"paths": []},
    }


class ScannerTests(unittest.TestCase):
    def test_registry_has_all_supported_sources_and_valid_hosts(self) -> None:
        entries = load_registry(Path("tools/source_monitor/source_registry.json"))
        self.assertEqual(13, len(entries))
        self.assertEqual({"CO", "IA", "NE", "SD", "Shared"}, {entry["state"] for entry in entries})
        self.assertTrue(all(entry["allowedHosts"] for entry in entries))

    def test_cdot_hyland_link_and_stable_document_hash_change(self) -> None:
        index = "https://agency.example/cdot"
        document = "https://files.example/document.pdf?docid=1"
        item = source("linked_documents", index_url=index)
        item["allowedHosts"] = ["agency.example", "files.example"]
        item["config"] = {"includePatterns": ["cost data"], "identityMode": "url", "hashEveryRecord": True}
        fetcher = FixtureFetcher({index: (FIXTURES / "cdot_index.html").read_bytes(), "https://oitco.hylandcloud.com/2273/Process/DownloadDocument?docid=67264216": b"new pdf bytes"})
        item["indexUrl"] = "https://agency.example/cdot"
        # The fixture uses the production Hyland host; explicitly allow it for this source test.
        item["allowedHosts"] = ["agency.example", "oitco.hylandcloud.com"]
        baseline_url = "https://oitco.hylandcloud.com/2273/Process/DownloadDocument?docid=67264216"
        result = scan_source(item, Path("."), {"sources": {"test_source": {"records": [{"recordId": baseline_url, "sha256": "old"}]}}}, fetcher)
        self.assertEqual("Changed", result["status"])
        self.assertEqual(1, len(result["changed"]))
        self.assertIn("hyland", result["changed"][0]["resolvedUrl"].lower())

    def test_iowa_archive_detects_new_letting_without_hashing_existing_archive(self) -> None:
        index = "https://agency.example/iowa"
        item = source("archive_entries", index_url=index)
        item["config"] = {"includePatterns": ["bid tab"], "identityPattern": r"\b\d{1,2}/\d{1,2}/\d{2}\b", "hashNewRecords": False, "ignoredQueryParams": ["inline"]}
        fetcher = FixtureFetcher({index: (FIXTURES / "ia_archive.html").read_bytes()})
        state = {"sources": {"test_source": {"records": [{"recordId": "2026-01-21", "resolvedUrl": "https://agency.example/media/100/download"}]}}}
        result = scan_source(item, Path("."), state, fetcher)
        self.assertEqual("New", result["status"])
        self.assertEqual(["2026-02-10"], [row["recordId"] for row in result["new"]])
        self.assertEqual([index], fetcher.calls)

    def test_nebraska_listing_contains_both_report_series(self) -> None:
        index = "https://agency.example/ne"
        item = source("linked_documents", index_url=index)
        item["config"] = {"includePatterns": ["average", "price"], "identityMode": "url", "hashEveryRecord": False}
        fetcher = FixtureFetcher({
            index: (FIXTURES / "ne_listing.html").read_bytes(),
            "https://agency.example/media/a/aup-january-2025-december-2025.pdf": b"calendar report",
            "https://agency.example/media/b/aup-july-2025-june-2026.pdf": b"july-june report",
        })
        result = scan_source(item, Path("."), {"sources": {}}, fetcher)
        self.assertEqual("Baseline needed", result["status"])
        self.assertEqual(2, result["discoveredCount"])

    def test_south_dakota_catalog_reordering_is_unchanged(self) -> None:
        item = source("html_catalog", index_url="https://agency.example/sd")
        item["config"] = {"recordPattern": r"\b\d{3}E\d{4}\b"}
        first = normalized_catalog_records((FIXTURES / "sd_catalog_a.html").read_bytes(), item)
        second = normalized_catalog_records((FIXTURES / "sd_catalog_b.html").read_bytes(), item)
        self.assertEqual("Unchanged", compare_records(second, first)["status"])

    def test_nhcci_new_quarter(self) -> None:
        index = "https://agency.example/nhcci"
        item = source("api_records", index_url=index)
        item["config"] = {"periodField": "quarter", "valueField": "nhcci"}
        fetcher = FixtureFetcher({index: (FIXTURES / "nhcci.json").read_bytes()})
        state = {"sources": {"test_source": {"records": [{"recordId": "2026 Q1", "period": "2026 Q1", "value": "2.123"}]}}}
        result = scan_source(item, Path("."), state, fetcher)
        self.assertEqual("New", result["status"])
        self.assertEqual("2026 Q2", result["new"][0]["recordId"])

    def test_redirect_to_unapproved_host_is_blocked(self) -> None:
        with self.assertRaises(MonitorError):
            validate_url("https://unapproved.example/file.pdf", {"agency.example"})

    def test_unavailable_and_malformed_sources_are_not_unchanged(self) -> None:
        unavailable = source("linked_documents", index_url="https://agency.example/down")
        unavailable["config"] = {"includePatterns": ["pdf"]}
        failed = FixtureFetcher({"https://agency.example/down": MonitorError("Could not fetch source: timeout")})
        self.assertEqual("Unavailable", scan_source(unavailable, Path("."), {"sources": {}}, failed)["status"])

        malformed = source("archive_entries", index_url="https://agency.example/malformed")
        malformed["config"] = {"includePatterns": ["bid"]}
        malformed_fetcher = FixtureFetcher({"https://agency.example/malformed": (FIXTURES / "malformed.html").read_bytes()})
        self.assertEqual("Review required", scan_source(malformed, Path("."), {"sources": {}}, malformed_fetcher)["status"])

    def test_first_scan_requires_explicit_baseline(self) -> None:
        item = source("api_records", index_url="https://agency.example/nhcci")
        item["config"] = {"periodField": "quarter", "valueField": "nhcci"}
        fetcher = FixtureFetcher({"https://agency.example/nhcci": (FIXTURES / "nhcci.json").read_bytes()})
        result = scan_source(item, Path("."), {"sources": {}}, fetcher)
        self.assertEqual("Baseline needed", result["status"])
        self.assertEqual(2, len(result["new"]))

    def test_source_registry_json_is_valid_json(self) -> None:
        json.loads(Path("tools/source_monitor/source_registry.json").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
