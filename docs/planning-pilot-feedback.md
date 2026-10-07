# Planning pilot feedback

Phase 3 provides Nebraska and Colorado provisional packages in the local Planning view. Engineer trials have not yet been conducted. Use this file for anonymized, reproducible findings; keep private project workbooks and estimates outside the public repository.

For each trial, record the state, package/version, length and section assumptions, source-rate selection, missing or excluded work, allowance edits, and whether the complete total was available. Record each requested correction with its reason and classify it as a numerical defect, quantity rule, item binding, rate policy, allowance, omission, or UI issue. Preserve original inputs and output before changing a recipe.

Suggested cases: corridor resurfacing, concrete reconstruction with sidewalk, and a path scenario in each pilot state. Colorado review should specifically address mix selection, curb section, base-volume assumptions, bikeway scope and sparse evidence. Nebraska review should address annual report period selection and the provisional section bindings.

No accuracy range or engineer time saving has been measured. The pilot marks incomplete pricing and unassessed external scope explicitly; those results require engineer review before project use.

## Initial product-owner trial — 2026-10-07

Classification: UI/workflow feedback; no numerical defect has been established. The current screen is too complex for a planner and departs from the simpler Planning concept. The distinction between a workspace and a scenario is unclear. A new scenario immediately shows an internal-ID-based `Incomplete` message (including component and allowance IDs) and `Range not calibrated`, without a clear next action. The screen exposes too many buttons and places quantity/rate overrides, reasons, exclusions, source filters and section effects beside every component. The purposes of Custom construction scope, Allowances and External scope decisions are unclear. Allowance names and assumption text can repeat. Issues and missing scope is verbose and difficult to act on.

The attached original UI outline is the preferred direction: project type, length, setting and typical section first; a base package and a short list of optional elements; a concise estimate summary; and a small set of assumptions for engineer review. The product question is which inputs a non-engineer can reasonably supply. Proposed direction for review: make scope/geometry the planner form, derive quantities and prices automatically, put evidence and detailed overrides in an engineer-review view, translate internal missing IDs into plain-language next actions, and avoid presenting an uncalibrated range as an output. Retain full underlying provenance and explicit unpriced scope in the saved scenario.

Before changing estimation semantics, decide which unresolved items receive defensible provisional package allowances and which remain visibly outside the priced scope. The current pilot has no calibrated range and no approved default for tack, reconstruction removal, sidewalk ramps/crossings, right of way or major utilities. A priced-scope subtotal can be useful for comparison, but must not be labeled as a complete project total.
