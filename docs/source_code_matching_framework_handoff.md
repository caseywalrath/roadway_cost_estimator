# Future Work: Source-Code Matching Framework for Ralston Bid Tab

## Context

We want to add another FHU-curated public bid tab workbook:

`C:\Users\Casey.Walrath\Downloads\2021 02 05 Ralston Rd Yukon to Garrison Bid Tab.xlsx`

This workbook is not the same structure as the Watson or Arapahoe bid tabs already supported. It uses one `Results` sheet with City of Arvada / COA spec references such as `COA 3.5`, `COA 5.7.2`, and some `CDOT ###` references. Most rows do not have CDOT item codes.

Current app behavior assumes evidence is searchable by exact CDOT `agency_item_code`. Forcing COA codes into that field would either make rows undiscoverable or contaminate CDOT exact-code matching.

## Goal

Build a general source-item-code matching framework before importing Ralston into app-loaded evidence.

The framework should preserve source item identity while allowing reviewed CDOT matches. Only rows with reviewed CDOT matches should participate in exact-code Matching Projects and Unit Price Summaries. Unmatched rows should remain visible in project/bidder detail.

## Proposed Branch

Create a new branch later:

`codex/source-code-matching-framework`

Base it on the latest `main` after PR #28 is merged, unless directed otherwise.

## Ralston Workbook Facts

Workbook:

- Sheet: `Results`
- Project name: `Ralston Road - Yukon Street to Garrison Street`
- Project number: `18-ST-40`
- Date basis: `2021-02-05`
- Header row: row 7
- Item rows: rows 8 through 242
- Total row: row 244
- Numbered item rows: 235
- Engineer estimate plus 6 bidders

Bid totals:

- Engineer estimate: `$13,874,594.81`
- Hamon Infrastructure: `$12,360,000.00`, apparent low
- Edge Contracting: `$13,360,995.50`
- Brannan Sand & Gravel Co: `$14,079,260.56`
- Concrete Works of Colorado, Inc.: `$14,115,478.07`
- Flatiron Constructors, Inc.: `$14,789,252.31`
- American Civil Constructors, Inc.: `$15,041,491.00`

Important parsing detail:

- Include all numbered rows, including force-account rows with blank `Spec*`.
- Do not require `Spec*` to be populated.

## Desired Data Model

Add source item identity fields to bid-tab staging/detail data:

- `source_item_code`
- `source_item_code_system`
- `source_spec_raw`
- `source_item_description`
- `matched_agency_item_code`
- `match_status`

Use `agency_item_code` in app-loaded summary evidence only when a reviewed CDOT match exists.

Suggested match statuses:

- `matched`
- `unmatched`
- `source_cdot_prefix_only`

## Matching Policy

Do not fuzzy-map automatically.

Initial matching rules:

- Exact compatible CDOT description/unit match may create a suggested candidate.
- Multiple matches remain unresolved.
- No-match COA rows remain unresolved.
- Force-account rows remain source-only unless explicitly reviewed.
- Reviewed matches are required before a row appears in CDOT exact-code evidence.

## Ralston Metadata

Use:

- Source ID: `fhu_bid_tab_ralston_yukon_garrison_2021_02_05`
- Source label: `FHU Civil Group Bid Tabs - Ralston Road Yukon to Garrison`
- Source type: `public_bid_tab`
- Project ID: `fhu_bid_tab_ralston_yukon_garrison_2021_02_05_18_st_40`
- Project number: `18-ST-40`
- Project name: `Ralston Road - Yukon Street to Garrison Street`
- Agency owner: `City of Arvada`
- State: `CO`
- County/region: `Jefferson County / Arvada`
- Date basis: `2021-02-05`
- Bid count: `6`

Awarded fields stay blank.

## Implementation Notes

Update `scripts/import_bid_tab_workbook.py` with a third parser layout:

- Detect `Results` sheet.
- Detect header row with `No.`, `Spec*`, `Item`, `Unit`, `Quantity`.
- Detect paired `Unit Cost` / `Extended Cost` columns from row 6 bidder labels.
- Calculate average bid unit price from bidder unit prices.
- Reconcile totals to row 244.

Update data/UI behavior:

- Existing CDOT exact-code search remains based on reviewed `agency_item_code`.
- Unmatched source-only rows should not affect Unit Price Summaries.
- Bidder detail modal should be able to show unmatched source rows.

## Tests

Add tests for:

- Ralston layout detection.
- 235 parsed item rows.
- 6 bidders.
- Correct bid totals.
- Hamon as sole apparent low bidder.
- Blank-spec force-account rows included.
- Unit normalization for `DY`, `HR`, `FA`, and `AC`.
- Unmatched rows excluded from exact-code summaries.
- Unmatched rows available in bidder detail data.

Run:

- `python -m unittest scripts.test_import_bid_tab_workbook`
- `scripts/validate_data_package.py`
- TypeScript + Vite build

## Explicit Constraint

Do not import or commit Ralston app-loaded evidence until the source-code matching framework is implemented and reviewed.
