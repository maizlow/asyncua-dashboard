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
  DataSource,
  MetricValue,
  OeeDetails,
  ServerMessage,
  ShiftPatternRow,
} from "./types";

const TICK_MS = 1000;
const SNAPSHOT_EVERY_MS = 10_000;
const SHIFT_PATTERN_EVERY_MS = 30_000;
const OEE_EVERY_MS = 2_000;
const SCREEN_CYCLE_MS = 15_000;
/** Dashboard -> OEE -> Shift pattern -> Alarms */
const SCREEN_ORDER = [2, 4, 3, 1];
const HISTORY_POINTS = 150;

const NOMINAL_TPM = 140;
const SHIFT_HOURS = 10;
const SHIFT_S = SHIFT_HOURS * 3600;
/** PLC-side shift target (planned at 85 % OEE), used by the existing Dashboard card */
const PLC_TARGET = Math.round(SHIFT_HOURS * 60 * NOMINAL_TPM * 0.85);
const SCRAP_RATE = 0.02;
const STOP_PROB_PER_S = 1 / 2400; // ~ one stop every 40 min of running
const MIN_RUN_BETWEEN_STOPS_S = 180;
const PREFILL_OEE_RANGE: [number, number] = [0.8, 0.85];

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
    const quality = total > 0 ? good / total : null;
    const oee =
      availability !== null && performance !== null && quality !== null ? availability * performance * quality : null;
    const count = this.stops.length;
    const nowMs = this.startMs + this.elapsed * 1000;
    const soFar = Math.round((this.elapsed / 60) * NOMINAL_TPM);
    const shiftTarget = Math.round((SHIFT_S / 60) * NOMINAL_TPM);
    return {
      nominal_tpm: NOMINAL_TPM,
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
      running: round(h.running / 60, 1),
      stopped: round(h.stopped / 60, 1),
    }));
  }
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

  // Optional ?screen=N pins one screen (useful for screenshots); otherwise cycle
  const pinned = Number(new URLSearchParams(window.location.search).get("screen"));
  const pinnedScreen = SCREEN_ORDER.includes(pinned) ? pinned : null;
  let screenIndex = 0;
  const stressAlarms = new URLSearchParams(window.location.search).get("alarms") === "many";

  const alarms = new Map<string, Alarm>();
  const metrics: Record<string, MetricValue> = {};
  const histories: Record<string, MetricValue[]> = {};

  const emit = (msg: ServerMessage) => listeners.forEach((cb) => cb(msg));

  const setMetric = (key: string, value: MetricValue, historical = false) => {
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
    const d = sim.details();
    const expected = (PLC_TARGET * sim.elapsed) / SHIFT_S;
    setMetric("TargetCount", PLC_TARGET);
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
      emit({ type: "oee_details", data: sim.details() });
    }, 400);

    setInterval(tick, TICK_MS);
    setInterval(() => emit(snapshot()), SNAPSHOT_EVERY_MS);
    setInterval(() => emit({ type: "shift_pattern_data", data: sim.shiftPattern() }), SHIFT_PATTERN_EVERY_MS);
    setInterval(() => emit({ type: "oee_details", data: sim.details() }), OEE_EVERY_MS);
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
    getOeeDetails: async () => sim.details(),
    requestSnapshot: () => {
      setTimeout(() => emit(snapshot()), 0);
    },
  };
}
