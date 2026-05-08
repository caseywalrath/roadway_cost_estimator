# Prototype Phase 2 Plan

## Purpose

This document consolidates the current roadmap, product notes, and roadway engineer feedback into a practical next-phase plan.

Phase 2 should improve the current one-item comparable workflow. It should not become a full estimator, spreadsheet importer, chatbot, or private-data system yet.

Primary goal:

```text
Make the item lookup workflow clear, controlled, and defensible enough that roadway engineers can validate whether the comparable-selection logic is useful.
```

## Source Inputs Reviewed

- `architecture_overview.md`
- `codex.md`
- `project_roadmap.md`
- `docs/data_schema.md`
- `docs/implementation_notes.md`
- `user_workflow.md`
- `Engineer feedback round 1.docx`
- `Product pathway.docx`

## Current Product Position

The current prototype is a static GitHub Pages-ready Vite and TypeScript app.

Current strengths:

- One-item roadway bid item lookup exists.
- Exact agency item-code matches are already scored above description matches.
- The item-code entry path now uses a CDOT division, section/prefix, and item-result funnel instead of a single long dropdown.
- The item picker now has the full public CDOT 2026 item-code book for lookup, with 4,771 valid item-code rows across 100 loaded prefixes.
- Same-unit records are required for price recommendations.
- The UI already shows recommendation, price distribution, comparable records, warnings, and improve-confidence actions.
- Synthetic demo data is labeled as demo data.

Current gaps identified by roadmap and engineer feedback:

- Full item-code lookup data is now available, but search still needs real public cost observations to validate pricing behavior at CDOT scale.
- Unit and county/region are free text, which allows avoidable spelling and wording errors.
- The normal UI now prevents a user-entered item-code/description conflict by requiring selection from official item records, but the matching engine still lacks a defensive guard for crafted or future editable queries.
- Source labels do not clearly distinguish FHU estimates, contractor bid tabs, public data, submittal level, and source reliability.
- Project number is not shown.
- Price distribution does not show the quantity context behind low, median, high, or quartile values.

## Phase 2 Non-Goals

Do not include these in the next implementation phase unless explicitly reprioritized:

- Full estimate upload.
- Multi-row estimate workspace.
- Private FHU data import.
- Chat interface.
- Automatic PDF, DOCX, or XLSX parsing.
- Unit conversion rules.
- Escalation or inflation adjustment.
- Database, authentication, or server backend.

## Recommended Increment Sequence

Each increment should be implemented on its own branch or as a clearly separated commit. Each increment should update documentation when behavior, data contracts, or user workflow changes.

### Increment 1: Item-Code-First Search Funnel

Purpose:

Make item code the primary path to pricing.

Recommended changes:

- Replace the single item-code selector with a controlled CDOT division, section/prefix, and item search funnel.
- Source item-level options from `agency_items.csv`.
- Source division and section labels from `spec_sections.csv`.
- Search loaded agency items by full item code, suffix after the hyphen, or official description.
- Let Search work directly across all loaded items when Division and Section are blank; use Division and Section as narrowing filters when selected.
- When the user selects an item result, auto-populate the official item code, description, and unit.
- Treat description as supporting context, not the primary pricing path when item code is known.
- Make quantity the main user-entered field after item code selection.
- Keep state and work type controlled.

Expected behavior:

- The default example loads Division `300`, Section `304`, item `304-06007`, `AGGREGATE BASE COURSE (CLASS 6)`, and `CY`.
- With no Division or Section selected, searching an exact item code such as `403-09221` can find that item directly.
- Selecting Division `400`, Section `403`, then searching `HMA` can select `403-09221`.
- The loaded item-code book includes 4,771 item-code rows across 100 prefixes, while only existing mapped demo rows have comparable pricing records.
- Selecting `304-06007` fills `AGGREGATE BASE COURSE (CLASS 6)` and `CY`.
- User can still clear the query.
- Pricing runs against the selected item code and same-unit records.

Documentation impact:

- Add `spec_sections.csv` to `docs/data_schema.md`.
- Update `user_workflow.md` preferred input order.
- Update `architecture_overview.md` to describe the section-based item picker.

### Increment 2: Description Helper Before Pricing

Status:

Addressed by Increment 1 / no standalone implementation currently needed.

Purpose:

Let users search by description only when they do not know the pay item code, but prevent description search from being mistaken for a final pricing path.

Current resolution:

The concerns behind this increment have been addressed to the developer's satisfaction by the current item-code-first search funnel. The current Search field already searches `agency_items.csv` by full item code, suffix after the hyphen, and official description. The user must select an official item result before normal pricing runs. Selection auto-fills the submitted item code, official description, and official unit.

The normal UI does not submit description-only pricing because the Description and Unit fields are readonly, and the item-picker `Search` text is not submitted as the pricing description. This keeps description text in a helper role instead of making it a final pricing path.

Recommended changes:

- No standalone implementation is currently needed.
- If reviewer confusion appears, improve the Search label or help text so it is clear that official-description search is already supported.
- Optionally show match-reason labels on item results, such as official description match, item-code match, or suffix match.
- Optionally add a defensive matching-engine guard against description-only pricing as part of Increment 3 or Increment 9.

Expected behavior:

- Searching `aggregate base class 6` in the current item picker can surface `304-06007`.
- Selecting `304-06007` fills the official item code, `AGGREGATE BASE COURSE (CLASS 6)`, and `CY`.
- Searching `traffic signal pole` through the normal UI does not produce high-confidence aggregate base pricing unless an official item result is selected.
- Increment 3 remains the next higher-value correctness item because formal item-code/description mismatch detection is not yet implemented in matching logic.

Documentation impact:

- No additional documentation change is required for the current decision.
- Update `user_workflow.md` only if the Search label, help text, or item-result behavior changes later.
- Update confidence documentation only if a defensive matching-engine guard changes confidence behavior later.

### Increment 3: Item-Code and Description Mismatch Guard

Status:

Addressed for current UI workflow / no immediate user-facing implementation needed.

Purpose:

Prevent the exact issue reported by the engineer: a valid item code paired with an unrelated description can still return high confidence.

Current resolution:

The current item-code-first search funnel prevents this issue in normal browser use. The Search field only filters selectable official agency items. Selecting an item result fills the submitted item code, official description, and official unit from the same `agency_items.csv` row. The Description and Unit fields are readonly, and changing Division or Section clears the selected item.

Because the item-picker `Search` text is not submitted as the pricing description, a normal user cannot submit `304-06007` with `traffic signal pole` as the description through the current UI.

Remaining technical cleanup:

The matching engine still does not compare the canonical family implied by an item code against the canonical family implied by a submitted description. If future workflows add editable descriptions, imports, API-style query entry, or tests that call `scoreComparableItems()` directly with crafted query values, a defensive mismatch guard should be added before those workflows are trusted.

Recommended changes:

- No immediate user-facing implementation is needed for the current picker workflow.
- Keep the defensive matching-engine guard as a future cleanup before editable descriptions, estimate imports, API-style query entry, or automated matching tests.
- If implemented later, compare the canonical item family implied by the selected item code against the canonical item family implied by the submitted description.
- If implemented later, add a visible warning and cap confidence at `Low` or `Not supportable` when the conflict is material.

Expected behavior:

- Current normal UI prevents a user from submitting item code `304-06007` plus description `traffic signal pole`.
- Current normal UI keeps selected item code, official description, and official unit synchronized from the selected agency item.
- A future defensive engine guard should reject or downgrade crafted mismatched queries before any workflow allows editable descriptions or imported rows.

Documentation impact:

- No additional documentation change is required for the current decision.
- Update `architecture_overview.md` and `user_workflow.md` only if a future defensive matching-engine guard changes runtime matching behavior.

### Increment 4: Controlled Unit and County/City Inputs

Purpose:

Reduce input errors from spelling, abbreviations, and ambiguous geography labels.

Recommended changes:

- Replace unit free text with a dropdown derived from known units in the data package or from official item unit.
- Rename `County / region` to `County / City` unless CDOT region numbers are added.
- Replace free-text geography with controlled options derived from project data.
- Include a statewide or blank option when geography is unknown.

Expected behavior:

- Unit options include only known normalized units such as `CY`, `TON`, `SY`, `LF`, and `EA`.
- Geography options use clear labels such as `Douglas`, `Boulder`, or `Statewide`.
- The UI no longer implies CDOT region unless CDOT region data exists.

Documentation impact:

- Update `user_workflow.md`.
- Update `docs/data_schema.md` only if the data contract changes.

### Increment 5: Source Provenance and Project Traceability

Purpose:

Clarify what each price represents and where it came from.

Recommended changes:

- Add FHU project number or project number support to project records.
- Show project number in the comparable projects table when available.
- Separate source concepts more clearly:
  - public cost book
  - public bid tab or awarded bid
  - FHU engineer estimate
  - FHU bid tab or post-bid data
- Show estimate submittal level for internal FHU estimate records when available, such as `30%`, `60%`, `90%`, or `AD`.
- Keep all current demo data clearly labeled as synthetic.

Expected behavior:

- Users can see whether a unit price came from a contractor bid-style source or an engineer-estimate-style source.
- Internal estimate-style records show submittal level when the data exists.
- No private FHU data is committed to the public repository.

Documentation impact:

- Update `docs/data_schema.md` if fields are added.
- Update `architecture_overview.md` data governance if source handling changes.
- Update `user_workflow.md` source-review instructions.

### Increment 6: Quantity Context in Price Distribution

Purpose:

Show the quantity behind the displayed price statistics.

Recommended changes:

- Extend price summary data so low and high values include the supporting record quantity and project.
- For median and quartiles, decide whether to show:
  - exact supporting record when the percentile lands on one record, or
  - nearest lower and upper supporting records when the percentile is interpolated.
- Display quantity context under each distribution marker.

Expected behavior:

- Low price displays price, unit, supporting quantity, and project.
- High price displays price, unit, supporting quantity, and project.
- Median and quartiles explain whether they are exact record values or interpolated values.

Documentation impact:

- Update `architecture_overview.md` if `PriceSummary` structure changes.
- Update `user_workflow.md` price-distribution explanation.

### Increment 7: Reviewer-Focused Result Explanation

Purpose:

Make it easier for roadway reviewers to validate or reject a result.

Recommended changes:

- Show exact match type more visibly: exact item code, approved alias, keyword fallback, or description token fallback.
- Show excluded unit-mismatch count near results, not only in warnings.
- Add a compact `Why not included` explanation for excluded candidate records if a review mode is added.
- Consider a `Show all candidates` mode for reviewers.

Expected behavior:

- Reviewers can tell whether a comparable was selected because of item code, description mapping, unit, quantity, recency, geography, or source type.
- Weak evidence is visible before the user reads detailed warnings.

Documentation impact:

- Update `user_workflow.md`.
- Update `project_roadmap.md` only if sequencing changes.

### Increment 8: Demo Query Presets and Feedback Capture

Purpose:

Make engineer review sessions easier to run and easier to translate into development tasks.

Recommended changes:

- Add optional query presets for current demo item families.
- Add a small tester guide link or collapsible section.
- Add a `Copy query summary` or `Copy result summary` button.
- Use the feedback format already defined in `user_workflow.md`.

Expected behavior:

- A reviewer can run several known searches without typing every field.
- The user can copy a structured review note into an email, issue, document, or future task prompt.

Documentation impact:

- Update `user_workflow.md` if the in-app feedback flow changes.

### Increment 9: Matching and Confidence Test Coverage

Purpose:

Protect the matching rules while the UI and data model change.

Recommended changes:

- Add lightweight test coverage for exact-code, alias, keyword fallback, unit mismatch, no-match, and item-code/description mismatch cases.
- Add fixture checks for required CSV relationships:
  - every observation has a project.
  - every observation has a source.
  - every agency item maps to a canonical item.
  - units normalize consistently.
- Keep tests small and deterministic.

Expected behavior:

- The app does not regress on known reviewer concerns.
- Future data changes fail clearly when schema relationships break.

Documentation impact:

- Update `docs/implementation_notes.md` with test commands.
- Update `codex.md` only if a new local environment lesson is discovered.

## Suggested Implementation Order

Recommended first sequence:

1. Increment 1: Item-code-first search funnel.
2. Increment 4: Controlled unit and county/city inputs.
3. Increment 6: Quantity context in price distribution.
4. Increment 5: Source provenance and project traceability.
5. Defensive matching-engine guard from Increment 3 before editable descriptions, estimate imports, or automated matching tests.

Reason:

- The item-code-first search addresses the strongest engineer recommendation and now prevents normal item-code/description mismatch entry.
- Controlled inputs reduce avoidable user error.
- Quantity and source context improve reviewer trust without expanding product scope.
- The mismatch guard remains useful as defensive engine logic, but it is no longer the next user-facing implementation priority.

Increments 2, 3 defensive cleanup, 7, 8, and 9 can be implemented independently or alongside the sequence above when scope allows.

## Agent Validation Instructions

Before implementation:

1. Run `git fetch --all --prune`.
2. Confirm branch and status with `git status --short --branch`.
3. Review `codex.md`, `architecture_overview.md`, and this file.
4. Review any impacted docs before editing them.
5. Confirm whether the change affects:
   - app behavior,
   - data schema,
   - user workflow,
   - architecture,
   - local development instructions.

After each increment:

1. Run the relevant TypeScript/Vite build check.
2. If normal build is blocked by OneDrive `dist` locks, use the documented temporary `dist-check` build path.
3. Inspect the app locally if a dev server can run.
4. If browser automation is unavailable, use source inspection and user visual confirmation. Do not claim browser verification occurred.
5. Check `git diff` and confirm only intended files changed.
6. Update documentation in the same branch when behavior or data contracts changed.

Recommended build commands:

```text
C:\Users\Casey.Walrath\Tools\node\npm.cmd run build
```

Fallback build check:

```text
C:\Users\Casey.Walrath\Tools\node\node.exe .\node_modules\vite\bin\vite.js build --outDir dist-check
```

Remove `dist-check` after confirming it is inside the workspace and after verification is complete.

## Agent Smoke Test Scenarios

Run these scenarios after relevant increments:

### Baseline exact-code search

Input:

```text
Item code: 304-06007
Description: Aggregate Base Course Class 6
Unit: CY
Quantity: 1800
County / City: Douglas
Estimate year: 2026
Source scope: Public + internal demo data
```

Expected:

- Same-unit aggregate base records appear.
- Comparable table shows top ranked records.
- Confidence is not reduced by mismatch logic.
- Synthetic data warning remains visible.

### Item-code-only search

Input:

```text
Item code: 304-06007
Description: blank or auto-filled official description
Unit: auto-filled CY
Quantity: 1800
```

Expected:

- Official description resolves from `agency_items.csv`.
- Pricing uses same-code and same-unit records.
- User is not required to type the description manually.

### Description conflict search

Input:

```text
Item code: 304-06007
Description: Traffic signal pole
Unit: CY
Quantity: 1800
```

Expected:

- Visible mismatch warning.
- Confidence is not `High`.
- Improve-confidence guidance tells the user to correct item code or description.

### Description-helper search

Input:

```text
Description: aggregate base class 6
No item code selected
```

Expected:

- App suggests likely item code `304-06007`.
- App does not present description-only evidence as a high-confidence final recommendation.

### Unit mismatch search

Input:

```text
Item code: 304-06007
Unit: TON
Quantity: 760
```

Expected:

- Same-unit `TON` records are handled separately from `CY` records.
- Unit mismatch warnings or exclusions are visible.
- No cross-unit price recommendation is made without an approved conversion rule.

### Blank search

Input:

```text
No item code.
No description.
```

Expected:

- App asks for an item code or description.
- Confidence is `Not supportable`.
- No price recommendation is shown.

### Source scope toggle

Input:

```text
Run the same item with public-only, internal-only, and both source scopes.
```

Expected:

- Comparable count and source labels respond to scope.
- Source provenance remains clear.
- Internal demo records remain labeled as demo data.

### Clear query

Actions:

```text
Click Clear.
```

Expected:

- Clear removes current query values.
- Results update consistently.

## User Validation Instructions

The user should validate each completed increment in the browser after the agent reports a local URL or GitHub Pages preview.

User checks:

1. Confirm the first screen still explains that data is synthetic.
2. Run the baseline exact-code search.
3. Run the description conflict search with `304-06007` and `Traffic signal pole`.
4. Confirm that unit and geography inputs are understandable.
5. Confirm that source labels answer:
   - Is this public-style data or internal-style data?
   - Is this an engineer estimate or bid-style source?
   - Is the data synthetic demo data?
6. Confirm that price distribution context answers:
   - What quantity supports the low price?
   - What quantity supports the median or quartile?
   - What quantity supports the high price?
7. Record feedback using this format:

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

## Documentation Rules for Phase 2

Update documentation in the same branch as the behavior change.

Use these defaults:

- Update `architecture_overview.md` when matching flow, data flow, price summary structure, or major UI behavior changes.
- Update `docs/data_schema.md` when CSV columns, source metadata, or required fields change.
- Update `docs/implementation_notes.md` when build, test, or local verification commands change.
- Update `user_workflow.md` when the user-facing workflow changes.
- Update `project_roadmap.md` only when sequencing or priority changes.
- Update `codex.md` only for agent workflow or local environment lessons.

## Phase 2 Completion Criteria

Phase 2 is complete when:

- Roadway reviewers can use item code as the primary search path.
- Description search helps users find item codes without producing misleading high-confidence pricing.
- The normal UI prevents item-code/description conflicts, or the app warns and downgrades confidence before any future editable-description workflow is trusted.
- Unit and geography inputs are controlled or clearly constrained.
- Source provenance is clear enough to distinguish estimate-style and bid-style evidence.
- Price distribution includes quantity context.
- Smoke tests cover the main validated scenarios.
- Relevant documentation is current.
