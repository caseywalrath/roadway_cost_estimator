# Data Schema

## Purpose

The prototype uses static CSV files so non-developers can inspect records and Git can track every data change.

The current data package includes public CDOT 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1 Cost Data Book records, public FHU-curated bid tab workbooks, plus static FHWA NHCCI quarterly index values for optional inflation adjustment in summary statistics and display-only row context. It is prototype evidence, not estimating guidance.

## Files

### `sources.csv`

Records where source data came from.

Required columns:

- `source_id`
- `source_type`
- `agency`
- `state`
- `source_label`
- `data_year`
- `notes`

### `projects.csv`

One row per source project.

Required columns:

- `project_id`
- `project_name`
- `agency_owner`
- `state`
- `county_region`
- `work_type`
- `estimate_let_date`
- `source_id`

Optional public cost-book metadata columns:

- `project_number`
- `project_location_raw`
- `contractor`
- `district`
- `terrain`
- `bid_count`
- `awarded_bid_total`
- `award_index`

### `item_observations.csv`

One row per bid item, estimate item, or cost observation.

Required columns:

- `observation_id`
- `project_id`
- `source_id`
- `agency_item_code`
- `description_raw`
- `description_normalized`
- `unit_raw`
- `unit_normalized`
- `quantity`
- `unit_price`
- `extended_price`
- `discipline`
- `price_type`
- `date_basis`

Known `price_type` values include:

- `cdot_awarded_bid`
- `cdot_average_bid`
- `cdot_engineer_estimate`
- `public_bid_tab_average`
- `public_bid_tab_engineer_estimate`

The app defaults to public CDOT awarded-bid evidence for Matching Projects. Average bid and engineer estimate rows are loaded as separate observation types for review, table display, CSV export, and non-awarded unit price summaries. Public bid-tab rows do not populate awarded bid unit price.

### `bidder_bids.csv`

One row per bidder in a public bid-tab source.

Required columns:

- `bid_id`
- `project_id`
- `source_id`
- `bidder_name`
- `bid_total`
- `bid_rank`
- `apparent_low`

`apparent_low` records the apparent low bidder from the bid tab only. It is not confirmed award evidence.

### `bidder_item_observations.csv`

One row per bidder, item, and bid-tab source.

Required columns:

- `bidder_item_observation_id`
- `bid_tab_item_id`
- `bid_id`
- `project_id`
- `source_id`
- `description_raw`
- `unit_raw`
- `unit_normalized`
- `quantity`
- `unit_price`
- `extended_price`

`agency_item_code` is optional for source-only bid-tab rows. When a bid-tab row has a reviewed CDOT match, bidder item rows use the matched CDOT code so exact-code Matching Projects can open bidder detail. The app also uses `bid_tab_item_id` to show every original source row, including unmatched rows, in public bid-tab project review.

### `bid_tab_items.csv`

One row per source workbook item row from a public bid-tab source.

Required columns:

- `bid_tab_item_id`
- `project_id`
- `source_id`
- `source_file`
- `sheet_name`
- `workbook_row`
- `project_number`
- `source_item_number`
- `source_item_code`
- `source_item_code_system`
- `source_spec_raw`
- `source_item_description`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `matched_agency_item_code`
- `match_status`
- `date_basis`

`match_status` values are `matched`, `unmatched`, and `source_cdot_prefix_only`. Only rows with a reviewed `matched_agency_item_code` should be promoted into `item_observations.csv` for exact-code Matching Projects. For reconciled Ralston rows, `item_code` and `matched_agency_item_code` store the reviewed CDOT code while `source_item_code`, `source_spec_raw`, `source_item_description`, and `unit_raw` preserve the City of Arvada/source workbook identity. Source-only rows remain visible through the public bid-tab project review UI.

### `canonical_items.csv`

Reusable item families used for description matching.

Required columns:

- `canonical_item_id`
- `item_family`
- `canonical_description`
- `discipline`
- `typical_units`
- `keywords_include`
- `keywords_exclude`

List fields use semicolons.

### `agency_items.csv`

Official or agency-style item code mappings.

Required columns:

- `agency_item_id`
- `state`
- `agency`
- `item_code`
- `official_description`
- `official_abbreviated_description`
- `official_unit`
- `canonical_item_id`

Rows with a blank `canonical_item_id` can appear when the row is present only to support item-code lookup and has not been mapped to a comparable item family yet. Exact-code pricing still requires matching rows in `item_observations.csv`.

The current `agency_items.csv` is generated from the public CDOT 2026 Item Code Book Excel file linked from CDOT's Item Code Book by Year page. The generated file includes all valid item-code rows found in the workbook. Two reviewed Kipling/Bowles bid-tab lookup rows, `625-01000` Utility Surveying and `626-01100` Public Information Services, are also included so those exact CDOT-coded bid-tab rows remain searchable. The raw workbook is not committed.

### `spec_sections.csv`

Official CDOT specification section metadata used to narrow item-code lookup before selecting an item.

Required columns:

- `section_prefix`
- `division_prefix`
- `division_title`
- `section_title`
- `source_year`
- `source_url`

This file is a reference lookup table for section labels. It is not a cost book and does not replace `agency_items.csv`.

The current file is generated with `scripts/import_cdot_item_code_book.py` from the same CDOT 2026 Item Code Book workbook as `agency_items.csv`. Known CDOT Standard Specification prefixes use reviewed section labels. Unmapped prefixes use fallback labels so every loaded agency item can appear in the section-based picker.

### `inflation_index.csv`

Static FHWA National Highway Construction Cost Index values used only when the user turns on Inflation Adjustment in the Awarded Bid Summary.

Required columns:

- `index_id`
- `index_name`
- `period_year`
- `period_quarter`
- `period_label`
- `period_start_date`
- `period_end_date`
- `index_value`
- `source_url`
- `notes`

The current file is generated with `scripts/refresh_nhcci_index.py` from the DOT public data endpoint for FHWA NHCCI. The app uses the unadjusted quarterly NHCCI value and adjusts awarded bid unit prices from each evidence row's let-date quarter to the latest loaded NHCCI quarter. Matching Projects table prices and CSV export remain original awarded-bid evidence.

If evidence contains quarters newer than the latest loaded official NHCCI value, validation reports a warning and the adjusted summary excludes those awarded bid rows when Inflation Adjustment is on. The app does not interpolate or fabricate missing index values.

### `aliases.csv`

Reviewed description-to-canonical mappings.

Required columns:

- `alias_id`
- `state`
- `agency`
- `raw_description_pattern`
- `canonical_item_id`
- `match_type`
- `confidence`
- `notes`

### `imports/cdot_cost_data_book_2022_q4_item_unit_costs.csv`

Review staging rows extracted from the public CDOT 2022 Q4 Cost Data Book PDF.

This file is the item-level staging artifact used before promoting rows into `sources.csv`, `projects.csv`, and `item_observations.csv`.

Required columns:

- `source_file`
- `source_period`
- `page_number`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `project_location_raw`
- `date_let`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `awarded_bid_unit_price`
- `raw_text`

The parser excludes CDOT weighted-average summary rows and rows with placeholder prices rather than complete bid prices. `date_let` is normalized to ISO format. `raw_text` preserves the parsed PDF text for reviewer traceability.

### `imports/cdot_cost_data_book_2022_q4_projects.csv`

Review staging rows parsed from the project-list pages in the public CDOT 2022 Q4 Cost Data Book PDF.

This file is generated by `scripts/promote_cdot_cost_data_book.py` and is used to avoid naive splitting of `project_location_raw` item rows. It is also a review artifact for promoted project metadata.

Required columns match the extended `projects.csv` columns.

### `imports/cdot_cost_data_book_2023_q4_item_unit_costs.csv`

Review staging rows extracted from the public CDOT 2023 Q4 Cost Data Book PDF.

This file is the item-level staging artifact used before promoting rows into `sources.csv`, `projects.csv`, and `item_observations.csv`.

Required columns:

- `source_file`
- `source_period`
- `page_number`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `project_location_raw`
- `date_let`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `awarded_bid_unit_price`
- `raw_text`

The parser excludes CDOT weighted-average summary rows. `date_let` is normalized to ISO format. `raw_text` preserves the parsed PDF text for reviewer traceability.

### `imports/cdot_cost_data_book_2023_q4_projects.csv`

Review staging rows parsed from the project-list pages in the public CDOT 2023 Q4 Cost Data Book PDF.

This file is generated by `scripts/promote_cdot_cost_data_book.py` and is used to avoid naive splitting of `project_location_raw` item rows. It is also a review artifact for promoted project metadata.

Required columns match the extended `projects.csv` columns.

### `imports/cdot_cost_data_book_2024_q4_item_unit_costs.csv`

Review staging rows extracted from the public CDOT 2024 Q4 Cost Data Book PDF.

This file is the item-level staging artifact used before promoting rows into `sources.csv`, `projects.csv`, and `item_observations.csv`.

Required columns:

- `source_file`
- `source_period`
- `page_number`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `project_location_raw`
- `date_let`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `awarded_bid_unit_price`
- `raw_text`

The parser excludes CDOT weighted-average summary rows. `date_let` is normalized to ISO format. `raw_text` preserves the parsed PDF text for reviewer traceability.

### `imports/cdot_cost_data_book_2024_q4_projects.csv`

Review staging rows parsed from the project-list pages in the public CDOT 2024 Q4 Cost Data Book PDF.

This file is generated by `scripts/promote_cdot_cost_data_book.py` and is used to avoid naive splitting of `project_location_raw` item rows. It is also a review artifact for promoted project metadata.

Required columns match the extended `projects.csv` columns.

### `imports/cdot_cost_data_book_2025_q4_item_unit_costs.csv`

Review staging rows extracted from the public CDOT 2025 Q4 Cost Data Book PDF.

This file is the item-level staging artifact used before promoting rows into `sources.csv`, `projects.csv`, and `item_observations.csv`.

Required columns:

- `source_file`
- `source_period`
- `page_number`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `project_location_raw`
- `date_let`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `awarded_bid_unit_price`
- `raw_text`

The parser excludes CDOT weighted-average summary rows. `date_let` is normalized to ISO format. `raw_text` preserves the parsed PDF text for reviewer traceability.

### `imports/cdot_cost_data_book_2025_q4_projects.csv`

Review staging rows parsed from the project-list pages in the public CDOT 2025 Q4 Cost Data Book PDF.

This file is generated by `scripts/promote_cdot_cost_data_book.py` and is used to avoid naive splitting of `project_location_raw` item rows. It is also a review artifact for promoted project metadata.

Required columns match the extended `projects.csv` columns.

### `imports/cdot_cost_data_book_2026_q1_item_unit_costs.csv`

Review staging rows extracted from the public CDOT 2026 Q1 Cost Data Book PDF.

This file is the item-level staging artifact used before promoting rows into `sources.csv`, `projects.csv`, and `item_observations.csv`.

Required columns:

- `source_file`
- `source_period`
- `page_number`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `project_location_raw`
- `date_let`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `awarded_bid_unit_price`
- `raw_text`

The parser excludes CDOT weighted-average summary rows. `date_let` is normalized to ISO format. `raw_text` preserves the parsed PDF text for reviewer traceability.

### `imports/cdot_cost_data_book_2026_q1_projects.csv`

Review staging rows parsed from the project-list pages in the public CDOT 2026 Q1 Cost Data Book PDF.

This file is generated by `scripts/promote_cdot_cost_data_book.py` and is used to avoid naive splitting of `project_location_raw` item rows. It is also a review artifact for promoted project metadata.

Required columns match the extended `projects.csv` columns.

### `imports/fhu_bid_tab_*_item_unit_costs.csv`

Review staging rows extracted from public FHU-curated bid tab workbooks.

Required columns match `bid_tab_items.csv`.

Older staging rows used these core identity and price columns:

- `source_file`
- `sheet_name`
- `workbook_row`
- `project_number`
- `item_code`
- `item_description`
- `unit_raw`
- `unit_normalized`
- `quantity`
- `engineer_estimate_unit_price`
- `average_bid_unit_price`
- `date_basis`

The current workbook parser is `scripts/import_bid_tab_workbook.py`. It detects supported workbook layouts, normalizes clear unit synonyms, preserves repeated item codes by workbook row, computes bidder totals, computes apparent low bidder, writes staging CSVs, and promotes reviewed rows into the app-loaded CSV package.

Supported layout families:

- Watson SAQ-style workbooks with project metadata, engineer estimate, bidder, and average bid column groups.
- Arapahoe bid-form workbooks with `ITEM NO.`, `ITEM DESCRIPTION`, `UNIT`, `QUANTITY`, itemized engineer estimate columns, and bidder unit/total column pairs. Average bid unit prices are calculated from bidder unit prices during import.
- Kipling/Bowles split-header tabulation workbooks with `ITEM` / `NO.`, item descriptions, unit, quantity, engineer estimate columns, bidder unit/extended cost pairs, and an `Average Bid Price` reference group. The importer parses the base bid schedule only and ignores blank/error alternate rows.
- Ralston `Results` sheet workbooks with `No.`, `Spec*`, `Item`, `Unit`, `Quantity`, paired bidder `Unit Cost` / `Extended Cost` columns, and optional reviewed reconciliation columns `CDOT Item Code`, `CDOT Description`, `CDOT Unit`, and `Confidence`. Rows with reviewed CDOT item codes are promoted into exact-code evidence; blank or `None` CDOT item codes remain source-only.

### `imports/fhu_bid_tab_*_match_candidates.csv`

Review staging rows for exact description/unit candidate matches from public FHU-curated bid tab workbooks.

Required columns:

- `bid_tab_item_id`
- `source_item_code`
- `source_item_description`
- `unit_normalized`
- `candidate_agency_item_code`
- `candidate_description`
- `candidate_unit`
- `candidate_count`
- `suggestion_status`

Candidate rows are suggestions only. They are not promoted to exact-code evidence unless reviewed.

### `imports/fhu_bid_tab_*_bidder_bids.csv`

Review staging rows for bidder-level project totals from public FHU-curated bid tab workbooks.

Required columns match `bidder_bids.csv`.

### `imports/fhu_bid_tab_*_bidder_item_observations.csv`

Review staging rows for bidder-level item prices from public FHU-curated bid tab workbooks.

Required columns match `bidder_item_observations.csv`.

## Data Rules

- Use stable IDs.
- Preserve raw descriptions.
- Normalize descriptions separately.
- Preserve raw units and normalized units.
- Do not compare unit prices across incompatible units.
- Every observation must point to a source and project.
- Public CDOT Cost Data Book rows use one `sources.csv` row and separate `price_type` values for awarded bid, average bid, and engineer estimate.
- Public CDOT Cost Data Book imports use one source row per period, with stable period-specific IDs such as `cdot_cost_data_book_2022_q4`, `cdot_cost_data_book_2023_q4`, `cdot_cost_data_book_2024_q4`, `cdot_cost_data_book_2025_q4`, and `cdot_cost_data_book_2026_q1`.
- Public FHU-curated bid tab rows use `source_type` `public_bid_tab` and preserve bidder details without implying award status.
- Public bid-tab imports preserve source item identity in `bid_tab_items.csv` before any exact-code promotion.
- Source-only bid-tab rows can have blank `agency_item_code` in `bidder_item_observations.csv`; their source identity is carried by `bid_tab_item_id`.
- Reviewed CDOT matches are required before a source bid-tab row appears in `item_observations.csv`, Matching Projects, or Unit Price Summaries. Reconciliation `Confidence` values are review metadata only and are not used in app logic.
- Public bid-tab projects leave `contractor`, `awarded_bid_total`, and `award_index` blank unless confirmed award evidence is added.
- Public bid-tab item summaries use `public_bid_tab_average` and `public_bid_tab_engineer_estimate`; they never use `cdot_awarded_bid`.
- Unit normalization maps `EA` and `EACH` to `EACH`; `LS`, `L S`, and `LUMP SUM` to `L S`; `LB`, `POUND`, and `POUNDS` to `LB`; `SF`, `SQ FT`, and `SQUARE FOOT` to `SF`; `SY`, `SQ YD`, and `SQUARE YARD` to `SY`; `CY`, `CU YD`, and `CUBIC YARD` to `CY`; `LF`, `FOOT`, and `FEET` to `LF`; `HR`, `HOUR`, and `HOURS` to `HOUR`; `DY`, `DAY`, and `DAYS` to `DAY`; `AC` and `ACRE` to `ACRE`; and `FA`, `F A`, and `F/A` to `F A`.
- Public bid-tab imports attempt exact short item-code resolution against `agency_items.csv` by normalized description and compatible unit. Ambiguous or missing matches are preserved as workbook item codes and reported as validation warnings.
- Unknown units are preserved uppercase and reported by import validation. No unit conversions are performed.
- Every loaded agency item should have a matching section prefix in `spec_sections.csv` when the picker needs to expose that item.
- The full item-code book is lookup data only; pricing requires matching records in `item_observations.csv`.
- Cost data book staging imports must be reviewed before they are promoted into app-loaded pricing data.
- Synthetic demo project evidence should not be committed to the app-loaded public data package.
- Private FHU data must not be committed to a public repository.

## Data Package Validation

Run the committed CSV package validator before promoting new app-loaded data or deploying the site:

```text
npm run validate:data
```

The validator uses only Python standard library modules and reads the app-loaded CSV files from `public/data`.

Validation errors fail the command when the data package has:

- missing required columns
- duplicate source, project, observation, agency item, or section IDs
- project rows that reference missing sources
- observation rows that reference missing projects or sources
- observation source IDs that do not match the referenced project source IDs
- bidder rows that reference missing projects, sources, or bids
- bid-tab item rows that reference missing projects or sources
- bidder item rows that reference missing bids or bid-tab items
- bidder item rows where quantity times unit price does not equal extended price within cent tolerance
- blank required relationship or evidence fields
- nonnumeric numeric fields
- invalid date shapes
- app-loaded demo evidence IDs or legacy demo source and price types
- no awarded-bid evidence for smoke-test item `304-06007`

Validation warnings do not fail the command when the data package has:

- observation item codes that are not present in the current `agency_items.csv`
- matched bid-tab item codes that are not present in the current `agency_items.csv`
- agency item prefixes that are not present in `spec_sections.csv`
- blank optional project metadata
- smoke-test item counts that change from the current baseline

Current smoke-test awarded-bid baselines:

- `304-06007`: 151 rows
- `626-00000`: 422 rows
- `630-80341`: 420 rows
- `630-00012`: 415 rows
- `630-80342`: 411 rows
- `630-00000`: 396 rows
