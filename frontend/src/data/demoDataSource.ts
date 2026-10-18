/**
 * Demo data source (VITE_DEMO=true): simulates a production line entirely in the
 * browser so the dashboard can be published as a static site without backend or PLC.
 * Emits the same messages as the real backend (see ./types.ts).
 */
import type {
  Alarm,
  ConnectionStatus,
  DataSource,
  MetricValue,
  ServerMessage,
  ShiftPatternRow,
} from "./types";

const TICK_MS = 1000;
const SNAPSHOT_EVERY_MS = 10_000;
const SHIFT_PATTERN_EVERY_MS = 30_000;
const SCREEN_CYCLE_MS = 15_000;
const SCREEN_ORDER = [2, 3, 1]; // Dashboard -> Shift pattern -> Alarms
const HISTORY_POINTS = 150;

const SHIFT_START_HOUR = 6;
const SHIFT_HOURS = 12;
const SHIFT_TARGET = 5000;
/** How far into the shift the simulation starts, so the screens have data immediately. */
const INITIAL_SHIFT_ELAPSED_S = 7 * 3600 + 20 * 60;

const STOP_ALARMS: Omit<Alarm, "timestamp">[] = [
  { ID: 1012, message: "Emergency stop – station 3", displayClass: 1 },
  { ID: 1051, message: "Infeed conveyor jam", displayClass: 1 },
  { ID: 1077, message: "Safety door open – packer", displayClass: 1 },
  { ID: 1090, message: "Motor overload – sealer", displayClass: 1 },
];
const WARNING_ALARMS: Omit<Alarm, "timestamp">[] = [
  { ID: 2040, message: "Low glue level", displayClass: 2 },
  { ID: 2110, message: "Label roll nearly empty", displayClass: 2 },
  { ID: 2125, message: "Air pressure low", displayClass: 2 },
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

export function createDemoDataSource(): DataSource {
  const listeners = new Set<(msg: ServerMessage) => void>();
  const statusListeners = new Set<() => void>();
  let status: ConnectionStatus = "connecting";
  let started = false;

  // ---------------- simulated line state ----------------
  let elapsed = INITIAL_SHIFT_ELAPSED_S; // seconds into the shift
  let running = true;
  let stopRemaining = 0;
  let runtime = INITIAL_SHIFT_ELAPSED_S - 27 * 60 - 50;
  let stoptime = 27 * 60 + 50;
  let produced = 0;
  let tpm = 7.1;
  let oee = 86.4;
  let screenIndex = 0;
  const alarms = new Map<string, Alarm>();
  const metrics: Record<string, MetricValue> = {};
  const histories: Record<string, MetricValue[]> = {};
  // Seconds running/stopped per shift hour (index 0 = 06:00)
  let hourly: { running: number; stopped: number }[] = [];

  const expectedByNow = () => (SHIFT_TARGET * elapsed) / (SHIFT_HOURS * 3600);

  const initShift = (elapsedSeconds: number) => {
    elapsed = elapsedSeconds;
    hourly = Array.from({ length: SHIFT_HOURS }, () => ({ running: 0, stopped: 0 }));
    // Plausible history for the part of the shift that already "happened"
    let remaining = elapsedSeconds;
    for (let h = 0; h < SHIFT_HOURS && remaining > 0; h++) {
      const span = Math.min(3600, remaining);
      const stopShare = Math.random() < 0.3 ? rand(0.15, 0.4) : rand(0, 0.08);
      hourly[h] = { running: span * (1 - stopShare), stopped: span * stopShare };
      remaining -= span;
    }
    stoptime = hourly.reduce((acc, h) => acc + h.stopped, 0);
    runtime = elapsedSeconds - stoptime;
    produced = Math.round(expectedByNow() - rand(10, 60));
  };

  const emit = (msg: ServerMessage) => listeners.forEach((cb) => cb(msg));

  const setMetric = (key: string, value: MetricValue, historical = false) => {
    if (historical) {
      histories[key] = [...(histories[key] ?? []), value].slice(-HISTORY_POINTS);
    }
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

  const shiftPattern = (): ShiftPatternRow[] =>
    hourly.map((h, i) => ({
      time: `${pad((SHIFT_START_HOUR + i) % 24)}:00`,
      running: round(h.running / 60, 1),
      stopped: round(h.stopped / 60, 1),
    }));

  const publishMetrics = () => {
    setMetric("TargetCount", SHIFT_TARGET);
    setMetric("ProductionCount", Math.floor(produced));
    setMetric("ProductionDelta", Math.round(produced - expectedByNow()), true);
    setMetric("ProductionState", running ? 2 : 1);
    setMetric("OEE", round(oee), true);
    setMetric("TPM", round(tpm), true);
    setMetric("CurrentRuntime", hms(runtime));
    setMetric("AccumulatedStoptime", hms(stoptime));
    setMetric("ShiftStart", hms(SHIFT_START_HOUR * 3600));
    setMetric("ShiftEnd", hms(((SHIFT_START_HOUR + SHIFT_HOURS) % 24) * 3600));
  };

  const snapshot = (): ServerMessage => ({
    type: "full_snapshot",
    data: { ...metrics },
    histories: Object.fromEntries(Object.entries(histories).map(([k, v]) => [k, [...v]])),
  });

  const tick = () => {
    const dt = TICK_MS / 1000;
    elapsed += dt;
    if (elapsed >= SHIFT_HOURS * 3600) initShift(0); // start a new shift

    // Occasional unplanned stops, each tied to a class 1 alarm
    if (running && Math.random() < 1 / 90) {
      running = false;
      stopRemaining = rand(12, 35);
      addAlarm(pick(STOP_ALARMS));
    } else if (!running) {
      stopRemaining -= dt;
      if (stopRemaining <= 0) {
        running = true;
        STOP_ALARMS.forEach((a) => removeAlarm(a.ID));
      }
    }

    // Warnings come and go independently of the line state
    if (Math.random() < 1 / 25) {
      const active = WARNING_ALARMS.filter((a) => alarms.has(String(a.ID)));
      if (active.length > 0 && Math.random() < 0.55) removeAlarm(pick(active).ID);
      else addAlarm(pick(WARNING_ALARMS));
    }

    const hour = hourly[Math.min(SHIFT_HOURS - 1, Math.floor(elapsed / 3600))];
    if (running) {
      tpm = clamp(tpm + rand(-0.15, 0.15) + (7.1 - tpm) * 0.05, 5.8, 8.4);
      oee = clamp(oee + rand(-0.25, 0.3), 72, 94);
      produced += (tpm / 60) * dt; // TPM ≈ pieces per minute
      runtime += dt;
      hour.running += dt;
    } else {
      tpm = Math.max(0, tpm * 0.6 - 0.2);
      oee = clamp(oee - rand(0.05, 0.2), 72, 94);
      stoptime += dt;
      hour.stopped += dt;
    }

    publishMetrics();
  };

  const start = () => {
    if (started) return;
    started = true;
    initShift(INITIAL_SHIFT_ELAPSED_S);

    // Seed sparkline histories so the cards are populated immediately
    for (let i = 0; i < 60; i++) {
      tpm = clamp(tpm + rand(-0.2, 0.2), 5.8, 8.4);
      oee = clamp(oee + rand(-0.4, 0.4), 72, 94);
      histories.TPM = [...(histories.TPM ?? []), round(tpm)];
      histories.OEE = [...(histories.OEE ?? []), round(oee)];
      histories.ProductionDelta = [
        ...(histories.ProductionDelta ?? []),
        Math.round(produced - expectedByNow() + rand(-6, 6)),
      ];
    }
    publishMetrics();
    addAlarm(WARNING_ALARMS[0]);

    setTimeout(() => {
      status = "connected";
      statusListeners.forEach((cb) => cb());
      emit(snapshot());
      emit({ type: "shift_pattern_data", data: shiftPattern() });
    }, 400);

    setInterval(tick, TICK_MS);
    setInterval(() => emit(snapshot()), SNAPSHOT_EVERY_MS);
    setInterval(() => emit({ type: "shift_pattern_data", data: shiftPattern() }), SHIFT_PATTERN_EVERY_MS);
    setInterval(() => {
      screenIndex = (screenIndex + 1) % SCREEN_ORDER.length;
      emit({ type: "screen_change", screen: SCREEN_ORDER[screenIndex] });
    }, SCREEN_CYCLE_MS);
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
    getActiveScreen: async () => SCREEN_ORDER[screenIndex],
    getAlarms: async () => [...alarms.values()],
    getShiftPattern: async () => shiftPattern(),
    requestSnapshot: () => {
      setTimeout(() => emit(snapshot()), 0);
    },
  };
}
