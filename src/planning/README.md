# Planning v2 core

Pure TypeScript for the Colorado planner. No DOM and no storage in this folder except `storage.ts` (Phase 3). Types are in `types.ts`. Plan: `docs/planning-v2-implementation-plan.md`. Values: `docs/planning-v2-calibration.md`.

## Files and API

| File | Exports |
|---|---|
| `types.ts` | All shared types. |
| `library.ts` | `validateLibrary(raw)`, `resolveLibrary(library, priceTable)`, `loadPlanningLibrary(fetchFn?)`, `elementInputValues(element, selection, projectInputs)`, `isInputActive(input, values)` |
| `calculate.ts` | `evaluateQuantity(rule, values)`, `combinedMultiplier(factors)`, `calculateAlternative(library, project, alternativeId?)`, `roundElementAmount`, `roundTotalAmount`, `roundUnitPrice` |
| `templates.ts` | `createProject(library, options)`, `createAlternative(library, templateId, options)` |
| `edit.ts` | Immutable edit helpers: `setBaseTreatment`, `setElementEnabled`, `setElementInput`, `resetElementInput`, `setElementOverride`, `addAlternative`, `duplicateAlternative`, `removeAlternative`, `renameAlternative`, `setProjectInput`, `setStage`, `setEngineering`, `setBudget` |
| `shareFile.ts` | `buildShareFile(project, library, now)`, `parseShareFile(text, library)`, `importProjectCopy(project, options)` |

Ids and timestamps are passed in (`options.id`, `options.now`, `options.newId()`), so every function is deterministic and testable.

## Library loading

- The library JSON is imported at build time from `data/planning/co_element_library.json`.
- The price table is fetched at run time from `${import.meta.env.BASE_URL}data/states/co/planning_prices.json`. Tests import it from `public/data/states/co/planning_prices.json`.
- `resolveLibrary` binds each item component to its price-table entry. A missing item or a unit mismatch produces an issue (`missing_price`, `unit_mismatch`) and a unit price of 0. Assembly components use `unitCost` with source `{ kind: "assembly" }`.

## Input values

For an element, effective inputs are built in this order: library `default`, or the project input named by `inherit`, or `projectInput × multiply` from `defaultFrom`; then the planner's `selection.inputs` replace any key. An input whose `when` condition is false is left out of the effective values. A template's `inputs` are written into `selection.inputs`.

## Quantity rules

Lengths are miles × 5,280 ft. `sides` defaults to 1 when the rule has no sides key.

| Kind | Result |
|---|---|
| area | length ft × width ft × sides / 9 (SY) |
| volume | length ft × width ft × sides × depth in / 12 / 27 (CY) |
| asphalt_tons | length ft × width ft × thickness in / 12 × density lb/cf / 2,000 × material factor (TON) |
| linear | length ft × sides (LF) |
| miles | miles × sides |
| count | count |

A component whose `when` condition is false is skipped. A missing, negative, or non-finite input produces an `invalid_input` issue and a quantity of 0.

## Cost model

- Base type: the `baseType` of the enabled base-group element. If none is enabled, `elements_only`. If more than one is enabled (invalid state), the first in library order is used and an issue `multiple_base` is reported.
- Multiplier = (1 + minor) × (1 + trafficControl) × (1 + mobilization) for that base type. It applies to every base, corridor and spot element in the alternative.
- Element: direct = Σ quantity × unit price; calculated = direct × multiplier; amount = override ?? calculated.
- Construction = Σ amount of enabled base, corridor and spot elements.
- Contingency = construction × stage contingency.
- Design = (construction + contingency) × project design rate. Construction engineering = (construction + contingency) × project CE rate.
- Right-of-way and utility relocation = the `override` of those "other" elements (null = 0). They are counted whether or not `enabled` is set.
- Total = construction + contingency + design + construction engineering + right-of-way + utility relocation.
- Range = total × (1 + stage rangeLow) to total × (1 + stage rangeHigh).
- Budget remaining = budget − total, or null when budget is null.
- Full precision internally. Display rounding: element amounts to $1,000, totals to $10,000, unit prices to $0.01 (`roundElementAmount`, `roundTotalAmount`, `roundUnitPrice`, half away from zero).

## Editing rules

- Base group is select-one: `setBaseTreatment` enables the chosen base element and disables the others.
- `setElementOverride(…, null)` restores the calculated amount. 0 is a valid override.
- `addAlternative` creates from a template (or blank: base `base_none`, nothing else). `duplicateAlternative` copies selections. The last alternative cannot be removed.
- Every edit helper returns a new project object and does not change `revision` or `updatedAt`; storage sets those on save.

## Share file (JSON)

```json
{ "format": "roadway-cost-estimator/planning", "formatVersion": 2, "exportedAt": "ISO", "state": "CO", "priceBasis": "label", "project": { "...PlanningProject" } }
```

`parseShareFile` rejects other formats and versions, validates every field type, drops selections for element ids the library does not have (issue `unknown_element`), and fills missing project inputs from library defaults. `importProjectCopy` assigns a new project id and new alternative ids, sets revision 0 (not yet saved), and keeps all names and values. Storage increments revision on each save.
