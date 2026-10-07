# Planning engineer review and Project draft handoff plan

Status: Proposed for implementation. Prepared 2026-10-07 from the local Phase 3 planner-first pilot (`1f617bb`) and product-owner feedback. This plan revises the engineer-review UI and supersedes the complete-only transfer gate in Phase 5 of `planning-module-implementation-plan.md`. It does not authorize a merge, deployment, or an accuracy claim.

## 1. Outcome and workspace boundary

A planner creates and compares alternatives in Planning using improvement type, approximate dimensions, and optional scope. An engineer checks package coverage and major assumptions there. When item-level estimating is needed, **Create Project from alternative** creates a new, independently editable Project draft in the same state. Planning retains the original alternative. Project uses its existing item table and Explorer item search for detailed estimating. There is no reverse synchronization and no transfer into an existing Project in this revision.

The handoff must work for a valid but incomplete alternative, including **Other work to include**, missing prices, and unassessed property or major utilities. Such a Project displays a **Priced subtotal** and a specific **Work to resolve** list; it must not label the subtotal as Total Project Cost. An alternative with invalid structure, conflicting scope substitutions, or malformed numeric inputs cannot transfer until corrected. A complete alternative may transfer with a full frozen starting total, still subject to engineer review.

The pilot remains Nebraska and Colorado only. Rates, package coverage, and accuracy remain provisional. No new priced packages, automatic matching of custom work, universal utility/ROW percentages, or live Planning-to-Project link are included.

## 2. Interaction contract

### Planning

- Keep the current planner form and estimate summary. Show one comparison control and one secondary Planning actions menu; remove duplicate creation and comparison actions.
- Rename the visible **For engineer review** area to **Review before detailed estimate**. Show at most a few actionable decisions: unpriced work, scope/geometry questions, and limited price evidence. Keep the full list available in one disclosure.
- Replace the dense advanced form with a Project-like component table: **Work | Quantity | Unit price | Amount | Basis | Status**. Group rows by base package, optional element, and other work. A row has one **Edit** action that opens only the relevant fields. Show source evidence in a separate row disclosure; do not put report windows, source IDs, or manual-rate fields in every row at rest.
- Each component has one scope state: **Included** or **Removed**. Ask for a contextual explanation only when the engineer removes work or changes a quantity/rate default; preserve distinct quantity and rate reasons when both are changed. Preserve the underlying exclusion reason and section-effect data; derive any standard section effect from the chosen action rather than asking for two near-identical explanations. Recipe-level exclusions remain a separate read-only package coverage note.
- Put allowance edits in one compact **Other costs and contingency** table. Show percent, calculated amount, and base on demand. Keep review name/date/notes as one final action, with a visible pending/current/stale status. Changing a material assumption must continue to stale the recorded review.
- Place **Create Project from alternative** next to the review conclusion. Before creation, show the destination Project name, state, priced subtotal, number and names of unresolved items, frozen allowance treatment, and explicit excluded/none-assumed scope. One primary confirmation creates a new Project; repeated activation of the same pending handoff resumes it.

### Project

- Open the newly created Project at **Project Items**. Use the existing inline Group, category, quantity, unit cost, notes, custom-item editing, and catalog-code link to Explorer. Do not build a second full item-search experience inside Planning.
- Show a concise **From Planning** panel with source Planning project/alternative, snapshot date, included and excluded scope, unresolved work, and the fact that amounts are a one-way starting snapshot. Link to the originating Planning alternative when available in this browser.
- For Planning-origin drafts, show **Priced subtotal** while any required line or scope decision is unresolved. Show **Total Project Cost** only after the engineer resolves or explicitly excludes every required item and external-scope decision. Existing non-Planning Projects keep their current totals behavior.
- A blank amount is unknown, never zero. An explicit zero may be used only with a recorded scope/price decision. Marking a decision resolved must require a meaningful action; filling a line price alone should not silently resolve an unrelated scope question. Project review status is independent of the Planning review fingerprint.
- Keep a separate, visible **Frozen Planning contingency** custom Other Costs line. Initialize native Project contingency to 0%. If the engineer later sets native contingency above zero while that line remains, show a double-count warning with an action to review the frozen line.

## 3. Transfer contract

Use a pure, deterministic handoff builder before browser persistence. Its output contains a frozen Project creation payload, typed Project-level Planning provenance, typed line-level origin, unresolved decision records, source scenario fingerprint, and a reconciliation report. Do not reuse `ProjectEvidenceContext` for Planning price evidence: Explorer selections and Planning rate snapshots have different source semantics.

| Planning input | Project result |
| --- | --- |
| Catalog-bound, included component | Catalog line with exact state/agency/item identity, compatible code/unit, generated quantity, selected rate or null, package/role provenance |
| Manual or custom construction component | Custom Construction Costs line; retain quantity, rate basis, reason and source role; blank cost stays pending |
| Priced percentage/fixed construction allowance | Custom Construction Costs line at its frozen calculated amount and base/percent provenance |
| Design, construction engineering, ROW, utility and other external cost | Custom Other Costs line when amount is known; otherwise a named unresolved decision, with a draft line where item-level pricing is needed |
| Planning contingency | One frozen custom Other Costs line; native Project contingency 0% |
| Explicit exclusion or `none_assumed` external declaration | Project-level scope provenance and review list entry; no fabricated priced line |
| `unassessed` or known-but-unpriced external scope | Named unresolved Project scope decision; no zero-cost claim |

Resolve catalog display codes from the loaded state catalog using the exact `agencyItemId`; the current Planning `ItemBinding` does not contain `itemCode`. If a required catalog identity cannot be resolved, stop transfer with a named error or create a clearly custom, unlinked draft line only after an explicit contract decision. Never invent an agency identity or present NE annual summaries as contract-level Explorer evidence. Preserve the original frozen price basis, unit conversions, overrides, package version, and source locator even after Project edits. Project edits change current line values, not the imported origin snapshot.

Define Project draft completeness from **required unresolved lines plus explicit scope decisions**, not from its arithmetic total. Transfer excluded components and non-priced external decisions as provenance, not zero-valued estimate rows. If a dependent allowance has no computable amount, transfer it as a pending decision with its frozen percentage/base rule rather than as a false zero. Engineer changes to Project lines do not automatically recalculate frozen Planning allowances; the UI must label them frozen and let the engineer deliberately revise or replace them.

For a complete alternative, the handoff's initial Project total must reconcile with Planning within one cent. For a draft, reconcile the priced line subtotal to the Planning priced scope using an explicit category-by-category bridge and list every amount withheld because of a missing dependency. Do not claim the Planning total and Project subtotal are interchangeable when coverage differs.

## 4. Persistence and compatibility

Planning and Project use separate IndexedDB databases. A handoff must be retry-safe without claiming a cross-database transaction:

1. Validate the saved alternative and build the immutable payload. Refuse handoff when either repository is memory-only or editing ownership is read-only.
2. Revision-check and save a Planning intent containing a unique token, scenario fingerprint, predetermined Project ID, frozen creation payload, and `pending` status **before** writing Project.
3. Create the Project with that ID and matching token/fingerprint in the same Project write. On a duplicate-ID result, read the existing Project: reuse it only when provenance matches; otherwise show a conflict. Never overwrite engineer edits on retry.
4. Revision-check the Planning link and mark the intent complete after verifying Project existence. If the final link save fails, leave the intent pending; reload or retry finds the same Project.
5. A deliberate second snapshot uses a new token and creates a second Project with a distinguishable name/date. It never updates a prior Project.

Add optional typed Planning provenance and draft-review fields to current Project records. Update parsing, JSON backup/import copies, revision snapshots, and CSV behavior so they survive round trips; preserve existing Project records and current CSV columns. Do not add a Project IndexedDB version bump solely for optional object fields. Planning recovery copies must clear live handoff intent and Project link as the current duplication rules require.

## 5. Execution and delegation

The lead is a high-capability Sol/Astra agent for product semantics, shared contracts, UI design, persistence, Project compatibility, integration, and final review. Use Luna for bounded inventories, pure fixtures, mechanical backup/CSV compatibility tests, and read-only audits. Assign exclusive files when edits are allowed; no nested delegation, and no subagent Git writes, deployment, or final integration. Use at most three subagents concurrently. The lead must inspect all output and run final checks. Start implementation from an up-to-date branch while preserving the local pilot and saved browser data.

| Stage | Lead work and bounded delegation | Exit criterion |
| --- | --- | --- |
| E0 — Freeze contracts | **Lead:** define draft completeness, status labels, unresolved-decision lifecycle, catalog-code failure policy, cost reconciliation, and provenance schema; revise the older Phase 5 contract. **Luna:** separate read-only inventory of Project backup/parser paths and NE/CO handoff fixture cases. | A reviewed mapping table and representative complete/incomplete NE/CO expected outputs exist before UI or storage edits. |
| E1 — Simplify Planning review | **Sol lead:** replace dense edit rows with a Project-like table and row-level editing, remove duplicate controls, and make scope labels singular. **Luna:** isolated DOM fixture tests and read-only copy/accessibility audit after interfaces are set. | Planner first screen remains simple; an engineer can inspect/change each frozen assumption without seeing six fields per row at rest. Saves, invalid drafts, focus/caret, ownership, recovery and stale reviews work. |
| E2 — Project draft model and pure mapping | **Lead:** implement typed origin and unresolved decisions, pure handoff builder, Project completeness labeling, and contingency mapping. **Luna:** own isolated mapping fixtures/tests or backup/CSV compatibility tests in separate files. | Exact catalog identities and manual/custom work map correctly; incomplete drafts cannot show a complete total; complete totals reconcile within one cent; legacy Projects behave as before. |
| E3 — Durable handoff and Project UI | **Sol lead:** implement intent state machine, revision-safe persistence, confirmation/open flow, Project origin panel and review decisions. **Luna:** isolated repository race/recovery fixtures and read-only UI review. | Retry, reload, save failure and concurrent same-intent attempts create one Project and never overwrite later Project edits. |
| E4 — Local engineer trial | **Lead:** inspect a built desktop/narrow view and walk through one complete and one incomplete example in each pilot state. **Luna:** run focused regression suites and record reproducible totals/round-trip results. | Engineer can start from a planner alternative, find/replace a catalog item in Project, price missing work, and identify the source/remaining gaps. Record feedback and update architecture/implementation notes. |

## 6. Required verification and release boundary

- Pure tests: six pilot base packages, sidewalk and Other work; exact NE/CO identities and units; catalog-code lookup failure; zero versus null; excluded/none-assumed/unassessed scope; allowance dependencies and overlap; frozen contingency exactly once; complete and draft reconciliation.
- Persistence tests: intent-save failure, Project creation failure, crash after Project creation, final-link failure, same-token concurrent attempts, mismatched-token ID conflict, independent Project edits, deliberate second snapshot, read-only and memory-only modes.
- Compatibility tests: older Project records, backup/import copies, revisions, CSV columns, Planning recovery/duplication, state switching, existing Project totals and Excel import.
- UI tests and visual trial: one visible comparison control; one row-level edit action per component; singular scope labels; keyboard/focus and narrow table behavior; draft subtotal label; unresolved-work list; Project catalog link to Explorer; frozen-contingency warning.
- Use the repository's canonical TypeScript/test/build commands. Validate the local preview with the product owner and at least one engineer before merge or deployment. Do not represent the pilot as calibrated, approved, or ready for external use based on automated tests alone.
