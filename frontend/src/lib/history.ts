// Simulated history for the demo (no backend) and the editor preview: a shift log like the backend's
// `shifts` table, and the chart aggregates built from it with the same aggregation as the backend
// (lib/shifts.ts mirrors backend/opc/shifts.py). The live dashboard gets Aggregates from the backend
// (GET /api/aggregates); nothing here runs there. Formulas: docs/BERAKNINGAR.md.
import type { Aggregates, DailyRow, OeeDetails, PeriodSum, ShiftAggregate as ShiftAgg } from "@/data/types";
import { aggregateShifts, type ShiftAggregate, type ShiftRow } from "./shifts";

export const DAY_MS = 86_400_000;
const pad = (n: number) => String(n).padStart(2, "0");
export const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Deterministic 0..1 pseudo-random per (key, salt), so simulated past days stay stable across reloads. */
export function seeded(key: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const TEAMS = ["A", "B", "C"];
const SLOT_HOURS = [6, 14, 22];
const SLOT_PLANNED_MIN = 450;

/** Team of the shift slot at `ms`: A/B/C rotating weekly */
export function teamFor(ms: number) {
  const d = new Date(ms);
  const week = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY_MS + 3) / 7);
  const h = d.getHours();
  const slot = h >= 22 ? 2 : h >= 14 ? 1 : h >= 6 ? 0 : 2;
  return TEAMS[(slot + week) % 3];
}

/**
 * Simulated shift log for the past `days` days: Mon-Fri three 8 h shifts 06/14/22 (team A/B/C,
 * rotating weekly), Saturday 06 and 14, Sunday no production. PlannedTime 450 min (30 min break),
 * OEE ~80-88 %. Slots from `currentStart` on are left out (the current shift is `current`, the live
 * simulation); earlier slots that overlap it are cut at its start.
 */
export function simulatedShiftLog(nowMs: number, currentStart: number, current: ShiftRow | null, nominalTpm: number, oeeGoal: number, days = 31): ShiftRow[] {
  const rows: ShiftRow[] = [];
  const today = new Date(nowMs);
  for (let i = days; i >= 0; i--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    const weekday = (day.getDay() + 6) % 7;
    if (weekday === 6) continue;
    for (const [slot, hour] of SLOT_HOURS.entries()) {
      if (weekday === 5 && slot === 2) continue;
      const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour).getTime();
      const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour + 8).getTime();
      if (start >= currentStart) continue;
      const cut = Math.min(end, currentStart);
      const frac = (cut - start) / (end - start);
      const key = `${isoDate(day)}-${hour}`;
      const plannedS = SLOT_PLANNED_MIN * 60 * frac;
      const a = (weekday === 5 ? 0.82 : 0.87) + seeded(key, 1) * 0.07;
      const p = 0.93 + seeded(key, 2) * 0.05;
      const q = 0.975 + seeded(key, 3) * 0.01;
      const runS = plannedS * a;
      const total = Math.round((runS / 60) * nominalTpm * p);
      const good = Math.round(total * q);
      rows.push({
        start, end: cut, closed: cut, team: teamFor(start), oeeTarget: oeeGoal * 100,
        target: Math.round(SLOT_PLANNED_MIN * nominalTpm * oeeGoal * frac),
        plannedS, plannedSource: "PlannedTime", good, reject: total - good, total, runS,
        stopS: plannedS - runS, stopCount: Math.round(3 + seeded(key, 4) * 6),
      });
    }
  }
  if (current) rows.push(current);
  return rows;
}

const scrap = (r: { reject: number | null; total: number | null }) =>
  r.reject !== null && r.total ? (r.reject / r.total) * 100 : null;

/** Day rows (midnight to midnight, local time) of the last `n` days, today last, like backend/opc/daily.py */
export function dayRows(rows: ShiftRow[], nowMs: number, nominalTpm: number, n: number): (DailyRow & { scrap_pct: number | null })[] {
  const now = new Date(nowMs);
  const out: (DailyRow & { scrap_pct: number | null })[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const agg = aggregateShifts(rows, d.getTime(), next.getTime(), nowMs, nominalTpm);
    out.push({
      date: isoDate(d), weekday: (d.getDay() + 6) % 7, start: d.toISOString(), end: next.toISOString(),
      today: i === 0, source: "shifts", good_source: "GoodCount", ...agg, scrap_pct: scrap(agg),
    });
  }
  return out;
}

const periodSum = (a: ShiftAggregate, days: number): PeriodSum => ({ ...a, days, scrap_pct: scrap(a) });

/**
 * The chart aggregates (same shape as GET /api/aggregates) from a shift log. Period sums aggregate the
 * shift rows over the whole period at once, which is what the backend's sum of shift-log days gives.
 */
export function buildAggregates(
  rows: ShiftRow[],
  nowMs: number,
  nominalTpm: number,
  oeeTargetPct: number,
  extra: { window?: { start: number; end: number } | null; segments?: { start: number; end: number; running: boolean }[]; connection?: string | null } = {},
): Aggregates {
  const days = dayRows(rows, nowMs, nominalTpm, 30);
  const now = new Date(nowMs);
  const sums = {} as Aggregates["sums"];
  for (const n of [7, 14, 30] as const) {
    const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (n - 1)).getTime();
    sums[String(n) as "7"] = periodSum(aggregateShifts(rows, from, nowMs + 1, nowMs, nominalTpm), days.slice(-n).filter((d) => d.has_data).length);
  }
  const shifts: ShiftAgg[] = rows.slice(-14).map((r, i) => {
    const a = aggregateShifts([r], r.start, Math.max(r.end, r.closed ?? nowMs, nowMs) + 1000, nowMs, nominalTpm);
    return {
      id: i + 1, start: new Date(r.start).toISOString(), end: new Date(r.end).toISOString(),
      closed: r.closed === null ? null : new Date(r.closed).toISOString(), status: r.closed === null ? "open" : "closed",
      team: r.team, has_data: a.has_data, good: a.good, reject: a.reject, total: a.total, planned_s: a.planned_s,
      run_s: a.run_s, stop_s: a.stop_s, stop_count: a.stop_count, target: a.target, oee_target: a.oee_target,
      scrap_pct: scrap(a), oee: a.oee,
    };
  });
  const iso = (ms: number) => new Date(ms).toISOString();
  return {
    connection: extra.connection ?? null,
    updated: iso(nowMs),
    nominal_tpm: nominalTpm,
    oee_target: { value: oeeTargetPct, source: "default" },
    today: days[days.length - 1] ?? null,
    yesterday: days[days.length - 2] ?? null,
    days,
    sums,
    shifts,
    current_shift: [...shifts].reverse().find((s) => s.status === "open") ?? null,
    shift_window: extra.window ? { start: iso(extra.window.start), end: iso(extra.window.end) } : null,
    segments: (extra.segments ?? []).map((s) => ({ start: iso(s.start), end: iso(s.end), running: s.running })),
  };
}

/** Widest values for the fit check and the editor's legibility check: 6-digit counts, 100,0 %, 3-digit stops */
export function worstAggregates(a: Aggregates, n = 999_999): Aggregates {
  const factors = { availability: 1, performance: 1, quality: 1, oee: 1 };
  const row = <T extends { has_data: boolean }>(r: T): T =>
    r.has_data ? { ...r, good: n, reject: n, total: n, target: n, stop_count: 999, stop_s: 359_940, run_s: 359_940, scrap_pct: 100, oee: factors } : r;
  const sums = Object.fromEntries(Object.entries(a.sums).map(([k, v]) => [k, row(v)])) as Aggregates["sums"];
  return {
    ...a,
    today: a.today && row(a.today),
    yesterday: a.yesterday && row(a.yesterday),
    days: a.days.map(row),
    sums,
    shifts: a.shifts.map(row),
    current_shift: a.current_shift && row(a.current_shift),
  };
}

/** Widest OEE details (like the demo's ?count=999999&stopped=1) */
export function worstDetails(d: OeeDetails, n = 999_999): OeeDetails {
  return {
    ...d,
    counts: { ...d.counts, good: n, reject: n, total: n, scrap_pct: 100 },
    speed: { ...d.speed, current: 999.9, nominal: 999 },
    target: { so_far: n, shift: n, source: "ShiftTarget", prognosis: n, progress_pct: 100 },
    stops: d.stops && { ...d.stops, count: 999, total_s: 359_940, running: false },
    shift: d.shift && { ...d.shift, remaining_s: 86_340 },
    oee: { availability: 1, performance: 1, quality: 1, oee: 1 },
  };
}

/**
 * Deterministic sample data for the editor preview (the editor never reads the PLC): a shift that
 * started 6 h ago on a whole hour (10 h long), OEE ~84 %, one stop running now and then.
 */
export function sampleChartData(nowMs: number, nominalTpm = 140, oeeGoal = 0.85): { details: OeeDetails; aggregates: Aggregates } {
  const startD = new Date(nowMs);
  startD.setMinutes(0, 0, 0);
  startD.setHours(startD.getHours() - 6);
  const start = startD.getTime();
  const shiftS = 10 * 3600;
  const elapsed = Math.round((nowMs - start) / 1000);
  const segments: { start: number; end: number; running: boolean }[] = [];
  let t = start;
  let runS = 0;
  let stops = 0;
  for (let k = 0; t < nowMs; k++) {
    const run = (35 + seeded(`run${k}`, 7) * 50) * 60_000;
    const stop = (2 + seeded(`stop${k}`, 8) * 10) * 60_000;
    const runEnd = Math.min(nowMs, t + run);
    segments.push({ start: t, end: runEnd, running: true });
    runS += (runEnd - t) / 1000;
    t = runEnd;
    if (t >= nowMs) break;
    const stopEnd = Math.min(nowMs, t + stop);
    segments.push({ start: t, end: stopEnd, running: false });
    stops++;
    t = stopEnd;
  }
  const total = Math.round((runS / 60) * nominalTpm * 0.955);
  const good = Math.round(total * 0.98);
  const reject = total - good;
  const target = Math.round(10 * 60 * nominalTpm * oeeGoal);
  const availability = runS / elapsed;
  const performance = total / ((runS / 60) * nominalTpm);
  const quality = good / total;
  const running = segments[segments.length - 1]?.running ?? true;
  const details: OeeDetails = {
    nominal_tpm: nominalTpm,
    oee_target: { value: oeeGoal * 100, source: "default" },
    counts: { good, reject, total, scrap_pct: (reject / total) * 100, good_source: "GoodCount" },
    speed: { current: running ? 133.4 : 0, nominal: nominalTpm, pct: running ? 95.3 : 0 },
    shift: {
      start: new Date(start).toISOString(), end: new Date(start + shiftS * 1000).toISOString(), duration_s: shiftS,
      elapsed_s: elapsed, remaining_s: shiftS - elapsed, planned_s: elapsed, planned_shift_s: shiftS, planned_source: "schedule", team: teamFor(start),
    },
    target: { so_far: Math.round((target * elapsed) / shiftS), shift: target, source: "ShiftTarget", prognosis: Math.round((good / elapsed) * shiftS), progress_pct: (good / target) * 100 },
    stops: { count: stops, total_s: elapsed - runS, longest_s: 600, run_s: runS, mtbf_s: null, mttr_s: null, running },
    oee: { availability, performance, quality, oee: availability * performance * quality },
    hourly: [],
  };
  const current: ShiftRow = {
    start, end: start + shiftS * 1000, closed: null, team: teamFor(start), target, oeeTarget: oeeGoal * 100, plannedS: shiftS,
    plannedSource: "schedule", good, reject, total, runS, stopS: elapsed - runS, stopCount: stops,
  };
  const rows = simulatedShiftLog(nowMs, start, current, nominalTpm, oeeGoal);
  const aggregates = buildAggregates(rows, nowMs, nominalTpm, oeeGoal * 100, { window: { start, end: start + shiftS * 1000 }, segments });
  return { details, aggregates };
}
