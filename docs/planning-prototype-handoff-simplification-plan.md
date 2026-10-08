# Planning prototype: export and Project review simplification

## Outcome

A planner builds and compares Nebraska or Colorado alternatives, adds the available project elements, and exports a file for an engineer. An engineer may inspect the file or import its Planning project into another browser and create an independent Project draft. The ordinary Project item table is the main place to revise quantities, prices, and scope. The prototype does not require a separate engineer approval workflow in Planning or a server-side handoff.

This plan supersedes the visible engineer-review workflow in [planning-engineer-review-handoff-plan.md](planning-engineer-review-handoff-plan.md) for the prototype. It preserves the existing Planning and Project records, frozen price provenance, one-way Project snapshot, and truthful subtotal behavior. It does not authorize a merge or deployment.

## Product decisions

1. **Planning remains planner-first.** Keep project basics, base package, optional elements, comparison, estimate summary, and a small assumptions area. Remove the visible **Review before detailed estimate**, **Record review**, and **All review decisions** workflow. Do not ask planners for item rates, source filters, allowance bases, or approval metadata. Preserve those fields in existing saved alternatives and the JSON format; do not silently rewrite their prices.
2. **Use one export entry point.** Show **Export for engineer** near the alternative controls with two choices: **Current alternative CSV** for reading in a spreadsheet and **Planning project JSON** for transferring every alternative and its frozen assumptions. Move **Import planning project JSON** into Planning actions. Rename the current “recovery” wording without changing the versioned backup format. An imported JSON creates an independent browser-local copy; it does not synchronize with the sender.
3. **Make the primary CSV readable.** Produce a compact review table for the selected alternative: project and alternative name, state, element/work, quantity, unit, unit price, amount, cost category, price basis in plain language, and unresolved or excluded scope. Include a subtotal/total row with its correct label. Keep the existing detailed `buildPlanningCsv` contract available internally for compatibility and deeper audit; do not put serialized source objects or internal IDs in the primary CSV. JSON remains the lossless transfer format.
4. **Keep Project creation optional.** Retain **Create Project from alternative**, its frozen one-way snapshot, exact catalog identity validation, and retry-safe browser persistence. An engineer who receives JSON imports it into Planning, then creates a Project in that browser. Do not imply that this creates a live link back to the planner.
5. **Let Project items carry most review work.** A Planning-origin Project opens on its normal item table. The **From Planning** area becomes a compact origin and outstanding-scope summary. Move **Open source alternative** into a collapsed origin-details disclosure. Remove the prominent per-decision **Resolve / Exclude** forms and the separate Project review form/status from the default prototype flow. Preserve prior review data for compatibility.
6. **Keep incomplete totals honest.** Pricing an imported line clears its price decision; removing it records that it was excluded. For an unresolved property or major-utility impact, offer a compact choice to mark no impact or add an editable **Other Costs** line. A draft continues to say **Priced subtotal** until every required line and major-impact choice has been handled. Never turn an unknown amount into zero merely to display a total.
7. **Make provenance readable.** The **Planning basis** disclosure under Total Item Cost shows original quantity, rate and amount, source type, relevant date/period, source description or locator, and any manual-rate reason. For allowances, show percent and calculation base in words. Remove raw `JSON.stringify` output from the UI, while retaining complete structured provenance in Project data and backups.
8. **Clear boilerplate line notes.** New Planning-origin Project lines start with blank Notes. For existing Planning-origin lines, suppress and clear only the exact generated text `Planning starting snapshot; review before use.` through a targeted compatibility path. Preserve every other note, including user edits and Project-level notes. The boilerplate must not reappear in Project CSV or JSON exports.

## Export and decision contracts

The compact CSV has these columns, in order: `planning_project`, `alternative`, `state`, `row_type`, `element`, `work`, `quantity`, `unit`, `unit_price`, `amount`, `cost_category`, `status`, `price_basis`, `note`. Emit one row per included or excluded cost component, one per allowance, one per major impact, and one final estimate row. Repeat project/alternative/state on every row. Use a blank cell for an unknown number, never `0`. Give the final row the same **Planning estimate**, **Planning subtotal**, or **Priced items so far** meaning as the screen. Put concise scope gaps and exclusion reasons in `note`; keep full source objects in JSON. Escape CSV fields and protect user-entered text that spreadsheet software could interpret as a formula. Block both exports while an input is invalid, and export the current in-memory alternative rather than an older saved revision.

| Project action | Stored decision and visible cost result |
| --- | --- |
| Enter valid quantity and positive unit cost on a pending Planning-origin line | Resolve its price decision automatically; recalculate the Project subtotal. |
| Enter a zero unit cost | Keep it pending until the engineer records a reason in that line's Notes; then treat it as an explicit zero-cost decision. |
| Remove a pending Planning-origin line | Mark its source decision excluded with a generated “Removed in Project” record; remove the priced line from the total. |
| Mark an unresolved major impact **No impact expected** | Record an explicit excluded-scope decision with a generated reason. |
| Choose **Add cost item** for an unresolved major impact | Create one editable Other Costs line at quantity 1 with an unknown unit cost; keep the Project incomplete until priced or removed. |
| Remove that impact line | Record the impact as excluded rather than silently forgetting it. |
| Revisit an earlier major-impact choice | Allow the engineer to change it from the compact impacts disclosure; update the decision and associated line without duplicating costs. |

## Major project impacts

Move **Property acquisition** and **Major utility relocation** out of the cost sidebar into a compact **Major project impacts** section below project elements. Keep three plain choices: **Not expected**, **Possible / unknown**, and **Known impact**. Default both to **Possible / unknown**. The planner need not enter a dollar amount. A known impact without a price stays unresolved and flows to Project as work to assess. An existing saved amount remains visible and preserved; a compatibility disclosure may allow it to be edited without putting a rate field in the default planner flow.

The sidebar stays focused on priced construction, other priced project costs, and the planning subtotal or total. It lists unresolved major impacts in one short line. **Not expected** is an explicit planner assumption; store a clear generated reason for that choice so it does not depend on an unexplained hidden field. Do not use a universal right-of-way or utility percentage. Preserve the current distinction between a known amount, an unknown impact, and an explicit no-impact assumption in calculation, CSV, JSON, and Project handoff.

## Execution phases and ownership

The Sol lead owns interaction design, shared data semantics, integration, Git operations, and final review. Use Luna for bounded extraction, pure export construction after the CSV columns are fixed, mechanical handoff note changes, and independent verification. No more than three subagents run concurrently. Assign exclusive file ownership before parallel edits; the lead owns shared UI renderers, controllers, global CSS, Project completeness logic, and architecture documents. Subagents do not commit, push, or spawn further agents.

### Phase 0 — Baseline and contracts

**Lead: Sol. Luna: two read-only inventories in parallel.** Confirm the current JSON round trip, detailed CSV fields, external-scope states, Project handoff mapping, Project completeness rules, and existing Planning-origin Projects. Fix the compact CSV columns and the exact wording for complete versus incomplete estimates before implementation. Record representative Nebraska and Colorado alternatives, including unknown property/utility impacts and an existing Project with the generated Notes text. No production data or saved alternative is modified in this phase.

The initial source inventory was completed while drafting this plan. Recheck only behavior affected by intervening branch changes, then establish disposable review examples; do not repeat repository-wide discovery without a concrete gap.

**Exit:** The lead has an agreed screen sketch, CSV field list, and state-transition table for Project price and scope decisions. The table must cover price entered, line removed, no external impact, external cost line added/priced, and an imported legacy Project.

### Phase 1 — Planner export and impact controls

**Sol owns** `src/ui/planning/renderPlanningWorkspace.ts`, `src/ui/planning/planningController.ts`, and Planning CSS in `src/styles.css`. Replace the visible engineer-review block with concise assumptions and optional Project creation; add the single export entry point; relocate major impacts and use plain-language choices. Keep the existing detailed editing data and old imported values intact. **Luna owns** a new pure compact CSV formatter in `src/planning/` and its focused tests, using the fixed Phase 0 field list; Luna does not edit the renderer or controller. Preserve the detailed CSV formatter and versioned JSON parser.

**Exit:** A planner can create two alternatives, add Sidewalk or Curb and gutter where eligible, compare them, and export both file types without seeing an engineer-editing form. The CSV identifies unknown work and labels a subtotal accurately. JSON import in a second browser produces an independent editable copy of all alternatives. Property and utilities no longer occupy the cost sidebar.

### Phase 2 — Project origin and line presentation

**Sol owns** `src/ui/renderProjectWorkspace.ts` and relevant Project CSS. Replace raw Planning-basis JSON with concise source and calculation text. Compress **From Planning** to origin, outstanding work count, a collapsed source link, and a short assumptions list. Keep any double-count warning for frozen contingency visible when applicable. **Luna owns only** the new-line Notes default in `src/planning/projectHandoff.ts` and its focused handoff check. The lead integrates a narrowly scoped compatibility cleanup for old generated notes across Project display and exports, preserving all other notes.

**Exit:** Expanding Planning basis displays no code or serialized objects. New and old generated boilerplate Notes are absent from the item table and exports. User-authored Notes remain. A linked Project still opens its normal item table and can navigate to its local source alternative through origin details.

### Phase 3 — Use Project items to resolve imported work

**Lead: Sol, because this changes completeness and persistence. Luna: read-only edge-case audit and isolated verification after the implementation.** Update Project mutations and origin decisions so entering quantity and unit cost resolves a pending imported line; removing that line records exclusion. Replace the per-decision forms for property and utilities with a compact **No impact expected** or **Add cost item** choice. The latter creates a custom Other Costs line with blank price and Planning provenance; pricing or removing that line completes the choice. Existing pending decisions and already reviewed Projects must remain loadable. Remove the separate prototype review form and status from the default view, while retaining stored review records.

**Exit:** The Project total remains a **Priced subtotal** while any imported item or major impact is unresolved. It becomes a **Total Project Cost** only after each is priced or deliberately excluded. Adding native Project contingency beside frozen Planning contingency still triggers the double-count warning. Project backup/restore and CSV preserve origin, decisions, and user Notes.

### Phase 4 — Integration and pilot check

**Lead: Sol. Luna: independent read-only regression review.** Review all delegated edits and run the repository's appropriate typecheck, focused semantic tests, and production build. Inspect the local preview at desktop and narrow widths. Walk through a planner-to-engineer JSON handoff, a CSV-only review, a complete Project, an incomplete Project, and an older Planning-origin Project. Update `architecture_overview.md` and the user workflow documentation for the new visible flow. Keep the pilot local for planner and engineer feedback before any merge or deployment.

**Exit:** The planner can explain the estimate and export it without navigating engineer controls; the engineer can use the familiar Project item table without raw code or repeated boilerplate. All totals and unknown-scope labels remain truthful, and legacy browser data loads without loss.

## Boundaries

- Nebraska and Colorado remain the only Planning pilot states. Do not change package rates or add new priced elements in this revision.
- Keep complete rate snapshots, source locators, allowance rules, and original values in typed records and JSON backups even when UI text is shortened.
- Do not merge Planning and Project browser databases or implement accounts, shared storage, email sending, live links, or bidirectional synchronization.
- Do not silently revise a previously saved alternative or an engineer-edited Project during handoff or import.
