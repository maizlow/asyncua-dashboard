import { createContext, useContext } from "react";
import { useMetricsStore } from "@/stores/useMetricsStore";
import type { ChartData } from "./metrics";

/** Overrides the live stores (the editor preview and the legibility check render sample/worst-case data) */
export const ChartDataContext = createContext<ChartData | null>(null);

/** What the chart elements read: the context if given, else the live stores */
export function useChartData(): ChartData {
  const ctx = useContext(ChartDataContext);
  const metrics = useMetricsStore((s) => s.metrics);
  const connected = useMetricsStore((s) => s.connected);
  const histories = useMetricsStore((s) => s.histories);
  const details = useMetricsStore((s) => s.oeeDetails);
  const aggregates = useMetricsStore((s) => s.aggregates);
  return ctx ?? { metrics, connected, histories, details, aggregates };
}
