# Interface implementation plan: Explorer and Project

**Status (2026-10-20):** UI-A through UI-D are implemented. The supplied inflation screenshots were reviewed. The delivery steps below record the original plan; the current behavior and later refinements are summarized here and in [the quality-of-life roadmap](planning-engineering-qol-roadmap.md).

**Current interface:** Project-origin Explorer searches prefill Group, Unit Cost, Quantity, and Notes. **Update Item** changes the source line; **Add Duplicate** appears when the entered values differ and adds a separate line. Explorer Previous/Next uses compact controls and resets item-specific context. Matching Projects replaces each available source price with a bold adjusted price when Inflation Adjustment is on; hover or focus reveals the original price and NHCCI periods. A missing index leaves the source price with a short **Not adjusted** status and a reason on hover or focus. The Project table displays compact Total Item Cost values with full-value tooltips, and its green **+** control works for empty and populated Projects. Short tables place the control below their last row; longer tables keep it within reach while scrolling. The Project table has tighter horizontal spacing and no side gradients; narrower windows can still require horizontal scrolling.

## Delivery order and file ownership

| Work package | Requests | Main files | Owner during implementation | Exit condition |
| --- | --- | --- | --- | --- |
| UI-A: small controls | #3, #6, #9, #12 | `src/ui/renderApp.ts`, `renderProjectWorkspace.ts`, `renderResults.ts`, `src/styles.css`, `src/ui/planning/renderPlanning.ts` | Sol owns shared UI and CSS; Luna may own Planning menu wording and its focused tests exclusively | Currency, filter timing, median shading, and menu names work without changing saved values. |
| UI-B: Project-origin editing | #1 | `src/ui/renderApp.ts`, `renderProjectWorkspace.ts`, `src/projects/projectWorkspace.ts` | Sol | A Project link opens Explorer with current line values and **Update Item** saves the same line. |
| UI-C: adjacent catalog items | #2 | `src/ui/renderApp.ts`, `renderResults.ts`, `renderExplorer.ts` | Sol | Previous/Next crosses catalog divisions safely and clears item-specific context. |
| UI-D: inflation explanation | #10 | `src/matching/inflationAdjustment.ts`, `src/ui/renderResults.ts`, `renderApp.ts` | Sol after evidence review | Each supplied example is explained by source date, index availability, calculation, and display rounding. |

The original implementation sequence put UI-B after UI-A because `renderApp.ts` and `renderProjectWorkspace.ts` overlap, then UI-C after UI-B so adjacent navigation could clear Project-origin context. UI-D followed review of the supplied screenshots. All four packages are complete; this ordering is retained as implementation history.

### UI-A1 — Project Unit Cost currency (#3)

1. Add a currency prefix to the Project table's Unit Cost control in `renderProjectWorkspace.ts`. Keep the editable numeric text separate from the prefix so the cursor does not jump while typing. Use a dedicated Unit Cost parser for the Project row and Explorer add/update form: accept one optional leading `$`, grouping commas, and surrounding whitespace; reject extra symbols, negative values, and non-finite values. Quantity continues to use its numeric parser and must not accept `$`. Remove or revise the add-form Unit Cost input pattern so browser validation permits the accepted currency text. Store a number or `null`, never a formatted string.
2. Preserve the current Project rule that a blank inline Unit Cost is allowed. The existing Explorer **Add to Project** path requires a positive amount; the new **Update Item** path must preserve a blank value when the source line is incomplete.
3. Increase the Unit Cost input width from the current 76 px by roughly three character widths. Adjust the table's Unit Cost column from its current 92 px allocation; measure the remaining columns rather than clipping Quantity or the item code. Check horizontal scrolling on a narrow viewport.
4. Keep the amount formatting already used for Total Item Cost. Use an accessible input label that says “Unit Cost”; do not make the dollar sign part of the accessible value twice.

**Checks:** `500`, `$500`, `1,500.25`, `$1,500.25`, blank, malformed dollar input, and a pasted value must produce the intended numeric result. A Project reload and CSV/JSON export must contain the same numeric cost. A targeted parser test is useful; desktop and narrow visual inspection is required.

### UI-A2 — Explorer quantity and price filter timing (#6)

1. Change only the four manually typed evidence controls `quantityMin`, `quantityMax`, `priceMin`, and `priceMax` from the current 300 ms input delay to 700 ms. Keep the existing immediate Enter and blur behavior. Keep select controls, date controls, and district selection on their current event paths.
2. Cancel the pending timer on Enter, blur, item change, or view teardown before applying the final value. Preserve input focus and selection across the evidence redraw. Clearing a field should clear its filter with the same timing rule.
3. If the 700 ms interaction still applies unwanted partial values during engineer review, replace the timer for these four fields with explicit Enter/blur commitment. That change should be based on observed use, not made at the same time.

**Checks:** Typing `500` with less than 700 ms between keystrokes applies one final filter; Enter or blur applies immediately; stale timers do not reapply `50` afterward. A focused fake-timer interaction check is justified because the bug is timing-dependent.

### UI-A3 — Median column shading (#9)

Add a scoped class to the Median header and Median cells of the Explorer Unit Price Summary in `renderResults.ts`; style it in `src/styles.css` with a subtle background distinct from Mean, Minimum, and Maximum. Keep the cell content, sorting, and accessible table semantics unchanged. Check contrast in the normal theme and the summary table's narrow layout. This is a visual change; source inspection and visual review are more useful than a test that only checks the class name.

### UI-A4 — Actions terminology (#12)

Use **Download Project Backup** / **Import Project Backup** in Project Actions and **Download Planning Backup** / **Import Planning Backup** in Planning Actions. Keep CSV actions labeled as reports or CSV downloads. Explain `.json` in adjacent helper text or file-picker text, rather than using JSON as the primary action name. Update associated success/error notices and `user_workflow.md` together so labels are consistent. The existing JSON file formats and import behavior stay the same.

This is a bounded Luna implementation candidate if Luna exclusively owns `src/ui/planning/renderPlanning.ts` and its copy assertions while Sol owns `renderProjectWorkspace.ts` and shared UI. Sol reviews the final wording across both menus.

### UI-B — Project link opens an editable source line (#1)

1. In the Project item-code link handler, retain temporary `{projectId, lineItemId, state, agencyItemId}` context while opening the existing fresh exact-item Explorer query. Fetch the current stored line by ID when rendering the form; do not rely on a copied line object that may become stale after autosave.
2. Prefill Group, Unit Cost, Quantity, and Notes from that line, including `null`/blank values. Show the source Project and line identity near the form. Make **Update Item** the primary button for this context. Keep **Add to Project** as the ordinary action for searches opened without Project context. When a Project-origin user changes values, show the secondary **Add Duplicate** action for an explicit separate line.
3. On **Update Item**, revalidate that the same active Project and catalog item still exist, that the Project is writable, and that no other tab has changed its revision. Update the existing line's editable values and current evidence context in one Project write. Preserve `lineItemId`, `createdAt`, catalog identity, cost category, description override, import provenance, and unrelated lines. The current `replaceProjectLineItem` can replace evidence context but must not replace those preserved fields with constructor defaults. Use a narrow pure helper if needed.
4. If the engineer changes the selected item, Project, state, or uses Previous/Next, clear the source context and its prefilled values. A subsequent Add must never silently overwrite the originating Project line. On a failed save, keep the form values and show a retryable error.

**Checks:** Existing blank fields remain blank; saving changes the original line and does not add a duplicate; evidence selections update that line's saved context; switching to an adjacent item removes the Update action; read-only and concurrent-tab conflicts do not write. Verify by reloading the Project and checking its line ID and revision.

### UI-C — Previous/Next catalog items (#2)

1. Build one ordered list from the loaded state's official `agencyItems`: filter to the current agency, sort by item code using the picker's numeric-aware comparison, and use stable agency item identity as the tie-breaker. Select by `agencyItemId`, not code alone. This allows moves across division or section boundaries while keeping exact item identity.
2. Render Previous/Next beside the selected Item and Item code beneath Matching Projects. Give each control the adjacent code and description in its accessible label; disable at the first or last item. Do not show controls when there is no selected catalog item.
3. On an arrow click, create a fresh exact-item query for the neighbor. Reset evidence filters, sort, exclusions, bidder/source detail, Project-origin form context, and item-specific input drafts. Rebuild the default Unit filter for the new item. Retain the engineer's current inflation-toggle setting. Keep focus near the item summary and announce the new code/description.
4. The Item Search picker and arrow controls must use the same ordering and identity rules. Do not load another state's catalog or infer equivalent items from text similarity.

**Checks:** First/last boundaries, duplicate-looking codes with distinct identities, a division transition, a neighbor with a different unit, and a Project-origin start. Returning to the original code through arrows does not restore the old Update context. No filter value from the previous item suppresses the new item's evidence.

### UI-D — Inflation calculation and display (#10)

**Screenshot audit (2026-10-16):** The latest loaded target was 2025 Q4 (NHCCI 3.234373117). The 2024 Q4 source-to-target factor was approximately 1.000534249. In screenshot 1, FSA007A-037 on 2024-11-21 had a source awarded unit price of $115.00, adjusting to about $115.06 and rounding to the same displayed $115; NH0504-911 on 2022-04-07 had a source awarded price of $103.80, adjusting to about $131.37. In screenshot 2, STA0853-087 on 2024-12-19 had a source awarded price of $525.00, adjusting to about $525.28 and rounding to the same displayed $525; CO14A-004 on 2024-10-24 had a source average price of $413.40, adjusting to about $413.62. The examples followed the loaded index and rounding rules; no calculation defect was found.

**Implemented display:** The source quarter comes from `project.estimateLetDate` or the observation date basis; the target is the latest loaded positive NHCCI quarter. With adjustment enabled, an available adjusted price replaces the original in bold, even when both round to the same displayed amount. Hover or focus reveals the original value and source-to-target quarters. If the source or target index is unavailable, the source price remains and **Not adjusted** explains why; recently published quarters may lack index coverage. The summary note stays short, and Matching Projects CSV remains unadjusted.

## Sol and Luna handoff for this plan

- **Sol orchestrator:** owns shared state in `renderApp.ts`, Project update semantics, navigation identity, inflation interpretation, shared CSS integration, branch/commit work, and final checks.
- **Luna:** can implement isolated Planning menu copy with exclusive file ownership; inventory exact labels or test cases; run a named focused test suite; or perform a read-only review of the completed diff. Each Luna task must use the Objective/Scope/Deliverable/Verification/Restrictions contract in `docs/agent_delegation_policy.md`. No Luna task edits `renderApp.ts` or shared CSS concurrently with Sol.
- **Verification:** Follow `codex.md`: TypeScript typecheck for logic; UI build to `dist-check` with native config loader for visual changes; static localhost preview when visual review is useful. Run only focused behavioral tests tied to the changed package. The Sol agent reviews every delegated edit and updates `architecture_overview.md` when the Project-to-Explorer flow or navigation behavior changes.
