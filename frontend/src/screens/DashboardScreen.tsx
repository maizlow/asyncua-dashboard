import { MetricCard } from "@/components/MetricCard";

export function DashboardScreen() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-12 p-8 mt-20 ml-10 mr-10">
      
      <MetricCard
        label="Production"
        value={41306}
        unit="pcs"
        progressTarget={50000}
        progressTargetUnit="pcs"
        showProgressBar={true}
      />

      <MetricCard
        label="Delta"
        value={-1249}
        unit="pcs"
        delta={-24}
        deltaUnit="pcs"
        showSparkline={true}
        sparklineData={[10, -31, 40, 15, 11]}
        sparklineDataAsDelta={true}
      />
      
      <MetricCard
        label="Efficiency"
        value={89.03}
        unit="%"
        delta={2.1}
        showSparkline={true}
        sparklineData={[-2.2, -2.9, -1.5, -0.5, 2.2]}
        sparklineDataAsDelta={true}
      />

      <MetricCard
        label="Line speed"
        value={120.2}
        unit="TPM"
        delta={1.2}
        deltaUnit="TPM"
        showSparkline={true}
        sparklineData={[-2.2, -2.9, -1.5, -0.2, 2.2]}
        sparklineDataAsDelta={true}
      />
      
      <MetricCard
        label="Current run time"
        value={"00:42:13"}   
        stringValueColor="text-emerald-400" 
      />

      <MetricCard
        label="Total stop time"
        value={"00:23:53"}   
        stringValueColor="text-red-400" 
      />

    </div>
  );
}

