import type { ReactNode } from "react";
import { useMetricsStore } from "@/stores/useMetricsStore";
import type { OeeDetails } from "@/data/types";
import { DASH, fmtClock, fmtDec1, fmtHM, fmtInt, fmtMinutes, fmtPct, fmtWholeMinutes } from "@/lib/format";

// Laid out for the 3840x2160 canvas (see ScaledCanvas). Display-only, read from a distance.

const GREEN = "var(--accent-green)";
const AMBER = "#f59e0b";
const RED = "var(--accent-red)";

/** OEE world-class-ish thresholds for a roof tile line (realistic target 80-85 %). */
const oeeColor = (f: number | null) => (f === null ? "#a1a1aa" : f >= 0.85 ? GREEN : f >= 0.75 ? AMBER : RED);
const factorColor = (f: number | null) => (f === null ? "#a1a1aa" : f >= 0.9 ? GREEN : f >= 0.8 ? AMBER : RED);

function Card({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div data-fit className={`bg-zinc-900 border border-zinc-800 rounded-[48px] px-14 py-10 flex flex-col min-h-0 min-w-0 ${className}`}>
      <div className="text-7xl text-zinc-400 uppercase tracking-wide font-medium leading-none">{title}</div>
      <div className="flex-1 min-h-0 flex flex-col justify-center">{children}</div>
    </div>
  );
}

function FactorBar({ label, value }: { label: string; value: number | null }) {
  const pct = value === null ? 0 : Math.min(100, Math.max(0, value * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between leading-none">
        <span className="text-6xl text-zinc-300">{label}</span>
        <span className="text-7xl font-mono font-semibold" style={{ color: factorColor(value) }}>
          {fmtPct(value)}
          <span className="text-5xl text-zinc-400 ml-3">%</span>
        </span>
      </div>
      <div className="h-8 bg-zinc-800 rounded-full mt-4 overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${pct}%`, backgroundColor: factorColor(value) }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-6xl text-zinc-400 leading-none">{label}</div>
      <div className="text-8xl font-mono font-semibold mt-5 leading-none whitespace-nowrap">
        {value}
        {unit && <span className="text-6xl text-zinc-400 ml-4">{unit}</span>}
      </div>
    </div>
  );
}

function OeeCard({ d }: { d: OeeDetails | null }) {
  const oee = d?.oee.oee ?? null;
  return (
    <Card title="OEE" className="flex-[4]">
      <div className="flex items-baseline gap-6 leading-none mt-8">
        <span className="text-[200px] font-mono font-bold tracking-[-6px]" style={{ color: oeeColor(oee) }}>
          {fmtPct(oee)}
        </span>
        <span className="text-8xl text-zinc-400">%</span>
      </div>
      <div className="space-y-6 mt-8">
        <FactorBar label="Tillgänglighet" value={d?.oee.availability ?? null} />
        <FactorBar label="Prestanda" value={d?.oee.performance ?? null} />
        <FactorBar label="Kvalitet" value={d?.oee.quality ?? null} />
      </div>
    </Card>
  );
}

function ProductionCard({ d }: { d: OeeDetails | null }) {
  const good = d?.counts.good ?? null;
  const shiftTarget = d?.target?.shift ?? null;
  const soFar = d?.target?.so_far ?? null;
  const progress = good !== null && shiftTarget ? Math.min(100, (good / shiftTarget) * 100) : 0;
  const soFarPos = soFar !== null && shiftTarget ? Math.min(100, (soFar / shiftTarget) * 100) : null;

  return (
    <Card title="Produktion vs mål" className="flex-[6]">
      <div className="flex items-baseline leading-none">
        <div className="flex items-baseline gap-6">
          <span className="text-[220px] font-mono font-bold tracking-[-6px]">{fmtInt(good)}</span>
          <span className="text-8xl text-zinc-400">st godkända</span>
        </div>
      </div>

      {/* Progress vs shift target, marker = target so far */}
      <div className="relative h-24 bg-zinc-800 rounded-full mt-12">
        <div
          className="h-full rounded-full transition-all duration-1000"
          style={{ width: `${progress}%`, backgroundColor: GREEN }}
        />
        {soFarPos !== null && (
          <div className="absolute -top-6 -bottom-6 w-3 bg-white rounded" style={{ left: `calc(${soFarPos}% - 6px)` }} />
        )}
      </div>

      <div className="grid grid-cols-3 gap-12 mt-14">
        <Stat label="Mål hittills" value={fmtInt(soFar)} unit="st" />
        <Stat label="Skiftmål" value={fmtInt(shiftTarget)} unit="st" />
        <Stat label="Prognos skiftslut" value={fmtInt(d?.target?.prognosis ?? null)} unit="st" />
      </div>
    </Card>
  );
}

function BigValue({
  value,
  unit,
  color,
  size = "text-[170px]",
}: {
  value: string;
  unit?: string;
  color?: string;
  size?: string;
}) {
  return (
    <div className="leading-none whitespace-nowrap">
      <span className={`${size} font-mono font-bold tracking-[-4px]`} style={color ? { color } : undefined}>
        {value}
      </span>
      {unit && <span className="text-7xl text-zinc-400 ml-5">{unit}</span>}
    </div>
  );
}

function SubLine({ children }: { children: ReactNode }) {
  return <div className="text-6xl text-zinc-400 mt-8 leading-tight whitespace-nowrap">{children}</div>;
}

function HourlyRow({ d }: { d: OeeDetails | null }) {
  const rows = d?.hourly ?? [];
  const perHourTarget = (d?.nominal_tpm ?? 140) * 60;
  return (
    <Card title="Godkända per timme" className="flex-1">
      <div className="flex items-end gap-6 h-full pt-6">
        {rows.length === 0 && <div className="text-7xl text-zinc-500">{DASH}</div>}
        {rows.map((r, i) => {
          const h = r.good === null ? 0 : Math.min(100, (r.good / perHourTarget) * 100);
          // Colour = pace within the elapsed part of the hour (so the current hour isn't "red")
          const expected = ((r.elapsed_s ?? 3600) / 3600) * perHourTarget;
          const ratio = r.good === null || expected <= 0 ? null : r.good / expected;
          return (
            <div key={`${r.time}-${i}`} className="flex-1 min-w-0 flex flex-col items-center justify-end h-full">
              <div className="text-5xl font-mono text-zinc-200 mb-3 leading-none">{r.good === null ? "" : fmtInt(r.good)}</div>
              <div className="w-full flex-1 min-h-0 flex items-end">
                <div
                  className="w-full rounded-t-2xl transition-all duration-1000"
                  style={{ height: `${h}%`, backgroundColor: r.good === null ? "transparent" : oeeColor(ratio) }}
                />
              </div>
              <div className="text-5xl text-zinc-400 mt-3 leading-none">{r.time}</div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export function OeeScreen() {
  const d = useMetricsStore((s) => s.oeeDetails);
  const speed = d?.speed.current ?? null;
  const stops = d?.stops ?? null;

  return (
    <div data-fit className="h-full min-h-0 flex flex-col gap-12 px-16 pt-12 pb-14">
      {/* Row 1: OEE breakdown + production vs target */}
      <div className="flex gap-12 flex-[8] min-h-0">
        <OeeCard d={d} />
        <ProductionCard d={d} />
      </div>

      {/* Row 2: speed, scrap, stops, shift */}
      <div className="grid grid-cols-4 gap-12 flex-[5] min-h-0">
        <Card title="Takt">
          <BigValue value={speed === null ? DASH : fmtInt(speed)} unit={`/ ${fmtInt(d?.speed.nominal)} TPM`} />
          <SubLine>{fmtDec1(d?.speed.pct ?? null)} % av nominell</SubLine>
        </Card>
        <Card title="Kassation">
          <BigValue value={fmtInt(d?.counts.reject ?? null)} unit="st" />
          <SubLine>
            <span
              className="font-mono font-semibold text-7xl"
              style={{
                color:
                  d?.counts.scrap_pct == null ? undefined : d.counts.scrap_pct <= 2 ? GREEN : d.counts.scrap_pct <= 3 ? AMBER : RED,
              }}
            >
              {fmtDec1(d?.counts.scrap_pct ?? null)} %
            </span>{" "}
            av total
          </SubLine>
        </Card>
        <Card title="Stopp">
          <BigValue
            value={stops ? fmtInt(stops.count) : DASH}
            unit={stops ? `st · ${fmtMinutes(stops.total_s)}` : undefined}
            color={stops?.running === false ? RED : undefined}
          />
          <SubLine>
            Längsta <span className="text-zinc-200">{fmtMinutes(stops?.longest_s ?? null)}</span>
          </SubLine>
          <div className="grid grid-cols-2 gap-6 text-5xl text-zinc-400 mt-6 whitespace-nowrap">
            <div>
              MTBF <span className="text-zinc-200">{fmtWholeMinutes(stops?.mtbf_s ?? null)}</span>
            </div>
            <div>
              MTTR <span className="text-zinc-200">{fmtWholeMinutes(stops?.mttr_s ?? null)}</span>
            </div>
          </div>
        </Card>
        <Card title="Skift">
          <BigValue
            size="text-[110px]"
            value={d?.shift ? `${fmtClock(d.shift.start)}–${fmtClock(d.shift.end)}` : DASH}
          />
          <SubLine>
            Gått <span className="font-mono text-zinc-200">{fmtHM(d?.shift?.elapsed_s ?? null)}</span> · Kvar{" "}
            <span className="font-mono text-zinc-200">{fmtHM(d?.shift?.remaining_s ?? null)}</span>
          </SubLine>
        </Card>
      </div>

      {/* Row 3: good tiles per hour */}
      <div className="flex flex-[5] min-h-0">
        <HourlyRow d={d} />
      </div>
    </div>
  );
}
