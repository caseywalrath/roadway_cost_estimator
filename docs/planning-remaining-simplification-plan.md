# Planning module: remaining simplification plan

## Completed in this revision

- The estimate sidebar lists the base package, selected elements, custom work, active percentage allowances, contingency, and known property/utility amounts. The displayed rows reconcile to the construction, other-cost, and estimate figures. Unknown work remains marked pending.
- The export menu uses **Share Project**, **Current Alternative (CSV)**, and **Entire Project (JSON)**. Quantity assumptions use a smaller secondary disclosure. Prominent instructional copy and the repeated allowance boilerplate were removed from the Planning screen.
- New Colorado item prices request inflation adjustment to the latest loaded NHCCI quarter. Source observations without index coverage are excluded from the adjusted sample with a recorded reason. Existing alternatives keep their frozen rate snapshots.

## Phase 1 — Decide the planner inputs

**Owner: Sol.** Review one Nebraska and one Colorado pilot alternative with engineers and planners. For each base package, decide whether the planner should provide only improvement type, length, and width, or also one or two section choices. Map every existing geometry parameter and override to one of: derived default, simple planner input, or Project-only engineer edit. Document how a planner handles a project outside the pilot package assumptions. Do not remove stored fields or rewrite saved alternatives during this review.

**Exit:** A short input contract for each package and a screen sketch with no component-level quantity, rate, source-filter, or exclusion controls in the normal Planning path.

## Phase 2 — Simplify the Base package and allowance controls

**Owner: Sol for UI and data semantics; Luna for a read-only inventory of legacy edits and focused tests.** Remove the component table, source selectors, manual-rate overrides, and geometry override forms from the planner-facing estimate details. Preserve the frozen source and calculation records in JSON and the Project handoff. If a saved alternative has legacy overrides or custom work, show a compact read-only summary and keep a deliberate path to Project for editing. Keep Other Costs and contingency percentages editable in a concise list next to their calculated amounts; show only enabled entries by default and give disabled optional allowances one clear add action. Replace internal calculation-base terms with plain labels such as “direct construction” and “construction with contingency.”

**Exit:** A planner can create and compare alternatives without opening an engineer item editor. Existing saved overrides remain readable and exportable. Editing an allowance changes the sidebar amount and total immediately.

## Phase 3 — Align exports and Project handoff

**Owner: Sol for integration; Luna for independent CSV/JSON verification.** Check that the CSV uses the same grouped cost lines, allowance percentages, pending labels, and total meaning as the sidebar. Keep JSON lossless and explicitly describe it as the transfer file for all alternatives. Reassess whether “Continue in Project” belongs on the planner screen or under Share Project. Verify that Project creation retains exact item provenance and the frozen adjustment target without applying inflation twice.

**Exit:** A planner can explain every displayed total from the CSV, and an engineer can reproduce the source basis in Project.

## Phase 4 — Data and pilot validation

**Owner: Sol for final review; Luna for bounded data inventories and regression checks.** Compare Nebraska and Colorado pilot package totals with the two engineer workbooks and several recent projects. Review Colorado observations excluded for NHCCI gaps, source age, and sparse-item coverage. Decide whether manual pilot rates and allowance percentages need changes; record the evidence and effect of each change before altering defaults. Walk through desktop and narrow layouts and a JSON handoff between browsers.

**Exit:** Engineers sign off on input scope and the size of the planning ranges, or identify specific package/rate changes. No release or migration of saved alternatives is implied by this plan.
