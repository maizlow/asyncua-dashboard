import { isValidNumber } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: number | string;
  /** Colour for string values (e.g. a stop time), as a CSS colour */
  valueColor?: string;
  unit?: string;
  decimalPlaces?: number;
  /** History used to show the latest change (last - previous) as a large ▲/▼ value */
  history?: number[];
  /** Shift target (same unit as the value); shows "Mål" + value and a progress bar on the right */
  target?: number;
}

// Laid out for the 3840x2160 canvas (see ScaledCanvas), read from 8-10 m on a 65" TV.
// Hero value: 290 px mono -> >= 180 px cap height on the canvas (>= 90 px at 1080p).
// Nothing secondary below 104-140 px (>= ~37 px cap height at 1080p).

function formatValue(value: number | string, decimalPlaces: number): string {
  if (!isValidNumber(value)) return String(value);
  const n = Number(value);
  return n % 1 !== 0 ? n.toFixed(decimalPlaces) : String(n);
}

export function MetricCard({
  label,
  value,
  valueColor,
  unit,
  decimalPlaces = 1,
  history,
  target,
}: MetricCardProps) {
  let delta: number | null = null;
  if (history && history.length >= 2) {
    delta = history[history.length - 1] - history[history.length - 2];
  }
  const deltaText =
    delta === null ? null : parseFloat(Math.abs(delta).toFixed(decimalPlaces)).toString().replace(/\.0$/, "");
  // Shape carries the meaning too (not only colour): ▲ up, ▼ down, ● unchanged
  const deltaArrow = delta === null ? "" : delta > 0 ? "▲" : delta < 0 ? "▼" : "●";
  const deltaColor =
    delta === null || delta === 0
      ? "var(--color-neutral)"
      : delta > 0
        ? "var(--color-positive)"
        : "var(--color-negative)";

  const progress =
    target !== undefined && target > 0 && isValidNumber(value)
      ? Math.min(100, Math.max(0, (Number(value) / target) * 100))
      : null;

  return (
    <div
      data-fit
      className="bg-zinc-900 border border-zinc-800 rounded-[48px] px-14 py-10 flex flex-col min-h-0 min-w-0 overflow-hidden"
    >
      <div className="text-[110px] text-zinc-300 tracking-wide uppercase font-medium tv-truncate">
        {label}
      </div>

      <div className="flex-1 min-h-0 flex items-end justify-between gap-12 min-w-0">
        {/* Main value */}
        <div className="flex items-baseline min-w-0 whitespace-nowrap leading-none">
          <span
            className="text-[290px] font-mono font-bold tracking-[-6px] tabular-nums"
            style={valueColor ? { color: valueColor } : undefined}
          >
            {formatValue(value, decimalPlaces)}
          </span>
          {unit && <span className="text-[110px] text-zinc-300 ml-6">{unit}</span>}
        </div>

        {/* Latest change */}
        {deltaText !== null && (
          <div
            className="shrink-0 text-[140px] font-mono font-semibold leading-none whitespace-nowrap pb-6"
            style={{ color: deltaColor }}
          >
            {deltaArrow} {deltaText}
          </div>
        )}

        {/* Target + progress */}
        {target !== undefined && (
          <div className="shrink-0 pb-6">
            <div className="flex items-baseline justify-between gap-10 leading-none whitespace-nowrap">
              <span className="text-[110px] text-zinc-300">Mål</span>
              <span className="text-[140px] font-mono font-semibold text-zinc-200 tabular-nums">
                {target}
              </span>
            </div>
            {progress !== null && (
              <div className="h-14 bg-zinc-800 rounded-full mt-8 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-1000"
                  style={{ width: `${progress}%`, backgroundColor: "var(--accent-green)" }}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
