import type { Status as BaseStatus } from "@/lib/status";

// Theme tokens (src/index.css) for the chart elements
export const GREEN = "var(--accent-green)";
export const AMBER = "var(--accent-amber)";
export const RED = "var(--accent-red)";
export const NEUTRAL = "var(--accent-neutral)";
export const TRACK = "#27272a"; // zinc-800: empty part of bars, rings and timelines
export const GRID_LINE = "#3f3f46"; // zinc-700

export type Status = BaseStatus | null;
export const statusColor = (s: Status) => (s === null ? NEUTRAL : s === "good" ? GREEN : s === "warn" ? AMBER : RED);
/** Non-colour cue: ▼ under target (higher is better), ▲ over a limit (lower is better) */
export const cue = (s: Status, better: "high" | "low" = "high") => (s !== null && s !== "good" ? (better === "low" ? "▲ " : "▼ ") : "");

