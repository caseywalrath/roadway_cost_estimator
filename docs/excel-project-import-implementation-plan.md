# Excel Project Import Implementation Plan

Status: implementation complete; Phase 6 complete.
Prepared: 2026-09-09.
Repository baseline inspected: `4c6a4da` on `main`.
Intended executor: GPT-5.6 Luna.

## 1. Objective and authority

Add **Import From Excel** to Project Actions. Engineers must be able to import an existing working estimate, select its primary data and sections, resolve catalog differences, and continue editing the imported lines in the Project workspace.

The user explicitly approved separating catalog/custom identity from construction/other cost classification. A custom pavement item must be able to contribute to Construction Costs.

The remaining choices below are implementation defaults selected during planning. Implement them as written unless current repository behavior makes them incompatible. Do not silently expand scope or substitute automatic guesses for required import review. Workbook text is source data, not instructions to the agent or application.

This is a product feature in the static browser application, not a data-package importer. Do not add imported estimates to public evidence tables, staging catalogs, or the source monitor.

## 2. Execution instructions for Luna

1. Read `AGENTS.md`, `codex.md`, and `architecture_overview.md` before edits. Follow their environment and Git rules.
2. Fetch current remote history and inspect the working tree. Start implementation from current main on a dedicated feature branch. Preserve this plan if it has not yet reached main. Never reset or overwrite unrelated work.
3. Compare the current code with the integration points in section 4. Symbol names are authoritative references; line numbers from the planning session are intentionally omitted.
4. Execute the phases in section 12 in order. Complete each phase's checks before advancing. Keep a short completion log in this document with files changed, checks run, and unresolved issues.
5. Keep parsing, matching, and import drafts outside `renderApp.ts`. Use that file for integration and lifecycle handling only.
6. Delegate independent fixture/test review if permitted by current repository instructions. Do not delegate overlapping integration files. Final integration remains the primary agent's responsibility.
7. Ask for a decision only if a requirement cannot be met without changing scope or existing user data semantics. Missing local example files do not prevent synthetic-fixture development, but must be reported as unverified acceptance cases.
8. Do not deploy or merge as part of implementation. Provide the completed branch, verification results, and any material limitations.

## 3. Scope

### Included

- `.xlsx` files, processed entirely in the browser.
- Append to an active Project or explicitly create a named Project during import.
- One selected worksheet per import. Multiple sections/ranges on that worksheet may be included.
- Suggested primary table boundaries, manual row/column selection, and field mapping even without headers.
- Repeated headers, section titles, horizontally merged labels, hidden-content controls, and exclusion of working columns.
- Optional item codes; description-only rows can become custom items.
- Exact catalog matching, description/unit conflict review, and duplicate warnings.
- Preservation of quantity, price, notes, groups, and source references, with explicit handling of incomplete or exceptional rows.
- Independent cost category on all Project lines, including ordinary manual entry and exports/backups.
- One atomic import write with a pre-import recovery snapshot for an existing Project.
- An import result table and downloadable CSV report.

### Excluded from this release

- `.xls`, `.xlsb`, `.xlsm`, CSV input, password-protected workbooks, macros, and external-link refresh.
- Formula evaluation, live Excel synchronization, and preserving Excel formatting in Project view.
- Automatic fuzzy catalog linking, automatic numerical unit conversion, or cross-state matching.
- Automatic merging/replacement of existing lines, repeat-import synchronization, and duplicate aggregation.
- A scenario model, hierarchical groups, percentage-linked items, or group subtotals.
- Negative quantities/prices. Report these for correction or exclusion; do not clamp them to zero.
- Automatic import of contingency, engineering fees, grand totals, or percentage summary formulas.

## 4. Existing code to reuse and constraints

| File / symbol | Current behavior | Required treatment |
| --- | --- | --- |
| `src/ui/renderProjectWorkspace.ts`, Project Actions renderer | Shared menu contains JSON recovery import | Add a separate Excel action; preserve JSON recovery behavior |
| `src/projects/projectWorkspace.ts`, `findExactProjectCatalogItem` | Matches trimmed, case-insensitive code in state/agency; returns first result | Preserve code rules; importer must check candidate cardinality and never silently choose among multiple matches |
| `linkProjectLineItemToCatalog` | Fills official identity/description/unit, clears evidence, preserves other fields | Reuse only after conflicts resolved; preserve new cost category and provenance |
| `createCustomProjectLineItem` | Creates incomplete editable custom line | Reuse for candidates; do not persist while previewing |
| `findDuplicateCatalogLineItemIds` | Identifies repeated agency item identity | Use for warnings, not deduplication |
| `projectConstructionCost`, `projectOtherCost` | Currently split totals by line identity | Change to explicit cost category |
| `projectLineTotal` | Quantity times preferred unit cost; null treated as zero | Preserve calculation; show incomplete status explicitly during import |
| `src/ui/renderApp.ts`, `confirmExactProjectCatalogMatch` | Manual per-row confirmation links a custom row to catalog | Share pure lookup/linking rules, not repeated browser confirmation dialogs |
| `flushPendingProjectSave`, `queueProjectSave` | Pending edits and autosave lifecycle | Flush before import and revalidate at commit; do not use optimistic autosave to publish import results |
| `src/projects/projectRepository.ts`, `saveProject` | Whole-Project transaction with expected revision | Extend with atomic snapshot-plus-import method |
| `createRevision` | Separate transaction from Project save | Do not use two separate writes as a substitute for atomic import |
| `src/projects/projectEditCoordinator.ts` | Multi-tab ownership claims | Respect read-only/ownership state and revision checks |
| `src/projects/projectBackup.ts` | JSON round-trip recovery and copy/replace | Extend parsing/serialization compatibility; do not turn it into the Excel parser |
| `src/ui/exportProjectCsv.ts` | Reporting export with fixed column positions and a summary footer | Preserve existing column order; append new columns |

Current Project schema is v9. Existing custom items accept blank numeric values and finite nonnegative numbers. Catalog code/unit are locked. Catalog descriptions can already be explicitly unlocked; retain that manual feature. Import has a stricter rule: choosing a differing source description produces a custom line.

## 5. Data model and compatibility

### 5.1 Independent cost category

Add a required normalized line field:

```ts
type ProjectCostCategory = "construction" | "other";
// ProjectLineItem
costCategory: ProjectCostCategory;
```

Rules:

- Construction subtotal sums `costCategory === "construction"`; Other subtotal sums `"other"`.
- Catalog/custom identity continues to control evidence links and identity editing, never cost classification.
- Contingency continues to apply to the combined construction and other base. Do not introduce a new contingency basis in this feature.
- Old records without the field: catalog/legacy explorer -> construction; custom -> other. This preserves all pre-upgrade subtotals.
- New Explorer catalog lines default to construction. New manual custom lines default to other to preserve the existing entry default, with an editable category control.
- New imported item rows default to construction regardless of identity. Show this explicitly. Permit bulk category assignment per section and per-row overrides. Do not infer Other solely from words such as RIGHT OF WAY.
- Linking a custom line to catalog preserves its explicitly stored category. The user can change category separately.
- Add the category to editable fields, row rendering/events, sort support, copying, backup recovery, and all normalization paths.
- Label the subtotal **Construction Costs**, since it will include custom construction work.

Advance the workspace schema to v10 if still v9 at execution. Audit every schema literal/version check before doing so. An application schema version is not automatically an IndexedDB database version; increment the latter only if object-store structure requires it.

Normalize old IndexedDB reads, legacy storage migration, revisions, and JSON backup imports through the same compatibility path. Do not require users to export/reimport existing Projects. Unknown explicit category values in new-format input are validation errors, not silent fallback. Missing category in legacy input uses the mapping above.

In particular, `parseProjectBackup` currently accepts versions 4-8 plus the current-version constant. When that constant becomes 10, explicitly retain version 9 acceptance. Rename or wrap `parseUserProjectV9` consistently across callers, and test recovery files from every supported version. Normalize revision snapshots when reading/restoring them as well as ordinary Projects.

### 5.2 Import provenance

Add optional `importSource` to imported lines, absent on old/manual lines:

```ts
interface ProjectLineImportSource {
  importId: string;
  fileName: string; // basename only, never full local path
  sheetName: string;
  rowNumber: number; // original 1-based Excel row
  sourceRange: string;
  importedAt: string;
  original: {
    itemCode: string;
    description: string;
    unit: string;
    quantity: number | null;
    unitCost: number | null;
    total: number | null;
  };
  decisions: string[]; // stable reason codes for normalization/overrides
}
```

Validate provenance on recovery import. Preserve it through copy, edit, and backup. Keep raw malformed text, formulas, and cell-level issues in the draft/report; do not store the complete workbook in IndexedDB. Project notes remain engineer notes and are not overwritten with diagnostics.

Preserve existing CSV columns in their existing positions: OPCC uses position-based references to the current export. Append `Item Type`, `Cost Category`, `Import File`, `Import Sheet`, and `Import Row` after existing columns. `Added Via` should display `Excel Import` for imported lines; retain existing values for other lines. JSON remains the recovery format; spreadsheet imports must not trust spreadsheet agency IDs or evidence snapshots as authenticated catalog/evidence identity.

## 6. Browser workbook reader

Use SheetJS Community Edition behind a small adapter. Pin `0.20.3` from its official release tarball and record it in the existing package lock. Do not install the unqualified public-registry `xlsx` package. The official installation documentation identifies its CDN as authoritative and the public registry as outdated. Source: [SheetJS framework installation](https://docs.sheetjs.com/docs/getting-started/installation/frameworks/), reviewed 2026-09-09. If a newer release is required, verify its official documentation and record the reason before changing the pin.

Bundle the dependency with the app, load it only when the import worker starts, and make no runtime CDN requests. Read official cell/merge/workbook metadata documentation while implementing the adapter; validate behavior using actual binary workbook fixtures rather than assuming flattened JSON contains everything needed.

Proposed files:

| File | Responsibility |
| --- | --- |
| `src/projects/excelImport/types.ts` | Plain serializable reader, mapping, draft, issue, and report contracts |
| `src/projects/excelImport/readWorkbook.ts` | SheetJS adapter; cells, cached values, formula flags, formats, merges, hidden metadata, print areas |
| `src/projects/excelImport/importWorker.ts` | Worker message protocol and bounded parsing |
| `src/projects/excelImport/detectLayout.ts` | Deterministic region/header/section suggestions |
| `src/projects/excelImport/parseRows.ts` | Mapped cell extraction, numeric parsing, row classification, source locators |
| `src/projects/excelImport/matchRows.ts` | Catalog candidates and description/unit comparisons |
| `src/projects/excelImport/resolveDraft.ts` | Apply user decisions, validate final rows, build Project lines |
| `src/projects/excelImport/buildImportReport.ts` | Deterministic report rows and escaped CSV output |
| `src/ui/renderExcelImport.ts` | Wizard rendering and accessible controls |
| `src/ui/excelImportController.ts` | Draft state and asynchronous lifecycle, without repository writes during preview |

Keep reader data sparse. Preserve physical coordinates, cell types, raw values, formatted text, cached formula result, formula-present flag, and merge anchor. Do not reduce a worksheet to objects keyed only by header text: duplicate or missing headers are valid inputs.

Initial configurable limits: 20 MiB compressed input, 100 worksheets, 250,000 populated cells in the workbook, 20,000 selected rows, 100 selected columns, and 30 seconds per worker parsing operation. Terminate the worker on cancel/timeout. Reject over-limit selections with a clear message; never silently truncate. Count actual populated cells without iterating an inflated rectangular used range. These limits bound application work; do not claim the post-parse cell check prevents every allocation inside the reader.

Reject unsupported/encrypted/corrupt files with an actionable message. Do not evaluate formulas, follow hyperlinks/external references, interpret cell text as HTML, or execute macros. Display all spreadsheet text through the app's escaping utilities. CSV report text must be protected against spreadsheet formula injection as well as normal CSV quoting.

## 7. Selection, mapping, and layout rules

### Wizard stages

1. **File and destination:** Choose `.xlsx`; append to the active editable Project or create a new named Project. For new Projects require state and name; default contingency to zero. Defer creation until final import succeeds. Load only that state's catalog using the existing loader.
2. **Worksheet and area:** Show all sheets, visibility, and suggested regions. Select one sheet; hidden sheets require explicit selection. Never choose the first sheet solely by position (132nd and Giles starts with a hidden sheet).
3. **Columns and sections:** Show a preview with Excel coordinates. Select header row(s) or No headers, columns, row intervals, section inclusion, group names, and cost category.
4. **Review items:** Resolve required issues, inspect catalog/custom status and total changes, and optionally exclude rows.
5. **Import result:** Show counts, affected Project, total impact, excluded/failed rows, and report download. Keep the report available until dismissed or a new import starts.

Support Back/Cancel without losing edits unnecessarily. A mapping/selection change invalidates dependent matches and resolutions; never carry a decision to a different physical row. Use stable draft IDs based on sheet and physical row, not array positions. A row selected by overlapping ranges appears once.

Overlapping regions must agree on mapping, group, and category treatment for each shared row. Otherwise block the overlap until the user removes it or assigns the row to one region. Do not choose a winning mapping by selection order. Two separate side-by-side item tables covering the same physical rows must be imported in separate operations in this release.

### Mapping aliases

Normalize header case, whitespace, line breaks, and trailing punctuation for suggestions only.

| Target | Suggested headers |
| --- | --- |
| Item code | Item Code, Item No., Item Number, Contract Item No., Pay Item |
| Description | Item Description, Description, Work Description |
| Unit | Unit, Units, UOM |
| Quantity | Quantity, Qty, Estimated Quantity |
| Unit cost | Unit Cost, Unit Price, Preferred Unit Cost |
| Source total | Extended Cost, Total Item Cost, Amount, Total |
| Notes | Notes, Line Notes, Remarks |
| Group | Group, Section, Category |
| Cost category | Cost Category |

Quantity, unit cost, and source total are distinct fields. A numbered sequence column is not automatically an item code. Duplicate header candidates require user selection. Allow mapping a column with a blank header. Each column maps to at most one target field; each target has at most one column in a region. Notes-column concatenation is deferred.

For each selected region allow its own mapping; offer reuse of the first mapping. A supplied Group column takes precedence, otherwise use the confirmed section title, otherwise blank. Imported notes such as OPCC's Roadway/Utility labels remain notes unless the user maps them as Group.

Mapped Cost Category accepts `construction` or `other`, ignoring case and surrounding whitespace. Precedence is explicit row override, nonblank mapped value, section default, then construction. An invalid nonblank mapped value requires review and correction or an explicit override; do not silently fall back. A section bulk action sets explicit overrides on the selected rows after showing the affected count.

### Detection and classification

- Print area is a suggestion, not a hard boundary or proof that every included column is primary data.
- Score header candidates using multiple distinct recognized fields and plausible following rows. Show tied candidates for selection; do not invent a certainty percentage.
- Repeated mapped headers are non-item rows. Broad merged titles above recognized item rows may suggest section groups.
- Expose classifications: item, section heading, repeated header, summary/subtotal, blank, ambiguous. Keep every nonblank row within selected ranges accounted for in the preview/report.
- Exclude summary/subtotal rows by default, with an explicit reason and option to reclassify. Use structure and mapped fields, not the word Total alone, to avoid dropping a valid item description.
- Read horizontal merged text from its anchor once. Do not copy quantity, unit cost, or total down vertical merges. Vertically merged item values require user correction/reclassification or exclusion.
- Description-only continuation rows are ambiguous; offer merge into the preceding item's description within the same section or exclusion. Preserve all contributing row locators in the report. Do not cross section/range boundaries.
- Hidden rows inside selected ranges are excluded by default and counted visibly; allow explicit inclusion. Hidden columns can be mapped explicitly. Never import filtered-out/hidden content without showing the selection policy.
- Working cells outside selected primary columns do not become items or alternate prices. They can remain formula precedents for saved results, but are not evaluated.
- Sections containing Alternative or Alternate require explicit inclusion choices. Offer select-none as a starting state for such sections. Do not attempt to infer a general scenario hierarchy. The section checklist remains required even when headings contain no alternative keyword.

## 8. Catalog matching and review rules

Resolve within the destination state and selected agency (default: state's default agency). Never infer state from a code's shape. Switching destination state/agency invalidates all prior match decisions.

Code normalization: trim and uppercase only, following manual entry. Preserve punctuation and leading zeros. For numeric cells, preserve zero padding from a supported identifier number format. Date-typed/scientific-notation/precision-damaged codes require correction; do not guess lost digits.

Description comparison: Unicode NFC, trim, collapse whitespace, and case-insensitive equality. Preserve dimensions, punctuation, hyphens, material qualifiers, and numbers. Do not use edit distance for automatic matching.

Unit comparison: trim, uppercase, and collapse spaces. Initial explicit aliases: `EA`/`EACH`, and `LS`/`L S`/`L.S.`. Map them to the matched item's actual official unit. Do not equate mass, area, length, or force-account units using guesses. Additional aliases need isolated tests and a documented basis.

| Situation | Default / required action |
| --- | --- |
| Unique exact code; equivalent description and unit | Ready as catalog; use official text and unit, preserve quantity/cost |
| Unique exact code; blank description/unit | Fill missing fields from catalog and show changes |
| Unique exact code; different description | Require Use catalog description, Keep mine as custom, or Exclude |
| Unique exact code; substantive unit mismatch | Require corrected source values with official unit, Keep mine as custom, or Exclude; no silent relabeling |
| Missing code; unique exact normalized description and equivalent unit | Suggest candidate, require explicit acceptance before catalog linking |
| Missing/unknown code; no unique exact candidate | Ready as custom if meaningful description exists; clearly label Unmatched |
| Multiple candidate identities | Require explicit choice or custom/exclude; never take first result |
| Catalog item with historical marker | Follow the state's existing display policy; no new claim of obsolescence |
| Repeated code/item within file or Project | Warning; retain separate rows by default; user may exclude |
| No usable code or description | Not importable until corrected or excluded |

If either retained description or retained unit differs substantively from canonical values, the final line is custom with blank agency identity and no evidence context. Do not create partially linked lines. If the user manually corrects both to canonical values, catalog linking is allowed.

Bulk resolutions apply only to identical conflict tuples (catalog identity plus source description/unit and decision), and only within this import. Show the affected count and provide undo before commit. Do not silently learn permanent matching rules.

## 9. Numbers, totals, and exceptions

- Preserve numeric precision internally. Quantity and unit cost must be finite and nonnegative. Blank is null, not zero. Boolean/date/error cells in numeric fields are invalid.
- Accept typed Excel numbers and unambiguous US-style text such as `1,250.50` and `$1,250.50`; remove currency symbols only in monetary fields. Reject ambiguous locale formats and malformed grouping. Do not use permissive `parseFloat`.
- A dash or N/A is not automatically zero. Show it as invalid/missing for user correction or explicit blank acceptance.
- Formula cells use cached typed results. A valid empty-string result is blank. Missing caches and Excel error results must be flagged. Errors outside selected mapped cells do not block import.
- Explain once: imported values are saved workbook results; formulas and external links are not refreshed. For missing formula values offer correction, import as incomplete, or exclusion, and suggest recalculating/saving in Excel if needed.
- A row with valid identity/description may be imported incomplete after explicit acknowledgement. Display the number of incomplete rows and state that their calculated totals currently contribute zero. Never label them fully priced.
- Always recalculate Project item total as quantity times unit cost. Source total is comparison/provenance only.
- Show every difference greater than $0.01. Differences up to $1.00 per row may be marked Possible rounding and do not block; larger differences require explicit resolution. Display the aggregate difference as well. These thresholds are UI policy, not proof of correct source calculations.
- A missing source total is allowed. An invalid mapped total requires correction, explicit ignore, or exclusion; valid quantity/cost can still be imported after that decision.
- For total-only or percentage/allowance-shaped rows, require one of: keep valid inputs and accept recalculation; convert valid source total to a custom fixed allowance with quantity 1, unit LS, unit cost equal to source total; correct fields; exclude. Percentage semantics must never be guessed.
- Percent-formatted quantity cells, `%` units, and percent allowance labels are review triggers even when multiplication happens to reconcile.
- Do not reverse-solve missing quantity or unit cost from a total automatically.
- Source contingency and fee summaries are excluded. Do not change an existing Project's contingency. Show its resulting contingency impact in final review. New Projects start at zero, with ordinary Project editing available afterward.

## 10. Save behavior and report

Keep the draft detached from Project state throughout parsing/review. The final preview shows the number of lines, category subtotals, incomplete count, recalculated totals, source-total differences where comparable, exclusions, and contingency impact. Require explicit acknowledgement of included warnings; unresolved required issues block those rows until corrected or excluded.

Append flow:

1. Flush pending Project edits successfully before establishing the draft's base revision.
2. At commit, recheck selected Project ID, state, active status, edit ownership, and expected revision. Flush again. If anything changed, refresh the baseline and require final review again; do not silently rebase the import.
3. Validate every accepted row and assign stable unique line IDs once for the commit attempt.
4. Add a repository method that checks expected revision, saves the exact pre-import Project to revisions, and appends all accepted lines in one `projects` + `revisions` IndexedDB transaction. Apply the existing 20-snapshot retention policy in that transaction.
5. Update visible Project state only after transaction completion. Retain draft and decisions on quota/conflict/storage failure. Do not report success early.
6. Disable repeated submission during commit. Do not permit navigation/cancel to imply an in-flight write was undone. Once committed, any retry must not append a second copy.

New-Project flow: create the named Project with all accepted lines in one write; no empty Project before confirmation. Activate only after successful persistence. If activation fails after creation, report that the Project was saved and offer navigation; never retry creation as though it failed.

Use existing read-only/session-storage fallback behavior deliberately. If the repository cannot provide durable atomic import semantics, disable commit with a specific explanation instead of claiming a durable import succeeded.

Report columns: file, sheet, original row/range, snippet, outcome, reason codes/text, original values, final values, final identity, group, category, source total, recalculated total, difference, and resulting line ID when imported. Outcomes distinguish imported, imported incomplete, excluded by user/default classification, and failed validation. Include hidden-row and unselected-sheet/region counts at summary level; do not imply unselected cells were validated.

The CSV report is available before commit for diagnostics and after success for results. The success message states imported and not-imported counts. Never silently discard a failed row.

## 11. Acceptance fixtures

The private sample files are in `C:\Users\Casey.Walrath\Downloads`. Inspect locally without modifying them. Do not commit full workbooks or internal paths. Create small synthetic `.xlsx` fixtures containing equivalent structures and controlled values, plus expected results. Binary reader tests must include cached formulas, missing caches, merge metadata, and hidden metadata; mocked row objects alone are insufficient.

| Case | Required assertion |
| --- | --- |
| OPCC `Estimate!B10:H143` | Header row 10; 133 candidate item rows 11-143 before validation; code B, description C, unit D, quantity E, cost F, total G, notes H |
| OPCC price formulas | Import saved F values; never select K/L/M as primary prices merely because they also contain price headings |
| OPCC helper errors / export sheet | Helper errors outside mapped area do not block; the separate export sheet is not automatically imported |
| OPCC summary rows 145-166 | No automatic extra item for bid subtotal, contingency, or grand total |
| 132nd and Giles sheet list | Six visible concepts plus hidden sheets; no automatic combination or first-hidden-sheet import |
| 132nd and Giles `Concept 1A` | Description B, unit C, quantity D, cost E, total F; repeated section headings become reviewed groups; missing codes allowed |
| `Concept 1A!D63:F63` | 0.08, 227700, 227700 produces mismatch review; fixed allowance choice produces 1 x 227700; default does not silently reduce it to 18216 |
| Ida Street `Ida Street Imp` | Primary B:F; working G onward ignored; secondary Sheet1 not automatically selected |
| Ida rows 49-66 | PCC and asphalt alternative sections require explicit inclusion; one can be excluded while common sections remain |
| Ida row 98 | Utilities percentage/total-only row requires an explicit interpretation |
| Merged/irregular fixtures | Horizontal heading handled once; vertical numeric merge flagged; continuation rows resolved without cross-section joining |
| Mapping fixtures | Blank/duplicate headers, multirow headers, different mappings in two regions, identical overlap deduplicated, conflicting overlap blocked, numeric code leading zeros; category precedence and invalid mapped category review |
| Matching fixtures | Exact code, case/space equivalence, description conflict, unit alias, substantive unit mismatch, unknown code, ambiguous description, cross-state collision |
| Numeric fixtures | Zero vs blank; negative and nonfinite rejected; currency text; malformed locale; cached formula error; incomplete row acknowledgement |
| Duplicate fixture | Repeated catalog item in separate groups and existing Project stays separate unless excluded |
| Migration fixture | Existing v9 catalog/custom subtotals unchanged after v10; explicit custom-construction survives save/reload/copy/backup |
| Atomicity fixture | Snapshot and append succeed together; injected transaction failure leaves neither partial lines nor snapshot; revision conflict preserves draft |
| Lifecycle fixture | Cancel/back/file change/state switch cannot apply stale worker output or stale resolutions; repeated submit cannot double-import |
| Export fixture | Existing CSV columns retain positions; appended fields correct; report formula-like text escaped; JSON restores category/provenance |

For full-workbook acceptance, record actual selected ranges, candidate/imported/excluded counts and reasons. Do not assert all rows match catalog or a spreadsheet grand total: the examples contain custom items, alternatives, allowances, and fees outside the selected item scope.

## 12. Ordered implementation phases

### Phase 1: Category model and compatibility

Edit `projectWorkspace.ts`, repository normalization, backup parsing, Project table/forms, `exportProjectCsv.ts`, and relevant tests. Add provenance types/compatibility at the same schema boundary. Audit callers that construct line objects directly. Preserve all legacy totals and current CSV positions.

Gate: category calculations, old-version migration, reload, copy, and backup tests pass. A manually created custom line can be set to Construction and remain there after catalog linking and reload.

### Phase 2: Workbook adapter and fixtures

Add the pinned dependency and lockfile change. Implement worker/adapter contracts and sparse reader. Add synthetic binary fixtures for formulas, hidden sheets/rows, merges, and identifiers. Record the binary-fixture generation method so they are reproducible.

Gate: actual `.xlsx` inputs produce stable coordinates and cached values, unsupported/error cases are explicit, cancellation/limits work. No changes to active Project state.

### Phase 3: Layout, mapping, matching, and resolution

Implement the pure modules in sections 7-9. Keep decisions deterministic and separately testable. Test against synthetic fixtures first, then inspect all three local examples using the same production parser (not a parallel Python implementation).

Gate: the sample structures can be represented through selections/mappings without file-specific parser branches; all decision-table cases have tests.

### Phase 4: Wizard and Project Actions integration

Implement the staged UI and controller. Provide physical row/column labels, section/category bulk controls, review filters (All / Needs review / Ready / Excluded), and inline resolutions. Paginate large previews rather than rendering every cell. Preserve keyboard navigation, labels, focus on stage changes, error announcements, and a usable narrow-screen layout. Use existing brand styles and add scoped CSS.

Gate: a DOM interaction test completes a synthetic import preview; Back/mapping changes invalidate dependent decisions correctly; cancellation writes nothing. No repeated `window.confirm` per row.

### Phase 5: Atomic commit and reporting

Implement repository transaction and integration with edit coordinator. Test IndexedDB behavior using existing `fake-indexeddb` infrastructure. Add report generation and success/error display. Keep JSON backup import separate.

Gate: revision, failure, retry, quota, ownership, and double-submit tests pass; existing Project edits are not lost; no partial import is persisted.

### Phase 6: Full verification and documentation

Run targeted new tests, then existing web tests once to check Project regressions. Use portable Node commands from `codex.md`:

```powershell
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' ./node_modules/typescript/bin/tsc
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' ./node_modules/vitest/vitest.mjs run
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' ./node_modules/vite/bin/vite.js build --outDir dist-check --configLoader native
```

Use escalation for the build per repository guidance. Do not use `npm run` for checks. Dataset validation is unnecessary unless data packages were changed, which is outside this scope. Perform a local visual check if browser access works; otherwise report the limitation and provide the preview URL for manual review. Verify report/CSV content directly; do not attempt in-app browser download-event verification.

Update `architecture_overview.md`, `docs/implementation_notes.md`, `user_workflow.md`, and `project_roadmap.md` to describe the implemented behavior and limits. Update `docs/data_schema.md` only where it documents Project schema. Do not describe planned functionality as already available.

Final handoff must list changed files, test/build outcomes, sample acceptance results, storage/schema changes, and any unsupported cases. A successful build alone does not establish correct importing.

## 13. Definition of done

- An engineer can select an existing example's primary item area without editing the workbook first.
- Groups and alternatives are visible and controllable before import.
- Custom construction items contribute to Construction Costs without fabricating catalog identity.
- Canonical description/unit decisions follow the rules above; source quantity/cost are preserved unless explicitly changed.
- Every nonblank selected row has a visible outcome and source locator.
- Totals, allowances, and formula failures cannot silently change the estimate's meaning.
- Import is atomic, recoverable, and compatible with existing Projects/backups.
- Imported data remains private browser Project data and never modifies public evidence datasets.
- All required checks and documentation updates are complete, with limitations stated accurately.

## 14. Implementation completion log

### Phase 1 — Category model and compatibility (complete)

- Files changed: `src/projects/projectWorkspace.ts`, `src/projects/projectRepository.ts`, `src/projects/projectBackup.ts`, `src/ui/renderProjectWorkspace.ts`, `src/ui/renderApp.ts`, `src/ui/exportProjectCsv.ts`, `src/styles.css`, `architecture_overview.md`, and related tests.
- Checks: TypeScript typecheck; focused Project storage/CSV tests (56 passed); full web suite at the time (109 passed); `git diff --check`.
- Result: schema v10, independent cost categories, legacy normalization, provenance compatibility, category-aware Project UI/totals/CSV, and custom-construction persistence are implemented.

### Phase 2 — Workbook adapter and fixtures (complete)

- Files changed: `package.json`, `package-lock.json`, `src/projects/excelImport/types.ts`, `src/projects/excelImport/readWorkbook.ts`, `src/projects/excelImport/importWorker.ts`, `src/projects/excelImport/readWorkbook.test.ts`, `src/projects/excelImport/fixtures/sparse-reader-fixtures.xlsx`, `src/projects/excelImport/fixtures/README.md`, `scripts/generate_excel_import_fixtures.mjs`, and this plan.
- Checks: official SheetJS CE 0.20.3 tarball installed from `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`; binary fixture regenerated from the pinned package; focused reader tests (3 passed); full web suite (112 passed); TypeScript typecheck; `git diff --check`.
- Result: the worker boundary and sparse reader preserve physical coordinates, typed/formatted values, cached and missing formula results, merge metadata, hidden metadata, print areas, and bounded-reader errors. No Project state is read or written by Phase 2.
- At Phase 2 completion, the worker was intentionally not connected to Project Actions; layout detection, mapping, matching, review UI, atomic commit, and full private-workbook acceptance were deferred to later phases.

### Phase 3 — Layout, mapping, matching, and resolution (complete)

- Files changed: `src/projects/excelImport/types.ts`, `src/projects/excelImport/detectLayout.ts`, `src/projects/excelImport/parseRows.ts`, `src/projects/excelImport/matchRows.ts`, `src/projects/excelImport/resolveDraft.ts`, `src/projects/excelImport/selectionRules.ts`, `src/projects/excelImport/layoutMappingMatching.test.ts`, `architecture_overview.md`, and this plan.
- Checks: TypeScript typecheck; focused layout/mapping/matching/resolution tests (8 passed); full web suite (120 passed); `git diff --check`.
- Result: pure modules now provide deterministic header/section suggestions, physical-range selection and overlap checks, duplicate mapping validation, sparse row extraction, strict numeric parsing, hidden/merged/formula issue reporting, exact state/agency catalog matching, explicit description/unit conflict states, duplicate warnings, custom/catalog/allowance/incomplete resolution, category precedence, recalculated totals, and import provenance. Identical overlapping rows deduplicate; conflicting mapping policy blocks the overlap.
- Supplied-workbook inspection through the same production reader: `OPCC Template.xlsx` selected `Estimate!B11:H143` yielded 133 item-classified rows; `132nd and Giles - Cost Estimate.xlsx` selected `Concept 1A!B13:F95` yielded 83 physical rows including repeated headers/section and blank rows for review; `Ida Street _30Cost_Estimate.xlsx` selected `Ida Street Imp!B12:F131` yielded 120 physical rows while columns G:S remained outside the selected primary area. The 132nd/Giles workbook exposed six visible Concept sheets and five hidden/support sheets; Ida exposed its separate `Sheet1`; neither is auto-combined.
- At Phase 3 completion, worker/controller wiring and wizard review controls remained deferred; Phase 4 now covers those controls, while atomic repository commit, report generation, full browser interaction, and final production build remain in Phases 5–6.

### Phase 4 — Wizard and Project Actions integration (complete)

- Files changed: `src/ui/renderExcelImport.ts`, `src/ui/excelImportController.ts`, `src/ui/renderProjectWorkspace.ts`, `src/ui/renderApp.ts`, `src/styles.css`, `src/ui/excelImport.test.ts`, `architecture_overview.md`, and this plan.
- Result: Project Actions now exposes `Import From Excel`. The staged flow reads through the dedicated worker, selects worksheets and explicit physical ranges, exposes hidden-row policy and section inclusion, maps physical columns with duplicate validation, applies group/category source policies, classifies and matches rows, supports review filters and row decisions, paginates previews, and prepares a detached result draft. A manual range control excludes helper/export columns such as OPCC's working cells. Back, cancel, state navigation, file replacement, and mapping/selection changes terminate or invalidate stale work; no repository write occurs during preview.
- Checks: TypeScript typecheck; focused DOM wizard/lifecycle tests (2 passed); full web suite (122 passed); Phase 4 production bundle to ignored `dist-check`; `git diff --check`.
- Atomic Project append/new-Project commit, revision/conflict/ownership handling, report generation, final result persistence, and private-workbook acceptance were completed in Phases 5–6.

### Phase 5 — Atomic commit and reporting (complete)

- Files changed: `src/projects/projectRepository.ts`, `src/projects/projectEditCoordinator.ts`, `src/ui/excelImportController.ts`, `src/ui/renderExcelImport.ts`, `src/ui/renderApp.ts`, `src/ui/excelImportReport.ts`, `src/projects/projectStorage.test.ts`, `src/ui/excelImport.test.ts`, `architecture_overview.md`, and this plan.
- Result: accepted rows now commit through an optimistic repository method that snapshots the exact pre-import Project and appends all lines in one `projects` + `revisions` transaction. New Projects are created with accepted lines in their initial write. The app flushes pending edits before the baseline and commit, rechecks Project identity/state/status/revision and edit ownership, retains drafts on conflicts/storage failures, and prevents concurrent submissions. CSV diagnostics are available before and after commit with source locators, original/final values, outcomes, reasons, identity, category, totals, differences, and resulting line IDs; formula-like text is escaped.
- Checks: TypeScript typecheck; focused Project/repository/import suite (56 passed); report escaping, commit failure/retry, and double-submit coverage; `git diff --check`.
- Full web suite/build, private-workbook acceptance recording, and remaining documentation updates were completed in Phase 6.

### Phase 6 — Full verification and documentation (complete)

- Files changed: `docs/implementation_notes.md`, `user_workflow.md`, `project_roadmap.md`, `docs/data_schema.md`, `architecture_overview.md`, and this plan.
- Checks: TypeScript typecheck passed; full web suite passed (17 files, 125 tests); production Vite build passed to ignored `dist-check`; `git diff --check` passed. The build and full suite required the documented elevated Windows execution because sandboxed Vite worker creation returns `spawn EPERM`.
- Visual check: local Vite server loaded in the in-app browser; Project Actions exposed `Import From Excel`, and the file/destination wizard rendered with the expected accessible controls and responsive layout.
- Supplied-workbook acceptance through the production reader and parser passed using the selected primary ranges: OPCC `Estimate!B11:H143` (133 physical/item rows); 132nd/Giles `Concept 1A!B13:F95` (83 physical rows, 26 item rows, 5 repeated headers, 33 ambiguous rows, 19 blank rows); Ida Street `Ida Street Imp!B12:F131` (120 physical rows, 47 item rows, 6 repeated headers, 31 ambiguous rows, 36 blank rows). The tests confirmed helper/export columns and alternative sections remain explicit user choices.
- Result: user, schema, roadmap, implementation, architecture, and plan documentation now describe the implemented `.xlsx` import workflow, independent cost classification, atomic persistence, diagnostics, limits, and unsupported cases. No private workbook was copied into the repository and no public evidence data was changed.
