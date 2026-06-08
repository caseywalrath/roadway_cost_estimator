# Architecture Overview

## Current Product

This repository contains a static-first prototype for a Colorado roadway bid-item evidence browser.

The first product is not a chatbot, not a full project estimator, and not an automatic price recommendation tool. It is a structured evidence tool that helps a user identify one official roadway bid item and review the project records where that exact item appears.

The primary deliverable is the project-item evidence table. Awarded bid statistics are secondary aids that summarize the currently filtered evidence rows.

## Application Shape

- Hosting target: GitHub Pages.
- Frontend stack: Vite + TypeScript.
- Runtime model: static files only; no server and no database.
- Data model: browser-loaded CSV files in `public/data`, including item observations, agency item mappings, and CDOT section metadata.
- Evidence model: deterministic TypeScript grouping and filtering rules in `src/matching`.
- Deployment path: GitHub Actions builds the Vite app and publishes `dist` to GitHub Pages from `main`.

The app loads the CSV package at startup, builds in-memory lookup maps, and runs all filtering and scoring in the browser.

## Data Flow

1. `src/main.ts` starts the app.
2. `src/data/loadData.ts` loads CSV files from `public/data`.
3. `src/data/schema.ts` defines app-facing data structures, including `SpecSectionRecord` for CDOT section/prefix labels and abbreviated agency item descriptions.
4. `src/matching/buildEvidenceResult.ts` groups exact item-code observations into project-item evidence rows.
5. `src/matching/buildEvidenceResult.ts` applies explicit evidence filters and calculates awarded bid summary statistics for the filtered table.
6. Prior comparable scoring modules remain in the repository for reference, but the primary UI no longer uses hidden top-five relevance selection.
7. `src/ui` renders the fixed prototype scope, item search, evidence filters, evidence table, awarded bid summary, and data notes.
8. `src/ui/helpTip.ts` renders prototype-only explanatory markers for fields, metrics, and table columns.

## Data Governance

The CSV records include synthetic demo data and public CDOT 2025 Q4 and 2026 Q1 Cost Data Book records. They are prototype evidence and must be reviewed before estimating use.

Do not commit private FHU estimate data to a public GitHub Pages repository. Real internal data should either stay outside the repo, be uploaded locally by the user in a later browser-only workflow, or move to an approved private hosting model.

The repository can generate staging CSVs from public CDOT Cost Data Book PDFs, validate them against project-list pages and agency item codes, and promote them into app-loaded source, project, and observation CSVs. The current promoted public CDOT cost-book sources are `cdot_cost_data_book_2025_q4` and `cdot_cost_data_book_2026_q1`.

## Evidence Browser Rules

The Phase 1 evidence browser rules are intentionally visible and simple:

- Filter to the fixed Colorado prototype state.
- Use public CDOT cost-book rows by default.
- Require selection of an official agency item code before displaying project evidence.
- Use exact agency item-code matches as the default definition of relevant evidence.
- Resolve official item descriptions and units from agency item-code records when possible.
- Group separate awarded bid, average bid, and engineer estimate observations into one project-item row when they describe the same project, item, unit, quantity, and date.
- Show same-unit rows by default.
- Show unit-mismatch counts as data notes instead of mixing units in the default table.
- Apply source, geography, district, year, quantity, unit, and awarded-price filters as hard filters.
- Sort evidence rows newest first, then by project number or project name.
- Calculate summary statistics from awarded bid unit prices only.

Alias, keyword, and description fallback matching should return only in a later explicit review mode. They are not part of the default evidence table.

## Prototype Annotations

The UI includes small information markers that explain what each input, metric, and table column means, why it affects matching, and where real data should come from. These annotations are intended for early review with non-roadway users and roadway subject-matter experts. They are not part of the long-term estimating workflow unless reviewers find them useful.

The information markers should open only when the marker itself is hovered or keyboard-focused. They should not appear when the user hovers over or types in the associated form field.

The Item Explorer also includes a clear action for removing the current query values.

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

The full item code book supports lookup only. Existing synthetic demo rows with comparable observations are preserved separately, so pricing still appears only when matching rows exist in `public/data/item_observations.csv`.

The submitted `SearchQuery` shape did not change. The visible item search is limited to item identity and quantity. Unit is resolved from the selected official item and displayed as a non-editable suffix in the quantity field when available. Evidence filters are applied from the result-side evidence controls after item identity is established.

## Near-Term Extension Points

- Review promoted 2025 Q4 and 2026 Q1 CDOT cost-book rows with roadway engineers.
- Add CSV export for the filtered evidence table.
- Add manual include/exclude controls and reviewer notes for an engineer-selected evidence set.
- Add validation coverage for future CDOT cost-book quarters before promotion.
- Add reviewed FHU data only through an approved private-data workflow.
- Add estimate workspace rows after the item explorer is trusted.
- Add CSV/XLSX import only after schema mapping rules are validated.
- Consider DuckDB-WASM or SQLite-in-browser only when CSV filtering becomes too slow or relationship validation becomes difficult.
