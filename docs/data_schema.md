# Data Schema

## Purpose

The prototype uses static CSV files so non-developers can inspect records and Git can track every data change.

All current records are synthetic demo records. They are not estimating guidance.

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
- `official_unit`
- `canonical_item_id`

Rows with a blank `canonical_item_id` can appear when the row is present only to support item-code lookup and has not been mapped to a comparable item family yet. Exact-code pricing still requires matching rows in `item_observations.csv`.

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

The current sample is generated from the public CDOT 2025 Item Code Book Excel file with `scripts/generate_cdot_item_sample.py`. The generator preserves existing mapped demo rows and adds official item-code rows across loaded CDOT Standard Specification sections.

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

## Data Rules

- Use stable IDs.
- Preserve raw descriptions.
- Normalize descriptions separately.
- Preserve raw units and normalized units.
- Do not compare unit prices across incompatible units.
- Every observation must point to a source and project.
- Every loaded agency item should have a matching section prefix in `spec_sections.csv` when the picker needs to expose that item.
- Demo data must stay clearly labeled.
- Private FHU data must not be committed to a public repository.

