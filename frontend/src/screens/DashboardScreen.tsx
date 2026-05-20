import { MetricCard } from "@/components/MetricCard";

export function DashboardScreen() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 p-8">
      
      {/* Basic KPI */}
      <MetricCard
        label="Production"
        value="71,306"
        unit="pcs"
        delta={-0.03}
        deltaUnit="%"
        size="lg"
      />

      {/* Large OEE Card */}
      <MetricCard
        label="OEE"
        value="129.03"
        unit="%"
        delta={0.02}
        deltaUnit="%"
        size="xl"
      />

      {/* With Sparkline (placeholder for now) */}
      <MetricCard
        label="Production Delta"
        value="29.03"
        unit="%"
        delta={-1.2}
        showSparkline={true}
        sparklineData={[10, 12, 8, 15, 11]}
      />

    </div>
  );
}