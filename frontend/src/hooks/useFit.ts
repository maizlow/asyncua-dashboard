import { useLayoutEffect, useRef } from "react";

/** Shrink floor: 112 px = 37 px cap height (mono) at 1080p, the minimum for anything important. */
export const FIT_MIN_PX = 112;

/**
 * Sets the element's font size to maxPx and shrinks it (never below minPx) until its content fits
 * its width. Re-runs when `deps` change (pass the displayed text).
 */
export function useFit<T extends HTMLElement>(maxPx: number, deps: unknown[], minPx = FIT_MIN_PX) {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let size = maxPx;
    el.style.fontSize = `${size}px`;
    for (let i = 0; i < 6 && el.scrollWidth > el.clientWidth + 1 && size > minPx; i++) {
      size = Math.max(minPx, Math.floor((size * el.clientWidth) / el.scrollWidth) - 2);
      el.style.fontSize = `${size}px`;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return ref;
}
