// Spike: react-grid-layout v2 inside a 3840x2160 canvas scaled with CSS transform (like ScaledCanvas).
import { createRoot } from "react-dom/client";
import { useEffect, useMemo, useRef, useState } from "react";
import { GridLayout, noCompactor, type Layout } from "react-grid-layout";
import { createScaledStrategy, transformStrategy } from "react-grid-layout/core";
import type { PositionStrategy } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

const W = 3840, H = 2160, HEADER = 300, COLS = 24, ROWS = 12, GAP = 48, PADX = 64, PADY = 48;
const ROW_H = (H - HEADER - 2 * PADY - (ROWS - 1) * GAP) / ROWS;
const params = new URLSearchParams(location.search);
const strategyName = params.get("strategy") ?? "canvas";

/** Like createScaledStrategy, but relative to the grid container (which need not sit at the page origin). */
function createCanvasStrategy(scale: number, grid: () => HTMLElement | null): PositionStrategy {
  return {
    ...transformStrategy,
    scale,
    calcDragPosition(clientX, clientY, offsetX, offsetY) {
      const r = grid()?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return { left: (clientX - offsetX - r.left) / scale, top: (clientY - offsetY - r.top) / scale };
    },
  };
}

const initial: Layout = [
  { i: "a", x: 0, y: 0, w: 12, h: 4 },
  { i: "b", x: 12, y: 0, w: 12, h: 4 },
  { i: "c", x: 0, y: 4, w: 6, h: 4 },
];

function App() {
  const [scale, setScale] = useState(Math.min(innerWidth / W, innerHeight / H));
  const [layout, setLayout] = useState<Layout>(initial);
  const gridRef = useRef<HTMLDivElement>(null);
  const strategy = useMemo(
    () =>
      strategyName === "canvas" ? createCanvasStrategy(scale, () => gridRef.current)
      : strategyName === "scaled" ? createScaledStrategy(scale) : undefined,
    [scale],
  );
  useEffect(() => {
    const on = () => setScale(Math.min(innerWidth / W, innerHeight / H));
    addEventListener("resize", on);
    return () => removeEventListener("resize", on);
  }, []);
  useEffect(() => { (window as any).__layout = layout; (window as any).__scale = scale; }, [layout, scale]);
  return (
    <div style={{ position: "fixed", inset: 0, overflow: "hidden" }}>
    <div style={{ position: "absolute", left: "50%", top: "50%", width: W, height: H, transform: `translate(-50%, -50%) scale(${scale})`, transformOrigin: "center center", background: "#18181b" }}>
      <div style={{ height: HEADER, color: "#fff", fontSize: 120, display: "flex", alignItems: "center", paddingLeft: 64 }}>Header-yta</div>
      <GridLayout
        width={W}
        layout={layout}
        gridConfig={{ cols: COLS, rowHeight: ROW_H, margin: [GAP, GAP], containerPadding: [PADX, PADY], maxRows: ROWS }}
        dragConfig={{ enabled: true, bounded: true }}
        resizeConfig={{ enabled: true, handles: ["se"] }}
        compactor={{ ...noCompactor, preventCollision: true }}
        positionStrategy={strategy}
        innerRef={gridRef}
        onLayoutChange={setLayout}
        style={{ height: H - HEADER }}
      >
        {layout.map((l) => (
          <div key={l.i} data-item={l.i} style={{ background: "#3f3f46", border: "4px solid #a1a1aa", borderRadius: 40, color: "#fff", fontSize: 140, display: "flex", alignItems: "center", justifyContent: "center" }}>
            {l.i.toUpperCase()}
          </div>
        ))}
      </GridLayout>
    </div>
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
