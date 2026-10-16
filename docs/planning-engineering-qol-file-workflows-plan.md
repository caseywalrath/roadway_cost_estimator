# File workflow implementation plan: reports, reimport, and Project backups

**Status:** File-A #8 is implemented on `codex/file-workflow-qol`. Four [File-B sample CSVs](file-workflow-samples/README.md) are prepared for review before column removal. File-C #4 and File-D #5 have [interaction sketches](file-workflow-review-gates.md) and require the stated representative-file review before merge save behavior is finalized. This plan expands the [quality-of-life roadmap](planning-engineering-qol-roadmap.md) at repository commit `f9145a9`.

## Existing boundaries to preserve

- Project CSV, Matching Projects CSV, Nebraska price history CSV, and Planning CSV are human-facing exports. Project and Planning JSON are full recovery/share formats. Simplifying a CSV must not remove information from JSON.
- Excel source parsing and Step 4 review are detached from Project persistence. `src/projects/projectRepository.ts` applies the accepted import atomically with a revision check and a pre-import recovery snapshot.
- Imported lines already store original spreadsheet code, description, unit, quantity, unit cost, and total, plus filename, sheet, row, and a per-import ID. The per-import ID changes on every selection and cannot establish workbook lineage.
- Project backups contain full Project and line IDs. A same-ID backup currently offers whole-Project COPY/REPLACE; a different ID imports as a new Project. Planning share JSON has a separate format and always imports a copy.

## File-A — Concise import status report (#8)

**Files:** `src/ui/excelImportReport.ts`, `renderExcelImport.ts`, `excelImportController.ts`, `renderApp.ts`; focused behavior in `src/ui/excelImport.test.ts`.

1. Define one small report model before CSV serialization: source sheet/row, item code, description, outcome, final quantity, final unit cost, and one plain-language reason when not imported. Distinguish **Imported**, **Updated**, and **Not imported**. Do not put internal IDs, raw source ranges, issue codes, or duplicate original/final field sets in the default report.
2. Include all actual item candidates, including excluded or unresolved potential items. Omit blank cells, headings, repeated headers, and ordinary subtotal rows from the line list; a short count of those rows may follow the main list. Keep source sheet and row so an engineer can find a rejected item.
3. Before final save, label the file and outcomes as a **review preview**: “Will import,” “Will update,” and “Will not import.” After successful save, create the **import status report** from the committed plan/result and use past-tense outcomes. A failed save must not produce a success report. Keep the ready draft for retry as the current controller does.
4. Show a report download after a successful import even when no items were skipped. The current result screen shows a “skipped-row report” only when skips exist; that condition must change. Keep detailed row issues accessible in Step 4; expose a separate diagnostic CSV only if a concrete troubleshooting need remains.

**Acceptance:** A mixed workbook produces a concise list of imported, updated, and not-imported items with correct sheet/row and reasons. A zero-skip import still offers the status report. A failed transaction yields preview wording and retry, never a false success claim. Preserve CSV quoting and formula-safe text.

## File-B — Simplify human-facing CSVs (#7)

**Files:** `src/ui/exportProjectCsv.ts`, `exportEvidenceCsv.ts`, `exportItemPriceHistoryCsv.ts`, `src/planning/exportCsv.ts`, their focused test files, and the menu copy that names each download.

| Surface | Current shape | Proposed default contract for sample review |
| --- | --- | --- |
| Project | 25 line columns plus a two-column summary | One short Project header; line table in screen order: Group, Cost Category, Item Code, Description, Unit Cost, Unit, Quantity, Total Item Cost, Notes; then the visible Project cost summary. Remove internal agency/observation IDs, timestamps, and import locators from the default CSV. |
| Matching Projects | 30 columns, including internal IDs and encoded bidder detail | Export only the visible table columns: Contract/project, Location, optional District, Let date, Awarded vendor, optional Bids, Quantity, Unit, Item description, Awarded Price, Average Price, optional Engineer Estimate, Source. Use the selected state's capability flags as the table does. |
| Nebraska price history | 18 columns | Match its eight visible columns: Period, Item No., Item Description, Total Quantity, Unit, Published Average Unit Price, Total Bid, Source. |
| Planning | 11 table columns plus metadata and Pay item rows | Keep visible project/stage/price-basis context once, alternative element rows, and the visible summary totals. Remove Pay item detail from the default file. A separate calculation-detail export requires an engineer use case. |

1. Generate one example of each proposed CSV and compare it with the corresponding screen before changing the export contract. Keep a simple source label or link when it is visible; do not reintroduce hidden IDs for convenience. Preserve the active Project sort and state-specific evidence capabilities.
2. Use one explicit CSV cell encoder per export. Project, Planning, and the current import report already prefix formula-like text; Matching Projects and Nebraska history currently only quote it. Add formula-safe text handling there while revising those exports. Keep numeric values as numbers and preserve CRLF/BOM behavior where already relied upon.
3. Update focused export expectations and user workflow documentation. Confirm sums and row counts against the screen. Treat removed columns as a versioned reporting change for any spreadsheet process that reads the old CSV layout. JSON backup/share parsers and payloads stay lossless.

**Review gate:** Show the four sample files to an engineer or the user before deleting old columns. The agreed default is simple user-facing data; a detailed export is added only for a demonstrated task.

## File-C — Revised Excel workbook reconciliation (#4)

**Files:** `src/projects/projectWorkspace.ts` import provenance, `src/projects/excelImport/types.ts`, `matchRows.ts`, `existingItems.ts`, `resolveDraft.ts`, `src/ui/excelImportController.ts`, `renderExcelImport.ts`, `excelImportReport.ts`, and `src/projects/projectRepository.ts`. Keep the reader/worker file limits and physical coordinates intact.

### Source and row identity

1. At first import, assign a stable workbook-source ID within the destination Project. Save it with each imported line, together with the accepted source values. On a later file selection, calculate a content digest to recognize an identical file and show a *possible previous source* when filename, sheet/table structure, and item identities overlap. The digest detects identical bytes; a changed file needs the other signals and an explicit engineer link to the earlier source.
2. Match a revised row first to a previously imported source row when source ID and sheet/row identity still agree, then use exact catalog or custom identity plus Group/category as candidates when rows moved. Never auto-pick among multiple candidates. A changed Group, category, or code must be reviewed rather than silently treated as the same line.
3. Keep the prior imported source values separate from current Project values. Preserve the Project line ID, evidence context, creation time, and local edits through an accepted update. The source history should include the last reviewed source values even when the engineer chooses **Keep Project**; otherwise the next reimport cannot distinguish a new spreadsheet change from a previously reviewed one.

### Three-value comparison and Step 4 decisions

For each field, let **B** be the last reviewed spreadsheet value, **P** the current Project value, and **N** the new spreadsheet value. Blank and explicit zero are distinct.

| Comparison | Default for ordinary fields | Quantity rule |
| --- | --- | --- |
| `N = B`, `P ≠ B` | Keep the Project edit. | Review the differing Project and spreadsheet quantities; default to Keep Project. |
| `P = B`, `N ≠ B` | Use the new spreadsheet value when identity is unambiguous. | Send to **Review items** for an explicit choice. |
| `P = N`, both changed from `B` | Keep the common value and refresh source provenance. | No Project/spreadsheet quantity discrepancy remains. |
| `P ≠ B`, `N ≠ B`, `P ≠ N` | Review a conflict. | Review a conflict. |
| No reliable `B` or ambiguous target | Review; default to preserving the Project. | Review. |

Step 4 must display the current Project and incoming spreadsheet quantities and unit costs for a matched item. Every differing matched quantity receives **Use spreadsheet**, **Keep Project**, **Add as separate item**, and **Skip row** choices. Unit-cost conflicts receive explicit choices. Bulk choices may be offered only over visible rows with the same valid options, following the existing shared-action pattern. A blank incoming quantity or unit cost never erases a populated Project value without an explicit choice. Step 5 then reports add/update/skip counts, changed totals, and unresolved rows, without introducing new decisions.

Reuse `planExistingItems()` for final target validation and `applyProjectImport()` for the atomic transaction, extending them where field-level decisions require it. Reparse and revalidate the draft against the Project revision just before save. Unresolved or conflicting rows remain excluded with reasons; a failed save retains the draft.

**Cases to check:** same file twice; changed filename with same source; revised quantity only; revised unit cost only; both Project and file changed; blank versus zero; sheet reorder; row reorder; duplicate item identities; different Groups/categories; removed source row; concurrent Project edit; backup round trip of source lineage. Removed source rows remain untouched in the first release.

**Design gate:** Prepare a Step 4 interaction sketch and a field-level decision table using two real versions of a representative workbook. Confirm the source-link suggestion and quantity review wording before implementation. The user has required quantity differences to appear in Step 4; the remaining choices concern source identification and bulk review behavior.

## File-D — Compare Project backup JSON before import (#5)

**Files:** `src/projects/projectBackup.ts`, a pure backup comparison/merge module under `src/projects/`, `src/projects/projectRepository.ts`, `src/ui/renderApp.ts`, a focused render/controller module for the wizard, and Project backup tests. Planning share-file code remains a later separate task.

1. Validate the backup using `parseProjectBackup()` before comparing it. For the first release, enable comparison when the backup Project ID equals a local Project ID. A different ID keeps the current import-as-copy path; never match Projects by name alone.
2. Build a pure two-way comparison. Match lines by stable `lineItemId`; use catalog/custom identity only to *suggest* a candidate when IDs differ, and require explicit confirmation for that pairing. Show metadata and lines as Added, Removed, Changed, or Unchanged. Compare stored fields, while recomputing totals from the merged Project instead of trusting the backup's derived summary.
3. The wizard defaults to keeping current values for changed or missing lines. For each changed line, offer **Keep Project**, **Use backup**, or **Add separate line** when valid. A missing backup line is a deletion proposal only if the engineer explicitly selects Delete. Provide explicit metadata choices. Show projected totals and line counts before the final save.
4. Add one repository merge method that writes a pre-merge revision snapshot and the merged Project in one IndexedDB transaction with an expected-revision check. Preserve Project ID, valid line IDs, backup provenance, and unrelated lines. If save fails or the Project changed in another tab, leave the comparison draft available for review/retry.
5. Keep **Import as copy** as an explicit alternative. Whole-Project replace may remain as an advanced recovery action with a clear consequence and snapshot; the comparison path becomes the normal same-ID flow.

**Limits:** The current backup has no shared common-ancestor snapshot. Two-way comparison can show differences but cannot infer whose edit is newer from revision numbers on different machines. Do not auto-resolve conflicting values or delete lines. Plan the Planning JSON comparison separately because its alternatives and element selections have different identities and merge rules.

**Cases to check:** same-ID backup with one changed line, new line, missing line, metadata difference, duplicate catalog identity, stale local revision, malformed backup, older supported schema, Project with Planning origin, and an import that fails during save. Confirm the pre-merge snapshot can restore the prior Project.

**Design gate:** Review one realistic pair of Project backups and the proposed comparison screen before adding the save action. If percentage lines (#13) are implemented first, this comparison must understand their new line type; if #5 ships first, extend the comparator when the Project schema changes.

## Sol and Luna handoff for this plan

- **Sol orchestrator:** owns source-lineage and merge policy, schema and repository changes, Step 4 interaction, atomic persistence, and final integration. `projectWorkspace.ts`, `projectRepository.ts`, `renderApp.ts`, and shared import types have one editor at a time.
- **Luna:** may inventory CSV columns, prepare example output comparisons, implement an isolated export mapper with exclusive file ownership after the column contract is fixed, run named focused tests, or review the completed diff read-only. A Luna assignment uses the Objective/Scope/Deliverable/Verification/Restrictions contract in `docs/agent_delegation_policy.md`. It must not make merge-policy decisions or commit/push.
- **Verification:** Use focused pure-model and UI interaction checks for #4/#5 because identity, conflicts, and transaction boundaries matter. Check export content directly; the in-app browser cannot verify download events. Run TypeScript typecheck for logic changes, and a build/preview only for actual UI layout changes per `codex.md`. Update `architecture_overview.md`, `docs/implementation_notes.md`, `docs/data_schema.md`, and `user_workflow.md` when these workflows or schemas change.
