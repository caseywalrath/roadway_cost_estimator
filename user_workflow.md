# User Workflow

## Purpose

This document describes the intended end-user workflow for the Roadway Cost Estimator prototype.

The prototype is a project evidence browser with a browser-local Project workspace. It is not an automatic estimator, a chatbot, or a replacement for roadway engineering judgment.

The near-term user is expected to be a project manager, planner, estimator, or roadway reviewer who needs to gather and review historical project evidence for one roadway bid item.

## Current Prototype Workflow

### 1. Open the app

The user opens the static web app in a browser.

Expected current local URL:

```text
http://127.0.0.1:5173/
```

Expected future hosted URL:

```text
https://[organization-or-user].github.io/[repo-name]/
```

The first screen should show:

- fixed prototype scope bar
- prototype warning
- prototype review guide
- Explorer and Project tabs
- item search form
- project evidence browser
- Unit Price Summary panel with integrated Add to Project controls after an official item is selected
- Project workspace table for saved local line items
- source coverage note
- data notes when filters exclude relevant rows

## 2. Understand prototype scope

The user reviews the fixed scope bar before searching.

Current fixed scope:

- State: Colorado
- Default work type: Roadway

Why this matters:

- State limits the source data to the correct agency and market. Colorado is the only active state in this prototype.
- Work type defaults to roadway because this prototype is validating roadway item evidence first.
- Evidence filters are adjusted after item selection from the project evidence area.

Current prototype default:

```text
Colorado roadway public CDOT cost-book evidence
```

Evidence search context can be partial. Missing context should leave fields blank or produce data notes rather than blocking the item search. Project name, location, and notes are optional and do not block saved line items.

## 3. Enter one roadway bid item

The user enters one item at a time in the item search panel.

The current picker includes the full public CDOT 2026 item-code book for lookup. Project evidence records include public CDOT Cost Data Book rows from 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1.

The left panel is organized into two numbered steps:

1. Locate Item.
2. Select Item.

Primary inputs:

- Division
- Section / prefix
- Item code or description
- Selected item code through the item picker

Preferred input order:

1. In Locate Item, select the CDOT specification division if it helps narrow the item list.
2. Select the section / three-digit item-code prefix if it helps narrow the item list.
3. Enter item code, suffix, official item description, or abbreviated item description to narrow the loaded item list.
4. In Select Item, review the potential matching items and select the correct official item. This section remains empty until the user starts an item search.
5. Click Search.

If the item code is unknown, the user may use description text to find an official item in the picker. The evidence table requires selecting an official item code.

Best current example:

```text
Item code: 304-06007
Division: 300 - Bases
Section / prefix: 304 - Aggregate Base Course
Description: AGGREGATE BASE COURSE (CLASS 6)
Unit: CY
```

Why one item at a time:

- It keeps the first prototype easy to validate.
- It lets roadway reviewers inspect matching logic before estimate-upload workflows are added.
- It avoids giving false confidence from unvalidated bulk parsing.

## 4. Review the project evidence table

After selecting an item and reviewing evidence, the user first reviews the project evidence table.

The table includes one row per filtered project-item evidence record.

Default evidence behavior:

- exact selected item-code matches only
- public CDOT cost-book rows only
- same unit as the selected official item
- rows with awarded bid prices
- newest projects first

How to use it:

- Review project number, project/location, district, let date, contractor, bid count, quantity, unit, item description, price columns, and source.
- Treat each row as evidence to inspect, not as an app-approved comparable.
- Use the info markers to understand what each field means.

Expected reviewer question:

```text
Which project-item rows are useful evidence for this bid item?
```

## 5. Filter the evidence set

The user reviews active filter chips above the evidence table. The full filter controls are inside the inline Filters drawer.

Current evidence filters:

- Source
- Geography
- District
- Unit
- Year from
- Year to
- Quantity min
- Quantity max
- Only rows with awarded bid price

How to use it:

- Click Filters to open or close the filter drawer.
- Use filters to narrow the evidence set directly.
- Filters remove rows from the table instead of changing a hidden relevance score.
- Use Quantity min and Quantity max in the filter drawer to refine the evidence set by bid quantity.
- Enter numeric quantity values directly. Decimals are allowed when needed, and the app warns if minimum quantity exceeds maximum quantity.
- Select one or more districts from the District checkbox dropdown when district filtering is useful.
- Unit defaults to the official selected item unit.
- Unit-mismatch rows are excluded by default and counted in data notes when present.
- Click Apply filters to update the table. The drawer closes after filters are applied.
- Click Clear Filters to restore default public CDOT, selected-unit, awarded-price filters while clearing geography, district, year, and quantity filters.

## 6. Review the Unit Price Summary

The user checks the Unit Price Summary panel after reviewing table rows. Rows checked in `Exclude from Summary` stay visible in Matching Projects but are removed from the summary statistics.

The user can turn on `Inflation Adjustment` in the Unit Price Summary header to recalculate awarded bid, average bid, and engineer estimate summary statistics with loaded FHWA National Highway Construction Cost Index values. When it is on, Matching Projects awarded bid unit prices also show a second parenthetical adjusted value when the rounded adjusted dollar differs from the rounded original dollar.

Current summary fields:

- Price type
- Count
- Low
- P25
- Median
- Average
- P75
- High

Current price type rows:

- Awarded Bid
- Average Bid
- Engineer Estimate

How to use it:

- Treat the statistics as a summary of currently filtered unit prices that have not been excluded.
- Leave Inflation Adjustment off when reviewing original awarded bid dollars.
- Turn Inflation Adjustment on when a quick summary normalized to the latest loaded NHCCI quarter is useful.
- Treat parenthetical adjusted unit prices in Matching Projects as display-only context; the primary table value remains the original awarded bid unit price.
- Do not treat the summary as a suggested unit price.
- Click an available Low, P25, Median, Average, P75, or High value only when the user wants to copy that visible value into the Project unit cost field.
- Refilter the evidence table when the summary appears to be driven by rows the engineer would not use.
- Check `Exclude from Summary` for rows that should remain visible but should not affect the summary.

Reviewer interpretation:

- A narrow spread may indicate consistent historical pricing.
- A wide spread may indicate scope differences, market differences, sparse data, or outliers.
- A small count should trigger more evidence review.
- Inflation-adjusted values are an index-based review aid, not a final escalated estimate.

## 7. Add the selected item to Project

After selecting an official item and reviewing evidence, the user can save the item as a Project line from the Add Item to Project controls inside the Unit Price Summary panel.

Required line-item fields:

- Quantity
- Unit cost

Optional fields:

- Line notes
- Project name, location, and notes

How to use it:

- Select an official item and review the Matching Projects table and Unit Price Summary.
- Enter quantity and unit cost manually, or click an available Unit Price Summary value to fill the unit cost.
- Click Add to Project.
- A brief inline status message confirms that the line was added or updated.
- Add or revise the optional project name, location, and notes from the Project tab at any time.

Summary value selection behavior:

- Available Low, P25, Median, Average, P75, and High cells in the Unit Price Summary table can fill the unit cost.
- Selected summary values are rounded to the nearest hundredth when copied into the unit cost field.
- Count cells do not fill the unit cost because they are not unit prices.
- Rows checked in `Exclude from Summary` are not included in the selectable summary values or saved evidence context.
- If `Inflation Adjustment` is on, selected summary values use the visible adjusted summary values.
- Selected summary values are user-selected starting points, not recommendations.

Duplicate item behavior:

- If the same official item code already exists in the active Project, the app asks whether to add a separate line, update an existing line, or cancel.
- Separate lines are allowed so the same bid item can appear in more than one work area or alternate.

Saved evidence context:

- Current query
- Current evidence filters and sort
- Included evidence row count
- Included observation IDs
- Summary snapshot
- Inflation-adjustment state
- Manual or summary-selected cost source

## 8. Review the Project workspace

The Project tab stores one active browser-local project.

Project fields:

- Inline project name, shown as `Unnamed Project` while blank
- Inline project location, shown as `Add project location` while blank
- Compact project notes field

Project line table columns:

- Item code
- Description
- Unit cost
- Unit
- Quantity
- Total item cost
- Notes
- Remove

How to use it:

- Edit the project name and location directly in the title area. Edit Notes in the adjacent compact field; all three values autosave and may be cleared.
- Edit unit cost, quantity, and notes directly in the table.
- Remove lines that should not remain in the project, then confirm the removal prompt.
- Review the line count and total project cost.
- Treat the Project workspace as local browser storage. Clearing browser data can remove saved projects.
- If local storage is unavailable or malformed, the app shows a recoverable warning and keeps the evidence browser usable.

## 9. Review source projects

The Explorer keeps source-project records outside the main item-evidence layout. A subdued `Source review` text link appears below the results panels for both Colorado and Iowa.

How to use it:

- Click `Source review` to open the state-specific source-project list.
- Review the project title, source label, and source-item count without loading bidder-level prices.
- Click `Review` on a project to load and inspect its source items and bidder unit prices in a full-width detail screen.
- Use `Back to source list` to select another project or `Back to Explorer` to return without clearing the current item, filters, sorting, or exclusions.
- Switch states only when source review for the current state is complete; state switching starts a new Explorer session for the selected state.

Source Review is not a separate browser page and does not combine Colorado and Iowa records.

## 10. Review source coverage

The user reviews the Source Coverage panel after an item is selected.

Current source coverage states:

- loaded evidence source: public CDOT Cost Data Books
- loaded periods: 2022 Q4, 2023 Q4, 2024 Q4, 2025 Q4, and 2026 Q1
- default matching: exact official item-code matching only
- optional inflation adjustment: summary statistics and display-only row context, using loaded FHWA NHCCI quarters
- not included: private FHU data, demo project evidence, unit conversion, or a final price recommendation

How to use it:

- Treat source coverage as the boundary of what the app can show.
- Use the Matching Projects table and CSV export for review, not as a final estimating recommendation.
- Final pricing judgment happens outside the app.

## 11. Export CSV files

The user can download the currently filtered and sorted Matching Projects rows as a CSV after selecting an official item code.

Matching Projects export:

- Click Download CSV above the Matching Projects table.
- The export includes all displayed table columns plus project/source metadata.
- Rows checked in `Exclude from Summary` are omitted from the export.
- Inflation Adjustment does not change CSV values; the export remains original-dollar project evidence.
- The button is disabled when current filters produce zero rows or all current rows are excluded from summary.
- Use the CSV for reviewer discussion, basis-of-estimate support, or external analysis.

Project export:

- Open the Project tab.
- Click Export CSV.
- The export includes one row per saved project line.
- Total item cost is calculated from quantity times unit cost.
- Exported rows include project name, project location, project notes, item details, line notes, evidence row count, included observation IDs, and timestamps.
- The Project CSV button is disabled when the Project has no line items.
- XLSX export and project import are deferred.

## 12. Review data notes

Data notes may identify:

- unit mismatch
- no rows matching current filters
- missing awarded bid prices
- weak or incomplete evidence conditions

How to use it:

- Data notes should trigger review, not automatic rejection.
- Data notes explain why the table may not contain the expected evidence rows.

Expected roadway reviewer feedback:

- "This item mapping is correct."
- "This item mapping is too broad."
- "This source should be excluded."
- "This record is useful evidence but needs an adjustment."
- "This row should be excluded in a later manual review set."

## Roadway Engineer Review Workflow

For early feedback sessions, the project manager should use the prototype as a structured review aid.

Recommended meeting flow:

1. Open the app.
2. Explain that the default evidence source is public CDOT cost-book data only.
3. Pick one familiar roadway item.
4. Use the left-panel steps to find an item, select the official item, enter quantity, and review evidence.
5. Review the project evidence table.
6. Apply source, geography, district, year, unit, and quantity filters when relevant.
7. Review the Unit Price Summary after reviewing rows.
8. Open Source Review when source-project or bidder-price inspection is needed.
9. Review source coverage and data notes.
10. Add one reviewed item to Project when a unit cost is selected.
11. Open the Project tab and review the saved line.
12. Export the CSV if external review is needed.
13. Ask which rows are useful evidence and which rows should be excluded later.
14. Ask which filters or fields are missing.
15. Ask what source data should be added first.
15. Record feedback as implementation notes for the coding agent.

Key questions for roadway engineers:

- Which item families should be tested first?
- Which CDOT item codes are good early validation targets?
- Which records should be considered useful evidence?
- Which records should be excluded?
- Which units should never be compared without conversion?
- Which source data is trusted?
- Which source data is useful but lower trust?
- What should the tool say when data is weak?

## Intended Later Workflow

The current prototype supports one-item lookup and one active browser-local Project assembled one item at a time.

The intended later workflow is:

1. User creates or opens an estimate workspace.
2. User enters or imports multiple estimate line items.
3. App gathers exact-code evidence for each line.
4. App flags missing evidence, unit-mismatch rows, or sparse awarded-bid rows.
5. User reviews one item at a time.
6. User selects or rejects evidence records.
7. User records override notes.
8. User exports an estimate support table or basis-of-estimate notes.

Later outputs may include:

- CSV export
- Excel-compatible table
- basis-of-estimate notes
- review dashboard
- estimate checker
- calibration against bid results

## Data Source Workflow

Additional source data should be added only after the current public CDOT evidence browser remains valid under data-package checks and reviewer smoke tests.

Preferred source order:

1. Public CDOT item code books.
2. Public CDOT cost books.
3. Public CDOT bid tabs or awarded project records.
4. Reviewed FHU historical estimates.
5. Reviewed FHU bid tabs or post-award data.

Data governance rule:

Private FHU data should not be committed to a public GitHub Pages repository.

Possible private-data workflows:

- user uploads local files in the browser
- private repository and private Pages configuration
- internal hosting
- later authenticated database

## Success Criteria

The current prototype is successful if a reviewer can answer:

```text
For this roadway bid item, which project records contain useful evidence, what do the awarded bid prices show, and what rows should I review or exclude?
```

The prototype is not expected to:

- estimate a full project automatically
- replace roadway estimator judgment
- parse arbitrary spreadsheets
- use private data safely without a private-data workflow
- produce final engineer-approved unit prices

## Feedback Capture

User and engineer feedback should be translated into concrete development tasks.

Useful feedback format:

```text
Item reviewed:
Search inputs:
What looked correct:
What looked wrong:
Missing source data:
Recommended rule change:
Recommended UI change:
Reviewer confidence:
```

This keeps feedback specific enough for a coding agent to implement in later iterations.
