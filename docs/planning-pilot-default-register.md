# Planning pilot default register — revision 2

Status: local order-of-magnitude pilot defaults, selected 2026-10-07. They are not engineer-approved standards or calibrated accuracy ranges. New package instances freeze their definition, exact source-rate snapshot, and any provisional manual rate. Saved pilot-1 alternatives retain their old values until the user previews and adopts a package update.

## Automatically selected exact-item rates

All existing bound items keep the Phase 2 pricing policy: one NDOT annual summary period for Nebraska, and a median of eligible contract medians from the CDOT Cost Data Book for Colorado. The actual frozen rate, period and source rows are recorded in each alternative, so they may differ as the loaded data changes. This table records new bindings and quantity assumptions; it does not hard-code the historical rate.

| Package/role | Binding | Quantity basis | Source-rate anchor and limits |
| --- | --- | --- | --- |
| NE resurfacing, tack | NDOT `9053.00`, GAL | Roadway SY × 0.10 GAL/SY | [NDOT 2025 annual price report](https://dot.nebraska.gov/media/xqvdpg0p/aup-january-2025-december-2025.pdf): $3.08/GAL. [NDOT tack specification](https://dot.nebraska.gov/media/g4qp4y0d/2017-specbook.pdf), Section 504: 0.10–0.20 GAL/SY on existing/milled surfaces. Pilot uses the low end for one pass; joint-edge double application is excluded. At 0.5 mile × 24 ft: 7,040 SY × 0.10 = 704 GAL; $2,168.32 at the anchor rate. The runtime uses its selected frozen annual rate, which may be from another report period. |
| NE reconstruction, removal | NDOT `1101.00`, SY | Roadway area | Same 2025 report: $8.11/SY. At 7,040 SY, $57,094.40 at the anchor rate. This is pavement surface removal, not underlying base/unsuitable material or unrelated mass grading. |
| CO reconstruction, removal | CDOT `202-00210`, SY | Roadway area | [CDOT Cost Data Books](https://www.codot.gov/business/eema/costdatabook) and the loaded exact awarded observations. [Denver's 2024 ADA bid tab](https://denvergov.org/files/assets/public/v/2/contract-administration/documents/bidtabs/202472080-bid-tab.pdf) separately lists concrete-pavement removal at $30/SY in its engineer estimate; this is a cross-check, not the runtime rate. Scope excludes underlying base removal and unusual disposal. |

## Fixed provisional manual rates for new pilot-2 packages

These are frozen as `rateOverrides` with a source/basis reason. They are not exact DOT item prices. Numeric choices are rounded deliberately; the displayed estimate rounds money only after full-precision calculation. The same rates and full explanations are in `src/planning/recipes/pilotDefaults.ts`.

| Package/role | Pilot rate | Calculation and coverage |
| --- | --- | --- |
| CO resurfacing, tack | **$0.50/SY** | One application over roadway area. [Colorado Springs' 2024 Three Trail Crossings specifications](https://coloradosprings.gov/system/files/2024-02/b24-t027mz_three_trail_crossings_project.pdf) describe approximately 0.10 GAL/SY but treat tack as incidental on that contract. No exact CDOT tack catalog item was established. $0.50/SY is an explicit pilot allowance and may overlap the asphalt item; engineer review must confirm. At 7,040 SY: $3,520. |
| NE sidewalk, curb ramps | **$2,500/EACH** | Four example ramps at two corridor ends × two sides. [NDOT 2025 annual report](https://dot.nebraska.gov/media/xqvdpg0p/aup-january-2025-december-2025.pdf) item `3989.02` is $25/SF; assumed 80 SF/ramp gives $2,000, plus $500 pilot allowance for minor ramp details. Four ramps = $10,000. Intermediate intersections, driveways, major removal and utilities are excluded. |
| CO sidewalk, curb ramps | **$4,000/EACH** | Four example ramps. [Colorado Springs' 2026 street-improvement assurance schedule](https://coloradosprings.gov/cost-estimates-financial-assurances-street-improvements) lists pedestrian ramps at $41/SF; assumed 80 SF/ramp gives $3,280, plus $720 pilot allowance for minor ramp details. Four ramps = $16,000. This is a municipal planning analogue, not a statewide CDOT awarded rate. Intermediate intersections, driveways, major removal and utilities are excluded. |

The ramp count is a planner input, not a function of sidewalk length. A zero ramp count is an explicit scope assumption; it does not erase the sidewalk surface. The rate includes only the stated ramp proxy. A planner adds other known work as an unpriced note for engineer review rather than entering an unsupported unit price.

## Existing percentages and external scope

The original provisional percentage bases remain: mobilization 8% and traffic control 5% of priced direct construction; planning contingency 25% of construction including those allowances; design and construction engineering each 10% of construction plus contingency. The optional drainage 20% and minor-utilities 5% allowances remain disabled. These are pilot assumptions adapted from the Giles example, not calibrated Nebraska or Colorado rules. They are shown together as other project costs on the planner screen, with each base and rate in engineer review. Do not also apply Colorado Springs' 20% incidentals to the same work.

Property acquisition and major utility relocation start **unassessed**. Selecting `None expected` records an explicit assumption of no major impact; `Possible or unknown` excludes them from the displayed subtotal; `Known impact` requires an engineer-supplied amount for a complete included-scope total. [FHWA cost-estimating guidance](https://www.fhwa.dot.gov/majorprojects/cost_estimating/guidance.cfm) identifies these as project-dependent costs. The pilot assigns no blanket percentage or implied zero to unknown impacts.

## Independent half-mile checks

At 0.5 mile, 24 ft roadway width yields 7,040 SY; 2 inches of asphalt at 145 lb/CF and a 1.05 material factor yields 803.88 tons. A 5 ft sidewalk on two sides yields 2,933.333333 SY. Four ramps at the frozen manual rates yield $10,000 NE or $16,000 CO. Exact-item construction amounts depend on the frozen runtime source rate, and the full estimate also depends on the documented allowance graph. Tests should calculate these quantities independently and compare actual runtime snapshots to this register.
