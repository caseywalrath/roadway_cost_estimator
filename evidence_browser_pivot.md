# Evidence Browser Pivot

Status: Historical planning reference. The current consolidated roadmap is `project_roadmap.md`.

## Purpose

This document is the master plan for pivoting the prototype from a price recommendation tool to a bid-item evidence browser.

The app should help roadway engineers gather, filter, review, and summarize project evidence for one official bid item. The app should not present itself as choosing a final unit price.

## Product Position

Primary deliverable:

- a table of project-item evidence rows for the selected official item code.

Secondary aids:

- awarded bid summary statistics for the currently filtered table.
- data notes about missing rows, unit mismatches, or demo data.

Removed or demoted concepts:

- suggested unit price.
- confidence rating.
- hidden top-five relevance selection.

## Phase 1 Decisions

- Keep the static Vite and TypeScript app model.
- Keep the existing CSV schema.
- Keep the left-panel CDOT Item Book Search.
- Require an official selected item code before evidence rows are shown.
- Treat all relevant results as exact item-code matches.
- Group observations into one project-item evidence row.
- Show separate price columns for awarded bid, average bid, and engineer estimate.
- Default source filter to public CDOT cost-book rows.
- Default unit filter to the selected official item unit.
- Exclude unit-mismatch rows from the default table and show a data note count.
- Sort rows newest first, then by project number or project name.
- Calculate summary statistics from awarded bid unit prices only.

## Evidence Row Shape

Each browser row represents one project-item evidence record grouped from loaded observations by:

- project.
- source.
- item code.
- raw item description.
- normalized unit.
- quantity.
- date.

Displayed columns:

- Project number.
- Project / location.
- District.
- Let date.
- Contractor.
- Bid count.
- Quantity.
- Unit.
- Item description.
- Awarded bid unit price.
- Average bid unit price.
- Engineer estimate unit price.
- Source.

## Phase Sequence

### Phase 1: Table Pivot

Implemented behavior:

- exact-code evidence browser.
- public CDOT cost-book default source.
- same-unit default table.
- compact filter toolbar with active chips and an inline drawer for source, geography, district, year, quantity, unit, and awarded-price filters.
- compact awarded bid summary statistics.
- data notes instead of confidence guidance.

### Phase 2: Export

Add CSV export for the filtered evidence table.

### Phase 3: Manual Review Set

Add manual include/exclude controls, exclusion reasons, reviewer notes, and recalculated included-set statistics.

### Phase 4: Richer Filtering

Add contractor, bid count, project number search, and full table text search.

### Phase 5: Optional Non-Exact Review Mode

Add alias or description match review mode only as an explicit non-default mode. Keep it separate from exact-code evidence.

## Validation Scenarios

Use item `304-06007` as the first smoke test.

Expected phase 1 behavior:

- default evidence source is public CDOT cost book.
- default table shows all 13 same-unit public CDOT project-item rows with awarded bid prices.
- summary statistics use awarded bid unit prices only.
- confidence and suggested price are not primary results.
- including all loaded sources exposes demo rows when they match filters.
- unit-mismatch rows are excluded by default and counted in a data note.
- clearing the item prompts the user to select an official item code.
