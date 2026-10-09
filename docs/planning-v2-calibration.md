# Planning v2 calibration report (Colorado)

Status: Phase 1 deliverable for tasks 1c and 1d. Prepared 2026-10-09. For review at Stop 1.
Scope: mobilization, traffic-control and minor-item factors by base type; assembly costs for multi-item elements; 2026 escalation; stage values; FHU benchmarks.
Scripts (not in repository): session scratchpad `calib/factors.py`, `calib/fhu.py`, `calib/assemblies.py`, `calib/verify_mob.py`.

## 1. Summary of recommended values

### 1.1 Factors (applied as direct × (1 + minor) × (1 + TC) × (1 + mob))

| Base type | Evidence used | n contracts | mob | TC | minor | Combined multiplier |
|---|---|---|---|---|---|---|
| mill_overlay | CDOT urban, 2023-03-26 onward | 8 | 0.07 | 0.08 | 0.56 | 1.80 |
| reconstruction | CDOT statewide (urban n = 5 < 8), plus urban/FHU judgment for minor | 29 | 0.10 | 0.12 | 0.55 | 1.91 |
| path | No CDOT path contracts (n = 0). Judgment from elements_only | 0 | 0.10 | 0.05 | 0.35 | 1.56 |
| elements_only | CDOT urban, 2023-03-26 onward | 22 | 0.11 | 0.16 | 0.46 | 1.88 |

"minor" is the net minor-item factor: it excludes items that the planner prices as separate elements (sidewalk, curb ramps, curb and gutter, lighting, signals, storm drainage, landscaping). See section 3.3.

### 1.2 Assemblies (direct cost, 2026 planning dollars, before minor/TC/mob)

| Element | Unit | Recommended direct cost (2026 $) |
|---|---|---|
| Corridor lighting (both sides, 200 ft spacing) | MILE | 1,120,000 |
| Landscaping / tree lawn (6 ft lawn, trees at 40 ft, irrigation) | MILE per side | 414,000 |
| Storm drainage allowance | MILE | 1,450,000 |
| Enhanced crossing (RRFB pair) | EACH | 34,000 |
| New or rebuilt signal (4-leg) | EACH | 379,000 |
| Median refuge island (60 ft × 8 ft) | EACH | 23,000 |
| Bus stop upgrade (ADA pad and shelter pad, no shelter) | EACH | 7,200 |
| ADA curb ramp (incl. detectable warning, adjoining walk and curb) | EACH | 7,300 |
| Marked crosswalk (60 ft, high visibility) | EACH | 6,400 |
| Bike lane (both sides, 6 in line, symbols every 250 ft) | MILE | 32,000 |
| Buffered bike lane (both sides, two buffer lines, symbols) | MILE | 46,000 |
| Buffered bike lane delineator option (every 40 ft, both sides) | MILE | 30,000 |

All assembly costs are direct. The planner must apply the base-type factors on top.

### 1.3 Other values

| Item | Recommendation |
|---|---|
| 2025 Q4 → 2026 escalation | 1.02 |
| Concept stage | contingency 30%, range −25%/+50% (keep) |
| Planning study stage | contingency 25%, range −20%/+30% (keep) |
| Design engineering | 10% (keep, editable) |
| Construction engineering | 10% (keep, editable) |

## 2. Method

### 2.1 Contract set

- Source: `public/data/states/co/contracts.csv` and `item_observations.csv`, CDOT Cost Data Book sources only, `price_type = awarded_bid`.
- Complete contract: sum of awarded_bid extended prices is within 2% of `awarded_amount`. 439 of 443 CDOT contracts qualify. All 439 have a mobilization line.
- Primary window: contract date_basis on or after 2023-03-26: 305 complete contracts (73 urban, terrain U).
- Sensitivity: all years (2022–2026): 439 complete contracts (105 urban).
- Urban preference: urban value is used when at least 8 urban contracts qualify; otherwise statewide.
- Date for indexing and windows: earliest item date_basis in the contract.

### 2.2 Item groups

| Group | Codes |
|---|---|
| Mobilization | 626-00000, 626-00007, 626-00100. Public information items 626-011xx are minor items |
| Traffic control (TC) | all 630-xxxxx |
| Planing | 202-0024x |
| HMA | 403-xxxxx |
| Concrete pavement | 412-xxxxx |
| Pavement removal | 202-00210, 202-00220, 202-00230, planing |
| Excavation | 203-000xx (unclassified excavation, embankment) |
| Aggregate base | 304-xxxxx |
| Curb and gutter | 609-2xxxx |
| Sidewalk / ramps / bikeway | 608-000xx |
| Markings | 627-xxxxx |
| Lighting | 613-xxxxx |
| Signals | 614-7xxxx, 614-8xxxx |
| Storm drainage | 603-xxxxx, 604-xxxxx |
| Landscaping | 207, 212, 213, 214, 623 |
| Structures (exclusion test) | 501–519, 601, 602 |

### 2.3 Classification rules

Shares are of work = contract total − mobilization − TC. Rules are applied in order; first match wins.

1. other: structures share ≥ 25%.
2. mill_overlay: planing + HMA ≥ 40%, planing > 0, concrete pavement < 5%, excavation + aggregate base < 10%.
3. reconstruction: concrete pavement + excavation + aggregate base ≥ 15%, and pavement removal + excavation + base + concrete pavement + HMA + curb and gutter ≥ 45%.
4. path: contract contains a concrete bikeway item (608-00026, 608-00040) and sidewalk/bikeway share ≥ 15%.
5. elements_only: sidewalk + curb and gutter + markings + lighting + signals ≥ 35%, and planing + HMA + concrete pavement < 25%.
6. other: everything else (bridges, safety/guardrail, ITS, culverts, interstate widening).

### 2.4 Final modeled-item sets (denominator of the minor factor)

| Base type | Modeled items |
|---|---|
| mill_overlay | 202-0024x planing, 403-xxxxx HMA |
| reconstruction | 202-00210/00220/00230/0024x pavement removal, 203-000xx excavation, 304-xxxxx aggregate base, 412-xxxxx concrete pavement, 403-xxxxx HMA, 609-2xxxx curb and gutter |
| path | 608-000xx, 304-xxxxx, 203-000xx |
| elements_only | 608-000xx, 609-2xxxx, 627-xxxxx, 613-xxxxx, 614-7xxxx/8xxxx |

Changes from the provisional set: 203-00000 widened to 203-000xx; 609-21xxx widened to 609-2xxxx (includes curb-only and gutter-only items); 614 restricted to signal hardware (614-7/8), excluding sign panels and posts.

### 2.5 Factor definitions

- mob = mobilization / (total − mobilization)
- TC = TC items / (total − mobilization − TC)
- minor (gross) = (total − mob − TC − modeled) / modeled
- minor (net) = (total − mob − TC − modeled − separately-priced elements) / modeled. Separately-priced elements: for mill_overlay sidewalk, curb and gutter, lighting, signals, drainage, landscaping; for reconstruction sidewalk, lighting, signals, drainage, landscaping; for elements_only drainage, landscaping.
- Combined multiplier = (1 + minor)(1 + TC)(1 + mob) = total / modeled (identity, verified per contract).
- Statistics: per-contract factor, then median and p25/p75 across contracts. Dollar-weighted values are shown as a sensitivity.

### 2.6 Assembly pricing

- Item unit price: CDOT awarded_bid, contract date 2023-03-26 onward (three years to the latest CDOT letting, 2026-03-26), quantity > 0.
- Each observation is adjusted to 2025 Q4 by FHWA NHCCI (index 2025 Q4 / index of the contract quarter; 2026 Q1 lettings use factor 1.00 because NHCCI ends at 2025 Q4).
- Per-contract median, then median across contracts. Urban median if at least 8 urban contracts, otherwise statewide.
- 2026 value = 2025 Q4 value × 1.02 (section 5). Rounded to the nearest $1,000 (or $100 for values under $10,000).

## 3. Factors by base type

### 3.1 Contract counts

| Scope | mill_overlay | reconstruction | path | elements_only | other | Total |
|---|---|---|---|---|---|---|
| Window, urban | 8 | 5 | 0 | 22 | 38 | 73 |
| Window, statewide | 60 | 29 | 0 | 57 | 159 | 305 |
| All years, urban | 13 | 5 | 0 | 31 | 56 | 105 |
| All years, statewide | 82 | 44 | 0 | 79 | 234 | 439 |

### 3.2 Medians (p25–p75), primary window 2023-03-26 onward

| Base type | Scope | n | mob | TC | minor gross | minor net | Combined (net) |
|---|---|---|---|---|---|---|---|
| mill_overlay | urban | 8 | 0.069 (0.059–0.089) | 0.085 (0.076–0.096) | 0.583 (0.510–0.635) | 0.559 (0.485–0.601) | 1.81 (1.70–1.87) |
| mill_overlay | statewide | 60 | 0.081 (0.061–0.112) | 0.081 (0.061–0.112) | 0.535 (0.350–0.831) | 0.482 (0.335–0.688) | 1.78 (1.58–2.09) |
| reconstruction | urban | 5 | 0.137 (0.104–0.188) | 0.105 (0.085–0.233) | 0.900 (0.768–0.952) | 0.761 (0.548–0.833) | 2.25 (1.86–2.47) |
| reconstruction | statewide | 29 | 0.104 (0.060–0.176) | 0.119 (0.076–0.233) | 0.615 (0.381–0.899) | 0.424 (0.318–0.737) | 1.86 (1.67–2.25) |
| elements_only | urban | 22 | 0.110 (0.065–0.164) | 0.157 (0.096–0.218) | 0.482 (0.374–0.849) | 0.459 (0.347–0.840) | 1.93 (1.69–2.66) |
| elements_only | statewide | 57 | 0.073 (0.053–0.133) | 0.117 (0.042–0.194) | 0.341 (0.142–0.528) | 0.331 (0.142–0.503) | 1.67 (1.28–2.32) |
| path | any | 0 | — | — | — | — | — |

The combined median is computed per contract; it is not the product of the factor medians.

### 3.3 Sensitivity: all years and dollar-weighted

| Base type | Scope | n | mob | TC | minor net | Combined (net) |
|---|---|---|---|---|---|---|
| mill_overlay | all years, urban | 13 | 0.071 | 0.091 | 0.519 | 1.78 |
| mill_overlay | all years, statewide | 82 | 0.079 | 0.080 | 0.433 | 1.71 |
| reconstruction | all years, statewide | 44 | 0.101 | 0.119 | 0.425 | 1.86 |
| elements_only | all years, urban | 31 | 0.110 | 0.155 | 0.479 | 1.92 |
| elements_only | all years, statewide | 79 | 0.073 | 0.108 | 0.314 | 1.62 |
| mill_overlay | window, urban, $-weighted | 8 | 0.070 | 0.084 | 0.521 | — |
| reconstruction | window, statewide, $-weighted | 29 | 0.128 | 0.119 | 0.556 | — |
| elements_only | window, urban, $-weighted | 22 | 0.081 | 0.095 | 0.292 | — |

Reason for the net minor factor: CDOT resurfacing and reconstruction contracts routinely carry curb ramps, sidewalk, lighting, signals and drainage. The planner prices these as separate elements and then applies the base-type factors to them. Using the gross minor factor would count them twice. General striping (627) stays in the minor bucket for mill_overlay and reconstruction because no planner element covers it.

### 3.4 Urban reconstruction contracts (n = 5, below the threshold of 8)

| Contract | Date | Total $ | mob | TC | minor net |
|---|---|---|---|---|---|
| ER4701-140 SH 470 and Platte Canyon Rd | 2023-04-17 | 145,553 | 0.104 | 0.085 | 0.392 |
| NHPP0253-300 I-25 Segment 5 | 2024-03-29 | 27,080,430 | 0.217 | 0.442 | 1.095 |
| NHPP0253-301 I-25 Segment 5 | 2024-10-30 | 86,099,399 | 0.188 | 0.035 | 0.833 |
| NHPP1602-165 US 160 Pagosa reconstruct | 2024-11-07 | 24,625,000 | 0.086 | 0.105 | 0.548 |
| STA157A-013 CO 157 (MM 2.8–4.5) | 2025-12-04 | 4,299,635 | 0.137 | 0.233 | 0.761 |

Three of five are interstate or state-highway mega or emergency contracts. They are not representative of a municipal corridor.

### 3.5 FHU cross-check

Basis: engineer estimate (FHU estimates) or average bid (FHU bid tabs), from `public/data/imports/fhu_*_item_unit_costs.csv`. F/A (700-xxxxx) items are removed before computing factors because CDOT Cost Data Book contracts carry no F/A items. Minor net uses the reconstruction modeled set.

| Project | Basis | Total excl. F/A $ | F/A share | mob | TC | minor net (recon set) |
|---|---|---|---|---|---|---|
| Old Hampden 2026 (estimate) | EE | 6,914,176 | 0.000 | 0.091 | 0.167 | 0.95 |
| Colorado Blvd 2026 (estimate) | EE | 8,358,454 | 0.059 | 0.070 | 0.153 | 0.55 |
| West Colfax Ph 2 2026 (estimate) | EE | 16,772,519 | 0.059 | 0.031 | 0.033 | 1.26 |
| Watson Ave roundabout 2021 | avg bid | 5,118,403 | 0.013 | 0.121 | 0.084 | 0.58 |
| Arapahoe / Big Dry Creek 2021 (bridge) | avg bid | 9,203,822 | 0.027 | 0.095 | 0.080 | n/a (bridge) |
| Ralston / Yukon / Garrison 2021 | avg bid | 13,157,982 | 0.061 | 0.067 | 0.072 | 1.11 |
| Kipling / Bowles 2022 | avg bid | 2,401,352 | 0.046 | 0.144 | 0.134 | 0.91 |
| West Colfax Ph 1 2024 | avg bid | 8,483,730 | 0.011 | 0.064 | 0.048 | 2.77 |
| JC-73 2025 | avg bid | 5,331,076 | 0.151 | 0.086 | 0.199 | 2.75 |
| Lincoln / Jordan 2025 (widening) | avg bid | 22,257,302 | 0.035 | 0.075 | 0.068 | 3.36 |
| Pikes Peak sidewalks 2023 | avg bid | 1,615,129 | 0.000 | 0.106 | (partial coding) | excluded |
| West Mainstreet 2024 | avg bid | 1,289,271 | 0.000 | 0.115 | (partial coding) | excluded |

- Median of the 10 fully coded FHU projects: mob 0.081, TC 0.082.
- Median of the three FHU estimates: mob 0.070, TC 0.153, minor net 0.95.
- Pikes Peak and West Mainstreet carry 33–35 rows coded only by section prefix; their TC and minor shares are not reliable.
- High minor values on Lincoln/Jordan, JC-73, West Colfax Ph 1 reflect widening, retaining walls, utilities and structures that the reconstruction modeled set does not cover.

### 3.6 Recommendations and justification

| Base type | Recommendation | Justification |
|---|---|---|
| mill_overlay | mob 0.07, TC 0.08, minor 0.56 | Urban window n = 8 meets the threshold. mob 0.069 → 0.07; TC 0.085 → 0.08 (exact 0.0846). Statewide (n = 60) gives 0.08 / 0.08 / 0.48; the all-years urban set (n = 13) gives 0.07 / 0.09 / 0.52. All within ±0.01 for mob and TC. Combined 1.80. |
| reconstruction | mob 0.10, TC 0.12, minor 0.55 | Urban n = 5 is below 8; statewide window n = 29 is used for mob (0.104) and TC (0.119). Statewide minor net is 0.42, but urban CDOT (0.76, n = 5), and the three FHU urban estimates (0.55, 0.95, 1.26) are higher; pooled urban CDOT + FHU estimates (n = 8) median is 0.80. The statewide dollar-weighted value is 0.556. Recommended 0.55 is a judgment value between the statewide median and the urban evidence. Combined 1.91. |
| path | mob 0.10, TC 0.05, minor 0.35 | Zero CDOT path contracts in the data (the four contracts with bikeway items are interstate or highway projects classified as other). mob: similar to small concrete-flatwork contracts (elements_only 0.07 statewide, 0.11 urban). TC: an off-street path needs traffic control only at road crossings; 0.05 is below every measured base type. minor: elements_only statewide net 0.33, rounded up for grading, erosion control, signing and crossing work. Combined 1.56. Review at Stop 1. |
| elements_only | mob 0.11, TC 0.16, minor 0.46 | Urban window n = 22. Values are medians: 0.110, 0.157, 0.459. Small contracts (median $1.23M) carry higher mob and TC percentages. Dollar-weighted values are much lower (0.08 / 0.10 / 0.29); the median is used because planner elements-only projects are also small. Combined 1.88. |

## 4. Assemblies

All values are direct costs. CDOT item prices are 2025 Q4 dollars; totals × 1.02 give 2026. "n" is the number of contracts; "U" is urban count; basis is urban when U ≥ 8.

### 4.1 Corridor lighting — $1,120,000 per mile (both sides, 200 ft spacing)

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 613-40010 light standard foundation | 53 EA | 4,788.78 | 38 / 13 / urban |
| 613-32300 light standard steel 30 ft | 53 EA | 5,487.39 | 6 / 0 / statewide |
| 613-13008 LED luminaire 8,000 lm | 53 EA | 1,560.79 | 18 / 10 / urban |
| 613-01200 2 in conduit (plastic) | 10,920 LF | 25.92 | 68 / 24 / urban |
| 613-07002 type two pull box | 53 EA | 1,783.56 | 50 / 21 / urban |
| 613-50109 meter power pedestal | 1 EA | 10,578.53 | 29 / 13 / urban |
| 613-10000 wiring (LS) | 2 LS | 40,988.61 | 85 / 35 / urban |

2025 Q4 total $1,097,539; 2026 $1,119,490. Per pole about $20,700.
FHU check: West Colfax Ph 2 estimate, 613 items $2,529,075 for 157 light standard foundations = $16,100 per pole (pedestrian-scale 15 ft poles dominate).

### 4.2 Landscaping / tree lawn — $414,000 per mile per side

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 207-00702 topsoil (offsite), 6 in deep, 6 ft wide | 587 CY | 114.19 | 25 / 4 / statewide |
| 212-00050 sod | 31,680 SF | 5.26 | 18 / 10 / urban |
| 214-00220 deciduous tree 2 in caliper, 40 ft spacing | 132 EA | 787.48 | 6 / 3 / statewide |
| Irrigation, FHU Colorado Blvd 623-09900 $43,028 / 19,850 SF sod | 31,680 SF | 2.17 | FHU, 1 estimate |

2025 Q4 total $406,207; 2026 $414,332. Excludes removal of existing pavement in the lawn area. CDOT irrigation items (623) appear in only 2–4 contracts; the FHU rate is used.

### 4.3 Storm drainage allowance — $1,450,000 per mile

CDOT build-up, new system:

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 604-19105 inlet type R L5 (5 ft), both sides every ~400 ft | 26 EA | 11,671.10 | 21 / 10 / urban |
| 604-30010 manhole slab base (10 ft), every ~400 ft | 13 EA | 10,600.00 | 33 / 11 / urban |
| 603-01245 24 in RCP trunk | 5,280 LF | 211.73 | 29 / 8 / urban |
| 603-01185 18 in RCP laterals, 40 LF per inlet | 1,040 LF | 176.72 | 33 / 9 / urban |

New system: 2025 Q4 $1,742,973; 2026 $1,777,833. Inlets, manholes and laterals only (connect to existing trunk): 2026 $639,000.
FHU drainage (603, 604, inlet/manhole/pipe removals) per implied mile (section 7): Old Hampden $454,830 / 0.31 mi = $1.47M; Colorado Blvd $901,375 / 1.11 mi = $0.81M; West Colfax Ph 2 $2,214,295 / 1.54 mi = $1.44M. Median $1.44M.
Recommendation: $1,450,000 per mile (FHU median, rounded), which lies between the CDOT inlet-only ($0.64M) and new-trunk ($1.78M) build-ups.

### 4.4 Enhanced crossing (RRFB) — $34,000 each

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 614-80003 rectangular rapid flashing beacon assembly | 2 EA | 12,161.88 | 9 / 4 / statewide |
| 614-72860 pedestrian push button | 2 EA | 971.49 | 32 / 17 / urban |
| 627-30410 preformed thermoplastic crosswalk | 300 SF | 18.56 | 76 / 24 / urban |
| 627-30405 preformed thermoplastic word/symbol (yield lines) | 60 SF | 27.89 | 85 / 25 / urban |

2025 Q4 $33,509; 2026 $34,179. FHU check: Old Hampden 614-80003 at $10,800 each. Curb ramps are not included (use the ADA curb ramp element).

### 4.5 New or rebuilt signal (4-leg) — $379,000 each

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 614-81145 signal-light pole steel, 45 ft mast arm | 4 EA | 25,268.63 | 16 / 10 / urban |
| 503-00036 drilled shaft 36 in, 22 LF per pole | 88 LF | 847.91 | 45 / 22 / urban |
| 614-72855 traffic signal controller cabinet | 1 EA | 40,491.37 | 31 / 15 / urban |
| 614-86248 controller type 2070LC | 1 EA | 8,776.84 | 14 / 6 / statewide |
| 614-70336 signal face 12-12-12 | 12 EA | 1,285.78 | 43 / 23 / urban |
| 614-70150 pedestrian countdown face | 8 EA | 811.44 | 33 / 22 / urban |
| 614-70200 accessible pedestrian signal | 8 EA | 2,300.00 | 16 / 11 / urban |
| 614-84000 pedestal pole steel | 2 EA | 3,564.85 | 32 / 22 / urban |
| 614-72886 camera detection system | 1 EA | 16,040.59 | 20 / 10 / urban |
| 614-86800 UPS | 1 EA | 7,824.06 | 26 / 8 / urban |
| 613-00206 2 in conduit bored | 400 LF | 26.24 | 56 / 25 / urban |
| 613-00306 3 in conduit bored | 200 LF | 28.16 | 50 / 24 / urban |
| 613-07004 type four pull box | 6 EA | 3,039.62 | 57 / 27 / urban |
| 613-10000 wiring (LS) | 1 LS | 40,988.61 | 85 / 35 / urban |

2025 Q4 $371,627; 2026 $379,060. Excludes removal of an existing signal (FHU estimates: 202-00828 $25,000–30,000 LS), curb ramps and signing.
FHU check: West Colfax Ph 2, 614 signal items $1,375,300 + drilled shafts $397,400 over 6 controller cabinets = $295,000 per signal before conduit and wiring.

### 4.6 Median refuge island (60 ft × 8 ft) — $23,000 each

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 609-20010 curb type 2 section B, perimeter | 136 LF | 47.75 | 29 / 19 / urban |
| 610-00030 median cover material (concrete) | 480 SF | 24.00 | 32 / 13 / urban |
| 608-00015 detectable warnings, 2 × 20 SF | 40 SF | 99.00 | 34 / 14 / urban |
| 202-00250 removal of pavement marking | 200 SF | 3.08 | 168 / 45 / urban |

2025 Q4 $22,590; 2026 $23,042. Excludes signing and new crosswalk markings (use the marked crosswalk element).

### 4.7 Bus stop upgrade — $7,200 each

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 608-00006 concrete sidewalk 6 in (8×10 ft boarding pad + 10×20 ft shelter pad) | 31 SY | 106.66 | 33 / 19 / urban |
| 202-00200 removal of sidewalk / surface | 31 SY | 35.66 | 69 / 32 / urban |
| 609-21020 curb and gutter type 2 II-B | 40 LF | 50.03 | 78 / 37 / urban |
| 202-00203 removal of curb and gutter | 40 LF | 16.94 | 84 / 40 / urban |

2025 Q4 $7,091; 2026 $7,233. Excludes the shelter, bench and trash receptacle (FHU Old Hampden shade shelter $20,000 each; West Colfax Ph 2 bench $2,500 each).

### 4.8 ADA curb ramp — $7,300 each

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 608-00010 concrete curb ramp | 12 SY | 223.12 | 72 / 33 / urban |
| 608-00015 detectable warnings | 20 SF | 99.00 | 34 / 14 / urban |
| 202-00206 removal of concrete curb ramp | 12 SY | 41.00 | 47 / 25 / urban |
| 608-00006 adjoining sidewalk 6 in | 5 SY | 106.66 | 33 / 19 / urban |
| 202-00200 removal of sidewalk | 5 SY | 35.66 | 69 / 32 / urban |
| 609-21020 curb and gutter | 20 LF | 50.03 | 78 / 37 / urban |
| 202-00203 removal of curb and gutter | 20 LF | 16.94 | 84 / 40 / urban |

2025 Q4 $7,200; 2026 $7,344. FHU unit prices for 608-00010: $200–230 per SY (consistent).

### 4.9 Marked crosswalk (60 ft, high visibility) — $6,400 each

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 627-30410 preformed thermoplastic crosswalk: 15 bars, 2 × 10 ft | 300 SF | 18.56 | 76 / 24 / urban |
| 627-30405 stop/yield bar allowance | 24 SF | 27.89 | 85 / 25 / urban |

2025 Q4 $6,238; 2026 $6,363. FHU unit prices for crosswalk marking: $25–30 per SF (higher than CDOT median).

### 4.10 Bike lane — $32,000 per mile (both sides)

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 627-00008 modified epoxy, 6 in line, 10,560 LF at 160 LF/gal (20 mil) | 66 GAL | 205.08 | 155 / 36 / urban |
| 627-30405 bike symbol + arrow, 15 SF each, 42 locations | 630 SF | 27.89 | 85 / 25 / urban |

2025 Q4 $31,107; 2026 $31,729. Excludes removal of existing lane lines and bike lane signs.

### 4.11 Buffered bike lane — $46,000 per mile (both sides); delineator option +$30,000 per mile

| Item | Qty | Unit price | n / U / basis |
|---|---|---|---|
| 627-00008 modified epoxy, two 6 in buffer lines per side (21,120 LF) | 132 GAL | 205.08 | 155 / 36 / urban |
| 627-30405 bike symbol + arrow, 42 locations | 630 SF | 27.89 | 85 / 25 / urban |
| Option: 612-00042 flexible delineator type II, every 40 ft both sides | 264 EA | 112.28 | 14 / 4 / statewide |

2025 Q4 $44,642 (base) and $29,643 (option); 2026 $45,535 and $30,236. Excludes buffer hatching and marking removal.

## 5. Escalation 2025 Q4 → 2026

NHCCI (unadjusted) recent values: 2023 Q4 3.1158; 2024 Q1 3.1913; Q2 3.1607; Q3 3.3629; Q4 3.2326; 2025 Q1 3.1628; Q2 3.2104; Q3 3.3079; Q4 3.2344.

| Measure | Value |
|---|---|
| 4 quarters: 2025 Q4 / 2024 Q4 | +0.05% |
| Annual average 2025 / 2024 | −0.25% |
| 8 quarters: 2025 Q4 / 2023 Q4 | +3.8% (+1.9% per year) |
| Annual average 2024 / 2023 | +7.4% |

- The index has been flat for four to five quarters after the 2021–2023 surge, with ±3% quarter-to-quarter noise (Q3 peaks).
- Time from the 2025 Q4 midpoint (mid-November 2025) to the 2026 midpoint is about 0.6 years. At 1.9–3% per year this is 1.1–1.8%.
- Recommendation: 1.02. It covers the 8-quarter trend rate with a small allowance for Q3 seasonality and is easy to explain. Acceptable range 1.00–1.03.

## 6. Stage values

- The three FHU estimates show no contingency, design engineering or construction engineering lines in the imported data (`fhu_estimate_*_item_unit_costs.csv`). These percentages cannot be checked against them.
- Colorado Blvd and West Colfax Ph 2 carry F/A Minor Contract Revisions (700-70010) of $400,000 and $900,000. Total F/A is 5.9% of non-F/A items in both. Old Hampden carries no F/A. F/A minor contract revisions act as a construction-phase contingency. CDOT Cost Data Book contracts carry no F/A items, so the measured factors exclude it and the stage contingency must cover it.
- Proposed values compared with AACE 18R-97 class ranges (general reference): Class 5 (concept) low −20% to −50%, high +30% to +100%; Class 4 (study) low −15% to −30%, high +20% to +50%. The proposed bands (Concept −25%/+50%; Planning study −20%/+30%) are inside these ranges at the narrow end.
- Contingency 30% (Concept) and 25% (Planning study) exceed the FHU F/A allowance (5.9%) by a margin appropriate for scope not yet defined. No change recommended.
- Design 10% and CE 10%: no FHU evidence available in the data. Keep as editable defaults. Note: municipal federal-aid projects in Colorado frequently carry CE above 10%; the planner should keep the field visible.

## 7. FHU benchmarks

Implied length = (curb and gutter + curb LF) / 2 / 5,280, assuming full replacement on both sides. If curb work is partial, the implied length is too short and cost per mile is too high.

| Project | Construction total incl. F/A $ | Excl. F/A $ | Curb + C&G LF | Implied miles | $ per implied mile (incl. F/A) |
|---|---|---|---|---|---|
| Old Hampden 2026 | 6,914,176 | 6,914,176 | 3,293 (+347 LF crosspan) | 0.31 | 22.2M |
| Colorado Blvd 2026 (Arapahoe Rd to Dry Creek Rd) | 8,848,454 | 8,358,454 | 11,740 | 1.11 | 8.0M |
| West Colfax Ph 2 2026 | 17,762,519 | 16,772,519 | 16,215 | 1.54 | 11.5M |

Caveats:
- Totals are engineer-estimate construction totals (sum of line items including mobilization and TC). They exclude contingency, engineering, right-of-way and utilities.
- Old Hampden is short, intersection- and streetscape-heavy (shelters, furniture, plantings, signal rebuild); its per-mile figure is not a corridor rate.
- Colorado Blvd's implied 1.11 miles is consistent with the named limits (about 1 mile). Sidewalk quantity (11,924 SY) implies about 10 ft width if both sides are rebuilt.
- West Colfax Ph 2 includes 157 light poles, about 6 signals and $0.70M of irrigation.
- The user may supply actual corridor lengths at Stop 1 to replace these implied values.
- The task brief lists "West Colfax Ph 1" among the FHU estimates. The data contains a West Colfax Phase 2 estimate (2026-01-23) and a West Colfax Phase 1 bid tab (2024-10-03). This report uses Phase 2 as the estimate.

## 8. Verification

- Independent recomputation (`calib/verify_mob.py`, standard library only, separate classification code): mill_overlay mob factor, window 2023-03-26 onward. Urban: n = 8, median 0.0691. Statewide: n = 60, median 0.0812. Main script: urban 0.0691 (n = 8), statewide 0.0812 (n = 60). Agree.
- Identity check: per contract, (1 + minor gross)(1 + TC)(1 + mob) equals total / modeled; the gross combined median equals the total/modeled median in every cell.
- Spot check of three assembly prices directly from `item_observations.csv` (stdlib script, awarded_bid, window, NHCCI to 2025 Q4, per-contract median then median):

| Code | Spot check | Assembly table |
|---|---|---|
| 614-80003 RRFB (statewide, n = 9, U = 4) | 12,161.88 | 12,161.88 |
| 608-00010 curb ramp (urban, n = 72, U = 33) | 223.12 | 223.12 |
| 613-40010 light standard foundation (urban, n = 38, U = 13) | 4,788.78 | 4,788.78 |

## 9. Limitations

- CDOT "urban" (terrain U) contracts are mostly interstate and state-highway work in urban areas, not municipal streets. Urban mill_overlay contracts include I-25 resurfacing.
- Path has no CDOT contract evidence. Its factors are judgment values.
- Urban reconstruction has 5 contracts; the reconstruction minor factor (0.55) is a judgment value between statewide CDOT (0.42) and urban CDOT/FHU (0.76–0.95).
- Classification thresholds are rule-based and untested against hand labels. 159 of 305 window contracts fall into "other" and do not inform any factor.
- The elements_only minor factor includes removals (sidewalk, curb, ramp removal). The curb ramp and bus stop assemblies also include removals. A small double count results when both apply.
- The CDOT Cost Data Book excludes F/A items. The FHU estimates show 5.9% F/A. This is left to contingency.
- Lump-sum items (613-10000 wiring) are converted to per-mile or per-signal allowances by judgment.
- Items with fewer than 8 contracts are used for: 613-32300 light standard (n = 6), 214-00220 tree (n = 6), 614-80003 RRFB (n = 9 statewide, 4 urban), 614-86248 controller (n = 14 statewide, 6 urban), 612-00042 delineator (n = 14 statewide, 4 urban), 207-00702 topsoil (urban 4).
- FHU bid-tab factors use average bid, not low bid. Pikes Peak and West Mainstreet are partially coded and excluded from medians.
- Prior finding "whole-contract / (milling + asphalt) = 1.69" is not reproduced with these rules: mill_overlay total/modeled median is 1.84 (window, statewide, n = 60) and 1.82 (all years, n = 82). The difference is attributed to classification rules; the prior rule set is not available.

## 10. Library defaults (task 1e)

Source: `data/planning/co_element_library.json` with `public/data/states/co/planning_prices.json` (escalation 1.02, 2026 planning basis). Computed by the orchestrator with an independent evaluator (session scratchpad `lib/evalib.py`). Phase 2 fixtures will reproduce these values in TypeScript.

### 10.1 Reference quantities (half mile)

| Case | Library result | Reference |
|---|---|---|
| Mill area, 0.5 mi × 24 ft | 7,040 SY | 7,040 SY |
| Overlay asphalt, 2 in, 145 lb/cf, factor 1.05 | 803.88 TON | 803.88 TON |
| Sidewalk, 0.5 mi × 5 ft × 2 sides | 2,933.33 SY | 2,933.33 SY |

### 10.2 Bound item prices (2026 basis)

| Element | Item | Price |
|---|---|---|
| Mill and overlay | 202-00240 Planing | $3.57/SY |
| Mill and overlay, reconstruction | 403-33841 HMA (S)(100)(PG 64-22), urban n = 8 | $136.10/TON |
| Reconstruction | 202-00220 / 202-00210 removal, 203-00010 excavation, 304-06007 ABC Class 6, 412-00800 concrete 8 in | see price table |
| Path, sidewalk | 608-00006 Concrete sidewalk 6 in | $108.79/SY |
| Curb and gutter | 609-21010 Type 2 (I-B); 202-00203 removal | see price table |

HMA choice: no single HMA grade has deep urban evidence. 403-33841 is the most-used grade with at least 8 urban contracts. The most-used grade statewide, 403-34751 SX (75) PG 64-28 (36 contracts, 5 urban), prices at $170.92/TON with escalation.

### 10.3 Element defaults: 1 mile, 40 ft roadway, 4 intersections

All-in = direct × combined multiplier. Corridor and spot elements are shown with the elements_only multiplier (1.88); in a project they take the multiplier of the selected base treatment.

| Element | Default inputs | Direct $ | All-in $ |
|---|---|---|---|
| Mill and overlay | 2 in overlay | 448,000 | 808,000 |
| Full-depth reconstruction | asphalt to asphalt, 6 in HMA, 6 in base, 12 in excavation | 2,583,000 | 4,933,000 |
| New multi-use path | 10 ft concrete | 891,000 | 1,389,000 |
| Sidewalk | 6 ft, 2 sides, no removal | 766,000 | 1,440,000 |
| Curb and gutter | 2 sides, with removal | 619,000 | 1,163,000 |
| Bike lanes | both sides | 32,000 | 60,000 |
| Buffered bike lane | both sides, no delineators | 46,000 | 86,000 |
| Corridor lighting | both sides | 1,120,000 | 2,105,000 |
| Landscaping / tree lawn | 2 sides | 828,000 | 1,557,000 |
| Storm drainage allowance | per mile | 1,450,000 | 2,726,000 |
| ADA curb ramps | 16 | 117,000 | 220,000 |
| Marked crosswalks | 8 | 51,000 | 96,000 |
| Enhanced crossing (RRFB) | 1 | 34,000 | 64,000 |
| New or rebuilt signal | 1 | 379,000 | 712,000 |
| Median refuge island | 1 | 23,000 | 43,000 |
| Bus stop upgrade | 2 | 14,000 | 27,000 |

### 10.4 Template totals: 1 mile, 40 ft, 4 intersections, Concept stage

Total = construction × 1.30 contingency × 1.20 engineering. Range −25% / +50%.

| Template | Construction $ | Total $ | Range $ |
|---|---|---|---|
| Mill and overlay | 1,019,000 | 1,590,000 | 1.19M – 2.38M |
| Full reconstruction | 11,058,000 | 17,251,000 | 12.9M – 25.9M |
| Complete street | 14,964,000 | 23,343,000 | 17.5M – 35.0M |
| Sidewalk gap (one side) | 939,000 | 1,466,000 | 1.10M – 2.20M |
| Multi-use path | 1,442,000 | 2,250,000 | 1.69M – 3.37M |
| Intersection safety (0.1 mi, 1 intersection) | 835,000 | 1,302,000 | 0.98M – 1.95M |

Comparison with section 7: the FHU estimates run $8.0M–$22.2M construction per implied mile. The complete-street template is $15.0M construction per mile; full reconstruction is $11.1M. Storm drainage ($2.7M all-in per mile) is the largest single corridor element and should be reviewed.
