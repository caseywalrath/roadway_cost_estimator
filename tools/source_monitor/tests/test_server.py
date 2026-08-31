from __future__ import annotations

import json
import threading
import time
import unittest
import uuid
from pathlib import Path
from urllib.request import Request, urlopen

from tools.source_monitor.scanner import FetchResponse, MonitorError
from tools.source_monitor.server import MonitorApp, create_server


class FakeFetcher:
    def fetch(self, url: str, allowed_hosts: set[str], *, max_bytes: int = 25 * 1024 * 1024) -> FetchResponse:
        if url.endswith("/index"):
            return FetchResponse(url, 200, {"content-type": "application/json"}, b'[{"quarter":"2026 Q1","nhcci":"2.1"}]')
        raise MonitorError("Could not fetch document")


class ServerTests(unittest.TestCase):
    def test_health_static_scan_and_explicit_baseline_routes(self) -> None:
        root = Path("tmp") / f"source_monitor_test_{uuid.uuid4().hex}"
        root.mkdir(parents=True, exist_ok=True)
        registry_path = root / "registry.json"
        registry_path.write_text(json.dumps({"sources": [{
                "id": "fixture_api", "state": "Shared", "agency": "FHWA", "label": "Fixture NHCCI",
                "sourceType": "api_records", "indexUrl": "https://agency.example/index", "allowedHosts": ["agency.example"],
                "importer": "scripts/refresh_nhcci_index.py", "enabled": True,
                "baseline": {"paths": []}, "config": {"periodField": "quarter", "valueField": "nhcci"}
        }]}), encoding="utf-8")
        state_path = root / "scan_state.json"
        app = MonitorApp(root, registry_path=registry_path, state_path=state_path, fetcher=FakeFetcher())
        server = create_server(app, port=0)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
                health = json.loads(urlopen(f"{base}/api/health").read())
                self.assertTrue(health["ok"])
                self.assertEqual("127.0.0.1", health["host"])
                self.assertIn("Data Source Monitor", urlopen(f"{base}/").read().decode())

                run = json.loads(urlopen(Request(f"{base}/api/scans", method="POST")).read())
                for _ in range(50):
                    current = json.loads(urlopen(f"{base}/api/scans/{run['scanId']}").read())
                    if current["status"] != "running":
                        break
                    time.sleep(.02)
                self.assertEqual("completed", current["status"])
                self.assertEqual("Baseline needed", current["results"][0]["status"])

                request = Request(f"{base}/api/sources/fixture_api/baseline", data=json.dumps({"scanId": run["scanId"]}).encode(), headers={"Content-Type": "application/json"}, method="POST")
                saved = json.loads(urlopen(request).read())
                self.assertEqual("fixture_api", saved["sourceId"])
                self.assertTrue(state_path.exists())
                sources = json.loads(urlopen(f"{base}/api/sources").read())
                self.assertEqual(saved["savedAt"], sources["sources"][0]["localBaseline"]["savedAt"])
                self.assertEqual(1, sources["sources"][0]["localBaseline"]["recordCount"])
        finally:
            server.shutdown()
            server.server_close()
            app.executor.shutdown(wait=True)

    def test_failed_scan_cannot_replace_successful_baseline(self) -> None:
        root = Path("tmp") / f"source_monitor_baseline_test_{uuid.uuid4().hex}"
        root.mkdir(parents=True, exist_ok=True)
        registry_path = root / "registry.json"
        registry_path.write_text(json.dumps({"sources": [{
            "id": "fixture_api", "state": "Shared", "agency": "FHWA", "label": "Fixture NHCCI",
            "sourceType": "api_records", "indexUrl": "https://agency.example/index", "allowedHosts": ["agency.example"],
            "importer": "scripts/refresh_nhcci_index.py", "enabled": True, "baseline": {"paths": []},
            "config": {"periodField": "quarter", "valueField": "nhcci"}
        }]}), encoding="utf-8")
        state_path = root / "scan_state.json"
        app = MonitorApp(root, registry_path=registry_path, state_path=state_path, fetcher=FakeFetcher())
        app.state["sources"] = {"fixture_api": {"savedAt": "before", "records": [{"recordId": "2026 Q1", "value": "2.1"}]}}
        app._write_state()
        original = state_path.read_text(encoding="utf-8")
        app.runs["failed-run"] = {"status": "completed", "completedAt": "2026-08-31T00:00:00+00:00", "results": [{"sourceId": "fixture_api", "status": "Unavailable", "records": []}]}
        with self.assertRaises(MonitorError):
            app.save_baseline("fixture_api", "failed-run")
        self.assertEqual(original, state_path.read_text(encoding="utf-8"))
        app.executor.shutdown(wait=True)


if __name__ == "__main__":
    unittest.main()
