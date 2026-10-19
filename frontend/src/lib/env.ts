/** True when built with VITE_DEMO=true (static preview on GitHub Pages: no backend, no PLC). */
export const IS_DEMO = import.meta.env.VITE_DEMO === "true";
