import { useMetricsStore } from "@/stores/useMetricsStore";

export function useLiveMetrics() {
  const metrics = useMetricsStore((s) => s.metrics);
  const histories = useMetricsStore((s) => s.histories);
  return { metrics, histories };
}
