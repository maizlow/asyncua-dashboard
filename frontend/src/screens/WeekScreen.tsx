import { useLayoutEffect, useRef } from "react";
import { useMetricsStore } from "@/stores/useMetricsStore";
import type { DailyRow } from "@/data/types";
import { DASH, fmtInt, fmtPct } from "@/lib/format";
import { barPct, barScale, barStatus, dayLabel } from "@/lib/week";

// Today + the previous 6 days (screen type: week), laid out for the 3840x2160 canvas (see ScaledCanvas)
// and read from 8-10 m (cap heights at 1080p: OEE ≈ 53 px, counts ≈ 38 px, labels ≥ 37 px). Seven fixed columns: OEE % on top, a bar of good tiles per day with the day
// target as a white line, the good count and the day label below. 6-digit counts and "100,0 %" fit;
// numbers shrink (never below MIN_PX) only if a value would not fit its column. Nothing scrolls.
// Status is never colour-only: under target = amber bar that ends below the white target line.

const GREEN = "var(--accent-green)";
const AMBER = "var(--accent-amber)";
const NEUTRAL = "#71717a"; // zinc-500: no target known

const OEE_PX = 160; // cap ≈ 53 px at 1080p
const COUNT_PX = 116; // cap ≈ 38 px at 1080p; "999 999" fits without shrinking
// Shrink floor: 112 px mono = 37 px cap height at 1080p (the minimum for anything important).
// Only reached by "100,0 %" (OEE shrinks to ~130 px); normal values keep the full size.
const MIN_PX = 112;

/** Shrinks the font of the element (from maxPx) until its content fits its width. */
function useFit<T extends HTMLElement>(maxPx: number, deps: unknown[]) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    for (let i = 0; i < 6 && el.scrollWidth > el.clientWidth + 1 && size > MIN_PX; i++) {
      size = Math.max(MIN_PX, Math.floor((size * el.clientWidth) / el.scrollWidth) - 2);
      el.style.fontSize = `${size}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}

function DayColumn({ day, scale }: { day: DailyRow; scale: number }) {
  const label = dayLabel(day.date, day.today);
  const oee = day.has_data ? day.oee.oee : null;
  const good = day.has_data ? day.good : null;
  const target = day.has_data ? day.target : null;
  const status = barStatus(good, target);
  const barColor = status === "good" ? GREEN : status === "warn" ? AMBER : NEUTRAL;
  const oeeText = fmtPct(oee);
  const countText = fmtInt(good);
  const oeeRef = useFit<HTMLDivElement>(OEE_PX, [oeeText]);
  const countRef = useFit<HTMLDivElement>(COUNT_PX, [countText]);

  return (
    <div
      data-fit
      className={`rounded-[40px] px-4 pt-8 pb-8 flex flex-col min-h-0 min-w-0 overflow-hidden border-4 ${
        day.today ? "bg-zinc-800 border-zinc-200" : "bg-zinc-900 border-zinc-800"
      }`}
    >
      {/* OEE % (largest number) */}
      <div
        ref={oeeRef}
        data-week-oee
        className="min-w-0 flex items-baseline justify-center whitespace-nowrap leading-none font-mono font-bold tabular-nums tracking-[-4px]"
      >
        {oeeText}
        {oee !== null && <span className="text-[104px] font-sans font-normal tracking-normal text-zinc-300 ml-3">%</span>}
      </div>

      {/* Bar of good tiles, white line = day target (today: target so far) */}
      <div className="relative flex-1 min-h-0 mt-8 mb-6">
        {good !== null && (
          <div
            className="absolute bottom-0 left-[14%] right-[14%] rounded-t-[24px] transition-all duration-1000"
            style={{ height: `${barPct(good, scale)}%`, backgroundColor: barColor }}
          />
        )}
        {target !== null && (
          <div
            className="absolute left-0 right-0 h-3 bg-white rounded"
            style={{ bottom: `calc(${barPct(target, scale)}% - 6px)` }}
          />
        )}
      </div>

      {/* Good count */}
      <div
        ref={countRef}
        data-week-count
        className="min-w-0 text-center whitespace-nowrap leading-none font-mono font-bold tabular-nums tracking-[-4px]"
      >
        {countText}
      </div>

      {/* Day label */}
      <div className={`mt-6 text-center leading-none whitespace-nowrap text-[120px] font-bold ${day.today ? "text-white" : "text-zinc-300"}`}>
        {label.weekday}
      </div>
      <div className="mt-4 text-center leading-none whitespace-nowrap text-[110px] text-zinc-300">{label.date || "\u00a0"}</div>
    </div>
  );
}

export function WeekScreen() {
  const history = useMetricsStore((s) => s.dailyHistory);
  const days = history?.days ?? [];
  const scale = barScale(days.filter((d) => d.has_data));
  const anyTarget = days.some((d) => d.has_data && d.target !== null);

  return (
    <div data-fit className="h-full min-h-0 flex flex-col px-16 pt-10 pb-14 overflow-hidden">
      <div className="flex items-baseline justify-between gap-12 leading-none whitespace-nowrap min-w-0">
        <div className="text-[110px] text-zinc-300 uppercase tracking-wide font-medium tv-truncate">
          7 dagar · OEE % · godkända st
        </div>
        {anyTarget && (
          <div className="shrink-0 flex items-center gap-6 text-[104px] text-zinc-300">
            <span className="inline-block w-28 h-3 bg-white rounded" aria-hidden />
            dagsmål
          </div>
        )}
      </div>

      {days.length === 0 ? (
        <div className="flex-1 min-h-0 flex items-center justify-center text-[160px] text-zinc-300">{DASH}</div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-7 gap-6 mt-10">
          {days.map((d) => (
            <DayColumn key={d.date} day={d} scale={scale} />
          ))}
        </div>
      )}
    </div>
  );
}
