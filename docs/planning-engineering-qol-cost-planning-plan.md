# Cost model and Planning template implementation plan

**Status:** Cost-A percentage items are implemented on `codex/percentage-project-items` using the recommended decisions below. Planning-B roundabout and Interstate templates still need engineer-defined scope and price calibration. This plan expands the [quality-of-life roadmap](planning-engineering-qol-roadmap.md) at repository commit `f9145a9`.

## Cost-A — Percentage-based Project items (#13)

### Confirmed rule and proposed line model

Percentage lines use **fixed-cost lines only** as their base. No percentage line can depend on another percentage line, directly, through a Group, or through selected lines. This user decision removes recursive calculation.

Use a discriminated pricing model in the next Project schema version, provisionally v11:

- Existing catalog and custom lines become `pricingMode: "unit"` (or an equivalent fixed-cost variant), with the same quantity and unit-cost behavior.
- A percentage line is custom, with `pricingMode: "percentage"`, a nonnegative rate, a base selector, and a separate `role` indicating whether it is a **contingency**. Its amount is calculated from the current Project and is not stored as an independent editable amount. A percentage is not automatically a contingency; it may represent an allowance, fee, or other cost.
- Base selectors: **All fixed costs**, **Construction fixed costs**, **Other fixed costs**, **One Group's fixed costs**, and advanced **Selected fixed lines**. Selected lines refer to stable `lineItemId`s. A Group base uses its current name and membership; only fixed lines in that Group count.
- A contingency role determines the top-row **Contingencies** sum. Non-contingency percentage lines contribute to their chosen Construction or Other category. Construction and Other subtotals exclude contingency-role lines, so their sum plus Contingencies equals Total Project Cost without double counting.

Keep numeric calculations at full precision and round only at display/export boundaries according to the current Project rules. Show each percentage line's rate, base label, calculated base amount, and resulting cost in the Project table or an adjacent editor. A missing or empty base yields an explicit warning and a $0 derived amount; it must not silently resemble a completed estimate.

### Implementation stages

1. **Schema and migration:** Extend `src/projects/projectWorkspace.ts` with a fixed/percentage line union, base selector, role, and strict parser. Convert each v10 Project's global `contingencyPercent` into one explicit contingency line based on all existing fixed Construction and Other items. If the old percent is zero, do not add a zero-value line. Preserve Project ID, line IDs, revision history, and exact existing total to the cent. Keep old Project backup files importable through a v10-to-v11 adapter. Make migration idempotent.
2. **One calculation path:** Replace the assumption that `projectLineTotal(line)` can price every line without a Project context. Introduce a pure Project calculation result containing `amountByLineId`, each percentage base amount, Construction, Other, Contingencies, and Total. Fixed lines use quantity × unit cost; percentage lines use rate × eligible fixed-line base. Validate all selected IDs, rate bounds, and base kind. Use this result for table totals, sorting, summary, CSV, backup-derived summary, and import projections.
3. **Edit rules:** Provide Add fixed item and Add percentage item choices without crowding the default table. Default a new percentage line to a simple base such as Construction fixed costs; expose Group and selected-line bases when chosen. Show only Groups that currently contain fixed lines. When a selected fixed line is deleted or a Group becomes empty, prevent an unnoticed cost change: show an affected-percentage warning and require base reassignment or explicit continuation. Reject a percentage line selected as another percentage line's base in UI and parser.
4. **Persistence and file paths:** Update `projectRepository.ts`, revision snapshots, `projectBackup.ts`, `exportProjectCsv.ts`, and the Excel import's existing-item planner. Excel rows remain fixed-cost lines. Import projections must recalculate the *whole Project* before and after an edit, because changing one fixed line changes dependent percentage amounts. JSON backup parsing and merge comparison must preserve and validate percentage bases.
5. **Planning handoff:** Keep Planning's own stage contingency and engineering model unchanged in the first release. Map its contingency to an explicit Project percentage line based on fixed Construction lines. Map Planning design engineering, construction engineering, right-of-way, and utilities to their full calculated amounts as fixed Project lines. Remove the current net-of-contingency workaround that exists only because Project v10 applied a global percentage to Other costs. Keep the one-time handoff total within $1; later Project edits recompute its contingency but do not resync Planning or automatically reprice the fixed engineering snapshot.
6. **UI and documentation:** Replace the editable global contingency percentage in `src/ui/renderProjectWorkspace.ts` with the sum of explicit contingency lines. Show the calculation basis in plain terms. Update `architecture_overview.md`, `docs/data_schema.md`, `docs/implementation_notes.md`, `user_workflow.md`, and the Planning handoff notes after implementation.

### Cost invariants and verification

- For every Project: `Total = Construction + Other + Contingencies`, and every displayed line amount comes from the same calculation result.
- A percentage base contains fixed lines only. Group membership changes and selected-line deletion cannot create a hidden dependency or a stale amount.
- A v10 Project and its migrated v11 Project have the same total to the cent. Old backup versions remain readable and new backups round-trip without dropping a line.
- Two contingency lines may use different bases; the top-row Contingencies value is their sum. Non-contingency percentages stay in Construction or Other.
- Project CSV, import preview, backup summary, sorted line totals, and on-screen summary agree. Planning-to-Project handoff remains within $1 for every existing template and for projects with right-of-way, utilities, overrides, and edited unit costs.

Use focused pure calculation, migration, backup, import, and handoff checks under `src/projects/` and `src/planning/`. A broad UI test that merely repeats formulas is unnecessary; inspect the editor visually at desktop and narrow widths. Run typecheck and the relevant UI build per `codex.md`.

### Decisions applied in Cost-A

1. **Fixed-dollar contingency:** Allowed through a separate contingency role on custom fixed lines.
2. **Selected-line deletion:** Blocked until the engineer removes or reassigns the dependent percentage base.
3. **Group base behavior:** Live membership by normalized Group name. Calculated amounts update as fixed-line Groups change; empty bases display a warning.
4. **Rate limits and labels:** Any finite nonnegative rate is allowed, including above 100%; a contingency may have either Construction or Other category because its role places it in the Contingencies subtotal.
5. **Planning engineering costs:** Fixed snapshot amounts at handoff. Planning contingency alone becomes a live percentage line in the Project.

The Sol orchestrator owns these product decisions and the schema/calculation design. Luna can inventory every `projectLineTotal`/`projectCostSummary` call site, extract legacy backup fixtures, execute focused suites, and review migration results read-only. Any implementation delegation needs exclusive file ownership; `projectWorkspace.ts`, `projectRepository.ts`, `renderApp.ts`, and shared CSS remain Sol integration files.

## Planning-B — Roundabout and Interstate templates (#11)

### Discovery before template code

The current Colorado library contains six templates, four base treatments, corridor/spot/other elements, and no roundabout or Interstate element or template. A template is an element selection and input preset, not a reliable cost model by name alone. `data/planning/co_element_library.json`, `src/planning/library.ts`, `templates.ts`, `calculate.ts`, and `docs/planning-v2-calibration.md` are the main sources.

1. **Define a first use case for each.** A tractable roundabout pilot could be a single-lane urban roundabout with a stated number of approaches. Interstate work needs a specific first scope—resurfacing, widening, new alignment, or interchange—because their quantities and risk are materially different. Do not combine them in one generic Interstate total.
2. **Set inputs and exclusions.** For a roundabout: number of approaches, circulating lanes, size or diameter, pavement, curb, pedestrian facilities, and treatment of drainage, right-of-way, utilities, and traffic control. For Interstate: project length, lanes before/after, shoulder and median work, bridges, drainage, barriers, traffic control, and whether interchange work is included. Decide which inputs are Project-wide and which are element overrides.
3. **Map quantities and prices.** Reuse supported Colorado bid-item price-table components where unit and quantity rules match. Calibrate assemblies from multiple relevant engineer examples or contracts; label exclusions and uncertainty. An isolated roundabout example in `docs/planning-v2-calibration.md` is a reference point, not sufficient calibration. A missing or unit-mismatched price must be resolved or clearly require a manual amount before release.
4. **Build library entries:** Add distinct element IDs and template selections. If a roundabout is reusable within a corridor alternative, define it as a spot element and optionally a standalone template. Add an Interstate base treatment only after its factor set and geometry are supported; otherwise provide a narrower template using existing base types with explicit limitations. Keep library IDs stable once share files can contain them.
5. **Check full workflow:** Validate the library, quantity rules, estimate totals and range, template switching, share-file import, CSV export, and engineer Project handoff. Add independent calibration fixtures and compare resulting totals with engineer reference estimates. Update the calibration report and user-facing assumptions.

### Required engineer inputs

- Which roundabout configuration should ship first, and should it be a reusable spot element, a standalone template, or both?
- Which Interstate project type should ship first, and is Colorado the only intended state for this release?
- Which two or more representative estimates or contracts should anchor each template's quantities and unit costs?
- Which items should be explicitly excluded by default rather than assumed at $0?

This package remains a discovery and calibration plan until those inputs are available. Sol owns scope, cost interpretation, and final template design. Luna can perform bounded catalog/price-table inventories, check item-unit matches, and run isolated library/fixture checks after Sol selects components. Do not delegate selection of comparable projects or approval of calibrated costs to Luna.
