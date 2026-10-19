import { useLayoutEffect, useMemo, useRef } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/components/ScaledCanvas";
import { Header } from "@/components/Header";
import { GridScreen } from "@/screens/GridScreen";
import type { Layout, ScreenConfig } from "@/layout/layout";
import { auditRoot, type ItemAudit } from "./audit";
import { worstValues } from "./worst";
import { ChartDataContext } from "@/charts/context";
import type { ChartData } from "@/charts/metrics";
import { sampleChartData, worstAggregates, worstDetails } from "@/lib/history";

let cached: ReturnType<typeof sampleChartData> | null = null;
/** The simulated history (worst-cased below); its shape, not the clock, is what is measured */
const sample = () => (cached ??= sampleChartData(Date.now()));

/**
 * The screen rendered off-screen at full canvas size with worst-case values (same components as the
 * TV), measured after every change. Reports the legibility audit per element.
 */
export function AuditFrame({ layout, screen, onResult }: { layout: Layout; screen: ScreenConfig; onResult: (r: Record<string, ItemAudit>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const worst = useMemo(() => worstValues(screen, layout.tags), [screen, layout.tags]);
  // Charts: six-digit counts, 100,0 %, 999 stops in every period (like check-fit's ?count)
  const chartData = useMemo<ChartData>(() => {
    const s = sample();
    return { metrics: worst.values, connected: {}, histories: worst.histories, details: worstDetails(s.details), aggregates: worstAggregates(s.aggregates) };
  }, [worst]);
  useLayoutEffect(() => {
    let cancelled = false;
    const run = async () => {
      await document.fonts.ready;
      // useFit shrinks in layout effects; measure after the next frame
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      if (!cancelled && ref.current) onResult(auditRoot(ref.current));
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [screen, worst, onResult]);
  return (
    <div
      ref={ref}
      aria-hidden
      data-testid="audit-frame"
      className="pointer-events-none fixed flex flex-col overflow-hidden bg-zinc-950 text-white"
      style={{ left: -2 * CANVAS_WIDTH, top: 0, width: CANVAS_WIDTH, height: CANVAS_HEIGHT, visibility: "hidden" }}
    >
      <Header header={layout.display.header} />
      <div data-fit className="flex min-h-0 flex-1 flex-col">
        <ChartDataContext.Provider value={chartData}>
          <GridScreen key={screen.nr} screen={screen} values={worst.values} valueHistories={worst.histories} />
        </ChartDataContext.Provider>
      </div>
    </div>
  );
}
