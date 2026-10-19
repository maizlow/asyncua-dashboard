/**
 * Simulated values for the editor preview (live and demo alike: the editor never reads the PLC).
 * Typical values for each element type; a tag's `demo:` value from the document wins.
 */
import type { MetricValue } from "@/data/types";
import type { ItemConfig, Layout } from "@/layout/layout";

function hms(s: number): string {
  const p = (n: number) => String(Math.floor(n)).padStart(2, "0");
  return `${p(s / 3600)}:${p((s % 3600) / 60)}:${p(s % 60)}`;
}

function typical(item: ItemConfig): MetricValue {
  switch (item.type) {
    case "percent":
      return 86.4;
    case "counter":
      return 45832;
    case "time":
      return "05:50:13";
    case "status":
      return Object.keys(item.states ?? {})[0] ?? 1;
    default:
      return 123.4;
  }
}

export function simulatedMetrics(layout: Layout): Record<string, MetricValue> {
  const out: Record<string, MetricValue> = {};
  for (const screen of layout.screens)
    for (const item of screen.items) {
      const demo = layout.tags[item.tag]?.demo;
      if (typeof demo === "number") out[item.tag] = item.type === "time" ? hms(demo) : demo;
      else if (Array.isArray(demo)) out[item.tag] = Math.round(((demo[0] + demo[1]) / 2) * 10) / 10;
      else out[item.tag] = typical(item);
      if (typeof item.target === "string") out[item.target] ??= item.type === "counter" ? 71400 : 85;
    }
  return out;
}
