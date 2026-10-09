# Planning v2 UI design (task 3a)

Status: design note for STOP 2 review. Implements Phase 3 of `docs/planning-v2-implementation-plan.md`. Data and calculation API: `src/planning/README.md`.

Reference screenshots of the existing Project view (1440 px and 390 px) were taken before writing this note. Planning matches them in these ways:

- Page content sits in white `panel-block` cards (8 px radius, `--line` border, `--shadow`) on the grey page background, 16–18 px apart.
- Section labels use `eyebrow` (small uppercase teal). Card titles use `<h2>` inside `panel-heading`.
- Fields use the global `label > span + input/select` pattern (label text above, 42 px field, 6 px radius). Number fields are `type="text" inputmode="decimal"`, as in the Project item form.
- The project menu reuses the Project view's `project-switcher` dropdown (teal-tinted summary with chevron, white menu card).
- Small inline percent fields reuse `project-contingency-input` (borderless until hover or focus).
- Cost labels are small uppercase muted text with bold dark amounts, as in `project-cost-metric`.
- The existing Project cost summary overflows at 390 px. Planning avoids this: every Planning grid collapses to one column under 900 px.

## 1. Screen structure

All markup comes from string templates with `escapeHtml`. Amounts, item codes and contract counts in the skeleton are illustrative, and the component lines mix two elements to show both source types. Events are delegated from the Planning root by `data-planning-*` attributes. `{}` marks a value. `<!-- -->` notes describe behavior.

```html
<section class="planning-view" data-planning-root>

  <!-- Page header -->
  <section class="panel-block planning-header">
    <div>
      <p class="eyebrow">Planning estimate</p>
      <h2 data-planning-project-name>{project.name}</h2>
      <p class="muted">Started from {template label | "a blank project"} · <span data-planning-save-status role="status">Saved {time}</span></p>
    </div>
    <div class="planning-header-actions">
      <details class="project-switcher" data-planning-menu="project">
        <summary>Planning projects</summary>
        <div class="project-switcher-menu">
          <!-- up to 8 most recently updated; the current one is disabled -->
          <button type="button" class="project-switcher-project" data-planning-open-project="{id}">{name}</button>
          <div class="project-switcher-actions">
            <button type="button" data-planning-new-project>New planning project</button>
            <button type="button" data-planning-rename-project>Rename project</button>
            <button type="button" data-planning-import>Import JSON</button>
            <button type="button" data-planning-delete-project>Delete project</button>
            <input type="file" accept=".json,application/json" data-planning-import-input hidden />
          </div>
        </div>
      </details>
      <details class="project-switcher" data-planning-menu="export">
        <summary>Export</summary>
        <div class="project-switcher-menu"><div class="project-switcher-actions">
          <!-- Phase 3: rendered disabled. Phase 4 enables them. -->
          <button type="button" data-planning-export="print" disabled>Print summary</button>
          <button type="button" data-planning-export="csv" disabled>Download CSV</button>
          <button type="button" data-planning-export="json" disabled>Download JSON</button>
        </div></div>
      </details>
    </div>
  </section>
  <p class="muted" data-planning-notice role="status" hidden></p>  <!-- import/save notices; class becomes filter-validation-message for failures -->

  <!-- Corridor strip -->
  <section class="panel-block">
    <div class="panel-heading"><h3>Corridor</h3></div>
    <div class="planning-corridor-fields">
      <label><span>Corridor length (mi)</span><input type="text" inputmode="decimal" data-planning-project-input="lengthMiles" value="0.5" /></label>
      <label><span>Roadway width, curb to curb (ft)</span><input … data-planning-project-input="roadwayWidthFt" /></label>
      <label><span>Intersections</span><input … inputmode="numeric" data-planning-project-input="intersections" /></label>
      <label><span>Project stage</span><select data-planning-stage><option value="concept">Concept</option>…</select></label>
      <label><span>Budget (optional)</span><input … inputmode="numeric" data-planning-budget placeholder="No budget" /></label>
    </div>
    <p class="muted">Elements use these values unless you change them in an element's inputs.</p>
  </section>

  <!-- Narrow only (<900 px): compact sticky total bar. display:none on desktop. -->
  <div class="planning-total-bar" data-planning-total-bar>
    <strong data-summary="altName">{alt name}</strong>
    <span>Total <strong data-summary="total">$3,730,000</strong></span>
    <span data-summary="budgetShort" class="planning-budget--under">$270,000 under budget</span>
    <a class="text-button" href="#planning-summary">Summary</a>
  </div>

  <div class="planning-layout">
    <!-- Element groups (≈65%) -->
    <section class="panel-block" aria-label="Elements">
      <fieldset class="planning-group" data-planning-group="base">
        <legend class="planning-group-heading">
          <span class="eyebrow">Base treatment</span><span class="muted">Choose one</span>
          <strong data-group-subtotal="base">$1,420,000</strong>
        </legend>
        <p class="muted">The base treatment sets the allowance for minor items, traffic control and mobilization on every element.</p>

        <!-- One row per element. planning-row--off when not selected. -->
        <div class="planning-row" data-element-row="mill_overlay">
          <label class="checkbox-label">
            <input type="radio" name="planning-base" value="mill_overlay" data-element-toggle="mill_overlay" checked />
            <span>Mill and overlay</span>
          </label>
          <div class="planning-amount">
            <span aria-hidden="true">$</span>
            <input type="text" inputmode="numeric" class="planning-amount-input" data-element-amount="mill_overlay"
                   aria-label="Mill and overlay amount in dollars" value="1,420,000" />
            <span data-element-reset-slot="mill_overlay">
              <!-- only when overridden -->
              <button type="button" class="text-button" data-element-reset="mill_overlay">Reset to calculated $1,380,000</button>
            </span>
            <p class="filter-validation-message" data-element-error="mill_overlay" role="alert"></p>
          </div>
          <details class="planning-row-details" data-element-details="mill_overlay">
            <summary><span class="visually-hidden">Mill and overlay inputs and pricing: </span>
              <span data-element-brief="mill_overlay">0.50 mi · 40 ft · 2 in</span></summary>
            <p class="muted">{element.note}</p>
            <div class="planning-inputs" data-element-inputs="mill_overlay">
              <label><span>Length (mi)</span><input type="text" inputmode="decimal" data-element-input="mill_overlay" data-input-key="lengthMiles" value="0.5" />
                <small class="muted">From corridor</small></label>       <!-- or: button.text-button "Use corridor value (0.5 mi)" -->
              <label><span>Sides</span><select data-element-input="sidewalk" data-input-key="sides"><option>1</option><option selected>2</option></select></label>
              <details>                                                   <!-- only when the element has advanced inputs -->
                <summary class="text-button">More inputs</summary>
                <div class="planning-inputs"><label><span>Asphalt density (lb/cf)</span><input … data-input-key="densityLbCf" /></label>…</div>
              </details>
            </div>
            <ul class="planning-components" data-element-components="mill_overlay">
              <li><span>Removal of asphalt mat (planing)</span>
                  <span>11,733 SY × $3.12</span><strong>$37,000</strong>
                  <small class="muted" title="Middle half of contract prices: $2.40–$4.10">CDOT 202-00240, median of 19 urban contracts</small></li>
              <li><span>Bike lane striping and symbols, both sides</span><span>0.50 mi × $32,000.00</span><strong>$16,000</strong>
                  <small class="muted">Assembly cost, calibration report 4.10</small></li>
              <li><span>Items subtotal $327,000 × 1.86 allowance (minor items 56%, traffic control 8%, mobilization 7%)</span>
                  <strong>$610,000</strong></li>
            </ul>
          </details>
        </div>
        <!-- base_none row: same radio and label "No base treatment"; no amount box; no details;
             amount cell shows <span class="muted">Elements only</span>. -->
      </fieldset>

      <fieldset class="planning-group" data-planning-group="corridor">  <!-- same for "spot" -->
        <legend class="planning-group-heading"><span class="eyebrow">Corridor elements</span><span class="muted">Add any</span>
          <strong data-group-subtotal="corridor">$1,830,000</strong></legend>
        <div class="planning-row planning-row--off" data-element-row="curb_gutter">
          <label class="checkbox-label"><input type="checkbox" data-element-toggle="curb_gutter" /><span>Curb and gutter</span></label>
          … same amount cell and details as above …
        </div>
      </fieldset>

      <fieldset class="planning-group" data-planning-group="other">
        <legend class="planning-group-heading"><span class="eyebrow">Other costs</span><span class="muted">Enter amounts</span>
          <strong data-group-subtotal="other">$100,000</strong></legend>
        <div class="planning-row" data-element-row="right_of_way">
          <span class="planning-row-label">Right-of-way</span>      <!-- no toggle, no details -->
          <div class="planning-amount"><span aria-hidden="true">$</span>
            <input type="text" inputmode="numeric" class="planning-amount-input" data-element-amount="right_of_way"
                   aria-label="Right-of-way amount in dollars" placeholder="Not included" value="" /></div>
        </div>
        <!-- utility_relocation: same -->
      </fieldset>
    </section>

    <!-- Summary (≈35%, sticky) -->
    <aside class="panel-block planning-summary" id="planning-summary" aria-label="Alternative summary">
      <p class="eyebrow">Alternatives</p>
      <div class="planning-alternatives" role="group" aria-label="Alternatives">
        <button type="button" class="app-view-tab app-view-tab--active planning-alt-button" data-planning-alt="{id}" aria-pressed="true">
          <span>Alternative A</span><small data-alt-total="{id}">$3,730,000</small></button>
        <button type="button" class="app-view-tab planning-alt-button" data-planning-alt="{id}" aria-pressed="false">…</button>
        <button type="button" class="secondary-button" data-planning-add-alt aria-expanded="false">+ Alternative</button>
      </div>
      <!-- Shown after "+ Alternative" -->
      <div class="planning-add-alternative" data-planning-add-alt-form hidden>
        <label><span>Start from</span><select data-planning-add-alt-template><option value="">Blank (no elements)</option><option value="complete_street" selected>Complete street</option>…</select></label>
        <label><span>Name</span><input data-planning-add-alt-name value="Alternative B" /></label>
        <button type="button" class="primary-button" data-planning-add-alt-confirm>Add alternative</button>
        <button type="button" class="secondary-button" data-planning-add-alt-cancel>Cancel</button>
      </div>
      <label><span>Name</span><input data-planning-alt-name value="Alternative A" /></label>
      <label><span>Description</span><textarea rows="2" data-planning-alt-description placeholder="One line describing this alternative"></textarea></label>
      <div><button type="button" class="text-button" data-planning-duplicate-alt>Duplicate</button>
           <button type="button" class="text-button" data-planning-delete-alt>Delete</button></div>

      <dl class="planning-summary-lines">
        <div><dt>Construction</dt><dd data-summary="construction">$2,310,000</dd></div>
        <div><dt>Contingency <span class="muted" data-summary="contingencyRate">30%</span></dt><dd data-summary="contingency">$690,000</dd></div>
        <div><dt>Design <label class="project-contingency-percent"><input class="project-contingency-input" data-planning-rate="design" aria-label="Design percentage" value="10" /><span>%</span></label></dt><dd data-summary="design">$300,000</dd></div>
        <div><dt>Construction engineering <label class="project-contingency-percent">…data-planning-rate="constructionEngineering"…</label></dt><dd data-summary="constructionEngineering">$300,000</dd></div>
        <div><dt>Right-of-way</dt><dd data-summary="rightOfWay">Not included</dd></div>
        <div><dt>Utility relocation</dt><dd data-summary="utilityRelocation">$100,000</dd></div>
      </dl>
      <div class="planning-total">
        <span>Total</span><strong data-summary="total">$3,730,000</strong>
        <span class="muted">Range <span data-summary="range">$2,800,000 – $5,600,000</span></span>
        <!-- only when a budget is entered -->
        <span data-summary="budgetLine">Budget $4,000,000 · <strong class="planning-budget--under" data-summary="budgetRemaining">$270,000 remaining</strong></span>
      </div>
      <p class="muted">Prices: {library.priceBasisLabel}</p>
      <p class="visually-hidden" aria-live="polite" data-planning-announce></p>
    </aside>
  </div>
</section>
```

Empty state (no planning project yet) and the "New planning project" action render the same panel in place of the header, corridor strip and layout:

```html
<section class="panel-block planning-new" data-planning-new>
  <div class="panel-heading"><p class="eyebrow">Planning estimate</p><h2>Start a planning estimate</h2></div>
  <p class="muted">Pick a starting template. You can switch any element on or off afterwards.</p>
  <label><span>Project name</span><input data-planning-new-name required /></label>
  <div class="planning-template-options" role="radiogroup" aria-label="Starting template">
    <label class="checkbox-label planning-template-option"><input type="radio" name="planning-template" value="mill_overlay" checked />
      <span><strong>Mill and overlay</strong><small class="muted">Resurface the roadway and bring curb ramps to ADA standard.</small></span></label>
    … one per library template …
    <label class="checkbox-label planning-template-option"><input type="radio" name="planning-template" value="" />
      <span><strong>Blank</strong><small class="muted">No elements selected.</small></span></label>
  </div>
  <div class="planning-corridor-fields"> length, width, intersections (prefilled from library defaults, then the chosen template's projectInputs) </div>
  <button type="button" class="primary-button" data-planning-create>Create project</button>
  <button type="button" class="secondary-button" data-planning-new-cancel>Cancel</button>  <!-- only when a project exists -->
  <p class="muted">Or <button type="button" class="text-button" data-planning-import>import a planning JSON file</button>.</p>
</section>
```

The template picker exists only here. After creation the header says which template the project started from, and later alternatives choose a template through "+ Alternative".

## 2. Wording

| Place | Text |
|---|---|
| Header eyebrow / menus | "Planning estimate"; "Planning projects"; "Export" |
| Project menu actions | "New planning project", "Rename project", "Import JSON", "Delete project" |
| Export actions | "Print summary", "Download CSV", "Download JSON" |
| Header subline | "Started from {template}" or "Started from a blank project"; save status "Saving…", "Saved {h:mm AM}", "Not saved: {reason}" |
| Corridor fields | "Corridor length (mi)", "Roadway width, curb to curb (ft)", "Intersections", "Project stage", "Budget (optional)" (placeholder "No budget") |
| Corridor hint | "Elements use these values unless you change them in an element's inputs." |
| Group headings / hints | "Base treatment" / "Choose one"; "Corridor elements" / "Add any"; "Spot elements" / "Add any"; "Other costs" / "Enter amounts" |
| Base hint | "The base treatment sets the allowance for minor items, traffic control and mobilization on every element." |
| No-base row | "No base treatment"; amount cell "Elements only" |
| Dollar box aria-label | "{Element} amount in dollars"; when off: "{Element} amount in dollars, not included" |
| Reset | "Reset to calculated ${amount}" (aria-label "Reset {Element} to calculated amount ${amount}") |
| Input hints | Inherited: "From corridor". Changed: text-button "Use corridor value ({value} {unit})". defaultFrom: "{multiply} per intersection" / "Use default ({value})". Plain default changed: "Use default ({value} {unit})" |
| Advanced | "More inputs" |
| Input brief (disclosure line) | Active non-advanced inputs joined with " · ": unit inputs as "{value} {unit}" ("0.50 mi", "6 ft"); count and numeric option inputs as "{value} {label lower-case}" ("24 ramps", "2 sides"); yes/no inputs as the label when "yes", omitted when "no" ("remove existing sidewalk"); other options as "{label lower-case}: {value}" ("new surface: concrete"). Elements without inputs: "Details" |
| Component source | Item: "CDOT {code}, median of {n} urban contracts" or "CDOT {code}, median of {n} contracts statewide"; tooltip "Middle half of contract prices: ${p25}–${p75}". Assembly: "Assembly cost, {basis lower-cased first letter}" |
| Allowance line | "Items subtotal ${direct} × {multiplier} allowance (minor items {m}%, traffic control {t}%, mobilization {b}%)" |
| Option values | numbers as is; "yes"/"no" → "Yes"/"No"; other strings capitalized ("Asphalt", "Concrete") |
| Summary lines | "Construction", "Contingency {n}%", "Design", "Construction engineering", "Right-of-way", "Utility relocation", "Total", "Range", "Budget", "{amount} remaining" / "{amount} over budget"; $0 other cost → "Not included" |
| Alternatives | "Alternatives", "+ Alternative", "Start from", "Blank (no elements)", "Name", "Add alternative", "Cancel", "Description" (placeholder "One line describing this alternative"), "Duplicate", "Delete" |
| Narrow bar | "{Alt name}", "Total {amount}", "{amount} under budget" / "{amount} over budget", "Summary" |
| Price basis | "Prices: {priceBasisLabel}" |
| Empty state | "Start a planning estimate"; "Pick a starting template. You can switch any element on or off afterwards."; "Project name"; "Blank" / "No elements selected."; "Create project"; "Cancel"; "Or import a planning JSON file." |
| Confirms (`window.confirm`, as in the Project view) | "Delete {alt name}? This cannot be undone."; "Delete planning project {name}? This cannot be undone." |
| Field errors | Dollar: "Enter a dollar amount of 0 or more, or leave it blank to use the calculated amount." Other-cost dollar: "Enter a dollar amount of 0 or more, or leave it blank." Number: "Enter a number of 0 or more." Integer: "Enter a whole number of 0 or more." Corridor field blank: "Enter a number of 0 or more." Percent: "Enter a percent from 0 to 100." Budget: "Enter a dollar amount, or leave it blank for no budget." Names: "Enter a project name." / "Enter a name for this alternative." |
| Notices | Import OK: "Imported {name} as a new planning project." Import with dropped elements: "Imported {name}. {n} elements in the file are not in this library and were left out." Import failed: "Could not import {file}: {first issue message}" Save conflict: "This planning project was changed in another tab. Reload to see the latest version." + button "Reload project". Storage blocked: "Planning projects cannot be saved in this browser. Changes will be lost when the page closes." Library failure (replaces the view): "Planning prices could not be loaded. Reload the page to try again." + muted error text |

No review states, evidence filters, confidence labels, caveat blocks, or calculation issue lists appear. Calculation issues `missing_price` and `unit_mismatch` are data defects caught by tests; the controller logs them with `console.warn`. `invalid_input` cannot occur because entry validation rejects invalid values.

## 3. Number display

| Value | Format | Example |
|---|---|---|
| Element amount (calculated) | nearest $1,000, full dollars with commas; `$` outside the box | `1,420,000` |
| Element amount (override) | exactly as entered, commas added | `1,234,567` |
| Group subtotals, component amounts, items subtotal | nearest $1,000 | `$610,000` |
| Summary lines, total, range, budget remaining, alternative button totals | nearest $10,000, full dollars | `$3,730,000` |
| Budget, right-of-way, utility entries in their boxes | as entered | `4,000,000` |
| Unit prices | 2 decimals | `$108.79`, `$32,000.00` |
| Quantities | SY, LF, CY, TON: whole number with commas; mi: 2 decimals; each: whole | `5,867 SY`, `0.50 mi`, `24 each` |
| Rates | percent, no decimals unless needed (max 1) | `30%`, `12.5%` |
| Multiplier | 2 decimals | `× 1.86` |

Decision: full dollars everywhere (`$23,340,000`), not `$23.34M`. Reasons: (1) the dollar boxes are full-dollar fields and the summary adds them, so one format avoids converting in your head; (2) the Project view, CSV and print summary show full dollars, and Phase 4 requires exported totals to match the screen to the dollar; (3) `$X.XXM` cannot show totals under $1M cleanly (`$0.69M`). The 35% summary column and the 390 px bar both fit `$23,340,000`. Rounding uses `roundElementAmount` / `roundTotalAmount` from `calculate.ts`; budget remaining is rounded after subtraction at full precision. Displayed summary lines can differ from the displayed total by up to $10,000 per line because each is rounded separately; this is accepted.

Decision: unselected rows show their calculated amount in muted text in the same dollar box, so the planner sees what switching on would add. For unselected base treatments the controller shows the amount that row would have if selected (its own allowance factors), computed by running `calculateAlternative` on a copy with that base chosen. Unselected rows are not counted in group subtotals or the summary.

## 4. Interaction rules

State lives in the controller: `library`, `project`, `results: Map<altId, AlternativeResult>`, `basePreview`, `openDetails: Set<elementId>`, `addAltOpen`, `saveStatus`. Every edit goes through an `edit.ts` helper, then `recalculate()`, then targeted DOM patches, then `scheduleSave()`. The full app (`renderApp`) is never re-rendered by Planning.

| Event (delegated on `[data-planning-root]`) | Model change | DOM regions updated |
|---|---|---|
| `change` on `[data-element-toggle]` (checkbox or radio) | `setElementEnabled(…, library)`; radio routes through `setBaseTreatment` | all rows, group subtotals, summary values, alternative button totals |
| `change` on `[data-element-amount]` | number → `setElementOverride`; also enable the element if off; blank → override `null`, enabled unchanged; other group: blank → `null` | same as above |
| `click` `[data-element-reset]` | `setElementOverride(…, null)`; focus moves to that row's dollar box | same |
| `change` on `[data-element-input]` | number/select → `setElementInput`; blank number → `resetElementInput` | all rows; if the element's set of active inputs changed (a `when` condition), re-render that element's `[data-element-inputs]` and restore focus by `data-input-key` |
| `click` "Use corridor value" / "Use default" | `resetElementInput` | as above |
| `change` on `[data-planning-project-input]` | `setProjectInput` | all rows (inherited values), summary, alternative totals |
| `change` `[data-planning-stage]` / `[data-planning-rate]` / `[data-planning-budget]` | `setStage` / `setEngineering` / `setBudget` | summary values and bar only |
| `change` `[data-planning-alt-name]` / `[data-planning-alt-description]` | `renameAlternative` | alternative buttons row, bar name |
| `click` `[data-planning-alt]` | `selectAlternative` | Planning root re-render (rows differ); focus returns to the pressed button |
| Add / Duplicate / Delete alternative | `addAlternative` (new id, next unused letter name) / `duplicateAlternative` ("{name} copy") / confirm then `removeAlternative` | Planning root re-render; new or neighboring alternative selected; Delete is disabled when only one alternative exists |
| `toggle` on `[data-element-details]` | `openDetails` add/remove (view state only, not saved) | none |
| "Rename project" | heading becomes a "Project name" field with "Save" (`primary-button`) and "Cancel" (`secondary-button`); blank shows "Enter a project name." | header only |
| Open project / create / import / delete project | storage calls | Planning root re-render |

Patching rules:

- Patches set `value`, `checked`, `textContent`, `className` and `hidden` on existing nodes. The only `innerHTML` replacements in a patch are `[data-element-components]`, `[data-element-reset-slot]` and `[data-element-brief]`, which contain no editable fields (the reset button is re-created; if it had focus, focus moves to the dollar box).
- A field that has focus is never written by a patch. Its value is normalized (commas added) only after its own `change` commit.
- A Planning-root re-render records `document.activeElement` by its `data-*` key plus `selectionStart`/`selectionEnd`, and restores both afterwards. `openDetails` keeps disclosures open across re-renders.

Field behavior:

- Numbers commit on `change` (blur or Enter). Enter is handled on `keydown` and commits without moving focus. No live recalculation while typing. Escape restores the value shown before editing.
- Parsing strips `$`, commas and spaces. Blank, `0`, and positive finite numbers are valid. Invalid text leaves the model unchanged, keeps the typed text, sets `aria-invalid="true"`, and shows the error in that row's `filter-validation-message` element. The next valid commit clears it.
- Override semantics: blank = calculated (box re-displays the calculated amount); `0` is a valid override and shows `0` with the reset link. An override stays when the element is switched off and when inputs change; the reset link always shows the current calculated amount.
- Editing the dollar box of an unselected row selects it (base rows through select-one).
- Corridor fields: blank or invalid shows the error and keeps the previous model value. Integer inputs reject decimals.
- Design and CE percent inputs: 0–100, stored as fractions.

Keyboard and screen reader:

- Tab order per row: toggle → dollar box → reset (when shown) → disclosure summary → (open) inputs. Radios use native arrow keys within the base fieldset. Each group is a `<fieldset>` with a `<legend>`.
- Alternative buttons use `aria-pressed`. "+ Alternative" uses `aria-expanded`; Escape closes the add form and the two `<details>` menus and returns focus to their trigger. Menus close after an action.
- After each commit the controller writes "Total {amount}" (plus "{amount} remaining" or "{amount} over budget") to `[data-planning-announce]` (`aria-live="polite"`). No other live regions, so the narrow layout does not announce twice.

Save: debounce 500 ms after the last commit; flush on project switch and on `visibilitychange` to hidden. Revision-checked save via `src/planning/storage.ts`; a conflict shows the notice and stops autosave for that project until "Reload project".

Narrow layout (under 900 px): `planning-layout` becomes one column; the elements panel comes first and the full summary follows it. `planning-total-bar` becomes visible and `position: sticky; top: 0` above the elements, showing the alternative name, total, budget state and a "Summary" link to `#planning-summary`. The summary loses `position: sticky`. Corridor fields and the new-project template options collapse to one or two columns. Element rows keep toggle + label and the dollar box on one line down to 390 px (box width about 8.5 rem); the disclosure line wraps under them.

## 5. CSS plan

All rules go in one "Planning" section of `src/styles.css`. Colors come only from `:root` tokens: `--panel`, `--panel-alt`, `--line`, `--line-strong`, `--text-muted`, `--heading`, `--accent`, `--accent-dark`, `--good`, `--bad`, `--shadow`; font `--font-heading` for the total. No hex, rgb or rgba literals. Every selector starts with a `planning-*` class; no element-only rule is scoped to a Planning container (no `.planning-view button`, `.planning-view input`, etc.). Descendant selectors target the class's own direct parts only (for example `.planning-summary-lines dd`).

New classes:

| Class | Purpose | Why no shared class fits |
|---|---|---|
| `planning-view` | Vertical stack of Planning cards, 16 px gap | Layout. `project-workspace` belongs to the Project view. |
| `planning-header` | Title block left, menus right; wraps under 900 px | Layout. `panel-heading` has no two-sided flex rule. |
| `planning-header-actions` | Flex row for the two menus | Layout. `project-header-actions` is Project-view layout and could change with it. |
| `planning-corridor-fields` | Auto-fit grid of corridor fields (min 150 px) | Layout. No shared field grid exists. |
| `planning-layout` | Two columns, `minmax(0, 1.85fr) minmax(320px, 1fr)`; one column under 900 px | Layout. `workspace-grid` has a fixed 290–420 px left column and is Explorer layout. |
| `planning-group` | Resets fieldset border, padding and margin; spacing between groups | No shared fieldset rule; browser defaults otherwise. |
| `planning-group-heading` | Legend as a flex row: eyebrow, hint, subtotal right-aligned | Layout of the legend. |
| `planning-row` | Element row grid: `minmax(0,1fr) auto` with the disclosure on a second full-width line; divider in `--line` | Element row (named in the convention rule). |
| `planning-row--off` | Dollar box text in `--text-muted` for unselected rows | Row state; no shared muted-input state. |
| `planning-row-label` | Label text for other-cost rows without a toggle, aligned with `checkbox-label` text | Matches checkbox rows that have a control. |
| `planning-amount` | `$` prefix, dollar box, reset link and error stacked right-aligned | Element row part. |
| `planning-amount-input` | 8.5 rem wide, right-aligned, `tabular-nums`, 36 px high | Global input is 100% wide and 42 px; `project-contingency-input` is too small for millions. |
| `planning-row-details` | Disclosure summary as one muted line with a chevron (same chevron drawing as `project-switcher`) and an indented body on `--panel-alt` | Element row part; `project-switcher` is a dropdown menu with a fixed 300 px summary. |
| `planning-inputs` | Grid of input fields in the disclosure (2–3 columns, 1 under 560 px) | Layout. |
| `planning-components` | Component lines: label, quantity × price, amount right-aligned, source note on its own line | `summary-table` is a wide table (min 820 px; global tables are min 1180 px). |
| `planning-summary` | Summary card; `position: sticky; top: 18px` on desktop (same offset as `search-panel`) | Layout. |
| `planning-alternatives` | Wrapping flex row of alternative buttons and "+ Alternative" | Alternatives button row (named in the rule). `app-view-tabs` adds its own box and shadow. |
| `planning-alt-button` | Two-line layout (name, small total) added to `app-view-tab` | `app-view-tab` is single-line. Colors and active state stay from `app-view-tab`. |
| `planning-add-alternative` | Inline grid for the add-alternative form | Layout. |
| `planning-summary-lines` | `<dl>` rows: label left, amount right, `--line` dividers | Same reason as `planning-components`. |
| `planning-total` | Total block: label, large `--heading` amount in `--font-heading`, range and budget lines; `--panel-alt` background, `--line` border | Total block (named in the rule). `project-total` is a small single value. |
| `planning-budget--under` / `planning-budget--over` | Budget state color `--good` / `--bad`, bold | No shared state color classes. |
| `planning-total-bar` | Narrow-only sticky bar; `display: none` at 900 px and wider | No shared equivalent. |
| `planning-template-options` | Grid of template cards (3 columns desktop, 1 narrow) | Layout. |
| `planning-template-option` | Border, padding and selected outline (`:has(input:checked)` → `--accent` border) for a template card; used with `checkbox-label` | Card frame; `checkbox-label` provides only the control/text grid. |
| `planning-new` | Spacing for the new-project panel | Layout. |

Reused classes and where: `panel-block` (header, corridor, elements, summary, new-project panel); `panel-heading` + `<h2>/<h3>` (header, corridor, new project); `eyebrow` (header, group headings, "Alternatives"); `primary-button` ("Create project", "Add alternative"); `secondary-button` ("+ Alternative", Cancel); `text-button` (reset, use corridor value, more inputs, duplicate, delete, summary link, import link); `muted` (hints, source notes, range); `checkbox-label` (toggle rows, radios, template cards); `visually-hidden` (disclosure prefix, announcer); `filter-validation-message` (field errors and failure notices); `project-switcher`, `project-switcher-menu`, `project-switcher-project`, `project-switcher-actions` (both header menus); `project-contingency-percent` + `project-contingency-input` (design and CE %); `app-view-tab`, `app-view-tab--active` (alternative buttons). `label-row` is used for label + inline hint pairs in the disclosure. `table-scroll` and `summary-table` are not used: Planning has no wide tables.

## 6. Module structure (`src/ui/planning/`)

| File | Contents | Data needed |
|---|---|---|
| `format.ts` | `formatElementAmount(n)`, `formatTotalAmount(n)`, `formatUnitPrice(n)`, `formatQuantity(q, unit)`, `unitLabel(unit)`, `formatPercent(rate)`, `formatEntered(n)`, `parseDollar(text) → {ok, value: number|null} | {ok:false}`, `parseNumber(text, {integer}) → …`, `parsePercent(text) → …`, `inputBrief(element, values)`, `optionLabel(value)`, `sourceNote(source)` | numbers, `ResolvedElement`, `PriceSource` |
| `renderPlanning.ts` | Pure string renderers: `renderPlanningView(vm)`, `renderNewProjectPanel(library, draft, hasProject)`, `renderHeader(project, projects, saveStatus, library)`, `renderCorridorPanel(library, project)`, `renderTotalBar(alt, summary)`, `renderElementGroups(library, project, result, basePreview, openDetails)`, `renderElementRow(element, elementResult, selection, ctx)`, `renderOtherRow(element, selection)`, `renderElementInputs(element, elementResult, selection, projectInputs)`, `renderComponentLines(elementResult, summary)`, `renderResetSlot(elementResult)`, `renderSummary(library, project, result, altTotals, addAltOpen)`, `renderAlternativeButtons(project, altTotals)`, `renderLoadError(message)`; exported `escapeHtml` | `ResolvedLibrary`, `PlanningProject`, `AlternativeResult`, `Record<altId, number>` totals, `Record<elementId, number>` base preview, `Set` open details |
| `planningController.ts` | `mountPlanning(root, deps)` → `{ destroy() }`; `deps = { library, repository, now(), newId() }`; state; delegated `change`/`click`/`keydown`/`toggle` handlers; `recalculate()` (selected alternative, all alternative totals, base previews); `patchRows()`, `patchSummary()`, `patchAlternativeButtons()`, `rerender()` with focus capture/restore; `scheduleSave()`/`flushSave()`; import via `parseShareFile` + `importProjectCopy` | all of the above plus storage |
| `format.test.ts`, `renderPlanning.test.ts`, `planningController.test.ts` | Unit tests; controller tests use `// @vitest-environment jsdom` | fixtures from `src/planning/fixtures` |

`renderApp.ts` gets a third tab, "Planning", and an empty `<div data-planning-mount>`; `main.ts` loads the library on first visit and calls `mountPlanning` (orchestrator edits). The library load error replaces the view with `renderLoadError`.

## 7. Check against the approved sketch and convention rule

Re-read against Phase 3: shared classes reused, tokens only, no blanket element rules, new classes listed with reasons above. Layout matches the sketch: header with project and export menus, corridor strip, grouped element rows (radio/checkbox, label, dollar box, disclosure), sticky summary at about 35% with alternative buttons, description, construction, contingency, design, CE, ROW, utilities, total, range, budget; narrow total bar above elements and full summary after.

Departures from the sketch:

1. Amounts use full dollars (`$3,730,000`), not `$3.73M`. Reason in section 3.
2. The `▸` disclosure is a full-width second line under each row showing a one-line input brief ("0.50 mi · 2 sides · 6 ft"), not an icon at the row end. A `<details>` summary cannot share one grid line with the toggle and dollar box without placing interactive controls inside `<summary>`, and the brief replaces the sketch's inline "6 ft" / "(24)" hints.
3. The template picker is in the new-project panel, not in the corridor strip, because a template only applies at creation. Later alternatives choose a template under "+ Alternative".
4. Right-of-way and utility relocation are separate summary lines (sketch: one "ROW / utilities" line), so each entry is visible.
5. Budget is entered in the corridor strip; the summary shows budget and remaining.
6. The sketch's "Design 12%" and "CE 15%" are illustrative; defaults are the library's 10% and 10%.
7. "No base treatment" is a fourth radio row (from the library), shown without a dollar box.

## 8. Orchestrator decisions (before STOP 2)

1. Full dollars everywhere (no `$M`).
2. Unselected rows show their calculated amount greyed.
3. Summary lines (construction, contingency, design, CE, ROW, utilities, budget remaining) display to the nearest $1,000; the foregrounded total and the range display to the nearest $10,000.
4. Reuse of other screens' classes (`project-switcher`, `project-contingency-*`, `checkbox-label`, `visually-hidden`, `filter-validation-message`, `app-view-tab`) is accepted for visual consistency; listed for STOP 2 review.
5. Controller lifetime: the app re-renders its whole root with `innerHTML`, which destroys the Planning mount node. Planning state therefore lives in a controller created once per app session: `createPlanningController(deps)` → `{ mount(container), unmount(), flush() }`. `mount` renders from current state (loading the library and store on first call); `unmount` detaches listeners; `flush` saves pending changes. `renderApp.ts` calls `mount` after each render while the Planning tab is active (orchestrator edit).
