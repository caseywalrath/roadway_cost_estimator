# Data Schema v2

## Package Layout

`public/data/manifest.json` is the only runtime entry point. It declares schema version 2, product title, shared files, supported states, default agencies, labels, capabilities, and each state's file paths.

```text
public/data/
  manifest.json
  common/inflation_index.csv
  states/co/*.csv
  states/ia/*.csv
  states/sd/*.csv
  states/ne/*.csv (when Nebraska is enabled)
```

State-native review records live under `data/staging/{state}/`. Raw source documents and downloads live under ignored `data/raw/{state}/`.

All IDs are stable strings. Foreign-key fields use IDs, not display codes or names. Empty nullable fields are allowed only where the source does not provide the concept.

## Normalized Tables

### `sources.csv`

One publication/source identity.

`source_id`, `source_type`, `agency_id`, `agency_name`, `state`, `source_label`, `source_date`, `data_year`, `source_url`, `source_file_name`, `sha256`, `parser_name`, `parser_version`, `notes`

Colorado uses `cost_book`, `bid_tab`, and `estimate`. `estimate` identifies FHU engineer estimates that contain no bidder records and publish only `engineer_estimate` observations.

### `source_documents.csv` (optional)

One physical document within a source bundle.

`source_document_id`, `source_id`, `document_role`, `source_url`, `source_file_name`, `sha256`, `media_type`, `published_on`, `retrieved_on`, `notes`

South Dakota uses one letting-level source with `bid_abstract` and `final_award_report` children. States whose sources are already one file per source may omit this table.

### `lettings.csv`

One agency letting/event.

`letting_id`, `source_id`, `state`, `agency_id`, `letting_date`, `letting_label`

### `contracts.csv`

One official contract. Contract evidence is never repeated for each associated project number.

`contract_id`, `letting_id`, `source_id`, `state`, `agency_id`, `official_contract_id`, `call_order`, `letting_status`, `awarded_vendor`, `awarded_amount`, `primary_county`, `route`, `work_type`, `contract_period`, `dbe_goal`, `bid_count`, `location`, `district`, `terrain`, `award_index`

### `contract_projects.csv`

One project number associated with a contract.

`contract_project_id`, `contract_id`, `project_number`, `project_control_number`, `project_name`, `work_type`, `county_region`, `route`, `location`, `project_award_amount`

`project_control_number` is optional. South Dakota retains both the printed Project No. and PCN rather than overloading one identifier field.

### `contract_items.csv`

One source schedule line within a contract. Repeated bid-tab pages deduplicate on contract, section, line number, and source item code.

`contract_item_id`, `contract_id`, `source_id`, `section_number`, `section_title`, `line_number`, `source_item_code`, `agency_item_id`, `description_raw`, `quantity`, `unit_raw`, `unit_normalized`, `alternate_set`, `alternate_member`, `mapping_status`, `source_page`, `source_locator`

`agency_item_id` can be blank only for source-native items that have not been reviewed/mapped. Those rows cannot be promoted to exact item evidence.

Colorado CDOT Cost Data Book rows are materialized here from committed staging extracts. Each staging row remains a separate contract item, including rows whose code, description, quantity, and unit are otherwise identical. `source_page` retains the Cost Data Book PDF page and `source_locator` combines the source filename, page, and staging-row number.

### `bids.csv`

One bidder for one contract.

`bid_id`, `contract_id`, `source_id`, `source_vendor_id`, `bidder_name`, `bid_rank`, `bid_total`, `percent_of_low`, `is_apparent_low`, `is_awarded`, `source_page`

Rank 1 means apparent low. It does not imply award. `is_awarded` is true only after exact single-bidder resolution against the explicit awarded-vendor field.

### `bid_item_prices.csv`

One bidder-specific price for one contract item.

`bid_item_price_id`, `contract_item_id`, `bid_id`, `contract_id`, `source_id`, `unit_price`, `extended_price`, `source_page`, `source_locator`

Blank/unselected alternate prices have no price row; the contract item remains present.

### `agency_items.csv`

Stable agency item identity.

`agency_item_id`, `state`, `agency_id`, `agency_name`, `item_code`, `current_version_id`, `item_status`, `canonical_item_id`

`item_status` is `current` or `historical`. Raw item codes are scoped by agency and are not globally unique. For Nebraska, `historical` is a retained source-provenance marker: the identity is absent from the older linked Standard Item List but present in one or more NDOT average unit-price reports. It is not evidence that an item is inactive, obsolete, or unsuitable for an estimate. Nebraska's manifest sets `showHistoricalItemStatus` to `false`; the status remains available to importers and validators but is not rendered to users.

### `agency_item_versions.csv`

Effective-dated description/unit/specification record.

`agency_item_version_id`, `agency_item_id`, `effective_from`, `effective_to`, `official_description`, `official_abbreviated_description`, `official_unit`, `spec_reference_code`, `source_id`, `is_current`

Iowa's native PDF `SPEC` value is stored in `spec_reference_code`.

### `item_taxonomy.csv`

State-native item hierarchy.

`taxonomy_id`, `state`, `agency_id`, `taxonomy_level`, `taxonomy_code`, `parent_taxonomy_id`, `taxonomy_label`, `match_prefix`, `source_year`, `source_url`

Current levels are `division` and `section`. Colorado and South Dakota use three-digit match prefixes; Iowa uses four digits.

### `item_taxonomy_memberships.csv` (optional)

Explicit item-to-section memberships for states whose agency item codes do not encode the official specification hierarchy.

`membership_id`, `state`, `agency_id`, `agency_item_id`, `taxonomy_id`, `source_id`, `match_status`, `notes`

Allowed `match_status` values are `catalog_exact`, `reviewed_override`, and `unclassified`. When a state declares this file, the item picker must use these memberships rather than deriving sections from item-code prefixes. Every searchable current item must have at least one membership; unclassified items use an explicit fallback section.

### `item_mappings.csv`

Explicit reviewed mapping from a municipal/source agency item to a state item.

`mapping_id`, `state`, `source_agency_id`, `source_item_code`, `target_agency_item_id`, `match_status`, `confidence`, `reviewed_by`, `reviewed_on`, `notes`

Description similarity can create review candidates outside this table but cannot write a promoted mapping automatically.

### `item_observations.csv`

Materialized app evidence. Every row must reference a contract, source, and agency item.

`observation_id`, `contract_id`, `source_id`, `agency_item_id`, `agency_item_code`, `description_raw`, `description_normalized`, `unit_raw`, `unit_normalized`, `quantity`, `unit_price`, `extended_price`, `discipline`, `price_type`, `date_basis`, `derivation_method`, `derivation_input_count`

Allowed generalized `price_type` values:

- `awarded_bid`
- `average_bid`
- `engineer_estimate`

Iowa and South Dakota `average_bid` values are the unweighted mean of valid bidder unit prices for the contract item. Both states leave `engineer_estimate` absent. South Dakota's annual three-lowest-bids statistic is a staging reconciliation field, not runtime evidence.

Colorado master-workbook bid sources also use an unweighted mean of valid bidder unit prices. Engineer quantities may differ from the contract-item bid quantity and remain source-native on the engineer observation. Confirmed-award observations are created only when a public award record reconciles to the configured included schedule. Source Review compatibility price fields are nullable; missing engineer, average, or bidder prices render as `Not listed`, never zero.

Colorado Cost Data Book items retain one awarded, one average, and one engineer observation per source row. The associated contract supplies awarded contractor, awarded total, and bid count. No `bids` or `bid_item_prices` rows are inferred because the Cost Data Book does not publish individual bidder item prices.

### `item_price_summaries.csv` (optional)

Period-level agency-published price summaries that are not contract evidence. These rows are independent of contracts, lettings, bids, bidder counts, and `item_observations`.

`summary_id`, `source_id`, `state`, `agency_id`, `agency_item_id`, `agency_item_code`, `period_start_date`, `period_end_date`, `period_label`, `report_series`, `description_raw`, `total_quantity`, `unit_raw`, `unit_normalized`, `published_average_unit_price`, `total_bid`, `source_page`, `source_locator`, `derivation_method`

Supported `report_series` values are `calendar_year` and `july_june`. `derivation_method` identifies the agency-published aggregate calculation; the application must preserve positive, zero, and negative values without converting them into contract observations. Optional state capabilities and labels identify states that expose period price history.

For NDOT annual-price sources, `total_bid` and `published_average_unit_price` are retained independently. The importer records a quantity-times-average reconciliation in staging, but the validator does not reject a source row when those published aggregates differ because NDOT's aggregation method and rounding basis are not documented.

## Colorado Master-Workbook Inclusion Policy

The committed configuration at `data/staging/co/cost_estimate_master_sources.json` is the reviewable inclusion authority for the attached master workbook. It records source identity, evidence date, owner, project identifier, explicit row ranges, selected price columns, bidder blocks, and published total cells.

- Estimate-only sheets publish the configured final estimate column only.
- JC-73 includes the base schedule, publishes the County Engineer's Estimate, retains the FHU Estimate only in staging audit columns, and confirms FNF Construction as awarded.
- Pikes Peak Sidewalks includes Schedule I only.
- West Mainstreet includes Schedule A only.
- Lincoln-Jordan includes Schedule A and its force accounts only.
- Published included-schedule totals rank bids. Calculated line extensions remain internally consistent, and differences from source totals are retained in per-source reconciliation CSVs.
- Full CDOT codes and uniquely resolved three-digit prefixes can be promoted. Malformed or ambiguous codes remain unmatched with candidates; description similarity is never promoted by itself.

### `common/inflation_index.csv`

Shared FHWA NHCCI quarters.

`index_id`, `index_name`, `period_year`, `period_quarter`, `period_label`, `period_start_date`, `period_end_date`, `index_value`, `source_url`, `notes`

Inflation adjustment affects optional display/summary calculations. Original source prices remain primary and exported.

## Runtime Interfaces

`AppData` exposes arrays and maps for sources, optional source documents, lettings, contracts, project numbers/PCNs, agency items/versions, taxonomy, optional explicit taxonomy memberships, observations, optional period price summaries, bids, contract items, and bidder prices. `ensureBidItemPricesLoaded()` performs the lazy bidder-price fetch.

`SearchQuery` includes `state`, `agencyId`, and `agencyItemId`. Evidence joins use `contractId` and `agencyItemId`. Compatibility aliases in `src/data/schema.ts` are temporary adapters for rendering modules migrated from schema v1; new logic must use normalized IDs.

## Project Browser Storage v7

IndexedDB database: `roadway-cost-estimator`.

- `projects`: one Project aggregate per `projectId`, indexed by state, status, and updated time.
- `settings`: active Project ID per state, migration status, and one-time legacy-placeholder cleanup version.
- `revisions`: bounded restorable snapshots keyed by Project and revision.
- `migrationBackups`: exact legacy storage values and migration reports.
- Project: `projectId`, `state`, metadata, `status`, `archivedAt`, `revision`, backup metadata, `contingencyPercent`, timestamps, and line items.
- Line item: `lineItemId`, `lineItemType`, `state`, `agencyId`, `agencyItemId`, optional Project-specific group, code, description, unit, nullable quantity, nullable preferred cost, notes, optional evidence context, and timestamps.
- `lineItemType=explorer` represents an item selected from Explorer and requires agency identity, positive quantity/cost, and evidence context. `lineItemType=catalog` represents an exact-code Item Search catalog match; it requires agency identity plus official code/description/unit, has no evidence context, and permits blank quantity/cost while the row is being completed. `lineItemType=custom` represents a manually entered line; agency identity and evidence context are blank/null, and quantity/cost may remain blank.
- Blank custom quantity or preferred cost contributes zero to Total Item Cost and Total Project Cost. Custom lines are included in Project CSV exports with blank agency/evidence fields.
- Project Construction bid items are the sum of Explorer-backed and catalog-linked line totals. Other Costs are the sum of custom line totals. A non-negative Project-level `contingencyPercent` applies to the combined Construction and Other Costs base; Total Project Cost adds the calculated contingency amount. This percentage and the derived summary amounts do not alter line totals or create group subtotals.
- Project CSV exports append a separate two-column Project Cost Summary section after the line-item rows. Project JSON backups persist `contingencyPercent` and include derived `constructionCost`, `otherCost`, `contingencyCost`, and `totalProjectCost` summary values; import recalculates these values from the Project.
- Group is a trimmed, optional Project-specific label used for Project-table sorting and current-Project datalist suggestions only; it does not affect totals or create subtotals.
- v4-v7 Project records and v1-v3 browser records normalize existing Projects with a zero contingency percentage where absent and existing lines as Explorer-backed or custom lines with a blank Group where absent. Legacy browser keys remain preserved during migration.
- v1/v2 records migrate to state `CO` and agency `co_cdot`; v3 state identities are retained. Legacy keys are not deleted during migration. Migration reports identify blank zero-line automatic placeholders removed from the usable Project list and reconcile those removals separately from invalid Projects.
- `.rce-project.json` file format v1 stores one complete schema-v7 Project for round-trip recovery; v4-v6 backups are accepted and normalized during import.
- Permanently deleting an archived Project removes its aggregate and associated revision snapshots in one IndexedDB transaction.

## Validation Rules

Run:

```text
python scripts/validate_data_package.py
```

The validator checks manifest paths, required columns/values, unique IDs, all relationships, numeric fields, quantity-price reconciliation, bidder rank integrity, apparent-low/award flags, reviewed awarded-vendor resolution, source provenance, accepted item statuses, and promoted observation identity.

Iowa archive acceptance additionally requires 3,727 catalog items, at least 43 parsed lettings, at least the original pilot row counts, rank 7 or higher, at least one multi-project contract, and alternate set `AA`. Iowa bidder item totals must reconcile to reported bid totals within two cents unless the excess is explained by preserved unselected added-option rows. Reported one- and two-cent source differences and documented added-option differences are warnings.

South Dakota acceptance inventories every central completed letting from 2019 forward, requires an explicit reason for every non-parsed entry, reconciles the live catalog against native staging, validates confirmed award separately from apparent low, and checks that awarded and all-bid-average observations reproduce bidder price rows. The 2024 annual report remains staging-only and must contain 1,431 parsed QA rows plus a one-to-one reconciliation row that explicitly records catalog, unit, quantity, cost, and average-price differences.
