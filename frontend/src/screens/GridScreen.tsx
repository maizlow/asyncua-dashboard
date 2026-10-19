import { ItemCard } from "@/components/ItemCard";
import { ChartElement } from "@/charts/Elements";
import { useLiveMetrics } from "@/hooks/useLiveMetrics";
import { bound } from "@/lib/connection";
import { useMetricsStore } from "@/stores/useMetricsStore";
import type { ScreenConfig } from "@/layout/layout";
import { GRID_COLS, GRID_ROWS } from "@/layout/doc";
import type { MetricValue } from "@/data/types";

const NONE: Record<string, boolean> = {};

// Elements placed on the fixed 24 x 12 grid (x, y, w, h in cells). With the 48 px gap this gives exactly
// the sizes of the earlier 2-column grid: w 12 = half width, h 4/6/12 = 3/2/1 rows. Minimum size
// 12 x 4 (backend validation) keeps the 290 px hero values (incl. "00:00:00" and 6-digit counts) fitting.
// `values`/`valueHistories` replace the live values (the editor's legibility audit renders worst-case values).
export function GridScreen({
  screen,
  values,
  valueHistories,
}: {
  screen: ScreenConfig;
  values?: Record<string, MetricValue>;
  valueHistories?: Record<string, MetricValue[]>;
}) {
  const live = useLiveMetrics();
  const liveConnected = useMetricsStore((s) => s.connected);
  const metrics = values ?? live.metrics;
  const histories = valueHistories ?? live.histories;
  const connected = values ? NONE : liveConnected;

  return (
    <div
      data-fit
      className="h-full min-h-0 grid gap-12 px-16 pt-12 pb-14 overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
      }}
    >
      {screen.items.map((item) => {
        const { value, down } = bound(metrics, connected, item.tag);
        const target = typeof item.target === "string" ? bound(metrics, connected, item.target) : null;
        return (
        <div
          key={item.id}
          data-item={item.id}
          className="min-w-0 min-h-0 grid"
          style={{
            gridColumn: `${item.x + 1} / span ${item.w}`,
            gridRow: `${item.y + 1} / span ${item.h}`,
            gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)",
          }}
        >
          {item.chart ? (
            <ChartElement item={item.chart} />
          ) : (
            <ItemCard
              item={item}
              value={value}
              history={down ? undefined : histories[item.tag]}
              targetValue={target ? target.value : item.target}
              offline={down}
            />
          )}
        </div>
        );
      })}
    </div>
  );
}
