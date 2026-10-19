import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { CANVAS_HEIGHT, CANVAS_WIDTH } from "@/components/ScaledCanvas";
import { Header } from "@/components/Header";
import { GridScreen } from "@/screens/GridScreen";
import type { Layout, ScreenConfig } from "@/layout/layout";
import { useMetricsStore } from "@/stores/useMetricsStore";
import { simulatedMetrics } from "./sim";
import { BUILTIN_NAMES } from "./names";


/**
 * The 3840×2160 TV canvas scaled into the available box (same idea as ScaledCanvas, but sized by the
 * container instead of the window). `onScale` reports the factor: the editing canvas needs it to turn
 * mouse positions into canvas px (the spike's scaling fix, docs/spike/README.md).
 */
export function ScaledBox({ children, onScale }: { children: ReactNode; onScale?: (scale: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const scale = Math.min(box.w / CANVAS_WIDTH, box.h / CANVAS_HEIGHT) || 0;
  useEffect(() => onScale?.(scale), [scale, onScale]);
  return (
    <div ref={ref} className="relative h-full w-full overflow-hidden">
      <div
        data-testid="tv-canvas"
        className="absolute overflow-hidden rounded-sm shadow-2xl ring-1 ring-zinc-700"
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          left: (box.w - CANVAS_WIDTH * scale) / 2,
          top: (box.h - CANVAS_HEIGHT * scale) / 2,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        {children}
      </div>
    </div>
  );
}

/** A full-size built-in screen in the editor: what it is and which PLC (line) it shows */
export function BuiltinPlaceholder({ screen, layout }: { screen: ScreenConfig; layout: Layout }) {
  const conn = screen.connection;
  const connName = conn ? layout.connections[conn]?.name : null;
  return (
    <div className="h-full min-h-0 px-16 pt-12 pb-14">
      <div className="flex h-full flex-col items-center justify-center gap-12 rounded-[48px] border-8 border-dashed border-zinc-700 bg-zinc-900/60">
        <div className="text-[96px] font-medium text-zinc-400">Inbyggd skärm</div>
        <div className="text-[260px] font-bold leading-tight text-white">{BUILTIN_NAMES[screen.type] ?? screen.type}</div>
        <div className="text-[96px] text-zinc-400">
          {conn ? `från ${conn}${connName ? ` · ${connName}` : ""}` : "ingen PLC vald"} · fyller hela ytan
        </div>
      </div>
    </div>
  );
}

/** One screen of the display as the TV shows it, with simulated values */
export function TvPreview({ layout, screenNr, children }: { layout: Layout; screenNr: number | null; children?: ReactNode }) {
  useEffect(() => {
    useMetricsStore.setState({ metrics: simulatedMetrics(layout), connected: {}, histories: {} });
  }, [layout]);
  const screen = layout.screens.find((s) => s.nr === screenNr);
  return (
    <div className="relative flex h-full flex-col bg-zinc-950 text-white">
      <Header header={layout.display.header} />
      <div data-fit className="flex min-h-0 flex-1 flex-col">
        {children ??
          (!screen ? (
            <div className="flex h-full items-center justify-center text-[120px] text-zinc-500">Ingen skärm vald</div>
          ) : screen.type === "grid" ? (
            <GridScreen key={screen.nr} screen={screen} />
          ) : (
            <BuiltinPlaceholder screen={screen} layout={layout} />
          ))}
      </div>
    </div>
  );
}
