// Swedish number / duration formatting for the TV screens.

const intFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const oneDecFmt = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const DASH = "–";

/**
 * Fixed decimals with Swedish decimal comma, also when the fraction is 0 (82 -> "82,0" at 1 decimal).
 * No thousands grouping (keeps the hero width predictable); ASCII minus; "-0,0" -> "0,0".
 */
export function fmtFixed(n: number | null | undefined, decimals: number): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return DASH;
  const d = Math.max(0, Math.min(3, Math.round(decimals)));
  let s = n.toFixed(d);
  if (/^-0(\.0+)?$/.test(s)) s = s.slice(1);
  return s.replace(".", ",");
}

/** Item type as in dashboard.yaml (see layout/layout.ts) */
type NumericItemType = "number" | "percent" | "counter" | string;

/**
 * Decimals for a grid item: `decimals:` from dashboard.yaml if set; otherwise counter 0, percent 1,
 * number 1 once the tag has delivered a decimal value (sticky, so 82,5 -> 82,0 never drops the comma),
 * else 0 (integer tags stay integers).
 */
export function itemDecimals(type: NumericItemType, decimals: number | undefined, seenFraction: boolean): number {
  if (type === "counter") return 0;
  if (decimals !== undefined) return decimals;
  if (type === "percent") return 1;
  return seenFraction ? 1 : 0;
}

export function fmtInt(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? DASH : intFmt.format(Math.round(n));
}

export function fmtPct(fraction: number | null | undefined): string {
  return fraction === null || fraction === undefined || !Number.isFinite(fraction)
    ? DASH
    : oneDecFmt.format(fraction * 100);
}

export function fmtDec1(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? DASH : oneDecFmt.format(n);
}

/** Seconds -> "h:mm" */
export function fmtHM(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  const total = Math.max(0, Math.round(seconds / 60));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** Seconds -> "12 min" / "1 h 05 min" */
export function fmtMinutes(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  const total = Math.max(0, Math.round(seconds / 60));
  if (total < 60) return `${total} min`;
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, "0")} min`;
}

/** ISO timestamp -> local "HH:MM" */
export function fmtClock(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? DASH
    : d.toLocaleTimeString("sv-SE", { hour: "2-digit", minute: "2-digit" });
}

/** Seconds -> "72 min" (always minutes; used for MTBF/MTTR) */
export function fmtWholeMinutes(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return DASH;
  return `${intFmt.format(Math.max(0, Math.round(seconds / 60)))} min`;
}
