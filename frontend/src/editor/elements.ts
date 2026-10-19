/**
 * Element catalogue: which properties each element has. The props panel is generated from this (a new
 * element type needs no new panel code). Limits as in docs/CONFIG.md (Objekt, Diagram och KPI); the
 * chart fields per kind come from backend/chart_catalog.json, the same list the backend validates.
 */
import { COLUMNS, KINDS, METRICS, PERIODS, SERIES, isChartKind, type ChartKind, type Series } from "@/charts/metrics";
import type { ValueKind, Widget } from "./ops";

export type FieldType = "text" | "tag" | "int" | "number" | "target" | "bool" | "color" | "thresholds" | "better" | "states" | "select" | "columns";

export interface Option {
  value: string;
  label: string;
}

export interface Field {
  key: string;
  type: FieldType;
  label: string;
  help?: string;
  max?: number;
  min?: number;
  required?: boolean;
  placeholder?: string;
  /** select: the choices; "" = not set (the default) */
  options?: (w: Widget) => Option[];
  /** shown only when this holds (e.g. the tag only for source: tag) */
  when?: (w: Widget) => boolean;
  /** bool fields that are on by default */
  defaultOn?: boolean;
}

const label: Field = { key: "label", type: "text", label: "Etikett", max: 20, required: true, help: "Visas med versaler, högst 20 tecken" };
const tag: Field = { key: "tag", type: "tag", label: "Tagg", required: true };
const unit: Field = { key: "unit", type: "text", label: "Enhet", max: 6, help: "Högst 6 tecken, med mål/trend helst ≤ 4", placeholder: "st, TPM, °C" };
const decimals: Field = { key: "decimals", type: "int", label: "Decimaler", min: 0, max: 3, placeholder: "auto" };
const target: Field = { key: "target", type: "target", label: "Mål", help: "En tagg eller ett fast tal; visar Mål och stapel" };
const trend: Field = { key: "trend", type: "bool", label: "Visa senaste förändringen (trend)" };
const color: Field = { key: "color", type: "color", label: "Fast färg", help: "Gränser går före fast färg" };
const thresholds: Field = { key: "thresholds", type: "thresholds", label: "Gränser [varning, bra]" };
const better: Field = { key: "better", type: "better", label: "Bättre är" };
const states: Field = { key: "states", type: "states", label: "Tillstånd (PLC-värde → text och färg)" };

export const ELEMENT_FIELDS: Record<ValueKind, Field[]> = {
  number: [label, tag, unit, decimals, target, trend, thresholds, better, color],
  percent: [label, tag, decimals, target, trend, thresholds, better, color],
  counter: [label, tag, unit, target, trend, thresholds, better, color],
  time: [label, tag, color],
  status: [label, tag, states],
};

export const COLORS: [string, string][] = [
  ["white", "Vit"],
  ["green", "Grön"],
  ["amber", "Gul"],
  ["red", "Röd"],
  ["grey", "Grå"],
];

// ------------------------------------------------------------------ chart and KPI elements

const isTag = (w: Widget) => w.source === "tag";
/** Metrics a chart can show: per period (shift-only ones only for the current shift), per row for series */
function metricOptions(w: Widget, opts: { none?: string; series?: boolean } = {}): Option[] {
  const period = (w.period as string | undefined) ?? "shift";
  const out: Option[] = opts.none ? [{ value: opts.none === "none" ? "none" : "", label: "Inget" }] : [];
  for (const [k, m] of Object.entries(METRICS)) {
    const shiftOnly = m.periods?.length === 1 && m.periods[0] === "shift";
    if (opts.series ? shiftOnly : shiftOnly && period !== "shift") continue;
    out.push({ value: k, label: m.unit ? `${m.name} (${m.unit})` : m.name });
  }
  return out;
}

const CHART_FIELD: Record<string, Field> = {
  label: { key: "label", type: "text", label: "Rubrik", max: 40, help: "Högst 40 tecken; tom = standard" },
  source: {
    key: "source",
    type: "select",
    label: "Datakälla",
    options: () => [
      { value: "", label: "Beräknat (backend, standard-PLC)" },
      { value: "tag", label: "Live-tagg" },
    ],
  },
  metric: {
    key: "metric",
    type: "select",
    label: "Värde",
    required: true,
    when: (w) => !isTag(w),
    options: (w) => metricOptions(w, { series: w.kind === "trend" || w.kind === "bars" }),
  },
  period: {
    key: "period",
    type: "select",
    label: "Period",
    when: (w) => !isTag(w),
    options: () => Object.entries(PERIODS).map(([k, n], i) => ({ value: i === 0 ? "" : k, label: n })),
  },
  series: {
    key: "series",
    type: "select",
    label: "Serie",
    when: (w) => !isTag(w),
    options: (w) => (KINDS[w.kind as ChartKind].series ?? (Object.keys(SERIES) as Series[])).map((k, i) => ({ value: i === 0 ? "" : k, label: SERIES[k] })),
  },
  count: { key: "count", type: "int", label: "Antal", min: 1, max: 30, placeholder: "7", when: (w) => !isTag(w), help: "Dagar högst 30, skift högst 14" },
  tag: { key: "tag", type: "tag", label: "Tagg", required: true, when: isTag },
  unit: { key: "unit", type: "text", label: "Enhet", max: 6, placeholder: "st, %, °C", when: isTag },
  decimals: { key: "decimals", type: "int", label: "Decimaler", min: 0, max: 3, placeholder: "1", when: isTag },
  target: { key: "target", type: "target", label: "Mål", help: "Tagg eller fast tal, i värdets enhet (85 = 85 %)", when: (w) => !w.target_metric },
  target_metric: {
    key: "target_metric",
    type: "select",
    label: "Mål (beräknat)",
    when: (w) => w.target === undefined,
    options: () => [
      { value: "", label: "Inget" },
      { value: "oee_target", label: "OEE-mål" },
      { value: "target", label: "Mål hittills (st)" },
      { value: "shift_target", label: "Skiftmål (st)" },
    ],
  },
  thresholds,
  better,
  color,
  sub_metric: { key: "sub_metric", type: "select", label: "Rad under värdet", options: (w) => metricOptions(w, { none: "" }) },
  sub_text: { key: "sub_text", type: "text", label: "Text på raden", max: 20, placeholder: "av / {} totalt", when: (w) => !!w.sub_metric },
  aside: {
    key: "aside",
    type: "select",
    label: "I rubrikraden",
    options: () => [
      { value: "", label: "Inget" },
      { value: "target", label: "PÅ MÅL / UNDER MÅL" },
      { value: "stopped", label: "STÅR när linjen står" },
    ],
  },
  max: { key: "max", type: "number", label: "Skalans max", placeholder: "100 för %", help: "Krävs för värden som inte är procent" },
  stats: { key: "stats", type: "bool", label: "Visa Mål hittills, Skiftmål, Prognos", defaultOn: true },
  top_metric: { key: "top_metric", type: "select", label: "Värde ovanför stapeln", options: (w) => [{ value: "", label: "OEE (standard)" }, ...metricOptions(w, { none: "none", series: true }).filter((o) => o.value !== "oee")] },
  columns: { key: "columns", type: "columns", label: "Kolumner (1–5)", options: () => COLUMNS.map((c) => ({ value: c, label: c === "label" ? "Dag/skift" : (METRICS[c]?.name ?? c) })) },
};

/** bars: the bar height is `metric` (default good) */
const BARS_METRIC: Field = { ...CHART_FIELD.metric, label: "Stapelns höjd", required: false, options: (w) => [{ value: "", label: "Godkända (standard)" }, ...metricOptions(w, { series: true }).filter((o) => o.value !== "good")] };

export function chartFields(kind: ChartKind): Field[] {
  return KINDS[kind].fields.map((f) => (kind === "bars" && f === "metric" ? BARS_METRIC : CHART_FIELD[f])).filter(Boolean);
}

/** The props panel's fields for any element kind */
export function fieldsFor(kind: string): Field[] {
  if (isChartKind(kind)) return chartFields(kind);
  return ELEMENT_FIELDS[kind as ValueKind] ?? [];
}

