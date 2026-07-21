# Data Schema v2

## Package Layout

`public/data/manifest.json` is the only runtime entry point. It declares schema version 2, product title, shared files, supported states, default agencies, labels, capabilities, and each state's file paths.

```text
public/data/
  manifest.json
  common/inflation_index.csv
  states/co/*.csv
  states/ia/*.csv
```

State-native review records live under `data/staging/{state}/`. Raw source documents and downloads live under ignored `data/raw/{state}/`.

All IDs are stable strings. Foreign-key fields use IDs, not display codes or names. Empty nullable fields are allowed only where the source does not provide the concept.

## Normalized Tables

### `sources.csv`

One publication/source identity.

`source_id`, `source_type`, `agency_id`, `agency_name`, `state`, `source_label`, `source_date`, `data_year`, `source_url`, `source_file_name`, `sha256`, `parser_name`, `parser_version`, `notes`

Colorado uses `cost_book`, `bid_tab`, and `estimate`. `estimate` identifies FHU engineer estimates that contain no bidder records and publish only `engineer_estimate` observations.

### `lettings.csv`

One agency letting/event.

`letting_id`, `source_id`, `state`, `agency_id`, `letting_date`, `letting_label`

### `contracts.csv`

One official contract. Contract evidence is never repeated for each associated project number.

`contract_id`, `letting_id`, `source_id`, `state`, `agency_id`, `official_contract_id`, `call_order`, `letting_status`, `awarded_vendor`, `awarded_amount`, `primary_county`, `route`, `work_type`, `contract_period`, `dbe_goal`, `bid_count`, `location`, `district`, `terrain`, `award_index`

### `contract_projects.csv`

One project number associated with a contract.

`contract_project_id`, `contract_id`, `project_number`, `project_name`, `work_type`, `county_region`, `route`, `location`, `project_award_amount`

### `contract_items.csv`

One source schedule line within a contract. Repeated bid-tab pages deduplicate on contract, section, line number, and source item code.

`contract_item_id`, `contract_id`, `source_id`, `section_number`, `section_title`, `line_number`, `source_item_code`, `agency_item_id`, `description_raw`, `quantity`, `unit_raw`, `unit_normalized`, `alternate_set`, `alternate_member`, `mapping_status`, `source_page`, `source_locator`

`agency_item_id` can be blank only for source-native items that have not been reviewed/mapped. Those rows cannot be promoted to exact item evidence.

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

`item_status` is `current` or `historical`. Raw item codes are scoped by agency and are not globally unique.

### `agency_item_versions.csv`

Effective-dated description/unit/specification record.

`agency_item_version_id`, `agency_item_id`, `effective_from`, `effective_to`, `official_description`, `official_abbreviated_description`, `official_unit`, `spec_reference_code`, `source_id`, `is_current`

Iowa's native PDF `SPEC` value is stored in `spec_reference_code`.

### `item_taxonomy.csv`

State-native item hierarchy.

`taxonomy_id`, `state`, `agency_id`, `taxonomy_level`, `taxonomy_code`, `parent_taxonomy_id`, `taxonomy_label`, `match_prefix`, `source_year`, `source_url`

Current levels are `division` and `section`. Colorado uses three-digit match prefixes; Iowa uses four digits.

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

Iowa `average_bid` is the unweighted mean of valid bidder unit prices for the contract item. Iowa leaves `engineer_estimate` absent.

Colorado master-workbook bid sources also use an unweighted mean of valid bidder unit prices. Engineer quantities may differ from the contract-item bid quantity and remain source-native on the engineer observation. Confirmed-award observations are created only when a public award record reconciles to the configured included schedule. Source Review compatibility price fields are nullable; missing engineer, average, or bidder prices render as `Not listed`, never zero.

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

`AppData` exposes arrays and maps for sources, lettings, contracts, project numbers, agency items/versions, taxonomy, observations, bids, contract items, and bidder prices. `ensureBidItemPricesLoaded()` performs the lazy bidder-price fetch.

`SearchQuery` includes `state`, `agencyId`, and `agencyItemId`. Evidence joins use `contractId` and `agencyItemId`. Compatibility aliases in `src/data/schema.ts` are temporary adapters for rendering modules migrated from schema v1; new logic must use normalized IDs.

## Project Browser Storage v4

IndexedDB database: `roadway-cost-estimator`.

- `projects`: one Project aggregate per `projectId`, indexed by state, status, and updated time.
- `settings`: active Project ID per state, migration status, and one-time legacy-placeholder cleanup version.
- `revisions`: bounded restorable snapshots keyed by Project and revision.
- `migrationBackups`: exact legacy storage values and migration reports.
- Project: `projectId`, `state`, metadata, `status`, `archivedAt`, `revision`, backup metadata, timestamps, and line items.
- Line item: `lineItemId`, `state`, `agencyId`, `agencyItemId`, code, description, unit, quantity, preferred cost, notes, evidence context, and timestamps.
- v1/v2 records migrate to state `CO` and agency `co_cdot`; v3 state identities are retained. Legacy keys are not deleted during migration. Migration reports identify blank zero-line automatic placeholders removed from the usable Project list and reconcile those removals separately from invalid Projects.
- `.rce-project.json` file format v1 stores one complete schema-v4 Project for round-trip recovery.
- Permanently deleting an archived Project removes its aggregate and associated revision snapshots in one IndexedDB transaction.

## Validation Rules

Run:

```text
python scripts/validate_data_package.py
```

The validator checks manifest paths, required columns/values, unique IDs, all relationships, numeric fields, quantity-price reconciliation, bidder rank integrity, apparent-low/award flags, reviewed awarded-vendor resolution, source provenance, accepted item statuses, and promoted observation identity.

Iowa archive acceptance additionally requires 3,727 catalog items, at least 43 parsed lettings, at least the original pilot row counts, rank 7 or higher, at least one multi-project contract, and alternate set `AA`. Iowa bidder item totals must reconcile to reported bid totals within two cents unless the excess is explained by preserved unselected added-option rows. Reported one- and two-cent source differences and documented added-option differences are warnings.
