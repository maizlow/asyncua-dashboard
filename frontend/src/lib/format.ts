// Swedish number / duration formatting for the TV screens.

const intFmt = new Intl.NumberFormat("sv-SE", { maximumFractionDigits: 0 });
const oneDecFmt = new Intl.NumberFormat("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const DASH = "–";

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
