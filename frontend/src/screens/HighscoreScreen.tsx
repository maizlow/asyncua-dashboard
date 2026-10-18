import { useEffect, useState } from "react";
import { useFit } from "@/hooks/useFit";
import { useMetricsStore } from "@/stores/useMetricsStore";
import { fmtDuration, fmtStamp, highscoreRows, versusRecord, type HsRow } from "@/lib/highscore";

// Run-time highscores (screen type: highscore): the five longest runs without a stop, laid out for the
// 3840x2160 canvas (see ScaledCanvas). Columns: Körd tid (hh:mm:ss), Skiftlag, Datumstämpel. The record
// (row 1) is the hero (290 px mono ≈ 96 px cap height at 1080p), rows 2-5 200 px (≈ 66 px), labels ≥ 37 px.
// Runs started in the current shift are highlighted (light frame, like "Idag" on the 7-day screen); the
// ongoing run is green, counts up every second and joins the list once it is long enough. Values only
// shrink (never below FIT_MIN_PX) if they would not fit their column. Nothing scrolls.

const GREEN = "var(--accent-green)";
const AMBER = "var(--accent-amber)";
const RED = "var(--accent-red)";
const COLS = "190px minmax(0, 1fr) 640px 1080px";

const SIZES = {
  hero: { rank: 230, time: 282, team: 210, stamp: 150 },
  rest: { rank: 150, time: 190, team: 150, stamp: 130 },
};

function useNow(intervalMs: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Row({ row, hero }: { row: HsRow; hero: boolean }) {
  const size = hero ? SIZES.hero : SIZES.rest;
  const time = fmtDuration(row.duration_s);
  const team = row.duration_s === null ? "" : (row.team ?? "–");
  const stamp = row.live ? "PÅGÅR" : row.duration_s === null ? "" : fmtStamp(row.start);
  const timeRef = useFit<HTMLDivElement>(size.time, [time]);
  const teamRef = useFit<HTMLDivElement>(size.team, [team]);
  const stampRef = useFit<HTMLDivElement>(size.stamp, [stamp]);
  const highlight = row.currentShift || row.live;
  return (
    <div
      data-fit
      className={`grid items-center gap-x-12 rounded-[40px] border-4 px-10 min-h-0 overflow-hidden ${
        highlight ? "bg-zinc-800 border-zinc-200" : "bg-zinc-900 border-zinc-800"
      }`}
      style={{ gridTemplateColumns: COLS }}
    >
      <div
        className="font-bold leading-[1.2] tabular-nums text-center"
        style={{ fontSize: size.rank, color: hero && row.duration_s !== null ? AMBER : "#d4d4d8" }}
      >
        {row.rank}
      </div>
      <div
        ref={timeRef}
        data-hs-value
        className="min-w-0 whitespace-nowrap leading-[1.07] font-mono font-bold tabular-nums tracking-[-4px]"
        style={row.live ? { color: GREEN } : undefined}
      >
        {time}
      </div>
      <div ref={teamRef} data-hs-value className="min-w-0 whitespace-nowrap leading-[1.2] font-bold">
        {team}
      </div>
      <div
        ref={stampRef}
        data-hs-value
        className={`min-w-0 whitespace-nowrap leading-[1.2] ${row.live ? "font-bold" : "font-mono text-zinc-300"}`}
        style={row.live ? { color: GREEN } : undefined}
      >
        {stamp}
      </div>
    </div>
  );
}

export function HighscoreScreen() {
  const data = useMetricsStore((s) => s.highscores);
  const at = useMetricsStore((s) => s.highscoresAt);
  const state = useMetricsStore((s) => s.metrics.ProductionState);
  const now = useNow(1000);
  const cur = data?.current ?? null;
  const live = cur ? cur.duration_s + (cur.running ? Math.max(0, (now - at) / 1000) : 0) : null;
  const rows = highscoreRows(data, live);
  const record = data?.records[0]?.duration_s ?? null;
  const vs = versusRecord(live, record);
  const stopped = !cur && state !== undefined && state !== null && Number(state) !== 2;

  return (
    <div data-fit className="h-full min-h-0 flex flex-col px-16 pt-10 pb-10 overflow-hidden">
      <div className="text-[110px] text-zinc-300 uppercase tracking-wide font-medium leading-none whitespace-nowrap">
        Körtids-highscore · längsta körning utan stopp
      </div>

      {/* Column labels */}
      <div className="grid gap-x-12 px-10 mt-6 text-[104px] text-zinc-400 leading-none whitespace-nowrap" style={{ gridTemplateColumns: COLS }}>
        <div />
        <div>Körd tid</div>
        <div>Skiftlag</div>
        <div>Datumstämpel</div>
      </div>

      <div className="flex-1 min-h-0 grid gap-3 mt-4" style={{ gridTemplateRows: "1.45fr repeat(4, 1fr)" }}>
        {rows.map((r, i) => (
          <Row key={r.rank} row={r} hero={i === 0} />
        ))}
      </div>

      {/* Ongoing run vs the record */}
      <div className="mt-6 rounded-[40px] bg-zinc-900 border-4 border-zinc-800 px-10 py-5 flex items-baseline justify-between gap-12 whitespace-nowrap leading-none">
        <div className="flex items-baseline gap-10 min-w-0">
          <span className="text-[110px] text-zinc-300">Pågående</span>
          <span data-hs-value className="text-[200px] font-mono font-bold tabular-nums tracking-[-4px]" style={cur ? { color: GREEN } : undefined}>
            {fmtDuration(live)}
          </span>
        </div>
        <div className="flex items-baseline gap-10 shrink-0">
          {vs.newRecord ? (
            <span className="text-[130px] font-bold" style={{ color: GREEN }}>▲ NYTT REKORD</span>
          ) : cur && vs.left_s !== null ? (
            <>
              <span className="text-[110px] text-zinc-300">rekord om</span>
              <span className="text-[160px] font-mono font-bold tabular-nums tracking-[-3px]">{fmtDuration(vs.left_s)}</span>
            </>
          ) : stopped ? (
            <span className="text-[130px] font-bold" style={{ color: RED }}>LINJEN STÅR</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
