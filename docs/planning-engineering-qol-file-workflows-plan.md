# File workflow implementation plan: reports, reimport, and Project backups

**Status (2026-10-20):** File-A #8, File-B #7, File-C #4, and File-D #5 are implemented. The user approved all four [File-B sample CSVs](file-workflow-samples/README.md) and has accepted Excel reimporting; the File-C acceptance gate is closed. The supplied OPCC workbook and backup pairs informed File-C and File-D, with evidence limits recorded in [file-workflow-review-gates.md](file-workflow-review-gates.md). Planning share JSON comparison remains separate, deferred work. This plan originally expanded the [quality-of-life roadmap](planning-engineering-qol-roadmap.md) at repository commit `f9145a9`.

The numbered steps below record the implementation contract and are complete for Project workflows except where a limit is stated. The older source-linking design is superseded by active-Project item matching in Step 4.

## Existing boundaries to preserve

- Project CSV, Matching Projects CSV, Nebraska price history CSV, and Planning CSV are human-facing exports. Project and Planning JSON are full recovery/share formats. Simplifying a CSV must not remove information from JSON.
- Excel source parsing and Step 4 review are detached from Project persistence. `src/projects/projectRepository.ts` applies the accepted import atomically with a revision check and a pre-import recovery snapshot.
- Imported lines already store original spreadsheet code, description, unit, quantity, unit cost, and total, plus filename, sheet, row, and a per-import ID. The per-import ID changes on every selection and cannot establish workbook lineage.
- Project backups contain full Project and line IDs. Project Backup import now offers a three-step review wizard for an existing Project or a complete new Project copy. Planning share JSON has a separate format and always imports a copy.

## File-A — Concise import status report (#8)

**Files:** `src/ui/excelImportReport.ts`, `renderExcelImport.ts`, `excelImportController.ts`, `renderApp.ts`; focused behavior in `src/ui/excelImport.test.ts`.

1. Define one small report model before CSV serialization: source sheet/row, item code, description, outcome, final quantity, final unit cost, and one plain-language reason when not imported. Distinguish **Imported**, **Updated**, and **Not imported**. Do not put internal IDs, raw source ranges, issue codes, or duplicate original/final field sets in the default report.
2. Include all actual item candidates, including excluded or unresolved potential items. Omit blank cells, headings, repeated headers, and ordinary subtotal rows from the line list; a short count of those rows may follow the main list. Keep source sheet and row so an engineer can find a rejected item.
3. Before final save, label the file and outcomes as a **review preview**: “Will import,” “Will update,” and “Will not import.” After successful save, create the **import status report** from the committed plan/result and use past-tense outcomes. A failed save must not produce a success report. Keep the ready draft for retry.
4. Show a report download after a successful import even when no items were skipped. The former “skipped-row report” condition was removed. Keep detailed row issues accessible in Step 4; expose a separate diagnostic CSV only if a concrete troubleshooting need remains.

**Acceptance:** A mixed workbook produces a concise list of imported, updated, and not-imported items with correct sheet/row and reasons. A zero-skip import still offers the status report. A failed transaction yields preview wording and retry, never a false success claim. Preserve CSV quoting and formula-safe text.

## File-B — Simplify human-facing CSVs (#7)

**Files:** `src/ui/exportProjectCsv.ts`, `exportEvidenceCsv.ts`, `exportItemPriceHistoryCsv.ts`, `src/planning/exportCsv.ts`, their focused test files, and the menu copy that names each download.

| Surface | Previous shape | Implemented default CSV contract |
| --- | --- | --- |
| Project | 25 line columns plus a two-column summary | One short Project header; line table in screen order: Group, Cost Category, Item Code, Description, Unit Cost, Unit, Quantity, Total Item Cost, Notes; then the visible Project cost summary. Remove internal agency/observation IDs, timestamps, and import locators from the default CSV. |
| Matching Projects | 30 columns, including internal IDs and encoded bidder detail | Export only the visible table columns: Contract/project, Location, optional District, Let date, Awarded vendor, optional Bids, Quantity, Unit, Item description, Awarded Price, Average Price, optional Engineer Estimate, Source. Use the selected state's capability flags as the table does. |
| Nebraska price history | 18 columns | Match its eight visible columns: Period, Item No., Item Description, Total Quantity, Unit, Published Average Unit Price, Total Bid, Source. |
| Planning | 11 table columns plus metadata and Pay item rows | Keep visible project/stage/price-basis context once, alternative element rows, and the visible summary totals. Remove Pay item detail from the default file. A separate calculation-detail export requires an engineer use case. |

1. Generate one example of each proposed CSV and compare it with the corresponding screen before changing the export contract. Keep a simple source label or link when it is visible; do not reintroduce hidden IDs for convenience. Preserve the active Project sort and state-specific evidence capabilities.
2. Use one explicit CSV cell encoder per export. Project, Planning, and the import report already prefixed formula-like text; Matching Projects and Nebraska history gained formula-safe text handling during this change. Keep numeric values as numbers and preserve CRLF/BOM behavior where already relied upon.
3. Update focused export expectations and user workflow documentation. Confirm sums and row counts against the screen. Treat removed columns as a versioned reporting change for any spreadsheet process that reads the old CSV layout. JSON backup/share parsers and payloads stay lossless.

**Review gate complete:** The user approved all four sample layouts before the old columns were removed. The default is simple user-facing data; a detailed export requires a demonstrated task.

## File-C — Revised Excel workbook reconciliation (#4)

**Files:** `src/projects/projectWorkspace.ts` import provenance, `src/projects/excelImport/types.ts`, `matchRows.ts`, `existingItems.ts`, `resolveDraft.ts`, `src/ui/excelImportController.ts`, `renderExcelImport.ts`, `excelImportReport.ts`, and `src/projects/projectRepository.ts`. Keep the reader/worker file limits and physical coordinates intact.

### Source and row identity

1. Preserve per-line workbook provenance: file basename, worksheet, physical source row/range, original identity and numeric values, import timestamp, and applied decisions. Existing project-level Excel source records may remain in stored Projects and backups so older files remain readable, but the current workflow does not assign new source IDs, calculate previous-source candidates, or create/update source records.
2. Match imported rows to current Project lines by exact catalog or custom identity plus Group and cost category. Never auto-pick among multiple candidates. A changed Group, category, or code must be reviewed rather than silently treated as the same line. Blank rows retain physical coordinates and must not be mistaken for removed Project lines.
3. Preserve the Project line ID, evidence context, creation time, and local edits through an accepted Update. Per-line provenance remains attached to the resulting line; workbook rows that are absent from a later import do not delete Project lines.

### Three-value comparison and Step 4 decisions

For each matched row, compare the current Project value **P** with the incoming spreadsheet value **N**. Blank and explicit zero are distinct.

| Comparison | Default for ordinary fields | Quantity rule |
| --- | --- | --- |
| `P = N` | Classify as **Project unchanged**; default to Skip and show it in Reviewed, where Duplicate or Update remains available. | No quantity discrepancy remains. |
| `P ≠ N` | Classify as **Project changed** and require an explicit choice. | Show both values; blank and zero remain distinct. |
| Multiple possible targets or no clear Update target | Classify as **Project needs target** and require target selection before Update. | Do not update until the target is explicit. |

Step 4 displays current Project and incoming spreadsheet quantities and unit costs for every existing-item match in one review table. The Issue type selector includes **Project changed**, **Project unchanged**, and **Project needs target**, alongside the existing row-issue groups. Changed matches require a **Duplicate**, **Update**, or **Skip** button choice. Unchanged matches default to Skip in Reviewed and remain editable. A header checkbox selects visible rows on the current page, and one bulk-action dropdown applies a shared action to selected rows. A blank incoming quantity or unit cost never erases a populated Project value without an explicit choice. Step 5 reports add/update/skip counts, changed totals, and recorded item decisions without editable controls.

Reuse `planExistingItems()` for final target validation and `applyProjectImport()` for the atomic transaction. Reparse and revalidate the draft against the Project revision just before save. Unresolved or conflicting rows remain excluded with reasons; a failed save retains the draft. Update only the explicitly selected current Project line and retain per-line import provenance.

**Cases to check:** same file twice; revised quantity only; revised unit cost only; blank versus zero; duplicate item identities; different Groups/categories; Project changed/unchanged/needs-target classifications; one bulk selection across filtered rows; removed source row; concurrent Project edit; backup round trip with legacy source records. Removed source rows remain untouched.

**Acceptance complete:** The supplied OPCC pair confirms 36 added rows in the full version, with shared item values unchanged. It documents the first draft → later additions case but does not itself exercise quantity or price conflicts. The user accepted the implemented Step 4 reimport workflow, including changed/unchanged/needs-target review. Previous-source linking was removed; legacy backup readability remains supported. The two workbook rows absent from both supplied backups remain a narrow source-evidence question, not an open File-C acceptance gate.

## File-D — Compare Project backup JSON before import (#5)

**Files:** `src/projects/projectBackup.ts`, a pure backup comparison/merge module under `src/projects/`, `src/projects/projectRepository.ts`, `src/ui/renderApp.ts`, a focused render/controller module for the wizard, and Project backup tests. Planning share-file code remains a later separate task.

1. Validate the backup using `parseProjectBackup()` before comparing it. Offer an explicit destination Project selector for both same-ID and different-ID backups. Preselect a destination only on an exact Project ID match; never match or merge Projects by name alone. Keep **Import as copy** as a direct option. Different-ID comparison must show that this is a proposed cross-Project reconciliation.
2. Build a pure two-way comparison. Match lines by stable `lineItemId` where possible. When IDs differ, use nonblank item code together with unit, description, Group/category, and source values to *suggest* a candidate; require explicit confirmation before treating it as the same Project line. Never pair blank custom rows or duplicate identities automatically. Show metadata and lines as Added, Removed, Changed, or Unchanged, plus an **Unpaired** group. Compare stored fields, while recomputing totals from the merged Project instead of trusting the backup's derived summary.
3. The wizard defaults to keeping current values for changed or missing lines. For each changed line, offer **Keep Project**, **Use backup**, or **Add separate line** when valid. A missing backup line is a deletion proposal only if the engineer explicitly selects Delete. Provide explicit metadata choices. Show projected totals and line counts before the final save.
4. Add one repository merge method that writes a pre-merge revision snapshot and the merged Project in one IndexedDB transaction with an expected-revision check. Preserve Project ID, valid line IDs, backup provenance, and unrelated lines. If save fails or the Project changed in another tab, leave the comparison draft available for review/retry.
5. Keep **Import as copy** as an explicit alternative. Whole-Project replace may remain as an advanced recovery action with a clear consequence and snapshot; the comparison path becomes the normal same-ID flow.

**Limits:** The current backup has no shared common-ancestor snapshot. Two-way comparison can show differences but cannot infer whose edit is newer from revision numbers on different machines. Do not auto-resolve conflicting values or delete lines. Plan the Planning JSON comparison separately because its alternatives and element selections have different identities and merge rules.

**Cases to check:** same-ID backup with one changed line, new line, missing line, metadata difference, duplicate catalog identity, different-ID backups from separate imports, a blank custom line, stale local revision, malformed backup, older supported schema, Project with Planning origin, and an import that fails during save. Confirm the pre-merge snapshot can restore the prior Project.

**Design gate complete:** The supplied pair has different Project IDs and zero shared line IDs despite 95 semantically matching coded lines. The implemented wizard proposes different-ID line pairings for explicit acceptance, retains destination metadata by default, and compares percentage line fields. Planning share JSON uses a different schema and still imports as a copy; its comparison workflow is separate deferred scope.

## Sol and Luna handoff for this plan

- **Sol orchestrator:** owns source-lineage and merge policy, schema and repository changes, Step 4 interaction, atomic persistence, and final integration. `projectWorkspace.ts`, `projectRepository.ts`, `renderApp.ts`, and shared import types have one editor at a time.
- **Luna:** may inventory CSV columns, prepare example output comparisons, implement an isolated export mapper with exclusive file ownership after the column contract is fixed, run named focused tests, or review the completed diff read-only. A Luna assignment uses the Objective/Scope/Deliverable/Verification/Restrictions contract in `docs/agent_delegation_policy.md`. It must not make merge-policy decisions or commit/push.
- **Verification:** Use focused pure-model and UI interaction checks for #4/#5 because identity, conflicts, and transaction boundaries matter. Check export content directly; the in-app browser cannot verify download events. Run TypeScript typecheck for logic changes, and a build/preview only for actual UI layout changes per `codex.md`. Update `architecture_overview.md`, `docs/implementation_notes.md`, `docs/data_schema.md`, and `user_workflow.md` when these workflows or schemas change.
