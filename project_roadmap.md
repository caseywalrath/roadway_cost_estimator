# Project Roadmap

## Purpose

This roadmap is the current planning source for the Roadway Cost Estimator.

It consolidates the older `evidence_browser_pivot.md` and `prototype_phase2.md` planning notes into the current product direction as of June 18, 2026. Those older files remain historical references, but this file should guide new roadmap and implementation decisions.

The product is a structured evidence browser, not a price recommendation engine and not a full estimate system.

## Current Product Position

The current app is a static GitHub Pages-ready Vite and TypeScript app that helps a user select one official CDOT roadway bid item and review exact item-code project evidence.

Implemented:

- Static browser-only app with CSV files loaded from `public/data`.
- CDOT section-based item search using the 2026 CDOT item-code book.
- Official item selection before project evidence is shown.
- Public CDOT Cost Data Book records from 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1.
- Demo project evidence removed from the app-loaded data package.
- Matching Projects table built from exact agency item-code observations.
- Awarded bid, average bid, and engineer estimate values grouped into one project-item evidence row.
- Source, geography, district, unit, year, quantity, and awarded-price filters.
- Same-unit default evidence table with unit-mismatch notes.
- Sortable Matching Projects table.
- Awarded Bid Summary based only on currently filtered awarded bid unit prices.
- CSV export for the currently filtered and sorted Matching Projects rows.
- Browser-local Project workspace with one active project, editable saved item lines, preferred unit costs, traceable evidence context, and Project CSV export.

Current default smoke-test item:

- `304-06007`, Aggregate Base Course (Class 6), `CY`.

## Superseded Plans

The following older plan elements are no longer compatible with the current trajectory unless explicitly reopened:

- Treating the app as a demo-data recommendation prototype.
- Presenting suggested unit price, confidence rating, or top-five ranked matches as the main result.
- Letting description-only matching drive default project evidence.
- Showing alias, keyword, or description fallback matches in the normal evidence table.
- Using public/internal demo source scopes or demo query presets.
- Mixing awarded bid, average bid, and engineer estimate values into one statistic.
- Adding private FHU data to this public GitHub Pages repository.
- Starting with estimate upload, spreadsheet import, chat, accounts, database, or server workflows before the one-item evidence browser and local Project workspace are trusted.

## Product Direction

The near-term product should remain a one-item evidence review tool with a lightweight local Project workspace.

Primary user value:

- Find an official item.
- Review all exact-code public CDOT project evidence.
- Filter, sort, export, and discuss the evidence with roadway reviewers.
- Save user-selected official items into a browser-local project line table when the user chooses a preferred unit cost.
- Decide outside the app how the evidence should inform estimating judgment.

The app should make weak or incomplete evidence visible. It should not imply a final recommended price.

## Recommended Sequencing

### Phase 1: Evidence Browser Hardening

Goal: Make the current exact-code evidence browser credible enough for roadway engineer review.

Next work:

- Validate promoted CDOT 2022 Q4 through 2026 Q1 rows with roadway reviewers.
- Add automated checks for source, project, and observation relationships.
- Add source coverage notes by cost-book period and item family.
- Add targeted smoke tests for common item codes, including `304-06007`.
- Confirm GitHub Pages deployment after each merged PR.
- Keep `architecture_overview.md`, `docs/data_schema.md`, and `user_workflow.md` aligned with behavior.

Exit criteria:

- Reviewers can run common CDOT item searches.
- Reviewers understand source limitations and unit handling.
- The app can detect basic data integrity failures before promotion.

### Phase 2: Reviewer-Controlled Evidence Set

Goal: Let reviewers move from a filtered evidence table to a deliberate review set.

Recommended features:

- Manual include/exclude controls for Matching Projects rows.
- Exclusion reasons and reviewer notes.
- Included-set awarded bid statistics recalculated from selected rows.
- Clear reset behavior for reviewer selections when item or filters change.
- CSV export that can include review decisions and notes.

Non-goals:

- Automatic outlier removal.
- Unit conversion.
- Price recommendation.
- Persistent shared review history.

Exit criteria:

- A reviewer can document why rows were used or excluded.
- Exported evidence can support an external basis-of-estimate discussion.

### Phase 3: Richer Evidence Filtering And Traceability

Goal: Improve scanning and auditability without changing the exact-code default.

Recommended features:

- Contractor filter.
- Bid count range filter.
- Project number search.
- Table-wide text search across project, location, contractor, item description, and source.
- Optional terrain and awarded-bid-total filters if reviewers find them useful.
- Clear source-period and data-limitations display.

Exit criteria:

- Reviewers can quickly narrow large item-code evidence sets.
- Filtering remains visible, reversible, and exportable.

### Phase 4: Data Pipeline And Coverage Expansion

Goal: Make public data updates repeatable and auditable.

Recommended work:

- Validate future CDOT cost-book quarters before promotion.
- Improve parser and promotion tests for known CDOT PDF variations.
- Add a repeatable checklist for adding a new cost-book period.
- Track source coverage by item code, unit, year, and district.
- Keep raw source PDFs out of git and use ignored local source folders.

Exit criteria:

- Adding a new public cost-book period is a controlled process.
- Data coverage gaps are visible before users interpret evidence.

### Phase 5: Explicit Non-Exact Review Mode

Goal: Support broader evidence discovery only when reviewers intentionally leave exact-code mode.

Recommended features:

- Separate mode for reviewed aliases or description-adjacent matches.
- Clear labels for exact code, reviewed alias, and non-exact candidate rows.
- No non-exact rows mixed into the default evidence table.
- Reviewer warnings when evidence is not exact-code support.

Non-goals:

- Hidden relevance scoring.
- Keyword fallback as default evidence.
- High-confidence recommendation from non-exact matches.

Exit criteria:

- Users can inspect adjacent evidence without mistaking it for exact item-code support.

### Phase 6: Estimate Workspace

Goal: Add multi-item review only after the one-item evidence workflow is trusted.

Initial slice implemented:

- Multiple independently stored browser Projects with one active Project per state.
- Project name, location, and notes.
- Manual project line creation from the selected official item.
- Required quantity and preferred unit cost.
- Quick-fill from current included summary statistics.
- Duplicate item prompt.
- Editable Project item table.
- Project CSV export.
- IndexedDB persistence, Project manager, JSON backup/import, local revisions, and concurrent-tab protection.

Recommended features:

- Broaden manual estimate rows after the current Add to Project workflow is reviewed.
- Per-row item selection using the existing item search.
- Row status for evidence found, no support, unit mismatch, or needs review.
- Link each row to the existing Matching Projects detail view.

Deferred until later:

- Spreadsheet import.
- Advanced versioning.
- Collaboration.
- User accounts.

Exit criteria:

- A user can review a small estimate section while preserving the current one-item evidence workflow.

### Phase 7: Import, Export, And Private-Data Strategy

Goal: Reduce manual work without weakening governance.

Recommended sequence:

- Expand evidence export formats only after reviewer-set behavior is stable.
- Add CSV import for estimate rows only after the estimate-row schema is stable.
- Add XLSX import later if CSV import proves useful.
- Decide private-data hosting before using reviewed FHU records.

Governance rules:

- Private FHU data must not be committed to the public repository.
- Browser-local upload can be considered before server storage.
- Private hosting or a backend should be considered only when access control, persistence, or collaboration is required.

Exit criteria:

- Import/export behavior is traceable and understandable to non-developers.
- Private-data handling is approved before implementation.

## Cross-Cutting Workstreams

### Data

- Keep public CDOT cost-book rows separate by source period.
- Preserve raw descriptions, raw units, normalized descriptions, normalized units, source IDs, project IDs, and price types.
- Add validation before promotion, not after users discover data issues.
- Document source coverage and known limitations.

### User Experience

- Keep the first screen focused on item selection and evidence review.
- Avoid marketing-style screens or broad estimator workflows.
- Keep filters visible through chips and reversible controls.
- Keep row-level evidence dense enough for repeated engineering review.

### Matching

- Exact official item code remains the default definition of relevant evidence.
- Same-unit evidence remains the default table.
- Alias and description matching are future explicit review modes.
- Unit conversion, escalation, and outlier removal require approved assumptions before implementation.

### Documentation

- Update `architecture_overview.md` when data flow, runtime behavior, or major evidence-browser rules change.
- Update `docs/data_schema.md` when CSV fields, allowed values, or data governance rules change.
- Update `docs/implementation_notes.md` when import, promotion, build, or test commands change.
- Update `user_workflow.md` when the user-facing workflow changes.
- Update this roadmap when sequencing or product direction changes.

## Near-Term Backlog

Recommended next backlog, in order:

1. Add data integrity checks for loaded CSV relationships.
2. Add source coverage notes for promoted CDOT cost-book periods.
3. Validate several high-volume item codes with roadway reviewers.
4. Add manual include/exclude review controls and reviewer notes.
5. Add included-set statistics and review-aware CSV export.
6. Review the browser-local Project workspace with roadway users and refine the line-item export columns.
7. Add contractor, bid count, and project number filters.
8. Update `user_workflow.md` to match the current evidence browser and export workflow.
9. Add smoke-test documentation for `304-06007` and other reviewer-selected items.

## Decision Points

Before manual review sets:

- What inclusion and exclusion reasons should reviewers use?
- Should notes be plain text only?
- Should review decisions be export-only or persisted in browser storage?

Before richer filtering:

- Which filters materially help reviewers narrow evidence?
- Which fields should stay export-only metadata rather than visible table columns?

Before non-exact review mode:

- Who approves aliases?
- How should non-exact candidates be labeled?
- What warnings are required?

Before estimate workspace:

- What fields define one estimate row?
- Which additional fields are needed beyond the current Project line schema?
- When should multiple-project management replace the one-active-project UI?
- What spreadsheet format is required after CSV export is reviewed?

Before private data:

- Which data is allowed?
- Where can it be hosted?
- Who can access it?
- What source labels and warnings are required?

## Working Rule

Each development session should produce a small, reviewable change unless the team explicitly chooses a larger build phase.

For each new feature, capture:

- What user problem it solves.
- What data it depends on.
- What the user should see.
- What should happen when data is weak or missing.
- What documentation needs to change.
- What local or automated checks should verify it.
