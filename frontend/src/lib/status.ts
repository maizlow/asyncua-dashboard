// Status (colour, ▲/▼, PÅ MÅL/UNDER MÅL) for the TV screens. Every comparison uses the value
// rounded exactly as it is displayed, so "85,0 %" is never shown as under an 85 % goal.
// Formulas: docs/BERAKNINGAR.md.

export type Status = "good" | "warn" | "bad";

/** Round like the display (toFixed / Intl both round the exact value half away from zero). */
export function roundShown(n: number, decimals: number): number {
  const d = Math.max(0, Math.min(3, Math.round(decimals)));
  return Number(n.toFixed(d));
}

/** Grid item thresholds [lower, upper] on the displayed value. */
export function thresholdStatus(
  v: number,
  thresholds: [number, number] | undefined,
  better: "high" | "low",
  decimals: number,
): Status | null {
  if (!thresholds) return null;
  const [a, b] = thresholds;
  const x = roundShown(v, decimals);
  if (better === "low") return x <= a ? "good" : x <= b ? "warn" : "bad";
  return x >= b ? "good" : x >= a ? "warn" : "bad";
}

/** Default OEE goal when the PLC tag OeeTarget is empty (same as the backend). */
export const DEFAULT_OEE_TARGET_PCT = 85;
/** Amber band below the OEE goal (85 % goal -> amber from 75 %). */
export const OEE_WARN_BAND_PCT = 10;

/** OEE (fraction 0..1, shown as % with 1 decimal) against the goal in %. */
export function oeeStatus(fraction: number | null, targetPct: number = DEFAULT_OEE_TARGET_PCT): Status | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  const pct = roundShown(fraction * 100, 1);
  return pct >= targetPct ? "good" : pct >= targetPct - OEE_WARN_BAND_PCT ? "warn" : "bad";
}

/** Tillgänglighet / Prestanda / Kvalitet (fraction, shown as % with 1 decimal). */
export function factorStatus(fraction: number | null): Status | null {
  if (fraction === null || !Number.isFinite(fraction)) return null;
  const pct = roundShown(fraction * 100, 1);
  return pct >= 90 ? "good" : pct >= 80 ? "warn" : "bad";
}

/** Kassation % (shown with 1 decimal). */
export function scrapStatus(pct: number | null | undefined): Status | null {
  if (pct === null || pct === undefined || !Number.isFinite(pct)) return null;
  const x = roundShown(pct, 1);
  return x <= 2 ? "good" : x <= 3 ? "warn" : "bad";
}

/** Produktion PÅ MÅL: good >= target so far (both shown as whole numbers). null = no badge. */
export function productionOnTarget(good: number | null, soFar: number | null): boolean | null {
  if (good === null || soFar === null || !Number.isFinite(good) || !Number.isFinite(soFar)) return null;
  return Math.round(good) >= Math.round(soFar);
}

/** Shift length label for the shift pattern: "8", "8,5" (hours). */
export function shiftHoursLabel(totalMinutes: number): string {
  const h = Math.round((totalMinutes / 60) * 10) / 10;
  return Number.isInteger(h) ? String(h) : h.toFixed(1).replace(".", ",");
}
