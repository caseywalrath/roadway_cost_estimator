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

### `common/inflation_index.csv`

Shared FHWA NHCCI quarters.

`index_id`, `index_name`, `period_year`, `period_quarter`, `period_label`, `period_start_date`, `period_end_date`, `index_value`, `source_url`, `notes`

Inflation adjustment affects optional display/summary calculations. Original source prices remain primary and exported.

## Runtime Interfaces

`AppData` exposes arrays and maps for sources, lettings, contracts, project numbers, agency items/versions, taxonomy, observations, bids, contract items, and bidder prices. `ensureBidItemPricesLoaded()` performs the lazy bidder-price fetch.

`SearchQuery` includes `state`, `agencyId`, and `agencyItemId`. Evidence joins use `contractId` and `agencyItemId`. Compatibility aliases in `src/data/schema.ts` are temporary adapters for rendering modules migrated from schema v1; new logic must use normalized IDs.

## Project Local Storage v3

Storage key: `roadway-cost-estimator:projects:v3`.

- Project: `projectId`, `state`, metadata, timestamps, line items.
- Line item: `lineItemId`, `state`, `agencyId`, `agencyItemId`, code, description, unit, quantity, preferred cost, notes, evidence context, timestamps.
- v1/v2 records migrate to state `CO` and agency `co_cdot`.

## Validation Rules

Run:

```text
python scripts/validate_data_package.py
```

The validator checks manifest paths, required columns/values, unique IDs, all relationships, numeric fields, quantity-price reconciliation, bidder rank integrity, apparent-low/award flags, exact awarded-vendor resolution, source provenance, accepted item statuses, and promoted observation identity.

Iowa pilot acceptance additionally requires 3,727 catalog items, 25 contracts, 26 project records, 90 bids, 576 contract items, rank 7, one multi-project contract, and alternate set `AA`. Iowa bidder item totals must reconcile to reported bid totals within two cents. Reported contract award totals remain distinct; documented one- and two-cent differences are warnings.
