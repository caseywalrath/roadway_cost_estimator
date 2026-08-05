# Nebraska NDOT Annual Price Data Implementation Plan

## Handoff Purpose

This document is the implementation specification for adding Nebraska Department of Transportation (NDOT) average unit price reports to Roadway Cost Estimator.

It is written for a smaller-context implementation model. Follow the phases in order. Do not collapse the annual aggregate data into the existing project and contract evidence tables.

## Approved Product Decisions

The following decisions are final for the first release:

1. Include both NDOT report series:
   - January through December calendar reports.
   - July through June rolling reports.
2. Initial historical scope:
   - Calendar reports from January 2018 through December 2025.
   - Rolling reports from July 2017 through June 2018 through July 2025 through June 2026.
   - This is 17 reports based on the NDOT source page as reviewed on August 5, 2026.
   - Exclude the January through December 2017 report and the July 2016 through June 2017 report.
3. Preserve overlapping periods. The overlap is useful for viewing price movement as the reporting window advances.
4. Do not combine overlapping reports or calculate a multi-period price.
5. Do not include NDOT published averages in the Unit Price Summary statistics.
6. Keep the Unit Price Summary panel visible. Directly below its heading, show this exact note when NDOT aggregate rows are available for the selected item:

   `NDOT average price data excluded`

7. Keep the manual Add Item to Project form available for a selected NDOT item. The user manually enters Unit Cost and Quantity.
8. Do not provide one-click price fills from an NDOT annual row or from a derived annual-price statistic.
9. Leave the existing contract schema available for future NDOT project bid tabs and Nebraska municipal bid tabs.
10. Label the source measure `NDOT published average unit price`. Do not call it awarded price, low-bid price, or all-bid average unless NDOT later documents the underlying methodology.

## Required Session Start

Before implementation changes:

1. Read `codex.md` completely.
2. Read `architecture_overview.md` completely.
3. Read this plan completely.
4. Run an escalated `git fetch --all --prune` using the Git executable documented in `codex.md`.
5. Run `git status --short --branch`.
6. Confirm the intended implementation branch is based on current `origin/main`.
7. Use branch `codex/add-nebraska-annual-prices` unless the user provides another branch name.
8. Do not make implementation changes on a stale branch.
9. Preserve all unrelated user changes.

## Product Outcome

After the change, Nebraska is a selectable state. The user can:

1. Locate an NDOT item using Nebraska taxonomy, item code, or description.
2. Select one exact NDOT item identity.
3. Review every matching NDOT calendar and July-June published report row in one Annual Unit Price History table.
4. Compare overlapping reporting periods without the application pooling or summarizing them.
5. Toggle inflation adjustment for displayed annual average unit prices when complete FHWA NHCCI coverage is available.
6. Download the annual history as CSV with source provenance.
7. Manually enter a Unit Cost and Quantity in Add Item to Project.

The first release does not provide Nebraska contract, bidder, awarded-vendor, location, or project-level evidence.

## Non-Goals

Do not implement any of the following in this work:

- A synthetic contract or letting for an annual PDF.
- An unweighted average of annual averages.
- A quantity-weighted multi-report price.
- Project-style low, percentile, median, average, or high statistics from annual rows.
- One-click Project price fills from annual rows.
- Automatic municipal-to-NDOT item mapping.
- Cross-state item comparison.
- Automatic claims about whether the NDOT averages use awarded bids, low bids, or all bids.
- South Dakota annual report promotion. South Dakota remains unchanged.

## Architecture Decision

Add a generic optional period-level item-price summary path beside the contract evidence path.

The two evidence grains must remain separate:

```text
Contract evidence
  contract -> contract item -> bidder prices and item observations

Period aggregate evidence
  source report -> period item-price summary
```

The period summary record references a source and agency item. It does not reference a letting or contract.

This is a generic schema extension, not a Nebraska-only synthetic contract workaround. Other states may use the optional table later, but existing state behavior must remain unchanged.

## Source Inventory

Official listing page:

`https://dot.nebraska.gov/business-center/hwy-bridge-lp/item-history/`

The importer must create a committed inventory before parsing report rows.

Create:

`data/staging/ne/annual_price_report_inventory.csv`

Required inventory columns:

```text
source_id
report_series
period_start_date
period_end_date
period_label
source_url
source_file_name
report_generated_on
retrieved_on
sha256
page_count
parser_layout
inventory_status
failure_reason
```

Allowed `report_series` values:

- `calendar_year`
- `july_june`

Allowed `inventory_status` values:

- `parsed`
- `download_failed`
- `parse_failed`
- `skipped_out_of_scope`

Inventory every report linked on the page. Mark the two pre-scope reports `skipped_out_of_scope` rather than silently omitting them. The 17 in-scope reports must parse successfully before Nebraska is enabled in the manifest.

Raw downloads belong in:

`data/raw/ne/annual_price_reports/`

Raw PDFs remain git-ignored. Do not commit the downloaded PDFs.

## New Normalized Table

Add the optional manifest file key:

`itemPriceSummaries`

Nebraska file:

`public/data/states/ne/item_price_summaries.csv`

Required columns:

```text
summary_id
source_id
state
agency_id
agency_item_id
agency_item_code
period_start_date
period_end_date
period_label
report_series
description_raw
total_quantity
unit_raw
unit_normalized
published_average_unit_price
total_bid
source_page
source_locator
derivation_method
```

Column rules:

- `summary_id` is stable and deterministic. Build it from state, source period, agency item identity, and unit.
- `source_id` references one PDF source row.
- `state` is `NE`.
- `agency_id` is `ne_ndot`.
- `agency_item_id` references `agency_items.csv`.
- `agency_item_code` preserves the printed item number, including the decimal portion.
- `period_start_date` and `period_end_date` use ISO dates.
- `period_label` uses the NDOT-published range, normalized for display. Examples:
  - `January 2018 - December 2018`
  - `July 2017 - June 2018`
- `report_series` is `calendar_year` or `july_june`.
- `description_raw` preserves the source description after joining source line wraps. Do not silently replace it with the current catalog description.
- `total_quantity` preserves the published numeric value.
- `unit_raw` preserves the printed unit.
- `unit_normalized` uses the existing shared unit-normalization policy where a reviewed equivalent exists.
- `published_average_unit_price` preserves positive, zero, and negative values. Parentheses mean negative.
- `total_bid` preserves positive, zero, and negative values. Parentheses mean negative.
- `source_page` is the one-based PDF page number.
- `source_locator` identifies source filename, page, and parsed row position.
- `derivation_method` is `ndot_published_period_aggregate`.

Do not add `contract_id`, `letting_id`, `bid_id`, `price_type`, or bidder count to this table.

## Optional Explicit Taxonomy Membership Table

The current item picker assumes that taxonomy is encoded by leading item-code digits. NDOT item numbers do not reliably encode the official specification section. Add a generic optional explicit membership table instead of creating a Nebraska-only UI branch.

Add optional manifest file key:

`itemTaxonomyMemberships`

Nebraska file:

`public/data/states/ne/item_taxonomy_memberships.csv`

Required columns:

```text
membership_id
state
agency_id
agency_item_id
taxonomy_id
source_id
match_status
notes
```

Allowed `match_status` values:

- `catalog_exact`
- `reviewed_override`
- `unclassified`

Behavior:

- When a state declares `itemTaxonomyMemberships`, the picker uses explicit membership only.
- Existing states do not declare this file and continue using current prefix behavior without output changes.
- Every searchable Nebraska item receives at least one section membership.
- Items without a supported specification reference go into an explicit `Unclassified / special items` section. Do not guess a section from description similarity.

## Nebraska Sources and Empty Core Tables

Create the Nebraska state partition under:

`public/data/states/ne/`

Required files:

```text
sources.csv
lettings.csv
contracts.csv
contract_projects.csv
contract_items.csv
bids.csv
agency_items.csv
agency_item_versions.csv
item_taxonomy.csv
item_taxonomy_memberships.csv
item_mappings.csv
item_observations.csv
item_price_summaries.csv
```

The first release has no contract evidence. The contract, letting, bid, item mapping, and observation files must exist with valid headers and zero data rows. Do not create placeholder contracts.

`bid_item_prices.csv` may remain undeclared because it is already optional.

Create one `sources.csv` row per annual PDF. Recommended source type:

`annual_price_summary`

Also create source rows for the item catalog and specification taxonomy sources used by the importer.

## Manifest Changes

Add Nebraska to `public/data/manifest.json` with:

```text
code: NE
name: Nebraska
defaultAgencyId: ne_ndot
defaultAgencyName: Nebraska Department of Transportation
divisionLabel: Specification division
sectionLabel: Specification section
```

Add a generic capability indicating that the state has period-level price history. Recommended name:

`periodPriceHistory`

Set Nebraska capabilities:

```text
districtFilter: false
engineerEstimate: false
bidderDetail: false
periodPriceHistory: true
```

Set `periodPriceHistory: false` for Colorado, Iowa, and South Dakota so the manifest is explicit.

Add source label:

```text
annual_price_summary: NDOT average unit price summaries
```

Add optional state labels rather than hard-coding Nebraska text in a generic renderer:

```text
periodPriceHistoryTitle: Annual Unit Price History
periodPriceMeasureLabel: NDOT published average unit price
summaryExclusionNote: NDOT average price data excluded
```

If the implementation uses different property names, use one consistent generic naming scheme and document it in `docs/data_schema.md`.

## Agency Item Catalog

Use this source priority:

1. NDOT public Item Master information if a stable machine-readable catalog can be retrieved.
2. The English Standard Item List linked from the NDOT Item History page.
3. Annual-report rows only for historical identities absent from the catalog.

Do not claim annual-only items are currently active.

Catalog rules:

- Create one stable `agency_item_id` for one NDOT item identity.
- Use the catalog description and unit for the current display version when catalog authority exists.
- Preserve each annual row's description and unit in `item_price_summaries.csv` even when they differ from the current display version.
- Mark catalog items `current`.
- Mark annual-only items absent from catalog authority `historical`.
- If one printed item code has materially incompatible meanings or units across the source period, stop and produce a review report. Do not merge the identities automatically.
- Do not assign unsupported official effective dates.

Create committed staging reports for:

```text
data/staging/ne/item_catalog_rows.csv
data/staging/ne/annual_only_items.csv
data/staging/ne/item_identity_conflicts.csv
```

Nebraska must not be enabled while `item_identity_conflicts.csv` contains unresolved material conflicts.

## Taxonomy Construction

Use the official NDOT specification hierarchy as the taxonomy source.

Expected divisions from the 2017 Standard Specifications include:

- Division 100 - General Requirements and Covenants
- Division 200 - Earthwork
- Division 300 - Subgrade Preparation, Foundation Courses, Base Courses, Shoulder Construction, and Aggregate Surfacing
- Division 400 - Lighting, Signs, and Traffic Control
- Division 500 - Bituminous Pavement
- Division 600 - Portland Cement Concrete Pavements
- Division 700 - Bridges, Culverts, and Related Construction
- Division 800 - Roadside Development and Erosion Control
- Division 900 - Incidental Construction
- Division 1000 - Material Details

Use the item catalog's specification reference to create explicit item-to-section memberships when supported. Normalize a reference such as `205.00` to specification section `205` only when the official taxonomy contains that section.

Create one additional fallback division and section for unclassified and special items. Use visible labels that do not imply an official section.

Do not use description similarity to assign taxonomy.

## Importer

Create:

`scripts/import_nebraska_data.py`

Required modes:

- Cached mode reads existing files under `data/raw/ne/` and performs no network requests.
- Refresh mode downloads the listing page, item catalog sources, specification source if needed, and report PDFs.
- A parsing-only test path accepts committed coordinate fixtures without downloading PDFs.

Recommended command shape:

```text
python scripts/import_nebraska_data.py
python scripts/import_nebraska_data.py --refresh
```

Use `pdfplumber` word coordinates or another layout-aware parser. Do not rely only on plain extracted text order. The older and newer reports expose different text ordering even though the visible six-column table is conceptually consistent.

Parser requirements:

- Detect each report period from the PDF heading and reconcile it to inventory metadata.
- Detect the six logical columns by page coordinates.
- Remove repeated page headings and footers.
- Join wrapped descriptions without joining adjacent rows.
- Preserve item codes such as `0001.00` exactly.
- Parse quantities with commas and decimals.
- Parse currency with dollar signs and commas.
- Parse parentheses as negative values.
- Preserve zero quantities and zero prices.
- Preserve one-based PDF page numbers.
- Reject malformed rows into a committed review file instead of silently dropping them.
- Use deterministic output ordering.
- Produce byte-stable CSV output from identical cached inputs.

Create committed staging output:

```text
data/staging/ne/annual_price_rows.csv
data/staging/ne/annual_price_parse_failures.csv
data/staging/ne/annual_price_reconciliation.csv
```

`annual_price_parse_failures.csv` must contain only a header before Nebraska is enabled.

## PDF Parser Fixtures

Do not make unit tests depend on network access or ignored raw PDFs.

Commit small word-coordinate fixtures representing at least:

1. One 2018 report page.
2. One 2021 or 2022 report page with the newer text ordering.
3. One 2024 report page containing a negative price.
4. One wrapped-description row.
5. One zero-quantity or zero-price row.

Place fixtures under a path such as:

`data/staging/ne/parser_fixtures/`

Store only the minimum page-coordinate data and expected parsed rows needed for deterministic tests.

After the first complete cached parse, freeze expected per-report row counts in a committed acceptance file. Do not invent expected counts before parsing.

## Runtime Type and Loader Changes

Update `src/data/schema.ts` with generic types for:

- Manifest file paths for item price summaries and taxonomy memberships.
- Period price history capability and optional labels.
- `ItemPriceSummaryRecord`.
- `ItemTaxonomyMembershipRecord`.
- AppData collections and indexes.

Recommended AppData indexes:

```text
itemPriceSummariesByAgencyItemId
taxonomyIdsByAgencyItemId
```

Update `src/data/loadData.ts`:

- Load both new tables only when declared.
- Map positive, zero, and negative numeric values without loss.
- Build exact agency-item lookup maps.
- Keep existing state loaders and deferred bidder-price behavior unchanged.
- Do not synthesize `ItemObservationRecord` rows from period summaries.

## Matching and Filtering

Create a separate result builder, for example:

`src/matching/buildItemPriceHistoryResult.ts`

Do not add period rows to `buildEvidenceResult.ts`.

The result builder must:

- Match exact `agencyItemId` first.
- Preserve each report row independently.
- Never deduplicate calendar and July-June periods.
- Default-sort by `period_end_date` descending, then `period_start_date` descending.
- Support sorting by every displayed numeric and text column.
- Support a report-series filter with `All`, `Calendar year`, and `July-June`.
- Support unit filtering without automatically excluding historical units on first load.
- Support period-end-year minimum and maximum filters if period filtering is included.
- Never calculate summary statistics.
- Return a note that overlapping report periods are displayed independently.

Recommended displayed note:

`NDOT reporting periods overlap. Each row is a separate published summary and is not combined with other rows.`

## Item Picker Changes

Update `src/ui/renderExplorer.ts` generically:

- Accept explicit taxonomy membership data.
- If the state declares memberships, filter by membership.
- Otherwise preserve the existing prefix-based behavior exactly.
- Keep exact item-code and description search.
- Keep current and historical item labels.
- Use Nebraska's manifest-provided division and section labels.

Add tests proving Colorado, Iowa, and South Dakota still use their existing prefix behavior.

## Annual Unit Price History UI

Create a focused renderer, for example:

`src/ui/renderItemPriceHistory.ts`

Render it within the existing Explorer results area.

Required table columns:

1. Period
2. Item No.
3. Item Description
4. Total Quantity
5. Unit
6. Average Unit Price
7. Total Bid
8. Source

Display rules:

- Use the manifest title `Annual Unit Price History`.
- Label the price column using the manifest's NDOT measure label where practical.
- Use the source row's description, quantity, unit, price, and total bid.
- Display published values as primary values.
- Show the period label, not a fabricated letting date.
- The Source cell links directly to the official PDF.
- Provide accessible sortable headers.
- Do not render an `Exclude from Summary` checkbox for annual rows.
- Do not render bidder-detail or project-detail controls for annual rows.
- Do not render geography, district, contractor, bid-count, or quantity-comparability controls for annual rows.
- Do not call the annual table `Matching Projects`.

When Nebraska later gains contract evidence, render two independent result sections:

1. Annual Unit Price History.
2. Matching Projects.

Annual rows remain excluded from the second section and its summaries.

## Unit Price Summary Behavior

Keep the existing Unit Price Summary panel visible for Nebraska.

Implementation rules:

- The panel continues to calculate only from `ItemObservationRecord` contract evidence.
- `ItemPriceSummaryRecord` rows are never passed into `buildEvidenceStats`, `buildEvidenceSummaryStats`, inclusion sets, or exclusion sets.
- Show the exact note `NDOT average price data excluded` directly below the Unit Price Summary heading when the selected item has NDOT period rows.
- With no Nebraska contract evidence, the Awarded Bid and Average Bid rows display their normal no-data states.
- Nebraska does not render the Engineer Estimate summary row because the capability is false.
- If contract evidence is added later, summary values use only those contract observations and the exclusion note remains visible while NDOT period rows exist.

Do not change summary calculations for Colorado, Iowa, or South Dakota.

## Inflation Adjustment

Inflation adjustment may change displayed annual average unit prices, but it must not create summary statistics.

Use the existing shared FHWA NHCCI table.

Period adjustment rules:

1. Identify every NHCCI quarter whose period belongs to the NDOT report window.
2. Require complete coverage of all four report quarters.
3. Use the arithmetic mean of the four quarterly index values as the report-period source index.
4. Use the existing latest loaded NHCCI quarter as the target index.
5. Adjust the annual average unit price with:

   `published price * target index / report-period average index`

6. Show the published value first and adjusted value second using the existing adjusted-price visual pattern.
7. Do not replace or adjust the source-published Total Bid column.
8. Do not include adjusted annual prices in the Unit Price Summary.
9. If any report quarter is missing, show only the published value and report that adjustment is unavailable for that period. Do not average partial quarter coverage.
10. Preserve positive, zero, and negative signs.

Update inflation copy so Nebraska does not claim awarded, average-bid, or engineer-estimate observations were adjusted when only NDOT period rows are present.

CSV export remains source-published nominal data, consistent with the existing contract export policy.

## Project Workspace Behavior

No Project workspace schema migration is required.

Keep the existing Explorer-backed Add Item to Project form available after an NDOT item is selected:

- The user enters Unit Cost manually.
- The user enters Quantity manually.
- The user may enter Group and Notes using existing behavior.
- No annual table cell is a quick-fill button.
- Unit Price Summary no-data cells are not quick-fill buttons.
- `costSource` remains `manual`.
- `includedObservationIds` remains empty when no contract evidence is included.
- Do not store annual summary IDs in Project evidence context in this release.

The separate Project-tab `+Add Item` custom-line workflow remains unchanged.

## Source Review Behavior

The current Source Review view is project-oriented.

For the first Nebraska release:

- Link annual table rows directly to the official PDFs.
- Do not fabricate Source Review projects for annual PDFs.
- Hide or omit the Source Review launcher when the selected state has no reviewable contract/project sources.
- If Nebraska contract evidence is added later, Source Review becomes available for those project sources only.

## CSV Export

Create a separate annual-history exporter, for example:

`src/ui/exportItemPriceHistoryCsv.ts`

Required columns:

```text
State
Agency
Report Series
Period Start
Period End
Period Label
Item No.
Agency Item ID
Item Description
Total Quantity
Unit
Published Average Unit Price
Total Bid
Source Label
Source URL
Source File
Source Page
Source Locator
```

Export rules:

- Export currently filtered and sorted annual rows.
- Export nominal source-published values only.
- Do not export a derived pooled value.
- Do not label the file `matching-projects`.
- Use a stable filename containing Nebraska, the item code, and `price-history`.

Keep the existing Matching Projects CSV export unchanged.

## Validator Changes

Update `scripts/validate_data_package.py` generically.

Add both optional files to the file-key, required-column, identifier, and optional-table definitions.

Validate period summary rows:

- Unique `summary_id`.
- Valid source and agency-item relationships.
- Matching state and agency across related rows.
- Valid ISO start and end dates.
- Start date is not after end date.
- Supported report series.
- Valid positive, zero, or negative numeric values.
- Nonblank source page and source locator.
- `derivation_method` equals the approved value.
- No `contract_id` dependency.
- No duplicate source, agency item, unit, and period row unless the source genuinely prints duplicates and the importer preserves distinct source locators.

Price reconciliation:

- When total quantity is nonzero, compare `total_bid / total_quantity` to the published average.
- Allow source rounding to cents. Do not require `total_quantity * rounded average` to equal Total Bid exactly.
- Use a tolerance that recognizes half-cent unit-price rounding plus a small decimal parsing tolerance.
- When total quantity is zero, preserve the row and skip ratio reconciliation.

Validate taxonomy memberships:

- Unique membership IDs.
- Existing agency item, taxonomy, and source relationships.
- State and agency consistency.
- Target taxonomy row has level `section`.
- Supported match status.
- Every searchable Nebraska item has a membership.

Add Nebraska acceptance validation:

- Exactly 17 in-scope annual sources for the initial release.
- Both report series are present.
- Earliest included rolling period is July 2017 through June 2018.
- Earliest included calendar period is January through December 2018.
- Latest included rolling period is July 2025 through June 2026.
- Latest included calendar period is January through December 2025.
- No parse failures.
- No unresolved material item identity conflicts.
- At least one preserved negative price row.
- No Nebraska period summary appears in `item_observations.csv`.

Do not alter South Dakota annual-report acceptance behavior.

## Automated Tests

Add Python tests, recommended file:

`scripts/test_import_nebraska_data.py`

Required Python test coverage:

- Source-page report inventory classification.
- Scope includes 17 reports and identifies two skipped pre-scope reports.
- Calendar and July-June date parsing.
- Older PDF coordinate layout parsing.
- Newer PDF coordinate layout parsing.
- Wrapped description assembly.
- Leading-zero item code preservation.
- Decimal and comma quantity parsing.
- Negative currency parsing from parentheses.
- Zero quantity and price preservation.
- Stable summary IDs.
- Source page and locator preservation.
- Ratio reconciliation using rounded published averages.
- Catalog current versus annual-only historical identity behavior.
- Explicit taxonomy membership and unclassified fallback.
- Cached runs produce byte-identical normalized CSVs.

Add TypeScript tests for:

- Optional CSV loading.
- Exact agency-item period matching.
- Independent preservation of overlapping reports.
- Default period sort.
- Report-series and unit filtering.
- Explicit taxonomy picker behavior.
- Existing prefix picker behavior for current states.
- Annual table rendering and exact Unit Price Summary note.
- Absence of annual summary checkboxes and quick-fill controls.
- Annual CSV columns, ordering, filtering, and nominal values.
- Four-quarter inflation adjustment.
- Missing-quarter inflation behavior.
- Existing contract summary calculations remain unchanged.

## Documentation Updates Required During Implementation

Update these files when implementation is complete:

- `architecture_overview.md`
- `docs/data_schema.md`
- `docs/multistate_data_architecture.md`
- `docs/implementation_notes.md`
- `user_workflow.md`
- `project_roadmap.md` if it tracks enabled states or completed work

Required architecture changes to document:

- Nebraska is enabled.
- Period aggregate evidence is a supported non-contract runtime grain.
- Annual aggregates remain excluded from contract summary statistics.
- Both overlapping NDOT report series are retained independently.
- Future Nebraska project evidence continues to use the contract schema.
- Explicit taxonomy memberships are optional and preserve prefix behavior for current states.

Replace or qualify the current general rule that annual aggregates are only reconciliation evidence. The new rule must distinguish:

- Nebraska's source-native, explicitly labeled runtime period history.
- Contract observations used for project statistics.
- South Dakota's annual QA report, which remains staging-only.

## Expected File Change Areas

The implementation model should expect changes in these areas. Confirm actual code before editing.

```text
public/data/manifest.json
public/data/states/ne/*.csv
data/staging/ne/**
scripts/import_nebraska_data.py
scripts/test_import_nebraska_data.py
scripts/validate_data_package.py
src/data/schema.ts
src/data/loadData.ts
src/matching/buildItemPriceHistoryResult.ts
src/matching/inflationAdjustment.ts
src/ui/renderExplorer.ts
src/ui/renderResults.ts
src/ui/renderItemPriceHistory.ts
src/ui/exportItemPriceHistoryCsv.ts
src/ui/*.test.ts
src/styles.css
architecture_overview.md
docs/data_schema.md
docs/multistate_data_architecture.md
docs/implementation_notes.md
user_workflow.md
project_roadmap.md
```

Do not edit every listed file mechanically. Inspect current code and change only files required by the final design.

## Phased Implementation Sequence

### Phase 1 - Source and Catalog Audit

1. Inventory all linked NDOT reports.
2. Confirm the 17-report scope.
3. Download raw files to ignored storage.
4. Record hashes and page counts.
5. Determine whether the NDOT Item Master provides a stable current catalog export.
6. Inspect exact item-code, description, and unit conflicts across all reports.
7. Inspect catalog specification references against the 2017 taxonomy.
8. Produce staging audit files.

Stop condition:

- Stop and report if any in-scope PDF is unavailable, image-only, password-protected, or cannot be parsed with reviewable accuracy.
- Stop and report material item-code identity conflicts before normalizing agency identities.

Do not modify runtime UI in this phase.

### Phase 2 - Generic Schema and Validator

1. Add the optional period-summary and taxonomy-membership contracts.
2. Update manifest types and loader mappings.
3. Update generic validation.
4. Add unit tests for mappings and validation.
5. Confirm existing state packages still validate before adding Nebraska runtime data.

Checkpoint:

- Existing Colorado, Iowa, and South Dakota validation and TypeScript tests pass unchanged in behavior.

### Phase 3 - Nebraska Importer and Data Package

1. Implement fixture-based PDF row parsing.
2. Implement full cached PDF parsing.
3. Create sources, catalog, versions, taxonomy, memberships, and period summaries.
4. Create empty header-only contract tables.
5. Generate reconciliation and conflict reports.
6. Freeze per-report row-count acceptance data.
7. Validate deterministic reruns.

Checkpoint:

- Nebraska data validates before it is added as an enabled manifest state.

### Phase 4 - Item Search and Annual History UI

1. Add explicit taxonomy membership support to the picker.
2. Add the independent price-history result builder.
3. Add the annual history table, filters, sorting, source links, and export.
4. Keep aggregate rows out of Matching Projects and Source Review.
5. Add the exact Unit Price Summary exclusion note.
6. Confirm manual Add Item to Project remains available without quick-fill values.

Checkpoint:

- Nebraska item selection shows all applicable overlapping report rows and no fabricated projects.

### Phase 5 - Inflation Adjustment

1. Add complete four-quarter report-period index calculation.
2. Apply adjustment only to displayed annual average unit prices.
3. Add missing-quarter behavior and copy.
4. Confirm totals, exports, and Unit Price Summary remain nominal or excluded as specified.

### Phase 6 - Regression, Visual QA, and Documentation

1. Run the full targeted verification list.
2. Build to `dist-check` using the canonical command and escalation.
3. Serve the static build on `http://127.0.0.1:4174/` for visual review.
4. Review Nebraska desktop and narrow-width layouts.
5. Review Colorado, Iowa, and South Dakota item search and results for regressions.
6. Update all required documentation.
7. Inspect final Git diff and status.

## Verification Commands

Use the repository's canonical executables and commands from `codex.md`.

Minimum verification:

```text
python scripts/test_import_nebraska_data.py
python scripts/validate_data_package.py
C:\Users\Casey.Walrath\Tools\node\node.exe ./node_modules/typescript/bin/tsc
C:\Users\Casey.Walrath\Tools\node\node.exe ./node_modules/vite/bin/vite.js build --outDir dist-check --configLoader native
```

Run the Vite production build with escalation because sandboxed `spawn EPERM` is expected.

Also run the project's configured TypeScript test command after inspecting `package.json`. Use the portable Node executable directly. Do not assume `npm` or `node` is on PATH.

## Visual QA Checklist

Verify:

- Nebraska appears in the first-use state selector and top state selector.
- Nebraska switching clears incompatible state-specific filters.
- Division, section, code, and description item search works.
- Annual history clearly differs from Matching Projects.
- Period labels distinguish calendar and July-June rows.
- Overlapping rows remain visible independently.
- Large quantities and currency values align and remain readable.
- Negative values display with an unambiguous minus or accounting style.
- Source links are visible and open the correct official PDF.
- The exact exclusion note appears directly below Unit Price Summary.
- No annual row has an Exclude from Summary checkbox.
- No annual value renders as a quick-fill button.
- The manual Add Item to Project form accepts Unit Cost and Quantity.
- Inflation adjustment displays only when complete source-period indexes exist.
- Missing inflation coverage does not hide the published value.
- The annual table works at narrow viewport widths with the existing horizontal-scroll affordance.
- Existing states retain their current columns, filters, summaries, exports, and Source Review behavior.

## Final Acceptance Criteria

The implementation is complete only when all statements below are true:

1. Nebraska is an enabled state with 17 in-scope NDOT reports.
2. Both overlapping report series are preserved and labeled.
3. Every parsed annual row has source and page provenance.
4. The runtime has no synthetic Nebraska contracts or observations.
5. Annual rows appear in Annual Unit Price History for exact NDOT items.
6. Annual rows never affect Unit Price Summary values.
7. The exact note `NDOT average price data excluded` appears as approved.
8. No annual quick-fill price is offered.
9. Manual Explorer-backed Project entry remains available.
10. No multi-period aggregate price is calculated.
11. Inflation adjustment follows complete four-quarter rules and does not adjust Total Bid.
12. Annual CSV export contains source-published nominal values and provenance.
13. Explicit Nebraska taxonomy works without changing existing prefix behavior.
14. Data validation, importer tests, TypeScript tests, typecheck, and production build pass.
15. Documentation accurately describes the new evidence grain and the South Dakota distinction.

## Handoff Reporting Requirements

The implementation model must report at each checkpoint:

- Files changed.
- Data row counts by report and normalized table.
- Any source or parser anomalies.
- Any unresolved identity or taxonomy decisions.
- Tests run and exact outcomes.
- Whether architecture documentation was updated.

Do not claim completion if a source, identity conflict, validator error, regression, or required visual behavior remains unresolved.
