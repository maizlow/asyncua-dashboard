import type { ReactNode } from "react";
import { useMetricsStore } from "@/stores/useMetricsStore";
import type { OeeDetails } from "@/data/types";
import { DASH, fmtClock, fmtDec1, fmtHM, fmtInt, fmtMinutes, fmtPct } from "@/lib/format";

// Laid out for the 3840x2160 canvas (see ScaledCanvas). Display-only, read from 8-10 m on a 65" TV:
// hero values 290 px mono (>= 180 px cap on the canvas = >= 90 px at 1080p), key values 220 px,
// secondary values 140 px, labels >= 104 px (>= ~37 px cap at 1080p). Fixed grid rows, no growth.
// Status is never colour-only: ▼ = under target / ▲ = over limit, plus words such as "UNDER MÅL".

const GREEN = "var(--accent-green)";
const AMBER = "var(--accent-amber)";
const RED = "var(--accent-red)";
const NEUTRAL = "var(--accent-neutral)";

type Status = "good" | "warn" | "bad" | null;
const statusColor = (s: Status) => (s === null ? NEUTRAL : s === "good" ? GREEN : s === "warn" ? AMBER : RED);

/** OEE world-class-ish thresholds for a roof tile line (realistic target 80-85 %). */
const oeeStatus = (f: number | null): Status => (f === null ? null : f >= 0.85 ? "good" : f >= 0.75 ? "warn" : "bad");
const factorStatus = (f: number | null): Status => (f === null ? null : f >= 0.9 ? "good" : f >= 0.8 ? "warn" : "bad");
const scrapStatus = (pct: number | null | undefined): Status =>
  pct === null || pct === undefined ? null : pct <= 2 ? "good" : pct <= 3 ? "warn" : "bad";

function Card({
  title,
  aside,
  children,
  className = "",
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      data-fit
      className={`bg-zinc-900 border border-zinc-800 rounded-[48px] px-14 py-8 flex flex-col min-h-0 min-w-0 overflow-hidden ${className}`}
    >
      <div className="flex items-baseline justify-between gap-8 leading-none whitespace-nowrap min-w-0">
        <div className="text-[110px] text-zinc-300 uppercase tracking-wide font-medium tv-truncate">{title}</div>
        {aside && <div className="text-[110px] font-bold uppercase shrink-0">{aside}</div>}
      </div>
      <div className="flex-1 min-h-0 flex flex-col justify-center min-w-0">{children}</div>
    </div>
  );
}

function TargetStatus({ ok }: { ok: boolean | null }) {
  if (ok === null) return null;
  return ok ? <span style={{ color: GREEN }}>● PÅ MÅL</span> : <span style={{ color: AMBER }}>▼ UNDER MÅL</span>;
}

function FactorRow({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value * 100));
  const s = factorStatus(value);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-8 leading-none whitespace-nowrap">
        <span className="text-[110px] text-zinc-300 tv-truncate">{label}</span>
        <span className="text-[140px] font-mono font-bold tabular-nums shrink-0" style={{ color: statusColor(s) }}>
          {s !== null && s !== "good" && "▼ "}
          {fmtPct(value)}
          <span className="text-[104px] font-sans font-normal text-zinc-300 ml-4">%</span>
        </span>
      </div>
      <div className="h-5 bg-zinc-800 rounded-full mt-3 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, backgroundColor: statusColor(s) }}
        />
      </div>
    </div>
  );
}

function OeeCard({ d }: { d: OeeDetails | null }) {
  const oee = d?.oee.oee ?? null;
  const s = oeeStatus(oee);
  return (
    <Card title="OEE" aside={<TargetStatus ok={s === null ? null : s === "good"} />}>
      <div className="flex items-baseline gap-6 leading-none whitespace-nowrap">
        <span className="text-[290px] font-mono font-bold tracking-[-6px] tabular-nums" style={{ color: statusColor(s) }}>
          {fmtPct(oee)}
        </span>
        <span className="text-[120px] text-zinc-300">%</span>
      </div>
      <div className="space-y-6 mt-10">
        <FactorRow label="Tillgänglighet" value={d?.oee.availability ?? null} />
        <FactorRow label="Prestanda" value={d?.oee.performance ?? null} />
        <FactorRow label="Kvalitet" value={d?.oee.quality ?? null} />
      </div>
    </Card>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[110px] text-zinc-300 leading-none whitespace-nowrap">{label}</div>
      <div
        className="text-[140px] font-mono font-bold mt-5 leading-none whitespace-nowrap tabular-nums"
        style={color ? { color } : undefined}
      >
        {value}
      </div>
    </div>
  );
}

function ProductionCard({ d }: { d: OeeDetails | null }) {
  const good = d?.counts.good ?? null;
  const shiftTarget = d?.target?.shift ?? null;
  const soFar = d?.target?.so_far ?? null;
  const progress = good !== null && shiftTarget ? Math.min(100, (good / shiftTarget) * 100) : 0;
  const soFarPos = soFar !== null && shiftTarget ? Math.min(100, (soFar / shiftTarget) * 100) : null;
  const onTarget = good === null || soFar === null ? null : good >= soFar;

  return (
    <Card title="Produktion" aside={<TargetStatus ok={onTarget} />}>
      <div className="flex items-baseline gap-8 leading-none whitespace-nowrap min-w-0">
        <span className="text-[290px] font-mono font-bold tracking-[-6px] tabular-nums">{fmtInt(good)}</span>
        <span className="text-[110px] text-zinc-300 tv-truncate">st godkända</span>
      </div>

      {/* Progress vs shift target, marker = target so far */}
      <div className="relative h-24 bg-zinc-800 rounded-full mt-14">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${progress}%`, backgroundColor: onTarget === false ? AMBER : GREEN }}
        />
        {soFarPos !== null && (
          <div className="absolute -top-6 -bottom-6 w-4 bg-white rounded" style={{ left: `calc(${soFarPos}% - 8px)` }} />
        )}
      </div>

      <div className="flex justify-between gap-12 mt-16 min-w-0">
        <Stat label="Mål hittills" value={fmtInt(soFar)} />
        <Stat label="Skiftmål" value={fmtInt(shiftTarget)} />
        <Stat label="Prognos" value={fmtInt(d?.target?.prognosis ?? null)} />
      </div>
    </Card>
  );
}

function BigValue({ value, unit, color, extra }: { value: string; unit?: string; color?: string; extra?: ReactNode }) {
  return (
    <div className="flex items-baseline leading-none whitespace-nowrap min-w-0">
      <span className="text-[220px] font-mono font-bold tracking-[-4px] tabular-nums" style={color ? { color } : undefined}>
        {value}
      </span>
      {unit && <span className="text-[110px] text-zinc-300 ml-6">{unit}</span>}
      {extra}
    </div>
  );
}

function SubLine({ children }: { children: ReactNode }) {
  return (
    <div className="mt-8 min-w-0">
      <div className="text-[110px] text-zinc-300 tv-truncate">{children}</div>
    </div>
  );
}

export function OeeScreen() {
  const d = useMetricsStore((s) => s.oeeDetails);
  const speed = d?.speed.current ?? null;
  const stops = d?.stops ?? null;
  const stopped = stops?.running === false;
  const scrapPct = d?.counts.scrap_pct ?? null;
  const scrapS = scrapStatus(scrapPct);

  return (
    <div data-fit className="h-full min-h-0 grid grid-rows-[2fr_1fr] gap-12 px-16 pt-12 pb-14 overflow-hidden">
      {/* Row 1: OEE breakdown + production vs target */}
      <div className="grid grid-cols-[11fr_13fr] gap-12 min-h-0">
        <OeeCard d={d} />
        <ProductionCard d={d} />
      </div>

      {/* Row 2: speed, scrap, stops, shift */}
      <div className="grid grid-cols-4 gap-12 min-h-0">
        <Card title="Takt · TPM">
          <BigValue value={speed === null ? DASH : fmtInt(speed)} unit={`/ ${fmtInt(d?.speed.nominal)}`} />
        </Card>
        <Card title="Kassation">
          <BigValue value={fmtInt(d?.counts.reject ?? null)} unit="st" />
          <SubLine>
            <span className="font-mono font-bold text-[120px]" style={{ color: statusColor(scrapS) }}>
              {scrapS !== null && scrapS !== "good" && "▲ "}
              {fmtDec1(scrapPct)} %
            </span>
          </SubLine>
        </Card>
        <Card title="Stopp">
          <BigValue
            value={stops ? fmtInt(stops.count) : DASH}
            unit="st"
            color={stopped ? RED : undefined}
            extra={stopped ? <span className="text-[110px] font-bold ml-10" style={{ color: RED }}>■ STÅR</span> : undefined}
          />
          <SubLine>
            <span className="text-zinc-100">{fmtMinutes(stops?.total_s ?? null)}</span> totalt
          </SubLine>
        </Card>
        <Card title="Skift kvar">
          <BigValue value={fmtHM(d?.shift?.remaining_s ?? null)} unit="h" />
          <SubLine>
            <span className="font-mono">
              {d?.shift ? `${fmtClock(d.shift.start)}–${fmtClock(d.shift.end)}` : DASH}
            </span>
          </SubLine>
        </Card>
      </div>
    </div>
  );
}
