# Excel Project Import UX Redesign Plan

Status: complete.

Prepared: 2026-09-09.

## Objective

Keep the existing five-step import process and parsing capabilities while making the normal path understandable without knowledge of workbook ranges, catalog identity, parser classifications, or database commits.

The normal experience should be:

1. Choose a workbook.
2. Confirm the detected worksheet and item table.
3. Confirm six familiar Project columns.
4. Resolve only the rows that need a decision.
5. Confirm and import the items.

Advanced controls remain available for irregular workbooks, but they should not compete with the primary action.

## Design Principles

- Lead each step with one decision and one primary button.
- Use the same Back and Next placement throughout the wizard.
- Show spreadsheet terms on the source side and Project terms on the destination side.
- Keep internal terms such as `catalog`, parser classification, draft, and commit out of user-facing copy.
- Automatically select high-confidence worksheet, range, headers, and column matches.
- Show a small data preview wherever the user is confirming detection or mapping.
- Use progressive disclosure for manual ranges, hidden rows, source totals, group rules, and cost-category rules.
- Do not require review of rows that already have an exact, conflict-free match.
- Present each problem with only the actions that can resolve that problem.
- State the effect of the final action in concrete Project language.

## Proposed Five-Step Flow

| Step | User-facing name | Primary decision | Primary action |
|---|---|---|---|
| 1 | Choose file | Which workbook and Project should receive the items? | `Next: Choose data` |
| 2 | Choose data | Which worksheet and detected item table should be used? | `Next: Match columns` |
| 3 | Match columns | Do the detected spreadsheet columns map correctly? | `Next: Review items` |
| 4 | Review items | How should unmatched or conflicting rows be handled? | `Next: Confirm import` |
| 5 | Confirm import | Is the summarized import correct? | `Import [count] items` |

Completed steps may be opened from the step indicator. Future steps remain disabled. The bottom action bar is consistent on every screen: Back on the left and the primary action on the right.

## Step 1: Choose File

### Primary layout

- Place a large file-choice area first, with `Choose Excel file` as the visible button.
- Support drag and drop if it can be implemented without complicating keyboard access.
- After selection, replace the empty state with the workbook name, size, and read status.
- Keep the Next button disabled until workbook reading succeeds.

### Destination

- When launched from an active Project, default to `Add items to [Project name]`.
- Offer `Create a new Project` as a compact secondary choice that reveals one Project-name field.
- Remove the `Catalog destination` fieldset.
- Show the matching context as plain read-only text: `Item codes will be checked against Colorado items.`
- Use normal-size native radio controls aligned with their labels.

### Empty-state behavior

Do not show worksheet terminology before a workbook is selected. The only emphasized action should be `Choose Excel file`.

## Step 2: Choose Data

### Default view

- Automatically select the highest-confidence visible worksheet and item region.
- Show the worksheet selector, detected table summary, and a spreadsheet-style preview together.
- Label the selection in plain language, for example: `Detected 133 item rows in B11:H143`.
- If there is one strong detection, do not render a radio button for a single choice.
- If there are multiple credible regions, show them as compact selectable cards with row counts and header samples.

### Manual correction

- Replace `Primary range` and `Apply range` with a collapsed `Change data range` control.
- Inside the expanded control, label the inputs `First cell` and `Last cell` and use `Use this range` as the action.
- Keep the preview updated after the range is accepted and explain validation errors next to the inputs.
- Put `Include hidden rows` under the same advanced area and show it only when hidden rows exist.

### Sections and alternatives

- Show detected section headings as a simple included list beneath the data preview.
- Include ordinary sections by default.
- If mutually exclusive alternatives are detected, present them as a clearly labeled choice such as `Choose one pavement alternative`, using radio buttons rather than independent checkboxes.
- Do not display raw boolean values such as `true`.

## Step 3: Match Columns

### Primary fields

Show these Project fields in this order:

1. Item Code
2. Description
3. Unit
4. Quantity
5. Unit Cost
6. Notes

Use a row-oriented mapping table:

| Project field | Spreadsheet column | Example values | Status |
|---|---|---|---|
| Item Code | Item No. | 202-00010, 202-00020 | Matched |
| Description | Description | Removal of Tree | Matched |

Automatic mappings should be selected before the screen opens. Each spreadsheet column option should show its column letter and detected header. `Do not import` remains available for optional fields.

Either Item Code or Description must be mapped. Description, Unit, Quantity, and Unit Cost should be strongly recommended and visibly flagged when absent, but incomplete cost data may continue to the review step.

### Advanced mappings

Move the following controls under `Advanced import settings`:

- Spreadsheet total, renamed `Extended cost (comparison only)`.
- Project Group behavior, defaulting to `Use detected section headings as groups`.
- Cost category behavior, defaulting to `Assign imported items to Construction Costs`.
- Header-row override.

Remove the phrases `Group source` and `Cost category source`. The controls should describe the outcome rather than the parser source.

## Step 4: Review Items

### Review strategy

- If any rows need a decision, open on `Needs attention`.
- If all rows are ready, open on `All items` and state that no decisions are required.
- Use summary cards for `Ready to import`, `Needs attention`, and `Skipped`.
- Use a neutral table background. Reserve amber for a specific warning and red for a row that cannot be imported.
- Rename `Classification` to `Match`.
- Translate internal statuses into user-facing text:
  - `Matched to Colorado item`
  - `No exact match — import as custom item`
  - `Description differs — choose which to use`
  - `Unit differs — choose which to use`
  - `Missing required information`
  - `Skipped`

### Contextual decisions

Do not use one universal dropdown containing every internal action. Render only relevant choices:

| Situation | Choices shown |
|---|---|
| Exact match | No choice; show `Ready` |
| Description differs | `Use official description`, `Keep spreadsheet description as custom item`, `Skip row` |
| Unit differs | `Use official unit`, `Keep spreadsheet unit as custom item`, `Skip row` |
| No exact match | `Import as custom item`, `Skip row` |
| Incomplete row | `Import incomplete item`, `Skip row` |
| Fixed allowance | `Import as allowance`, `Skip row` |

For conflicts, show spreadsheet and official values side by side inside the row or an expandable detail panel. Preserve internal decision codes in the controller; only the presentation and copy change.

### Navigation

- Rename pagination controls to `Previous 50` and `Next 50` and keep them directly beside `Page X of Y`.
- Place pagination above or immediately below the table, separated from the wizard action bar.
- Use `Back: Match columns` and `Next: Confirm import` in the wizard action bar.
- Disable the primary action until every required decision is resolved, with a message such as `Resolve 4 items to continue`.

## Step 5: Confirm and Import

### Before import

Replace the current result/commit language with a concrete confirmation summary:

> 124 items will be added to OPCC Test Project. 9 spreadsheet rows will be skipped. Existing Project items will remain in place.

Show:

- Destination Project.
- Number of items to add.
- Number of rows skipped and why.
- Imported construction-cost subtotal.
- Imported other-cost subtotal, when present.
- Spreadsheet-total difference, when a source total was mapped and can be compared.

Actions:

- `Back: Review items`
- `Download issue report`
- `Import [count] items`

Remove `Commit import`, `Close preview`, and the explanation that no data is written during preview. The absence of an import until the final action should be communicated by the button and confirmation summary.

### After import

Keep the user in step 5 and replace the confirmation with:

> 124 items were added to OPCC Test Project.

Provide `Open Project` as the primary action and `Download import report` as the secondary action. On failure, preserve the prepared import and show `Try import again` with a specific error message.

## Terminology Changes

| Current text | Replacement |
|---|---|
| Catalog destination | Remove; show `checked against [State] items` |
| Catalog | Official item or state item, depending on context |
| Primary data area | Detected item table |
| Apply range | Use this range |
| Group source | Project groups |
| Cost category source | Cost category |
| Classification | Match |
| Use catalog | Use official item |
| Keep as custom | Import as custom item |
| Prepare import result | Next: Confirm import |
| Commit import | Import [count] items |
| Download report | Download issue report / Download import report |
| Close preview | Cancel before import; Close after import |

## Technical Approach

The parser, matching rules, provenance, and atomic persistence model should remain intact. The redesign primarily changes presentation and introduces a clearer view model over existing internal states.

### `src/ui/renderExcelImport.ts`

- Replace the current fieldset grids with the five screen layouts above.
- Add data-preview rendering for worksheet/range and mapping examples.
- Add user-facing status and action-label adapters.
- Render contextual row decisions instead of the universal action dropdown.
- Separate review pagination from wizard navigation.
- Split step 5 into confirmation, importing, success, and failure presentations while retaining one step number.

### `src/ui/excelImportController.ts`

- Preserve existing worker cancellation, invalidation, conflict detection, and retry behavior.
- Add derived detection-confidence and screen-summary state.
- Auto-select a single strong region and ordinary sections.
- Track unresolved required decisions explicitly.
- Support navigation to completed steps without losing later work unless a changed input invalidates it.
- Translate contextual UI choices back to the existing internal decision actions.

### `src/styles.css`

- Replace broad `fieldset`, `label`, and `input` rules with component-specific classes.
- Constrain native checkbox and radio sizes so the generic full-width input rules cannot enlarge them.
- Add a worksheet preview grid, compact selection cards, mapping rows, summary cards, conflict comparison, and sticky action bar.
- Keep controls usable at narrow widths without stacking unrelated navigation actions into one visual column.

### Tests

- Update render tests to assert user-facing text and the absence of internal terminology.
- Test that Step 1 emphasizes file choice and exposes no worksheet action before a file is ready.
- Test single-region automatic selection and multiple-region choice cards.
- Test the six-field primary mapping view and advanced settings disclosure.
- Test every contextual conflict action.
- Test unresolved-decision blocking and the `Resolve N items to continue` message.
- Test pagination labels independently from wizard navigation.
- Test confirmation, importing, success, failure, and retry states.
- Retain existing controller tests for stale worker responses, double submission, storage conflict, and atomic writes.

## Implementation Phases

### Phase 1 — Information architecture and shared components

- Introduce user-facing labels, shared step actions, compact form controls, and status summaries.
- Redesign Step 1 and the step indicator.
- Verify keyboard order, disabled states, and narrow-width layout.

Pause for review after this phase.

### Phase 2 — Data selection and preview

- Redesign Step 2 around automatic selection and a worksheet preview.
- Move manual range and hidden-row controls into progressive disclosure.
- Present normal sections and mutually exclusive alternatives distinctly.

Completed 2026-09-09. The controller now prefers the highest-confidence visible worksheet, Step 1 waits for its explicit Next action after reading, and Step 2 presents a bounded data preview with Change data range and hidden-row controls in a disclosure. Supplied-workbook inspection confirmed the expected source layouts: OPCC's `Estimate` worksheet, the six visible 132nd/Giles Concept worksheets, and Ida Street's primary `Ida Street Imp` worksheet alongside its secondary `Sheet1`.

Pause for review with the OPCC, 132nd and Giles, and Ida Street workbooks.

### Phase 3 — Column mapping

- Implement the six-field mapping table with example values and mapping status.
- Move extended cost, Project group, cost category, and header overrides into advanced settings.
- Validate required/recommended mappings in plain language.

Completed 2026-09-09. Match columns now presents only Item Code, Description, Unit, Quantity, Unit Cost, and Notes in a row-oriented table with automatic selections, example values, and required/recommended status. Extended cost, Project group behavior, cost-category behavior, and header override are under Advanced import settings. The importer defaults all rows to Construction Costs and treats an unlabeled leading column as Description when adjacent estimate headers identify units, quantity, unit price, or total. Header inspection confirmed that OPCC provides all seven expected headings, while the 132nd/Giles and Ida Street layouts use an unlabeled description column followed by Units, Qty, Unit Price, and Total.

Pause for review after mapping all three reference workbooks.

### Phase 4 — Issue-focused row review

- Add user-facing match statuses and contextual decisions.
- Default to unresolved rows and simplify resolved rows.
- Separate pagination from wizard navigation.

Completed 2026-09-09. Review now opens on Needs attention whenever a selected row needs a choice, otherwise on All items. Summary cards switch between Ready to import, Needs attention, Skipped, and all rows. The table replaces raw match states and Classification with a Match column that uses user-facing text. Description and unit conflicts show the spreadsheet and official values side by side, while each row shows only its relevant choices: official or spreadsheet custom values, custom import, incomplete import, allowance import, or skip. Ready matches do not present a decision. The wizard cannot proceed until required choices are made. Pagination is labeled Previous 50 and Next 50, apart from the wizard action bar.

Pause for review using cases for exact match, description conflict, unit conflict, unmatched custom item, allowance, incomplete row, and excluded row.

### Phase 5 — Confirmation and completion

- Replace result/commit copy with a before-import confirmation and after-import success state.
- Add concrete item counts, Project destination, cost summaries, skip reasons, and source-total comparison.
- Preserve retry and diagnostics behavior with clearer actions.

Completed 2026-09-09. The confirmation names the destination Project, the exact item count, and the number of spreadsheet rows that will be skipped while stating that existing Project items remain in place. It shows Construction Costs, Other Costs when present, a comparison of recalculated and spreadsheet extended costs, and grouped skip reasons with a downloadable issue report for row details. The final action says `Import [count] items`. A successful import states exactly how many items were added to the named Project. A failed import states that no items were added and offers a clear retry action.

Pause for review after successful and failed-import scenarios.

### Phase 6 — Final validation and documentation

- Run TypeScript, focused UI tests, the full web suite, and a production build.
- Perform visual checks at desktop and narrow widths.
- Re-run acceptance checks against all three supplied workbooks.
- Update `user_workflow.md`, `docs/implementation_notes.md`, and `architecture_overview.md` to match the final interface.

Completed 2026-09-09. TypeScript, the focused Excel-import UI tests, the full web suite, and the production build passed. The current static bundle was visually checked at desktop width; the narrow-width rules were source-reviewed because the in-app browser did not expose a viewport-resize control. The supplied OPCC Template, 132nd and Giles, and Ida Street workbooks were reopened with the same SheetJS reader used by the importer; their worksheet variants, repeated estimate headers, and working columns remained available for the detected-table and manual-range workflow. The user workflow, implementation notes, and architecture overview describe the final five-step interface.

## Acceptance Criteria

- A first-time user can move through the OPCC Template import without seeing or understanding `catalog`, `classification`, `source`, `draft`, or `commit` terminology.
- Every step has one visually dominant primary action and consistent Back/Next placement.
- A single detected data area does not appear as a lone unexplained radio button.
- Standard checkboxes and radio buttons render at normal control size and align with their labels.
- The primary mapping screen contains only Item Code, Description, Unit, Quantity, Unit Cost, and Notes.
- Group, cost category, extended cost, header override, hidden rows, and manual range remain available without crowding the normal path.
- Review initially focuses on rows requiring action and offers no irrelevant decisions.
- Table pagination cannot be mistaken for wizard progression.
- The final button says exactly what will be imported and the success state says exactly what was added.
- OPCC Template remains a mostly automatic import.
- 132nd and Giles preserves its Grading, Pavement, Signal/Striping/Traffic, and Right of Way group structure without importing working cells to the right.
- Ida Street requires an explicit choice when alternative surfacing sections conflict and preserves the chosen section grouping.
- Existing matching behavior, Project cost categories, provenance, atomic writes, conflict handling, retry, and downloadable diagnostics remain intact.

## Product References

- [Airtable CSV import](https://support.airtable.com/articles/3067164948-csv-import-extension): automatically matches same-name headers, permits manual remapping, and lets users omit fields.
- [HubSpot import mapping](https://knowledge.hubspot.com/import-and-export/understand-the-import-tool): pairs each source column with preview values, mapping status, and a destination property.
- [HubSpot import error review](https://knowledge.hubspot.com/import-and-export/troubleshoot-import-errors): ties errors to affected columns and rows and offers corrections in context.
- [monday.com Excel import](https://support.monday.com/hc/en-us/articles/360000219209-Import-files-from-Excel): supports mapping directly from column headers and clearly labels columns that will not be imported.
- [Asana advanced CSV import](https://help.asana.com/s/article/advanced-csv-import-options): starts from an automatic preview and places mapping changes behind a deliberate edit path.
- [Microsoft Power Query import](https://support.microsoft.com/en-us/Excel/import-data-from-data-sources-power-query): combines source selection with a data preview before transformation or loading.
