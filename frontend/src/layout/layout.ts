/**
 * Layout of one display (layout document schema_version 2, see docs/CONFIG.md).
 * Live: GET /api/layout?display=… (validated by the backend, from the published version in SQLite).
 * Demo: dashboard.yaml / a v2 file converted at build time (src/layout/doc.ts). Both give the same
 * view JSON; normaliseLayout() turns it into what the screens use.
 */
import { BUILTIN_KINDS, GRID_COLS, GRID_ROWS, documentView, toDocument, type LogoAsset } from "./doc";

export type ColorName = "white" | "green" | "amber" | "red" | "grey";
export type ItemType = "number" | "percent" | "counter" | "time" | "status";
export type BuiltinKind = (typeof BUILTIN_KINDS)[number];
export type ScreenType = "grid" | BuiltinKind;
export type { LogoAsset };

export interface ItemConfig {
  id: string;
  type: ItemType;
  /** Position + size in grid cells (24 x 12) */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  tag: string;
  unit?: string;
  decimals?: number;
  /** Tag name or fixed number */
  target?: string | number;
  trend: boolean;
  color?: ColorName;
  /** [lower, upper]: high = green >= upper, amber >= lower; low = green <= lower, amber <= upper */
  thresholds?: [number, number];
  better: "high" | "low";
  states?: Record<string, { text: string; color: ColorName }>;
}

export interface ScreenConfig {
  nr: number;
  /** A screen holding one full-size built-in (alarms, OEE, …) shows it; anything else is a grid */
  type: ScreenType;
  /** Built-in screens: the PLC (line) they show */
  connection?: string;
  title?: string;
  items: ItemConfig[];
}

export interface TagConfig {
  type: "auto" | "time";
  /** Demo only: fixed value or [min, max] */
  demo?: number | [number, number];
  /** No node id yet (TODO(PLC)): never gets a value */
  placeholder: boolean;
}

/** Logos left and right (or none); the clock is always in the middle */
export interface Header {
  left: LogoAsset;
  right: LogoAsset;
}

export interface Layout {
  /** Published version in the backend (null in the demo) */
  version: number | null;
  display: { id: string; name: string | null; header: Header };
  displays: { id: string; name: string | null }[];
  /** PLCs this display reads from: id -> display name */
  connections: Record<string, { name: string | null }>;
  grid: { cols: number; rows: number };
  screens: ScreenConfig[];
  tags: Record<string, TagConfig>;
}

export const COLOR_VAR: Record<ColorName, string> = {
  white: "#ffffff",
  green: "var(--accent-green)",
  amber: "var(--accent-amber)",
  red: "var(--accent-red)",
  grey: "var(--accent-neutral)",
};

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

const isBuiltin = (k: unknown): k is BuiltinKind => (BUILTIN_KINDS as readonly unknown[]).includes(k);

export function normaliseLayout(raw: unknown): Layout {
  // The backend always sends a view; a bare file (old backend, tests) is converted the same way
  const view: Raw = isObj(raw) && isObj(raw.display) ? raw : (documentView(toDocument(raw)) as unknown as Raw);
  const display = isObj(view.display) ? view.display : {};
  const header = (isObj(display.header) ? display.header : {}) as Partial<Header>;
  const rawScreens = isObj(view.screens) ? view.screens : {};
  const screens: ScreenConfig[] = Object.entries(rawScreens)
    .map(([nr, s]) => {
      const scr = isObj(s) ? s : {};
      const widgets = Array.isArray(scr.items) ? scr.items.filter(isObj) : [];
      const builtin = widgets.length === 1 && isBuiltin(widgets[0].kind) ? widgets[0].kind : null;
      return {
        nr: Number(nr),
        type: builtin ?? ("grid" as ScreenType),
        connection: builtin ? ((widgets[0].connection as string | undefined) ?? undefined) : undefined,
        title: (scr.title as string | null | undefined) ?? undefined,
        items: builtin ? [] : widgets.filter((w) => !isBuiltin(w.kind)).map(normaliseItem),
      };
    })
    .filter((s) => Number.isInteger(s.nr))
    .sort((a, b) => a.nr - b.nr);

  const rawTags = isObj(view.tags) ? view.tags : {};
  const tags: Record<string, TagConfig> = {};
  for (const [name, spec] of Object.entries(rawTags)) {
    const t = isObj(spec) ? spec : {};
    tags[name] = {
      type: t.type === "time" ? "time" : "auto",
      demo: t.demo as TagConfig["demo"],
      placeholder: t.placeholder === true,
    };
  }
  const grid = isObj(view.grid) ? view.grid : {};
  return {
    version: typeof view.version === "number" ? view.version : null,
    display: {
      id: String(display.id ?? "tv1"),
      name: (display.name as string | null | undefined) ?? null,
      header: { left: header.left ?? "customer", right: header.right ?? "vendor" },
    },
    displays: Array.isArray(view.displays) ? (view.displays as Layout["displays"]) : [],
    connections: isObj(view.connections) ? (view.connections as Layout["connections"]) : {},
    grid: { cols: Number(grid.cols ?? GRID_COLS), rows: Number(grid.rows ?? GRID_ROWS) },
    screens,
    tags,
  };
}

function normaliseItem(i: Raw): ItemConfig {
  const type = ((i.kind as ItemType) ?? "number") as ItemType;
  const states = isObj(i.states)
    ? Object.fromEntries(
        Object.entries(i.states).map(([k, v]) => {
          const st = isObj(v) ? v : {};
          return [String(k), { text: String(st.text ?? k), color: ((st.color as ColorName) ?? "white") as ColorName }];
        }),
      )
    : undefined;
  return {
    id: String(i.id ?? ""),
    type,
    x: Number(i.x ?? 0),
    y: Number(i.y ?? 0),
    w: Number(i.w ?? GRID_COLS),
    h: Number(i.h ?? GRID_ROWS),
    label: String(i.label ?? ""),
    tag: String(i.tag ?? ""),
    unit: (i.unit as string | undefined) ?? (type === "percent" ? "%" : undefined),
    decimals: typeof i.decimals === "number" ? i.decimals : undefined,
    target: (i.target as string | number | undefined) ?? undefined,
    trend: i.trend === true,
    color: (i.color as ColorName | undefined) ?? undefined,
    thresholds: Array.isArray(i.thresholds) ? (i.thresholds as [number, number]) : undefined,
    better: i.better === "low" ? "low" : "high",
    states,
  };
}

/** Screen order for the demo cycle: own grid screens first, then OEE, 7 days, shift pattern, alarms. */
export function demoScreenOrder(layout: Layout): number[] {
  const rank: Record<ScreenType, number> = { grid: 0, oee: 1, week: 2, highscore: 3, shift: 4, alarms: 5 };
  return [...layout.screens].sort((a, b) => rank[a.type] - rank[b.type] || a.nr - b.nr).map((s) => s.nr);
}
