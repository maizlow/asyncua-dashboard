/**
 * The editing canvas: the TV's 3840×2160 canvas (header + 24 × 12 grid) with the screen's elements as
 * react-grid-layout items. Drag to move, the corner handle to resize, drop palette elements onto it.
 *
 * Positions under the CSS scale: the library's own scaled strategy assumes the grid starts at the page
 * origin; ours sits under the header in a centred canvas, so the drag position is taken relative to the
 * grid's own rectangle (createCanvasStrategy, the fix from spike etapp 0, spikes/editor-rgl/README.md).
 * Geometry is the TV's (GridScreen: padding 64/48/56 px, gap 48 px), so every element lands on the same
 * pixels as on the TV.
 */
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { GridLayout, noCompactor, type Layout as RglLayout, type LayoutItem } from "react-grid-layout";
import { transformStrategy, type PositionStrategy } from "react-grid-layout/core";
import "react-grid-layout/css/styles.css";
import "./editor.css";
import { CANVAS_WIDTH } from "@/components/ScaledCanvas";
import { Header } from "@/components/Header";
import { ItemCard } from "@/components/ItemCard";
import { GRID_COLS, GRID_ROWS } from "@/layout/doc";
import type { Layout } from "@/layout/layout";
import { bound } from "@/lib/connection";
import { useMetricsStore } from "@/stores/useMetricsStore";
import { BuiltinPlaceholder, ScaledBox } from "./TvPreview";
import { simulatedMetrics } from "./sim";
import { useEditorStore } from "./store";
import { DRAG_MIME } from "./dnd";
import { MIN_H, MIN_W, addValueWidget, inGrid, overlaps, setRect, type ValueKind } from "./ops";

const PAD_X = 64;
const PAD_TOP = 48;
const PAD_BOTTOM = 56;
const GAP = 48;
const COL_W = (CANVAS_WIDTH - 2 * PAD_X - (GRID_COLS - 1) * GAP) / GRID_COLS;


function createCanvasStrategy(scale: number, grid: { current: HTMLElement | null }): PositionStrategy {
  return {
    ...transformStrategy,
    scale,
    calcDragPosition(clientX, clientY, offsetX, offsetY) {
      const r = grid.current?.getBoundingClientRect() ?? { left: 0, top: 0 };
      return { left: (clientX - offsetX - r.left) / scale, top: (clientY - offsetY - r.top) / scale };
    },
  };
}

interface Ghost {
  x: number;
  y: number;
  ok: boolean;
}

export function Canvas({ layout }: { layout: Layout }) {
  const { doc, displayId, screenNr, selected, edit, select } = useEditorStore();
  const [scale, setScale] = useState(0);
  const [areaH, setAreaH] = useState(0);
  const [ghost, setGhost] = useState<Ghost | null>(null);
  // Bumped when a change is refused, so the grid drops its own idea of the layout
  const [rglKey, setRglKey] = useState(0);
  const areaRef = useRef<HTMLDivElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const metrics = useMetricsStore((s) => s.metrics);
  const connected = useMetricsStore((s) => s.connected);

  useLayoutEffect(() => {
    useMetricsStore.setState({ metrics: simulatedMetrics(layout), connected: {}, histories: {} });
  }, [layout]);

  useLayoutEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAreaH(el.clientHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const rowH = areaH ? (areaH - PAD_TOP - PAD_BOTTOM - (GRID_ROWS - 1) * GAP) / GRID_ROWS : 0;
  // The ref is only read inside the drag callbacks, never during render
  // eslint-disable-next-line react-hooks/refs
  const strategy = useMemo(() => createCanvasStrategy(scale || 1, gridRef), [scale]);
  const screen = layout.screens.find((s) => s.nr === screenNr);
  const builtin = screen && screen.type !== "grid";

  const rgl: RglLayout = useMemo(
    () =>
      (screen?.items ?? []).map((it) => ({ i: it.id, x: it.x, y: it.y, w: it.w, h: it.h, minW: MIN_W, minH: MIN_H, maxW: GRID_COLS, maxH: GRID_ROWS })),
    [screen],
  );

  const commit = useCallback(
    (_l: RglLayout, oldItem: LayoutItem | null, item: LayoutItem | null) => {
      if (!item || !oldItem || !displayId || screenNr === null) return;
      if (item.x === oldItem.x && item.y === oldItem.y && item.w === oldItem.w && item.h === oldItem.h) return;
      const ok = edit((d) => setRect(d, displayId, screenNr, item.i, { x: item.x, y: item.y, w: item.w, h: item.h }), { selected: item.i });
      if (!ok) setRglKey((k) => k + 1);
    },
    [edit, displayId, screenNr],
  );

  /** Grid cell for a drop at client (x, y): the new element (12 × 4) centred under the pointer */
  const cellAt = (clientX: number, clientY: number) => {
    const r = areaRef.current!.getBoundingClientRect();
    const cx = (clientX - r.left) / scale;
    const cy = (clientY - r.top) / scale;
    const col = (cx - PAD_X) / (COL_W + GAP) - MIN_W / 2;
    const row = (cy - PAD_TOP) / (rowH + GAP) - MIN_H / 2;
    return {
      x: Math.max(0, Math.min(GRID_COLS - MIN_W, Math.round(col))),
      y: Math.max(0, Math.min(GRID_ROWS - MIN_H, Math.round(row))),
    };
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes(DRAG_MIME) || builtin || !scale) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    const c = cellAt(e.clientX, e.clientY);
    const rect = { ...c, w: MIN_W, h: MIN_H };
    const ok = inGrid(rect) && !(screen?.items ?? []).some((o) => overlaps(rect, o));
    if (!ghost || ghost.x !== c.x || ghost.y !== c.y || ghost.ok !== ok) setGhost({ ...c, ok });
  };

  const onDrop = (e: DragEvent) => {
    const kind = e.dataTransfer.getData(DRAG_MIME) as ValueKind;
    setGhost(null);
    if (!kind || !displayId || screenNr === null) return;
    e.preventDefault();
    let id = "";
    edit((d) => {
      id = addValueWidget(d, displayId, screenNr, kind, cellAt(e.clientX, e.clientY));
    }, () => ({ selected: id }));
  };

  if (!doc || !displayId) return null;

  return (
    <ScaledBox onScale={setScale}>
      <div className="aud-canvas relative flex h-full flex-col bg-zinc-950 text-white">
        <Header header={layout.display.header} />
        <div
          ref={areaRef}
          data-testid="grid-area"
          className="relative min-h-0 flex-1"
          onPointerDown={(e) => {
            if (e.target === e.currentTarget || e.target === gridRef.current) select(null);
          }}
          onDragOver={onDragOver}
          onDragLeave={(e) => {
            if (e.currentTarget === e.target) setGhost(null);
          }}
          onDrop={onDrop}
        >
          {!screen ? (
            <div className="flex h-full items-center justify-center text-[120px] text-zinc-500">Ingen skärm – lägg till en</div>
          ) : builtin ? (
            <div
              className={`h-full ${selected === screen.items[0]?.id ? "outline outline-[12px] -outline-offset-[24px] outline-sky-400" : ""}`}
              onPointerDown={() => select(screen.items[0]?.id ?? null)}
            >
              <BuiltinPlaceholder screen={screen} layout={layout} />
            </div>
          ) : (
            <>
              {/* Cell guides: the 24 × 12 grid */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 grid"
                style={{
                  padding: `${PAD_TOP}px ${PAD_X}px ${PAD_BOTTOM}px`,
                  gap: GAP,
                  gridTemplateColumns: `repeat(${GRID_COLS}, minmax(0, 1fr))`,
                  gridTemplateRows: `repeat(${GRID_ROWS}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: GRID_COLS * GRID_ROWS }, (_, i) => (
                  <div key={i} className="rounded-[20px] bg-zinc-800/25" />
                ))}
              </div>
              {screen.items.length === 0 && (
                <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[110px] text-zinc-500">
                  Dra in element från paletten
                </div>
              )}
              {rowH > 0 && scale > 0 && (
                <GridLayout
                  key={`${displayId}-${screenNr}-${rglKey}`}
                  width={CANVAS_WIDTH}
                  layout={rgl}
                  gridConfig={{ cols: GRID_COLS, rowHeight: rowH, margin: [GAP, GAP], containerPadding: [PAD_X, PAD_TOP], maxRows: GRID_ROWS }}
                  dragConfig={{ enabled: true, bounded: true, threshold: 6 }}
                  resizeConfig={{ enabled: true, handles: ["se"] }}
                  compactor={{ ...noCompactor, preventCollision: true }}
                  positionStrategy={strategy}
                  innerRef={gridRef}
                  onDragStop={commit}
                  onResizeStop={commit}
                  autoSize={false}
                  style={{ height: areaH }}
                >
                  {screen.items.map((item) => {
                    const { value, down } = bound(metrics, connected, item.tag);
                    const target = typeof item.target === "string" ? bound(metrics, connected, item.target) : null;
                    return (
                      <div
                        key={item.id}
                        data-testid={`item-${item.id}`}
                        data-x={item.x}
                        data-y={item.y}
                        data-w={item.w}
                        data-h={item.h}
                        className={`grid cursor-grab ${selected === item.id ? "aud-selected" : ""}`}
                        style={{ gridTemplate: "minmax(0, 1fr) / minmax(0, 1fr)" }}
                        onPointerDown={() => select(item.id)}
                      >
                        <ItemCard
                          item={item}
                          value={value}
                          targetValue={target ? target.value : item.target}
                          offline={down}
                        />
                        {selected === item.id && (
                          <div className="pointer-events-none absolute -inset-[16px] rounded-[56px] border-[12px] border-sky-400" />
                        )}
                      </div>
                    );
                  })}
                </GridLayout>
              )}
              {ghost && (
                <div
                  className={`pointer-events-none absolute rounded-[48px] border-8 border-dashed ${
                    ghost.ok ? "border-sky-400 bg-sky-400/15" : "border-red-500 bg-red-500/15"
                  }`}
                  style={{
                    left: PAD_X + ghost.x * (COL_W + GAP),
                    top: PAD_TOP + ghost.y * (rowH + GAP),
                    width: MIN_W * COL_W + (MIN_W - 1) * GAP,
                    height: MIN_H * rowH + (MIN_H - 1) * GAP,
                  }}
                />
              )}
            </>
          )}
        </div>
      </div>
    </ScaledBox>
  );
}

