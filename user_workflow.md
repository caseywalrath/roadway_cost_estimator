# User Workflow

## Purpose

This document describes the intended end-user workflow for the Roadway Cost Comparable Explorer prototype.

The prototype is a decision-support tool. It is not an automatic estimator, a chatbot, or a replacement for roadway engineering judgment.

The near-term user is expected to be a project manager, planner, estimator, or roadway reviewer who needs to understand whether a roadway bid item has defensible historical cost support.

## Current Prototype Workflow

### 1. Open the app

The user opens the static web app in a browser.

Expected current local URL:

```text
http://127.0.0.1:5173/
```

Expected future hosted URL:

```text
https://[organization-or-user].github.io/[repo-name]/
```

The first screen should show:

- project context bar
- prototype warning
- prototype review guide
- item explorer form
- recommendation and evidence panels

## 2. Confirm project context

The user reviews the context bar before searching.

Current context fields:

- State
- Region
- Work type
- Estimate year
- Source scope

Why this matters:

- State limits the source data to the correct agency and market.
- Region helps rank geographically relevant projects.
- Work type keeps roadway records separate from unrelated disciplines.
- Estimate year helps rank recent records.
- Source scope tells the reviewer whether evidence is public-style data, internal-style data, or both.

Current prototype default:

```text
Colorado | Douglas | Roadway | 2026 | Public + internal demo data
```

The context can be partial. Missing context should reduce confidence or produce review guidance rather than blocking the workflow.

## 3. Enter one roadway bid item

The user enters one item at a time in the Item Explorer.

The current picker includes a 200-row CDOT item-code sample for testing navigation across divisions and sections. Only the existing mapped demo items have comparable price records in the synthetic observation dataset.

Primary inputs:

- Division
- Section / prefix
- Search
- Selected item code
- Auto-filled description
- Auto-filled unit
- Quantity
- County / region
- Estimate year
- State
- Work type
- Source scope

Preferred input order:

1. Select the CDOT specification division if it helps narrow the item list.
2. Select the section / three-digit item-code prefix if it helps narrow the item list.
3. Search by full item code, suffix, or official item description if helpful.
4. Select the item result.
5. Confirm the auto-filled description and unit.
6. Enter the quantity.
7. Confirm county or region.
8. Confirm estimate year.
9. Search comparables.

Best current example:

```text
Item code: 304-06007
Division: 300 - Bases
Section / prefix: 304 - Aggregate Base Course
Description: AGGREGATE BASE COURSE (CLASS 6)
Unit: CY
Quantity: 1800
County / region: Douglas
Estimate year: 2026
```

Why one item at a time:

- It keeps the first prototype easy to validate.
- It lets roadway reviewers inspect matching logic before estimate-upload workflows are added.
- It avoids giving false confidence from unvalidated bulk parsing.

## 4. Review the recommendation summary

After searching, the user first reads the Recommendation Summary.

The summary includes:

- interpreted item
- unit
- quantity
- recommended range
- suggested unit price
- confidence
- comparable record count

How to use it:

- Treat the range as cost evidence, not a final estimate.
- Treat the suggested unit price as a starting point for review.
- Treat confidence as a triage signal.
- Use the info markers to understand what each value means.

Expected reviewer question:

```text
Does this result give enough evidence to support, challenge, or revise the current unit price?
```

## 5. Review the price distribution

The user checks the Price Distribution panel.

Current distribution fields:

- Low
- P25
- Median
- P75
- High

How to use it:

- Low and High show the full spread of matched same-unit records.
- P25 and P75 show the middle range of comparable evidence.
- Median is the current prototype's suggested unit price.

Reviewer interpretation:

- A narrow range may indicate consistent historical pricing.
- A wide range may indicate scope differences, market differences, sparse data, or outliers.
- A result with too few records should be treated as weak support.

## 6. Review the comparable projects table

The user reviews the top-ranked comparable records.

Current table columns:

- Rank
- Project
- Region
- Date
- Item
- Description
- Quantity
- Unit
- Unit price
- Why selected
- Source

How to use it:

1. Check whether the project names and regions make sense.
2. Check whether the item code and description are truly comparable.
3. Check whether the unit matches the searched item.
4. Check whether the quantity is similar enough to be useful.
5. Read the "Why selected" field to understand the matching logic.
6. Use the source label to understand where the record came from.

Expected roadway reviewer feedback:

- "This item mapping is correct."
- "This item mapping is too broad."
- "This source should be excluded."
- "This record is a valid comparable but needs an adjustment."
- "Quantity should matter more or less for this item family."
- "County should matter more or less for this item family."

## 7. Review warnings

The user reviews the Warnings panel before using the output.

Warnings may identify:

- sparse comparable data
- unit mismatch
- weak support
- missing context
- excluded candidate records

How to use it:

- Warnings should trigger review, not automatic rejection.
- Warnings explain why the tool may not be ready to support a strong recommendation.
- Warnings should become discussion points with roadway engineers.

## 8. Review improve-confidence actions

The user reviews the Improve Confidence panel.

These actions explain what would make the result more defensible.

Examples:

- Confirm the CDOT item code.
- Add a county or region.
- Add a quantity.
- Provide a comparable Colorado roadway estimate or bid tab.
- Confirm unit compatibility.
- Ask a roadway reviewer to approve or reject the item mapping.

How to use it:

- Treat this panel as a practical data collection checklist.
- Use it to decide what source documents or engineering feedback are needed next.

## Roadway Engineer Review Workflow

For early feedback sessions, the project manager should use the prototype as a structured review aid.

Recommended meeting flow:

1. Open the app.
2. Explain that all current records are synthetic demo data.
3. Pick one familiar roadway item.
4. Enter item code, description, unit, quantity, region, and year.
5. Review the recommendation summary.
6. Review the comparable project table.
7. Ask whether the match reasons are technically reasonable.
8. Ask which fields should matter more or less.
9. Ask what source data should be added first.
10. Record feedback as implementation notes for the coding agent.

Key questions for roadway engineers:

- Which item families should be tested first?
- Which CDOT item codes are good early validation targets?
- Which records should be considered comparable?
- Which records should be excluded?
- Which units should never be compared without conversion?
- Which source data is trusted?
- Which source data is useful but lower confidence?
- What should the tool say when data is weak?

## Intended Later Workflow

The current prototype supports one-item lookup only.

The intended later workflow is:

1. User creates or opens an estimate workspace.
2. User enters or imports multiple estimate line items.
3. App runs comparable matching for each line.
4. App flags weak, high, low, or unit-mismatch items.
5. User reviews one item at a time.
6. User selects or rejects comparable records.
7. User records override notes.
8. User exports an estimate support table or basis-of-estimate notes.

Later outputs may include:

- CSV export
- Excel-compatible table
- basis-of-estimate notes
- review dashboard
- estimate checker
- calibration against bid results

## Data Source Workflow

Real source data should be added only after the demo workflow is validated.

Preferred source order:

1. Public CDOT item code books.
2. Public CDOT cost books.
3. Public CDOT bid tabs or awarded project records.
4. Reviewed FHU historical estimates.
5. Reviewed FHU bid tabs or post-award data.

Data governance rule:

Private FHU data should not be committed to a public GitHub Pages repository.

Possible private-data workflows:

- user uploads local files in the browser
- private repository and private Pages configuration
- internal hosting
- later authenticated database

## Success Criteria

The current prototype is successful if a reviewer can answer:

```text
For this roadway bid item, what comparable records support the unit price, how strong is the evidence, and what should I check next?
```

The prototype is not expected to:

- estimate a full project automatically
- replace roadway estimator judgment
- parse arbitrary spreadsheets
- use private data safely without a private-data workflow
- produce final engineer-approved unit prices

## Feedback Capture

User and engineer feedback should be translated into concrete development tasks.

Useful feedback format:

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

This keeps feedback specific enough for a coding agent to implement in later iterations.
