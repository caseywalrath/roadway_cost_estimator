# Cost model and Planning template implementation plan

**Status (2026-10-20):** Cost-A is implemented in the current Project schema v12. The original percentage model shipped in v11; later Project UI and deletion decisions are recorded below. Planning-B roundabout and Interstate templates remain discovery and calibration work. This plan expands the [quality-of-life roadmap](planning-engineering-qol-roadmap.md); its original planning baseline was repository commit `f9145a9`.

## Cost-A — Percentage-based Project items (#13)

### Implemented rule and line model

Percentage lines use **fixed-cost lines only** as their base. No percentage line can depend on another percentage line, directly, through a Group, or through selected lines. This user decision removes recursive calculation.

Project lines use fixed or percentage pricing. Schema v11 introduced the model, and the current workspace schema is v12:

- Catalog and custom fixed lines use `pricingMode: "fixed"` (or an omitted mode on older records), quantity, and unit cost.
- A percentage line is custom, with `pricingMode: "percentage"`, a nonnegative rate, and a base selector. Its amount is derived from the current Project. Percentage pricing is independent of Cost Category: Construction, Contingency, or Other. Fixed-dollar contingency items are also allowed. Legacy `costRole: "contingency"` lines normalize to the Contingency category.
- Base selectors are **All fixed costs**, **Construction costs**, **Other costs**, one **Group**, or **Selected Items**. Selected Items stores stable fixed-line `lineItemId`s. A Group base follows its current fixed members. Construction and Other bases exclude contingency lines; All fixed costs and explicitly selected items may include fixed contingencies.
- Contingency-category lines determine the top-row **Contingencies** sum. Other percentage lines contribute to Construction or Other. The three subtotals sum to Total Project Cost without double counting.

Calculations retain full precision until display/export formatting. The Project table shows the `$` or `%` pricing control in Unit Cost, the rate in Quantity, the base selector in Unit / Base, and the derived amount in Total Item Cost. Selecting **Selected Items** opens the fixed-item selector. A valid base with no eligible fixed lines calculates to $0 without a generic empty-base warning. Missing selected line IDs can still produce a specific warning.

### Completed implementation stages

1. **Schema and migration:** `src/projects/projectWorkspace.ts` reads older Project records and backups. A v10 global contingency percentage becomes an explicit contingency line; zero does not add a line. Existing Project and line identities are retained.
2. **One calculation path:** `calculateProject` derives fixed and percentage line amounts, bases, Construction, Other, Contingencies, and Total. Table totals, sorting, CSV, backup summaries, and import projections use Project-aware calculations.
3. **Edit rules:** One Add Item control creates a custom fixed line. Its Unit Cost `$` control switches it to percentage pricing. Percentage lines default to Construction costs and offer Group and Selected Items bases through Unit / Base. Deleting a fixed line referenced by Selected Items identifies the dependent percentage line in a confirmation, removes that ID from the base, and recalculates; an empty base gives $0. Percentage lines cannot be selected as base items.
4. **Persistence and file paths:** Project revisions, JSON backups and comparison, CSV, and Excel import projections preserve or recalculate percentage lines. Excel rows import as fixed lines. A changed fixed line can alter dependent percentage amounts in the projected Project total.
5. **Planning handoff:** Planning's stage and engineering calculations remain in Planning. Handoff maps its effective contingency to a Construction-based Project percentage line; design engineering, construction engineering, right-of-way, and utilities become fixed snapshot lines. The one-time totals reconcile within $1. Later Project edits recalculate contingency without syncing or repricing those snapshots.
6. **UI and documentation:** The global contingency percentage control was replaced by explicit contingency items and their top-row sum. The cost category selector offers Construction, Contingency, and Other; the separate Add Percentage control and separate contingency-role control were removed.

### Cost invariants and verification

- For every Project: `Total = Construction + Other + Contingencies`, and every displayed line amount comes from the same calculation result.
- A percentage base contains fixed lines only. Group membership changes and selected-line deletion recalculate dependent amounts; deletion warns before the change.
- A v10 Project and its current-schema migration preserve the prior total to the cent. Old backup versions remain readable and new backups round-trip without dropping a line.
- Two contingency lines may use different bases; the top-row Contingencies value is their sum. Non-contingency percentages stay in Construction or Other.
- Project CSV, import preview, backup summary, sorted line totals, and on-screen summary agree. Planning-to-Project handoff remains within $1 for every existing template and for projects with right-of-way, utilities, overrides, and edited unit costs.

The implementation has focused calculation, migration, backup, import, and handoff coverage under `src/projects/` and `src/planning/`. Later UI refinements use the same Project calculation path.

### Decisions applied in Cost-A

1. **Fixed-dollar contingency:** Allowed by setting a custom fixed line's Cost Category to Contingency.
2. **Selected-line deletion:** Allowed after a confirmation that names affected percentage lines. The removed ID leaves each Selected Items base and the percentage amounts recalculate.
3. **Group base behavior:** Live membership by normalized Group name. Amounts update as fixed-line Groups change; an empty base calculates to $0 without the removed generic warning.
4. **Rate limits and labels:** Any finite nonnegative rate is allowed, including above 100%. Cost Category, not pricing mode, determines which subtotal receives the line.
5. **Planning engineering costs:** Fixed snapshot amounts at handoff. Planning contingency alone becomes a live percentage line in the Project.

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
