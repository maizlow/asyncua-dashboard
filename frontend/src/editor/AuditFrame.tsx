import { useLayoutEffect, useMemo, useRef } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/components/ScaledCanvas";
import { Header } from "@/components/Header";
import { GridScreen } from "@/screens/GridScreen";
import type { Layout, ScreenConfig } from "@/layout/layout";
import { auditRoot, type ItemAudit } from "./audit";
import { worstValues } from "./worst";

/**
 * The screen rendered off-screen at full canvas size with worst-case values (same components as the
 * TV), measured after every change. Reports the legibility audit per element.
 */
export function AuditFrame({ layout, screen, onResult }: { layout: Layout; screen: ScreenConfig; onResult: (r: Record<string, ItemAudit>) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const worst = useMemo(() => worstValues(screen, layout.tags), [screen, layout.tags]);
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
        <GridScreen key={screen.nr} screen={screen} values={worst.values} valueHistories={worst.histories} />
      </div>
    </div>
  );
}
