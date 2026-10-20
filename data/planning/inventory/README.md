# CDOT Candidate Pay-Item Inventory

One CSV per planning element. Source: `public/data/states/co/` (read-only).

## Filters
- `item_observations.csv`: `price_type` = `awarded_bid`; `source_id` starts with `cdot_cost_data_book`.
- Window: `date_basis` >= 2023-03-26 (no upper bound; latest awarded row is 2026-03-26).
- Items: `agency_items.csv` `item_code` prefix plus `agency_item_versions.csv` `official_description` regex, per element (case-insensitive). Any matching rule adds the item.
- Description: `is_current` version (or the only version for 65 historical items). Zero-contract items are excluded, except bus_stop `co_cdot_608-00008` (named in the brief; statistics blank).

## Method
- `contracts_in_window`: distinct `contract_id` with at least one qualifying row.
- `urban_contracts_in_window`: those contracts with `contracts.csv` `terrain` = `U`. Three contracts with blank terrain count as non-urban.
- Per contract: median of `unit_price` across that contract's qualifying rows for the item.
- `median_unit_price`, `p25`, `p75`: median, 25th and 75th percentile across contract medians (`statistics.quantiles`, method `inclusive`; a single contract returns its own value).
- Raw dollars, no inflation adjustment. Rounded to 2 decimals.
- `total_observations`: count of qualifying rows (not contracts).
- Sort: `contracts_in_window` descending, then `item_code`.

## Deviations from the brief's section hints
- Tack/emulsified asphalt: section 407 holds no tack item here (407-03000 is blotter material). Emulsified asphalt items are in 411-; used for mill_overlay.
- Concrete median cover: items are in 610- (not 608-/609-). Used 610- plus 202- removals and 609- Curb Type 2 (Section B) / Curb (Median).
- Irrigation: items are in 623- (215- holds transplant items with zero contracts). 623- irrigation pipe items added to landscaping.
- Epoxy crosswalk: no crosswalk-specific epoxy item exists; crosswalk uses 627- Xwalk / Stop Line items.
- Buffered bike lane delineators: permanent delineator and flexible post items have no in-window contracts; included 202-00090 (removal), 630-804xx (temporary), 630-80392 (tubular marker), 627- raised markers.

## Caveats
- All plausible matches are kept, so lighting (101), landscaping (58) and reconstruction (49) exceed the typical 3-15 range.
- An item can appear in several element files. Units are per item (`unit`).
