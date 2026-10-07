import type { AppData, ContractItemRecord, InflationIndexRecord, ItemObservationRecord } from "../../data/schema";
import type { ContractLineContribution, ContractRateSnapshot, PlanningResult, PlanningUnit } from "../types";

export interface ColoradoRateRequest {
  agencyItemId: string;
  unit: PlanningUnit;
  from?: string;
  to?: string;
  districts?: string[];
  sourceIds?: string[];
  /** When set, adjust all selected observations to this NHCCI quarter. */
  targetQuarter?: string;
  policyVersion?: string;
  capturedAt?: string;
}

const issue = (code: string, message: string, severity: "error" | "warning" = "error") => ({ code, path: "coloradoRate", message, severity });
const finitePositive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const date = (v: string | null | undefined): string | null => { const value = (v ?? "").trim(); if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null; const parsed = new Date(`${value}T00:00:00Z`); return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value ? value : null; };
const isoDateTime = (v: string | undefined): boolean => !!v && Number.isFinite(Date.parse(v)) && /^\d{4}-\d{2}-\d{2}T/.test(v);
const median = (values: number[]): number => { const a = [...values].sort((x, y) => x - y); const n = a.length; const result = n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2; return Number.isFinite(result) ? result : NaN; };
const normalizedDistrict = (value: string | null | undefined): string => (value ?? "").trim().toUpperCase();
const isStatewide = (value: string | null | undefined): boolean => { const v = normalizedDistrict(value); return v === "" || v === "0" || v === "00" || v === "STATEWIDE" || v === "STATEWIDE / UNASSIGNED"; };

function sourceDate(obs: ItemObservationRecord, data: AppData): string | null {
  const raw = (obs.dateBasis ?? "").trim();
  const direct = date(raw);
  if (raw) return direct;
  return date(data.contractById.get(obs.contractId)?.estimateLetDate);
}

function sourceItemIdentity(obs: ItemObservationRecord, items: ContractItemRecord[]): { key: string; item: ContractItemRecord | null; ambiguous: boolean } {
  const candidates = items.filter((i) => i.contractId === obs.contractId && i.sourceId === obs.sourceId && i.agencyItemId === obs.agencyItemId && i.unitNormalized.toUpperCase() === obs.unitNormalized.toUpperCase());
  // Cost-book reconstruction uses the stable *_awarded_bid -> *_item relationship.
  const derived = obs.observationId.replace(/_awarded_bid$/, "_item");
  const exact = candidates.filter((i) => i.contractItemId === derived || i.bidTabItemId === derived);
  if (exact.length === 1 && finitePositive(exact[0].quantity) && Math.abs(exact[0].quantity - obs.quantity) <= Math.max(1e-9, Math.abs(obs.quantity) * 1e-9)) return { key: exact[0].contractItemId, item: exact[0], ambiguous: false };
  if (exact.length > 1) return { key: derived, item: null, ambiguous: true };
  return { key: derived, item: null, ambiguous: true };
}

function defaultFrom(anchor: string): string { const d = new Date(`${anchor}T00:00:00Z`); d.setUTCFullYear(d.getUTCFullYear() - 3); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }

function indexMap(data: AppData): ReadonlyMap<string, InflationIndexRecord> {
  return data.inflationIndexByPeriod ?? new Map(data.inflationIndexes.map((x) => [x.periodLabel, x]));
}

/** Selects and freezes Colorado cost-book awarded evidence. All filtering is explicit and deterministic. */
export function buildColoradoContractRateSnapshot(data: AppData, request: ColoradoRateRequest): PlanningResult<ContractRateSnapshot> {
  const errors = [] as ReturnType<typeof issue>[];
  if (!request.agencyItemId || !request.unit) errors.push(issue("invalid_request", "An exact agency item identity and physical unit are required."));
  if (!request.agencyItemId.startsWith("co_cdot_")) errors.push(issue("state_mismatch", "Colorado rate selection requires a co_cdot agency item identity."));
  if (!(["LF", "SF", "SY", "CY", "TON", "EACH", "LS"] as string[]).includes(request.unit)) errors.push(issue("unit_mismatch", "The requested unit is not a supported planning unit."));
  if (request.from && !date(request.from)) errors.push(issue("invalid_request", "The requested From date is not a valid ISO calendar date."));
  if (request.to && !date(request.to)) errors.push(issue("invalid_request", "The requested To date is not a valid ISO calendar date."));
  if (request.from && request.to && date(request.from) && date(request.to) && request.from > request.to) errors.push(issue("invalid_request", "The requested From date must not be after To date."));
  if (!isoDateTime(request.capturedAt)) errors.push(issue("invalid_request", "capturedAt must be supplied as a valid ISO datetime."));
  if (errors.length) return { ok: false, issues: errors };
  const excluded: { observationId: string; reason: string }[] = [];
  const eligibleDataset = data.observations.filter((o) => {
    const source = data.sourceById.get(o.sourceId);
    return source?.state === "CO" && source.sourceType === "cost_book" && o.priceType === "awarded_bid";
  });
  const validDates = eligibleDataset
    .filter((o) => finitePositive(o.quantity) && finitePositive(o.unitPrice)
      && data.contractById.get(o.contractId)?.state === "CO"
      && data.contractById.get(o.contractId)?.agencyId === "co_cdot")
    .map((o) => sourceDate(o, data)).filter((x): x is string => !!x).sort();
  if (!validDates.length) return { ok: false, issues: [...errors, issue("missing_rate", "No Colorado cost-book awarded observation has a valid date.")] };
  const anchor = validDates[validDates.length - 1];
  const requestedFrom = request.from ?? defaultFrom(anchor);
  const requestedTo = request.to ?? anchor;
  const districts = request.districts ?? [];
  const sourceFilter = request.sourceIds ?? [];
  const observations = eligibleDataset.filter((o) => o.agencyItemId === request.agencyItemId && o.unitNormalized.toUpperCase() === request.unit.toUpperCase());
  const selected = observations.filter((o) => {
    const d = sourceDate(o, data); const c = data.contractById.get(o.contractId); const s = data.sourceById.get(o.sourceId);
    const reject = (reason: string) => { excluded.push({ observationId: o.observationId, reason }); return false; };
    if (!d) return reject("Invalid or missing observation date.");
    if (sourceFilter.length && !sourceFilter.includes(o.sourceId)) return reject("Excluded by explicit source filter.");
    if (d < requestedFrom || d > requestedTo) return reject("Outside requested inclusive date window.");
    if (!finitePositive(o.quantity)) return reject("Quantity is not positive and finite.");
    if (!finitePositive(o.unitPrice)) return reject("Unit rate is not positive and finite.");
    if (!c || c.state !== "CO" || c.agencyId !== "co_cdot" || s?.agencyId !== "co_cdot") return reject("Contract or source is not Colorado CDOT evidence.");
    if (districts.length && !districts.some((wanted) => isStatewide(wanted) ? isStatewide(c.district) : normalizedDistrict(wanted) === normalizedDistrict(c.district))) return reject("Excluded by district filter.");
    return true;
  });
  const grouped = new Map<string, { observation: ItemObservationRecord; identity: string; item: ContractItemRecord | null }[]>();
  const allItems = data.contractItems ?? [];
  const physicalImports = new Map<string, Set<string>>();
  for (const o of selected) {
    const official = (data.contractById.get(o.contractId)?.officialContractId ?? "").trim().toUpperCase();
    if (!official) continue;
    const key = `${official}/${o.agencyItemId}/${o.unitNormalized.toUpperCase()}`;
    const sources = physicalImports.get(key) ?? new Set<string>(); sources.add(o.sourceId); physicalImports.set(key, sources);
  }
  const crossSourceCollisions = new Set<string>();
  for (const o of selected) {
    const official = (data.contractById.get(o.contractId)?.officialContractId ?? "").trim().toUpperCase();
    if (official && (physicalImports.get(`${official}/${o.agencyItemId}/${o.unitNormalized.toUpperCase()}`)?.size ?? 0) > 1) crossSourceCollisions.add(o.observationId);
  }
  for (const o of selected) {
    if (crossSourceCollisions.has(o.observationId)) { excluded.push({ observationId: o.observationId, reason: "Unresolved cross-source collision: the same official contract/item appears in multiple cost-book imports." }); continue; }
    const identity = sourceItemIdentity(o, allItems);
    const key = `${o.contractId}/${identity.key}`;
    const row = { observation: o, identity: identity.key, item: identity.item };
    if (identity.ambiguous) excluded.push({ observationId: o.observationId, reason: "Unresolved contract-item identity; exact derived cost-book contract item was not found." });
    else (grouped.get(key) ?? (grouped.set(key, []), grouped.get(key)!)).push(row);
  }
  const chosen: { observation: ItemObservationRecord; item: ContractItemRecord | null; identity: string }[] = [];
  for (const rows of grouped.values()) {
    if (rows.length === 1) chosen.push(rows[0]);
    else rows.forEach((r) => excluded.push({ observationId: r.observation.observationId, reason: "Unresolved collision: more than one awarded observation claims one source contract-item." }));
  }
  const indexByPeriod = indexMap(data);
  let target: InflationIndexRecord | null = null;
  if (request.targetQuarter) target = indexByPeriod.get(request.targetQuarter) ?? null;
  const adjusted = !!request.targetQuarter;
  if (adjusted) {
    if (!target || !finitePositive(target.indexValue)) return { ok: false, issues: [...errors, issue("missing_rate", "Requested NHCCI target quarter is unavailable.")] };
    for (const row of chosen) { const q = quarter(sourceDate(row.observation, data)!); const idx = q ? indexByPeriod.get(q) : null; if (!idx || !finitePositive(idx.indexValue)) return { ok: false, issues: [...errors, issue("missing_rate", "Adjusted mode requires NHCCI coverage for every selected observation.")] }; }
  }
  const linesByContract = new Map<string, ContractLineContribution[]>();
  for (const row of chosen) {
    const o = row.observation; const d = sourceDate(o, data)!; const q = quarter(d); const idx = adjusted ? indexByPeriod.get(q!)! : null;
    const factor = idx && target ? target.indexValue / idx.indexValue : null;
    const line: ContractLineContribution = { observationId: o.observationId, contractItemId: row.item?.contractItemId ?? row.identity, sourceId: o.sourceId, date: d, quantity: o.quantity, unit: o.unitNormalized, rawRate: o.unitPrice, rate: o.unitPrice * (factor ?? 1), inflationFactor: factor, sourceLocator: row.item?.sourceLocator ?? o.observationId };
    (linesByContract.get(o.contractId) ?? (linesByContract.set(o.contractId, []), linesByContract.get(o.contractId)!)).push(line);
  }
  const contracts = [...linesByContract.entries()].map(([contractId, lines]) => ({ contractId, medianRate: median(lines.map((x) => x.rate)), lines }));
  const rawContractMedians = [...linesByContract.values()].map((lines) => median(lines.map((x) => x.rawRate)));
  if (!contracts.length) return { ok: false, issues: [...errors, issue("missing_rate", "No compatible Colorado contract evidence remains after the requested filters.")] };
  const sourceIds = [...new Set(chosen.map((x) => x.observation.sourceId))].sort();
  const actualDates = chosen.map((x) => sourceDate(x.observation, data)! ).sort();
  const rate = median(contracts.map((x) => x.medianRate));
  const rawRate = median(rawContractMedians);
  if (!finitePositive(rate) || !finitePositive(rawRate)) return { ok: false, issues: [...errors, issue("invalid_number", "Median rate arithmetic overflowed or produced a non-positive value.")] };
  const snapshot: ContractRateSnapshot = { kind: "co_contract_median", state: "CO", agencyItemId: request.agencyItemId, unit: request.unit, requestedFrom, requestedTo, datasetAnchor: anchor, sourceTypes: ["cost_book"], sourceIds, requestedSourceIds: request.sourceIds ? [...request.sourceIds] : [], districts: [...districts], actualFrom: actualDates[0], actualTo: actualDates[actualDates.length - 1], contracts, excludedEvidence: excluded, rawRate, rate, limitedEvidence: contracts.length < 5, inflation: { method: adjusted ? "observation_quarter_nhcci" : "none", availability: adjusted ? "available" : "unavailable", targetPeriod: target?.periodLabel ?? null, factor: null, reason: adjusted ? null : "Source prices are nominal; NHCCI adjustment was not requested." }, policyVersion: request.policyVersion ?? "co-contract-median-v1", capturedAt: request.capturedAt! };
  const issues = [...errors]; if (snapshot.limitedEvidence) issues.push(issue("limited_evidence", "Fewer than five independent contracts contribute to this rate.", "warning"));
  return { ok: true, value: snapshot, issues };
}

export const selectColoradoContractRate = buildColoradoContractRateSnapshot;

function quarter(value: string): string | null { const d = date(value); if (!d) return null; const month = Number(d.slice(5, 7)); return `${d.slice(0, 4)} Q${Math.floor((month - 1) / 3) + 1}`; }
