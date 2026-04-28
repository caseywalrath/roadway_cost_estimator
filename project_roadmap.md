# Project Roadmap

## Purpose

This roadmap outlines a plausible development pathway for the Roadway Cost Comparable Explorer.

It is a planning guide, not a fixed commitment. The sequence should change if user testing, roadway engineer feedback, source data constraints, or hosting requirements point in a better direction.

The current product is a static prototype that lets a user search one roadway bid item and review comparable demo records, price ranges, confidence, warnings, and next steps.

## Guiding Product Direction

The product should remain a structured evidence tool before it becomes a full estimator.

Near-term work should answer:

- Can users understand the comparable evidence?
- Can roadway engineers trust or challenge the matching logic?
- Can source data be loaded without weakening data governance?
- Can weak results clearly explain what is missing?

Avoid building broad estimate automation until the item-level comparable workflow is trusted.

## Recommended Sequencing

### Phase 0: Current prototype stabilization

Goal: Make the existing demo app stable enough for early review.

Current status:

- Static GitHub Pages-ready app.
- Synthetic demo CSV records.
- One-item Item Explorer.
- Recommendation summary.
- Comparable table.
- Price distribution.
- Confidence and improve-confidence guidance.
- Prototype annotations.
- Clear and Reset Example actions.

Recommended small next efforts:

- Confirm GitHub Pages deployment works after merge to `main`.
- Add a short tester instruction block or link to `user_workflow.md`.
- Add a short list of recommended demo queries inside documentation or an optional app help panel.
- Confirm tooltip behavior across Chrome and Edge.
- Confirm mobile layout is usable enough for review, even if desktop remains primary.
- Keep synthetic data labels visible.

Exit criteria:

- Test users can open the app.
- Test users can run at least five demo searches.
- Test users understand that the data is synthetic.
- Roadway reviewers can explain whether the result layout is useful.

### Phase 1: Roadway reviewer feedback loop

Goal: Use the prototype to collect specific feedback before adding real data or larger workflows.

User-facing features:

- A documented feedback form or markdown template.
- A short list of review questions for roadway engineers.
- Optional in-app example query presets.
- Optional "what changed in this result" explanation when source scope, quantity, or region changes.

Small iterative efforts:

- Add a "Copy query summary" or "Copy result summary" button.
- Add clearer labels for "suggested unit price" versus "final estimate."
- Add a warning when item code and description appear to point to different item families.
- Add a visible count of excluded unit-mismatch records.
- Add a way to collapse prototype annotations once users understand the screen.

Large-scale decisions to defer:

- Full estimate upload.
- Private data storage.
- Chat interface.
- Automatic source document parsing.

Exit criteria:

- Roadway reviewers identify which current matches feel correct or too broad.
- Reviewers identify priority item families.
- Reviewers identify trusted public source documents.
- The team has a ranked backlog of rule, data, and UI changes.

### Phase 2: Validated public data package

Goal: Replace or supplement synthetic data with reviewed public roadway data.

User-facing features:

- Clearly labeled public source data.
- Source notes that identify agency, source type, year, and limitations.
- Better confidence guidance based on actual data coverage.
- More item families and realistic price variation.

Data work:

- Collect public CDOT item code books, cost books, bid tabs, or awarded project records.
- Decide which source format should be imported first.
- Create repeatable source-to-CSV conversion steps.
- Preserve raw descriptions, raw units, normalized descriptions, normalized units, and source metadata.
- Keep demo data separate from validated source data.

Small iterative efforts:

- Add 5 to 10 high-priority CDOT item families first.
- Add unit tests or fixture checks for matching rules.
- Add data validation checks for missing project IDs, source IDs, units, prices, and dates.
- Add a source coverage summary in documentation.
- Add known limitations for each source.

Exit criteria:

- At least one real public data source is represented in the CSV schema.
- Roadway reviewers confirm that several item mappings are technically reasonable.
- The app still works as a static site.
- Private FHU data remains out of the public repository.

### Phase 3: Matching and confidence refinement

Goal: Make recommendations more defensible and easier to challenge.

User-facing features:

- Better "why selected" explanations.
- Clearer distinction between exact code, approved alias, and keyword fallback matches.
- Filters for region, source type, date range, quantity range, and project type.
- Outlier visibility or outlier exclusion controls.
- Confidence reasons shown in plain language.

Matching improvements:

- Tune weights for quantity similarity, recency, geography, and work type.
- Add item-family-specific matching rules where needed.
- Add reviewed alias approval status.
- Add source-quality weighting.
- Add optional escalation or date-basis adjustment only after the team agrees on the method.
- Add unit conversion only for approved item families and only with visible assumptions.

Small iterative efforts:

- Add tests for exact-code, alias, keyword, unit mismatch, and no-match cases.
- Add a "show all candidates" review mode.
- Add a "why not included" explanation for excluded records.
- Add warnings for sparse data and stale data.
- Add confidence thresholds to documentation.

Exit criteria:

- Roadway reviewers can explain why the top records were selected.
- Users can see when evidence is weak.
- The app avoids presenting a strong recommendation when the data does not support it.

### Phase 4: Estimate workspace

Goal: Move from one-item lookup to a small multi-item review workflow.

User-facing features:

- Add estimate rows in a workspace.
- Let users enter multiple item codes, descriptions, units, quantities, and notes.
- Run comparable matching per row.
- Flag rows with high confidence, low confidence, no support, unit mismatch, or missing context.
- Let users open a row detail view that uses the current Item Explorer evidence pattern.

Small iterative efforts:

- Start with manual row entry before upload.
- Add duplicate row and delete row actions.
- Add row status badges.
- Add project-level context shared across rows.
- Add simple local browser persistence if useful.

Large-scale features to defer until the workspace is trusted:

- Full spreadsheet import.
- Advanced estimate versioning.
- User accounts.
- Database-backed collaboration.

Exit criteria:

- A user can review a small estimate section with multiple bid items.
- Weak rows are easy to identify.
- The existing one-item evidence view remains available for detailed review.

### Phase 5: Import and export workflows

Goal: Reduce manual entry while keeping review traceable.

User-facing features:

- CSV import for estimate rows.
- Later XLSX import if the schema is stable.
- Export comparable support tables.
- Export basis-of-estimate notes or review summaries.
- Export a reviewer feedback package.

Small iterative efforts:

- Add a downloadable CSV template.
- Add import validation with clear row-level errors.
- Add mapping instructions for required columns.
- Add CSV export before XLSX export.
- Add "copy table" support if users need quick sharing.

Data governance requirements:

- Do not transmit private files to a third party from the static app.
- Prefer browser-local parsing for user-uploaded files.
- Clearly explain whether imported data is stored, temporary, or exported.

Exit criteria:

- A user can bring in a simple estimate table.
- A user can export evidence without manually rebuilding tables.
- Import errors are understandable to non-developers.

### Phase 6: Private-data strategy

Goal: Decide how reviewed FHU data can be used without exposing private data in a public repo.

Potential options:

- Browser-local user upload of private files.
- Private GitHub repository and private Pages or equivalent internal hosting.
- Internal static hosting with access control.
- Later server or database model if collaboration and persistence become necessary.

User-facing implications:

- Public prototype can remain a demo and public-data tool.
- Internal prototype can use reviewed FHU records if governance is approved.
- Users should always know which source type supports a recommendation.

Questions to answer before implementation:

- Which private data is allowed?
- Who can access it?
- Can it be committed to any repository?
- Does the app need persistent shared history?
- Does the app need user accounts or role-based access?

Exit criteria:

- The team chooses a private-data path.
- The path is documented before private data is added.
- Public GitHub Pages remains free of private FHU data.

### Phase 7: Production hardening

Goal: Prepare the tool for regular internal or public use.

User-facing features:

- More reliable source coverage.
- Better error messages.
- Accessibility improvements.
- Review status tracking.
- Exportable documentation.
- Version labels for data packages and matching rules.

Technical and process work:

- Add automated data validation.
- Add automated app tests.
- Add release notes.
- Add versioned source data packages.
- Add performance checks for larger CSV files.
- Reconsider DuckDB-WASM, SQLite-in-browser, or a backend only if static CSVs become limiting.

Exit criteria:

- Users can trust which data version and matching rules produced a recommendation.
- The app has a repeatable update and review process.
- The team has made an explicit hosting and data-governance decision.

## Cross-Cutting Workstreams

### Data source workstream

Recommended sequence:

1. Validate schema against demo records.
2. Add public CDOT item and project records.
3. Add source coverage documentation.
4. Add quality flags.
5. Add reviewed FHU data only after governance approval.

### User experience workstream

Recommended sequence:

1. Keep the one-item workflow clear.
2. Add review aids and query presets.
3. Add filters and detail views.
4. Add multi-item workspace.
5. Add import and export.

### Matching workstream

Recommended sequence:

1. Preserve exact code match priority.
2. Improve alias and canonical mappings.
3. Add tests for known item families.
4. Add reviewer-controlled inclusion and exclusion.
5. Add escalation, outlier, and conversion logic only with approved assumptions.

### Documentation workstream

Recommended sequence:

1. Keep `architecture_overview.md` current when app structure or data flow changes.
2. Keep `docs/data_schema.md` current when CSV contracts change.
3. Keep `user_workflow.md` current when user workflows change.
4. Keep this roadmap current when sequencing decisions change.
5. Keep `codex.md` current when local development lessons change.

## Near-Term Backlog Candidates

Recommended near-term backlog:

- Merge and deploy the Clear button and tooltip fixes.
- Add this roadmap to the repository.
- Confirm GitHub Pages deployment after merge.
- Add optional query presets for the current demo item families.
- Add a compact tester guide in the app or documentation.
- Add result export by copy or CSV.
- Add reviewed public CDOT sample data.
- Add matching tests for current demo item families.
- Add source coverage notes.
- Add an annotation toggle.

## Decision Points

Before adding real data:

- Which public source should be imported first?
- Which item families should be validated first?
- Who reviews item mappings?

Before adding private data:

- Where can private data safely live?
- Who can access it?
- What source labels and warnings are required?

Before adding estimate upload:

- What input schema should users prepare?
- Which fields are required?
- What should happen when rows cannot be matched?

Before adding escalation or unit conversion:

- Which method is approved?
- Which item families are eligible?
- How should assumptions be displayed?

## Working Rule

Each development session should produce a small, reviewable change unless the team explicitly chooses a larger build phase.

For each new feature, capture:

- What user problem it solves.
- What data it depends on.
- What the user should see.
- What should happen when data is weak or missing.
- What documentation needs to change.
- What local or automated checks should verify it.
