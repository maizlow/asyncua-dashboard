import { useEffect, useState, type ReactNode } from "react";

/** Design resolution. All screens are laid out for a 4K (16:9) canvas in CSS px. */
export const CANVAS_WIDTH = 3840;
export const CANVAS_HEIGHT = 2160;

function computeScale() {
  return Math.min(window.innerWidth / CANVAS_WIDTH, window.innerHeight / CANVAS_HEIGHT);
}

/**
 * Renders children on a fixed 3840x2160 canvas scaled uniformly to fit the viewport
 * (letterboxed on non-16:9 screens such as 21:9). Every TV size therefore shows the exact
 * same layout - no scrollbars, no reflow, no clipping - with text scaling with the screen.
 */
export function ScaledCanvas({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(computeScale);

  useEffect(() => {
    const onResize = () => setScale(computeScale());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return (
    <div className="fixed inset-0 overflow-hidden bg-zinc-950">
      <div
        className="absolute left-1/2 top-1/2 overflow-hidden"
        style={{
          width: CANVAS_WIDTH,
          height: CANVAS_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center center",
        }}
      >
        {children}
      </div>
    </div>
  );
}
