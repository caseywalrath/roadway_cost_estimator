# Implementation Notes

## Current Scope

The first implementation is the Colorado Roadway Cost Estimator.

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
- Data-package validation script.

Not included:

- Price recommendation.
- Confidence score.
- Demo project evidence.
- Real estimating data.
- Estimate upload.
- Estimate workspace.
- User accounts.
- Server or hosted database.
- Chat layer.
- General-purpose PDF or spreadsheet parsing.
- Automatic fuzzy matching from source specifications to CDOT item codes.

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

## Next Product Steps

Current sequencing lives in `project_roadmap.md`.

Near-term development should keep hardening the exact-code evidence browser before estimate workspace, non-exact matching, private data, or import workflows are added.
