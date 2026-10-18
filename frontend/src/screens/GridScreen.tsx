import { ItemCard } from "@/components/ItemCard";
import { useLiveMetrics } from "@/hooks/useLiveMetrics";
import type { ScreenConfig } from "@/layout/layout";

// Items from dashboard.yaml (1-6). Fixed grid: 1 item = full width, otherwise 2 columns and up to
// 3 rows, so the 290 px hero values (incl. "00:00:00" and 6-digit counts) fit side by side.
export function GridScreen({ screen }: { screen: ScreenConfig }) {
  const { metrics, histories } = useLiveMetrics();
  const n = screen.items.length;
  const cols = n <= 1 ? 1 : 2;
  const rows = Math.max(1, Math.ceil(n / cols));

  return (
    <div
      data-fit
      className="h-full min-h-0 grid gap-12 px-16 pt-12 pb-14 overflow-hidden"
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {screen.items.map((item, i) => (
        <ItemCard
          key={`${i}-${item.tag}`}
          item={item}
          value={metrics[item.tag]}
          history={histories[item.tag]}
          targetValue={typeof item.target === "string" ? metrics[item.target] : item.target}
        />
      ))}
    </div>
  );
}
