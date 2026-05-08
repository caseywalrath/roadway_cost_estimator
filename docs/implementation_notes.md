# Implementation Notes

## Current Scope

The first implementation is the Colorado Roadway Comparable Project Explorer.

Included:

- Static Vite + TypeScript app.
- Demo CSV data package.
- One-item lookup form.
- Deterministic browser-side matching.
- Recommendation summary.
- Price distribution summary.
- Top comparable records table.
- Warnings and improve-confidence guidance.

Not included:

- Real estimating data.
- Estimate upload.
- Estimate workspace.
- User accounts.
- Server or hosted database.
- Chat layer.
- Automatic PDF or spreadsheet parsing.

## Local Commands

Install dependencies:

```text
npm install
```

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

1. Collect public CDOT cost books, bid tabs, or awarded project records.
2. Define import scripts for those source formats.
3. Validate 5 to 10 common roadway item families with roadway reviewers.
4. Replace or supplement demo cost observations with validated public records.
5. Add a lightweight estimate workspace after item matching is trusted.
