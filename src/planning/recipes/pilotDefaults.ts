import type { PackageKind, PlanningState, PlanningUnit } from "../types";

/** Frozen pilot assumptions for roles without a compatible automatic bid-item rate. */
export interface PilotManualRate {
  state: PlanningState;
  kind: PackageKind;
  role: string;
  packageVersion: "pilot-2";
  unit: PlanningUnit;
  rate: number;
  evidence: string;
  basis: string;
  included: string;
  excluded: string;
}

export const PILOT_MANUAL_RATES: readonly PilotManualRate[] = [
  {
    state: "CO", kind: "resurfacing", role: "tack", packageVersion: "pilot-2", unit: "SY", rate: 0.50,
    evidence: "CDOT has no tack-specific exact item in the loaded catalog; Colorado Springs describes tack application at approximately 0.10 GAL/SY in its 2024 Three Trail Crossings specifications. The $0.50/SY amount is a pilot allowance, not a CDOT bid price.",
    basis: "Rounded order-of-magnitude application allowance per roadway SY; confirm whether tack is already incidental to asphalt placement.",
    included: "One tack application over the resurfaced roadway area.",
    excluded: "Additional joint-edge application, unusual substrate preparation and any duplicate cost already included in asphalt placement.",
  },
  {
    state: "NE", kind: "sidewalk", role: "ramps_crossings", packageVersion: "pilot-2", unit: "EACH", rate: 2500,
    evidence: "NDOT January–December 2025 summary, item 3989.02 Construct PCC Curb Ramp: $25/SF; 80 SF assumed per ramp gives $2,000. A further $500 per ramp is an explicit pilot assumption for minor ramp details, not an observed bid price.",
    basis: "Four example ramps at two corridor ends and two sidewalk sides; $2,500 per ramp is provisional.",
    included: "Approximate curb-ramp construction and minor ramp details at the entered ramp count.",
    excluded: "Intermediate intersections, driveway crossings, major removals, drainage and utility changes.",
  },
  {
    state: "CO", kind: "sidewalk", role: "ramps_crossings", packageVersion: "pilot-2", unit: "EACH", rate: 4000,
    evidence: "Colorado Springs street-improvement financial-assurance schedule effective January 2026: pedestrian ramp $41/SF. An 80 SF assumed ramp gives $3,280; a further $720 per ramp is an explicit pilot assumption for minor ramp details, not a CDOT bid price.",
    basis: "Four example ramps at two corridor ends and two sidewalk sides; $4,000 per ramp is provisional.",
    included: "Approximate curb-ramp construction and minor ramp details at the entered ramp count.",
    excluded: "Intermediate intersections, driveway crossings, major removals, drainage and utility changes.",
  },
];

export function pilotManualRate(state: PlanningState, kind: PackageKind, role: string): PilotManualRate | null {
  return PILOT_MANUAL_RATES.find((item) => item.state === state && item.kind === kind && item.role === role) ?? null;
}

export function pilotManualReason(rate: PilotManualRate): string {
  return `${rate.packageVersion} provisional default. ${rate.basis} Source/basis: ${rate.evidence} Included: ${rate.included} Excluded: ${rate.excluded}`;
}
