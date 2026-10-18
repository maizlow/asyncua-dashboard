import { MetricCard } from "@/components/MetricCard";
import { useLiveMetrics } from "@/hooks/useLiveMetrics";
import type { MetricValue } from "@/data/types";

const toNumber = (v: MetricValue | undefined, fallback = 0): number => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const toNumbers = (values: MetricValue[] | undefined): number[] =>
  (values ?? []).map((v) => toNumber(v)).filter((n) => Number.isFinite(n));

export function DashboardScreen() {
  const { metrics, histories } = useLiveMetrics();

  return (
    <div className="grid grid-cols-3 gap-12 p-8 mt-20 ml-10 mr-10">
      
      <MetricCard
        label="Produktion"
        value={metrics.ProductionCount ?? 0}
        unit="st"
        progressTarget={toNumber(metrics.TargetCount)}
        progressTargetUnit="st"
        showProgressBar={true}
      />

      <MetricCard
        label="Delta"
        value={metrics.ProductionDelta ?? 0}
        unit="st"
        deltaUnit="st"
        showSparkline={true}
        sparklineData={toNumbers(histories.ProductionDelta)}
        sparklineDataAsDelta={true}
      />
      
      <MetricCard
        label="OEE"
        value={metrics.OEE ?? 0.00}
        unit="%"
        showSparkline={true}
        sparklineData={toNumbers(histories.OEE)}
        sparklineDataAsDelta={true}
      />

      <MetricCard
        label="Linjehastighet"
        value={metrics.TPM ?? 0.0}
        unit="TPM"
        deltaUnit="TPM"
        showSparkline={true}
        sparklineData={toNumbers(histories.TPM)}
        sparklineDataAsDelta={true}
      />
      
      <MetricCard
        label="Aktuell körtid"
        value={metrics.CurrentRuntime ?? "00:00:00"}   
      />

      <MetricCard
        label="Total stopptid"
        value={metrics.AccumulatedStoptime ?? "00:00:00"}   
        stringValueColor="text-[var(--accent-red)]" 
      />

    </div>
  );
}