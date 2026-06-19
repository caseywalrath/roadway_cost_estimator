# Architecture Overview

## Current Product

This repository contains a static-first prototype for a Colorado roadway bid-item evidence browser.

The first product is not a chatbot, not a full project estimator, and not an automatic price recommendation tool. It is a structured evidence tool that helps a user identify one official roadway bid item and review the project records where that exact item appears.

The primary deliverable is the project-item evidence table. Awarded bid statistics are secondary aids that summarize the currently filtered evidence rows that the user has not excluded from summary. Those summary statistics can optionally be adjusted with loaded FHWA National Highway Construction Cost Index quarters. Included Matching Projects rows can be exported to CSV for external review.

## Application Shape

- Hosting target: GitHub Pages.
- Frontend stack: Vite + TypeScript.
- Runtime model: static files only; no server and no database.
- Data model: browser-loaded CSV files in `public/data`, including item observations, agency item mappings, CDOT section metadata, and FHWA NHCCI inflation index values.
- Evidence model: deterministic TypeScript grouping and filtering rules in `src/matching`.
- Deployment path: GitHub Actions validates the app-loaded CSV package, builds the Vite app, and publishes `dist` to GitHub Pages from `main`.

The app loads the CSV package at startup, builds in-memory lookup maps, and runs all filtering and scoring in the browser.

## Data Flow

1. `src/main.ts` starts the app.
2. `src/data/loadData.ts` loads CSV files from `public/data`.
3. `src/data/schema.ts` defines app-facing data structures, including `SpecSectionRecord` for CDOT section/prefix labels and abbreviated agency item descriptions.
4. `src/matching/buildEvidenceResult.ts` groups exact item-code observations into project-item evidence rows.
5. `src/matching/buildEvidenceResult.ts` applies explicit evidence filters and calculates awarded bid summary statistics for the filtered table.
6. Prior comparable scoring modules remain in the repository for reference, but the primary UI no longer uses hidden top-five relevance selection.
7. `src/ui` renders the fixed prototype scope, item search, evidence filters, sortable evidence table, row-level summary exclusions, CSV export, awarded bid summary, optional NHCCI summary adjustment, source coverage note, and data notes.

## Data Governance

The CSV records include public CDOT 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1 Cost Data Book records. They are prototype evidence and must be reviewed before estimating use.

Do not commit private FHU estimate data to a public GitHub Pages repository. Real internal data should either stay outside the repo, be uploaded locally by the user in a later browser-only workflow, or move to an approved private hosting model.

The repository can generate staging CSVs from public CDOT Cost Data Book PDFs, validate them against project-list pages and agency item codes, and promote them into app-loaded source, project, and observation CSVs. The current promoted public CDOT cost-book sources are `cdot_cost_data_book_2022_q4`, `cdot_cost_data_book_2023_q4`, `cdot_cost_data_book_2024_q4`, `cdot_cost_data_book_2025_q4`, and `cdot_cost_data_book_2026_q1`.

The app-loaded CSV package is checked by `scripts/validate_data_package.py`. The validator fails deployment for broken source/project/observation relationships, duplicate IDs, invalid required values, invalid numeric/date fields, malformed NHCCI rows, app-loaded demo evidence leakage, and missing smoke-test evidence for `304-06007`. Lookup gaps, optional metadata gaps, and evidence quarters newer than the latest loaded official NHCCI quarter are reported as warnings.

## Evidence Browser Rules

The Phase 1 evidence browser rules are intentionally visible and simple:

- Filter to the fixed Colorado prototype state.
- Use public CDOT cost-book rows by default.
- Exclude app-loaded demo evidence rows from Matching Projects, including from the all-sources filter.
- Require selection of an official agency item code before displaying project evidence.
- Use exact agency item-code matches as the default definition of relevant evidence.
- Resolve official item descriptions and units from agency item-code records when possible.
- Group separate awarded bid, average bid, and engineer estimate observations into one project-item row when they describe the same project, item, unit, quantity, and date.
- Show same-unit rows by default.
- Show unit-mismatch counts as data notes instead of mixing units in the default table.
- Apply source, geography, district, year, quantity, unit, and awarded-price filters as hard filters.
- Sort evidence rows newest first by default, then allow users to sort by displayed table columns.
- Allow users to exclude visible rows from the Awarded Bid Summary without removing them from the visible evidence table.
- Export the currently filtered and non-excluded Matching Projects rows to CSV with the displayed table columns and useful project/source metadata.
- Show source coverage near the evidence results so users can see loaded public CDOT periods and excluded evidence categories.
- Calculate summary statistics from included awarded bid unit prices only.
- Let users toggle summary-only inflation adjustment with loaded FHWA NHCCI quarters. Matching Projects table prices and CSV export stay in original awarded-bid dollars.

Alias, keyword, and description fallback matching should return only in a later explicit review mode. They are not part of the default evidence table.

## Item Code Search Funnel

The item search uses a CDOT section-based item picker instead of a single long item-code dropdown.

The visible left-panel flow is:

1. Locate Item: select a CDOT specification division and section/prefix when they help narrow the search, then use Item code or description to filter loaded agency items by item code, suffix, official description, or abbreviated description.
2. Select Item: review the potential matching items and select one result to populate the submitted item code. The matching layer resolves the official description and unit from the agency item table.
3. Enter quantity: provide the planned quantity before reviewing project evidence.

Item code or description works across all loaded agency items when no division or section is selected. Division and section selections narrow the visible search results when selected. Select Item stays empty until the user selects a division, selects a section, types an item search, or already has an official item selected. If the user does not select an official item, the typed description can still submit as a weaker manual description search.

Section labels come from `public/data/spec_sections.csv`. Item-level options continue to come from `public/data/agency_items.csv`.

The current item picker data is generated from the public CDOT 2026 Item Code Book Excel file linked from CDOT's Item Code Book by Year page. The committed CSV contains 4,771 valid item-code rows and 100 item-code prefixes. The raw Excel workbook is not committed; `scripts/import_cdot_item_code_book.py` converts a downloaded workbook into the static CSV files.

Some prefixes use known CDOT Standard Specification section labels. Prefixes not yet mapped to a known section label use fallback labels so all valid item-code rows remain searchable.

The full item code book supports lookup only, so pricing appears only when matching public cost-book rows exist in `public/data/item_observations.csv`.

The submitted `SearchQuery` shape did not change. The visible item search is limited to item identity and quantity. Unit is resolved from the selected official item and displayed as a non-editable suffix in the quantity field when available. Evidence filters are applied from the result-side evidence controls after item identity is established.

## Near-Term Extension Points

- Review promoted 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1 CDOT cost-book rows with roadway engineers.
- Maintain data integrity checks for loaded CSV relationships.
- Refine source coverage notes for promoted CDOT cost-book periods.
- Add manual include/exclude controls and reviewer notes for an engineer-selected evidence set.
- Add validation coverage for future CDOT cost-book quarters before promotion.
- Add reviewed FHU data only through an approved private-data workflow.
- Add estimate workspace rows after the item explorer is trusted.
- Add CSV/XLSX import only after schema mapping rules are validated.
- Consider DuckDB-WASM or SQLite-in-browser only when CSV filtering becomes too slow or relationship validation becomes difficult.
