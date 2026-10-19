import { useLayoutEffect, useRef } from "react";
import type { MetricValue } from "@/data/types";
import { COLOR_VAR, type ItemConfig } from "@/layout/layout";
import { DASH, fmtFixed, itemDecimals } from "@/lib/format";
import { isValidNumber } from "@/lib/utils";
import { thresholdStatus, type Status } from "@/lib/status";

// One tile of a grid screen, configured in dashboard.yaml (see docs/CONFIG.md).
// Laid out for the 3840x2160 canvas (see ScaledCanvas), read from 8-10 m on a 65" TV:
// hero value 290 px mono -> >= 180 px cap height on the canvas (>= 90 px at 1080p). If a
// configured value/unit/trend combination is too wide, the hero font shrinks just enough to fit
// (never below MIN_HERO_PX) instead of overflowing. Nothing secondary below 104-140 px.

const HERO_PX = 290;
const STATUS_PX = 200;
// Floor for the fit-shrink: 120 px mono = 40 px cap height at 1080p, still above the 37 px minimum.
// Only reached by extreme combinations (docs/examples/stress.yaml); normal values keep 290 px.
const MIN_HERO_PX = 120;

const STATUS_COLOR: Record<Status, string> = { good: COLOR_VAR.green, warn: COLOR_VAR.amber, bad: COLOR_VAR.red };

/** Tags that have delivered a decimal value at least once (keeps "82,0" from turning into "82") */
const fractionalTags = new Set<string>();

/** Shrinks the font of `ref` (from maxPx) until its content fits its width; deps = displayed content. */
function useFitFont(maxPx: number, deps: unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    for (let i = 0; i < 6 && el.scrollWidth > el.clientWidth + 1 && size > MIN_HERO_PX; i++) {
      size = Math.max(MIN_HERO_PX, Math.floor((size * el.clientWidth) / el.scrollWidth) - 2);
      el.style.fontSize = `${size}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

interface ItemCardProps {
  item: ItemConfig;
  value: MetricValue | undefined;
  history?: MetricValue[];
  targetValue?: MetricValue;
  /** The element's PLC is not connected: "–" and a ⚠ marker instead of a stale value */
  offline?: boolean;
}

export function ItemCard({ item, value, history, targetValue, offline = false }: ItemCardProps) {
  const numeric = isValidNumber(value) ? Number(value) : null;
  if (
    !fractionalTags.has(item.tag) &&
    [value, ...(history ?? [])].some((v) => isValidNumber(v) && !Number.isInteger(Number(v)))
  )
    fractionalTags.add(item.tag);
  const decimals = itemDecimals(item.type, item.decimals, fractionalTags.has(item.tag));

  // ----- main value text + colour -----
  let text: string;
  let color: string | undefined = item.color ? COLOR_VAR[item.color] : undefined;
  let status: Status | null = null;
  if (value === undefined || value === null || value === "") {
    text = DASH;
  } else if (item.type === "status") {
    const state = item.states?.[String(value)];
    text = state ? state.text : String(value);
    color = state ? COLOR_VAR[state.color] : undefined;
  } else if (item.type === "time" || numeric === null) {
    text = String(value);
  } else {
    text = fmtFixed(numeric, decimals);
    status = thresholdStatus(numeric, item.thresholds, item.better, decimals); // on the shown (rounded) value
    if (status) color = STATUS_COLOR[status];
  }
  // Non-colour cue: ▼ = below target (higher is better), ▲ = above limit (lower is better)
  // ⚠ = no connection to the element's PLC (shape cue, not only colour)
  const cue = offline ? "⚠" : status && status !== "good" ? (item.better === "low" ? "▲" : "▼") : null;
  if (offline) color = COLOR_VAR.amber;

  // ----- latest change (trend) -----
  let deltaText: string | null = null;
  let deltaArrow = "";
  let deltaColor = COLOR_VAR.grey;
  if (item.trend && history && history.length >= 2) {
    const a = Number(history[history.length - 2]);
    const b = Number(history[history.length - 1]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const d = Number((b - a).toFixed(decimals)); // arrow follows the shown (rounded) change
      // Same fixed decimals as the value: "▲ 0,6", "● 0,0", counters "▲ 1"
      deltaText = fmtFixed(Math.abs(d), decimals);
      deltaArrow = d > 0 ? "▲" : d < 0 ? "▼" : "●";
      deltaColor = d === 0 ? COLOR_VAR.grey : (d > 0) === (item.better === "high") ? COLOR_VAR.green : COLOR_VAR.red;
    }
  }

  // ----- target + progress -----
  const target = isValidNumber(targetValue) ? Number(targetValue) : null;
  const progress = target !== null && target > 0 && numeric !== null ? Math.min(100, Math.max(0, (numeric / target) * 100)) : null;

  const isStatus = item.type === "status";
  const heroRef = useFitFont(isStatus ? STATUS_PX : HERO_PX, [text, item.unit, deltaText, target]);

  return (
    <div
      data-fit
      className="bg-zinc-900 border border-zinc-800 rounded-[48px] px-14 py-10 flex flex-col min-h-0 min-w-0 overflow-hidden"
    >
      <div className="flex items-baseline justify-between gap-8 min-w-0">
        <div className="text-[110px] text-zinc-300 tracking-wide uppercase font-medium tv-truncate">{item.label}</div>
        {cue && (
          <div className="text-[110px] font-bold leading-none shrink-0" style={{ color }}>
            {cue}
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex items-end justify-between gap-12 min-w-0">
        {/* Main value (font shrinks only if the configured content would not fit) */}
        <div ref={heroRef} data-hero className="flex-1 min-w-0 flex items-baseline whitespace-nowrap leading-none">
          <span
            className={
              isStatus
                ? "font-bold uppercase tracking-wide"
                : "font-mono font-bold tracking-[-0.02em] tabular-nums"
            }
            style={color ? { color } : undefined}
          >
            {text}
          </span>
          {item.unit && !isStatus && text !== DASH && (
            <span className="text-[110px] text-zinc-300 ml-6">{item.unit}</span>
          )}
        </div>

        {deltaText !== null && (
          <div className="shrink-0 text-[140px] font-mono font-semibold leading-none whitespace-nowrap pb-6" style={{ color: deltaColor }}>
            {deltaArrow} {deltaText}
          </div>
        )}

        {item.target !== undefined && (
          <div className="shrink-0 pb-6">
            {/* Label above the value so a 6-digit hero (999999 st) + 6-digit target still fit the card */}
            <div className="text-[110px] text-zinc-300 leading-none">Mål</div>
            <div className="text-[140px] font-mono font-semibold text-zinc-200 tabular-nums leading-none whitespace-nowrap mt-4">
              {target === null ? DASH : fmtFixed(target, item.type === "counter" ? 0 : decimals)}
            </div>
            {progress !== null && (
              <div className="h-14 bg-zinc-800 rounded-full mt-8 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${progress}%`, backgroundColor: "var(--accent-green)" }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
