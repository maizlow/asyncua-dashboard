
import { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer } from "recharts";
import { isValidNumber } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: number | string;
  stringValueColor?: string | undefined;
  unit?: string;
  delta?: number | null;
  deltaUnit?: string;
  sparklineData?: number[];
  showSparkline?: boolean;
  sparklineDataAsDelta?: boolean;
  progressTarget?: number;
  progressTargetUnit?: string;
  showProgressBar?: boolean;
  children?: ReactNode;
}

export function MetricCard({
  label,
  value,
  stringValueColor,
  unit,
  delta: externalDelta,
  deltaUnit = "%",
  sparklineData,
  showSparkline = false,
  sparklineDataAsDelta = false,
  progressTarget,
  progressTargetUnit,
  showProgressBar = false,
  children,
}: MetricCardProps) {

  // Calculate delta from sparklineData when sparklineDataAsDelta is true
  let delta = externalDelta;

  if (sparklineDataAsDelta && sparklineData && sparklineData.length >= 2) {
    const last = sparklineData[sparklineData.length - 1];
    const secondLast = sparklineData[sparklineData.length - 2];
    delta = last - secondLast;
  }

  const deltaColor = (delta === null || delta === undefined)
    ? "text-zinc-400"
    : delta >= 0 ? "text-emerald-400" : "text-red-400";

  const deltaArrow = delta === null || delta === undefined ? "" : delta >= 0 ? "↑" : "↓";

  const chartData = sparklineData?.map((val, i) => ({ index: i, value: val }));

  // Normalize sparkline data so small changes become visible
  function normalizeSparklineData(data: number[] | undefined) {
    if (!data || data.length === 0) return [];

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1; // prevent division by zero

    return data.map((val, index) => ({
      index,
      value: ((val - min) / range) * 100, // normalize to 0–100
    }));
  }

  return (
    <div className={`bg-zinc-900 border border-zinc-800 rounded-3xl flex flex-col`}>
      {/* Header */}
      <div className="px-8 pt-6 pb-12">
        <div className="text-8xl text-zinc-400 tracking-wide uppercase font-medium">
          {label}
        </div>
      </div>

      {/* Main Value */}
      <div className="px-8 pb-12">
        <span className="text-14xl leading-none font-mono font-semibold tracking-[-4px]">
          {isValidNumber(value) !== false && value }
          {isValidNumber(value) === false && (
            <span className={`${stringValueColor} flex justify-center mt-30`}> {value} </span>
          )}
        </span>
        {unit && <span className="text-8xl text-zinc-400 ml-3 align-super">{unit}</span>}
      </div>

      {/* Delta + Chart */}
      <div className="px-8 pb-6 text-9xl font-mono font-medium leading-none tracking-[-4px]">
          {/* Delta */}
          {delta !== undefined && delta !== null && sparklineDataAsDelta === false && (
            <div className={`${deltaColor}`}>
              {deltaArrow} {deltaUnit === "%" ? Math.abs(delta).toFixed(2) : Math.abs(delta)}
              {deltaUnit === "%" ? " %" : " " + deltaUnit}
            </div>
          )}
          {delta === undefined && progressTarget !== undefined && sparklineDataAsDelta === false && (
            <div className="text-zinc-400 flex justify-end">
              {progressTarget}
              {progressTargetUnit && <span className="text-6xl ml-3 align-super">{progressTargetUnit}</span>}
            </div>
          )}
          {sparklineDataAsDelta === true && chartData && chartData.length > 2 && delta !== undefined && delta !== null && (
            <div className={`${deltaColor}`}>
              {deltaArrow} {parseFloat(Math.abs(delta).toFixed(1)).toString().replace(/\.0$/, '')}
              {deltaUnit === "%" ? " %" : " " + deltaUnit}
            </div>
          )}

      </div>

      <div className="px-8 pb-12 w-full h-52"> 
          {/* Sparkline */}
          {showSparkline && chartData && chartData.length > 3 && (
            <div className="w-full h-34 mt-4">          
              <ResponsiveContainer width="100%" height="100%">
                <LineChart 
                  data={normalizeSparklineData(sparklineData)} 
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <Line
                    type="natural"
                    dataKey="value"
                    stroke={deltaColor === "text-emerald-400" ? "#34D399" : deltaColor === "text-red-400" ? "#F87171" : "#9CA3AF"}
                    strokeWidth={15}                                      
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Progress Bar */}
          {showProgressBar && progressTarget !== undefined && isValidNumber(value) && (
            <div className="h-40 bg-zinc-800 rounded-2xl mt-4">
              <div className="bg-green-500 h-40 rounded-2xl" style={{ width: `${Math.min(100, (value / progressTarget) * 100)}%` }} />
            </div>
          )}
      </div>

      {children && <div className="px-8 pb-6">{children}</div>}
    </div>
  );
}

