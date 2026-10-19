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
  Aggregates,
  Alarm,
  ConnectionStatus,
  DailyHistory,
  DailyRow,
  DataSource,
  Highscores,
  MetricValue,
  OeeDetails,
  ServerMessage,
  ShiftPatternRow,
} from "./types";
import { demoScreenOrder, normaliseLayout, type Layout } from "@/layout/layout";
import { displayViews } from "@/layout/doc";
import { demoKey, publishedDemoDoc } from "./demoStore";
import { aggregateShifts, type ShiftRow } from "@/lib/shifts";
import { buildAggregates, isoDate, simulatedShiftLog, teamFor, worstAggregates } from "@/lib/history";
// Built from the same dashboard.yaml as the real installation (vite.config.ts: dashboard-yaml plugin)
import dashboardYaml from "../../../dashboard.yaml";
// ?layout=stress: worst-case layout (long labels/units, 6-digit/negative values) for the fit check
import stressYaml from "../../../docs/examples/stress.yaml";
// ?layout=multi: two PLCs, two displays (?display=tv2 shows the packing line's own header text)
import multiYaml from "../../../docs/examples/flera-displayer.yaml";
// ?layout=oee-element / 7dagar-element / diagram: chart elements (the OEE and 7-day screens rebuilt, every element type)
import oeeElementYaml from "../../../docs/examples/oee-element.yaml";
import weekElementYaml from "../../../docs/examples/7dagar-element.yaml";
import diagramYaml from "../../../docs/examples/diagram.yaml";

const TICK_MS = 1000;
const SNAPSHOT_EVERY_MS = 10_000;
const SHIFT_PATTERN_EVERY_MS = 30_000;
const OEE_EVERY_MS = 2_000;
const HISTORY_EVERY_MS = 30_000;
const HIGHSCORE_EVERY_MS = 15_000;
const AGGREGATES_EVERY_MS = 10_000;
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
  /** Run/stop segments of the shift (from = s since shift start), for the run/stop timeline */
  segments: { from: number; running: boolean }[] = [{ from: 0, running: true }];
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
        this.segments.push({ from: this.elapsed, running: false });
        this.onStop?.();
      }
    } else if (this.stopRemaining <= 0) {
      this.running = true;
      this.runSinceStop = 0;
      this.segments.push({ from: this.elapsed, running: true });
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
        planned_s: planned,
        planned_shift_s: SHIFT_S,
        planned_source: "schedule",
        team: teamFor(this.startMs),
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

/** Simulated shift log (lib/history.ts) with the live simulation as the current, open shift. */
function demoShifts(sim: LineSim, nowMs: number): ShiftRow[] {
  const t = sim.details();
  const current: ShiftRow = {
    start: sim.startMs, end: sim.startMs + SHIFT_S * 1000, closed: null, team: teamFor(sim.startMs),
    target: PLC_TARGET, oeeTarget: DEMO_OEE_TARGET * 100, plannedS: SHIFT_S, plannedSource: "schedule",
    good: t.counts.good, reject: t.counts.reject, total: t.counts.total, runS: sim.runS, stopS: sim.stopS,
    stopCount: sim.stops.length,
  };
  return simulatedShiftLog(nowMs, sim.startMs, current, NOMINAL_TPM, DEMO_OEE_TARGET);
}

/** Chart aggregates (GET /api/aggregates) from the simulated shift log; ?count=N: widest values */
function demoAggregates(sim: LineSim, countOverride: number | null): Aggregates {
  const nowMs = sim.startMs + sim.elapsed * 1000;
  const agg = buildAggregates(demoShifts(sim, nowMs), nowMs, NOMINAL_TPM, DEMO_OEE_TARGET * 100, {
    window: { start: sim.startMs, end: sim.startMs + SHIFT_S * 1000 },
    segments: sim.segments.map((s, i, all) => ({
      start: sim.startMs + s.from * 1000,
      end: sim.startMs + (i + 1 < all.length ? all[i + 1].from : sim.elapsed) * 1000,
      running: s.running,
    })),
  });
  return countOverride !== null ? worstAggregates(agg, countOverride) : agg;
}

/** 7-day history (screen type: week) aggregated from the simulated shift log, like the backend. */
function demoWeek(sim: LineSim, countOverride: number | null): DailyHistory {
  const nowMs = sim.startMs + sim.elapsed * 1000;
  const now = new Date(nowMs);
  const shifts = demoShifts(sim, nowMs);
  const days: DailyRow[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
    const agg = aggregateShifts(shifts, d.getTime(), next.getTime(), nowMs, NOMINAL_TPM);
    let row: DailyRow = {
      date: isoDate(d), weekday: (d.getDay() + 6) % 7, start: d.toISOString(), end: next.toISOString(),
      today: i === 0, source: "shifts", good_source: "GoodCount", ...agg,
    };
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

/**
 * Simulated run-time highscores (screen type: highscore), same shape as GET /api/highscores: five
 * records over the last weeks (one of them set earlier in the current shift, so it is highlighted)
 * and the live simulation's ongoing run. ?count=N: 3-digit hours everywhere (widest case for the fit check).
 */
function demoHighscores(sim: LineSim, demoStartMs: number, countOverride: number | null): Highscores {
  const DAY = 86_400_000;
  const at = (daysAgo: number, h: number, m: number) => {
    const d = new Date(demoStartMs - daysAgo * DAY);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const base: [number, number, string][] = [
    [18_753, at(23, 7, 41), "B"],
    [17_230, at(9, 14, 22), "A"],
    [15_665, at(41, 22, 10), "C"],
    [14_322, sim.startMs + 20 * 60_000, teamFor(sim.startMs)], // set earlier in this shift
    [13_219, at(2, 6, 35), "A"],
  ];
  const records = base
    .map(([d, start, team]) => ({
      duration_s: countOverride !== null ? 1_999_998 : d,
      start: new Date(start).toISOString(),
      end: new Date(start + d * 1000).toISOString(),
      team: countOverride !== null ? "A→B" : team,
      current_shift: start >= sim.startMs,
    }))
    .sort((a, b) => b.duration_s - a.duration_s || a.start.localeCompare(b.start));
  const nowMs = sim.startMs + sim.elapsed * 1000;
  const runS = countOverride !== null ? 999_999 : sim.runSinceStop;
  return {
    records,
    current: sim.running || countOverride !== null
      ? { start: new Date(nowMs - sim.runSinceStop * 1000).toISOString(), duration_s: runS, team: teamFor(sim.startMs), running: true, current_shift: true }
      : null,
    shift_start: new Date(sim.startMs).toISOString(),
    min_stop_s: 0,
    updated: new Date(nowMs).toISOString(),
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
  // A version published in the demo editor (same browser) replaces the bundled example
  const stored = publishedDemoDoc(params.get("layout"));
  const views = (stored ? displayViews(stored) : null) ?? { stress: stressYaml, multi: multiYaml, "oee-element": oeeElementYaml, "7dagar-element": weekElementYaml, diagram: diagramYaml }[params.get("layout") ?? ""] ?? dashboardYaml;
  window.addEventListener("storage", (e) => {
    if (e.key === demoKey(params.get("layout"))) window.location.reload();
  });
  const layout: Layout = normaliseLayout(views[params.get("display") ?? ""] ?? Object.values(views)[0]);
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

  const demoStartMs = Date.now();
  let lastRunning = true;
  const scores = () => demoHighscores(sim, demoStartMs, countOverride);
  const aggregates = () => {
    const a = demoAggregates(sim, countOverride);
    return forceStopped && a.current_shift ? { ...a, current_shift: { ...a.current_shift, stop_count: 999 } } : a;
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

  // Keys are qualified (plc1.OEE). The simulated line feeds the same tag name on every PLC of the
  // display; ?down=plc2 simulates a PLC without connection (its elements show "–" and ⚠).
  const connIds = Object.keys(layout.connections).length ? Object.keys(layout.connections) : ["plc1"];
  const down = new Set((params.get("down") ?? "").split(",").filter(Boolean));
  const setQualified = (key: string, value: MetricValue, historical: boolean, fromLayout: boolean) => {
    if (down.has(key.slice(0, key.indexOf(".")))) return;
    if (!fromLayout && demoOverrides.has(key)) return;
    if (historical) histories[key] = [...(histories[key] ?? []), value].slice(-HISTORY_POINTS);
    if (metrics[key] === value) return;
    metrics[key] = value;
    emit({ type: "data_update", key, value });
  };
  /** A built-in simulation value by tag name: set on every PLC (or a qualified key as is) */
  const setMetric = (key: string, value: MetricValue, historical = false, fromLayout = false) => {
    if (key.includes(".")) return setQualified(key, value, historical, fromLayout);
    for (const c of connIds) setQualified(`${c}.${key}`, value, historical, fromLayout);
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
    setMetric("ShiftTeam", teamFor(sim.startMs));
    publishLayoutTags(historical);
  };

  /** Simulated values for YAML tags the line model doesn't know (and `demo:` overrides). */
  const BUILT_IN = new Set(["TargetCount", "ShiftTarget", "OeeTarget", "ProductionCount", "GoodCount", "RejectCount", "ProductionDelta",
    "ProductionState", "OEE", "TPM", "CurrentRuntime", "AccumulatedStoptime", "ShiftStart", "ShiftEnd", "ShiftTeam", "PlannedTime"]);
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
      } else if (!BUILT_IN.has(name.slice(name.indexOf(".") + 1)) && !tag.placeholder) {
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
    connected: Object.fromEntries(connIds.map((c) => [c, !down.has(c)])),
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
    if (sim.running !== lastRunning) {
      lastRunning = sim.running;
      emit({ type: "highscores", data: scores() });
    }
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
      emit({ type: "aggregates", data: aggregates() });
      emit({ type: "highscores", data: scores() });
    }, 400);

    setInterval(tick, TICK_MS);
    setInterval(() => emit(snapshot()), SNAPSHOT_EVERY_MS);
    setInterval(() => emit({ type: "shift_pattern_data", data: sim.shiftPattern() }), SHIFT_PATTERN_EVERY_MS);
    setInterval(() => emit({ type: "oee_details", data: details() }), OEE_EVERY_MS);
    setInterval(() => emit({ type: "daily_history", data: demoWeek(sim, countOverride) }), HISTORY_EVERY_MS);
    // The backend refreshes every HISTORY_INTERVAL_S (60 s); the demo more often so the timeline moves
    setInterval(() => emit({ type: "aggregates", data: aggregates() }), AGGREGATES_EVERY_MS);
    setInterval(() => emit({ type: "highscores", data: scores() }), HIGHSCORE_EVERY_MS);
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
    getHighscores: async () => scores(),
    getAggregates: async () => aggregates(),
    getLayout: async () => layout,
    requestSnapshot: () => {
      setTimeout(() => emit(snapshot()), 0);
    },
  };
}
