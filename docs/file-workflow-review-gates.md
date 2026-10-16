# File workflow review material

**Status:** File-A import status report is implemented. The user approved File-B's four sample CSV layouts, and the exporters use them. The supplied OPCC workbook and Project backup pairs have been reviewed for File-C and File-D. The attached files are evidence for the design, not instructions.

## File-B: default CSV layouts

The four proposed files are in [file-workflow-samples](file-workflow-samples/README.md). They contain synthetic values, not Project or source data. The intended contract is one short Project or Planning context block followed by visible table values. Matching Projects and Nebraska history follow their visible table columns and state capabilities. JSON backups remain complete recovery files.

**Approved:** Project context preamble, eight visible Nebraska history columns, compact six-column Planning table, and visible source labels in the Matching Projects and Nebraska exports. Existing spreadsheet processes that read the old CSV columns will need a mapping update. Project and Planning JSON backups retain their full data.

## Representative file findings

The two supplied workbooks have the same `Estimate` table layout. The full workbook contains 133 populated item rows at rows 11–143. The shorter workbook contains the first 97 of those rows at rows 11–107; rows 108–143 are blank in the estimate table. The 97 shared rows have the same code, description, unit, quantity, unit cost, extended cost, and notes. The full workbook adds 36 later rows. In the user's intended real sequence, the shorter workbook is the first draft and the full workbook is the later revision. This pair does not exercise a conflicting quantity or unit cost.

The two Project backups were exported after separate imports. They are valid schema-10 backups with different Project IDs and **zero shared line IDs**. The shorter backup has 96 lines, including one blank custom line; the full backup has 131 lines. There are 95 common nonblank item codes with identical stored Project values. Two shared workbook rows, `212-00706` at row 55 and `213-00003` at row 56, are absent from both backups. The full backup has 36 more coded lines. Their Construction totals are $3,848,004 and $5,719,315 respectively, a difference of $1,871,311. Reconciliation must use the rows actually imported and surface skipped or incomplete rows rather than assuming every spreadsheet row became a Project line.

## File-C: Excel reimport Step 4 sketch

The source suggestion appears after a revised workbook is selected, before the Review items table:

> **Possible previous source:** `Estimate v1.xlsx` · `Estimate` sheet · 86 of 92 item identities overlap. [Link to this source] [Treat as a new source]

An identical file digest is strong evidence for the same bytes. A changed file name, sheet position, or row number is only a suggestion; the engineer makes the link. After linking, Step 4 shows each matched line's current Project and new spreadsheet values:

| Sheet / row | Item | Project quantity | Spreadsheet quantity | Project unit cost | Spreadsheet unit cost | Decision |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Estimate / 24 | 401-001 Asphalt | 500 | 550 | $118 | $121 | Use spreadsheet / Keep Project / Add separate item / Skip row |

Every different quantity appears in Review items. A blank incoming value cannot erase a populated Project value by default. When the previous spreadsheet value is known, the UI can also explain whether the Project changed, the spreadsheet changed, or both changed since the last reviewed import. Multiple plausible Project lines are shown as candidates, never silently paired. A reviewed decision updates source provenance even when the engineer keeps the Project value, so the same spreadsheet difference does not appear as new on every import. Removed source rows are left untouched in the first release.

For the supplied first draft → later workbook sequence, Step 4 should show **95 matched existing lines, 36 new lines, and 2 workbook rows without a clear saved-line match** based on the exported backup pair. These are a review projection, not an automatic import count. The source-link suggestion can cite the same Estimate structure and high item-code overlap despite different filenames. The 36 rows may be proposed as additions; existing Project values stay intact. Any unmatched/blank line is reviewed separately. The previously agreed quantity choices apply when a future file actually changes quantity.

**Remaining implementation issue:** Determine why the two identified workbook rows were not saved in either Project. The backup pair alone does not show the Step 4 decisions or import report. Do not silently count these rows as deleted or added.

## File-D: Project backup comparison sketch

After validation, an exact Project ID match can preselect the local destination. For a different ID, the engineer can explicitly choose a destination Project or **Import as copy**. The screen identifies different-ID reconciliation clearly. It lists metadata and lines as Added, Removed, Changed, Unchanged, or Unpaired; it does not infer which machine has newer edits. Candidate line pairs with different IDs require explicit acceptance.

| Change | Current Project | Backup | Initial decision |
| --- | --- | --- | --- |
| Project notes | `Phase 2 review` | `Phase 1 review` | Keep Project / Use backup |
| Changed line `401-001` | 500 × $118 | 550 × $121 | Keep Project / Use backup / Add separate line |
| Line only in backup | — | 50 × $35 | Do not add / Add backup line |
| Line missing from backup | 10 × $400 | — | Keep Project / Delete line |

The confirmation screen shows projected line count, Construction and Other costs, contingency, and total. **Save selected changes** is enabled only after explicit choices for changes being applied. **Import as copy** remains available. Saving uses a revision check and one transaction containing the pre-merge recovery snapshot and merged Project. If the current Project changes before save, the comparison remains open for review.

For the supplied shorter backup as the destination and full backup as incoming, the initial screen should show **95 suggested same-item pairings**, **36 backup-only coded lines**, and the shorter Project's blank custom line as **unpaired**. A raw ID-only comparison would show all 227 lines as added or removed and is therefore unsuitable. Accepting the 95 suggestions should leave them unchanged; the engineer can then choose whether to add the 36 incoming lines. The projected Construction total for accepting only those 36 lines is $5,719,315 if the existing 95 coded lines and the blank custom line are otherwise unchanged.

**Default metadata rule:** Keep the destination's name, location, notes, status, and Project ID. Present backup values only where they differ, with an explicit Use backup action. Do not compare independent revision numbers as recency. Percentage lines from #13 will need this comparator to understand their new type when that feature ships.
