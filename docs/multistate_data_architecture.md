# Multi-State Data Architecture

## Decision

Use a shared normalized contract/item/bid model with state-native staging and manifest-driven presentation. Colorado is a supported state, not the baseline schema. Iowa establishes contract/project-number separation, effective-dated catalogs, bidder rank, alternates, and capability patterns. South Dakota establishes paired-document provenance, separate project control numbers, historical item recovery, and confirmed non-low combination awards.

## Boundaries

```mermaid
flowchart LR
  A["Official state sources"] --> B["Ignored raw cache"]
  B --> C["State-native staging"]
  C --> D["Deterministic validation and review"]
  D --> E["Normalized state partition"]
  E --> F["Manifest-driven loader"]
  F --> G["State-isolated UI"]
```

- Raw source: byte-for-byte downloaded or attached input; never app-loaded.
- Native staging: source-shaped rows that preserve fields and parser provenance.
- Normalized partition: reviewed relational rows consumed by the app.
- Materialized observation: exact agency-item evidence used by Matching Projects.

## Shared Contract

All states implement source, letting, contract, project-number, contract-item, agency-item, observation, and taxonomy tables. Bidder tables are enabled when the source provides bidder detail. State capabilities declare whether district filtering, engineer estimates, and bidder detail are available.

The app cannot infer state equivalence from an item code. `agency_item_id` is the lookup key. The same printed code in two agencies remains two identities.

## Native Extension Strategy

Do not add a shared column for every source-specific label. Use this order:

1. Map a concept to an existing shared field when semantics are equivalent.
2. Preserve source text in staging and provenance fields when it is presentation-only.
3. Add a normalized shared field when at least two sources need the concept or app behavior depends on it.
4. Add state-specific detail/export metadata only when the concept cannot be generalized without changing meaning.

Iowa examples:

- `SPEC` maps to versioned `spec_reference_code`.
- Call order, contract period, DBE goal, route, and letting status are shared contract metadata.
- Alternate set/member are shared contract-item metadata.
- Rank, percent of low, apparent low, and confirmed award are distinct bid fields.

South Dakota examples:

- Project No. and PCN are distinct fields on one contract-project record.
- A completed letting is one logical source with abstract and final-report document children.
- Deleted schedule rows remain in contract-item audit data but cannot become item observations.
- Apparent low remains rank 1 even when a combination award selects another bidder.

## Search and Matching

Default evidence search is exact `agencyItemId` within one selected state. It does not join across project numbers and does not search another state partition.

Reviewed municipal mappings can promote municipal observations to a state item. Unreviewed description matches remain staging/review candidates. Keyword and canonical similarity are not part of the default evidence table.

State switching reloads the selected partition and resets item, filter, exclusion, sort-detail, and modal state. It cannot carry a raw item code into the next state.

## Presentation

The product title is **Roadway Cost Estimator**. The state manifest supplies agency names, taxonomy labels, source labels, prefix lengths, and capability flags.

The core table is stable across states. Optional fields are removed when unsupported rather than rendered as repeated empty values. State-specific contract and bidder fields remain available in detail and CSV export.

Saved Projects are state-bound. A state change selects or creates the Project for that state. A future multi-agency state can add reviewed evidence lines from more than one agency while retaining the Project's single state.

## Iowa Import Rules

Catalog:

- Fixed-width Item master text is primary.
- Attached PDF must have the identical 3,727-code set.
- PDF description, unit, and `SPEC` values validate/enrich the text rows.
- Iowa ERL sections drive taxonomy; 60/61/62 groups have explicit fallback labels.

Bid tabs:

- Parse by coordinates and contract state, not text-line splitting alone.
- Read printed bidder ranks for each one-to-three-column page group.
- Allow long currency values to extend into the nominal column gutter.
- Deduplicate repeated items by contract, section, line, and code.
- Preserve every contract item even when an alternate bidder price is blank.
- Preserve source page and raw locator on contract items and bidder prices.
- Match awarded vendor to exactly one bidder before promoting awarded prices.
- Derive one unweighted average unit price from valid bidder prices.
- Reconcile each bidder's item extensions to the reported bid total.

## Iowa Archive Refresh

Iowa is enabled because the June 16, 2026 pilot and the available 2024-present historical archive pass the committed validator and rendered UI checks. Archive ingestion is scripted from the official IDOT archive page. Each refresh must:

1. Refresh `data/staging/ia/bid_tab_archive.csv`.
2. Cache and hash raw PDFs under ignored `data/raw/ia/bid_tabs/`.
3. Add one source and one letting per parsed letting date.
4. Preserve one contract row per official contract ID per letting date.
5. Preserve one project-number row per printed project.
6. Reconcile bidder item totals to bidder totals, except source rounding or preserved unselected added-option rows.
7. Resolve awarded vendors uniquely before creating awarded evidence.
8. Keep unsupported engineer-estimate fields empty.

The official archive is [Iowa DOT Bid Tabulations](https://iowadot.gov/consultants-contractors/contracts/historical-completed-lettings/bid-tabulations). The catalog source is [Iowa DOT Bid Item Information](https://iowadot.gov/consultants-contractors/contracts/general-letting-information/bid-item-information), and taxonomy comes from the [Iowa Electronic Reference Library](https://ia.iowadot.gov/erl/current/GS/Navigation/nav.htm).

## South Dakota Import Rules

Catalog:

- Submit the live Standard Bid Item search for all items and preserve the raw HTML snapshot.
- Normalize item codes to uppercase and exclude explicit `Deleted Item`/`Del` placeholders from current search identities.
- Recover valid archive-only codes as historical identities without inventing formal effective dates.
- Use the three official specification divisions as parents and the live 84 bid-item groups as sections.

Completed lettings:

- Inventory every central completed-letting link from January 1, 2019 through the requested end date.
- Treat the Abstract of Bids and Low Bid Final Report as paired children of one source.
- Parse bidder price columns and continuation pages by coordinates.
- Join final awards to abstract bidders by letting date, Item Nbr., normalized vendor, and amount; reviewed overrides are explicit repository inputs.
- Retain `AWARDED`, `WITHDRAWN`, `NO BIDS`, `REJECTED`, and `CANCELLED` contracts, but publish observations only for confirmed awards.
- Treat an abstract `No Bids Received` header as status, not a bidder. A `Moved to ... letting by addendum` note is `CANCELLED` only when the final block has no award amount; SDDOT also retains that note on later re-let award blocks.
- Preserve Project No. and PCN independently. Pair lists only when their cardinalities agree.
- Derive `average_bid` from every valid bidder unit price. Use the annual three-lowest statistic only for QA.

The official sources are the [completed letting archive](https://apps.sd.gov/hc65bidletting/bidlettingscomplete.aspx), [Standard Bid Item search](https://apps.sd.gov/hc70sbi/main.aspx), and [2024 Bid Item Price Report](https://dot.sd.gov/media/qqhgg24h/2024-bid-item-price-report.pdf).

The normal cached rebuild is:

```text
python scripts/import_south_dakota_data.py --catalog-date YYYY-MM-DD
```

Use `--refresh-item-catalog`, `--refresh-archive-index`, `--download-missing-reports`, `--refresh-reports`, or `--refresh-annual-report` only when refreshing the corresponding raw cache. `--start-date` defaults to `2019-01-01`; `--through-date` defaults to the current date.

## Future State Checklist

- Define state/agency IDs and source provenance.
- Inventory every source entry before parsing and record explicit skip/failure reasons.
- Identify whether one logical source depends on multiple physical documents.
- Record catalog history and status behavior.
- Map all independent contract/project identifiers without overloading a display field.
- Identify bidder, alternate, award, and estimate capabilities.
- Keep apparent low separate from confirmed award.
- Treat annual or aggregate price reports as QA unless they provide contract-level evidence.
- Create state-native staging and fixtures.
- Add manifest labels and capabilities.
- Validate code collisions, relationships, totals, and state isolation.
- Verify adaptive table, detail, export, and Project behavior before enabling the state.
