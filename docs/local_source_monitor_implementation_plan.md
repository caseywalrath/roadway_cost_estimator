# Local Data Source Monitor Implementation Plan

## Status

Active implementation plan. This plan is intended for a new coding-agent session. Implement the complete first version for all currently supported states in one branch and one pull request.

## Objective

Build a repository-tracked, localhost-only Data Source Monitor that lets the developer scan official transportation data sources by clicking **Scan Now**.

The monitor must identify new or changed source documents and archive entries. It must not import, normalize, commit, or publish application data. The developer will use the scan results to begin a separate agent-assisted download and import session.

The monitor code belongs in this repository. Temporary responses, downloaded comparison files, hashes created during scans, and local scan state do not belong in Git.

## Required Reading Before Implementation

Read these files completely before changing code:

1. `codex.md`
2. `architecture_overview.md`
3. `docs/multistate_data_architecture.md`
4. `docs/implementation_notes.md`
5. The import scripts named under **Existing Source Knowledge** below

Follow the branch, verification, and OneDrive-safe command rules in `codex.md`. Do not modify or combine unrelated user changes.

## Product Decision

Implement the monitor as a small local Python web application with a browser UI. Do not add it to the production Vite application and do not publish it through GitHub Pages.

The local monitor must:

- Bind only to `127.0.0.1`.
- Default to port `4180`.
- Open in the user's default browser from a double-clickable Windows launcher.
- Scan only registry-defined official sources.
- Perform outbound HTTP requests in Python, not in browser JavaScript.
- Remain read-only with respect to app-loaded and staging data.
- Keep local scan state below a Git-ignored path.
- Work without a GitHub Actions schedule or hosted service.

## User Workflow

1. The developer double-clicks `Start Data Source Monitor.cmd` at the repository root.
2. The launcher starts the localhost server and opens `http://127.0.0.1:4180/`.
3. The page lists every configured source grouped by state and agency.
4. The developer clicks **Scan Now**.
5. The UI shows progress and then reports `New`, `Changed`, `Unchanged`, `Removed`, `Unavailable`, or `Review required` for each source.
6. A changed result provides:
   - the official index or source page;
   - the discovered document URL or archive entry;
   - the previous and current identifiers or hashes;
   - the detected publication period when it can be established safely;
   - the relevant repository importer;
   - a **Copy import request** action.
7. The developer pastes that request into a new coding-agent session. The coding agent downloads the current source live and performs the existing reviewed import workflow.

The monitor must not expose a button that runs an importer in version 1.

## Required Repository Structure

Create this structure unless an existing repository convention requires a small adjustment:

```text
tools/
  source_monitor/
    __init__.py
    server.py
    scanner.py
    source_registry.json
    static/
      index.html
      monitor.css
      monitor.js
    tests/
      fixtures/
      test_scanner.py
      test_server.py
Start Data Source Monitor.cmd
```

Use this ignored local state location:

```text
data/raw/source_monitor/
  scan_state.json
  cache/
```

Confirm that `data/raw/` is already ignored. Add a narrow ignore rule only if the existing rule does not cover this path.

Do not add a JavaScript build step for the monitor. Use plain HTML, CSS, and JavaScript served by the Python process.

## Runtime and Dependency Constraints

Prefer the Python standard library:

- `http.server` or an equivalently small local server
- `urllib.request`
- `html.parser`
- `hashlib`
- `json`
- `pathlib`
- `webbrowser`
- `threading` or a bounded executor for parallel scans

Use an existing repository dependency only when it is already required and materially improves reliability. Do not introduce Flask, FastAPI, Node, Electron, or another application framework for this tool without documenting why the standard library cannot satisfy a requirement.

Set a descriptive HTTP `User-Agent`. Use finite connection/read timeouts. Limit redirects and response sizes. Do not disable TLS verification.

## Source Discovery Policy

The implementation agent must try to locate the current official source pages rather than assume every URL in this plan is permanent.

Use this discovery order for each source:

1. Inspect source constants and provenance URLs already present in repository scripts and committed data.
2. Open the known official index URL and locate its current data/document links.
3. If the known page moved, search only the official agency domain for the named publication or archive.
4. If the user supplied a URL in the session, treat it as a starting URL and verify that it is controlled by the agency or its documented content host.
5. Record the final index URL, discovery rule, allowed hosts, and relevant importer in `source_registry.json`.
6. If no authoritative source can be confirmed, configure the entry as `Review required` with a clear reason. Do not substitute a third-party source.

The scanner must follow links to an agency's documented file host when necessary. For example, CDOT currently uses a Hyland OnBase host for Cost Data Book documents. The registry must explicitly allow each required host; redirects to unlisted hosts must fail safely as `Review required`.

Do not hard-code the current calendar year into a parser. Match publication families and extract years or dates from page content, link labels, URLs, or document content.

## Existing Source Knowledge

The following URLs are starting points, not guarantees. Verify them during implementation.

### Colorado

CDOT Cost Data Book index:

```text
https://www.codot.gov/business/eema/costdatabook
```

CDOT Item Code Book index:

```text
https://www.codot.gov/business/eema/itemcodebook
```

Existing code:

- `scripts/parse_cdot_cost_data_book.py`
- `scripts/promote_cdot_cost_data_book.py`
- `scripts/import_cdot_item_code_book.py`

Monitor both the index membership and the content hash of each current/relevant linked document. CDOT may keep a stable link or document identifier while replacing the underlying PDF or workbook. Visible labels such as `Full Year` are not sufficient evidence of the actual coverage period.

### Iowa

Bid-tab archive:

```text
https://iowadot.gov/consultants-contractors/contracts/historical-completed-lettings/bid-tabulations
```

Bid Item Information:

```text
https://iowadot.gov/consultants-contractors/contracts/general-letting-information/bid-item-information
```

Electronic Reference Library taxonomy:

```text
https://ia.iowadot.gov/erl/current/GS/Navigation/nav.htm
```

Existing code:

- `scripts/import_iowa_data.py`

Detect newly listed letting documents, changed current item-master content, and a changed current ERL navigation/catalog structure. Do not download the complete historical archive on every scan. Compare the current archive inventory first and hash only new or changed candidate documents.

### Nebraska

Item History and annual-price listing:

```text
https://dot.nebraska.gov/business-center/hwy-bridge-lp/item-history/
```

Existing code:

- `scripts/import_nebraska_data.py`
- `scripts/audit_nebraska_phase1.py`

Detect new annual-price report links in both calendar-year and July-through-June series. Also detect changes to catalog or specification documents linked from the official page. Individual PDF URLs in the importer and audit script are discovery evidence but must not replace inspection of the current official listing page.

### South Dakota

Completed letting archive:

```text
https://apps.sd.gov/hc65bidletting/bidlettingscomplete.aspx
```

Standard Bid Item search:

```text
https://apps.sd.gov/hc70sbi/main.aspx
```

Existing code:

- `scripts/import_south_dakota_data.py`

Detect new completed-letting entries and changes to the live Standard Bid Item result set. Reuse the importer's understanding of the official form where practical, but keep scan output separate from import output. Also identify the current official annual Bid Item Price Report and specification-book page or document through the official SDDOT domain; do not permanently rely on the year-specific URLs currently in the importer.

### Shared FHWA Index

NHCCI dataset page:

```text
https://data.transportation.gov/Research-and-Statistics/NHCCI/r94d-n4f9
```

NHCCI API:

```text
https://data.transportation.gov/resource/r94d-n4f9.json
```

Existing code:

- `scripts/refresh_nhcci_index.py`

Detect a newer published quarter than the latest quarter in the committed application data. Do not treat harmless JSON ordering changes as a source update; compare normalized period/value records.

## Source Registry Contract

Use one declarative JSON registry. Each entry must include enough information to render the UI and dispatch a scanner without embedding presentation metadata in Python conditionals.

Minimum fields:

```json
{
  "id": "co_cdot_cost_data_book",
  "state": "CO",
  "agency": "CDOT",
  "label": "Cost Data Book",
  "sourceType": "linked_documents",
  "indexUrl": "https://www.codot.gov/business/eema/costdatabook",
  "allowedHosts": ["www.codot.gov", "oitco.hylandcloud.com"],
  "importer": "scripts/parse_cdot_cost_data_book.py",
  "enabled": true
}
```

Add type-specific configuration for link recognition, date extraction, document formats, and comparison behavior. Keep regexes narrow and readable. Validate the registry at server startup and show configuration errors in the UI.

Support a user-provided starting URL without requiring Python edits. Accept either:

- editing the `indexUrl` value in `source_registry.json`; or
- a small local-only **Source URL override** control stored in `data/raw/source_monitor/scan_state.json`.

If implementing the UI override, constrain it to the source's allowed official hosts. Do not provide a general-purpose arbitrary URL fetcher.

## Scan and Comparison Model

Separate discovery from comparison:

```text
Registry entry
  -> fetch official index/API/form
  -> normalize discovered records
  -> compare with known repository evidence and prior local scan state
  -> optionally fetch/hash only new or ambiguous documents
  -> return structured result
```

Each normalized discovered record should contain applicable fields from:

- stable source ID
- title
- publication or letting date
- reporting-period start and end
- index URL
- discovered URL
- resolved URL
- filename
- media type
- content length
- ETag
- Last-Modified
- SHA-256
- retrieval timestamp
- discovery evidence

Comparison must use semantic identifiers when available:

- letting date plus official document identity for archive entries;
- report series plus reporting period for annual reports;
- normalized quarter plus value for NHCCI;
- SHA-256 for replaceable PDFs and workbooks;
- normalized item-record fingerprint for form-generated catalogs.

Do not report a source as changed solely because the server changed an ETag, redirect token, query string, HTML whitespace, response ordering, or retrieval timestamp.

## Baseline Rules

Use committed repository evidence as the primary baseline whenever possible:

- normalized `sources.csv` and `source_documents.csv` files;
- committed staging inventories;
- committed source URLs, filenames, dates, and SHA-256 values;
- the latest period in app-loaded data;
- importer constants only as a fallback.

Use `data/raw/source_monitor/scan_state.json` only for local scan history and sources that do not yet have committed evidence.

On a first scan with no usable baseline:

- report `Baseline needed`, not `Unchanged`;
- show what was discovered;
- allow the developer to save the local result as the comparison baseline;
- do not edit tracked files.

Saving a local baseline must be an explicit user action. A failed or partial scan must never replace a successful baseline.

## HTTP API

Provide a small JSON API. Exact paths may change, but keep equivalent boundaries:

- `GET /api/sources`: registry plus latest local status
- `POST /api/scans`: begin one scan of all enabled sources
- `GET /api/scans/{scan_id}`: progress and completed results
- `POST /api/sources/{source_id}/baseline`: explicitly save a successful local result
- `GET /api/health`: local server health

The UI must not freeze while a scan runs. Poll bounded progress or use server-sent events if that remains simple. Prevent two simultaneous full scans. A stopped browser must not leave an unbounded worker running indefinitely.

Do not implement an endpoint that accepts a shell command, filesystem path, importer name, or unrestricted URL from the browser.

## UI Requirements

Use the application's existing FHU design tokens as visual guidance without importing the Vite application or duplicating its full component system.

The page must provide:

- title and explanation that this is a local developer tool;
- prominent **Scan Now** button;
- last successful scan time;
- grouped Colorado, Iowa, Nebraska, South Dakota, and Shared/FHWA sections;
- per-source progress while scanning;
- clear status badges;
- concise result summary;
- expandable technical details;
- **Open source page** action;
- **Copy import request** action for new or changed sources;
- **Save local baseline** only when needed;
- accessible keyboard focus and status announcements;
- usable layout at ordinary laptop widths.

The import request must include:

- state and source label;
- official index URL;
- discovered/resolved document URLs;
- detected new entries or periods;
- prior and current hashes when applicable;
- relevant importer path;
- instruction to download live, inspect format, use established staging/promotion, validate, and report reconciliation issues.

Never include cached credentials, local absolute paths, or full downloaded content in the copied request.

## Windows Launcher

`Start Data Source Monitor.cmd` must:

1. Resolve the repository directory from the launcher's own location.
2. Prefer the repository's documented Python environment when available, with a clear fallback to `python` on `PATH`.
3. Start the server without changing the caller's working directory permanently.
4. Open the monitor URL after the health endpoint is ready.
5. Avoid starting a duplicate server when port `4180` already hosts this monitor; open the existing instance instead.
6. Keep a visible window with concise shutdown instructions unless a reliable tray/background shutdown mechanism is implemented.

Do not terminate unrelated processes using port `4180`. If the port belongs to another application, print a clear error and exit.

Also support direct execution for coding agents:

```text
python -m tools.source_monitor.server
```

## Security and Failure Handling

- Bind to `127.0.0.1`, never `0.0.0.0`.
- Permit only registry-declared HTTP methods and official hosts.
- Reject redirects to unapproved hosts.
- Escape all source-provided text before rendering.
- Do not execute content from downloaded pages.
- Set response-size limits for HTML, JSON, PDF, and workbook checks.
- Store partial downloads under the ignored cache and remove or mark them incomplete after failure.
- Return per-source failures without aborting the entire all-state scan.
- Show timeouts, HTTP errors, parsing failures, and blocked redirects as actionable status text.
- Do not interpret a source outage as a removed publication.
- Require a successful index fetch before reporting a previously known link as removed.

## Testing Requirements

All network-dependent parsing must be testable from committed fixtures. Tests must not require live internet access.

Add fixtures covering at least:

- CDOT index page with a Hyland-hosted Cost Data Book link;
- a CDOT stable link whose downloaded content hash changes;
- Iowa archive with one newly added letting;
- Nebraska listing with both report series and one new report;
- South Dakota completed-letting archive with one new entry;
- South Dakota catalog fingerprint with reordered but unchanged records;
- NHCCI API rows with one new quarter;
- redirect to an unapproved host;
- timeout or unavailable source;
- malformed page that returns `Review required` rather than `Unchanged`;
- first scan without a baseline;
- failed scan that does not overwrite a successful baseline.

Run unit tests for scanner normalization, comparison, registry validation, HTTP routing, and import-request generation.

Perform a live manual scan only after fixture tests pass. Live results are diagnostic and must not make tests nondeterministic.

## Required Verification

At minimum:

1. Run the monitor unit tests.
2. Run existing tests for any importer code reused or changed.
3. Run `python scripts/validate_data_package.py` and confirm the monitor did not change application data.
4. Start the monitor locally through the documented Python module command.
5. Verify `GET /api/health` returns success.
6. Open the UI and run one all-source live scan.
7. Confirm every enabled source reaches a terminal status independently.
8. Confirm copied import requests contain the expected source facts and no unsafe data.
9. Confirm the server is reachable on `127.0.0.1` and not bound to all interfaces.
10. Run Git whitespace/error checks and inspect the final repository status.

If a live official site is unavailable, record that result in the implementation report. Do not weaken fixture coverage or mark the source unchanged.

## Documentation Updates

After implementation:

- Update `architecture_overview.md` with the localhost-only monitor boundary and scan-to-import flow.
- Update `docs/implementation_notes.md` with launcher, direct-start, test, and troubleshooting instructions.
- Update `user_workflow.md` only if it contains developer data-refresh procedures that should reference the monitor.
- Keep this plan in `docs/` while implementation remains active. Move it to `docs/archive/` after the feature is implemented, verified, and documented.

## Non-Goals

Do not implement any of the following in version 1:

- scheduled GitHub Actions scans;
- email, Slack, or external notifications;
- automatic imports or promotions;
- automatic commits, branches, or pull requests;
- production application integration;
- arbitrary web browsing or unrestricted URL entry;
- background monitoring after the local tool is closed;
- semantic approval of a new source;
- automatic deletion of old source documents;
- a general-purpose scraper framework.

## Completion Criteria

The work is complete only when:

- one click launches the local monitor without a terminal command;
- one **Scan Now** action checks all configured Colorado, Iowa, Nebraska, South Dakota, and FHWA sources;
- source discovery uses verified official pages or explicit user-provided official URLs;
- changed files behind stable URLs are detected by content or normalized-record comparison;
- new archive entries are detected without downloading entire archives;
- failures are isolated and clearly reported;
- no scan changes tracked application or staging data;
- the developer can copy a complete agent handoff for each actionable update;
- fixture tests and required repository validation pass;
- architecture and operating documentation describe the finished tool.

## Implementation Report Expected From the Agent

At completion, report:

1. Files added and changed.
2. Final official source/index URL used for every registry entry.
3. Any source that could not be verified and why.
4. How each source is compared against repository evidence.
5. Live scan results, clearly separated from fixture-test results.
6. Tests and validation commands run with outcomes.
7. Any manual review still required.
8. Branch and commit status; do not push unless the user requests it.
