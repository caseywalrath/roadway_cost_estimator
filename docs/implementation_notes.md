# Implementation Notes

## Current Scope

The production application is a static multi-state Roadway Cost Estimator. A separate local-only source monitor supports developer-led data refresh discovery for Colorado, Iowa, Nebraska, South Dakota, and the shared FHWA index.

Included:

- Static Vite + TypeScript app.
- Static public CDOT cost-book CSV data package.
- CDOT section-based one-item lookup form.
- Deterministic browser-side exact-code evidence matching.
- Matching Projects evidence table.
- Evidence filters, sortable table columns, and CSV export.
- Awarded Bid Summary based on currently filtered awarded bid unit prices.
- Unit Price Summaries for loaded average bid and engineer estimate prices.
- Source-only public bid-tab project review for imported rows that do not have reviewed CDOT matches.
- Browser-local Project workspace with multiple Projects, revisions, backups, cost categories, and CSV reporting.
- Bounded `.xlsx` Project line import with worksheet/range selection, header mapping, row review, catalog/custom decisions, and atomic persistence.
- Data-package validation script.

Not included:

- Price recommendation.
- Confidence score.
- Demo project evidence.
- Real estimating data.
- General-purpose estimate upload outside the bounded `.xlsx` Project line import.
- General-purpose PDF, `.xls`, `.xlsm`, or arbitrary spreadsheet parsing.
- User accounts.
- Server or hosted database.
- Chat layer.
- Automatic fuzzy matching from source specifications to CDOT item codes.
- Formula evaluation or recovery of formula results that are absent from the workbook cache.

## Local Data Source Monitor

The monitor is intentionally separate from the production Vite application. Double-click `Start Data Source Monitor.cmd` at the repository root to start the localhost UI and open `http://127.0.0.1:4180/`. The launcher prefers `.venv\\Scripts\\python.exe` or `venv\\Scripts\\python.exe`, falls back to `python` on `PATH`, reuses an existing monitor on port 4180, and does not stop unrelated processes. Keep the monitor window open while scanning; close it or press Ctrl+C to stop it.

Coding agents can start the same server directly with:

```text
python -m tools.source_monitor.server
```

Click **Scan Now** to check the official sources in `tools/source_monitor/source_registry.json`. Requests are made by Python so browser CORS rules do not prevent source checks. The registry allows explicit official redirected hosts (for example, CDOT's Hyland document host) and supports a source URL override through the local-only API when an agency index moves. The monitor does not accept arbitrary URLs, shell commands, importer execution, or filesystem paths from the browser.

Results compare semantic letting dates, report periods, normalized catalog records, API period/value pairs, and content hashes when configured. A first scan reports **Baseline needed** until **Save local baseline** is clicked. A failed or review-required source never overwrites a previously saved baseline. **Copy import request** creates a handoff containing official URLs, discovered periods, hashes where available, and the reviewed importer path; it does not authorize an automatic import or commit.

Run the monitor fixture tests with:

```text
python -m unittest tools.source_monitor.tests.test_scanner tools.source_monitor.tests.test_server
```

If a source reports **Review required**, inspect the official index and the technical details. This status is used for malformed pages, unverified current listings, blocked redirects, and dynamic agency forms that need source-specific human review. **Unavailable** indicates a timeout, HTTP error, or response-size limit; it is not treated as a removed publication.

## Local Commands

The canonical local commands for the Codex sandbox/OneDrive/portable-Node environment — and
which check to run for which kind of change — live in `codex.md` ("Canonical Local Commands"
and "Verification By Change Type"). Use those directly; the naive `npm run ...` forms are
unreliable here. The essentials:

Validate the app-loaded CSV data package (fails on structural/relationship/numeric/date errors
and demo-evidence leakage; warns on missing optional metadata, lookup gaps, and smoke-count
changes):

```text
python scripts/validate_data_package.py
```

Typecheck (the everyday "does it compile" check — `tsconfig` sets `noEmit`, so this writes
nothing and never hits the OneDrive `dist` lock):

```text
node ./node_modules/typescript/bin/tsc
```

Production build, only when the bundle itself matters (run with escalation; `spawn EPERM` is
expected otherwise). It targets `dist-check` to avoid the OneDrive `dist` lock and uses the
native config loader:

```text
node ./node_modules/vite/bin/vite.js build --outDir dist-check --configLoader native
```

`dist-check/` is gitignored — leave it in place; do not commit or attempt to delete it. For a
local UI preview, serve the built `dist-check` as a static server on `http://127.0.0.1:4174/`
rather than `npm run dev`, which does not reliably bind a port in this environment.

## CDOT Item Code Book Import

The app uses a committed static CSV version of the public CDOT 2026 Item Code Book for item lookup.

The raw Excel workbook should be downloaded from CDOT's Item Code Book by Year page and saved outside tracked source, for example:

```text
tmp/source/cdot_item_code_book_2026.xlsx
```

The raw workbook is ignored by Git because `tmp/` is ignored.

Run the importer:

```text
python scripts/import_cdot_item_code_book.py --source tmp/source/cdot_item_code_book_2026.xlsx
```

The importer requires `openpyxl`. In the Codex desktop environment, use the bundled Python runtime returned by the workspace dependency loader. In a normal local Python environment, install `openpyxl` before running the importer.

The importer writes:

```text
public/data/agency_items.csv
public/data/spec_sections.csv
```

It preserves existing `canonical_item_id` mappings by item code, adds abbreviated descriptions, validates item-code format, checks required fields, and creates fallback section labels for prefixes not yet mapped to reviewed CDOT section names.

## CDOT Cost Data Book Staging Import

The repo includes a local parser for the known public CDOT Cost Data Book PDF format. It is a narrow parser for CDOT cost-book PDFs, not a general-purpose PDF parser.

Run the parser with the default 2026 Q1 repo-root PDF:

```text
python scripts/parse_cdot_cost_data_book.py
```

For another promoted period, pass the source PDF, output path, source period, and item-section
marker explicitly (run `python scripts/parse_cdot_cost_data_book.py --help` for the exact flags;
prior period invocations are in git history).

To use the Codex bundled Python runtime, replace `python` with the bundled Python executable returned by the workspace dependency loader.

The parser requires `pypdf`. The Codex bundled Python runtime includes it. In a normal local Python environment, install `pypdf` before running the parser.

The parser writes:

```text
public/data/imports/cdot_cost_data_book_2026_q1_item_unit_costs.csv
```

The item-unit output is the first staging CSV. It should be validated against the project-list pages and agency item table before promotion into app-loaded CSVs.

Older cost books can use all-caps section headings, separator-wrapped item headers, and placeholder price rows with `.` values. The parser skips weighted-average summaries and incomplete placeholder-price rows before promotion.

Run parser fixture tests:

```text
python scripts/test_parse_cdot_cost_data_book.py
```

Promote reviewed staging rows into app-loaded CSVs:

```text
python scripts/promote_cdot_cost_data_book.py
```

For another promoted period, pass the period-specific source metadata explicitly (see
`python scripts/promote_cdot_cost_data_book.py --help`; prior period invocations are in git
history).

The promotion script parses project-list pages from the PDF, writes a project staging lookup, validates item rows, and rewrites:

```text
public/data/imports/cdot_cost_data_book_2026_q1_projects.csv
public/data/sources.csv
public/data/projects.csv
public/data/item_observations.csv
```

It preserves other promoted cost-book periods and removes any old app-loaded demo evidence rows if they are present in the CSV package. Each cost-book item row becomes separate awarded-bid, average-bid, and engineer-estimate observations. The app defaults to awarded-bid evidence.

After promotion, run `python scripts/validate_data_package.py` and review any warnings before committing promoted data.

Run promotion fixture tests:

```text
python scripts/test_promote_cdot_cost_data_book.py
```

## Public Bid Tab Workbook Import

The bid-tab importer is a narrow parser for reviewed public FHU-curated bid tab workbook layouts. It preserves source item identity in `public/data/bid_tab_items.csv` and bidder-level prices in `public/data/bidder_bids.csv` and `public/data/bidder_item_observations.csv`.

Supported layouts:

- Watson SAQ-style workbook.
- Arapahoe bid-form workbook.
- Kipling/Bowles split-header tabulation workbook.
- Ralston `Results` sheet workbook.

Run importer tests:

```text
python -m unittest scripts.test_import_bid_tab_workbook
```

The Ralston reconciliation workbook imports reviewed CDOT matches from columns `CDOT Item Code`, `CDOT Description`, `CDOT Unit`, and `Confidence`. Rows with a nonblank CDOT item code are promoted into exact-code public bid-tab evidence; rows with blank or `None` CDOT item code remain source-only:

```text
python scripts/import_bid_tab_workbook.py --workbook "C:\Users\Casey.Walrath\Downloads\Ralston_Rd_CDOT_reconciliation.xlsx" --source-id fhu_bid_tab_ralston_yukon_garrison_2021_02_05 --source-label "FHU Civil Group Bid Tabs - Ralston Road Yukon to Garrison" --source-year 2021 --project-id fhu_bid_tab_ralston_yukon_garrison_2021_02_05_18_st_40 --row-prefix fhu_ralston_yukon_garrison_20210205 --date-basis 2021-02-05 --agency-owner "City of Arvada" --county-region "Jefferson County / Arvada"
```

The current Ralston output is 235 source bid-tab item rows, 210 matched rows promoted into 420 exact-code observations, 25 unmatched rows left out of exact-code evidence, and 1,410 bidder item rows. The source City of Arvada item codes remain in `bid_tab_items.csv`; Matching Projects and Unit Price Summaries use reviewed CDOT item codes only.

Other supported workbooks (e.g. Kipling/Bowles, which uses CDOT item codes directly and promotes
every base bid schedule row into exact-code evidence) follow the same importer with workbook- and
project-specific flags plus optional `--staging-*` paths. Run
`python scripts/import_bid_tab_workbook.py --help` for the full flag set; prior per-workbook
invocations are in git history. The current Kipling/Bowles output is 108 source bid-tab item rows,
216 exact-code observations, 4 bidder bids, and 432 bidder item rows. Two reviewed CDOT lookup
rows, `625-01000` and `626-01100`, are carried in `agency_items.csv` so every Kipling/Bowles
bid-tab item remains searchable through the item picker.

## GitHub Pages

The Vite config uses `base: "./"` so the built app can run from a GitHub Pages project path.

Expected deployment artifact:

```text
dist/
```

The likely production flow is:

1. Build the app.
2. Publish `dist` through GitHub Pages.
3. Keep source files on a feature branch until reviewed and merged.

The repository includes `.github/workflows/pages.yml` for GitHub Pages deployment from `main`.
The workflow uses `npm ci` so GitHub builds from the committed lockfile.

## Project Excel import

Open **Project Actions > Import From Excel** from the Project tab. The import is browser-local and keeps its working data detached from the saved Project until the user selects the final **Import [count] items** action.

The wizard has five user-facing steps: Choose file, Choose data, Match columns, Review items, and Confirm import. It reads `.xlsx` ZIP workbooks in a worker, automatically selects the highest-confidence visible worksheet and item table, and shows a bounded preview. The normal column screen presents Item Code, Description, Unit, Quantity, Unit Cost, and Notes with sample values. Header aliases recognize common labels such as `Item No.`, `Item Code`, `Description`, `Units`, `Qty`, `Unit Price`, `Extended Cost`, `Total`, and `Notes`. Advanced import settings contain extended cost, Project-group behavior, cost-category behavior, and header overrides; the disclosure state persists through mapping changes. Change data range is the supported way to exclude helper cells and export/check columns to the right of the main estimate table. Ordinary detected sections require no user interaction; the source-section choice appears only for alternatives.

Each selected physical row receives a source worksheet and row locator plus an outcome. Review opens on Needs attention when a row requires a choice. Three tabs expose Needs attention, Reviewed, and All items; an Issue type dropdown includes group counts, and Ready/Skipped filters remain within All items. Expandable item details preserve access to source quantities, units, costs, and notes. Explicit row buttons record choices; Reviewed offers Change choice. A checkbox column and adjacent Row column support selecting individual unresolved rows. Select All / Clear affects only selectable rows visible on the current page, as determined by the issue filter and pagination. When rows are selected, the shared-action dropdown appears beside this button; it has no visible selected-count label, and choosing an action immediately applies it when valid for every selected row. Skip selected is one available option. When no rows are selected, Undo appears by itself beside Select All / Clear. No selection controls stay sticky. Tabs, filters, and guidance remain in normal page flow. A bulk decision becomes individual row decisions. One-step Undo restores previous decisions and the review view/page; reparsing invalidates undo. Rows whose sole supported action is Skip are automatically skipped rather than requiring acknowledgement. They are excluded from Needs attention and Reviewed unless an explicit user decision exists, and remain visible in All items/Skipped with the source row, text, and reason. Blank, repeated-header, section, subtotal, and ambiguous rows remain excluded unless they support an import action that the user resolves. Users can continue to confirmation with unresolved Needs attention rows; the importer excludes these rows, counts them as skipped, and states the count on the confirmation page. Confirmation distinguishes automatically skipped potential item rows from headings, blank rows, user-selected skips, and unresolved rows. An official-item match uses exact destination state and agency identity. Description and unit differences show a direct choice between the official value and the spreadsheet value as a custom line. Custom lines retain their source values and selected cost category; custom construction lines contribute to Construction Costs. Quantity and unit cost are preserved, and total item cost is recalculated from those values. Source-total differences, missing numeric values, formula-cache failures, duplicates, and invalid rows remain visible in the review result and downloadable issue report.

The reader does not evaluate formulas. It uses cached formula results when present and requires review when a formula has no cached result. It preserves merge anchors and physical coordinates, but does not attempt to reconstruct arbitrary visual layouts. Merged headings, repeated headers, grouped sections, hidden rows/columns, print areas, and helper-cell regions are handled through detection and explicit selection. Worksheets are never combined automatically; alternative sections require an explicit inclusion choice.

The confirmation names the destination Project, accepted item count, skipped-row reasons, imported cost totals, and spreadsheet-total comparison. The final action uses the accepted item count. Success states exactly how many items were added; a failed save states that no items were added and offers retry. The bounded reader accepts `.xlsx` only, with default limits of 25 MB per file, 100 worksheets, 250,000 populated cells, 20,000 selected rows, 100 selected columns, and 30 seconds of parsing. The import never changes public evidence data. Persistent Project writes require IndexedDB; when durable storage is unavailable, the preview and issue report remain available but saving is blocked.

Acceptance checks using the supplied private workbooks and the production parser:

- `OPCC Template.xlsx`, `Estimate!B11:H143`: 133 physical rows, all classified as item rows; helper/export columns were left outside the selected range.
- `132nd and Giles - Cost Estimate.xlsx`, `Concept 1A!B13:F95`: 83 physical rows, 26 item rows, 5 repeated-header rows, 33 ambiguous rows, and 19 blank rows; the six visible Concept sheets and five hidden/support sheets were not combined.
- `Ida Street _30Cost_Estimate.xlsx`, `Ida Street Imp!B12:F131`: 120 physical rows, 47 item rows, 6 repeated-header rows, 31 ambiguous rows, and 36 blank rows; the two alternative surfacing sections require explicit selection.

## Next Product Steps

Current sequencing lives in `project_roadmap.md`.

Near-term development should harden the exact-code evidence browser and review the browser-local Project and `.xlsx` import workflows with roadway engineers before adding private hosted data or non-exact matching.

Excel import confirmation detects matching existing Project items using final reviewed values. Official lines match state/agency item identity, normalized Group, and cost category; custom lines match normalized code, description, unit, Group, and cost category. Add as separate items is the default. Users can bulk update or skip matching rows, with individual overrides in an expandable comparison table. Multiple existing matches or repeated incoming matches require explicit update targets; conflicting targets block save. Updates preserve row ID, order, identity, evidence, and creation time, retain blank quantity/unit cost/notes, replace explicit zero values, and record import provenance. Confirmation shows added/updated/skipped counts, net cost changes, and projected Project base costs. The repository applies additions and updates atomically with revision checks and a pre-import recovery snapshot; failed saves retain the draft.
