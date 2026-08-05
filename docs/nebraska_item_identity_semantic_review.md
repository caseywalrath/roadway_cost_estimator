# Nebraska Item Identity Semantic Review

## Outcome

The semantic review found no remaining case that requires a human to infer item meaning. The current audit contains the following documented identity resolutions; locator-specific text corrections are tracked separately because they repair parser output before identity comparison:

| Resolution | Count | Basis |
|---|---:|---|
| Normalized equivalent | 758 | Reviewed unit aliases and harmless description morphology |
| Reviewed multi-unit identity | 64 | Exact NDOT code and stable description; period rows and units remain independent |
| Reviewed description variant | 114 | Exact code and unit plus one coherent wording anchor; only truncation, insertion, or near-spelling differences |
| Reviewed extraction artifact | 29 | Direct PDF-page evidence showed interleaved or adjacent wrapped-row text; locator-specific corrections now clean the runtime text |
| Multi-unit and source-text resolution | 1 | Item `6001.59`; direct PDF evidence confirms the description and the annual `CY` unit |

The unresolved artifacts are intentionally empty:

- `data/staging/ne/item_identity_conflicts.csv`
- `data/staging/ne/item_identity_human_review.csv`

Nebraska remains disabled until the final package review and explicit enablement decision.

## Review Rules Applied

1. Identity decisions use `annual_price_rows.csv`, produced by the accepted production coordinate parser. The compact audit parser is inventory diagnostic evidence only.
2. Exact NDOT item code is required. No cross-code matching is performed.
3. Multi-unit rows remain one identity only when the description is stable. Published units remain on each period row, and prices must never be pooled across units.
4. Description variants are accepted only when every label relates to one coherent anchor by exact normalization, ordered truncation/insertion, or a near spelling change.
5. Broad fuzzy matching and price similarity are not identity evidence.
6. Visibly interleaved PDF text is classified as an extraction artifact only after a clean same-code/unit label or direct source-page inspection establishes the item meaning.
7. Source wording is preserved except where an explicit source-text correction is recorded.

## Direct Source-Page Decisions

- `6001.59`: Calendar 2021 page 12 prints `BENT NO.10 EXCAVATION`, quantity `190`, unit `CY`, average `$644.11`, and total `$122,380.00`. The July 2021-June 2022 report repeats the same aggregate. The annual parser omitted `NO.10`. The older catalog's `LUMP SUM` unit is retained as historical catalog evidence, but annual `CY` prices are not comparable with lump-sum prices.
- `A001.73`: Calendar 2021 page 22 and July 2020-June 2021 page 31 identify the item as `PROVIDE AND INSTALL SINGLE PORT EV CHARGING STATION WITH WALL MOUNTING`. Adjacent dual-port rows caused the extracted conflict.
- `A004.70`: Calendar 2020 page 45 and July 2020-June 2021 page 31 identify the item as `TRAFFIC SIGNAL, TYPE LS-1A, T11 FACE (W/BACKPLATE & B-4 ALTERNATE MOUNTING)`.
- `A004.71`: The same pages identify the item as `TRAFFIC SIGNAL, TYPE LS-1B, T16 FACE (W/BACKPLATE & B-4 ALTERNATE MOUNTING)`. Wrapped lines caused the two descriptions to be assigned out of order during extraction.

## Human-Only Review Pathway

No open semantic decision remains. Human review is therefore a verification and signoff step, not a classification exercise:

1. Open `item_identity_resolutions.csv` and filter `reviewed_by` to `source_page_visual_review`.
2. Spot-check the four direct source-page decisions above and a sample of the other extraction-artifact rows against their `source_locators`.
3. Confirm the product rule that rows with different normalized units remain separate and are never pooled or summarized together.
4. Record the reviewer name, review date, and any exception in the resolution artifact or a reviewed override file before Nebraska is enabled.
5. If an exception is found, restore that conflict to `needs_review`, add it to `item_identity_human_review.csv`, and choose one of: preserve one identity, split identity by supported source scope, or apply a locator-specific source-text correction.
6. Enable Nebraska only after the conflict file and human-review queue remain empty following a clean importer, audit, test, and package-validation run.

## Remaining Non-Semantic Data Quality Work

The 39 confirmed interleaved or truncated descriptions are now repaired by `data/staging/ne/annual_price_text_corrections.csv`. Each correction records its immutable source locator, expected pre-correction extraction, reviewed display text, reason, reviewer method, and date. The importer rejects a correction if that expected source text changes, so parser changes cannot silently apply stale repairs. This is source-text cleaning; it does not alter quantities, units, prices, totals, identities, or source locators.
