# Implementation Notes

## Current Scope

The first implementation is the Colorado Roadway Comparable Project Explorer.

Included:

- Static Vite + TypeScript app.
- Static public CDOT cost-book CSV data package.
- CDOT section-based one-item lookup form.
- Deterministic browser-side exact-code evidence matching.
- Matching Projects evidence table.
- Evidence filters, sortable table columns, and CSV export.
- Awarded Bid Summary based on currently filtered awarded bid unit prices.
- Source coverage and data notes.
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

## Local Commands

Install dependencies:

```text
npm install
```

Validate the app-loaded CSV data package:

```text
npm run validate:data
```

This runs `scripts/validate_data_package.py` against `public/data`. It fails on structural data problems, relationship errors, invalid numeric/date values, and app-loaded demo evidence leakage. It warns on missing optional metadata, lookup coverage gaps, and smoke-test count changes.

Run a local development server:

```text
npm run dev
```

If Node.js is installed as a portable ZIP, run npm through the extracted folder:

```text
C:\Users\Casey.Walrath\Tools\node\npm.cmd run dev
```

If an npm script resolves to the Codex desktop bundled Node instead of the portable Node install, prefix `PATH` before running the command:

```text
$env:PATH='C:\Users\Casey.Walrath\Tools\node;' + $env:PATH
C:\Users\Casey.Walrath\Tools\node\npm.cmd run dev
```

Build the static site:

```text
npm run build
```

If using portable Node:

```text
C:\Users\Casey.Walrath\Tools\node\npm.cmd run build
```

Local builds may fail if OneDrive locks existing files in `dist`. If that happens, use a temporary output folder to verify the TypeScript and Vite bundle:

```text
C:\Users\Casey.Walrath\Tools\node\node.exe .\node_modules\vite\bin\vite.js build --outDir dist-check
```

Delete the temporary output folder after verification. Do not commit `dist`, `dist-check`, or other generated build folders.

Preview the production build:

```text
npm run preview
```

Known current local test URL:

```text
http://127.0.0.1:5173/
```

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

For another promoted period, pass the source PDF, output path, source period, and item-section marker explicitly:

```text
python scripts/parse_cdot_cost_data_book.py --source CDOTRM_EEMA_Cost_Data_Book_-_2023_-_4th_Qtr_-_4-9-2026.pdf --output public/data/imports/cdot_cost_data_book_2023_q4_item_unit_costs.csv --source-period "2023 Q4" --item-section-marker "Item Unit Costs by Projects -- 2023 Cost Data"
```

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

For another promoted period, pass the period-specific source metadata explicitly:

```text
python scripts/promote_cdot_cost_data_book.py --source-pdf CDOTRM_EEMA_Cost_Data_Book_-_2023_-_4th_Qtr_-_4-9-2026.pdf --staging-items public/data/imports/cdot_cost_data_book_2023_q4_item_unit_costs.csv --project-lookup-output public/data/imports/cdot_cost_data_book_2023_q4_projects.csv --source-id cdot_cost_data_book_2023_q4 --source-label "CDOT 2023 Q4 Cost Data Book" --source-year 2023 --source-notes "Public CDOT Cost Data Book 2023 Q4 item-level project rows promoted from reviewed staging CSV." --row-prefix cdot_2023q4
```

The promotion script parses project-list pages from the PDF, writes a project staging lookup, validates item rows, and rewrites:

```text
public/data/imports/cdot_cost_data_book_2026_q1_projects.csv
public/data/sources.csv
public/data/projects.csv
public/data/item_observations.csv
```

It preserves other promoted cost-book periods and removes any old app-loaded demo evidence rows if they are present in the CSV package. Each cost-book item row becomes separate awarded-bid, average-bid, and engineer-estimate observations. The app defaults to awarded-bid evidence.

After promotion, run:

```text
npm run validate:data
```

Review any warnings before committing promoted data.

Run promotion fixture tests:

```text
python scripts/test_promote_cdot_cost_data_book.py
```

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
