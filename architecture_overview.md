# Architecture Overview

## Current Product

This repository contains a static-first prototype for a Colorado roadway cost-comparable explorer.

The first product is not a chatbot and not a full project estimator. It is a structured evidence tool that helps a user identify one roadway bid item and review comparable demo records, price ranges, confidence, warnings, and next steps.

## Application Shape

- Hosting target: GitHub Pages.
- Frontend stack: Vite + TypeScript.
- Runtime model: static files only; no server and no database.
- Data model: browser-loaded CSV files in `public/data`, including item observations, agency item mappings, and CDOT section metadata.
- Matching model: deterministic TypeScript scoring rules in `src/matching`.
- Deployment path: GitHub Actions builds the Vite app and publishes `dist` to GitHub Pages from `main`.

The app loads the CSV package at startup, builds in-memory lookup maps, and runs all filtering and scoring in the browser.

## Data Flow

1. `src/main.ts` starts the app.
2. `src/data/loadData.ts` loads CSV files from `public/data`.
3. `src/data/schema.ts` defines app-facing data structures, including `SpecSectionRecord` for CDOT section/prefix labels and abbreviated agency item descriptions.
4. `src/matching/scoreComparableItems.ts` ranks comparable records.
5. `src/matching/priceSummary.ts` calculates low, percentile, median, high, and suggested unit price values.
6. `src/matching/confidence.ts` converts match quality into High, Medium, Low, or Not supportable.
7. `src/ui` renders the fixed prototype scope, item search, recommendation summary, result-side project relevance controls, comparable table, warnings, and improve-confidence guidance.
8. `src/ui/helpTip.ts` renders prototype-only explanatory markers for fields, metrics, and table columns.

## Data Governance

The current CSV records are synthetic demo data. They are labeled as demo data and must not be used for real estimating.

Do not commit private FHU estimate data to a public GitHub Pages repository. Real internal data should either stay outside the repo, be uploaded locally by the user in a later browser-only workflow, or move to an approved private hosting model.

The repository can now generate a review-only staging CSV from the public CDOT 2026 Q1 Cost Data Book PDF. This staging output is not loaded by the app until the extracted rows are reviewed and mapped into the app data schema.

## Matching Rules

The MVP matching rules are intentionally visible and simple:

- Filter to the fixed Colorado prototype state.
- Use all loaded demo source records by default.
- Prefer exact agency item-code matches.
- Resolve official item descriptions and units from agency item-code records when possible.
- Use approved alias or canonical item matches second.
- Use keyword fallback last.
- Require same unit for price recommendations.
- Score quantity similarity, project recency, geography, work type, and Colorado source provenance. Project recency, geography, and work type are controlled from the result-side comparable project area, not from the item search panel.

Unit mismatches are shown as warnings and excluded from the price summary.

## Prototype Annotations

The UI includes small information markers that explain what each input, metric, and table column means, why it affects matching, and where real data should come from. These annotations are intended for early review with non-roadway users and roadway subject-matter experts. They are not part of the long-term estimating workflow unless reviewers find them useful.

The information markers should open only when the marker itself is hovered or keyboard-focused. They should not appear when the user hovers over or types in the associated form field.

The Item Explorer also includes a clear action for removing the current query values.

## Item Code Search Funnel

The item search uses a CDOT section-based item picker instead of a single long item-code dropdown.

The visible left-panel flow is:

1. Locate Item: select a CDOT specification division and section/prefix when they help narrow the search, then use Item code or description to filter loaded agency items by item code, suffix, official description, or abbreviated description.
2. Select Item: review the potential matching items and select one result to populate the submitted item code. The matching layer resolves the official description and unit from the agency item table.
3. Enter quantity: provide the planned quantity before searching comparable projects.

Item code or description works across all loaded agency items when no division or section is selected. Division and section selections narrow the visible search results when selected. Select Item stays empty until the user selects a division, selects a section, types an item search, or already has an official item selected. If the user does not select an official item, the typed description can still submit as a weaker manual description search.

Section labels come from `public/data/spec_sections.csv`. Item-level options continue to come from `public/data/agency_items.csv`.

The current item picker data is generated from the public CDOT 2026 Item Code Book Excel file linked from CDOT's Item Code Book by Year page. The committed CSV contains 4,771 valid item-code rows and 100 item-code prefixes. The raw Excel workbook is not committed; `scripts/import_cdot_item_code_book.py` converts a downloaded workbook into the static CSV files.

Some prefixes use known CDOT Standard Specification section labels. Prefixes not yet mapped to a known section label use fallback labels so all valid item-code rows remain searchable.

The full item code book supports lookup only. Existing synthetic demo rows with comparable observations are preserved separately, so pricing still appears only when matching rows exist in `public/data/item_observations.csv`.

The submitted `SearchQuery` shape did not change. The visible item search is limited to item identity and quantity. Unit is resolved from the selected official item and displayed as a non-editable suffix in the quantity field when available. County / region, estimate year, and work type are applied from the comparable-project result controls after item identity is established.

## Near-Term Extension Points

- Replace demo CSVs with validated public CDOT source data.
- Review CDOT cost-book staging rows and promote approved rows into app-loaded pricing data.
- Add reviewed FHU data only through an approved private-data workflow.
- Add estimate workspace rows after the item explorer is trusted.
- Add CSV/XLSX import only after schema mapping rules are validated.
- Consider DuckDB-WASM or SQLite-in-browser only when CSV filtering becomes too slow or relationship validation becomes difficult.
