// Building blocks shared by the chart/KPI elements and the built-in OEE and 7-day screens (which are
// composed of the same elements). Laid out for the 3840x2160 canvas and read from 8-10 m: titles and
// labels >= 104 px (>= 37 px cap at 1080p), all text in HTML (never inside SVG), so the legibility
// check and scripts/check-fit.mjs measure chart labels like any other text.
import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useFit } from "@/hooks/useFit";

/** smallest chart text on the 3840x2160 canvas (37 px cap height at 1080p); check-fit.mjs enforces it */
const CHART_TEXT_MIN_PX = 104;
import { fmtPct } from "@/lib/format";
import { factorStatus } from "@/lib/status";

import { GREEN, AMBER, cue, statusColor } from "./colors";

/** A chart title: 110 px, shrinks to the 104 px chart-text floor (next to a wide value or legend)
 *  before it would be shortened with …; measured after every render, since the neighbour changes. */
export function Title({ text }: { text: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.fontSize = "110px";
    if (el.scrollWidth > el.clientWidth + 1)
      el.style.fontSize = `${Math.max(CHART_TEXT_MIN_PX, Math.floor((110 * el.clientWidth) / el.scrollWidth))}px`;
  });
  return (
    <div ref={ref} className="text-[110px] text-zinc-300 uppercase tracking-wide font-medium tv-truncate">
      {text}
    </div>
  );
}

export function Card({ title, aside, children, className = "" }: { title: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div
      data-fit
      data-chart
      className={`h-full bg-zinc-900 border border-zinc-800 rounded-[48px] px-14 py-8 flex flex-col min-h-0 min-w-0 overflow-hidden ${className}`}
    >
      <div className="flex items-baseline justify-between gap-8 leading-none whitespace-nowrap min-w-0">
        <Title text={title} />
        {aside && <div className="text-[110px] font-bold uppercase shrink-0">{aside}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center min-w-0">{children}</div>
    </div>
  );
}

export function TargetStatus({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  return ok ? <span style={{ color: GREEN }}>● PÅ MÅL</span> : <span style={{ color: AMBER }}>▼ UNDER MÅL</span>;
}

export function FactorRow({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value * 100));
  const s = factorStatus(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-8 leading-none whitespace-nowrap">
        <span className="text-[110px] text-zinc-300 tv-truncate">{label}</span>
        <span data-fit-value className="text-[140px] font-mono font-bold tabular-nums shrink-0" style={{ color: statusColor(s) }}>
          {cue(s)}
          {fmtPct(value)}
          <span className="text-[104px] font-sans font-normal text-zinc-300 ml-4">%</span>
        </span>
      </div>
      <div className="h-5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
        <div className="h-full rounded-full transition-all duration-1000" style={{ width: `${pct}%`, backgroundColor: statusColor(s) }} />
      </div>
    </div>
  );
}

export function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[110px] text-zinc-300 leading-none whitespace-nowrap">{label}</div>
      <div
        data-fit-value
        className="text-[130px] font-mono font-bold tracking-[-2px] mt-5 leading-none whitespace-nowrap tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

/** Big number with unit; shrinks (never below FIT_MIN_PX) only if it would not fit its width */
export function BigValue({ value, unit, color, px = 220 }: { value: string; unit?: string; color?: string; px?: number }) {
  const ref = useFit<HTMLDivElement>(px, [value, unit, px]);
  return (
    <div ref={ref} data-fit-value className="flex items-baseline leading-none whitespace-nowrap min-w-0">
      <span className="font-mono font-bold tracking-[-4px] tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
      {unit && <span className="text-[110px] text-zinc-300 ml-6">{unit}</span>}
    </div>
  );
}

/** Line under a KPI value: 110 px, shrinks to the 104 px chart-text floor before it would truncate. */
export function SubLine({ children, fitKey }: { children: ReactNode; fitKey: string }) {
  const ref = useFit<HTMLDivElement>(110, [fitKey], CHART_TEXT_MIN_PX);
  return (
    <div className="mt-8 min-w-0">
      {/* data-secondary: the editor's audit only warns when this line is shortened with … */}
      <div ref={ref} data-secondary className="text-[110px] text-zinc-300 tv-truncate">{children}</div>
    </div>
  );
}

/** "–" placeholder centred in the remaining space (no data yet) */
export function NoData({ px = 160 }: { px?: number }) {
  return (
    <div className="flex-1 min-h-0 flex items-center justify-center text-zinc-300" style={{ fontSize: px }}>
      –
    </div>
  );
}
