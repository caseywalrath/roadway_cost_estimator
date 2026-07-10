# Architecture Overview

## Current Product

This repository contains a static-first prototype for a Colorado roadway bid-item evidence browser.

The first product is not a chatbot, not a full project estimator, and not an automatic price recommendation tool. It is a structured evidence tool that helps a user identify one official roadway bid item and review the project records where that exact item appears.

The primary deliverable is the project-item evidence table. Awarded bid statistics are secondary aids that summarize the currently filtered evidence rows that the user has not excluded from summary. Average bid and engineer estimate statistics are also shown when those price types are loaded. Awarded, average bid, and engineer estimate statistics can optionally be adjusted with loaded FHWA National Highway Construction Cost Index quarters. Included Matching Projects rows can be exported to CSV for external review. A browser-local Project workspace lets the user save selected official items with user-entered quantity, preferred unit cost, notes, and evidence context for a simple project-line CSV export.

## Application Shape

- Hosting target: GitHub Pages.
- Frontend stack: Vite + TypeScript.
- Runtime model: static files only; no server and no database.
- Data model: browser-loaded CSV files in `public/data`, including exact-code item observations, source-preserving bid-tab items, bidder-level bid-tab details, agency item mappings, CDOT section metadata, and FHWA NHCCI inflation index values.
- Evidence model: deterministic TypeScript grouping and filtering rules in `src/matching`.
- Project workspace model: browser-local `localStorage` state under `roadway-cost-estimator:projects:v1`, with a versioned schema and recoverable load/save warnings.
- Deployment path: GitHub Actions validates the app-loaded CSV package, builds the Vite app, and publishes `dist` to GitHub Pages from `main`.

The app loads the CSV package at startup, builds in-memory lookup maps, and runs all filtering and scoring in the browser.

## Data Flow

1. `src/main.ts` starts the app.
2. `src/data/loadData.ts` loads CSV files from `public/data`.
3. `src/data/schema.ts` defines app-facing data structures, including `SpecSectionRecord` for CDOT section/prefix labels and abbreviated agency item descriptions.
4. `src/matching/buildEvidenceResult.ts` groups exact item-code observations into project-item evidence rows.
5. `src/matching/buildEvidenceResult.ts` applies explicit evidence filters and calculates awarded, average bid, and engineer estimate summary statistics for the filtered table.
6. `src/projects/projectWorkspace.ts` loads, validates, updates, and saves browser-local Project workspace state.
7. Prior comparable scoring modules remain in the repository for reference, but the primary UI no longer uses hidden top-five relevance selection.
8. `src/ui` renders the fixed prototype scope, Explorer and Project tabs, item search, evidence filters, sortable evidence table, row-level summary exclusions, Matching Projects CSV export, Add to Project controls, Project item table, Project CSV export, unit price summaries, optional NHCCI unit-price summary adjustment, exact-code public bid-tab bidder details, and source-only public bid-tab project review.

## Data Governance

The CSV records include public CDOT 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1 Cost Data Book records. They are prototype evidence and must be reviewed before estimating use.

Do not commit private FHU estimate data to a public GitHub Pages repository. Real internal data should either stay outside the repo, be uploaded locally by the user in a later browser-only workflow, or move to an approved private hosting model.

The repository can generate staging CSVs from public CDOT Cost Data Book PDFs, validate them against project-list pages and agency item codes, and promote them into app-loaded source, project, and observation CSVs. The current promoted public CDOT cost-book sources are `cdot_cost_data_book_2022_q4`, `cdot_cost_data_book_2023_q4`, `cdot_cost_data_book_2024_q4`, `cdot_cost_data_book_2025_q4`, and `cdot_cost_data_book_2026_q1`.

The repository can also import reviewed public FHU-curated bid tab workbooks as `public_bid_tab` sources. The current importer supports the Watson SAQ-style workbook layout, the Arapahoe bid-form layout with itemized engineer estimate and bidder columns, the Kipling/Bowles split-header tabulation layout, and the Ralston `Results` sheet layout with source specification references such as COA and CDOT prefixes. Bid-tab imports preserve source item identity in `bid_tab_items.csv`, preserve bidder-level item prices in `bidder_bids.csv` and `bidder_item_observations.csv`, and promote rows into `item_observations.csv` only when a reviewed exact agency item code is available. Ralston includes reviewed CDOT reconciliation columns; matched rows participate in exact-code Matching Projects and Unit Price Summaries using public bid-tab average and engineer estimate observations, while unmatched rows remain source-only bid-tab detail. Bid-tab imports do not populate awarded contractor, awarded bid total, award index, or awarded bid unit price unless a separate confirmed award source is added later.

The app-loaded CSV package is checked by `scripts/validate_data_package.py`. The validator fails deployment for broken source/project/observation relationships, duplicate IDs, invalid required values, invalid numeric/date fields, malformed NHCCI rows, app-loaded demo evidence leakage, and missing smoke-test evidence for `304-06007`. Lookup gaps, optional metadata gaps, and evidence quarters newer than the latest loaded official NHCCI quarter are reported as warnings.

## Evidence Browser Rules

The Phase 1 evidence browser rules are intentionally visible and simple:

- Filter to the fixed Colorado prototype state.
- Use all public evidence sources by default.
- Allow public bid-tab rows through an explicit source filter without treating apparent low bidder as confirmed award evidence.
- Exclude app-loaded demo evidence rows from Matching Projects, including from the all-sources filter.
- Require selection of an official agency item code before displaying project evidence.
- Use exact agency item-code matches as the default definition of relevant evidence.
- Resolve official item descriptions and units from agency item-code records when possible.
- Group separate awarded bid, average bid, and engineer estimate observations into one project-item row when they describe the same project, item, unit, quantity, and date.
- Link exact-code project numbers to bidder-detail modals when bidder-level bid-tab rows exist.
- Show source-only public bid-tab projects in a separate project review panel without mixing unmatched source items into Matching Projects.
- Show same-unit rows by default.
- Track unit-mismatch counts internally instead of mixing units in the default table.
- Apply source, geography, district, year, quantity, and unit filters as hard filters.
- Sort evidence rows newest first by default, then allow users to sort by displayed table columns.
- Allow users to exclude visible rows from the Awarded Bid Summary without removing them from the visible evidence table.
- Export the currently filtered and non-excluded Matching Projects rows to CSV with the displayed table columns and useful project/source metadata.
- Calculate awarded summary statistics from included awarded bid unit prices only.
- Calculate average bid and engineer estimate summary statistics from the corresponding included rows.
- Let users toggle inflation adjustment with loaded FHWA NHCCI quarters. Matching Projects table awarded bid, average bid, and engineer estimate prices stay in original dollars as the primary values and show secondary adjusted values for transparency when rounded adjusted dollars differ. CSV export stays in original dollars.
- Let users save an official selected item into the browser-local Project workspace only as a user-controlled line item with quantity, preferred unit cost, cost basis, notes, and evidence context. This is not an app-generated recommendation.

Alias, keyword, and description fallback matching should return only in a later explicit review mode. They are not part of the default evidence table.

## Project Workspace Rules

The Project workspace is an early limited estimate-workspace slice:

- Support one active browser-local project in the UI while storing state as a versioned projects array for later multiple-project support.
- Require project name and location before adding item lines.
- Store project notes and line notes as plain text.
- Require quantity and preferred unit cost for each saved project line.
- Compute extended cost at render/export time from quantity and preferred unit cost instead of storing it as source state.
- Preserve evidence context when a line is added, including current query, filters, sort, included evidence row count, included observation IDs, summary snapshot, inflation state, and cost source.
- Treat quick-filled unit costs as user-selected values from currently included summary statistics.
- If inflation adjustment is on, quick-fill values use the visible adjusted summary statistics and record the target NHCCI period in the cost basis.
- Prompt before adding a duplicate official item code so the user can add a separate line, update an existing line, or cancel.
- Export Project rows to CSV only. XLSX generation, import, shared persistence, accounts, collaboration, and private-data storage are deferred.

## Item Code Search Funnel

The item search uses a CDOT section-based item picker instead of a single long item-code dropdown.

The visible left-panel flow is:

1. Locate Item: select a CDOT specification division and section/prefix when they help narrow the search, then use Item code or description to filter loaded agency items by item code, suffix, official description, or abbreviated description.
2. Select Item: review the potential matching items and select one result to populate the submitted item code. The matching layer resolves the official description and unit from the agency item table.

Quantity is no longer part of the item search because the project evidence table has explicit result-side quantity filters.

Item code or description works across all loaded agency items when no division or section is selected. Division and section selections narrow the visible search results when selected. Select Item stays empty until the user selects a division, selects a section, types an item search, or already has an official item selected. If the user does not select an official item, the typed description can still submit as a weaker manual description search.

Section labels come from `public/data/spec_sections.csv`. Item-level options continue to come from `public/data/agency_items.csv`.

The current item picker data is generated from the public CDOT 2026 Item Code Book Excel file linked from CDOT's Item Code Book by Year page. The committed CSV contains 4,771 valid item-code rows and 100 item-code prefixes. The raw Excel workbook is not committed; `scripts/import_cdot_item_code_book.py` converts a downloaded workbook into the static CSV files.

Some prefixes use known CDOT Standard Specification section labels. Prefixes not yet mapped to a known section label use fallback labels so all valid item-code rows remain searchable.

The full item code book supports lookup only, so pricing appears only when matching public cost-book rows exist in `public/data/item_observations.csv`.

The submitted `SearchQuery` shape did not change. The visible item search is limited to item identity. Unit is resolved from the selected official item and used as the default evidence filter. Evidence filters are applied from the result-side evidence controls after item identity is established. The result-side Filters control is the third workflow step for refining source, geography, district, year, quantity, and unit filters.

## Near-Term Extension Points

- Review promoted 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1 CDOT cost-book rows with roadway engineers.
- Maintain data integrity checks for loaded CSV relationships.
- Add manual include/exclude controls and reviewer notes for an engineer-selected evidence set.
- Add validation coverage for future CDOT cost-book quarters before promotion.
- Add more reviewed public bid-tab workbook imports after the importer layout detection is validated on each workbook family.
- Add reviewed private FHU data only through an approved private-data workflow.
- Expand the browser-local Project workspace after the item explorer and first-line export workflow are trusted.
- Add CSV/XLSX import only after schema mapping rules are validated.
- Consider DuckDB-WASM or SQLite-in-browser only when CSV filtering becomes too slow or relationship validation becomes difficult.
