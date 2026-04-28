# Architecture Overview

## Current Product

This repository contains a static-first prototype for a Colorado roadway cost-comparable explorer.

The first product is not a chatbot and not a full project estimator. It is a structured evidence tool that helps a user enter one roadway bid item and review comparable demo records, price ranges, confidence, warnings, and next steps.

## Application Shape

- Hosting target: GitHub Pages.
- Frontend stack: Vite + TypeScript.
- Runtime model: static files only; no server and no database.
- Data model: browser-loaded CSV files in `public/data`.
- Matching model: deterministic TypeScript scoring rules in `src/matching`.
- Deployment path: GitHub Actions builds the Vite app and publishes `dist` to GitHub Pages from `main`.

The app loads the CSV package at startup, builds in-memory lookup maps, and runs all filtering and scoring in the browser.

## Data Flow

1. `src/main.ts` starts the app.
2. `src/data/loadData.ts` loads CSV files from `public/data`.
3. `src/data/schema.ts` defines app-facing data structures.
4. `src/matching/scoreComparableItems.ts` ranks comparable records.
5. `src/matching/priceSummary.ts` calculates low, percentile, median, high, and suggested unit price values.
6. `src/matching/confidence.ts` converts match quality into High, Medium, Low, or Not supportable.
7. `src/ui` renders the project context, item explorer, recommendation summary, comparable table, warnings, and improve-confidence guidance.
8. `src/ui/helpTip.ts` renders prototype-only explanatory markers for fields, metrics, and table columns.

## Data Governance

The current CSV records are synthetic demo data. They are labeled as demo data and must not be used for real estimating.

Do not commit private FHU estimate data to a public GitHub Pages repository. Real internal data should either stay outside the repo, be uploaded locally by the user in a later browser-only workflow, or move to an approved private hosting model.

## Matching Rules

The MVP matching rules are intentionally visible and simple:

- Filter to the selected state.
- Filter source scope when requested.
- Prefer exact agency item-code matches.
- Use approved alias or canonical item matches second.
- Use keyword fallback last.
- Require same unit for price recommendations.
- Score quantity similarity, project recency, geography, work type, and Colorado source provenance.

Unit mismatches are shown as warnings and excluded from the price summary.

## Prototype Annotations

The UI includes small information markers that explain what each input, metric, and table column means, why it affects matching, and where real data should come from. These annotations are intended for early review with non-roadway users and roadway subject-matter experts. They are not part of the long-term estimating workflow unless reviewers find them useful.

The information markers should open only when the marker itself is hovered or keyboard-focused. They should not appear when the user hovers over or types in the associated form field.

The Item Explorer also includes a clear action for removing the current query values and a reset action for restoring the demo example query.

## Near-Term Extension Points

- Replace demo CSVs with validated public CDOT source data.
- Add reviewed FHU data only through an approved private-data workflow.
- Add estimate workspace rows after the item explorer is trusted.
- Add CSV/XLSX import only after schema mapping rules are validated.
- Consider DuckDB-WASM or SQLite-in-browser only when CSV filtering becomes too slow or relationship validation becomes difficult.
