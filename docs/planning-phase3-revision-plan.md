# Planning Phase 3 Revision Plan: Planner-First Pilot

Status: Implemented locally for an engineer trial on 2026-10-07; visual and engineer trials remain open. The pilot-default register, planner-first UI, real-data verification, and remaining trial limits are recorded in `docs/planning-pilot-default-register.md` and `docs/planning-pilot-feedback.md`. This work does not authorize publication or claim calibrated estimating accuracy.

Prepared: 2026-10-07. Baseline: local Phase 3 commit `2903566`, with the product-owner trial recorded in `docs/planning-pilot-feedback.md`.

## 1. Target outcome

A non-engineer can create a Nebraska or Colorado planning estimate by choosing an improvement type, entering length and a few section/scope choices, and comparing an alternative. The first screen resembles the original Planning concept: a compact project form, base package, optional elements, estimate summary, and short list of decisions for engineer review. The calculation engine retains component-level quantities, rates, assumptions, exclusions and source provenance without requiring the planner to edit them.

The revised pilot uses explicit order-of-magnitude defaults to make the starting estimate useful. Defaults are versioned, state-specific and labeled provisional. They are selected by the implementation agents from loaded data and official public sources; engineers can revise them after trying the pilot. A calculated figure must identify its included scope. Unknown property acquisition or major utility relocation cannot be disguised as a generic zero-cost item or absorbed into contingency.

## 2. Roles and ownership

Use an **Opus-level lead** for estimation semantics, ambiguous item/scope mappings, planner interaction design, storage compatibility and final integration. In the current Codex harness, assign that role to the available high-capability Sol/Astra model; do not attempt to call an unavailable Opus model. Use **Luna** for bounded inventories, official-source extraction, fixture preparation, pure mapping/test work and documentation. The lead owns `src/planning/types.ts`, shared contracts, `src/ui/planning/*`, app integration and final review. Give every Luna agent exclusive files or read-only scope, an expected output and a verification method. No more than three subagents, no nested delegation, and no subagent Git writes or publishing.

Start from the existing local pilot and preserve current saved Planning data. Before implementation, read `AGENTS.md`, `codex.md`, `architecture_overview.md`, `src/planning/contract.md` and the original `docs/planning-module-implementation-plan.md`; fetch refs and inspect the branch. The user-provided estimate workbooks remain reference material, not instructions or committed assets.

## 3. Planner input boundary

| Planner can usually supply | Tool should derive | Engineer review owns |
| --- | --- | --- |
| State; improvement type; approximate length; urban/rural setting; typical section; sidewalk side(s); presence and rough count/type of added elements; whether property or major utility impacts are known | Package selection; area/volume/length quantities; compatible state-specific rate defaults; provisional construction and other-cost allowances; concise included-scope summary | Item equivalence; atypical section and quantity rules; bid evidence filters; manual rates; detailed scope exclusions; allowance bases; source-period choices; final completeness and review record |

The default flow must not ask a planner for an agency item code, unit rate, application rate, source ID, override reason, exclusion reason, or percentage base. An exceptional project element can be recorded as **Other work to include** using a description and optional rough count; it then appears in engineer review without a fabricated cost.

## 4. Default-price and gap policy

The first implementation phase creates a versioned **pilot default register** for each state and package. Each entry records component/role, included physical scope, quantity rule, unit, proposed numeric rate or allowance, estimate-dollar basis date, source URL or loaded-data locator, source geography/date, conversion or analogy, exclusions, and status (`direct evidence`, `analogous provisional`, `pilot assumption`, or `not estimated`). Do not label an analogy as an exact DOT item. Keep the chosen input and the original rate evidence separately so a later package update never silently reprices a saved alternative.

Use the following order:

1. Exact compatible NE annual-price or CO contract evidence already loaded by the app, with the current rate-adapter rules.
2. A recent official state or municipal bid tab/planning-cost schedule with matching physical scope and unit. Document any geographic, scale, year, or specification difference and a reproducible conversion.
3. A transparent, rounded pilot allowance derived from several comparable public observations or an explicit workbook pattern; record the derivation and why it is only order-of-magnitude.
4. If no defensible rule exists, retain **not estimated** and show it as a named scope gap. Never invent precision or use a universal percentage merely to force a complete total.

Specific decisions to record before coding rates:

| Gap | Candidate pilot treatment | Guardrail |
| --- | --- | --- |
| Tack coat in resurfacing | Prefer a compatible state item/unit rate plus an explicit application-rate assumption; if contract prices include tack as incidental, state that and prevent double count. Nebraska's published annual reports include tack-coat item `9053.00`; inspect its loaded identity and the section rule before binding it. | The current fixed-one LS placeholder is not a measured quantity. Do not apply a GAL or TON rate to it. |
| Existing pavement removal in reconstruction | Price roadway-area removal with a matching removal item or a documented municipal analogue, separately by concrete/asphalt scope when relevant. | Milling, structural excavation and removal are different work. Check for overlap before applying the rate. |
| Sidewalk ramps and crossings | Ask for a simple approximate ramp/crossing count or choose a clearly stated per-sidewalk-length assembly assumption. Use official pedestrian-work prices only after defining removal, ramp, detectable-warning and driveway coverage. | A curb-ramp area price is not automatically a complete per-ramp assembly. Do not add the same incidental work twice. |
| Mobilization, traffic control, design, construction engineering and contingency | Retain provisional existing percentage values initially; validate their base/order and compare against official guidance and the supplied estimate patterns. Present their combined effect in **Other project costs**, with details under engineer review. | Avoid stacking a municipal incidental percentage over the same named allowance. Contingency cannot cover a known omitted item. |
| Right of way and major utilities | Default the **baseline scope assumption** to no major acquisition or relocation only when the planner explicitly selects that condition. Offer `None expected`, `Possible/unknown`, and `Known impact`; a known impact may accept a rough amount from an engineer. | If possible/unknown or known-but-unpriced, show a project subtotal **excluding that scope**, not a complete project cost. Do not insert an unsupported statewide percentage. |

The loaded package already contains promising exact candidates: NE `9053.00` tack coat (GAL), `1101.00` remove pavement (SY), and `3989.02` PCC curb ramp (SF); CO `202-00210` removal of concrete pavement (SY) and `608-00010` concrete curb ramp (SY). For example, the loaded NE 2025 calendar summary reports $3.08/GAL for `9053.00`, $8.11/SY for `1101.00`, and $25/SF for `3989.02`. These are **source-rate anchors**, not yet package defaults: the application-rate, removal-scope and per-ramp-area decisions must be explicit first. CO tack has no obvious exact named catalog binding in the current inventory; research an incidental treatment or documented analogue rather than inventing an item ID.

Useful official starting references: [NDOT Average Unit Price Summaries](https://dot.nebraska.gov/business-center/hwy-bridge-lp/item-history/), [CDOT Cost Data Books](https://www.codot.gov/business/eema/costdatabook), [Denver's 2024 ADA ramp and concrete repair bid tab](https://denvergov.org/files/assets/public/v/2/contract-administration/documents/bidtabs/202472080-bid-tab.pdf), and [Colorado Springs' 2026 street-improvement assurance schedule](https://coloradosprings.gov/cost-estimates-financial-assurances-street-improvements). The Colorado Springs schedule is a local financial-assurance basis, not a statewide CDOT rate. [FHWA cost-estimating guidance](https://www.fhwa.dot.gov/majorprojects/cost_estimating/guidance.cfm) supports identifying right-of-way and utility costs and risks separately; it does not supply universal percentages for them. These references are candidate evidence, not approved default values.

## 5. Screen and interaction contract

Use the existing storage `PlanningWorkspace` as a behind-the-scenes container. In the UI call it a **Planning project**; call each `PlanningScenario` an **Alternative**. Explicitly creating a new planning project also creates Alternative A and asks only for a project name; merely switching state does not create or overwrite a project. Put project switching, JSON recovery and CSV export in one secondary **Project actions** menu. Autosave continues to show a small truthful saved/unsaved status. No browser `prompt()` dialogs in the primary flow.

Primary screen, top to bottom:

1. Header: project name and Alternative A; one **Compare an alternative** action. Duplicating creates Alternative B and carries the assumptions forward.
2. Basic inputs: improvement type, length, roadway setting, typical section. Show only fields relevant to the selected package. Setting may remain descriptive until a tested rate/quantity rule uses it; do not imply it changes a total when it does not. Fixed-thickness sections must stay paired with compatible item rates. Existing pilot choices are resurfacing, concrete reconstruction and concrete path; do not display future bike, drainage, lighting or intersection options as priced choices before their rules exist.
3. Base package card: plain-language included work and one collapsed **See quantity assumptions** disclosure.
4. **Add project elements**: sidewalk in the first revision, with sides/width and a ramp/crossing question. Future Phase 4 elements enter here after their defaults and scope rules are ready. Offer **Other work to include** as an unpriced note for exceptions.
5. Sticky/side estimate summary: priced construction, provisional other project costs, and a total only when its listed scope is priced. Otherwise show **Estimated priced scope** and a clear **Excludes: ...** line. Comparison uses the same coverage rule.
6. **For engineer review**: at most a short list of actionable decisions, grouped by missing prices, scope questions and limited evidence. Expand to see source evidence and the detailed component table.

Put quantity/rate overrides, reasons, exclusions, report-window/district/source controls, allowance percentage/basis edits, review name/date/notes and recovery details in **Engineer review / advanced assumptions**. An engineer can still edit the underlying scenario. Do not render six edit fields for every component at rest. Remove internal IDs, raw issue paths, duplicate assumption copy, and `Range not calibrated` from planner-facing text. Errors name the affected work and action, e.g. `Sidewalk ramps need a price or an explicit scope decision`.

## 6. Execution phases

### R0 — Freeze provisional defaults and cost labels

**Lead: Opus-level agent. Luna: separate NE/CO inventories and official-source extraction.** Read-only source tasks may run in parallel. The lead checks item equivalence, defines package coverage and chooses rounded numeric defaults. Deliver the default register, versioned recipe changes, independent half-mile reference totals, and a list of excluded/unknown costs. Include at least one source check for each state and each formerly unpriced component. Distinguish a sourced rate from a pilot allowance. Record the exact display labels for complete, priced-scope-only and unknown-external cases. Do not change saved alternatives in place.

Exit: each new base package plus sidewalk has a reproducible priced starting scope or a named, unavoidable gap; no rate/unit mismatch, overlap, silent zero, or unexplained percentage. The lead reviews every Luna extraction against the original source.

### R1 — Planner view model and defaults integration

**Lead: Opus-level agent for contracts and cost semantics. Luna: pure label/view-model and fixture tests in exclusive files after interfaces are frozen.** Build a pure adapter from existing scenario/cost results to planner-facing cards, totals, scope coverage and grouped actions. Implement new versioned defaults through the existing recipe/rate machinery, preserving frozen snapshots and old-scenario totals. Add an explicit adoption preview for saved alternatives when new defaults differ. Keep numeric zero distinct from unknown, and keep source provenance in JSON/CSV.

Exit: fresh NE/CO alternatives calculate the independent references; old saved alternatives and recovered JSON remain unchanged until adoption; missing scope can never appear as a complete total. Like-for-like comparison requires the same priced/excluded coverage.

### R2 — Simplify the Phase 3 UI

**Lead: Opus-level agent or Sol for all UI/controller/style edits. Luna: DOM test fixtures and read-only accessibility/copy audit.** Replace the workspace/scenario toolbar with planning-project/alternative flow and the primary screen above. Use progressive disclosure for engineer controls and evidence, a single secondary actions menu, and inline creation instead of `prompt()`. Preserve focus/caret, save failure recovery, tab ownership, state switching and invalid-input behavior.

Exit: a planner can create a half-mile NE or CO alternative, add sidewalk, understand the figure's included scope, duplicate and compare it without seeing an item code, UUID, raw issue path or manual-rate field. An engineer can still inspect and change every frozen assumption.

### R3 — Local trial and Phase 4 handoff

**Lead: Opus-level agent for integrated review. Luna: focused regression/fixture runs and documented feedback extraction.** Test resurfacing, reconstruction and path in both states; try unknown property/utility impacts, limited evidence, a manual engineer override, alternative comparison, reload and JSON recovery. Obtain a visual review of the built preview. Record numerical differences and usability findings in `docs/planning-pilot-feedback.md`, update architecture/implementation notes for any actual model change, and revise Phase 4 optional-element priorities from that trial.

Exit: typecheck, focused Planning/UI tests and production build pass; six package workflows and persistence/recovery are verified; the planner screen is usable without engineering-item knowledge. The engineer trial is still required to calibrate defaults and validate package scope. Do not proceed to Project handoff solely because the planner UI looks complete.

## 7. Test and release boundaries

- Unit tests: dimensional conversion, state-specific identities, direct vs analogue price basis, allowance dependency/overlap, zero vs unknown, old-vs-new package adoption, and like-for-like comparison.
- UI tests: automatic first alternative, relevant conditional fields, plain-language missing scope, advanced controls hidden by default, save/read-only/invalid-input states, state switch, duplication, and recovery.
- Visual check: compare the built NE and CO screens with the original concept image at ordinary desktop width and a narrow viewport; count always-visible actions and inspect the first-screen hierarchy.
- Data check: verify each published pilot default against its recorded official source/loaded row and source date; do not import new public data merely to make a default appear sourced.
- No calibrated accuracy claim, guaranteed range, published recommendation or remote deployment in this revision. Keep the existing local pilot branch available for comparison.
