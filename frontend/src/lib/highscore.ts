// Pure helpers for the highscore screen (screens/HighscoreScreen.tsx). Definitions: docs/BERAKNINGAR.md.
import type { Highscores } from "@/data/types";

export const HS_ROWS = 5;
const pad = (n: number) => String(n).padStart(2, "0");

/** Seconds -> "hh:mm:ss" (hours may exceed 99); null -> "–". */
export function fmtDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return "–";
  const s = Math.floor(seconds);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

/** ISO time -> sv-SE "14/10 06:12" (local time); another year than `now`: "14/10/25 06:12". */
export function fmtStamp(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return "–";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "–";
  const year = d.getFullYear() === now.getFullYear() ? "" : `/${pad(d.getFullYear() % 100)}`;
  return `${d.getDate()}/${d.getMonth() + 1}${year} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export interface HsRow {
  rank: number;
  duration_s: number | null;
  team: string | null;
  start: string | null;
  /** the ongoing run (counts up) */
  live: boolean;
  /** started in the current shift: highlighted */
  currentShift: boolean;
}

/**
 * Top rows: completed records plus the ongoing run if it is long enough to be on the list, longest
 * first (equal: the earlier run first), padded with empty rows to `n`.
 */
export function highscoreRows(data: Highscores | null, liveDuration: number | null, n = HS_ROWS): HsRow[] {
  const all: Omit<HsRow, "rank">[] = (data?.records ?? []).map((r) => ({
    duration_s: r.duration_s, team: r.team, start: r.start, live: false, currentShift: r.current_shift,
  }));
  if (data?.current && liveDuration !== null && liveDuration > 0)
    all.push({ duration_s: liveDuration, team: data.current.team, start: data.current.start, live: true, currentShift: data.current.current_shift });
  all.sort((a, b) => (b.duration_s ?? 0) - (a.duration_s ?? 0) || String(a.start).localeCompare(String(b.start)));
  const rows: HsRow[] = all.slice(0, n).map((r, i) => ({ ...r, rank: i + 1 }));
  while (rows.length < n) rows.push({ rank: rows.length + 1, duration_s: null, team: null, start: null, live: false, currentShift: false });
  return rows;
}

/** Ongoing run vs the record (longest completed run). */
export function versusRecord(liveDuration: number | null, record: number | null): { newRecord: boolean; left_s: number | null } {
  if (liveDuration === null || record === null) return { newRecord: false, left_s: null };
  return liveDuration > record ? { newRecord: true, left_s: 0 } : { newRecord: false, left_s: record - liveDuration };
}
