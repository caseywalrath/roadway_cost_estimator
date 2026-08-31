from __future__ import annotations

import argparse
import json
import threading
import uuid
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlparse

from .scanner import HttpFetcher, MonitorError, build_import_request, load_registry, scan_all


PACKAGE_DIR = Path(__file__).resolve().parent
REPOSITORY_ROOT = PACKAGE_DIR.parents[1]
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 4180
STATE_PATH = REPOSITORY_ROOT / "data" / "raw" / "source_monitor" / "scan_state.json"


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


class MonitorApp:
    def __init__(self, root: Path = REPOSITORY_ROOT, *, registry_path: Path | None = None, state_path: Path | None = None, fetcher: Any = None) -> None:
        self.root = root.resolve()
        self.registry_path = registry_path or self.root / "tools" / "source_monitor" / "source_registry.json"
        self.state_path = state_path or self.root / "data" / "raw" / "source_monitor" / "scan_state.json"
        self.fetcher = fetcher or HttpFetcher()
        (self.state_path.parent / "cache").mkdir(parents=True, exist_ok=True)
        self.lock = threading.RLock()
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="source-monitor")
        self.runs: dict[str, dict[str, Any]] = {}
        self.active_run_id: str | None = None
        self.registry_error = ""
        try:
            self.registry = load_registry(self.registry_path)
        except MonitorError as error:
            self.registry = []
            self.registry_error = str(error)
        self.state = self._load_state()

    def _load_state(self) -> dict[str, Any]:
        if not self.state_path.exists():
            return {"version": 1, "overrides": {}, "sources": {}}
        try:
            payload = json.loads(self.state_path.read_text(encoding="utf-8"))
            if isinstance(payload, dict):
                payload.setdefault("version", 1)
                payload.setdefault("overrides", {})
                payload.setdefault("sources", {})
                return payload
        except (OSError, UnicodeError, json.JSONDecodeError):
            pass
        return {"version": 1, "overrides": {}, "sources": {}}

    def _write_state(self) -> None:
        self.state_path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        temporary.replace(self.state_path)

    def source_payload(self) -> dict[str, Any]:
        with self.lock:
            latest_by_source: dict[str, Any] = {}
            for run in self.runs.values():
                for result in run.get("results", []):
                    latest_by_source[result["sourceId"]] = result
            saved_sources = self.state.get("sources", {})
            return {
                "sources": [
                    {
                        **source,
                        "latest": latest_by_source.get(source["id"]),
                        "localBaseline": ({
                            "savedAt": saved_sources[source["id"]].get("savedAt", ""),
                            "recordCount": len(saved_sources[source["id"]].get("records", [])),
                        } if source["id"] in saved_sources else None),
                    }
                    for source in self.registry
                ],
                "lastSuccessfulScan": self.state.get("lastSuccessfulScan", ""),
                "activeScanId": self.active_run_id,
                "registryError": self.registry_error,
            }

    def start_scan(self) -> tuple[dict[str, Any], bool]:
        with self.lock:
            if self.registry_error:
                return {"error": self.registry_error}, False
            if self.active_run_id and self.runs.get(self.active_run_id, {}).get("status") == "running":
                return self.runs[self.active_run_id], False
            run_id = uuid.uuid4().hex
            sources = [source for source in self.registry if source.get("enabled", True)]
            run = {
                "scanId": run_id,
                "status": "running",
                "startedAt": now(),
                "completedAt": "",
                "total": len(sources),
                "completed": 0,
                "progress": {source["id"]: {"status": "Queued", "label": source["label"]} for source in sources},
                "results": [],
                "error": "",
            }
            self.runs[run_id] = run
            self.active_run_id = run_id
            self.executor.submit(self._run_scan, run_id, sources, json.loads(json.dumps(self.state)))
            return run, True

    def _run_scan(self, run_id: str, sources: list[dict[str, Any]], state: dict[str, Any]) -> None:
        def progress(source_id: str, status: str, result: dict[str, Any] | None = None) -> None:
            with self.lock:
                run = self.runs.get(run_id)
                if not run:
                    return
                run["progress"][source_id] = {"status": status, "label": next((item["label"] for item in sources if item["id"] == source_id), source_id)}
                if result:
                    run["progress"][source_id]["result"] = result
                terminal = {"New", "Changed", "Unchanged", "Removed", "Unavailable", "Review required", "Baseline needed"}
                run["completed"] = sum(1 for item in run["progress"].values() if item.get("status") in terminal)

        try:
            results = scan_all(sources, self.root, state, self.fetcher, progress)
            with self.lock:
                run = self.runs[run_id]
                run["results"] = results
                run["completed"] = len(results)
                run["status"] = "completed"
                run["completedAt"] = now()
                # Individual source failures remain in their results and never
                # overwrite baselines or qualify the run as fully successful.
                self.state["lastCompletedScan"] = run["completedAt"]
                if results and all(result.get("status") not in {"Unavailable", "Review required"} for result in results):
                    self.state["lastSuccessfulScan"] = run["completedAt"]
                self._write_state()
                for result in results:
                    run["progress"][result["sourceId"]] = {"status": result["status"], "label": result["label"], "result": result}
                self.active_run_id = None
        except Exception as error:
            with self.lock:
                run = self.runs[run_id]
                run["status"] = "failed"
                run["completedAt"] = now()
                run["error"] = str(error)
                self.active_run_id = None

    def get_scan(self, scan_id: str) -> dict[str, Any] | None:
        with self.lock:
            return self.runs.get(scan_id)

    def save_baseline(self, source_id: str, scan_id: str | None = None) -> dict[str, Any]:
        with self.lock:
            source = next((item for item in self.registry if item["id"] == source_id), None)
            if source is None:
                raise MonitorError(f"Unknown source: {source_id}")
            run = self.runs.get(scan_id or "") if scan_id else None
            if run is None:
                completed_runs = [item for item in self.runs.values() if item.get("status") == "completed"]
                run = max(completed_runs, key=lambda item: item.get("completedAt", ""), default=None)
            result = next((item for item in (run or {}).get("results", []) if item.get("sourceId") == source_id), None)
            if result is None:
                raise MonitorError("Run a successful scan for this source before saving a baseline.")
            if result.get("status") in {"Unavailable", "Review required"}:
                raise MonitorError("Unavailable or review-required results cannot replace a baseline.")
            self.state.setdefault("sources", {})[source_id] = {
                "savedAt": now(),
                "records": result.get("records", []),
                "indexUrl": result.get("indexUrl", source.get("indexUrl", "")),
            }
            self._write_state()
            return {"sourceId": source_id, "savedAt": self.state["sources"][source_id]["savedAt"], "recordCount": len(result.get("records", []))}

    def set_override(self, source_id: str, value: str) -> dict[str, Any]:
        with self.lock:
            source = next((item for item in self.registry if item["id"] == source_id), None)
            if source is None:
                raise MonitorError(f"Unknown source: {source_id}")
            from .scanner import validate_url
            validate_url(value, {str(item) for item in source["allowedHosts"]})
            self.state.setdefault("overrides", {})[source_id] = value
            self._write_state()
            return {"sourceId": source_id, "override": value}


class MonitorHandler(BaseHTTPRequestHandler):
    server_version = "RoadwaySourceMonitor/1.0"

    @property
    def app(self) -> MonitorApp:
        return getattr(self.server, "monitor_app")

    def log_message(self, format: str, *args: Any) -> None:
        # Keep the launcher window readable; errors are returned in the JSON API.
        return

    def send_json(self, payload: Any, status: int = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/api/health":
            self.send_json({"ok": True, "host": self.server.server_address[0], "port": self.server.server_address[1], "scanRunning": bool(self.app.active_run_id), "registryError": self.app.registry_error})
            return
        if parsed.path == "/api/sources":
            self.send_json(self.app.source_payload())
            return
        if parsed.path.startswith("/api/scans/"):
            scan_id = unquote(parsed.path.rsplit("/", 1)[-1])
            run = self.app.get_scan(scan_id)
            self.send_json(run or {"error": "Scan not found."}, HTTPStatus.OK if run else HTTPStatus.NOT_FOUND)
            return
        self.serve_static(parsed.path)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        payload = self.read_json()
        try:
            if parsed.path == "/api/scans":
                run, _created = self.app.start_scan()
                self.send_json(run, HTTPStatus.ACCEPTED if run.get("scanId") else HTTPStatus.BAD_REQUEST)
                return
            if parsed.path.startswith("/api/sources/") and parsed.path.endswith("/baseline"):
                source_id = unquote(parsed.path[len("/api/sources/"):-len("/baseline")].strip("/"))
                self.send_json(self.app.save_baseline(source_id, (payload or {}).get("scanId")))
                return
            if parsed.path.startswith("/api/sources/") and parsed.path.endswith("/override"):
                source_id = unquote(parsed.path[len("/api/sources/"):-len("/override")].strip("/"))
                self.send_json(self.app.set_override(source_id, str((payload or {}).get("url", ""))))
                return
            self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
        except MonitorError as error:
            self.send_json({"error": str(error)}, HTTPStatus.BAD_REQUEST)

    def read_json(self) -> dict[str, Any]:
        length = min(int(self.headers.get("Content-Length", "0") or 0), 100_000)
        if length <= 0:
            return {}
        try:
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            return payload if isinstance(payload, dict) else {}
        except (UnicodeDecodeError, json.JSONDecodeError):
            return {}

    def serve_static(self, path: str) -> None:
        relative = "index.html" if path in {"", "/"} else unquote(path.lstrip("/"))
        static_root = PACKAGE_DIR / "static"
        target = (static_root / relative).resolve()
        if static_root not in target.parents and target != static_root:
            self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return
        if not target.is_file():
            self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
            return
        content_types = {".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8"}
        body = target.read_bytes()
        self.send_response(HTTPStatus.OK)
        self.send_header("Content-Type", content_types.get(target.suffix, "application/octet-stream"))
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def create_server(app: MonitorApp, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> ThreadingHTTPServer:
    server = ThreadingHTTPServer((host, port), MonitorHandler)
    server.monitor_app = app  # type: ignore[attr-defined]
    return server


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the local Roadway Cost Estimator data source monitor.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", default=DEFAULT_PORT, type=int)
    parser.add_argument("--root", default=str(REPOSITORY_ROOT), type=Path)
    parser.add_argument("--open", action="store_true", help="Open the monitor in the default browser after binding.")
    args = parser.parse_args()
    if args.host != DEFAULT_HOST:
        parser.error("The monitor must bind to 127.0.0.1.")
    app = MonitorApp(args.root)
    if app.registry_error:
        print(f"Registry error: {app.registry_error}")
    try:
        server = create_server(app, args.host, args.port)
    except OSError as error:
        print(f"Could not bind http://{args.host}:{args.port}/. Port may already be in use: {error}")
        raise SystemExit(1) from error
    url = f"http://{args.host}:{args.port}/"
    print(f"Roadway Cost Estimator Data Source Monitor: {url}")
    print("Press Ctrl+C in this window to stop the monitor.")
    if args.open:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("Stopping monitor.")
    finally:
        server.shutdown()
        server.server_close()
        app.executor.shutdown(wait=False, cancel_futures=True)


if __name__ == "__main__":
    main()
