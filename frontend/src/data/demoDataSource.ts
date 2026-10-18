/**
 * Demo data source (VITE_DEMO=true): simulates a roof tile (takpannor) line entirely in the
 * browser so the dashboard can be published as a static site without backend or PLC.
 * Emits the same messages as the real backend (see ./types.ts).
 *
 * Model: 10 h shift, nominal 140 tiles/min, speed ~125-140, occasional stops of 1-15 min,
 * ~2 % scrap. The shift window is placed around the current local time (started ~6 h ago)
 * so the header clock, elapsed and remaining time stay consistent; history for the elapsed
 * part is simulated at start-up and then continues live, second by second.
 */
import type {
  Alarm,
  ConnectionStatus,
  DailyHistory,
  DailyRow,
  DataSource,
  MetricValue,
  OeeDetails,
  ServerMessage,
  ShiftPatternRow,
} from "./types";
import { demoScreenOrder, normaliseLayout, type Layout } from "@/layout/layout";
// Built from the same dashboard.yaml as the real installation (vite.config.ts: dashboard-yaml plugin)
import dashboardYaml from "../../../dashboard.yaml";
// ?layout=stress: worst-case layout (long labels/units, 6-digit/negative values) for the fit check
import stressYaml from "../../../docs/examples/stress.yaml";

const TICK_MS = 1000;
const SNAPSHOT_EVERY_MS = 10_000;
const SHIFT_PATTERN_EVERY_MS = 30_000;
const OEE_EVERY_MS = 2_000;
const HISTORY_EVERY_MS = 30_000;
const SCREEN_CYCLE_MS = 15_000;
const HISTORY_POINTS = 150;

const NOMINAL_TPM = 140;
const SHIFT_HOURS = 10;
const SHIFT_S = SHIFT_HOURS * 3600;
/** PLC shift target (tags ShiftTarget and TargetCount): nominal x 85 % OEE goal = 119 tiles/min */
const DEMO_OEE_TARGET = 0.85;
const PLC_TARGET = Math.round(SHIFT_HOURS * 60 * NOMINAL_TPM * DEMO_OEE_TARGET);
const SCRAP_RATE = 0.02;
const STOP_PROB_PER_S = 1 / 2400; // ~ one stop every 40 min of running
const MIN_RUN_BETWEEN_STOPS_S = 180;
// Straddles the 85 % goal so the demo shows both PÅ MÅL and UNDER MÅL
const PREFILL_OEE_RANGE: [number, number] = [0.82, 0.88];

const STOP_ALARMS: Omit<Alarm, "timestamp">[] = [
  { ID: 1012, message: "Nödstopp – station 3", displayClass: 1 },
  { ID: 1051, message: "Stopp i inmatningen", displayClass: 1 },
  { ID: 1077, message: "Skyddsdörr öppen – pall", displayClass: 1 },
  { ID: 1090, message: "Överlast motor – press", displayClass: 1 },
];
const WARNING_ALARMS: Omit<Alarm, "timestamp">[] = [
  { ID: 2040, message: "Låg nivå glasyr", displayClass: 2 },
  { ID: 2110, message: "Formbyte snart", displayClass: 2 },
  { ID: 2125, message: "Lågt lufttryck", displayClass: 2 },
];

/** ?alarms=many: extra long-lived alarms with very long texts, to test that the alarm screen never overflows */
const STRESS_ALARMS: Omit<Alarm, "timestamp">[] = [
  { ID: 9001, message: "Nödstopp aktiverat vid station 7 – kontrollera skyddsgrind, ljusridå och återställ från huvudpanelen innan omstart", displayClass: 1 },
  { ID: 9002, message: "Hydraultryck under minimigräns i press 2 (kontrollera pump, filter och oljenivå)", displayClass: 1 },
  { ID: 9003, message: "Kommunikationsfel_mot_robotcell_3_ProfinetTimeout_ingen_respons_från_enheten", displayClass: 2 },
  { ID: 9004, message: "Temperatur i torkugn zon 4 över övre larmgräns", displayClass: 2 },
  { ID: 9005, message: "Pallmagasin tomt", displayClass: 2 },
  { ID: 9006, message: "Glasyrpump 1 överhettad – byt till reservpump", displayClass: 1 },
];

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const pick = <T,>(items: T[]) => items[Math.floor(Math.random() * items.length)];
const pad = (n: number) => String(n).padStart(2, "0");
const hms = (totalSeconds: number) => {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
};
const nowStamp = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${hms(
    d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds(),
  )}`;
};

interface HourBucket {
  running: number;
  stopped: number;
  good: number;
}

/** One simulated shift. Pure state + step(); no I/O. */
class LineSim {
  readonly startMs: number;
  elapsed = 0; // s since shift start
  running = true;
  stopRemaining = 0;
  runSinceStop = MIN_RUN_BETWEEN_STOPS_S;
  speed = 133;
  produced = 0; // total tiles (good + scrap)
  rejects = 0;
  runS = 0;
  stopS = 0;
  stops: number[] = []; // durations; the last one may be ongoing
  hours: HourBucket[] = Array.from({ length: SHIFT_HOURS }, () => ({ running: 0, stopped: 0, good: 0 }));
  /** Called when a stop starts / ends (for alarms) */
  onStop?: () => void;
  onStart?: () => void;

  constructor(startMs: number) {
    this.startMs = startMs;
  }

  get good() {
    return Math.floor(this.produced - this.rejects);
  }

  step(dt = 1) {
    const hour = this.hours[Math.min(SHIFT_HOURS - 1, Math.floor(this.elapsed / 3600))];
    if (this.running) {
      if (this.runSinceStop > MIN_RUN_BETWEEN_STOPS_S && Math.random() < STOP_PROB_PER_S * dt) {
        this.running = false;
        // 1-15 min, mostly short ones
        this.stopRemaining = 60 + 840 * Math.random() ** 2;
        this.stops.push(0);
        this.onStop?.();
      }
    } else if (this.stopRemaining <= 0) {
      this.running = true;
      this.runSinceStop = 0;
      this.onStart?.();
    }

    if (this.running) {
      this.speed = clamp(this.speed + rand(-1.2, 1.2) + (133 - this.speed) * 0.04, 125, 140);
      const made = (this.speed / 60) * dt;
      const goodBefore = this.good;
      this.produced += made;
      this.rejects += made * clamp(SCRAP_RATE + rand(-0.01, 0.01), 0, 0.05);
      hour.good += this.good - goodBefore;
      hour.running += dt;
      this.runS += dt;
      this.runSinceStop += dt;
    } else {
      this.speed = 0;
      this.stopRemaining -= dt;
      this.stops[this.stops.length - 1] += dt;
      hour.stopped += dt;
      this.stopS += dt;
    }
    this.elapsed += dt;
  }

  /** Same formulas as backend/opc/oee.py */
  details(): OeeDetails {
    const good = this.good;
    const reject = Math.floor(this.rejects);
    const total = good + reject;
    const planned = this.elapsed;
    const availability = planned > 0 ? Math.min(1, this.runS / planned) : null;
    const performance = this.runS > 0 ? Math.min(1, total / ((this.runS / 60) * NOMINAL_TPM)) : null;
    const quality = total > 0 ? good / total : null; // RejectCount is simulated, so Q is known
    const oee =
      availability !== null && performance !== null && quality !== null ? availability * performance * quality : null;
    const count = this.stops.length;
    const nowMs = this.startMs + this.elapsed * 1000;
    // Same as the backend: Skiftmål = PLC ShiftTarget, Mål hittills pro rata over the shift
    const shiftTarget = PLC_TARGET;
    const soFar = Math.round((PLC_TARGET * this.elapsed) / SHIFT_S);
    return {
      nominal_tpm: NOMINAL_TPM,
      oee_target: { value: DEMO_OEE_TARGET * 100, source: "default" },
      counts: { good, reject, total, scrap_pct: total ? (reject / total) * 100 : null, good_source: "GoodCount" },
      speed: { current: round(this.speed, 1), nominal: NOMINAL_TPM, pct: (this.speed / NOMINAL_TPM) * 100 },
      shift: {
        start: new Date(this.startMs).toISOString(),
        end: new Date(this.startMs + SHIFT_S * 1000).toISOString(),
        duration_s: SHIFT_S,
        elapsed_s: this.elapsed,
        remaining_s: SHIFT_S - this.elapsed,
      },
      target: {
        so_far: soFar,
        shift: shiftTarget,
        source: "ShiftTarget",
        prognosis: this.elapsed >= 300 ? Math.round((good / this.elapsed) * SHIFT_S) : null,
        progress_pct: (good / shiftTarget) * 100,
      },
      stops: {
        count,
        total_s: this.stopS,
        longest_s: count ? Math.max(...this.stops) : 0,
        run_s: this.runS,
        mtbf_s: count ? this.runS / count : null,
        mttr_s: count ? this.stopS / count : null,
        running: this.running,
      },
      oee: { availability, performance, quality, oee },
      hourly: this.hours.map((h, i) => ({
        time: this.hourLabel(i),
        good: this.startMs + i * 3600_000 > nowMs ? null : Math.round(h.good),
        elapsed_s: clamp(this.elapsed - i * 3600, 0, 3600),
      })),
    };
  }

  hourLabel(i: number) {
    return `${pad(new Date(this.startMs + i * 3600_000).getHours())}:00`;
  }

  shiftPattern(): ShiftPatternRow[] {
    return this.hours.map((h, i) => ({
      time: this.hourLabel(i),
      end: this.hourLabel(i + 1),
      minutes: 60,
      running: round(h.running / 60, 1),
      stopped: round(h.stopped / 60, 1),
    }));
  }
}

/** Deterministic 0..1 pseudo-random per (date, salt), so the simulated past days stay stable across reloads. */
function seeded(key: string, salt: number) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return ((h >>> 0) % 100000) / 100000;
}

const isoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/**
 * Simulated 7-day history (screen type: week), same shape as GET /api/history/days. Past days: one
 * 10 h shift at OEE 80-86 %; Saturday is a short low day (6 h, ~74 %), Sunday has no production ("–").
 * Today comes from the live simulation (good so far vs target so far).
 */
function demoWeek(sim: LineSim, countOverride: number | null): DailyHistory {
  const now = new Date();
  const days: DailyRow[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const key = isoDate(d);
    const weekday = (d.getDay() + 6) % 7;
    const base = { date: key, weekday, start: d.toISOString(), end: next.toISOString(), today: i === 0 };
    const empty: DailyRow = {
      ...base, has_data: false, good: null, reject: null, total: null, planned_s: null, run_s: null,
      stop_s: null, target: null, oee: { availability: null, performance: null, quality: null, oee: null },
    };
    let row: DailyRow;
    if (i === 0) {
      const t = sim.details();
      row = {
        ...base, has_data: true, good: t.counts.good, reject: t.counts.reject, total: t.counts.total,
        planned_s: sim.elapsed, run_s: sim.runS, stop_s: sim.stopS, target: t.target?.so_far ?? null, oee: t.oee,
      };
    } else if (weekday === 6) {
      row = empty; // Sunday: line not running, nothing logged
    } else {
      const hours = weekday === 5 ? 6 : SHIFT_HOURS;
      const planned = hours * 3600;
      const a = weekday === 5 ? 0.82 : 0.86 + seeded(key, 1) * 0.05;
      const p = 0.93 + seeded(key, 2) * 0.05;
      const q = 0.975 + seeded(key, 3) * 0.01;
      const total = Math.round((planned / 60) * a * p * NOMINAL_TPM);
      const good = Math.round(total * q);
      row = {
        ...base, has_data: true, good, reject: total - good, total, planned_s: planned, run_s: planned * a,
        stop_s: planned * (1 - a), target: Math.round((PLC_TARGET * planned) / SHIFT_S),
        oee: { availability: a, performance: p, quality: good / total, oee: (a * p * good) / total },
      };
    }
    // ?count=N: widest case for the fit check (6-digit counts and "100,0 %")
    if (countOverride !== null && row.has_data)
      row = { ...row, good: countOverride, target: countOverride, oee: { ...row.oee, oee: 1 } };
    days.push(row);
  }
  return {
    days, nominal_tpm: NOMINAL_TPM, oee_target: { value: DEMO_OEE_TARGET * 100, source: "default" },
    retention_days: 30, shift: null, updated: now.toISOString(),
  };
}

/** Shift that started ~6 h before now, on a whole local hour. */
function currentShiftStart(nowMs: number) {
  const d = new Date(nowMs);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() - 6);
  return d.getTime();
}

/** Simulate the already elapsed part of the shift; retry until OEE lands in a realistic band. */
function prefilledShift(nowMs: number, startMs = currentShiftStart(nowMs)): LineSim {
  const elapsed = Math.min(SHIFT_S - 60, Math.floor((nowMs - startMs) / 1000));
  let best: LineSim | null = null;
  for (let attempt = 0; attempt < 30; attempt++) {
    const sim = new LineSim(startMs);
    for (let i = 0; i < elapsed; i++) sim.step(1);
    const oee = sim.details().oee.oee ?? 0;
    if (oee >= PREFILL_OEE_RANGE[0] && oee <= PREFILL_OEE_RANGE[1]) return sim;
    const target = (PREFILL_OEE_RANGE[0] + PREFILL_OEE_RANGE[1]) / 2;
    if (!best || Math.abs(oee - target) < Math.abs((best.details().oee.oee ?? 0) - target)) best = sim;
  }
  return best!;
}

export function createDemoDataSource(): DataSource {
  const listeners = new Set<(msg: ServerMessage) => void>();
  const statusListeners = new Set<() => void>();
  let status: ConnectionStatus = "connecting";
  let started = false;
  let sim: LineSim;

  const params = new URLSearchParams(window.location.search);
  const layout: Layout = normaliseLayout(params.get("layout") === "stress" ? stressYaml : dashboardYaml);
  /** Own grid screens -> OEE -> Shift pattern -> Alarms */
  const SCREEN_ORDER = demoScreenOrder(layout);

  // Optional ?screen=N pins one screen (useful for screenshots); otherwise cycle
  const pinned = Number(params.get("screen"));
  const pinnedScreen = SCREEN_ORDER.includes(pinned) ? pinned : null;
  let screenIndex = 0;
  const stressAlarms = new URLSearchParams(window.location.search).get("alarms") === "many";
  // ?count=N: force every count field (production, good, targets, prognosis) to N, max 999999,
  // to test that 6-digit values fit without overflow
  const countParam = new URLSearchParams(window.location.search).get("count");
  const countOverride =
    countParam !== null && Number.isFinite(Number(countParam))
      ? Math.min(999_999, Math.max(0, Math.round(Number(countParam))))
      : null;

  // ?stopped=1: show the line as stopped with 3-digit stop count on the OEE screen (worst-case width)
  const forceStopped = new URLSearchParams(window.location.search).get("stopped") === "1";

  const details = (): OeeDetails => {
    let d = sim.details();
    if (countOverride !== null) {
      const n = countOverride;
      d = { ...d, counts: { ...d.counts, good: n }, target: { so_far: n, shift: n, source: "ShiftTarget", prognosis: n, progress_pct: 100 } };
    }
    if (forceStopped && d.stops) d = { ...d, stops: { ...d.stops, count: 999, running: false } };
    return d;
  };

  const alarms = new Map<string, Alarm>();
  const metrics: Record<string, MetricValue> = {};
  const histories: Record<string, MetricValue[]> = {};

  const emit = (msg: ServerMessage) => listeners.forEach((cb) => cb(msg));

  // Tags with a `demo:` value in the YAML override the built-in simulation
  const demoOverrides = new Set(Object.entries(layout.tags).filter(([, t]) => t.demo !== undefined).map(([k]) => k));
  const statusTags = new Map<string, number>();
  for (const s of layout.screens)
    for (const i of s.items)
      if (i.type === "status" && i.states && !statusTags.has(i.tag)) statusTags.set(i.tag, Number(Object.keys(i.states)[0]));
  const walk: Record<string, number> = {};

  const setMetric = (key: string, value: MetricValue, historical = false, fromLayout = false) => {
    if (!fromLayout && demoOverrides.has(key)) return;
    if (historical) histories[key] = [...(histories[key] ?? []), value].slice(-HISTORY_POINTS);
    if (metrics[key] === value) return;
    metrics[key] = value;
    emit({ type: "data_update", key, value });
  };

  const addAlarm = (template: Omit<Alarm, "timestamp">) => {
    const key = String(template.ID);
    if (alarms.has(key)) return;
    const alarm = { ...template, timestamp: nowStamp() };
    alarms.set(key, alarm);
    emit({ type: "alarm_added", alarm_id: alarm.ID, alarm });
  };

  const removeAlarm = (id: Alarm["ID"]) => {
    const key = String(id);
    const alarm = alarms.get(key);
    if (!alarm) return;
    alarms.delete(key);
    emit({ type: "alarm_removed", alarm_id: alarm.ID, alarm });
  };

  const wire = (s: LineSim) => {
    s.onStop = () => addAlarm(pick(STOP_ALARMS));
    s.onStart = () => STOP_ALARMS.forEach((a) => removeAlarm(a.ID));
  };

  const publishMetrics = (historical = true) => {
    const d = details();
    const expected = (PLC_TARGET * sim.elapsed) / SHIFT_S;
    setMetric("TargetCount", countOverride ?? PLC_TARGET);
    setMetric("ShiftTarget", countOverride ?? PLC_TARGET);
    setMetric("ProductionCount", d.counts.good ?? 0);
    setMetric("GoodCount", d.counts.good ?? 0);
    setMetric("RejectCount", d.counts.reject ?? 0);
    setMetric("ProductionDelta", Math.round((d.counts.good ?? 0) - expected), historical);
    setMetric("ProductionState", sim.running ? 2 : 1);
    setMetric("OEE", round((d.oee.oee ?? 0) * 100, 1), historical);
    setMetric("TPM", round(sim.speed, 1), historical);
    setMetric("CurrentRuntime", hms(sim.runS));
    setMetric("AccumulatedStoptime", hms(sim.stopS));
    setMetric("ShiftStart", hms(new Date(sim.startMs).getHours() * 3600));
    setMetric("ShiftEnd", hms(((new Date(sim.startMs).getHours() + SHIFT_HOURS) % 24) * 3600));
    publishLayoutTags(historical);
  };

  /** Simulated values for YAML tags the line model doesn't know (and `demo:` overrides). */
  const BUILT_IN = new Set(["TargetCount", "ShiftTarget", "OeeTarget", "ProductionCount", "GoodCount", "RejectCount", "ProductionDelta",
    "ProductionState", "OEE", "TPM", "CurrentRuntime", "AccumulatedStoptime", "ShiftStart", "ShiftEnd"]);
  const publishLayoutTags = (historical: boolean) => {
    for (const [name, tag] of Object.entries(layout.tags)) {
      const demo = tag.demo;
      if (typeof demo === "number") {
        setMetric(name, tag.type === "time" ? hms(demo) : demo, historical, true);
      } else if (Array.isArray(demo)) {
        // Random walk inside [min, max], starting at max (widest value) so the fit check sees it
        const [lo, hi] = demo;
        const prev = walk[name] ?? hi;
        const next = Math.min(hi, Math.max(lo, prev + (Math.random() - 0.5) * (hi - lo) * 0.04));
        walk[name] = next;
        setMetric(name, tag.type === "time" ? hms(next) : round(next, 1), historical, true);
      } else if (!BUILT_IN.has(name) && !tag.placeholder) {
        if (statusTags.has(name)) setMetric(name, statusTags.get(name)!, false, true);
        else if (tag.type === "time") setMetric(name, hms(sim.elapsed), false, true);
        else {
          const prev = walk[name] ?? 50;
          walk[name] = Math.min(100, Math.max(0, prev + (Math.random() - 0.5) * 4));
          setMetric(name, round(walk[name], 1), historical, true);
        }
      }
    }
  };

  const snapshot = (): ServerMessage => ({
    type: "full_snapshot",
    data: { ...metrics },
    histories: Object.fromEntries(Object.entries(histories).map(([k, v]) => [k, [...v]])),
  });

  const tick = () => {
    if (sim.elapsed >= SHIFT_S) {
      // Shift over: start the next one
      STOP_ALARMS.forEach((a) => removeAlarm(a.ID));
      sim = new LineSim(sim.startMs + SHIFT_S * 1000);
      wire(sim);
    }
    sim.step(TICK_MS / 1000);

    // Warnings come and go independently of the line state
    if (Math.random() < 1 / 40) {
      const active = WARNING_ALARMS.filter((a) => alarms.has(String(a.ID)));
      if (active.length > 0 && Math.random() < 0.55) removeAlarm(pick(active).ID);
      else if (active.length < 2) addAlarm(pick(WARNING_ALARMS));
    }
    publishMetrics();
  };

  const start = () => {
    if (started) return;
    started = true;
    sim = prefilledShift(Date.now());

    // Seed sparkline histories with plausible recent values
    const d0 = sim.details();
    for (let i = 0; i < 60; i++) {
      histories.TPM = [...(histories.TPM ?? []), round(rand(127, 139), 1)];
      histories.OEE = [...(histories.OEE ?? []), round((d0.oee.oee ?? 0.82) * 100 + rand(-0.6, 0.6), 1)];
      histories.ProductionDelta = [
        ...(histories.ProductionDelta ?? []),
        Math.round((d0.counts.good ?? 0) - (PLC_TARGET * sim.elapsed) / SHIFT_S + rand(-40, 40)),
      ];
    }
    wire(sim);
    if (!sim.running) addAlarm(pick(STOP_ALARMS));
    publishMetrics(false);
    addAlarm(WARNING_ALARMS[0]);
    if (stressAlarms) STRESS_ALARMS.forEach(addAlarm);

    setTimeout(() => {
      status = "connected";
      statusListeners.forEach((cb) => cb());
      emit(snapshot());
      emit({ type: "shift_pattern_data", data: sim.shiftPattern() });
      emit({ type: "oee_details", data: details() });
      emit({ type: "daily_history", data: demoWeek(sim, countOverride) });
    }, 400);

    setInterval(tick, TICK_MS);
    setInterval(() => emit(snapshot()), SNAPSHOT_EVERY_MS);
    setInterval(() => emit({ type: "shift_pattern_data", data: sim.shiftPattern() }), SHIFT_PATTERN_EVERY_MS);
    setInterval(() => emit({ type: "oee_details", data: details() }), OEE_EVERY_MS);
    setInterval(() => emit({ type: "daily_history", data: demoWeek(sim, countOverride) }), HISTORY_EVERY_MS);
    if (pinnedScreen === null) {
      setInterval(() => {
        screenIndex = (screenIndex + 1) % SCREEN_ORDER.length;
        emit({ type: "screen_change", screen: SCREEN_ORDER[screenIndex] });
      }, SCREEN_CYCLE_MS);
    }
  };

  return {
    subscribe(listener) {
      listeners.add(listener);
      start();
      return () => listeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      start();
      return () => statusListeners.delete(listener);
    },
    getStatus: () => status,
    getActiveScreen: async () => pinnedScreen ?? SCREEN_ORDER[screenIndex],
    getAlarms: async () => [...alarms.values()],
    getShiftPattern: async () => sim.shiftPattern(),
    getOeeDetails: async () => details(),
    getDailyHistory: async () => demoWeek(sim, countOverride),
    getLayout: async () => layout,
    requestSnapshot: () => {
      setTimeout(() => emit(snapshot()), 0);
    },
  };
}
