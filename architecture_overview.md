# Architecture Overview

## Current Product

This repository contains **Roadway Cost Estimator**, a static multi-state roadway bid-item evidence application. Colorado, Iowa, Nebraska, and South Dakota are enabled. A user must select a state on first visit; the browser remembers that choice. Search results never combine states.

The app is an evidence browser and limited local project workspace. It is not an automatic estimating recommendation system. Its primary output is a contract-item evidence table with source prices and provenance. Summary statistics, inflation adjustment, bidder detail, CSV export, and saved project lines support user review.

## Application Shape

- Hosting: GitHub Pages.
- Frontend: Vite and TypeScript.
- Runtime: static JSON/CSV files; no server database.
- Data entry point: `public/data/manifest.json`.
- State partitions: `public/data/states/{state}/`.
- Shared data: `public/data/common/`.
- State-native staging: `data/staging/{state}/`.
- Raw downloaded and attached files: `data/raw/`, which is git-ignored.
- Local source monitoring: `tools/source_monitor/`, a repository-tracked Python web tool that binds only to `127.0.0.1:4180`; its scan state and cache remain under ignored `data/raw/source_monitor/`.
- Curated, versioned source documents required to reproduce committed imports: `data/source_documents/{state}/`.
- Browser project storage: IndexedDB database `roadway-cost-estimator`, with independent Project, settings, revision, and migration-backup stores.

The schema-v2 loader reads the manifest, loads only the selected state's core tables, builds relationship maps, and defers `bid_item_prices.csv` until a bidder or source-detail view is opened.

Optional state partitions may also declare `item_price_summaries.csv` for non-contract period aggregates and `item_taxonomy_memberships.csv` for explicit item-to-section relationships. These are loaded into dedicated `AppData` arrays/maps and remain separate from contract observations; existing states omit both files without changing behavior.

## Runtime Flow

1. `src/main.ts` loads the manifest and resolves the remembered state preference.
2. A first-time user selects a state before any state data loads.
3. `src/data/loadData.ts` loads one state partition and the common FHWA inflation index.
4. `src/data/schema.ts` defines the shared contract, project-number, agency-item, bid, item-price, observation, taxonomy, and manifest interfaces.
5. `src/matching/buildEvidenceResult.ts` groups generalized observations by contract item and filters exact `agencyItemId` evidence.
6. `src/ui` renders manifest-provided labels, capabilities, columns, source filters, details, and exports. Source Review is a state-specific auxiliary view with list and full-width project-detail states.
7. `src/projects/projectRepository.ts` opens IndexedDB, preserves and migrates legacy v1-v3 storage, and exposes asynchronous Project operations. `src/projects/projectWorkspace.ts` defines the current Project workspace schema and pure workspace mutations.

## Local Data Source Monitor

The production application remains static and has no outbound source-scanning service. Developers can start the repository-tracked monitor by double-clicking `Start Data Source Monitor.cmd` or by running `python -m tools.source_monitor.server`. The monitor serves a plain HTML/CSS/JavaScript UI from a Python standard-library server on `127.0.0.1:4180`.

The declarative `tools/source_monitor/source_registry.json` lists verified official index pages, permitted redirected content hosts, source types, comparison rules, and the existing importer to use for a follow-up session. `Scan Now` fetches all configured sources, while each source card can run its own scan. Both normalize links/catalog records/period values and compare them with committed repository evidence or an explicitly saved local baseline. The monitor reports source-level New, Changed, Unchanged, Removed, Unavailable, Review required, or Baseline needed results. It never imports, promotes, commits, publishes, or changes app-loaded/staging data.

Actionable results include official URLs, periods, hashes or normalized fingerprints, and a copied agent import request. CDOT's Hyland Cost Data Book viewer is handled through its stable document-title metadata rather than its changing viewer-shell bytes; the monitor compares the identified quarter with the repository's loaded Cost Data Book coverage so a saved local baseline cannot hide an unimported CDOT release. `data/raw/source_monitor/scan_state.json` stores only local baselines, URL overrides, and scan metadata; failed or partial scans cannot replace a saved baseline. Fixture tests exercise the scanner and HTTP routes without network access.

## Data Model

The shared model uses these normalized tables:

- `sources`
- `lettings`
- `contracts`
- `contract_projects`
- `contract_items`
- `bids`
- `bid_item_prices`
- `agency_items`
- `agency_item_versions`
- `item_taxonomy`
- optional `item_taxonomy_memberships`
- `item_mappings`
- `item_observations`
- optional `item_price_summaries`
- optional `source_documents`

`contract_id` is the evidence parent. Project numbers and project control numbers are one-to-many children and never duplicate contract-item evidence. `agency_item_id` is the item identity; raw item codes are display and source fields. Generalized price types are `awarded_bid`, `average_bid`, and `engineer_estimate`.

State-native differences remain in normalized nullable fields, taxonomy rows, capability metadata, source provenance, and staging artifacts. They are not hidden by Colorado-specific enums.

Period-level published aggregates are not materialized observations. A state with `periodPriceHistory` capability presents those rows through an independent history workflow and must not use them for contract evidence, Matching Projects, or contract summary statistics.

See `docs/data_schema.md` for table contracts and `docs/multistate_data_architecture.md` for design boundaries.

## Colorado Package

The Colorado schema-v2 partition is generated by `scripts/migrate_multistate_data.py` from the prior app package. It contains:

- 470 contracts and 470 project-number records.
- 114,723 item observations.
- 4,838 agency items, including 65 explicit historical identities for valid full CDOT codes absent from the current item catalog.
- 39,116 source items, including 37,214 reconstructed CDOT Cost Data Book lines and 1,902 bid-tab/estimate lines; 40 bids; and 6,184 bidder item prices.

The migration preserves the prior exact-code evidence behavior, public sources, bidder details, district filtering, engineer-estimate prices, FHWA inflation adjustment, and exports. The old root-level CSVs remain migration inputs during this transition; the application does not load them.

CDOT Cost Data Book contract items are reconstructed deterministically from committed staging rows and their existing three-observation ID groups. This preserves duplicate-looking source lines, source filenames, PDF page numbers, and staging-row locators without reparsing the original PDFs. Source Review shows awarded, average, and engineer prices plus contract award metadata. It does not fabricate bidder rows because the Cost Data Books do not contain bidder-level item prices.

Colorado's reviewed division and section presentation is maintained in `data/staging/co/cdot_taxonomy_reference.csv` and applied by `scripts/migrate_multistate_data.py`. The reference distinguishes official specification titles, official special-provision titles, and catalog-derived Item Code Book groups. This prevents non-specification prefixes from being mislabeled as formal CDOT divisions and provides concise selected-group context through the Explorer information control without widening the pickers.

`scripts/import_bid_tab_workbook.py` supports both the original single-workbook formats and an explicit multi-sheet batch configuration. The Colorado master-workbook configuration selects eight sheets, fixes included row/schedule boundaries, handles estimate-only tables, conventional engineer/bid pairs, repeated vendor blocks, force-account totals, distinct engineer quantities, and source-published bid totals. Each source replaces rows idempotently by `source_id`. Raw workbooks remain ignored under `data/raw/co/`; committed audit extracts, match candidates, and reconciliation reports live under `public/data/imports/`.

Colorado source types include `cost_book`, `bid_tab`, and `estimate`. The three `estimate` sources are labeled “FHU engineer estimates” and publish only engineer-estimate observations. Bid sources publish unweighted averages of valid bidder unit prices and publish engineer or awarded observations only when the selected source scope provides them and award evidence reconciles. Full CDOT codes and uniquely resolved three-digit CDOT prefixes can be promoted. Malformed, ambiguous, and fuzzy-only candidates remain unmatched.

## Iowa Package

`scripts/import_iowa_data.py` imports:

- The official fixed-width Iowa DOT Item master text as the catalog authority.
- The attached item-description PDF as the `SPEC` source and code/unit/description cross-check.
- Iowa Electronic Reference Library divisions and sections, with explicit 60/61/62 fallback groups.
- The Iowa DOT historical bid-tab archive through cached PDFs under ignored `data/raw/ia/bid_tabs/`.

The enabled archive package contains 3,727 unique item codes, 43 parsed lettings, 1,550 contracts, 1,905 project-number records, 6,388 bids, 55,192 contract items, 225,131 bidder item prices, and 107,616 awarded/average observations. The archive inventory contains 44 PDF entries; one duplicate letting date is skipped. The parser preserves seven-bidder grouped layouts, multi-project contracts, alternate sets, source pages, line numbers, and raw source locators.

Awarded prices are promoted only when the printed awarded vendor resolves to exactly one bidder after reviewed normalization for common IDOT abbreviations, wrapped DBA names, and county-continuation artifacts. Rank 1 remains a separate apparent-low flag. Iowa average-bid evidence is the unweighted mean of valid printed bidder unit prices. Iowa does not fabricate engineer-estimate values. Preserved unselected added-option rows can make item-price sums exceed reported contract totals; validation reports those as warnings when the difference is explained by added-option sections.

## South Dakota Package

`scripts/import_south_dakota_data.py` imports the live SDDOT Standard Bid Item catalog and the central completed-letting archive from 2019 forward. The enabled package contains 5,643 agency-item identities: 5,574 current catalog items and 69 historical identities observed in bid abstracts. Nine catalog deletion placeholders remain in staging but are excluded from searchable items. The three official specification divisions and 84 Standard Bid Item groups form the item taxonomy.

The letting inventory contains all 175 central archive entries in scope. It parses 172 lettings into 1,206 contracts, 1,461 project-number/PCN records, 4,020 bids, 68,405 contract items, 253,990 bidder item prices, and 135,854 awarded/average observations. Three official report pairs return HTTP 404 and remain in the committed inventory with explicit failure reasons: May 3, 2019 University Class; February 21, 2024; and August 27, 2025.

Each parsed letting is one `sources` bundle with child `source_documents` rows for the Abstract of Bids and Low Bid Final Report. Abstracts provide bidder schedules and apparent-low totals. Final reports provide authoritative award or non-award status. An awarded bidder is published only after unique vendor reconciliation; it may differ from the apparent-low bidder for combination awards. `average_bid` is the unweighted mean of all valid bidder unit prices for that contract item. Source-deleted lines, unmatched items, non-awarded contracts, and annual aggregates do not publish observations.

The 2024 Bid Item Price Report is parsed into committed staging and reconciled as a QA source. Its 1,431 annual rows are not runtime contract evidence. Raw HTML and PDFs remain ignored under `data/raw/sd/`; the importer supports cached operation and explicit refresh/download options.

## Nebraska NDOT Annual-Price Package

`scripts/import_nebraska_data.py` is an offline-first, coordinate-aware importer for the 17 approved NDOT reports: January--December 2018--2025 and July--June 2017--18 through 2025--26. It preserves both overlapping report series as independent `item_price_summaries.csv` rows and writes no letting, contract, bid, or observation rows. The importer joins legacy split currency digits, handles portrait and landscape layouts, preserves signed and zero values, records one-based PDF pages, and rejects malformed rows into `data/staging/ne/annual_price_parse_failures.csv`.

The staged package currently contains 23,636 parsed annual rows, five committed coordinate fixtures, frozen per-report acceptance counts, and a quantity-times-average reconciliation report. NDOT's published average and total-bid aggregates are retained independently because the aggregation method is undocumented; reconciliation differences remain review evidence and do not become contract observations. The generic Explorer supports explicit taxonomy memberships and an independent, sortable period-history table with report-series and reported-unit filters, direct source links, and CSV export. Annual average prices use the mean of all four FHWA NHCCI quarters in the published report window; incomplete quarter coverage leaves the source value unchanged and visibly unavailable for adjustment. Period rows remain excluded from Matching Projects, Source Review, Unit Price Summary statistics, Total Bid adjustment, CSV adjustment, and quick-fill controls. An NDOT `historical` item status is internal source-provenance metadata only: the older linked Standard Item List did not contain the identity, but one or more published annual reports did. It does not establish that an item is obsolete or inapplicable. Nebraska suppresses this marker in the user interface while retaining it in normalized data and validation. Identity review uses the accepted production-parser rows, not the audit inventory parser. `annual_price_text_corrections.csv` contains 39 reviewed, locator-specific repairs for interleaved or truncated PDF text; the importer validates each expected pre-correction string before applying it. The reproducible resolution artifact records 761 normalized equivalents, 64 reviewed multi-unit identities, 114 reviewed description variants, and one combined source-text/multi-unit resolution. `item_identity_conflicts.csv` and `item_identity_human_review.csv` contain no unresolved rows. Nebraska is enabled in `public/data/manifest.json` with the `periodPriceHistory` capability.

## UI Rules

- State choice is required initially and remembered afterward.
- State switching constructs a new state-specific application session and clears incompatible query/filter/detail state.
- Matching Projects uses a stable core: Contract/Project, Location, Let Date, Awarded Vendor, Bid Count, Quantity, Unit, Description, Awarded Price, Average Price, and Source.
- Matching Projects filters letting dates with inclusive native calendar From/To controls backed by full ISO dates. From is bounded by the oldest and latest valid letting date in the loaded state; To accepts dates through the current day so it is not limited by the latest indexed project. Legacy saved evidence contexts with year-only bounds normalize to January 1 and December 31 date bounds when read.
- Colorado adds District and Engineer Estimate.
- Iowa and South Dakota hide unsupported District and Engineer Estimate controls/columns.
- Item-prefix extraction uses each state's manifest-defined leading-digit length. South Dakota therefore supports codes such as `009E0010` without a state-specific UI parser.
- A state may declare a manifest-driven section-picker mode. South Dakota uses a flat, independent `Division / Bid Item Group` selector whose options include the Division and group prefixes; Colorado, Iowa, and Nebraska retain Division-dependent section selectors.
- Dependent Item Search dropdowns remain semantically disabled until their prerequisite filter is selected and use a muted label/control treatment to make that dependency visible.
- A state may declare manifest-driven item-code series. Nebraska exposes independent 0000–9999 and A/L/P/R/W series filtering below Specification Section; the series filter can be used alone or combined with Division, Section, and text search.
- Colorado's District filter includes numbered districts plus `Statewide / unassigned` (blank, `0`, or `00` district values) and `Non-CDOT project` (a non-CDOT agency identity). These special categories are grouped after numbered districts and use the same multi-select union behavior.
- Period-history-only states render `Edit Item Search` in the annual-price-history header because they do not render the Matching Projects header that owns this action for contract-evidence states.
- Historical identities and source-deleted lines retain distinct labels unless a state manifest explicitly disables historical item-status display. Nebraska disables it because its `historical` status records annual-report versus older-catalog provenance, not an engineer-facing item-status claim. South Dakota project displays and exports include both Project No. and PCN, and Source Review links the named abstract and final-report documents.
- Explorer exposes Source Review through a subdued text link aligned with the results column. The dedicated view keeps long source-project lists and wide source details out of the primary evidence workflow and never stacks a project-detail modal over a source list. Matching Projects links continue to open bidder detail when bidder rows exist; otherwise, reviewable Cost Data Book and estimate projects open directly in Source Review.
- Contract CSV export includes state, agency item identity, call order, status, route, project numbers, contract period, DBE goal, bid metadata, and source identity.
- Bid item prices load on demand.

## Branding and Visual Design

- The interface is skinned to the FHU (Felsburg Holt & Ullevig) brand. All theme tokens live in the `:root` block of `src/styles.css` and are the single source of truth for the accent color.
- Palette (sampled from the FHU logo): `--brand-primary` (teal `#14706e`) and `--brand-primary-dark` drive `--accent`/`--accent-dark`, which propagate to primary buttons, active tabs, links, focus rings, step numbers, sort arrows, and eyebrows. `--brand-secondary` (green `#6d9b45`) is the secondary accent used in the header underline gradient; `--brand-gold` (`#d8a12c`) is the tertiary field color; `--brand-slate` (`#3f4b57`) matches the wordmark and drives `--heading`.
- The `--muted` and `--line-strong` tokens are now defined in `:root` (they were previously referenced but undefined).
- Typography: body and UI text use Inter; headings use Barlow. Both load via a Google Fonts `<link>` in `index.html`, behind a system-font fallback stack exposed as `--font-body` and `--font-heading`.
- Brand assets live in `public/brand/` (copied to the site root at build time): `FHU-logo.png` (the firm's official horizontal lockup) and `favicon.png` (a square crop of the same logo's road mark, cropped/padded from the official artwork rather than hand-drawn). The logo is referenced from the header in `src/ui/renderApp.ts` and the status panels in `src/main.ts`; the favicon is linked from `index.html`. Static assets must live under `public/` to be served by the Vite build; a root-level file is not bundled.
- A branded footer (firm name, product title, year) renders at the bottom of the app shell from `src/ui/renderApp.ts`. The product title itself remains data-driven from `manifest.json`.

## Project Workspace Rules

- Schema v10 stores each Project independently in IndexedDB. Each Project stores a non-negative `contingencyPercent`; each line has type `catalog` or `custom`, an independent `costCategory` (`construction` or `other`), and an optional Project-specific `group`. Missing categories in older records normalize from line type so existing subtotals remain unchanged. Imported lines may also retain validated workbook provenance without storing the workbook itself.
- Catalog lines retain official `state`, `agencyId`, `agencyItemId`, code, and unit identity. Their description is locked to the official catalog value by default, but an engineer may explicitly unlock a Project line's description after confirmation; this does not alter its catalog identity. Pricing evidence is optional metadata: Item Search entries retain their evidence snapshot, while exact-code Project entries may have no snapshot. The entry path does not determine line identity. Catalog quantity and unit cost may remain incomplete until the engineer fills them in. Custom lines accept free-form group, item code, description, unit, notes, and nullable Unit Cost/Quantity without catalog identity or evidence context.
- Project status, revision, archive time, and backup revision are persisted with the Project.
- Active Project identity is stored independently per state. Switching states restores the last active Project for that state and never creates a Project implicitly.
- v1-v3 browser storage migrates without deleting the legacy keys. Exact raw values and migration reports remain in the `migrationBackups` store. Blank zero-line Projects traceable to the former automatic-default behavior are removed once; named Projects and Projects containing metadata or lines are preserved.
- Invalid legacy Projects are rejected as complete units rather than silently losing invalid lines.
- A Project can use reviewed evidence from multiple agencies only within its state.
- Duplicate detection uses `agencyItemId`, not the raw item code.
- New Projects are created only through an explicit form and require a name; location and notes remain optional. Migrated blank names with meaningful content remain valid and display as `Unnamed Project`.
- Manually created Project state is selected in the workspace's New Project form. The top state selector controls application navigation; the workspace header does not duplicate it.
- The Project tab contains a workspace and an in-tab manager for switching, editing, duplicating, backing up, archiving, restoring, and permanently deleting archived Projects across states.
- `Project Actions` remains available in active, empty, editor, and manager views and contains recent-Project switching, explicit creation/editing, management, CSV reporting export, and JSON recovery import/export.
- `Import From Excel` is a separate Project Actions flow. Its staged wizard presents five user-facing steps: Choose file, Choose data, Match columns, Review items, and Confirm import. The file-first screen shows a single workbook choice, a read status, a destination Project choice, and the destination-state item-matching context; completed stages can be reopened from the step indicator while future stages remain disabled. Choose data automatically selects the highest-confidence visible worksheet and detected table, then displays its physical range, header status, and a bounded spreadsheet preview. The engineer can select another worksheet, select among multiple detected tables, confirm ordinary section headings, choose an alternative section, or open Change data range to exclude helper cells and optionally include hidden rows. Match columns presents Item Code, Description, Unit, Quantity, Unit Cost, and Notes in a table with detected headers, example values, and plain required/recommended status. Extended cost, Project-group behavior, cost-category behavior, and header overrides remain available under Advanced import settings. If a recognized estimate header row leaves its leading description column blank, the importer suggests that column as Description. Default cost category behavior assigns imported rows to Construction Costs; this is independent of official/custom item identity. Review opens on Needs attention when a row needs a decision, otherwise on All items. Three review tabs expose Needs attention, Reviewed, and All items; an Issue type dropdown shows group counts, with Ready and Skipped filters available within All items. The review table can filter unresolved rows by issue type, select individual rows, a visible page, or all filtered rows, and apply only a resolution shared by every selected row; individual choices remain available. The compact review table shows item identity, expandable source details, reasons, and explicit relevant choice buttons; source and official description or unit values are compared when they conflict. Rows needing attention can be resolved or left unresolved; continuing to Confirm import skips unresolved rows and reports their count. Rows whose sole supported action is Skip are automatically skipped and excluded from Needs attention and Reviewed unless they have an explicit user choice; All items and its Skipped filter retain their source row, text, and reason. Table paging is labeled Previous 50 and Next 50 and is separate from wizard navigation. Confirmation names the destination Project and item count, identifies unresolved rows that will be skipped, distinguishes automatically skipped potential item rows from headings, blank rows, and user-selected skips, states their counts and reasons, shows imported construction/other costs plus a spreadsheet-total comparison, and labels the final button with the import count. Success states exactly what was added; failure states that no items were added and offers a retry. The flow reads `.xlsx` files through the worker, maps columns and sections, and paginates review rows for large selections. The controller keeps the workbook draft detached from Project persistence, invalidates parsed rows and decisions when the selection or mapping changes, terminates stale workers on cancel/navigation, and preserves its internal resolution actions behind the review presentation. The persistence operation adds and updates accepted lines through the repository's optimistic, atomic import transaction with a pre-import recovery snapshot, while new Projects are created with accepted lines in their initial write. The prepared import remains available after conflict, quota, ownership, or storage failure. A CSV issue report is available before and after the save.
- Project JSON files (`.rce-project.json`) are the round-trip recovery format. CSV remains a reporting export.
- Excel import Step 4 presents three tabs (Needs attention, Reviewed, and All items), an Issue type dropdown with group counts, and Ready/Skipped filters within All items. The compact item/reason/choice table retains expandable source details and explicit individual action buttons. A checkbox column and adjacent Row column support selecting individual rows; one Select All / Clear button selects or clears selectable rows visible on the current page, as limited by the issue filter and pagination. When rows are selected, the shared-action dropdown appears to the right of this button; choosing an action immediately applies it to all selected rows. The selected count is omitted. Undo appears by itself beside Select All / Clear when no rows are selected. No selection controls stay sticky. The dropdown contains only choices shared by all selected rows, including Skip selected. Tabs, filters, guidance, and result feedback remain in normal page flow. Reviewed exposes recorded decisions and Change choice; one-step Undo restores the preceding decisions and review filter/page, and is invalidated when rows are reparsed. Users can continue with unresolved rows; those rows are excluded from the import and identified on Confirm import. Recorded choices are still validated by the resolver at confirmation.
- Project CSV export includes an `Added Via` column with user-facing values `Roadway Costing Tool` for catalog lines, `Manual` for custom lines, and `Excel Import` for imported lines. The existing columns retain their positions; item type, cost category, and import locators are appended.
- The Excel import reader is isolated under `src/projects/excelImport/` and runs in a dedicated worker. The sparse SheetJS Community Edition 0.20.3 adapter preserves physical cell coordinates, typed and formatted values, cached formula results, merge anchors, print areas, and hidden sheet/row/column metadata. It accepts `.xlsx` ZIP workbooks only, applies bounded parsing limits, and never evaluates formulas or makes runtime CDN requests. Binary reader fixtures are generated by `scripts/generate_excel_import_fixtures.mjs`.
- Excel import layout and row decisions remain pure and detached from Project persistence. `detectLayout.ts` suggests physical regions, header rows, sections, and alternative choices; `parseRows.ts` retains row locators and classifies blank, section, repeated-header, summary, item, and ambiguous rows; `matchRows.ts` performs exact destination-state/agency matching with explicit description and unit comparisons; `resolveDraft.ts` applies catalog/custom, allowance, incomplete, category, and source-total decisions while producing validated Project lines with import provenance. Overlapping regions are checked by `selectionRules.ts` before rows are deduplicated.
- Project metadata is read-only until an explicit Edit action and changes only on Save. Line-field edits autosave after 400 milliseconds; structural changes and metadata saves persist immediately. The footer reports the last successful Project write.
- The Project Items header shows Construction Costs, Other Costs, a Project-level editable contingency percentage and calculated contingency amount, plus Total Project Cost in one horizontal summary strip. Construction and Other Costs sum the explicit line categories independently of catalog/custom identity; contingencies apply to their combined base; blank or legacy percentages are zero.
- Project CSV exports retain the line-item table and append a separate two-column Project Cost Summary section. Project JSON backups persist the contingency percentage and include a derived summary snapshot that is recalculated on import.
- The Project Items section provides `+Add Item` for immediately persisted custom rows. Custom rows are appended, fully inline-editable, included in project totals and CSV exports, and may remain incomplete until the user edits or removes them. When a custom row's code exactly matches the current state's Item Search catalog, confirmation converts it to a catalog-linked line, fills the official description and unit, and stores the agency item identity. Catalog code and unit remain locked; its description is locked until the user confirms its per-line edit control. Group is editable on all line types, while project-specific cost, quantity, and notes edits remain available.
- Catalog item codes in the Project table link to a fresh Explorer search for the same state-specific agency-item identity. This navigation clears active Explorer filters, sorting, exclusions, detail selection, and inflation adjustment; it does not restore or modify the line's saved evidence context.
- Legacy Explorer-backed lines normalize to catalog lines during v10 parsing without discarding their saved queries, filters, sort, included observation IDs, summary snapshot, or cost source. Custom lines can be assigned to Construction Costs and retain that category when linked to a catalog item, copied, reloaded, or restored from backup.
- Project Items open sorted by Group ascending. Header sorting is session-local display state and does not reorder stored lines; Project CSV export follows the active Project Items sort. Group values are used for sorting and suggestions only and do not create subtotals or change totals.
- Group suggestions use unique nonblank values already used in the active Project and remain open-ended through a datalist input. Explorer's Add Item to Project form accepts the same Project-scoped Group values.
- Local revisions retain the most recent 20 internal recovery snapshots per Project. They are removed with a permanently deleted archived Project. BroadcastChannel edit claims prevent silent concurrent-tab overwrites.

## Data Governance and Validation

`scripts/validate_data_package.py` validates the manifest and every enabled partition. It fails for duplicate IDs, broken relationships, malformed numbers, bidder headers without ranks, ambiguous awarded vendors, bidder/price contract crossings, unreconciled Iowa bid totals not explained by preserved unselected options, observations without an agency-item identity, invalid optional source-document relationships, unresolved South Dakota awards, or missing archive acceptance features.

Downloaded working files stay in ignored `data/raw/`. Curated, versioned source documents required to reproduce committed imports live in `data/source_documents/{state}/`; the CDOT Cost Data Books are under `data/source_documents/cdot/cost_data_books/`. Committed provenance also includes publication URLs, filenames, hashes, parser names/versions, normalized data, native staging data, and importer code.

Municipal items remain source-native. Only explicit reviewed `item_mappings` can connect them to state-item evidence. Description similarity never promotes evidence automatically.

Future state imports follow these rules:

1. Inventory every source entry before parsing and commit explicit failure or skip reasons.
2. Preserve paired or multi-document provenance as child source documents.
3. Store distinct agency project identifiers in distinct fields; never infer associations when source cardinalities disagree.
4. Preserve exact agency item identity and raw contract descriptions/units.
5. Express unsupported filters and measures through manifest capabilities instead of state-specific UI forks.
6. Create historical identities from contract evidence without claiming unsupported official effective dates.
7. Keep apparent-low derivation separate from confirmed final awards.
8. Treat annual aggregate reports as reconciliation evidence, not contract-level observations.

## Deferred Scope

The additive Planning module is specified in [docs/planning-module-implementation-plan.md](docs/planning-module-implementation-plan.md), with a frozen Phase 0 contract in [src/planning/contract.md](src/planning/contract.md). Phase 1 introduces an isolated pure TypeScript core under `src/planning`: state-specific provisional recipes, units and quantity rules, nullable cost/allowance calculations, scope substitutions, immutable scenario operations, review fingerprints and comparisons. Caller-supplied IDs and timestamps keep the core deterministic. Recipes and rate snapshots are embedded in scenarios; overrides preserve their reasons and original bases. No Planning module imports Project storage or UI. Blank inputs, missing evidence and unassessed external scope prevent a complete total, while known priced scope remains available.

Nebraska and Colorado each have three provisional base package types plus optional sidewalk. Nebraska uses fixed-section SY base bindings; Colorado uses CY base quantities and separate 6-inch path/sidewalk bindings. Phase 2 adds separate pure adapters: Nebraska selects an exact item/unit from one NDOT annual report and freezes the published row and complete-window NHCCI treatment; Colorado selects exact CDOT cost-book awarded lines, resolves source identities, and computes a median within each contract followed by a median across contracts. Sparse and missing evidence remain visible. These adapters consume the loaded state data without changing the Explorer or import pipeline.

Phase 2 also adds versioned Planning JSON recovery and a deterministic cost-review CSV builder. Recovery validates the complete record, preserves frozen package/rate inputs and incomplete numeric drafts, and imports a copy using caller-supplied unique identity seed. The CSV exposes inputs, assumptions, source provenance, exclusions, allowances, review status and nullable totals. Browser persistence, Planning navigation/UI and Project snapshot handoff remain pending; the current application still exposes Explorer and Project. Sol owns architecture, UI, persistence and Project compatibility; Luna handles bounded implementation under the contract.

- South Dakota regional letting archives.
- Cross-state item comparison.
- Automatic canonical equivalence.
- Automatic municipal matching.
- Shared accounts, server persistence, and private data hosting.
- DuckDB-WASM or another browser database unless CSV size or relationship work requires it.

Excel import confirmation detects matching existing Project items using final reviewed values. Official lines match state/agency item identity, normalized Group, and cost category; custom lines match normalized code, description, unit, Group, and cost category. Add as separate items is the default. Users can bulk update or skip matching rows, with individual overrides in an expandable comparison table. Multiple existing matches or repeated incoming matches require explicit update targets; conflicting targets block save. Updates preserve row ID, order, identity, evidence, and creation time, retain blank quantity/unit cost/notes, replace explicit zero values, and record import provenance. Confirmation shows added/updated/skipped counts, net cost changes, and projected Project base costs. The repository applies additions and updates atomically with revision checks and a pre-import recovery snapshot; failed saves retain the draft.

Confirm Import uses a compact destination and Add/Update/Skip count summary, matching-item decisions when applicable, and one projected Project cost before contingency. Matching comparisons, explanatory copy, cost breakdown, and skipped-row reasons are expandable. Unresolved rows, potential missing items, ambiguous bulk-update fallbacks, blocking target errors, and nonzero spreadsheet cost differences remain visible. Blocking update errors open the comparison table automatically.
