// The built-in OEE and 7-day screens as chart elements. The built-ins render exactly these items
// (screens/OeeScreen.tsx, screens/WeekScreen.tsx); docs/examples/oee-element.yaml and
// docs/examples/7dagar-element.yaml rebuild the screens from the same elements in the editor's grid
// (scripts/test-charts.mjs checks that the examples match).
import type { ChartItem } from "./metrics";

const at = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

export const OEE_SCREEN = {
  breakdown: { id: "oee-breakdown", kind: "breakdown", label: "OEE", ...at(0, 0, 11, 8) },
  progress: { id: "oee-progress", kind: "progress", label: "Produktion", ...at(11, 0, 13, 8) },
  speed: { id: "oee-speed", kind: "kpi", label: "Takt · TPM", metric: "speed", sub_metric: "nominal", sub_text: "av", ...at(0, 8, 6, 4) },
  scrap: { id: "oee-scrap", kind: "kpi", label: "Kassation", metric: "reject", sub_metric: "scrap_pct", ...at(6, 8, 6, 4) },
  stops: { id: "oee-stops", kind: "kpi", label: "Stopp", metric: "stop_count", aside: "stopped", sub_metric: "stop_time", sub_text: "{} totalt", ...at(12, 8, 6, 4) },
  remaining: { id: "oee-remaining", kind: "kpi", label: "Skift kvar", metric: "remaining", sub_metric: "shift_window", ...at(18, 8, 6, 4) },
} satisfies Record<string, ChartItem>;

export const WEEK_SCREEN: ChartItem = {
  id: "week-bars", kind: "bars", label: "7 dagar · OEE % · godkända st", series: "days", count: 7, metric: "good", top_metric: "oee", ...at(0, 0, 24, 12),
};
