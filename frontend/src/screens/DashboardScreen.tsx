import { MetricCard } from "@/components/MetricCard";
import { useLiveMetrics } from "@/hooks/useLiveMetrics";

export function DashboardScreen() {
  const { metrics, histories } = useLiveMetrics();

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 p-8 mt-20 ml-10 mr-10">
      
      <MetricCard
        label="Production"
        value={metrics.ProductionCount ?? 0}
        unit="pcs"
        progressTarget={metrics.TargetCount ?? 0}
        progressTargetUnit="pcs"
        showProgressBar={true}
      />

      <MetricCard
        label="Delta"
        value={metrics.ProductionDelta ?? 0}
        unit="pcs"
        delta={-24}
        deltaUnit="pcs"
        showSparkline={true}
        sparklineData={histories.ProductionDelta || []}
        sparklineDataAsDelta={true}
      />
      
      <MetricCard
        label="Efficiency"
        value={metrics.OEE ?? 0.00}
        unit="%"
        delta={2.1}
        showSparkline={true}
        sparklineData={histories.OEE || []}
        sparklineDataAsDelta={true}
      />

      <MetricCard
        label="Line speed"
        value={metrics.TPM ?? 0.0}
        unit="TPM"
        delta={1.2}
        deltaUnit="TPM"
        showSparkline={true}
        sparklineData={histories.TPM || []}
        sparklineDataAsDelta={true}
      />
      
      <MetricCard
        label="Current run time"
        value={metrics.CurrentRuntime ?? "00:00:00"}   
      />

      <MetricCard
        label="Total stop time"
        value={metrics.AccumulatedStoptime ?? "00:00:00"}   
        stringValueColor="text-[var(--accent-red)]" 
      />

    </div>
  );
}