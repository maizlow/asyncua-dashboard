import { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: string | number;
  unit?: string;
  delta?: number | null;
  deltaUnit?: string;
  sparklineData?: number[];
  size?: "sm" | "md" | "lg" | "xl";
  showSparkline?: boolean;
  className?: string;
  children?: ReactNode; // For custom content (like progress bar)
}

export function MetricCard({
  label,
  value,
  unit,
  delta,
  deltaUnit = "%",
  sparklineData,
  size = "lg",
  showSparkline = false,
  className = "",
  children,
}: MetricCardProps) {
  const sizeClasses = {
    sm: "p-6 text-5xl",
    md: "p-8 text-6xl",
    lg: "p-8 text-7xl",
    xl: "p-10 text-[5.5rem]",
  };

  const deltaColor =
    delta === null || delta === undefined
      ? "text-zinc-400"
      : delta >= 0
      ? "text-emerald-400"
      : "text-red-400";

  const deltaArrow =
    delta === null || delta === undefined ? "" : delta >= 0 ? "↑" : "↓";

  return (
    <div
      className={`bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col justify-between ${className}`}
    >
      {/* Header */}
      <div className="px-8 pt-6 pb-2">
        <div className="text-2xl text-zinc-400 tracking-wide uppercase">
          {label}
        </div>
      </div>

      {/* Main Value */}
      <div className={`px-8 font-mono font-semibold tracking-tighter ${sizeClasses[size]}`}>
        {value}
        {unit && <span className="text-4xl text-zinc-400 ml-3">{unit}</span>}
      </div>

      {/* Delta + Optional Sparkline */}
      <div className="px-8 pb-6 flex items-end justify-between">
        {/* Delta */}
        <div className={`text-3xl font-medium ${deltaColor}`}>
          {delta !== undefined && delta !== null && (
            <>
              {deltaArrow} {Math.abs(delta).toFixed(2)}
              {deltaUnit}
            </>
          )}
        </div>

        {/* Sparkline placeholder */}
        {showSparkline && sparklineData && sparklineData.length > 0 && (
          <div className="w-32 h-12">
            {/* You can replace this later with Nivo sparkline */}
            <div className="text-xs text-zinc-500">Sparkline</div>
          </div>
        )}
      </div>

      {/* Custom content slot */}
      {children && <div className="px-8 pb-6">{children}</div>}
    </div>
  );
}