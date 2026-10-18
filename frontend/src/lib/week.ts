// Pure helpers for the 7-day screen (screens/WeekScreen.tsx). Formulas: docs/BERAKNINGAR.md.

export const WEEKDAYS_SV = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

/** "2026-10-12" -> { weekday: "Mån", date: "12/10" }; today -> "Idag". Uses the date string, not the browser zone. */
export function dayLabel(isoDate: string, today: boolean): { weekday: string; date: string } {
  const [y, m, d] = isoDate.split("-").map(Number);
  if (!y || !m || !d) return { weekday: today ? "Idag" : "–", date: "" };
  const wd = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Monday
  return { weekday: today ? "Idag" : WEEKDAYS_SV[wd], date: `${d}/${m}` };
}

/** Bar colour: good >= target -> "good", below -> "warn", no target or no count -> null (neutral). */
export function barStatus(good: number | null, target: number | null): "good" | "warn" | null {
  if (good === null || target === null || !Number.isFinite(good) || !Number.isFinite(target) || target <= 0) return null;
  return Math.round(good) >= Math.round(target) ? "good" : "warn";
}

/** Common scale for all bars: the largest good count or target of the shown days (>= 1). */
export function barScale(days: { good: number | null; target: number | null }[]): number {
  let max = 0;
  for (const d of days) {
    if (d.good !== null && Number.isFinite(d.good)) max = Math.max(max, d.good);
    if (d.target !== null && Number.isFinite(d.target)) max = Math.max(max, d.target);
  }
  return max > 0 ? max : 1;
}

/** Height in % of the bar area (0-100). */
export function barPct(value: number | null, scale: number): number {
  if (value === null || !Number.isFinite(value) || scale <= 0) return 0;
  return Math.min(100, Math.max(0, (value / scale) * 100));
}
