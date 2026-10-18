import { MetricCard } from "@/components/MetricCard";
import { useLiveMetrics } from "@/hooks/useLiveMetrics";
import type { MetricValue } from "@/data/types";

const toNumber = (v: MetricValue | undefined, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const toNumbers = (values: MetricValue[] | undefined): number[] =>
  (values ?? []).map((v) => toNumber(v)).filter((n) => Number.isFinite(n));

// 2 columns x 3 fixed rows so the 290 px hero values (incl. "00:00:00") fit side by side.
export function DashboardScreen() {
  const { metrics, histories } = useLiveMetrics();

  return (
    <div data-fit className="h-full min-h-0 grid grid-cols-2 grid-rows-3 gap-12 px-16 pt-12 pb-14 overflow-hidden">
      <MetricCard
        label="Produktion"
        value={metrics.ProductionCount ?? 0}
        unit="st"
        target={toNumber(metrics.TargetCount)}
      />

      <MetricCard
        label="Delta"
        value={metrics.ProductionDelta ?? 0}
        unit="st"
        history={toNumbers(histories.ProductionDelta)}
      />

      <MetricCard label="OEE" value={metrics.OEE ?? 0.0} unit="%" history={toNumbers(histories.OEE)} />

      <MetricCard label="Linjehastighet" value={metrics.TPM ?? 0.0} unit="TPM" history={toNumbers(histories.TPM)} />

      <MetricCard label="Aktuell körtid" value={metrics.CurrentRuntime ?? "00:00:00"} />

      <MetricCard
        label="Total stopptid"
        value={metrics.AccumulatedStoptime ?? "00:00:00"}
        valueColor="var(--accent-red)"
      />
    </div>
  );
}
