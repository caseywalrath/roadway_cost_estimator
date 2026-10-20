# Planning and engineering quality-of-life roadmap

**Status:** planning draft, 2026-10-16. No application behavior is changed by this document.

**Baseline:** `claude/planning-v2` at `ca68555`, after fetching and fast-forwarding the clean local checkout. Work on this roadmap is isolated on `codex/planning-engineering-qol-plan`.

This roadmap organizes the 13 requests in the order in which they can be specified and implemented safely. The request numbers below refer to the original user list.

## Current behavior that affects the plan

- **Project to Explorer (#1):** A Project item-code link opens a fresh exact-item Explorer query. It deliberately clears Explorer filters, sorting, exclusions, and inflation adjustment, and does not carry the Project line's Group, Unit Cost, Quantity, or Notes. See `createFreshCatalogExplorerQuery` and the Project link handler in `src/ui/renderApp.ts`.
- **Adjacent items (#2):** There is no previous/next control. The item picker sorts by code; selecting one item collapses the picker. Evidence filters can depend on the selected item's unit, so carrying them to another item can hide its evidence.
- **Unit Cost (#3):** The Project table renders a plain numeric input. Its parser does not accept a typed `$`. The current input width is 76 px in `src/styles.css`.
- **Excel reimport (#4):** Each imported line already stores file, sheet, row, original values, and a per-import ID. Existing Project lines can be matched and added, updated, or skipped, but that decision appears at **Confirm import** and defaults to **Add as separate items**. Quantity differences do not automatically enter **Review items**. The per-import ID does not identify later versions of the same workbook. See `src/projects/excelImport/existingItems.ts` and `src/projects/projectWorkspace.ts`.
- **JSON import (#5):** Project backups use a three-step comparison wizard for same-ID or explicitly selected different-ID destination Projects, or import a complete new Project copy. Planning share JSON still creates an independent copy. See `src/projects/backupImport/compare.ts`, `src/ui/renderProjectBackupImport.ts`, and `src/planning/shareFile.ts`.
- **Explorer numeric filters (#6):** Text inputs already wait 300 ms after typing before applying evidence filters; blur and Enter apply immediately. See `src/ui/renderApp.ts`.
- **Exports (#7):** The Project CSV has 25 line columns, Matching Projects CSV has 30, Nebraska price history CSV has 18, Planning CSV has 11, and the Excel import report has 28. Several columns expose internal IDs, timestamps, or import diagnostics. Planning's CSV also contains pay-item calculation detail. JSON backup/share files are recovery formats and must retain their internal fields.
- **Import status report (#8):** The current issue CSV includes all resolved source rows and 28 diagnostic fields. Before the final save, it is a preview; after a successful save, it can describe actual imported and skipped items. See `src/ui/excelImportReport.ts`.
- **Median column (#9):** The Explorer Unit Price Summary presents Median with the same background as the other statistics. The requested shading is a visual-only change in `src/ui/renderResults.ts` and `src/styles.css`.
- **Inflation (#10):** Explorer adjusts available row prices from each source quarter to the latest loaded FHWA NHCCI quarter. A missing source-quarter index leaves that row unadjusted. The Matching Projects table only displays the parenthesized adjusted row price when its rounded whole-dollar value differs from the original; an adjustment can therefore occur without a visible second line. The user-provided screenshot comparison is deferred until implementation planning. See `src/matching/inflationAdjustment.ts` and `src/ui/renderResults.ts`.
- **Planning templates (#11):** Colorado currently has six templates: Mill and overlay, Full reconstruction, Complete street, Sidewalk gap, Multi-use path, and Intersection safety. The library has four base treatments, including No base treatment. See `data/planning/co_element_library.json`.
- **Actions wording (#12):** Project Actions uses **Import from Excel**, **Import Project Backup**, **Download Project CSV**, and **Download Project Backup**. Planning Actions uses **Import Planning Backup**, **Download Planning CSV**, and **Download Planning Backup**. The Planning print action was removed.
- **Percentage costs (#13):** Project schema v10 stores fixed `quantity × unit cost` lines plus one Project-wide contingency percentage applied to Construction and Other Costs. Planning has a separate rate model: contingency applies to construction, while design and construction engineering apply to construction plus contingency. The current Planning-to-Project handoff compensates for this difference to preserve the total. See `src/projects/projectWorkspace.ts`, `src/planning/calculate.ts`, and `src/planning/toProject.ts`.

## Sorted backlog

| Order | Requests | Workstream | Size | Reason for position |
| --- | --- | --- | --- | --- |
| 1 | #3, #6, #9, #12 | Small interface changes | Small | Localized controls, formatting, and terminology; no saved-data migration. |
| 2 | #10 | Inflation explanation and audit | Small if calculations are correct | Cost interpretation needs evidence before copy or display changes. Screenshot review is deferred. |
| 3 | #1, then #2 | Project-to-Explorer context and item navigation | Medium | Navigation must define what happens to Project values and filters when the selected item changes. |
| 4 | #8, then #7 | Human-readable reports and exports | Medium | The report can be simplified first; each CSV needs a reviewed visible-column contract. |
| 5 | #4 | Revised Excel workbook reconciliation | Large | Requires source identity, field-level conflict rules, and a Review items integration. |
| 6 | #5 | Project backup JSON comparison | Large | Requires a safe line-level merge model; Planning share-file comparison can follow separately. |
| 7 | #13 | Percentage-based Project lines | Large | Changes the Project schema, cost model, summaries, backup, import/export, and Planning handoff. |
| 8 | #11 | Roundabout and Interstate Planning templates | Discovery first | Inputs, components, price calibration, and the intended project scope are not yet defined. |

This order reflects implementation dependencies. The complex workstreams can be specified while the smaller phases are implemented.

## Detailed implementation plans

| Plan | Work packages | Implementation state |
| --- | --- | --- |
| [Explorer and Project interface](planning-engineering-qol-interface-plan.md) | UI-A #3/#6/#9/#12; UI-B #1; UI-C #2; UI-D #10 | Implemented on `codex/explorer-interface-qol`; the supplied inflation examples were audited. |
| [File workflows](planning-engineering-qol-file-workflows-plan.md) | File-A #8; File-B #7; File-C #4; File-D #5 | File-A through File-D are implemented for Project files. Planning share JSON comparison remains separate. |
| [Cost model and Planning templates](planning-engineering-qol-cost-planning-plan.md) | Cost-A #13; Planning-B #11 | Cost-A is implemented on `codex/percentage-project-items`; Planning-B needs a first scope and representative estimates for each template. |

The Sol orchestrator owns shared state, schema, persistence, integration, and final verification. Assign Luna bounded inventory, isolated file edits, or focused verification with exclusive file ownership under `docs/agent_delegation_policy.md`. Implement UI-A, UI-B, and UI-C in that order because their UI files overlap. File-A and CSV sample preparation can proceed independently. Coordinate #5 and #13 because backup comparison must recognize the Project schema version that exists when it ships. The Planning template discovery can proceed alongside these packages.

## Phased implementation plan: defined work

### Phase 1 — Small interface improvements (#3, #6, #9, #12)

1. **Project Unit Cost:** Show one visual `$` prefix for a valid Unit Cost, accept either `500` or `$500` when pasted or entered, and store the same numeric value. Do not insert characters while the engineer is typing. Widen the Unit Cost input by about three character widths and reclaim space from a less constrained Project table column after checking desktop and narrow layouts.
2. **Explorer numeric filters:** Increase the delay for manually typed quantity and price fields only, tentatively to 700 ms. Keep Enter and blur as immediate commit actions. Check that typing `500` at an ordinary pace does not run a `50` query, and that an intentional pause or blur behaves predictably. A delay reduces premature searches but cannot guarantee that a very slow entry never searches a partial value; a commit-on-Enter/blur design is the fallback if the delay remains disruptive.
3. **Median column shading (#9):** Add a restrained background to the Median header and cells in the Explorer Unit Price Summary. Keep number formatting and table semantics unchanged, and check contrast and narrow layout.
4. **Actions labels:** Use file-purpose labels such as **Download Project Backup** / **Import Project Backup** and **Download Planning Backup** / **Import Planning Backup**. Keep `.json` in the relevant import file picker, not repeated as menu helper text. Preserve a clear distinction between a recovery file and a CSV report.

**Gate:** Confirm each control's before/after behavior in a desktop and narrow view. Use the repository's UI verification rules in `codex.md` when these changes are implemented.

### Phase 2 — Explorer context and price clarity (#10, #1, #2)

1. **Inflation audit (#10):** Use the deferred example screenshots when available. For each example, compare the project's source date, source and target NHCCI quarters, raw price, calculated adjusted price, and displayed rounded price. If the formula or source-date choice is wrong, specify the correction before changing copy. If the calculation is correct, add a short per-row explanation or tooltip distinguishing **adjusted**, **same displayed dollar after rounding**, and **not adjusted because index data is missing**. Keep the existing summary note brief.
2. **Project-origin values (#1):** Carry a temporary source Project ID and line-item ID when opening Explorer from a Project line. Read the current stored line and prefill Group, Unit Cost, Quantity, and Notes; preserve genuinely blank fields. The primary action is **Update Item** and saves to that same Project line. An explicit **Add as separate item** action may be offered when duplication is intended. Clear the source context and prefilled values if the engineer selects a different item or Project.
3. **Adjacent item controls (#2):** Place Previous/Next beside the selected Item and Item code summary. Use the loaded state's official item catalog, sorted by item code with stable agency/item identity as the tie-breaker. Cross division or section boundaries within the same state and agency. Disable at either end. On each move, reset item-specific evidence filters, sorting, exclusions, and Project-origin form values; keep the inflation toggle if the engineer deliberately enabled it. Do not silently carry a Unit filter from the previous item. State the reset behavior near the controls if needed.

**Gate:** Verify navigation from a Project line, navigation across a catalog section boundary, an adjacent item with a different unit, and a return to the original item. Confirm that no Project line is created or overwritten until an explicit save action.

### Phase 3 — Reports and exports (#8, #7)

1. **Import status report (#8):** Produce a concise human-facing report with **Imported/Updated** and **Not imported** outcomes, item code and description, sheet and row, quantity and unit cost where useful, and one plain-language reason for an omission. Omit blank rows and ordinary headings from the item list; summarize their counts if useful. Before the save, label the download as a *review preview*. After a successful save, label it an *import status report*. Retain the detailed diagnostics in the review UI or an optional detailed report if real troubleshooting requires them.
2. **CSV cleanup (#7):** Review the Project, Matching Projects, Nebraska price history, and Planning CSVs against what engineers see on those screens. Make a proposed column list and sample file for each before deleting fields. Project CSV should put Project facts once in a small header or summary and keep the visible line columns; Matching Projects and price history should follow their visible tables. Make the default Planning CSV concise; retain a separate calculation-detail export only if an engineer identifies a concrete use. Keep JSON recovery files lossless. User-facing exports should favor simpler data.

**Gate:** Review sample outputs with an engineer or the user before finalizing column removals. Treat removed CSV columns as a format change for any existing spreadsheet workflow. Preserve CSV formula-injection protection and compare exported totals with the screen.

## Design work before implementation

### Revised Excel workbook reconciliation (#4)

**Current implementation:** Step 4 compares incoming items with active Project lines and presents Add, Update, and Skip in one review list. The Issue type selector separates changed, unchanged, and ambiguous Project matches. Previous-source linking and source baselines were removed. The original proposal below is retained as design history.

**Recommended flow:** Recognize a likely previous source using its stored filename, sheet/range structure, and item identities; use a content hash to detect an identical file, but do not treat filename or hash alone as proof of lineage. Offer the engineer an explicit link to the prior import when similarity is uncertain. Persist a stable source identifier and the last imported source values on each affected line.

Compare three values per field: **previous spreadsheet value**, **current Project value**, and **new spreadsheet value**. Preserve an app edit when the spreadsheet did not change. For fields other than quantity, apply a spreadsheet change automatically only when the app still has the previous imported value and the change is unambiguous. Send every matched item with a different **quantity** to Step 4, **Review items**, with explicit choices **Use spreadsheet**, **Keep Project**, and **Add as separate item**. Show unit-cost conflicts there as well, and offer an explicit skip. A blank spreadsheet cell must not erase an app value by accident.

Reuse the existing item identity matcher, duplicate-target checks, atomic save, revision check, and pre-import recovery snapshot. Define how matching works when Group or cost category changed, when two rows share one item code, and when a revised file reorders rows. Keep Step 5 focused on final counts and totals.

**Open decisions:** What is sufficient evidence that two workbooks are versions of one source? Should a changed quantity always require an individual choice, or may an engineer apply one choice to several reviewed rows? Should source rows removed from the new workbook prompt a deletion proposal, or remain untouched in the first release? The conservative first release leaves removed rows untouched.

### JSON backup comparison and collaboration (#5)

**Implemented scope:** Project backup JSON is validated before a three-step wizard compares Project details and lines. Exact line IDs pair automatically; different IDs may receive an explicit same-item pairing. Review groups **Added**, **Removed**, **Changed**, **Unchanged**, and **Unpaired** lines. Changed lines show both values and offer Keep Project, Use Backup, or Duplicate. New lines can be added; missing lines can be deleted explicitly. Accepted changes save atomically with a revision check and recovery snapshot. A different Project ID defaults to importing a copy and requires an explicit destination selection for a merge.

The current backup does not contain a shared base snapshot, so a two-file comparison cannot reliably determine which person changed a field first. Do not promise automatic three-way merging until a common ancestor or source history is stored. Treat deletion as an explicit choice, never an automatic effect of a missing line.

**Planning follow-on:** Planning JSON currently always creates a copy and has a separate schema and alternative IDs. Consider its own comparison workflow after the Project backup workflow. Planning alternatives and engineer Project lines require different merge rules.

### Percentage-based Project items (#13)

**Recommended user model:** A custom line has either a fixed amount or a percentage rate. For a percentage line, offer five base choices: **All fixed costs**, **Construction fixed costs**, **Other fixed costs**, **One existing Group**, and, under an advanced control, **Selected lines**. Show the calculated base and resulting amount next to the rate. Label only lines explicitly marked as a **contingency** as contingencies; other percentage lines may represent allowances, engineering, or fees.

Calculate percentage bases from fixed lines only. Percentage lines cannot depend on other percentage lines, including through a Group or selected-line base. Validate this rule when editing and importing. A Group base sums only its fixed lines. Store selected-line references by stable line-item ID, not row position or display name. This rule prevents recursion without a dependency graph.

The top summary should show **Contingencies** as the sum of lines marked contingency. Construction and Other subtotals should exclude those contingency lines so the displayed total does not count them twice; other percentage lines belong to their chosen cost category. Migration must convert the existing global contingency percentage into a line based on the same Construction-plus-Other base so saved totals do not change, then remove the global edit control. Update Project JSON, CSV, revision snapshots, duplicate/import validation, and the Planning-to-Project handoff together. Planning's independent rate model can remain as it is initially; its handoff must still match the Planning total within $1 and make fixed versus recalculating amounts clear.

**Open decisions:** Is a fixed-dollar contingency also allowed? Should deletion of a fixed line used as a selected-line base be blocked, drop the reference with a warning, or require reassignment? Should Planning-generated engineering costs become live percentages in the Project, or remain a one-time handoff snapshot? The first release should keep them as snapshots unless live recalculation is explicitly required.

### Roundabout and Interstate Planning templates (#11)

Treat these as two separate template specifications, not just two new names in the selector. For **roundabouts**, define at least approach count, one versus multiple circulating lanes, pavement/curb treatment, pedestrian crossings, and whether right-of-way or utilities are included. For **Interstate**, define whether the target is resurfacing, widening, new alignment, or interchange work; lane miles, shoulders, median/barrier, bridges, drainage, and traffic-control assumptions may differ substantially. Check which components can use supported Colorado bid-price items and which need calibrated assemblies. Record assumptions and example totals before changing the library.

**Open decisions:** Which first use case should each template serve, and what reference projects or engineer estimates should anchor calibration? Is Interstate Colorado-only for now? Should a roundabout be a standalone spot template, an element usable in corridor alternatives, or both?

## Decisions confirmed 2026-10-16

1. **#1:** Opening Explorer from a Project line uses an **Update Item** button for that line.
2. **#2:** Adjacent-item navigation crosses divisions in catalog-code order, resets item-specific filters and Project-origin values, and retains the inflation toggle.
3. **#7:** User-facing exports favor simpler data. JSON backups retain the full data needed for recovery; detailed calculation exports need a demonstrated use.
4. **#5:** Build Project backup comparison first. Planning share-file comparison is a separate follow-on.
5. **#13:** Percentage bases contain fixed lines only. Percentage-on-percentage calculations are excluded.

The inflation screenshots were reviewed during interface implementation. Representative export, workbook, and backup examples should be collected when their file-workflow phases begin.
