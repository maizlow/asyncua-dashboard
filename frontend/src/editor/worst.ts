/**
 * Worst-case values for the legibility check (like docs/examples/stress.yaml): six-digit counts and
 * targets, 100,0 %, five-digit negative numbers (or the tag's demo range), the longest status text,
 * and a typical trend change.
 */
import type { MetricValue } from "@/data/types";
import type { Layout, ScreenConfig } from "@/layout/layout";

export function worstValues(screen: ScreenConfig, tags: Layout["tags"] = {}): { values: Record<string, MetricValue>; histories: Record<string, MetricValue[]> } {
  const values: Record<string, MetricValue> = {};
  const histories: Record<string, MetricValue[]> = {};
  for (const item of screen.items) {
    let v: MetricValue;
    switch (item.type) {
      case "counter":
        v = 999999;
        break;
      case "percent":
        v = 100;
        break;
      case "time":
        v = "23:59:59";
        break;
      case "status": {
        const states = Object.entries(item.states ?? {});
        v = states.length ? Number(states.reduce((a, b) => (b[1].text.length > a[1].text.length ? b : a))[0]) : 1;
        break;
      }
      default: {
        // The tag's demo range if it has one (its real span), else five significant digits, negative
        const demo = tags[item.tag]?.demo;
        if (Array.isArray(demo)) v = Math.abs(demo[0]) > Math.abs(demo[1]) ? demo[0] : demo[1];
        else if (typeof demo === "number") v = demo;
        else {
          const d = item.decimals ?? 1;
          v = -Number("9".repeat(Math.max(1, 5 - d)) + (d ? `.${"9".repeat(d)}` : ""));
        }
      }
    }
    values[item.tag] = v;
    if (typeof item.target === "string") values[item.target] = 999999;
    // Trend: a typical change (the value's width is the worst case; the fit check uses the same)
    if (item.trend && typeof v === "number") histories[item.tag] = [v + (item.type === "counter" ? 1 : item.type === "percent" ? 1.2 : 12.3), v];
  }
  return { values, histories };
}
