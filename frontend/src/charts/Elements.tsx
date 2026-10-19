// Chart and KPI elements for grid screens (kind kpi, gauge, breakdown, progress, bars, trend, timeline,
// table; docs/CONFIG.md "Diagram och KPI"). The built-in OEE and 7-day screens are composed of the same
// elements. Charts are custom SVG (shapes only) with every text in HTML, styled with the app's theme
// tokens: no chart library, so labels stay large (>= 104 px on the 3840x2160 canvas), nothing looks
// like a generic dashboard tool, and the legibility/fit checks see every label. Values: ./metrics.ts.
import type { ReactNode } from "react";
import { useFit } from "@/hooks/useFit";
import { COLOR_VAR } from "@/layout/layout";
import { DASH, fmtClock, fmtFixed, fmtInt, fmtMinutes, fmtPct } from "@/lib/format";
import { productionOnTarget } from "@/lib/status";
import { barPct, barScale, barStatus } from "@/lib/week";
import { useChartData } from "./context";
import {
  DEFAULT_LABELS,
  METRICS,
  calcMetric,
  formatMetric,
  metricStatus,
  periodRow,
  resolveTarget,
  rowMetric,
  seriesRows,
  shiftWindowText,
  shown,
  tagValue,
  type ChartData,
  type ChartItem,
} from "./metrics";
import { BigValue, Card, FactorRow, NoData, SubLine, TargetStatus, Title } from "./ui";
import { AMBER, GREEN, GRID_LINE, RED, TRACK, cue, statusColor, type Status } from "./colors";
import { useSize } from "./useSize";

const title = (item: ChartItem) => item.label ?? DEFAULT_LABELS[item.kind];

/** The element's main value: a calculated metric (period) or a live tag */
function mainValue(data: ChartData, item: ChartItem, fallbackMetric = "oee") {
  if (item.source === "tag") {
    const { value, down } = tagValue(data, item.tag);
    const decimals = item.decimals ?? 1;
    const target = resolveTarget(data, item);
    const status = down ? null : metricStatus(null, value, { thresholds: item.thresholds, better: item.better, target, decimals });
    return { metric: null, value, down, target, status, text: value === null ? DASH : fmtFixed(value, decimals), unit: item.unit, fraction: null as number | null };
  }
  const metric = item.metric ?? fallbackMetric;
  const value = calcMetric(data, metric, item.period);
  const target = resolveTarget(data, item);
  const oeeGoal = calcMetric(data, "oee_target", item.period);
  const status = metricStatus(metric, value, { thresholds: item.thresholds, better: item.better, target, oeeGoal });
  const unit = item.unit ?? METRICS[metric]?.unit;
  return { metric, value, down: false, target, status, text: formatMetric(metric, value), unit, fraction: METRICS[metric]?.format === "pct" ? value : null };
}

// ------------------------------------------------------------------ KPI tile

/** "PÅ MÅL"/"UNDER MÅL" in the title row needs room next to the title; narrower tiles show ▼ and colour only */
const KPI_BADGE_MIN_W = 10;

export function KpiElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const v = mainValue(data, item, "good");
  const stopped = item.aside === "stopped" && data.details?.stops?.running === false;
  let color: string | undefined = item.color ? COLOR_VAR[item.color] : undefined;
  if (v.status) color = statusColor(v.status);
  if (stopped) color = RED;
  if (v.down) color = AMBER;
  const aside =
    item.aside === "stopped"
      ? stopped ? <span style={{ color: RED }}>STÅR</span> : undefined
      : item.aside === "target" && item.w >= KPI_BADGE_MIN_W ? <TargetStatus ok={v.status === null ? null : v.status === "good"} /> : undefined;
  const big = item.h >= 6 && item.w >= 8;
  return (
    <Card title={title(item)} aside={aside}>
      <BigValue value={`${v.down ? "⚠ " : ""}${cue(v.status, item.better)}${v.text}`} unit={v.unit || undefined} color={color} px={big ? 290 : 220} />
      {item.sub_metric && <KpiSub item={item} data={data} />}
    </Card>
  );
}

function KpiSub({ item, data }: { item: ChartItem; data: ChartData }) {
  const m = item.sub_metric!;
  const spec = METRICS[m];
  let valueNode: ReactNode;
  let fitKey: string;
  if (m === "shift_window") {
    fitKey = shiftWindowText(data.details);
    valueNode = <span className="font-mono text-[1.08em]">{fitKey}</span>;
  } else {
    const v = item.source === "tag" && !item.period ? calcMetric(data, m) : calcMetric(data, m, item.period);
    const s = spec?.status && spec.status !== "target" ? metricStatus(m, v) : null;
    const text = `${formatMetric(m, v)}${spec?.unit === "%" ? " %" : ""}`;
    fitKey = `${s}|${text}`;
    valueNode = s ? (
      // 120 px at the full 110 px line; em so it shrinks with the line
      <span className="font-mono font-bold text-[1.09em]" style={{ color: statusColor(s) }}>
        {cue(s, spec?.status === "scrap" ? "low" : "high")}
        {text}
      </span>
    ) : (
      <span className={spec?.format === "minutes" ? "text-zinc-100" : undefined}>{text}</span>
    );
  }
  const tpl = item.sub_text ?? "";
  const [before, after] = tpl.includes("{}") ? tpl.split("{}", 2) : [tpl ? `${tpl} ` : "", ""];
  return (
    <SubLine fitKey={`${before}|${fitKey}|${after}`}>
      {before}
      {valueNode}
      {after}
    </SubLine>
  );
}

// ------------------------------------------------------------------ OEE + A/P/Q breakdown

export function BreakdownElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const period = item.period ?? "shift";
  const get = (m: string) => calcMetric(data, m, period);
  const oee = get("oee");
  const s = metricStatus("oee", oee, { oeeGoal: get("oee_target") });
  const ref = useFit<HTMLSpanElement>(290, [oee]);
  return (
    <Card title={title(item)} aside={<TargetStatus ok={s === null ? null : s === "good"} />}>
      <div className="flex items-baseline gap-6 leading-none whitespace-nowrap min-w-0">
        <span ref={ref} data-fit-value className="min-w-0 font-mono font-bold tracking-[-6px] tabular-nums" style={{ color: statusColor(s) }}>
          {fmtPct(oee)}
        </span>
        <span className="text-[120px] text-zinc-300">%</span>
      </div>
      <div className="space-y-6 mt-10">
        <FactorRow label="Tillgänglighet" value={get("availability")} />
        <FactorRow label="Prestanda" value={get("performance")} />
        <FactorRow label="Kvalitet" value={get("quality")} />
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ progress to target

export function ProgressElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const period = item.period ?? "shift";
  let good: number | null;
  let goal: number | null;
  let soFar: number | null = null;
  let stats: [string, number | null][];
  if (item.source === "tag") {
    good = tagValue(data, item.tag).value;
    goal = resolveTarget(data, item);
    stats = [["Mål", goal]];
  } else if (period === "shift") {
    const d = data.details;
    good = d?.counts.good ?? null;
    goal = d?.target?.shift ?? null;
    soFar = d?.target?.so_far ?? null;
    stats = [["Mål hittills", soFar], ["Skiftmål", goal], ["Prognos", d?.target?.prognosis ?? null]];
  } else {
    const row = periodRow(data.aggregates, period);
    good = rowMetric(row, "good");
    goal = rowMetric(row, "target");
    stats = [["Mål", goal], ["Kassation", rowMetric(row, "reject")]];
  }
  const progress = good !== null && goal ? Math.min(100, (good / goal) * 100) : 0;
  const soFarPos = soFar !== null && goal ? Math.min(100, (soFar / goal) * 100) : null;
  // Shift: on target = good >= target so far; other periods: good >= the period's target
  const onTarget = productionOnTarget(good, soFar ?? goal);
  const compact = item.h < 8;
  const heroRef = useFit<HTMLSpanElement>(compact ? 220 : 290, [good, compact]);
  return (
    <Card title={title(item)} aside={<TargetStatus ok={onTarget} />}>
      <div className="flex items-baseline gap-5 leading-none whitespace-nowrap min-w-0">
        <span ref={heroRef} data-fit-value className="min-w-0 font-mono font-bold tracking-[-8px] tabular-nums">
          {fmtInt(good)}
        </span>
        <span className="text-[104px] text-zinc-300 tv-truncate">st godkända</span>
      </div>
      <div className={`relative ${compact ? "h-16 mt-10" : "h-24 mt-14"} bg-zinc-800 rounded-full`}>
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${progress}%`, backgroundColor: onTarget === false ? AMBER : GREEN }} />
        {soFarPos !== null && <div className="absolute -top-6 -bottom-6 w-4 bg-white rounded" style={{ left: `calc(${soFarPos}% - 8px)` }} />}
      </div>
      {item.stats !== false && (
        <div className={`flex justify-between gap-12 ${compact ? "mt-10" : "mt-16"} min-w-0`}>
          {stats.map(([label, v]) => (
            <FitStat key={label} label={label} value={fmtInt(v)} />
          ))}
        </div>
      )}
    </Card>
  );
}

function FitStat({ label, value }: { label: string; value: string }) {
  const ref = useFit<HTMLDivElement>(130, [value]);
  return (
    <div className="min-w-0">
      <div className="text-[110px] text-zinc-300 leading-none whitespace-nowrap">{label}</div>
      <div ref={ref} data-fit-value className="min-w-0 font-mono font-bold tracking-[-2px] mt-5 leading-none whitespace-nowrap tabular-nums">
        {value}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ OEE ring / gauge

export function GaugeElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const v = mainValue(data, item, "oee");
  const max = item.max ?? 100;
  const shownV = v.metric ? shown(v.metric, v.value) : v.value;
  const frac = shownV === null ? 0 : Math.min(1, Math.max(0, shownV / max));
  const target = v.target ?? (v.metric === "oee" ? calcMetric(data, "oee_target", item.period) : null);
  const tFrac = target === null ? null : Math.min(1, Math.max(0, target / max));
  const [box, size] = useSize<HTMLDivElement>();
  const d = Math.max(0, Math.min(size.w, size.h));
  const valueRef = useFit<HTMLDivElement>(Math.min(290, Math.max(112, Math.round(d * 0.3))), [v.text, d]);
  // 270° arc from 135° (bottom left) clockwise to 45° (bottom right)
  const R = 42;
  const C = 2 * Math.PI * R;
  const sweep = 0.75;
  const color = v.down ? AMBER : statusColor(v.status);
  const angle = (f: number) => ((135 + 270 * f) * Math.PI) / 180;
  const tick = tFrac === null ? null : [50 + (R - 7) * Math.cos(angle(tFrac)), 50 + (R - 7) * Math.sin(angle(tFrac)), 50 + (R + 7) * Math.cos(angle(tFrac)), 50 + (R + 7) * Math.sin(angle(tFrac))];
  const unit = v.unit ?? "";
  return (
    <Card title={title(item)}>
      <div ref={box} className="relative flex-1 min-h-0 min-w-0 mt-6">
        {d > 0 && (
          <svg className="absolute" width={d} height={d} viewBox="0 0 100 100" style={{ left: (size.w - d) / 2, top: (size.h - d) / 2 }} aria-hidden>
            <circle cx="50" cy="50" r={R} fill="none" stroke={TRACK} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${C * sweep} ${C}`} transform="rotate(135 50 50)" />
            <circle
              cx="50" cy="50" r={R} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round"
              strokeDasharray={`${C * sweep * frac} ${C}`} transform="rotate(135 50 50)" style={{ transition: "stroke-dasharray 1s" }}
            />
            {tick && <line x1={tick[0]} y1={tick[1]} x2={tick[2]} y2={tick[3]} stroke="white" strokeWidth="2.2" strokeLinecap="round" />}
          </svg>
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center min-w-0">
          <div style={{ width: d * 0.58 }} className="min-w-0 flex flex-col items-center">
            <div ref={valueRef} data-fit-value className="w-full text-center leading-none whitespace-nowrap font-mono font-bold tabular-nums tracking-[-4px]" style={{ color }}>
              {v.down ? "⚠ " : ""}
              {v.text}
            </div>
            {(unit || cue(v.status, item.better)) && (
              <div className="text-[104px] leading-none text-zinc-300 mt-4 whitespace-nowrap">
                {v.status && v.status !== "good" && <span style={{ color }}>{cue(v.status, item.better)}</span>}
                {unit}
              </div>
            )}
          </div>
        </div>
        {target !== null && (
          <div className="absolute left-0 right-0 bottom-0 text-center text-[104px] leading-none text-zinc-300 whitespace-nowrap">
            Mål <span className="font-mono text-[1.08em] text-zinc-100">{fmtFixed(target, v.metric ? (METRICS[v.metric].format === "int" ? 0 : 1) : item.decimals ?? 1)}</span>
          </div>
        )}
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ bars per day / shift

const TOP_PX = 160; // cap ≈ 53 px at 1080p
const COUNT_PX = 116; // cap ≈ 38 px at 1080p

function BarColumn({
  row, scale, metric, top, compact,
}: {
  row: ReturnType<typeof seriesRows>[number];
  scale: number;
  metric: string;
  top: string | null;
  compact: boolean;
}) {
  const value = row.has_data ? rowMetric(row, metric) : null;
  const target = row.has_data && metric === "good" ? row.target : null;
  const status = metric === "good" ? barStatus(value, target) : metricStatus(metric, value);
  const barColor = status === "good" ? GREEN : status === "warn" ? AMBER : status === "bad" ? RED : "#71717a";
  const topV = top && row.has_data ? rowMetric(row, top) : null;
  const topText = top ? formatMetric(top, topV) : "";
  const countText = formatMetric(metric, value);
  const topRef = useFit<HTMLDivElement>(TOP_PX, [topText]);
  const countRef = useFit<HTMLDivElement>(COUNT_PX, [countText]);
  const labelRef = useFit<HTMLDivElement>(120, [row.label]);
  const topUnit = top ? METRICS[top]?.unit : undefined;
  const pct = barPct(shown(metric, value), scale);
  return (
    <div
      data-fit
      className={`rounded-[40px] px-4 pt-8 pb-8 flex flex-col min-h-0 min-w-0 overflow-hidden border-4 ${row.current ? "bg-zinc-800 border-zinc-200" : "bg-zinc-900 border-zinc-800"}`}
    >
      {top && (
        <div ref={topRef} data-week-oee data-fit-value className="min-w-0 flex items-baseline justify-center whitespace-nowrap leading-none font-mono font-bold tabular-nums tracking-[-4px]">
          {topText}
          {topV !== null && topUnit && <span className="text-[104px] font-sans font-normal tracking-normal text-zinc-300 ml-3">{topUnit}</span>}
        </div>
      )}
      <div className={`relative flex-1 min-h-0 ${top ? "mt-8" : ""} mb-6`}>
        {value !== null && (
          <div className="absolute bottom-0 left-[14%] right-[14%] rounded-t-[24px] transition-all duration-1000" style={{ height: `${pct}%`, backgroundColor: barColor }} />
        )}
        {target !== null && <div className="absolute left-0 right-0 h-3 bg-white rounded" style={{ bottom: `calc(${barPct(target, scale)}% - 6px)` }} />}
      </div>
      <div ref={countRef} data-week-count data-fit-value className="min-w-0 text-center whitespace-nowrap leading-none font-mono font-bold tabular-nums tracking-[-4px]">
        {countText}
      </div>
      <div ref={labelRef} data-fit-value className={`mt-6 min-w-0 text-center leading-none whitespace-nowrap font-bold ${row.current ? "text-white" : "text-zinc-300"}`}>
        {row.label}
      </div>
      {!compact && <div className="mt-4 text-center leading-none whitespace-nowrap text-[110px] text-zinc-300">{row.sub || "\u00a0"}</div>}
    </div>
  );
}

export function BarsElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const series = item.series ?? "days";
  const count = item.count ?? 7;
  const metric = item.metric ?? "good";
  const top = item.top_metric === "none" ? null : (item.top_metric ?? "oee");
  const rows = seriesRows(data.aggregates, series, count);
  const withData = rows.filter((r) => r.has_data);
  const scale =
    METRICS[metric]?.format === "pct"
      ? 100
      : barScale(withData.map((r) => ({ good: shown(metric, rowMetric(r, metric)), target: metric === "good" ? r.target : null })));
  const anyTarget = metric === "good" && withData.some((r) => r.target !== null);
  return (
    <div data-fit data-chart className="h-full min-h-0 min-w-0 flex flex-col overflow-hidden">
      <div className="flex items-baseline justify-between gap-12 leading-none whitespace-nowrap min-w-0">
        <Title text={title(item)} />
        {anyTarget && (
          <div className="shrink-0 flex items-center gap-6 text-[104px] text-zinc-300">
            <span className="inline-block w-28 h-3 bg-white rounded" aria-hidden />
            {series === "shifts" ? "skiftmål" : "dagsmål"}
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <NoData />
      ) : (
        <div className="flex-1 min-h-0 grid gap-6 mt-10" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
          {rows.map((r, i) => (
            <BarColumn key={`${r.label}-${r.sub}-${i}`} row={r} scale={scale} metric={metric} top={top} compact={item.h < 8} />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ trend line / sparkline

export function TrendElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  let points: (number | null)[];
  let labels: [string, string] = ["", ""];
  let metric: string | null = null;
  let decimals = item.decimals ?? 1;
  if (item.source === "tag") {
    const hist = item.tag ? (data.histories[item.tag] ?? []) : [];
    points = hist.map((v) => (typeof v === "number" ? v : Number.isFinite(Number(v)) ? Number(v) : null));
    const cur = tagValue(data, item.tag).value;
    if (cur !== null && points[points.length - 1] !== cur) points = [...points, cur];
  } else {
    metric = item.metric ?? "oee";
    const rows = seriesRows(data.aggregates, item.series ?? "days", item.count ?? 14);
    points = rows.map((r) => shown(metric!, rowMetric(r, metric!)));
    if (rows.length) labels = [rows[0].label === "Idag" ? rows[0].label : `${rows[0].label} ${rows[0].sub}`, rows[rows.length - 1].label];
    decimals = METRICS[metric]?.format === "int" ? 0 : 1;
  }
  const last = [...points].reverse().find((p) => p !== null) ?? null;
  const target = resolveTarget(data, { ...item, period: undefined });
  const status = metric ? metricStatus(metric, last === null ? null : METRICS[metric]?.format === "pct" ? last / 100 : last, { target }) : metricStatus(null, last, { target, decimals });
  const unit = item.unit ?? (metric ? METRICS[metric]?.unit : undefined);
  const lastText = last === null ? DASH : metric ? formatMetric(metric, METRICS[metric]?.format === "pct" ? last / 100 : last) : fmtFixed(last, decimals);
  const vals = points.filter((p): p is number => p !== null);
  const lo = Math.min(...vals, ...(target !== null ? [target] : []));
  const hi = Math.max(...vals, ...(target !== null ? [target] : []));
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.05 || 1;
  const y0 = lo - pad;
  const y1 = hi + pad;
  const compact = item.h < 6;
  const [box, size] = useSize<HTMLDivElement>();
  const W = Math.max(1, size.w);
  const H = Math.max(1, size.h);
  const n = points.length;
  const m = compact ? 18 : 24; // room for the line caps and the end dot
  const X = (i: number) => (n <= 1 ? W / 2 : m + (i / (n - 1)) * (W - 2 * m));
  const Y = (v: number) => H - m - ((v - y0) / (y1 - y0)) * (H - 2 * m);
  const segs: string[] = [];
  let cur = "";
  points.forEach((p, i) => {
    if (p === null) {
      if (cur) segs.push(cur);
      cur = "";
    } else cur += `${cur ? "L" : "M"}${X(i).toFixed(1)},${Y(p).toFixed(1)}`;
  });
  if (cur) segs.push(cur);
  const color = statusColor(status === null ? null : status) === "var(--accent-neutral)" ? "#e4e4e7" : statusColor(status);
  const lastIdx = points.length - 1 - [...points].reverse().findIndex((p) => p !== null);
  const fmtAxis = (v: number) => (metric ? fmtFixed(v, METRICS[metric]?.format === "int" ? 0 : 1) : fmtFixed(v, decimals));
  return (
    <Card
      title={title(item)}
      aside={
        <span data-fit-value className="font-mono tabular-nums normal-case" style={{ color: status ? statusColor(status) : undefined }}>
          {cue(status as Status, item.better)}
          {lastText}
          {unit && <span className="font-sans font-normal text-zinc-300 ml-4 text-[104px]">{unit}</span>}
        </span>
      }
    >
      <div className={`flex-1 min-h-0 min-w-0 flex ${compact ? "mt-6" : "mt-8"} gap-6`}>
        {!compact && vals.length > 0 && (
          <div className="flex flex-col justify-between text-[112px] leading-none text-zinc-300 font-mono tabular-nums whitespace-nowrap shrink-0 text-right">
            <span>{fmtAxis(y1 - pad)}</span>
            <span>{fmtAxis(y0 + pad)}</span>
          </div>
        )}
        <div className="flex-1 min-w-0 flex flex-col">
          <div ref={box} className="relative flex-1 min-h-0">
            {vals.length > 0 && size.w > 0 && (
              <svg className="absolute inset-0" width={W} height={H} aria-hidden>
                {!compact && [y0 + pad, y1 - pad].map((v) => <line key={v} x1="0" x2={W} y1={Y(v)} y2={Y(v)} stroke={GRID_LINE} strokeWidth="3" />)}
                {target !== null && <line x1="0" x2={W} y1={Y(target)} y2={Y(target)} stroke="white" strokeWidth="8" strokeDasharray="28 20" strokeLinecap="round" />}
                {segs.map((d) => (
                  <path key={d} d={d} fill="none" stroke={color} strokeWidth={compact ? 12 : 14} strokeLinejoin="round" strokeLinecap="round" />
                ))}
                {lastIdx >= 0 && lastIdx < n && points[lastIdx] !== null && <circle cx={X(lastIdx)} cy={Y(points[lastIdx]!)} r={compact ? 16 : 22} fill={color} />}
              </svg>
            )}
            {vals.length === 0 && <NoData px={130} />}
          </div>
          {!compact && labels[0] && (
            <div className="flex justify-between gap-8 mt-6 text-[104px] leading-none text-zinc-300 whitespace-nowrap">
              <span>{labels[0]}</span>
              <span>{labels[1]}</span>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ run/stop timeline (current shift)

export function TimelineElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const agg = data.aggregates;
  const win = agg?.shift_window ?? null;
  const t0 = win ? Date.parse(win.start) : NaN;
  const t1 = win ? Date.parse(win.end) : NaN;
  const span = t1 - t0;
  const segs = agg?.segments ?? [];
  const pos = (iso: string) => Math.min(100, Math.max(0, ((Date.parse(iso) - t0) / span) * 100));
  const stopped = data.details?.stops?.running === false || (segs.length > 0 && !segs[segs.length - 1].running);
  const stops = segs.filter((s) => !s.running);
  const stopS = stops.reduce((a, s) => a + (Date.parse(s.end) - Date.parse(s.start)) / 1000, 0);
  const nowPos = segs.length ? pos(segs[segs.length - 1].end) : null;
  const wide = item.w >= 18;
  return (
    <Card title={title(item)} aside={segs.length ? stopped ? <span style={{ color: RED }}>■ STÅR</span> : <span style={{ color: GREEN }}>▶ KÖR</span> : undefined}>
      <div className="relative flex-1 min-h-[48px] max-h-[200px] mt-6 rounded-[24px] overflow-hidden" style={{ background: TRACK }}>
        {Number.isFinite(span) && span > 0 &&
          segs.map((s) => (
            <div
              key={s.start}
              className="absolute top-0 bottom-0"
              style={{ left: `${pos(s.start)}%`, width: `${Math.max(0.15, pos(s.end) - pos(s.start))}%`, background: s.running ? GREEN : RED }}
            />
          ))}
        {nowPos !== null && <div className="absolute top-0 bottom-0 w-3 bg-white" style={{ left: `calc(${nowPos}% - 6px)` }} />}
      </div>
      <div className="flex justify-between items-baseline gap-8 mt-6 leading-none whitespace-nowrap min-w-0">
        <span className="text-[110px] font-mono text-zinc-300">{fmtClock(win?.start)}</span>
        {wide && segs.length > 0 && (
          <span className="text-[110px] text-zinc-300 tv-truncate">
            <span className="text-zinc-100 font-mono">{fmtInt(stops.length)}</span> stopp ·{" "}
            <span className="text-zinc-100">{fmtMinutes(stopS)}</span>
          </span>
        )}
        <span className="text-[110px] font-mono text-zinc-300">{fmtClock(win?.end)}</span>
      </div>
    </Card>
  );
}

// ------------------------------------------------------------------ table per shift / day

const COLUMN_HEAD: Record<string, string> = {
  label: "",
  good: "Godkända",
  oee: "OEE %",
  availability: "A %",
  performance: "P %",
  quality: "Q %",
  scrap_pct: "Kass. %",
  reject: "Kass. st",
  stop_count: "Stopp",
  stop_time: "Stopptid",
  target: "Mål",
};

export function TableElement({ item }: { item: ChartItem }) {
  const data = useChartData();
  const series = item.series ?? "shifts";
  const rows = seriesRows(data.aggregates, series, item.count ?? 4);
  const cols = item.columns ?? ["label", "good", "oee"];
  const tmpl = cols.map((c) => (c === "label" ? "minmax(0, 1.3fr)" : "minmax(0, 1fr)")).join(" ");
  return (
    <Card title={title(item)}>
      {rows.length === 0 ? (
        <NoData />
      ) : (
        <div className="flex-1 min-h-0 flex flex-col justify-start mt-6 min-w-0">
          <div className="grid gap-8 px-6 pb-4 border-b-4 border-zinc-800 text-[104px] leading-none text-zinc-300 whitespace-nowrap" style={{ gridTemplateColumns: tmpl }}>
            {cols.map((c) => (
              <span key={c} className={c === "label" ? "" : "text-right"}>
                {c === "label" ? (series === "shifts" ? "Skift" : "Dag") : COLUMN_HEAD[c]}
              </span>
            ))}
          </div>
          {rows.map((r, i) => (
            <div
              key={`${r.label}-${r.sub}-${i}`}
              className={`grid gap-8 px-6 py-4 items-baseline leading-none whitespace-nowrap rounded-[24px] ${r.current ? "bg-zinc-800" : ""}`}
              style={{ gridTemplateColumns: tmpl }}
            >
              {cols.map((c) => {
                if (c === "label")
                  return (
                    <span key={c} className={`text-[116px] font-bold tv-truncate ${r.current ? "text-white" : "text-zinc-200"}`}>
                      {series === "shifts" ? (r.label.replace("Skift ", "") || "–") : r.label} <span className="font-normal text-zinc-300 text-[104px]">{r.sub}</span>
                    </span>
                  );
                const v = rowMetric(r, c);
                const s = METRICS[c]?.status && METRICS[c].status !== "target" ? metricStatus(c, v, { oeeGoal: rowMetric(r, "oee_target") }) : null;
                return <TableCell key={c} text={formatMetric(c, v)} color={s ? statusColor(s) : undefined} />;
              })}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function TableCell({ text, color }: { text: string; color?: string }) {
  const ref = useFit<HTMLSpanElement>(116, [text]);
  return (
    <span ref={ref} data-fit-value className="min-w-0 text-right font-mono font-bold tabular-nums tracking-[-2px]" style={color ? { color } : undefined}>
      {text}
    </span>
  );
}

// ------------------------------------------------------------------ dispatcher

export function ChartElement({ item }: { item: ChartItem }) {
  switch (item.kind) {
    case "kpi":
      return <KpiElement item={item} />;
    case "gauge":
      return <GaugeElement item={item} />;
    case "breakdown":
      return <BreakdownElement item={item} />;
    case "progress":
      return <ProgressElement item={item} />;
    case "bars":
      return <BarsElement item={item} />;
    case "trend":
      return <TrendElement item={item} />;
    case "timeline":
      return <TimelineElement item={item} />;
    case "table":
      return <TableElement item={item} />;
  }
}
