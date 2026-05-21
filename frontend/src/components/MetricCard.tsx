
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
  decimalPlaces?: number;
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
  decimalPlaces = 1,
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

  const deltaColor =
  delta === null || delta === undefined
    ? "text-[var(--color-neutral)]"
    : delta >= 0
    ? "text-[var(--color-positive)]"
    : "text-[var(--color-negative)]";

  const deltaArrow = delta === null || delta === undefined ? "" : delta >= 0 ? "↑" : "↓";

  const chartData = sparklineData?.map((val, i) => ({ index: i, value: val }));

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
          {isValidNumber(value) && (
            Number(value) % 1 !== 0 
              ? Number(value).toFixed(decimalPlaces ?? 2) 
              : Number(value)
          )}
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
              {deltaArrow} {deltaUnit === "%" ? Math.abs(delta).toFixed(decimalPlaces) : Math.abs(delta)}
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
              {deltaArrow} {parseFloat(Math.abs(delta).toFixed(decimalPlaces)).toString().replace(/\.0$/, '')}
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
                  data={prepareSparklineData(sparklineData, 25)} 
                  margin={{ top: 10, right: 10, bottom: 10, left: 10 }}
                >
                  <Line
                    type="monotoneX"
                    dataKey="value"
                    stroke={
                              deltaColor.includes("positive") 
                                ? "var(--color-positive)" 
                                : deltaColor.includes("negative") 
                                ? "var(--color-negative)" 
                                : "var(--color-neutral)"
                            }
                    strokeWidth={15}  
                    isAnimationActive={true}                                   
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}

          {/* Progress Bar */}
          {showProgressBar && progressTarget !== undefined && isValidNumber(value) && (
            <div className="h-40 bg-zinc-800 rounded-2xl mt-4">
              <div
                className="h-40 rounded-2xl transition-all duration-1000"
                style={{
                  width: `${Math.min(100, Math.max(0, (Number(value) / progressTarget) * 100))}%`,
                  backgroundColor: "var(--accent-green)",
                }}
              />
            </div>
          )}
      </div>

      {children && <div className="px-8 pb-6">{children}</div>}
    </div>
  );
}

// Combine downsampling + normalization for clean, readable sparklines
function prepareSparklineData(data: number[] | undefined, targetPoints: number = 40) {
  if (!data || data.length === 0) return [];

  // 1. Downsample first (reduce from 300+ points to ~40)
  let sampled = data;
  if (data.length > targetPoints) {
    const step = Math.floor(data.length / targetPoints);
    sampled = [];
    for (let i = 0; i < data.length; i += step) {
      sampled.push(data[i]);
    }
    // Always keep the last point
    if (sampled[sampled.length - 1] !== data[data.length - 1]) {
      sampled.push(data[data.length - 1]);
    }
  }

  // 2. Normalize so small changes become visible
  const min = Math.min(...sampled);
  const max = Math.max(...sampled);
  const range = max - min || 1;

  return sampled.map((val, index) => ({
    index,
    value: ((val - min) / range) * 100,   // scale to 0-100
  }));
}