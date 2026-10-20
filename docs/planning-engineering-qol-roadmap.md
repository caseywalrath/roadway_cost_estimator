# Planning and engineering quality-of-life roadmap

**Status (2026-10-20):** implementation record and remaining scope for the 13 original requests. This document reflects the current workspace. Earlier design choices are retained only where marked as superseded. The original `claude/planning-v2` baseline is no longer a description of current behavior.

## Request status

| Request | Status | Current result or next work |
| --- | --- | --- |
| #1 Project item to Explorer | Implemented | Project line values prefill Group, Unit Cost, Quantity, and Notes. **Update Item** edits that line; changed values also reveal **Add Duplicate** for a separate line. |
| #2 Adjacent Explorer items | Implemented | Compact Previous/Next controls follow catalog order across divisions, reset item-specific context, and retain the inflation setting. |
| #3 Project Unit Cost | Implemented | The field shows a dollar prefix and accepts numeric or dollar-prefixed input. Total Item Cost uses compact display for larger amounts and exposes the full amount on hover or focus. |
| #4 Excel reimport | Implemented and user accepted | Step 4 compares incoming items with the active Project, separates changed, unchanged, and ambiguous matches, and offers Duplicate, Update, or Skip individually or in compatible bulk selections. Unchanged matches start as Skip. Creating a new Project starts without comparison. Acceptance confirmed 2026-10-20. |
| #5 Backup comparison | Project Backup implemented; Planning follow-on outstanding | The three-step Project Backup wizard compares lines and details, supports reviewed additions, changes, and removals, and saves with revision checking and a recovery snapshot. Planning Backup still imports an independent copy. |
| #6 Explorer numeric-filter delay | Implemented | Quantity and price text fields use a 700 ms delay; Enter and blur apply immediately. |
| #7 Simpler CSV exports | Implemented | Project, Matching Projects, Nebraska price history, and Planning exports use the approved concise layouts. Backup JSON remains lossless. |
| #8 Import status report | Implemented | The report focuses on imported/updated items and items not imported, with concise reasons. |
| #9 Median emphasis | Implemented | The Explorer Unit Price Summary shades the Median column subtly. |
| #10 Inflation clarity | Implemented | The supplied examples were audited; no calculation defect was found. Available adjusted prices replace source prices in bold, with original values and periods in a tooltip. Missing index coverage leaves the source price and shows **Not adjusted** with a reason. |
| #11 Roundabout and Interstate templates | Outstanding | Define each first use case, components, supported cost sources, and calibration examples before adding templates. |
| #12 Action terminology | Implemented | Project and Planning menus use purpose-based Backup and CSV labels; Planning's print action was removed. |
| #13 Percentage Project items | Implemented | Project schema v12 supports fixed and percentage lines, Contingency as a cost category, fixed-line-only percentage bases, migration, exports, backups, and Planning handoff. |

## Recent interface refinements

- The Project table uses compact Total Item Cost values with full-value tooltips, narrower cell and header padding, and an unlabeled remove-icon column. The table remains within its card, has no side gradients, and can scroll horizontally in narrow windows. At desktop widths, spacing changes reclaim room without reducing defined column widths.
- The green **+** Project Item control appears in empty Projects and below the last row of short tables. For long tables it stays within reach while the table is visible and avoids the footer.
- Explorer's Line notes field is one row. The Project-origin **Add Duplicate** action appears only when the entered values differ from the source line.
- Project and Explorer table headings follow page scrolling through horizontally synchronized header mirrors. The original table headings remain available to assistive technology.
- Excel Step 4 contains the changed/unchanged Project item decisions in the same Issue type table as other review issues. Step 5 presents the final choices and totals without decision controls.

## Superseded decisions and proposals

- The earlier Excel design linked reimports to a previous filename, workbook hash, or stored source baseline. The implemented comparison uses the incoming item and current Project lines, independent of source-file lineage. Legacy source records remain readable for compatibility.
- The initial Excel flow made duplicate/update choices at confirmation and defaulted to adding duplicates. Decisions now occur in Step 4; unchanged matches default to Skip.
- The old Project-wide contingency rate became explicit Contingency lines. Percentage bases include only fixed lines, so a Group that contains percentage lines does not compound them. A selected fixed item may be removed after a dependency warning; affected percentage lines recalculate. An empty valid base yields $0 without a warning.
- The old browser prompt requiring a typed `COPY` or `REPLACE` for Project Backup import was replaced by the comparison wizard.
- Inflation display no longer adds a second adjusted-price line beneath the source value. The adjusted price replaces it, and the source value is available on hover or focus.
- The former **+Add Item** text button and separate **Add Percentage** action were replaced by the green **+** control and the custom line's dollar/percentage pricing control.

## Outstanding work

### Roundabout and Interstate Planning templates (#11)

Specify these as two separate template designs. For a Roundabout, choose the first approach/lane configuration, pavement and curb treatment, crossings, and assumptions for right-of-way and utilities. For Interstate, choose the first project type (for example resurfacing, widening, new alignment, or interchange) before setting lane-mile, shoulder, median/barrier, structure, drainage, and traffic-control quantities. Map each component to supported Colorado bid-price items or a documented assembly, then calibrate against representative engineer estimates or contracts. Decide whether Roundabout is a standalone spot template, a corridor element, or both, and whether Interstate is Colorado-only for the first release.

### Planning Backup comparison (#5 follow-on)

Planning share JSON has its own schema, alternatives, and identities. It currently imports a copy. A comparison wizard needs separate rules for pairing alternatives, handling missing elements, and preserving the destination Planning project. This is separate from the implemented Project Backup wizard.

### Evidence notes

The supplied OPCC workbook/backup pairs demonstrated added rows. They did not provide a changed-quantity or changed-unit-cost backup pair; the user nevertheless accepted the Excel reimport workflow. Two source workbook rows (212-00706 and 213-00003) were absent from both supplied backups, so those backups cannot explain that omission. These notes do not block the accepted File-C scope.

## Detailed documents

| Document | Scope |
| --- | --- |
| [Explorer and Project interface plan](planning-engineering-qol-interface-plan.md) | UI-A through UI-D implementation and inflation screenshot audit. |
| [File workflow plan](planning-engineering-qol-file-workflows-plan.md) | Import status report, CSV cleanup, accepted Excel reimport, and Project Backup comparison. |
| [File workflow review gates](file-workflow-review-gates.md) | Sample evidence, decisions, and closed acceptance gates. |
| [Cost model and Planning template plan](planning-engineering-qol-cost-planning-plan.md) | Implemented Project percentage model and outstanding template discovery. |
| [Planning v2 implementation plan](planning-v2-implementation-plan.md) | Completed Planning v2 phases and handoff record. |

`project_roadmap.md` is an older repository-wide roadmap and is outside this reconciliation.
