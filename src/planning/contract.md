# Planning core contract v1

Phase 0 freezes this contract before Phase 1 production implementation. All recipes and section assumptions are provisional. This contract establishes numerical behavior, not engineering accuracy. Manifest state codes are uppercase `NE`/`CO`; exact agency identities remain lowercase `ne_ndot_*`/`co_cdot_*`. Historical NDOT catalog status does not establish obsolescence and does not block a published annual binding.

## Boundaries and exact Phase 1 APIs

`types.ts` has no app dependencies. `units.ts` and recipe files depend only on types. `validateRecipes.ts` depends on types/units. `quantityEngine.ts` depends on types/units/validation. `costEngine.ts` depends on quantity generation. `planningWorkspace.ts` depends on types/validation and may import `createDefaultAllowances` from costEngine; costEngine must never import workspace. Comparison depends on workspace fingerprint/cost engine. No module imports UI, storage, data adapters, Project workspace, the app shell, or another state's production data. All functions are synchronous and pure: no clocks, random IDs, browser state, source refresh or mutation of their arguments. Return `PlanningResult` for rejected commands or unsupported conversions; preserve per-component issues for incomplete calculations. No thrown validation errors.

Export the following exact signatures (all named types import from `types.ts`). Additional private helpers are permitted.

```ts
// units.ts; aliases normalize identity only; conversions are explicit
normalizePlanningUnit(raw: string): PlanningUnit | null;
convertPlanningQuantity(value: number, from: PlanningUnit, to: PlanningUnit): PlanningResult<number>;

// validateRecipes.ts
validatePackageDefinition(definition: PackageDefinition): PlanningIssue[];
validatePlanningScenario(scenario: PlanningScenario): PlanningIssue[];

// quantityEngine.ts
resolvePackageParameters(instance: PackageInstance): PlanningResult<Record<string, number | null>>;
evaluateQuantityRule(rule: QuantityRule, parameters: Record<string, number | null>): PlanningResult<number>;
generateScenarioComponents(scenario: PlanningScenario): CostComponent[];

// costEngine.ts
createDefaultAllowances(state: PlanningState): AllowanceDefinition[];
calculateScenarioCosts(scenario: PlanningScenario): ScenarioCostResult;

// recipes/nebraskaPilot.ts and recipes/coloradoPilot.ts respectively
export const NEBRASKA_PILOT_PACKAGES: readonly PackageDefinition[];
export const COLORADO_PILOT_PACKAGES: readonly PackageDefinition[];

// planningWorkspace.ts; IDs and ISO timestamp are supplied by caller
createPlanningWorkspace(input: { workspaceId: string; state: PlanningState; name: string; now: string }): PlanningResult<PlanningWorkspace>;
createPlanningScenario(input: { scenarioId: string; state: PlanningState; name: string; now: string }): PlanningResult<PlanningScenario>;
createPackageInstance(input: { instanceId: string; segmentId: string; scopeId: string; definition: PackageDefinition }): PlanningResult<PackageInstance>;
addPlanningScenario(workspace: PlanningWorkspace, scenario: PlanningScenario, now: string): PlanningResult<PlanningWorkspace>;
setActivePlanningScenario(workspace: PlanningWorkspace, scenarioId: string | null, now: string): PlanningResult<PlanningWorkspace>;
editPlanningScenario(scenario: PlanningScenario, edit: ScenarioEdit, now: string): PlanningResult<PlanningScenario>;
replacePlanningScenario(workspace: PlanningWorkspace, scenario: PlanningScenario, now: string): PlanningResult<PlanningWorkspace>;
duplicatePlanningScenario(scenario: PlanningScenario, ids: DuplicateScenarioIds, name: string, now: string): PlanningResult<PlanningScenario>;
scenarioFingerprint(scenario: PlanningScenario): string;
recordScenarioReview(scenario: PlanningScenario, input: { reviewer: string; date: string; notes: string }, now: string): PlanningResult<PlanningScenario>;
getScenarioReviewStatus(scenario: PlanningScenario): "pending" | "current" | "stale";

// compareScenarios.ts
comparePlanningScenarios(left: PlanningScenario, right: PlanningScenario): PlanningResult<ScenarioComparison>;
```

Issues have a stable machine-readable code, object path, plain message and severity. Codes at minimum: `invalid_number`, `missing_parameter`, `unknown_parameter`, `out_of_bounds`, `integer_required`, `invalid_recipe`, `unit_mismatch`, `state_mismatch`, `binding_thickness_mismatch`, `missing_rate`, `missing_quantity`, `reason_required`, `duplicate_id`, `missing_reference`, `scope_overlap`, `allowance_cycle`, `invalid_snapshot`, `unassessed_scope`. Warning-only issues do not invalidate arithmetic. Calculations keep all precision; rounding belongs only to future UI/export.

## Units and numeric rules

Trim and uppercase aliases: `LF`, `LIN FT`, `LIN. FT.`, `FT`; `SF`, `SQ FT`, `SQ. FT.`; `SY`, `SQ YD`, `SQ. YD.`; `CY`, `CU YD`, `CU. YD.`; `TON`, `TONS`; `EACH`, `EA`; `LS`, `L S`, `L.S.`, `LUMP SUM`. Reject other units. Identity conversion supports every unit. Area converts SF/SY using 9; other different units return `unit_mismatch`. Length in package parameters is miles; multiply by 5,280 in the quantity engine. Thickness/depth are inches, density lb/CF. No unit alias converts dimensions or materials.

Required values are finite numbers. Null, omitted and blank are invalid for required parameters; blank does not become zero. An absent override uses the frozen recipe default. A present `{value:null, reason}` is an invalid required draft and never falls back to a default. Only explicitly optional parameter definitions permit null. Unknown override keys/roles fail validation. Reasons must be nonblank for overrides and exclusions. Parameter zero obeys its bounds; manual quantity/rate zero is permitted, provided quantities in EACH remain integers. Percentages are nonnegative finite numbers; zero is permitted. Negative/nonfinite values fail; no silent clamp. Supplied maximums/integer restrictions apply before evaluating formulas.

`area`: L(miles)*5280*W(ft)*sides(default 1), SF or /9 SY. `volume`: same area*depth(in)/12/27 CY. `asphalt_tons`: area*thickness/12*density/2000*materialFactor. `linear`: L*5280*sides(default 1). `count`: integer parameter. `fixed`: declared finite nonnegative constant. `manual`: parameter in the declared unit. No formula parser, `eval` or arbitrary operators. Invalid prerequisites yield null quantity plus an issue on the visible component, never an omitted line or zero cost.

Defaults: lengthMiles=.5 (>0), roadway widthFt=24 (>0), path widthFt=10 (>0), sidewalk widthFt=5 (>0), sides=2 (integer 1..2; roadway curb and optional sidewalk), asphalt thicknessIn=2 (>0), densityLbCf=145 (>0), materialFactor=1.05 (>=1), NE pavement/path/sidewalk thicknessIn=9/5/5 (>0), CO=9/6/6 (>0), baseDepthIn=6 (>0), excavationDepthIn=15 roadway, NE path=11, CO path=12 (>0). Sidewalk includes surface area only; no base or excavation default is inferred. Milling depth is visible `millingDepthIn=2` (>0); milling SY is unchanged by depth, and the proxy's scope suitability remains an assumption. All defaults carry an `Assumption` origin and source/scope explanation. Bounds are pilot validation bounds, not design standards.

## Recipe and quantity generation ownership

Package IDs are `ne-resurfacing`, `ne-reconstruction`, `ne-path`, `ne-sidewalk`, and matching `co-*`. Version is `pilot-1`. Each recipe embeds assumptions/exclusions and exact item scope descriptions. There is no cross-state template that changes IDs automatically. Parameter/role names above are fixed; recipe owners may add a referenced optional `manualQuantity` parameter only when the corresponding manual rule requires it.

| Role | NE exact item/unit | CO exact item/unit | Rule |
| --- | --- | --- | --- |
| milling | ne_ndot_9179.79 / SY | co_cdot_202-00240 / SY | area |
| asphalt | ne_ndot_9005.23 / TON | co_cdot_403-34741 / TON | asphalt_tons |
| pavement, reconstruction | ne_ndot_3075.46 / SY | co_cdot_412-00900 / SY | area, fixed 9 in binding |
| pavement, path | ne_ndot_3016.65 / SY | co_cdot_608-00026 / SY | area, fixed 5/6 in binding |
| pavement, sidewalk | ne_ndot_3016.03 / SY | co_cdot_608-00006 / SY | area*sides, fixed 5/6 in binding |
| base | ne_ndot_8011.06 / SY | co_cdot_304-06007 / CY | NE area and fixed baseDepthIn=6; CO volume |
| excavation | ne_ndot_1010.00 / CY | co_cdot_203-00000 / CY | volume |
| curb_gutter | ne_ndot_3014.11 / LF | co_cdot_609-21010 / LF | linear*sides |
| removal | null / SY | null / SY | roadway area, required for reconstruction |
| tack | null / LS | null / LS | fixed 1, required for resurfacing |

Resurfacing has milling/asphalt/tack. Reconstruction has pavement/base/excavation/curb_gutter/removal. Path has pavement/base/excavation. Sidewalk has pavement and a required `ramps_crossings` manual/unpriced LS fixed-one component: counted ramp/driveway scope needs explicit custom work or a reasoned exclusion. This makes missing scope visible. Tack LS is a manually assessed construction allowance, not an invented percentage. Removal remains manual/unpriced until a suitable exact binding is authorized. The provisional CO concrete joint/reinforcement scope and NE bikeway proxy are stated explicitly; quantity rules exclude unrelated bulk grading. Deep repair, widening, mass grading, bridges, retaining walls and lighting are recipe exclusions, not silently priced defaults. ROW and major utilities remain separately unassessed at scenario creation.

Generated component IDs are `${instanceId}/${role}`; custom IDs are caller-supplied and must be unique across all derived/custom component IDs. Physical keys are JSON-encoded `[segmentId,scopeId,canonicalRole]` to avoid delimiter ambiguity. Canonical role is `surface` for `asphalt`, `pavement` and `sidewalk`; all other roles retain their name. Bindings must match state, agency prefix, recipe unit and snapshot identity. Fixed thickness mismatch leaves the binding and original source visible, sets automatic rate null and records `binding_thickness_mismatch`; an explicit valid manual rate with reason may price the changed section, converting that mismatch issue to a nonblocking warning and retaining the original source. Never reuse a thickness-incompatible snapshot automatically. Generate formula quantity first, then apply valid manual quantity override while retaining `originalQuantity`/formula inputs. Null/invalid quantity remains unpriced even if a rate exists. No current snapshots means `missing_rate`. No Phase 1 rate inference.

Every required unresolved component is visible. Valid manual zero has `priced` status with cost 0. Excluded lines have `excluded` status with null extended cost and recorded reason/section effect. Invalid rates/snapshots yield unpriced components with structured errors, not hidden fallback. Manual rate takes precedence over a frozen snapshot and preserves that snapshot as its original basis. Without a manual rate automatic snapshots require positive finite rates, state/unit/item matches and valid required provenance; `ne_annual` only in NE, `co_contract_median` only in CO.

## Overlap, percentages and completeness

Two active contributions with the same physical key are an error unless one is explicitly replaced/excluded. Both colliding components become unpriced; never choose an arbitrary winner or count both in the priced subtotal. The same item in separate segments/scopes or different layer roles is legitimate. Roadway and separate path/sidewalk areas require separate scope IDs. Reusing one scope ID for roadway/path/sidewalk pavement gives an overlap error. Default `pavement` role prevents those surface duplications. Scope IDs are caller-declared physical identities; this core does not infer polygon intersection or validate survey geometry. Bike striping is deferred and never adds pavement automatically.

Substitutions identify an active replacement and existing component/allowance IDs, with a nonblank reason. Replaced rows remain visible and become excluded with substitution reason. Self replacement, duplicate/circular replacements, missing references and excluded replacement fail visibly; they never resolve missing scope by deleting it. Custom detailed drainage tags use `drainage`; minor utilities use `minor_utilities`. An enabled matching percentage allowance plus active detailed work requires an explicit substitution replacing that allowance; otherwise both are flagged as overlap and complete totals are unavailable. Unpriced detailed work still replaces the allowance only by explicit decision, and remains incomplete. Component tags are not automatic duplicate item-code rules.

Default allowance IDs equal role names; all defaults are provisional: mobilization 8% D, traffic 5% D, drainage 20% D disabled, minor_utilities 5% D disabled, contingency 25% S, design 10% (S+K), construction_engineering 10% (S+K). Percent means 8 not .08. Built-in roles retain their construction/service categories: mobilization, traffic, drainage, minor utilities and contingency are construction; design and construction engineering are service. Category changes are rejected; use an explicitly named custom allowance for another category. Contingency uses its separate role and must never also enter service/external subtotals. `createDefaultAllowances` returns independent objects per call, with frozen originalBasis (initial percent/base/enabled). An allowance edit retains that original basis and requires a nonblank overrideReason when percent, base or enabled state changes; custom additions establish their initial basis. Exclusion changes carry their own reason. CO origins are `pilot_assumption`; NE may cite Giles starting percentages as a workbook reference without asserting calibration.

Build graph nodes for D (active direct construction components), S (D plus enabled construction allowances except contingency), K (active contingency), and S+K. A construction allowance referring to S creates a cycle; contingency referring to S+K creates a cycle. Explicit references deduplicate IDs within each typed component/allowance namespace and require every reference to exist. The same text in different namespaces refers to different entities. Disabled/excluded references contribute zero independently of row order. Reject cycles before numerical evaluation. Disabled/excluded allowances are visible `excluded` and contribute no cost. Enabled percent=null/invalid is unpriced. No active contingency yields K=0. Require at most one active allowance per built-in role except custom; no accidental double contingency. External allowances do not enter D/S/K. Evaluate service/external references through the same graph.

`pricedDirectSubtotal` is the sum of known active priced construction components even with missing scope. If the sum overflows, return null and an invalid_number issue; never report Infinity or a fabricated zero. Guard all subtotal/total sums for nonfinite arithmetic. Service/external subtotals include their active direct components as well as their respective allowances. `directConstruction` D is null if required active construction components are unpriced or invalid/overlapping. Each allowance base includes only its specified nodes; an unavailable base makes its allowance unpriced even at 0% (a percentage cannot resolve missing scope). S/K/services propagate incompleteness along dependencies. Known optional unpriced active scope is still visible; it blocks full total (but does not necessarily block D when `required:false`). Total requires every active component and selected allowance priced, plus explicit ROW/major-utilities decisions. Both external decisions are required once each: `unassessed` blocks external/full total; `none_assumed` requires reason and contributes 0; manual requires finite nonnegative amount and reason. Unassessed is never resolved by minor utility percentage or contingency. `complete` means total is finite and there are no blocking issues. `missingComponentIds` includes active unpriced component IDs, allowance IDs and unassessed external scope IDs. Structural errors prevent complete totals; valid unrelated known scope remains useful.

## Frozen provenance reserved for Phase 2

NE adapter uses exact item/unit and an explicit single report series/window; latest loaded calendar report defaults to inspected 2025. Missing, conflicting, zero/negative annual automatic rates are unpriced. Never blend calendar/July-June or use contract observations. Freeze summary/source identity, raw source unit/description, page/locator/window and inflation method. Complete annual NHCCI-window coverage is required; unavailable adjustment preserves raw source rate with explicit unavailable metadata.

CO adapter defaults to exact cost_book/awarded_bid, statewide and concrete three-year inclusive window anchored to latest valid cost-book awarded date. Positive quantities/prices, valid dates and compatible units only. Reconcile overlapping import identities without merging separate legitimate lines; unresolved collisions are unpriced. Compute median line price within contract, then median contract medians; retain all line contributions/exclusions and actual/requested dates. Under five contracts is limited evidence. Adjust every selected line to one common covered quarter before medians; missing quarter coverage blocks adjusted mode. Never silently widen dates, mix price types or substitute another item/state. Manual pricing remains explicit. Frozen source/library refreshes never alter Phase 1 totals.

## Workspace, duplication, review and comparison

Scenario creation makes empty segments/packages/custom/substitutions/history, default independent allowances, ROW and major utilities unassessed, review/link/intent null. Workspace creation yields revision 0, no scenarios/active ID and null backup markers. Names/IDs/timestamps must be valid nonblank; state must be supported. Caller uses `set_segments` to construct/edit named physical segments before adding package/custom instances; generation never invents physical scope. `set_segments` rejects duplicate IDs or dangling existing package/custom references and invalidates review when scope changes. IDs are unique within their namespace; all references resolve. Add/replace/active commands reject mismatched states/missing IDs. Each workspace mutation increments revision exactly once and sets updatedAt, preserving createdAt/backup markers. Pure edits must not mutate embedded package/rate snapshots or original objects.

`editPlanningScenario` retains invalid numeric draft overrides and returns success with validation issues so future UI can display them and obtain unpriced recalculation. Structural errors (unknown owner/role/key, mismatched state, missing reason/invalid references) reject atomically. A null command override means remove that override; an override object containing null means retain explicit invalid blank. Structural adds/replacements validate definitions/references first. No implicit package refresh/reprice. Updates retain original frozen assumptions until an explicit `update_package`; incompatible retained override/snapshot references reject the update. Reprice only via explicit matching snapshot command.

Duplication requires complete fresh mapping for every segment/instance/custom/allowance ID; reject missing, duplicate, unchanged or target IDs colliding with original IDs. Remap generated IDs in substitutions and allowance references, and every segment/package/custom reference. Deep-copy frozen definitions/snapshots/override reasons. New review/link/intent are null, prior review/transfer information becomes history notes. Review requires nonblank reviewer, ISO calendar date and a computable fingerprint. Fingerprint is canonical stable-key serialized content of state, segments, packages including snapshots/overrides/exclusions, custom components, substitutions, allowances and external scope decisions. It is a deterministic local change detector, not a security hash. Exclude name/location/notes/IDs/timestamps/review/history/handoff metadata only where IDs do not control reference semantics; easiest safe implementation includes geometry/entity IDs and excludes top-level scenarioId. Scope/quantity/rate/package/allowance/exclusion/substitution/external changes make the recorded fingerprint stale; metadata edits do not. Retain the review record so stale status is visible.

Comparison rejects different states, calculates each frozen scenario independently, exposes known priced-direct difference even when incomplete (null if a subtotal or its difference overflows), and gives null full-total difference unless both are complete. Changes are stable paths for estimate content. Normalize internal entity IDs and their references to positional identities for comparison only, so duplicating an unchanged scenario does not list remapped IDs as assumption changes. Preserve actual physical scope IDs, definitions, quantities, rates, assumptions and exclusions. Review fingerprints retain real reference IDs. Do not label incomplete difference as full project savings. No mutation/repricing/library lookup. Initial range text in future UI is `Range not calibrated`.

## Independent acceptance fixtures and UI state contract

| Fixture | Expected |
| --- | --- |
| .5 mile * 24 ft | 63,360 SF / 7,040 SY |
| same area, 2 in asphalt, 145 lb/CF, 1.05 factor | 803.88 TON |
| same area, 15 in excavation | 2,933.333333333333 CY |
| .5 mile * 10 ft path | 26,400 SF / 2,933.333333333333 SY |
| NE path 11 in excavation | 896.2962962962963 CY |
| CO path 6 in base / 12 in excavation | 488.8888888888889 / 977.7777777777778 CY |
| CO road 6 in base | 1,173.3333333333333 CY |
| .5 mile * 5 ft sidewalk * 2 sides | 26,400 SF / 2,933.333333333333 SY |
| D=100,000; drainage/utilities disabled; external none assumed | mobilization=8,000; traffic=5,000; S=113,000; K=28,250; design=14,125; construction engineering=14,125; total=169,500 |
| CO prices (10,20,30) contract A / (100) B | contract medians 20/100; final 60 (not 25); adapter deferred Phase 2 |

Tests use numeric constants above, independently of production helpers. `fixtures/referenceCases.json` stores the independently computed reference answers; it is not production evidence. Also verify explicit zero, blank required input, integer rejection, invalid negative/nonfinite input, unit/thickness/state mismatches, manual/fixed scope independence under doubled length, missing tack/removal, dependent allowances unavailable, named references/cycles, drainage substitution and legitimate separate segment items, duplicate deep independence, stale review and frozen package/rate stability.

| Future UI state | Required display/behavior |
| --- | --- |
| Complete | Priced direct, construction, contingency, services, external and full total with assumption/source breakdown |
| Unpriced | Known priced direct subtotal plus each missing quantity/rate/scope; dependent complete totals unavailable |
| Excluded | Visible line and exclusion/section-effect reason; never imply zero evidence |
| Overridden | Original default/formula/source and explicit override/reason, including numeric zero |
| Invalid draft | Retain entered blank/invalid value and structured field issue; do not replace with old default |
| Save failed | Draft retained, Saved withheld, recovery export offered; persistence deferred Phase 3 |
| Read only | Visible ownership state, editing disabled; ownership deferred Phase 3 |
| Stale review | Original reviewer/date/notes retained and stale label after material change |
| Unsupported state | IA/SD pilot unavailable, no borrowed NE/CO workspace or prices |

Phases 2/3/5 remain deferred: no adapter, recovery import/export, IndexedDB, UI, Project schema or handoff implementation in Phase 1. Reserved intent fields are inert and must be cleared on copies; Phase 5 extends them with immutable payload/revision checked storage before enabling transfer. This core does not claim crash recovery, Saved, authenticated approval, or calibrated ranges.
