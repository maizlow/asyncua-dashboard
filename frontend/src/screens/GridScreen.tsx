import { ItemCard } from "@/components/ItemCard";
import { useLiveMetrics } from "@/hooks/useLiveMetrics";
import type { ScreenConfig } from "@/layout/layout";
import { GRID_COLS, GRID_ROWS } from "@/layout/doc";

// Elements placed on the fixed 24 x 12 grid (x, y, w, h in cells). With the 48 px gap this gives exactly
// the sizes of the earlier 2-column grid: w 12 = half width, h 4/6/12 = 3/2/1 rows. Minimum size
// 12 x 4 (backend validation) keeps the 290 px hero values (incl. "00:00:00" and 6-digit counts) fitting.
export function GridScreen({ screen }: { screen: ScreenConfig }) {
  const { metrics, histories } = useLiveMetrics();

  return (
    <div
      data-fit
      className="h-full min-h-0 grid gap-12 px-16 pt-12 pb-14 overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
      }}
    >
      {screen.items.map((item) => (
        <div
          key={item.id}
          className="min-w-0 min-h-0 grid"
          style={{
            gridColumn: `${item.x + 1} / span ${item.w}`,
            gridRow: `${item.y + 1} / span ${item.h}`,
            gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)",
          }}
        >
          <ItemCard
            item={item}
            value={metrics[item.tag]}
            history={histories[item.tag]}
            targetValue={typeof item.target === "string" ? metrics[item.target] : item.target}
          />
        </div>
      ))}
    </div>
  );
}
