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
- Same-unit records are required for price recommendations.
- The UI already shows recommendation, price distribution, comparable records, warnings, and improve-confidence actions.
- Synthetic demo data is labeled as demo data.

Current gaps identified by roadmap and engineer feedback:

- Search still feels like a free-text funnel, even though item code is the most reliable key.
- Unit and county/region are free text, which allows avoidable spelling and wording errors.
- A conflicting description can be entered with a valid item code and still produce high confidence.
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

- Replace or supplement the free-text item-code input with a controlled item-code selector sourced from `agency_items.csv`.
- When the user selects an item code, auto-populate the official description and official unit.
- Treat description as supporting context, not the primary pricing path when item code is known.
- Make quantity the main user-entered field after item code selection.
- Keep state and work type controlled.

Expected behavior:

- Selecting `304-06007` fills `AGGREGATE BASE COURSE (CLASS 6)` and `CY`.
- User can still clear the query and reset the demo example.
- Pricing runs against the selected item code and same-unit records.

Documentation impact:

- Update `user_workflow.md` preferred input order.
- Update `architecture_overview.md` only if the matching/data flow changes.

### Increment 2: Description Helper Before Pricing

Purpose:

Let users search by description only when they do not know the pay item code, but prevent description search from being mistaken for a final pricing path.

Recommended changes:

- Add a description helper mode that suggests likely item codes or item families.
- Show suggested item code, official description, official unit, and match reason.
- Require the user to select or confirm an item code before showing a high-confidence price recommendation.
- If description-only pricing remains available, cap confidence below `High` and label it as weaker evidence.

Expected behavior:

- Searching `aggregate base class 6` suggests `304-06007`.
- Searching `traffic signal pole` does not produce high-confidence aggregate base pricing.

Documentation impact:

- Update `user_workflow.md`.
- Update confidence documentation if confidence behavior changes.

### Increment 3: Item-Code and Description Mismatch Guard

Purpose:

Prevent the exact issue reported by the engineer: a valid item code paired with an unrelated description can still return high confidence.

Recommended changes:

- Compare the canonical item family implied by the selected item code against the canonical item family implied by the entered description.
- Add a visible warning when they conflict.
- Cap confidence at `Low` or `Not supportable` when the conflict is material.
- Add improve-confidence guidance telling the user to correct either the item code or description.

Expected behavior:

- Item code `304-06007` plus description `traffic signal pole` triggers a mismatch warning.
- The result does not show `High` confidence.
- The top results may still be shown as item-code evidence, but the warning must be prominent.

Documentation impact:

- Update `architecture_overview.md` matching rules.
- Update `user_workflow.md` warning examples.

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

1. Increment 3: Item-code and description mismatch guard.
2. Increment 1: Item-code-first search funnel.
3. Increment 4: Controlled unit and county/city inputs.
4. Increment 6: Quantity context in price distribution.
5. Increment 5: Source provenance and project traceability.

Reason:

- The mismatch guard addresses a confirmed correctness issue.
- Item-code-first search addresses the strongest engineer recommendation.
- Controlled inputs reduce avoidable user error.
- Quantity and source context improve reviewer trust without expanding product scope.

Increments 2, 7, 8, and 9 can be implemented independently or alongside the sequence above when scope allows.

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

### Clear and reset

Actions:

```text
Click Clear.
Click Reset example.
```

Expected:

- Clear removes current query values.
- Reset restores the demo example.
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
- The app warns when item code and description conflict.
- Unit and geography inputs are controlled or clearly constrained.
- Source provenance is clear enough to distinguish estimate-style and bid-style evidence.
- Price distribution includes quantity context.
- Smoke tests cover the main validated scenarios.
- Relevant documentation is current.

