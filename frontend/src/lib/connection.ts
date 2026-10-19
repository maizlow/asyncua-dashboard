/**
 * Values are keyed by qualified tag (plc1.OEE): a display can read several PLCs, and PLCs are shared
 * between displays. Each PLC reports its own connection status; an element bound to a PLC that is
 * down shows "–" with a marker, while elements of the other PLCs keep updating.
 */
import type { MetricValue } from "@/data/types";

/** "plc2.OEE" -> "plc2" (references in the view are always qualified) */
export function connectionOf(ref: string): string {
  const i = ref.indexOf(".");
  return i >= 0 ? ref.slice(0, i) : "";
}

/** Key for a value pushed by the backend for one connection (short tag name within it) */
export function qualifiedKey(connection: string | undefined, key: string): string {
  return connection ? `${connection}.${key}` : key;
}

/** Value of a bound reference; `down` when its PLC reported a lost connection (unknown = up). */
export function bound(
  metrics: Record<string, MetricValue>,
  connected: Record<string, boolean>,
  ref: string,
): { value: MetricValue | undefined; down: boolean } {
  const down = connected[connectionOf(ref)] === false;
  return { value: down ? undefined : metrics[ref], down };
}
