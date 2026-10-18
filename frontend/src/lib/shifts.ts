// Aggregation over shifts, same formulas as backend/opc/shifts.py (aggregate_shifts). Used by the demo
// to build the 7-day screen from simulated shift rows. Formulas: docs/BERAKNINGAR.md.

export const DEFAULT_OEE_TARGET_PCT = 85;

/** One shift of the shift log (timestamps in ms). Values are measured from opened to closed (or now). */
export interface ShiftRow {
  start: number;
  /** Scheduled end (ShiftEnd) */
  end: number;
  /** null while the shift is open */
  closed: number | null;
  team: string | null;
  target: number | null;
  oeeTarget: number | null;
  plannedS: number | null;
  plannedSource: "PlannedTime" | "schedule" | null;
  good: number | null;
  reject: number | null;
  total: number | null;
  runS: number | null;
  stopS: number | null;
  stopCount: number | null;
}

export interface ShiftAggregate {
  shifts: number;
  has_data: boolean;
  good: number | null;
  reject: number | null;
  total: number | null;
  planned_s: number | null;
  run_s: number | null;
  stop_s: number | null;
  stop_count: number | null;
  target: number | null;
  oee_target: number | null;
  teams: string[];
  oee: { availability: number | null; performance: number | null; quality: number | null; oee: number | null };
}

/** [actual share, plan share] of a shift inside [lo, hi): time share of the covered part [start, min(end, closed ?? now)]. */
export function shiftShares(r: ShiftRow, lo: number, hi: number, now: number): [number, number] {
  const stop = r.closed ?? now;
  const end = r.end ?? stop;
  const endEff = Math.min(end, stop);
  if (end <= r.start || endEff <= r.start) return [0, 0];
  const a = Math.max(r.start, lo);
  const b = Math.min(endEff, hi);
  if (b <= a) return [0, 0];
  return [(b - a) / (endEff - r.start), (b - a) / (end - r.start)];
}

/** Sum raw totals (time share) and recompute A, P, Q, OEE from the sums. */
export function aggregateShifts(rows: ShiftRow[], lo: number, hi: number, now: number, nominalTpm: number): ShiftAggregate {
  let good = 0, reject = 0, total = 0, run = 0, planned = 0, target = 0, stopCount = 0;
  let goalSum = 0, goalW = 0, n = 0;
  let haveCounts = false, rejectKnown = false, rejectMissing = false, targetKnown = false, plannedKnown = false;
  const teams: string[] = [];
  for (const r of rows) {
    const [a, p] = shiftShares(r, lo, hi, now);
    if (a <= 0) continue;
    n++;
    if (r.team && !teams.includes(r.team)) teams.push(r.team);
    if (r.good !== null) {
      haveCounts = true;
      good += r.good * a;
      total += (r.total ?? r.good) * a;
      if (r.reject === null) rejectMissing = true;
      else {
        rejectKnown = true;
        reject += r.reject * a;
      }
    }
    const runS = r.runS ?? 0;
    run += runS * a;
    stopCount += (r.stopCount ?? 0) * a;
    if (r.plannedS !== null && (runS > 0 || r.plannedSource === "PlannedTime")) {
      const part = r.plannedS * p;
      planned += part;
      plannedKnown = true;
      const goal = r.oeeTarget !== null && r.oeeTarget > 0 && r.oeeTarget <= 100 ? r.oeeTarget : DEFAULT_OEE_TARGET_PCT;
      goalSum += goal * part;
      goalW += part;
    }
    if (r.target !== null) {
      target += r.target * p;
      targetKnown = true;
    }
  }
  const qKnown = haveCounts && rejectKnown && !rejectMissing;
  const rateS = nominalTpm / 60;
  const availability = planned > 0 ? Math.min(1, run / planned) : null;
  const performance = haveCounts && run > 0 && rateS > 0 ? Math.min(1, total / (run * rateS)) : null;
  const quality = qKnown && total > 0 ? good / total : null;
  const oee = qKnown && planned > 0 && rateS > 0 && performance !== null ? Math.min(1, good / (planned * rateS)) : null;
  return {
    shifts: n,
    has_data: n > 0,
    good: haveCounts ? Math.round(good) : null,
    reject: haveCounts && qKnown ? Math.round(reject) : null,
    total: haveCounts ? Math.round(total) : null,
    planned_s: n ? planned : null,
    run_s: n ? run : null,
    stop_s: n && plannedKnown ? Math.max(0, planned - run) : null,
    stop_count: n ? Math.round(stopCount) : null,
    target: targetKnown ? Math.round(target) : null,
    oee_target: goalW > 0 ? goalSum / goalW : null,
    teams,
    oee: { availability, performance, quality, oee },
  };
}
