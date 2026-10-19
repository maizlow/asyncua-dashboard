/**
 * Chart/KPI elements: the shared catalogue (backend/chart_catalog.json, also used by the backend's
 * validation) and the pure value resolution. Every value comes from the backend's calculations:
 * - period "shift": the live OEE details (WS oee_details, backend/opc/oee.py);
 * - today / yesterday / 7d / 14d / 30d and the series per day or shift: the history aggregates
 *   (WS aggregates, backend/opc/aggregates.py);
 * - source "tag": a live tag (plc1.OEE).
 * Nothing is recomputed here: values are only picked, formatted (Swedish comma, fixed decimals) and
 * given a status colour. Calculated values and history are the display's default connection until
 * etapp 4 (multi-PLC history).
 */
import catalog from "../../../backend/chart_catalog.json";
import type { Aggregates, MetricValue, OeeDetails } from "@/data/types";
import { DASH, fmtClock, fmtDec1, fmtFixed, fmtHM, fmtInt, fmtMinutes, fmtPct } from "@/lib/format";
import { DEFAULT_OEE_TARGET_PCT, factorStatus, oeeStatus, productionOnTarget, scrapStatus, thresholdStatus, type Status } from "@/lib/status";

export const CHART_KINDS = Object.keys(catalog.kinds) as ChartKind[];
export type ChartKind = "kpi" | "gauge" | "breakdown" | "progress" | "bars" | "trend" | "timeline" | "table";
export type Period = "shift" | "today" | "yesterday" | "7d" | "14d" | "30d";
export type Series = "days" | "shifts";
export type Format = "pct" | "int" | "dec1" | "minutes" | "hm" | "clock";
export interface MetricSpec {
  name: string;
  format: Format;
  unit?: string;
  status?: "oee" | "factor" | "scrap" | "target";
  periods?: Period[];
}
export interface KindSpec {
  name: string;
  min: [number, number];
  default: [number, number];
  fields: string[];
  series?: Series[];
}

export const KINDS = catalog.kinds as unknown as Record<ChartKind, KindSpec>;
export const METRICS = catalog.metrics as unknown as Record<string, MetricSpec>;
export const PERIODS = catalog.periods as Record<Period, string>;
export const SERIES = catalog.series as Record<Series, string>;
export const COLUMNS = catalog.columns as string[];
export const MAX_COUNT = catalog.max_count as Record<Series, number>;

export const isChartKind = (k: unknown): k is ChartKind => typeof k === "string" && k in KINDS;
export const minSize = (kind: ChartKind): [number, number] => KINDS[kind].min;

/** The chart element's own fields (flat in the layout document, see docs/CONFIG.md) */
export interface ChartItem {
  id: string;
  kind: ChartKind;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  source?: "calc" | "tag";
  metric?: string;
  period?: Period;
  tag?: string;
  unit?: string;
  decimals?: number;
  target?: string | number;
  target_metric?: string;
  thresholds?: [number, number];
  better?: "high" | "low";
  color?: "white" | "green" | "amber" | "red" | "grey";
  sub_metric?: string;
  sub_text?: string;
  aside?: "target" | "stopped";
  max?: number;
  stats?: boolean;
  series?: Series;
  count?: number;
  top_metric?: string;
  columns?: string[];
}

/** Everything the elements read; GridScreen fills it from the stores (or the editor/audit from samples) */
export interface ChartData {
  metrics: Record<string, MetricValue>;
  connected: Record<string, boolean>;
  histories: Record<string, MetricValue[]>;
  details: OeeDetails | null;
  aggregates: Aggregates | null;
}

type Factors = { availability: number | null; performance: number | null; quality: number | null; oee: number | null };
/** A day, shift or period-sum row of the aggregates */
export interface AggRow {
  has_data: boolean;
  good: number | null;
  reject: number | null;
  total: number | null;
  scrap_pct?: number | null;
  target: number | null;
  stop_count?: number | null;
  stop_s: number | null;
  run_s: number | null;
  oee_target?: number | null;
  oee: Factors;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A metric of one aggregate row (day, shift, period sum), in native units (fractions, counts, seconds) */
export function rowMetric(row: AggRow | null | undefined, metric: string, agg?: Aggregates | null): number | null {
  if (!row || !row.has_data) return metric === "nominal" ? num(agg?.nominal_tpm) : null;
  switch (metric) {
    case "oee":
    case "availability":
    case "performance":
    case "quality":
      return num(row.oee[metric]);
    case "good":
    case "reject":
    case "total":
    case "target":
      return num(row[metric]);
    case "scrap_pct":
      return num(row.scrap_pct);
    case "stop_count":
      return num(row.stop_count);
    case "stop_time":
      return num(row.stop_s);
    case "run_time":
      return num(row.run_s);
    case "oee_target":
      return num(row.oee_target) ?? num(agg?.oee_target?.value) ?? DEFAULT_OEE_TARGET_PCT;
    case "nominal":
      return num(agg?.nominal_tpm);
    default:
      return null;
  }
}

/** A metric of the current shift from the live OEE details */
export function detailsMetric(d: OeeDetails | null, metric: string): number | null {
  if (!d) return null;
  switch (metric) {
    case "oee":
    case "availability":
    case "performance":
    case "quality":
      return num(d.oee[metric]);
    case "good":
    case "reject":
    case "total":
    case "scrap_pct":
      return num(d.counts[metric]);
    case "target":
      return num(d.target?.so_far);
    case "shift_target":
      return num(d.target?.shift);
    case "prognosis":
      return num(d.target?.prognosis);
    case "speed":
      return num(d.speed.current);
    case "nominal":
      return num(d.speed.nominal);
    case "stop_count":
      return num(d.stops?.count);
    case "stop_time":
      return num(d.stops?.total_s);
    case "run_time":
      return num(d.stops?.run_s);
    case "remaining":
      return num(d.shift?.remaining_s);
    case "oee_target":
      return num(d.oee_target?.value) ?? DEFAULT_OEE_TARGET_PCT;
    default:
      return null;
  }
}

/** The aggregate row of a period (today, yesterday, sums) */
export function periodRow(agg: Aggregates | null, period: Period): AggRow | null {
  if (!agg) return null;
  switch (period) {
    case "today":
      return agg.today;
    case "yesterday":
      return agg.yesterday;
    case "7d":
      return agg.sums["7"];
    case "14d":
      return agg.sums["14"];
    case "30d":
      return agg.sums["30"];
    default:
      return null;
  }
}

/** A calculated metric for a period, in native units */
export function calcMetric(data: ChartData, metric: string, period: Period = "shift"): number | null {
  return period === "shift" ? detailsMetric(data.details, metric) : rowMetric(periodRow(data.aggregates, period), metric, data.aggregates);
}

/** The value in the unit it is shown in (pct: 0..1 -> %) */
export const shown = (metric: string, v: number | null): number | null =>
  v === null ? null : METRICS[metric]?.format === "pct" ? v * 100 : v;

/** Decimals as displayed (status comparisons use the rounded value) */
export const metricDecimals = (metric: string): number => {
  const f = METRICS[metric]?.format;
  return f === "pct" || f === "dec1" ? 1 : 0;
};

/** Swedish formatting with fixed decimals: 82,0 / 999 999 / 1 h 05 min / 7:30 */
export function formatMetric(metric: string, v: number | null): string {
  switch (METRICS[metric]?.format) {
    case "pct":
      return fmtPct(v);
    case "int":
      return fmtInt(v);
    case "dec1":
      return fmtDec1(v);
    case "minutes":
      return fmtMinutes(v);
    case "hm":
      return fmtHM(v);
    default:
      return v === null ? DASH : fmtFixed(v, 1);
  }
}

/** Shift window "06:00–16:00" (metric shift_window) */
export function shiftWindowText(d: OeeDetails | null): string {
  return d?.shift ? `${fmtClock(d.shift.start)}–${fmtClock(d.shift.end)}` : DASH;
}

/** Value of a tag; `down` when its PLC is not connected */
export function tagValue(data: ChartData, ref: string | undefined): { value: number | null; down: boolean } {
  if (!ref) return { value: null, down: false };
  const i = ref.indexOf(".");
  const down = data.connected[i >= 0 ? ref.slice(0, i) : ""] === false;
  const raw = down ? undefined : data.metrics[ref];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return { value: Number.isFinite(n) ? n : null, down };
}

/** Target in the unit shown (OEE goal 85 = 85 %): target_metric, a tag or a fixed number */
export function resolveTarget(data: ChartData, item: Pick<ChartItem, "target" | "target_metric" | "period">): number | null {
  if (item.target_metric) return shown(item.target_metric, calcMetric(data, item.target_metric, item.period));
  if (typeof item.target === "number") return item.target;
  if (typeof item.target === "string") return tagValue(data, item.target).value;
  return null;
}

/**
 * Status of a value (native units) for colour and ▲/▼: the element's thresholds [lower, upper] on the
 * shown value if set, else the metric's own rule (OEE vs goal, factors 90/80, scrap 2/3, count vs target).
 */
export function metricStatus(
  metric: string | null,
  v: number | null,
  opts: { thresholds?: [number, number]; better?: "high" | "low"; target?: number | null; decimals?: number; oeeGoal?: number | null } = {},
): Status | null {
  if (v === null) return null;
  const s = metric ? shown(metric, v)! : v;
  const decimals = opts.decimals ?? (metric ? metricDecimals(metric) : 1);
  if (opts.thresholds) return thresholdStatus(s, opts.thresholds, opts.better ?? "high", decimals);
  const rule = metric ? METRICS[metric]?.status : undefined;
  const target = opts.target ?? null;
  switch (rule) {
    case "oee":
      return oeeStatus(v, target ?? opts.oeeGoal ?? DEFAULT_OEE_TARGET_PCT);
    case "factor":
      return factorStatus(v);
    case "scrap":
      return scrapStatus(v);
    case "target": {
      const ok = productionOnTarget(v, target);
      return ok === null ? null : ok ? "good" : "warn";
    }
    default:
      if (target === null) return null;
      return (opts.better === "low" ? Number(s.toFixed(decimals)) <= target : Number(s.toFixed(decimals)) >= target) ? "good" : "warn";
  }
}

/** "06–14" for whole hours, else "06:30–14:00" (local time) */
export function shortSpan(start: string | null, end: string | null): string {
  const a = fmtClock(start);
  const b = fmtClock(end);
  return a.endsWith(":00") && b.endsWith(":00") ? `${a.slice(0, 2)}–${b.slice(0, 2)}` : `${a}–${b}`;
}

/** Rows of a series (oldest first): the last `count` days or shifts of the aggregates */
export function seriesRows(agg: Aggregates | null, series: Series, count: number): (AggRow & { label: string; sub: string; current: boolean })[] {
  if (!agg) return [];
  if (series === "shifts")
    return agg.shifts.slice(-count).map((s) => ({
      ...s,
      label: s.team ? `Skift ${s.team}` : "Skift",
      sub: shortSpan(s.start, s.end),
      current: s.status === "open",
    }));
  return agg.days.slice(-count).map((d) => {
    const [y, m, day] = d.date.split("-").map(Number);
    const wd = (new Date(Date.UTC(y, m - 1, day)).getUTCDay() + 6) % 7;
    return { ...d, label: d.today ? "Idag" : ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"][wd], sub: `${day}/${m}`, current: d.today };
  });
}

export const DEFAULT_LABELS: Record<ChartKind, string> = {
  kpi: "KPI",
  gauge: "OEE",
  breakdown: "OEE",
  progress: "Produktion",
  bars: "7 dagar · OEE % · godkända st",
  trend: "OEE",
  timeline: "Kör / stopp",
  table: "Per skift",
};
