# Planning Module Implementation Plan

Status: Phases 0–2 complete; Phase 3 implemented locally, with planner-first revision planned in `docs/planning-phase3-revision-plan.md` before Phase 4.
Prepared: 2026-10-06.
Repository baseline inspected: `5ef3d9c` on current `origin/main`.
Execution model: primarily Luna; Sol owns architecture, UI, persistence correctness, Project compatibility, ambiguous engineering mappings, and final integration/review.

## 1. Objective and authority

Build a working Planning module first, with plausible provisional packages that engineers can use, inspect, and revise. Do not require a completed calibration study or engineer approval of every default before building the pilot.

The user approved the proposed Planning UI and planner workflow and requested this phased plan. On 2026-10-06 the user authorized Phase 0 as needed and Phase 1 for both pilot states; on 2026-10-07 the user authorized Phase 2. This document defines implementation defaults for those requests; later phases and deployment remain separate work. During an implementation session, execute the specified scope without repeatedly asking the user to approve routine reversible choices.

The first usable pilot must let a planner select a project type, enter basic geometry, add common elements, obtain a traceable estimate for the priced scope, duplicate a scenario, edit assumptions, save locally, and export a reviewable backup. Engineers must be able to identify and change the assumptions responsible for a result.

The build-first approach changes the order of validation: validate calculations and provenance before the pilot; use the pilot to evaluate engineering assumptions and calibration. Functional correctness does not establish engineering accuracy.

The user request explicitly reopens scenario modeling and automatic package estimates for the new Planning module. Older roadmap exclusions do not block this additive feature. Existing Explorer evidence selection, state isolation, and Project behavior remain the compatibility baseline.

## 2. Scope and delivery milestones

### Included

- A Planning tab beside Explorer and Project, using existing FHU styling.
- Nebraska and Colorado pilots, each with resurfacing, concrete reconstruction and concrete path packages, plus a small set of optional elements.
- Explicit package assumptions, quantities, item mappings, rate sources, allowances, and exclusions.
- Nullable/unpriced results; a priced-scope subtotal separate from a complete project total.
- Browser-local named Planning workspaces with independent scenarios.
- Manual quantity/rate/allowance overrides with original values and reasons retained.
- Scenario comparison, JSON recovery, CSV review export, and scenario review records.
- A later one-way snapshot transfer into a new engineer-facing Project.
- Engineer feedback and versioned revisions to pilot package definitions.

### Deferred

- Bridges, retaining walls, major grading, signals, roundabouts, railroad work, detailed utility relocation, and right-of-way appraisal packages.
- Automatic interpretation of plans, GIS geometry, workbooks, or free-text project descriptions.
- Automatic cross-state equivalence, municipal-to-DOT fuzzy matching, and rollout beyond the two pilot states.
- New public bid-source imports, a server database, accounts, live shared editing, or private cloud storage.
- Bidder-average/awarded/engineer price pooling, statistical accuracy claims, and probabilistic contingency modeling.
- Live synchronization between Planning scenarios and Project lines; updating existing Projects during transfer.

| Milestone | Completion point | Result |
| --- | --- | --- |
| M1: Engineer-usable pilot | End of Phase 3 | Three package types in each pilot state, real state-specific rates where available, editable assumptions, saved scenarios, comparison and recovery export |
| M2: Revised planning workflow | End of Phase 4 | Engineer feedback incorporated, optional elements, cost review export and review status |
| M3: Engineer handoff | End of Phase 5 | Complete priced scenario becomes a traceable Project snapshot |
| M4: Release candidate | End of Phase 6 | Compatibility checks, documentation and reviewed pilot limitations |

## 3. Model routing and agent operating rules

Use `gpt-6-luna` for bounded implementation under approved contracts, mechanical item inventories, deterministic tests, fixtures, serializers, reports and documentation. Use `gpt-6.1-sol` for the work marked Sol below. These are the callable Luna/Sol model IDs available when this plan was prepared; if unavailable at execution, use an available model from the same family and record the substitution. Do not substitute Luna for Sol-only work merely to finish a phase.

The user's request permits more Luna implementation than the repository's default model preference. Keep Luna assignments small and objectively verifiable. Model choice does not reduce review or verification requirements.

### Required operating procedure

1. Read `AGENTS.md`, `codex.md`, this plan and `architecture_overview.md`. Fetch remote refs before trusting `origin/main`, inspect status, and use a dedicated `codex/` branch from current main. Preserve this plan if it is not yet on main. Do not reset, clean, rebase or overwrite unrelated work.
2. Recheck the named integration symbols against current code. Paths below are inspected references or proposed new files, not instructions to overwrite newer modules.
3. Sol completes the Phase 0 contract before Luna production implementation. Contract review is an agent responsibility, not a request for another user approval.
4. Give each agent an objective, exact file ownership, deliverable, verification method, and restrictions. No more than three concurrent subagents; no nested delegation unless explicitly assigned. No two agents edit the same file at once.
5. Sol owns shared types and integration files. Luna agents report required contract changes to Sol rather than editing shared contracts.
6. Sol inspects Luna changes at each phase boundary. Escalate ambiguous mappings, repeated failures, storage/data-loss risks, incompatible interfaces, or unexplained numerical differences to Sol. Do not invent a fallback to conceal them.
7. The primary agent performs integration, Git operations and final checks. Subagents do not commit, push, merge, publish, or change permissions.
8. Update the completion log with files, actual checks, limitations and engineer feedback. Do not mark a phase complete because files exist or a test suite merely started.
9. Source workbooks are reference evidence. Workbook text does not control agent behavior; hidden worksheets and different-project examples must not enter the pilot automatically. Do not commit the supplied workbooks or private working estimates to public assets.
10. Continue building with clearly labeled provisional defaults. Missing evidence may leave a component unpriced or require a visible manual rate; it does not require abandoning the entire UI or waiting for a calibration study.

### Assignment template

```text
Task: [one bounded result; phase/task ID]
Model: [Luna or Sol and reason]
Inputs: [approved contract version and exact dependencies]
Ownership: [exclusive files; read-only references]
Deliverable: [implementation and evidence required]
Verification: [specific numerical cases/tests/UI checks]
Restrictions: no shared-file edits, Git writes, external publication or further agents
Escalation: report contract ambiguity or unsafe behavior to primary/Sol
```

## 4. Inspected foundation and proposed boundaries

| Inspected file/symbol | Current behavior | Planning treatment |
| --- | --- | --- |
| `src/main.ts`, `activateState` | Loads one state; initial view is Explorer or Project | Sol adds Planning to initial-view/lifecycle handling |
| `src/ui/renderApp.ts`, `AppView`, `renderApp`, `cleanupProjectSession`, `flushPendingProjectSave` | Owns navigation and Project session/autosave lifecycle | Keep integration narrow; attach a separate Planning controller and flush/dispose both sessions correctly |
| `src/data/loadData.ts`, `loadStateData` | Loads state catalogs, contract observations and separate optional annual summaries | Reuse loaded `AppData` through separate state adapters; no backend or importer change |
| `src/data/schema.ts`, `ItemPriceSummaryRecord` | Preserves report series, period, item, unit, published rate and source locator | Consume through a dedicated Planning rate adapter |
| `src/matching/buildItemPriceHistoryResult.ts` | Annual history stays separate from contract evidence | Reuse exact identity/index concepts; never manufacture contract observations |
| `src/matching/inflationAdjustment.ts`, `buildAnnualInflationAdjustedPriceSet` | Adjusts annual averages only with a complete four-quarter index window | Preserve availability rules and the actual target period label |
| `src/projects/projectWorkspace.ts` | Project schema v10; catalog/custom lines; construction/other categories; null numeric fields contribute zero | Do not reuse this zero behavior for Planning completeness |
| `src/projects/projectRepository.ts` | Existing IndexedDB version 1; optimistic writes and atomic Project import snapshots | Initial Planning storage is isolated; Project transfer uses explicit creation |
| `src/projects/projectBackup.ts` | Complete Project JSON recovery; accepts schema versions 4 through 10 | Sol preserves compatibility when adding Planning provenance later |
| `src/projects/projectEditCoordinator.ts` | BroadcastChannel edit ownership | Adapt its pattern for Planning without claiming Project ownership |
| `src/ui/exportProjectCsv.ts` | Reporting export; JSON is recovery format | Create separate Planning exports; preserve existing Project columns |

### Proposed file ownership boundaries

These filenames are implementation targets. Sol may rename a boundary during Phase 0, then freeze it in the contract before delegation.

| Area | Proposed files | Owner |
| --- | --- | --- |
| Shared contract | `src/planning/types.ts`, `src/planning/contract.md` | Sol |
| Recipe definitions and validation | `src/planning/recipes/nebraskaPilot.ts`, `src/planning/recipes/coloradoPilot.ts`, `src/planning/validateRecipes.ts` | Luna after contract |
| Quantity and cost functions | `src/planning/units.ts`, `src/planning/quantityEngine.ts`, `src/planning/costEngine.ts` | Luna after contract |
| Nebraska evidence adapter | `src/planning/nebraskaRates.ts` | Luna after contract; Sol reviews policy/mappings |
| Colorado evidence adapter | `src/planning/coloradoRates.ts` | Luna after contract; Sol freezes sampling/provenance policy |
| Workspace mutations and comparison | `src/planning/planningWorkspace.ts`, `src/planning/compareScenarios.ts` | Luna after contract |
| Persistence/concurrency | `src/planning/planningRepository.ts`, `src/planning/planningEditCoordinator.ts` | Sol |
| Backup/review exports | `src/planning/planningBackup.ts`, `src/ui/exportPlanningCsv.ts` | Luna after contract |
| UI/controller | `src/ui/renderPlanningWorkspace.ts`, `src/ui/planningController.ts`, app shell and CSS changes | Sol |
| Project snapshot transfer | `src/planning/toProjectSnapshot.ts`, required Project schema/backup/UI changes | Sol |
| Tests and documentation | Colocated `*.test.ts`, focused fixture files, docs | Luna; primary assigns non-overlapping ownership |

Keep recipe logic, pricing, calculations and persistence out of `renderApp.ts`. Avoid a framework replacement, formula parser, new dependency or generic rules platform for the pilot.

## 5. Provisional pilot package library

Include Nebraska and Colorado at M1. Nebraska uses NDOT annual summaries; Colorado uses existing contract observations. Equivalent package types share workflow and geometry rules, but have separate versioned recipes, item identities and rate policies. Do not claim equivalent specifications or calibrated costs. Iowa and South Dakota show an explicit pilot-unavailable message. Never load another state's prices under the selected state's identity or convert a saved scenario merely by switching states.

All proposed dimensions, density, waste and allowance percentages below are editable starting assumptions. They are not engineering design standards or calibrated municipal cost rules. Record each default's origin as `pilot_assumption` or a specific workbook reference; matching a workbook pattern does not make it an approved standard.

### Three base packages

| Package | Starting geometry/section | Quantity rules and scope |
| --- | --- | --- |
| NE asphalt milling and resurfacing | 0.5 mile example length; two 12 ft lanes; 2 in milling and asphalt layer; assumed asphalt density 145 lb/cu ft; 5% material allowance | Milling area = length ft × treatment width / 9 SY. Asphalt tons = area SF × thickness in / 12 × density / 2,000 × 1.05. Include tack as a separately identified provisional allowance until an exact suitable item is bound. Exclude widening, base replacement, drainage reconstruction and deep repairs. Milling-inlay and Type SPS price bindings are provisional scope choices. |
| NE concrete roadway reconstruction | Two 12 ft lanes; 9 in doweled concrete; 6 in crushed-rock base; curb/gutter on both sides enabled | Pavement and 6 in base use the same roadway area SY. Structural-section excavation uses assumed 15 in depth over roadway area, converted to CY. Include pavement removal as a separate quantity component with an exact suitable binding or manual/unpriced status. Curb/gutter = length ft × selected sides. This excavation rule excludes additional cut/fill, unsuitable soils and mass grading. |
| NE concrete bikeway/shared-use path | 10 ft path; 5 in concrete; 6 in crushed-rock base | Surface and base use path area SY. Structural-section excavation uses assumed 11 in depth, converted to CY. Source pavement is explicitly a 5 in NDOT bikeway item used as a provisional package proxy. Identify that choice in assumptions; it does not establish generic municipal shared-use-path equivalence. Exclude bridges, retaining walls, major grading and lighting unless added. |

Example length is an editable form starting value, not a source-derived project length. Make each recipe work for other positive lengths. Blank input is not zero; do not silently replace blank width or thickness with a valid-looking estimate.

Fixed-thickness bid items must stay consistent with section choices. Changing a 9 in concrete section to 10 in must select an explicitly bound 10 in item or leave it unpriced. Never retain the 9 in SY price behind an arbitrary editable thickness. Asphalt TON quantity can respond to an explicit thickness/density assumption while retaining the selected mix identity.

### Optional elements

| Element | Initial implementation | Required scope treatment |
| --- | --- | --- |
| Concrete sidewalk | 5 ft width, one/both sides; 5 in sidewalk item; area SY | Ramps and driveway crossings are counted custom allowances or unpriced components; no assumption that pavement area covers them |
| Bike restriping | User supplies marked line length; pilot 4 in white line component | Labels, symbols, removal, color, protection and traffic changes are separate scope; no pavement added automatically |
| Drainage | Optional 20% of defined direct construction cost, copied as a provisional approach from Giles concepts | Not a measured pipe takeoff; disabled by default for resurfacing/path. Explicit pipe work replaces the overlapping allowance, not adds to it |
| Lighting | User supplies pole/unit count; exact lighting-unit binding plus custom electrical allowance | A pole/unit price does not include all wiring, trenching, service and connections; unresolved electrical work prevents a complete total |
| Clearing/site preparation | Explicit manual LS allowance, initially blank | NDOT clearing is LS; do not apply a statewide LS average as a per-acre or project-size-independent complete allowance |
| Culvert/pipe crossing | Later user-entered diameter/type/length, plus associated components | Pipe, excavation, ends and restoration are distinct; driveway culvert and storm sewer are not equivalent |
| Right-of-way/major utilities | Explicit None assumed, Unassessed, or manual allowance | Unassessed is missing scope; ordinary utility allowance does not resolve known major relocation |

Only sidewalk and basic allowances are required at M1. Add bike restriping, lighting and a bounded pipe example in Phase 4 after the first engineer trial. Phase 3 must still expose custom additions and removals so engineers can test missing elements.

### Verified Nebraska binding candidates

Descriptions/units were checked against `agency_item_versions.csv` and the `ne_ndot_aup_calendar_2025` rows in `item_price_summaries.csv`. IDs below are exact state/agency identities, not fuzzy matches. Sol confirms package applicability during Phase 0; Luna must not choose an interchangeable-looking alternative.

| Component | Exact `agencyItemId` | Report unit | Exact source description/scope |
| --- | --- | --- | --- |
| Milling | `ne_ndot_9179.79` | SY | MILLING FOR ASPHALTIC CONCRETE INLAY |
| Asphalt mix | `ne_ndot_9005.23` | TON | ASPHALTIC CONCRETE, TYPE SPS |
| Roadway concrete | `ne_ndot_3075.46` | SY | 9 in DOWELED CONCRETE PAVEMENT, CLASS 47B-3500 |
| Path proxy | `ne_ndot_3016.65` | SY | 5 in CONCRETE CLASS 47B-3500 BIKEWAY |
| Sidewalk | `ne_ndot_3016.03` | SY | CONCRETE CLASS 47B-3000 SIDEWALK 5 in |
| Curb/gutter | `ne_ndot_3014.11` | LF | COMBINATION CONCRETE CLASS 47B-3500 CURB AND GUTTER |
| Base | `ne_ndot_8011.06` | SY | CRUSHED ROCK BASE COURSE 6 in |
| Excavation | `ne_ndot_1010.00` | CY | EXCAVATION |
| White marking | `ne_ndot_7495.04` | LF | 4 in WHITE PERMANENT PAVEMENT MARKING PAINT |
| Lighting unit | `ne_ndot_A008.70` | EACH | STREET LIGHTING UNIT, TYPE SL-S-40-6-LED40 |
| Storm pipe example | `ne_ndot_P700.18` | LF | 18 in STORM SEWER PIPE, TYPE 1,7 OR 8 |

Catalog spelling aliases such as SQ YD/SY and LIN FT/LF may normalize under an explicit unit table. Numerical area/volume conversions belong in the quantity engine. Do not collapse material classes, mix types, thicknesses, pipe types or different physical units.

Pavement removal and tack deliberately have no exact binding in this plan. Phase 0 inventories candidates; a clearly described manual/unpriced component is acceptable until Sol resolves the intended scope. Do not price missing work as zero to make a pilot look complete.

## 6. Pricing, totals and completeness contract

### Nebraska rates

1. Use exact `agencyItemId` and compatible normalized unit. Retain the original source description and unit.
2. Default to the latest calendar-year report included in the loaded package. The inspected default is `ne_ndot_aup_calendar_2025`. A newer July–June report exists; it is a distinct explicit source selection, not an extra independent observation to average with the calendar series.
3. Snapshot the selected source/summary ID, report dates/series, source page/locator, raw published average, adjustment method and target period. Label the basis `NDOT published annual average`.
4. Require a positive finite automatic price. Missing, zero, negative, conflicting or incompatible automatic evidence yields an unpriced result with a reason. A deliberate nonnegative manual rate, including zero, remains distinct and requires an assumption/reason.
5. If the chosen report lacks a component, show the gap. A user may explicitly select an older compatible period or manual rate; expose the older period on that line. Never silently blend years or choose a different specification.
6. Reuse annual NHCCI adjustment only when its complete report-window coverage exists. Otherwise retain the source rate, mark adjustment unavailable, and expose its period. Do not pretend all rates share an adjusted price date when only some could be adjusted.
7. Repricing is explicit. Data/library changes mark a saved scenario as having an update available; they do not alter its totals automatically. Selected rates/manual overrides remain frozen until the user accepts a reviewed change preview.
8. Future construction-year escalation is an optional Phase 4 assumption, separate from historical adjustment. Default is no future escalation; a future year alone must not silently create a forecast rate.

Contract-observation pricing is included for Colorado only. Do not run Nebraska aggregates through contract summary statistics, invent contract/bid counts, infer co-occurring packages from annual reports, or modify Explorer quick-fill behavior.

### Colorado packages and exact binding candidates

The following catalog identities and awarded-observation coverage were checked against the loaded Colorado CSVs on 2026-10-06. These are provisional scope candidates, not approved engineering equivalences. Counts below cover all loaded positive awarded observations, before pilot date/source filters; they are not the eventual selected sample size.

| Component | Exact agencyItemId | Unit and catalog scope | Loaded positive awarded rows / contracts |
| --- | --- | --- | --- |
| Milling | `co_cdot_202-00240` | SY; Removal of Asphalt Mat (Planing) | 223 / 218 |
| Asphalt | `co_cdot_403-34741` | TON; Hot Mix Asphalt (Grading SX) (75) (PG 64-22) | 15 / 15 |
| Roadway concrete | `co_cdot_412-00900` | SY; Concrete Pavement (9 Inch) | 8 / 8 |
| Path proxy | `co_cdot_608-00026` | SY; Concrete Bikeway (6 Inch) | 4 / 4 |
| Base | `co_cdot_304-06007` | CY; Aggregate Base Course (Class 6) | 151 / 151 |
| Excavation | `co_cdot_203-00000` | CY; Unclassified Excavation | 48 / 48 |
| Sidewalk | `co_cdot_608-00006` | SY; Concrete Sidewalk (6 Inch) | 48 / 47 |
| Curb/gutter | `co_cdot_609-21010` | LF; Curb and Gutter Type 2 (Section I-B) | 71 / 70 |

- CO resurfacing: same example length, width, asphalt thickness/density/material factor as NE, with the explicit CDOT mix and milling candidates above. Tack remains manual/unpriced until bound. Mix/planing applicability requires Sol review; no automatic mix substitution.
- CO reconstruction: 24 ft width, 9 in concrete, 6 in Class 6 base and 15 in structural excavation as provisional geometry. Base quantity = area SF × depth in / 12 / 27 CY, rather than NE's fixed 6 in SY item. Curb/gutter uses the selected section identity. Removal remains separately manual/unpriced until bound. The catalog concrete title does not establish NE dowel/material equivalence; record reinforcement/joint assumptions and unresolved scope explicitly.
- CO path: 10 ft width, 6 in bikeway pavement, 6 in Class 6 base and 12 in structural excavation. The explicit bikeway proxy has limited evidence and remains provisional for shared-use-path scope. This deliberately differs from NE's 5 in section. Changing to 5 in requires a suitable binding/manual rate; `co_cdot_412-00500` exists but has no positive awarded observations in the loaded package. Never silently retain the 6 in rate at 5 in thickness.
- CO optional sidewalk: retain width/side inputs, with a separate 6 in item and thickness assumption. Phase 4 lighting, markings and pipe examples require separate CO bindings; NE item IDs never serve as CO fallbacks.
- Start CO allowances at the same editable pilot percentages only as `pilot_assumption`, with no claim that Nebraska workbook values are Colorado calibration. Engineer trials evaluate each state's defaults separately.

### Colorado rate-selection contract

Sol freezes this policy in Phase 0; Luna implements it in Phase 2. No new import or backend is required for the pilot.

1. Match exact Colorado agencyItemId and compatible physical unit. Default source type is `cost_book`, price type `awarded_bid`, statewide. Exclude FHU estimate-only sources and other price types. Do not combine awarded, average and engineer values from the same source line as independent samples.
2. Default window: the three-year inclusive interval ending on the latest valid awarded date in the loaded Colorado cost-book dataset. Persist concrete From/To dates, dataset anchor, source IDs and selected observation IDs. Users can explicitly change the window or district; no silent widening if a filter leaves no evidence. Show the actual sample date range separately from the requested window.
3. Use positive finite prices and positive finite quantities with valid dates and compatible units. Select one observation per source contract-item identity. Multiple price types are not duplicates to average; overlapping imports for the same contract-item must resolve to one authoritative record or be flagged. Preserve legitimate separate lines, then compute the median eligible line price within each contract and the median of those contract medians. This gives each contract one contribution. Do not equate similar descriptions across codes or deduplicate legitimate lines merely by contract/code.
4. Label the result `Median awarded unit price across contracts`, with line count, independent contract count, source coverage, filter dates and actual evidence dates. Fewer than five contracts displays `Limited evidence`; this is a provisional warning threshold, not a statistical accuracy test. No compatible evidence remains unpriced; older dates or manual pricing require an explicit choice.
5. Default to unadjusted source prices with the evidence period visible. Optional NHCCI adjustment uses each observation's dated quarter and one common available target quarter before the two-stage median. Require index coverage for every selected observation; otherwise the adjusted mode is unavailable for that selection and the user can explicitly retain the unadjusted basis. Never silently mix adjusted and raw prices or drop rows with missing index coverage.
6. Freeze the full selected evidence/rate snapshot in the scenario and JSON backup, including contract contributions, exclusions and adjustment basis. Reprice only through an explicit change preview. Package updates and rate-policy changes carry separate version identifiers.
7. District and window controls belong in advanced price assumptions; use the existing Colorado district semantics. The primary form stays geometry-first. Changing state loads that state's library and workspace; it does not relabel or reprice existing scenarios. Project handoff keeps exact Colorado identities and the scenario state.

Sol must inspect the existing evidence relationships/source locators before implementing overlap reconciliation. Unresolved collisions remain visible rather than being counted twice. Municipality, project scale, terrain and treatment differences remain engineer-review limitations; a statewide median does not correct them.

### Starting allowance order

Define `D` as the priced direct construction components, including approved manual construction LS components, before percentage allowances. Percentage rules refer to stable component/tag sets and an acyclic dependency order, not table row positions or a grand total containing the allowance itself.

| Calculation | Provisional default |
| --- | --- |
| Mobilization | 8% × D |
| Traffic control | 5% × D |
| Drainage, only when selected | 20% × D |
| Minor utility allowance, only when selected | 5% × D |
| Construction subtotal S | D + selected construction allowances |
| Planning contingency K | 25% × S |
| Design/engineering | 10% × (S + K) |
| Construction engineering | 10% × (S + K) |
| Total project cost | S + K + services + separately assessed ROW/major-utility/other costs |

These percentages borrow starting values from the Giles workbook, not a calibrated rule for all three package types. This plan deliberately defines a direct-construction base rather than reproducing the workbook's row references, which can also include right-of-way. Engineers can change the values and bases from the first pilot. Allowances appear as named cost components with a visible base and source/default reason. Contingency never resolves a known unpriced item.

Keep computation at full numerical precision and round only presentation/export monetary values. Persist inputs and derived price snapshots; regenerate totals from inputs after recovery. Unit counts use integers where physically required. No formula `eval`, circular percentages, or silent clamp of invalid input.

### Missing scope and overlap

- Each cost component is priced, unpriced, or explicitly excluded; zero is a separate permitted numeric value.
- An unpriced required component makes dependent allowances and the full project total unavailable. Show the known priced subtotal and missing components. An explicitly excluded component requires a recorded reason and remains visible in scope.
- Unknown ROW/utility scope keeps the full total incomplete until an explicit assumption or allowance resolves it. A priced roadway subtotal remains useful for engineer discussion.
- Deduplicate contributions by scenario segment/physical scope/component role, not simply item code. The same bid item may legitimately occur in different segments or layers.
- A road and sidewalk/path package must not price the same physical area twice. A bike restriping package must not add roadway pavement unless widening is selected. Scope substitutions remove their overlapping allowance.
- Core-component removal is explicit and records its effect on the section assumptions. Do not quietly remove prerequisite work when the user toggles a related element.
- Initial range text is `Range not calibrated`. Optional Phase 4 low/high sensitivity factors are user-defined and recompute the whole dependency chain. Label results as assumption sensitivity, not a confidence interval or an advertised accuracy bound.

## 7. Planning records and persistence

Sol freezes exact TypeScript interfaces in Phase 0. The minimum concepts are:

- **PackageDefinition:** ID/version, state/applicability, pilot/review status, defaults, input bounds, component rules, item bindings, assumptions, exclusions and dependency tags.
- **PlanningWorkspace:** independent ID/name/state, schema version, revision, active scenario ID, scenarios, timestamps and backup markers.
- **PlanningScenario:** stable ID/name, geometry/segments, package instances, parameter overrides, explicit exclusions, custom components, pricing policy/snapshots, cost assumptions, review record and handoff intents.
- **CostComponent:** stable physical-scope key, package/role identity, quantity/unit/formula inputs, nullable unit rate, extended cost, source snapshot or manual basis, completeness and reasons.
- **ScenarioReview:** reviewer-supplied name/date/notes, reviewed scenario fingerprint, and current/stale state. It records a local review statement, not authenticated approval.

Do not overload existing `ProjectEvidenceContext` with annual-summary or generated-quantity data. Preserve original defaults and overrides separately. Saved workspaces retain the used package-definition snapshots so old scenarios remain recoverable after a library update.

Use a separate IndexedDB database, `roadway-cost-estimator-planning`, version 1, with workspaces/settings/revisions. Keep at most 20 recovery snapshots per workspace. Use revision-checked writes and an atomic snapshot+save for structural edits/repricing; namespace edit ownership separately from Projects. Reuse patterns only after inspecting their behavior. This choice avoids changing existing Project database stores during the first pilot.

Never claim Saved before a successful write. Storage failure preserves the draft and offers recovery export. A memory-only fallback must be explicit. State switching flushes current edits, releases ownership, closes sessions and restores the active Planning workspace for the destination state without creating a workspace implicitly. Pending operations cannot publish results into a newer state/session.

Planning recovery uses a distinct `.rce-planning.json` format/version. Validate the entire record on import, preserve zero versus blank, reject malformed references or incompatible explicit units, and import as a new workspace copy with remapped instance IDs/references. Support detached recovery from embedded package/rate snapshots; missing current source rows do not erase old evidence.

Workspace recovery-as-copy and scenario duplication clear active handoff intents and Project links; retain any source review/transfer history as historical notes, with the new copy's review pending. An imported copy must not resume an operation against an original workspace's predetermined Project ID.

## 8. Phased execution

### Phase 0 — Freeze contracts and provisional scope

**Lead: Sol. Support: Luna inventory/fixture preparation.**

Tasks:

- Recheck current architecture, navigation and existing Project behavior.
- Freeze types, module boundaries, unit aliases, quantity-rule registry, rate selection, total/completeness rules and review invalidation triggers in `src/planning/contract.md`.
- Bind three recipes per state to exact Nebraska/Colorado items and flag provisional proxies. Freeze separate annual-summary and contract-median pricing contracts, overlap reconciliation and state availability. Resolve or explicitly leave removal/tack unpriced. Record default values and their source/assumption classifications.
- Specify sample inputs and independently calculated expected outputs before implementation. Specify UI states for complete, unpriced, excluded, overridden, save-failed, read-only and stale review scenarios.

Exit: Luna has no unresolved architecture or engineering-equivalence decision in its task specification. Provisional engineering values are allowed; silent equivalence and unknown numerical semantics are not.

### Phase 1 — Quantity and cost core

**Lead: Luna. Sol reviews numerical semantics and overlap/dependency rules.**

Tasks:

- Implement typed recipe validation, units, quantity rules, component generation, allowance graph, completeness and explicit exclusions.
- Implement three base recipes per state plus sidewalk/custom components, with direct tests against Phase 0 reference calculations. Share geometry functions but keep state definitions separate, including CO CY base and 6 in path/sidewalk sections.
- Implement pure workspace/scenario mutations, duplication and comparison; no persistence or app shell editing.

Parallel work after contracts: one Luna owns units/quantity generation; a second owns workspace/comparison. The primary assigns cost-engine ownership sequentially after quantity interfaces stabilize. Test files also have one owner each.

Exit: changing length/width updates quantities; fixed/manual LS scope behaves independently; zero/blank are distinct; invalid values/cycles fail visibly; overlap/substitution cases are correct; duplicate scenarios have independent IDs and state.

### Phase 2 — Real Nebraska/Colorado rates and recovery data

**Lead: Luna. Sol reviews adapter policy and evidence identity.**

Tasks:

- Implement exact annual-rate selection, explicit report-series choice, complete-window inflation treatment, manual overrides and frozen provenance.
- Implement Colorado contract-median selection under the frozen policy, date/district/source filters, sparse evidence labels, overlap handling and recoverable evidence snapshots. Separate adapter ownership permits NE and CO Luna work in parallel after Sol freezes shared types.
- Implement pure Planning backup/import validation and deterministic CSV cost-review construction. Keep browser event/rendering work with Sol.
- Create small test fixtures for complete rates, missing items, nonpositive values, unit conflicts, report overlaps and unavailable NHCCI windows. Fixtures are test data, never production evidence.

Parallel work: the rate adapter and pure serializer/export builders can proceed independently under the same frozen types. Export field order is fixed before UI integration.

Exit: each Nebraska automatic rate traces to an exact summary row, and each Colorado computed rate traces to every contributing contract/observation and its policy. Adjustment availability is visible; no aggregate/contract pooling occurs; recovery reproduces frozen inputs/rates/totals; missing evidence remains unpriced.

### Phase 3 — Working pilot, storage and UI

**Lead: Sol for persistence, controller and all UI. Luna supplies bounded fixture/serializer tests.**

Tasks:

- Implement separate Planning storage/concurrency under section 7, then connect the pure engine and rate adapter.
- Add Planning navigation and a contained workspace renderer/controller. Extend initial-view and state-change handling in `main.ts` and `renderApp.ts`; preserve existing flows.
- Provide name/location/type/length/section inputs; base package, optional sidewalk, custom elements, allowance controls, editable advanced assumptions, manual rates, explicit exclusions and missing-scope decisions.
- Render construction/other/contingency totals, completeness, price basis, and expandable quantities/assumptions/evidence. Show provisional package status once in useful context.
- Provide scenario duplication and a compact A/B comparison with changed assumptions and priced-scope differences. Mark differences involving incomplete scenarios appropriately.
- Provide save/recovery import/export and a basic engineer review checklist. Range remains uncalibrated at this milestone.
- Preserve input focus/caret and pending edits during recalculation; avoid rebuilding the whole app on every keystroke. Reject or hold invalid input without silently restoring an older valid value.

Exit/M1: an engineer can complete the three-package workflow in both Nebraska and Colorado with real/manual rates, review all assumptions, change an allowance, duplicate a scenario, reload its saved data, and recover it from JSON. Advanced pricing exposes the correct state-specific evidence policy. Navigation/state switching/storage failures do not lose or cross-contaminate edits. Typecheck, focused tests, production build and relevant visual checks pass.

**Run the first engineer trial here.** Record package/assumption changes, missing elements, confusing labels and numerical defects in `docs/planning-pilot-feedback.md`. Do not wait for Project transfer or every optional element. If no engineer feedback is immediately available, deliver M1 and continue independent planned work with the defaults still labeled provisional.

### Phase 4 — Engineer feedback and additional planning controls

**Lead: Luna for recipe, comparison/export and reference-test revisions. Sol for all UI changes and new ambiguous bindings.**

Tasks:

- Apply bounded engineer feedback, separating numerical bugs from changes to estimating assumptions. Version recipe changes and preview old/new totals before a saved scenario adopts them.
- Add explicit bike-marking, lighting and pipe examples described in section 5. Keep incomplete assemblies visible; do not call a fixture/luminaire price a complete lighting system.
- Finish CSV review export: scenario inputs, package versions, quantities/rate provenance, percentage bases, priced/unpriced/excluded components, overrides/reasons, review notes and cost summary. The CSV is not a recovery format.
- Add review-name/date/notes and mark the review stale after any estimate/scope/price/definition change; cosmetic renaming alone need not invalidate it.
- Add optional future escalation and user-defined sensitivity cases only after Sol freezes their bases, order and labels. Escalation must distinguish the frozen historical price basis from a forecast assumption; ROW/manual external costs need their own explicit treatment.

Exit/M2: feedback is traceable to revised recipes; outdated reviews cannot appear current; omitted work is disclosed; exports agree with the visible scenario; sensitivity outputs do not claim calibrated accuracy.

### Phase 5 — One-way Project snapshot handoff

**Lead: Sol. Luna may prepare legacy fixtures and run isolated compatibility checks.**

Tasks:

- Add `Create Project snapshot` for an explicitly named new Project in the scenario's state. No overwrite, append-to-existing or live synchronization in this release.
- Require resolved pricing/completeness before creation. Explicit exclusions and None assumed declarations remain in the handoff. An incomplete scenario can still be saved/exported for review.
- Transfer catalog lines with their exact identities; use custom lines for percentage/fixed/manual components without fabricated catalog identities. Retain package, quantity, price and override provenance in a typed Planning-origin snapshot.
- Preserve totals without changing existing Project contingency semantics: set native Project contingency to 0; transfer frozen Planning contingency as a clearly named custom Other Costs allowance; transfer construction allowances as Construction Costs and services/ROW/external costs as Other Costs. Explain that Other Costs includes the frozen planning contingency and it is no longer dynamically linked to Project edits.
- Display a concise Planning-origin summary in Project identifying frozen contingency and one-way transfer. If the engineer later sets native contingency, expose that the frozen allowance is still present so it can be deliberately removed or retained.
- Sol adds optional Project/line Planning provenance and advances the Project record schema from current v10 only as needed. Preserve supported older record/backup/revision parsing, duplicate/import-copy ID remapping, CSV column stability, and all current Project totals. No Project database-version increase is needed solely for optional fields.
- Make transfer idempotency durable across the two databases. Before creating a Project, persist an immutable handoff intent in Planning using a revision-checked write: token, frozen scenario fingerprint, predetermined target Project ID, frozen creation payload and pending status. If that write fails, do not create the Project. Store the token/fingerprint in Project provenance in the same write that creates the Project. Do not claim a cross-database atomic transaction.
- On retry, tab reload or pending-intent recovery, look up the predetermined Project ID. If it exists with matching handoff provenance, reuse it and finish recording the link; do not replace engineer edits or create a fresh ID. A different token at that ID is a visible conflict. Concurrent attempts use the same ID; handle an IndexedDB add/uniqueness race by re-reading and checking provenance. Write the completed Project ID/revision and intent status back to Planning only after creation/existence is verified. A failed final link write leaves a recoverable pending intent. A deliberate new snapshot gets a new persisted intent; repeated clicks on one intent do not.
- Enable this transfer only when both repositories report persistent storage. In memory-only mode retain Planning review/export and explain that Project snapshot transfer requires working local storage. Do not promise crash recovery for memory-only data.
- Changing Project lines does not reprice Planning or imply its review covers the edited Project. Regeneration creates a new snapshot rather than replacing engineer edits.

Exit/M3: handoff and Project totals reconcile within one cent, with no doubled contingency or omitted components; existing Project backups still restore; Planning provenance survives backups/copies; a failed or retried transfer cannot damage existing work or silently duplicate a Project.

### Phase 6 — Release-candidate verification and documentation

**Lead: Sol for final review/integration. Luna for bounded regression runs, documentation and source-link/fixture checks.**

Tasks:

- Review the combined implementation against the acceptance matrix below and inspect all Luna edits.
- Run appropriate TypeScript/UI/Project compatibility tests once after final changes. Run data validation if runtime evidence or the manifest was changed; the expected pilot does not require new evidence imports.
- Exercise the planner-to-engineer workflow on a built local preview, including state switching, reload, unpriced results, explicit zero, JSON recovery and Project handoff.
- Update `architecture_overview.md`, `docs/data_schema.md` where persisted schemas changed, `docs/implementation_notes.md`, `user_workflow.md`, and this plan's completion log. Document provisional scope and outstanding calibration questions.
- Prepare the reviewed branch and verification report. Merge/deployment is a separate explicitly authorized step; do not publish private example workbooks or engineer trial data.

Exit/M4: no known numerical, data-loss, provenance or compatibility blocker remains. Engineering limitations are stated specifically; a working pilot may still contain provisional assumptions and uncalibrated sensitivity.

## 9. Verification and acceptance matrix

Use meaningful reference cases rather than tests that reproduce the implementation's own formula functions. Reference fixtures contain independently computed answers.

| Case | Required result |
| --- | --- |
| Geometry reference | 0.5 mile × 24 ft = 63,360 SF = 7,040 SY; 2 in asphalt × 145 lb/CF × 1.05 gives 803.88 tons |
| Section excavation | That roadway at 15 in assumed depth = 2,933.333333... CY; assumptions exclude unrelated bulk grading |
| Path reference | 0.5 mile × 10 ft = 26,400 SF = 2,933.333333... SY; 11 in structural excavation = 896.296296... CY |
| Colorado sections | Same path area, 6 in base = 488.888888... CY; 12 in structural excavation = 977.777777... CY. Roadway 63,360 SF at 6 in base = 1,173.333333... CY |
| Colorado contract median | One contract has line prices 10, 20, 30; another has 100. Contract medians 20 and 100 give 60, not the pooled-line median 25. Average/engineer observations never add samples |
| Colorado evidence policy | Exact unit/source/window/district filters; collision handling; limited-evidence notice; no automatic older/mix fallback; incomplete index coverage blocks adjusted mode; snapshots retain contributing evidence |
| Pilot state isolation | CO uses CDOT IDs and CY base; NE uses NDOT IDs and SY base. State switching restores separate workspaces; imports/handoff reject mismatched state identities |
| Sidewalk reference | 0.5 mile × 5 ft × two sides = 26,400 SF = 2,933.333333... SY |
| Percentage bases | With D = $100,000 and no drainage/utilities: mobilization $8,000; traffic $5,000; S $113,000; K $28,250; two service amounts $14,125 each; total $169,500 before external costs |
| Missing item | Unpriced removal/tack remains visible; dependent complete totals are unavailable, not zero |
| Override semantics | Blank uses the selected source/default only when the field is explicitly optional; deliberate zero override survives save/reload/export |
| Source periods | Calendar and July–June report selection remain distinct; duplicate/conflicting compatible rows do not silently average |
| Partial index coverage | Source rate retained with adjustment unavailable; no invented updated-year label |
| Scope overlap | Roadway plus bike restriping does not add pavement area; explicit drainage replaces overlapping allowance |
| Size changes | Doubling length changes linear/area components; fixed manual costs and discrete counts change only under their own rule |
| Snapshot stability | Library/source refresh leaves saved totals intact until explicit update/reprice |
| Ownership/state | Another tab cannot silently overwrite; state switch flushes or stays with a visible failure |
| Recovery | JSON restores independent scenario IDs/references, assumptions, frozen rate basis and totals; malformed records fail as whole records |
| Review invalidation | Scope, quantities, rates or allowance changes make a recorded review stale |
| Project handoff | Complete scenario reconciles; native contingency is zero; frozen allowance and provenance are explicit; retries do not duplicate |
| Interrupted handoff | Crash after intent-save, after Project creation, or during final Planning link-save is recoverable after reload; simultaneous same-intent attempts create one Project; memory-only mode disables transfer |
| Existing features | Explorer, Nebraska annual history, Project editing/recovery and Excel import preserve current behavior |

The arithmetic cases above are acceptance fixtures, not source-derived project estimates. Production costs come only from selected loaded evidence or explicit manual values.

### Local commands and check scope

Follow `codex.md` and use the portable Node executable directly, normally `C:\Users\Casey.Walrath\Tools\node\node.exe`. Check that path at execution and use an available documented runtime if it changed. Do not rely on `npm run` or a global PATH Node.

```powershell
# TypeScript check, no emitted output
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' './node_modules/typescript/bin/tsc'

# Focused deterministic Planning tests; add affected test paths per phase
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' './node_modules/vitest/vitest.mjs' run src/planning

# UI production build when UI/bundle changes; run with required escalation
& 'C:\Users\Casey.Walrath\Tools\node\node.exe' './node_modules/vite/bin/vite.js' build --outDir dist-check --configLoader native
```

At Phase 3 and later include relevant `src/ui` tests; at Phase 5 include `src/projects` and export/backup tests. Final verification includes affected evidence/inflation/data-loading tests. Run `python scripts/validate_data_package.py` only if evidence or manifest data changed. Serve built `dist-check` at `http://127.0.0.1:4174/` for actual visual/workflow checks; provide that URL during implementation. Do not test browser download events; verify generated CSV/JSON content directly. If the browser cannot initialize, record the limitation and use source/DOM/serializer checks without claiming a visual pass. Leave ignored `dist-check` and `__pycache__` folders in place.

For documentation-only revisions, proofread and inspect the diff. Phase 0/1 code changes require TypeScript checks and focused core tests; UI builds and browser checks start when the UI is implemented.

## 10. Engineer trial and feedback loop

Use the supplied Ida Street and visible 132nd/Giles worksheets as reference patterns for quantities, alternatives and allowance bases. They are not an accuracy benchmark without explicit project geometry and matched scope. The hidden Giles worksheets concern older different-project examples and are not part of the visible-concept trial.

Ask engineers to work through one corridor resurfacing scenario, one concrete reconstruction with sidewalk, and one path scenario in each pilot state. Colorado review specifically addresses mix selection, curb section, base-volume assumptions, bikeway scope, sparse evidence and the contract-median policy. Record original inputs/output, package version, the requested correction, reason, and whether it changes a quantity rule, item binding, price policy, allowance, omission or UI. Keep private trial files local or outside the public repository; committed feedback can use synthetic/anonymized reproducible cases.

Evaluate whether the estimate is easy to construct and review, which assumptions are repeatedly changed, which missing scope affects totals, and whether review takes less preparation than building the estimate from scratch. Do not claim a measured time saving or accuracy range until it has been measured.

Engineer revisions produce a new package version. Existing scenarios can compare and adopt it explicitly. Structural ambiguities go to Sol; once a correction is specified, Luna can update the recipe, reference fixture and documentation.

## 11. Completion log

Update this table during implementation; keep failures and remaining limitations explicit.

| Phase | Status | Owner/model | Files/checks | Remaining issues |
| --- | --- | --- | --- | --- |
| 0: Contract | Complete | Sol; primary binding verification | `src/planning/types.ts`, `contract.md`, independent reference fixtures; TypeScript passed | Provisional engineering assumptions; removal/tack manual or unpriced |
| 1: Core | Complete | Luna implementation; Sol review; primary integration | Units/quantities, both recipe libraries, validation, cost engine, workspace/comparison; TypeScript and 63 tests passed | Provisional assumptions; real rate adapters, storage and UI remain later phases |
| 2: Rates/recovery | Complete | Luna implementation; Sol read-only review; primary integration | NE annual and CO contract adapters, versioned JSON recovery, deterministic CSV review; TypeScript and 84 Planning tests passed | No browser persistence/UI yet; rates and recipes remain provisional pending engineer trial |
| 3: Working pilot | Implemented locally; engineer trial pending | Sol UI/storage; Luna read-only audit; primary integration | Planning IndexedDB/controller/UI, TypeScript, 136 Planning/UI tests, production build, local HTTP preview | Browser automation unavailable on this host; engineer feedback and source-policy calibration remain pending |
| 4: Revision/controls | Pending | Luna logic; Sol UI/mappings | — | Feedback and calibration remain iterative |
| 5: Project handoff | Pending | Sol; Luna fixtures | — | Compatibility and frozen-contingency semantics |
| 6: Release candidate | Pending | Sol review; Luna verification/docs | — | Separate merge/deployment authority |

### Phase 0/1 verification record — 2026-10-06

- Sol froze `src/planning/types.ts` and `contract.md`; Luna implemented three bounded workstreams with exclusive ownership. Quantity/cost ownership proceeded sequentially once the quantity APIs were stable. The primary integrated and reviewed all files.
- Each state has resurfacing, reconstruction and path recipes plus optional sidewalk. Exact item identities, provisional assumptions, thickness constraints, explicit missing scope and state-specific base units are embedded in frozen definitions.
- Independent fixtures and integration tests verify quantities and the $169,500 allowance reference. Regression coverage includes manual zero, invalid drafts, exclusions, active scope substitutions, named/implicit allowance cycles, service/external cost reconciliation, overflow, immutable duplication/reference remapping, allowance original bases, review staleness and incomplete comparisons.
- Sol's final review identified contingency category double-counting and overwritten substitution reasons. Both were corrected and tested. Original allowance-basis references also remap on duplication and normalize for comparisons.
- Portable Node TypeScript checking passed. `vitest run src/planning` passed 63 tests across 8 files. No evidence, manifest, Project schema, app-shell or UI changes occurred; no build/browser/data validation was required for the isolated core.
- This is a tested calculation foundation, not the engineer-usable M1 interface. Source rate selection/recovery starts in Phase 2; persistence and Planning UI start in Phase 3. No merge or deployment performed.

### Phase 2 verification record — 2026-10-07

- Nebraska's adapter selects one exact item and unit from the latest loaded calendar report by default, or an explicit report series/window. Missing items do not silently fall back to an older report. The snapshot retains the raw published unit, source row, report dates, URL/locator and complete-window NHCCI result; unavailable adjustment leaves the raw rate visible.
- Colorado's adapter uses exact cost-book awarded evidence, a dataset-wide latest valid date, a concrete three-year inclusive window and optional source/district/date filters. It resolves reconstructed contract-item identities, excludes unresolved cross-source collisions, computes contract medians before the overall median, and records all contributing lines and excluded observations. Adjusted mode requires every selected line's NHCCI quarter. The provisional bikeway proxy has three independent contracts in the current default window and is labeled limited evidence.
- Planning recovery uses a separate versioned JSON format. Validation retains invalid numeric drafts while rejecting malformed structure, references and frozen rate provenance. Import requires a unique caller-provided ID seed, remaps all scenario/entity references, clears active review and transfer state, and recalculates from frozen inputs. The CSV review builder has a fixed column order and includes inputs, defaults, source snapshots, overrides, exclusions, allowances, review state and nullable costs.
- Sol reviewed evidence identity, dates, cross-source overlaps, recovery ID collisions and draft preservation. The primary corrected the identified gaps and checked the current Colorado cost-book join: 37,214 awarded observations map to matching contract items; no repeated nonblank official contract IDs were found across the 458 cost-book contracts. Portable TypeScript checking, 84 focused Planning tests across 12 files, and 5 existing data-loading/inflation tests passed. No production evidence, manifest, UI or Project changes were made, so data validation and browser checks were not needed. Phase 3 still owns storage and the working Planning interface.

## 12. Start prompt for an implementation session

```text
Implement the Nebraska and Colorado Planning pilots using docs/planning-module-implementation-plan.md.
Read AGENTS.md, codex.md and architecture_overview.md, fetch current main, and
preserve this plan on the feature branch. Use Luna for bounded implementation
and tests; use Sol for Phase 0 contracts, UI, persistence, delicate mappings,
Project compatibility and final integration/review. Complete phases in order,
review each phase and update the completion log. Deliver a working M1 pilot
before expanding optional packages. Keep defaults explicitly provisional.
Do not merge or deploy. Stop for user input only when missing information or
authority changes the requested scope; route technical ambiguity to Sol first.
```
