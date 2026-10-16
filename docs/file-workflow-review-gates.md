# File workflow review material

**Status:** File-A import status report is implemented on `codex/file-workflow-qol`. File-B sample CSVs are ready for engineer review. File-C and File-D save behavior awaits review with representative files.

## File-B: default CSV layouts

The four proposed files are in [file-workflow-samples](file-workflow-samples/README.md). They contain synthetic values, not Project or source data. The intended contract is one short Project or Planning context block followed by visible table values. Matching Projects and Nebraska history follow their visible table columns and state capabilities. JSON backups remain complete recovery files.

**Decision needed:** Confirm the sample layouts, including the compact six-column Planning table. If an engineer imports an existing CSV into another spreadsheet, identify any old column that must remain for that workflow before the default exporter changes.

## File-C: Excel reimport Step 4 sketch

The source suggestion appears after a revised workbook is selected, before the Review items table:

> **Possible previous source:** `Estimate v1.xlsx` · `Estimate` sheet · 86 of 92 item identities overlap. [Link to this source] [Treat as a new source]

An identical file digest is strong evidence for the same bytes. A changed file name, sheet position, or row number is only a suggestion; the engineer makes the link. After linking, Step 4 shows each matched line's current Project and new spreadsheet values:

| Sheet / row | Item | Project quantity | Spreadsheet quantity | Project unit cost | Spreadsheet unit cost | Decision |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Estimate / 24 | 401-001 Asphalt | 500 | 550 | $118 | $121 | Use spreadsheet / Keep Project / Add separate item / Skip row |

Every different quantity appears in Review items. A blank incoming value cannot erase a populated Project value by default. When the previous spreadsheet value is known, the UI can also explain whether the Project changed, the spreadsheet changed, or both changed since the last reviewed import. Multiple plausible Project lines are shown as candidates, never silently paired. A reviewed decision updates source provenance even when the engineer keeps the Project value, so the same spreadsheet difference does not appear as new on every import. Removed source rows are left untouched in the first release.

**Decision needed with two workbook versions:** Confirm whether the source-link wording is clear; whether a quantity decision may be applied to several selected rows after those rows are visible; and whether the four row actions express the desired choices. The source files will also expose real column, row, and Group changes before save rules are finalized.

## File-D: same-ID Project backup comparison sketch

After validation, importing a backup with the same Project ID opens a comparison screen. A different ID retains **Import as copy**. The screen lists metadata and lines as Added, Removed, Changed, or Unchanged; it does not infer which machine has newer edits.

| Change | Current Project | Backup | Initial decision |
| --- | --- | --- | --- |
| Project notes | `Phase 2 review` | `Phase 1 review` | Keep Project / Use backup |
| Changed line `401-001` | 500 × $118 | 550 × $121 | Keep Project / Use backup / Add separate line |
| Line only in backup | — | 50 × $35 | Do not add / Add backup line |
| Line missing from backup | 10 × $400 | — | Keep Project / Delete line |

The confirmation screen shows projected line count, Construction and Other costs, contingency, and total. **Save selected changes** is enabled only after explicit choices for changes being applied. **Import as copy** remains available. Saving uses a revision check and one transaction containing the pre-merge recovery snapshot and merged Project. If the current Project changes before save, the comparison remains open for review.

**Decision needed with a realistic pair of backups:** Confirm the comparison grouping, the default to keep current lines, and which metadata fields should be presented. Same-looking lines with different IDs are suggestions that require explicit pairing. Percentage lines from #13 will need this comparator to understand their new type when that feature ships.
