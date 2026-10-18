/**
 * Dashboard layout from dashboard.yaml (see docs/CONFIG.md).
 * Live: GET /api/layout (validated + normalised by the backend). Demo: the same YAML bundled at
 * build time. normaliseLayout() applies the same defaults so both look identical to the screens.
 */

export type ColorName = "white" | "green" | "amber" | "red" | "grey";
export type ItemType = "number" | "percent" | "counter" | "time" | "status";
export type ScreenType = "grid" | "alarms" | "shift" | "oee";

export interface ItemConfig {
  type: ItemType;
  label: string;
  tag: string;
  unit?: string;
  decimals?: number;
  /** Tag name or fixed number */
  target?: string | number;
  trend: boolean;
  color?: ColorName;
  /** [warn, good] */
  thresholds?: [number, number];
  better: "high" | "low";
  states?: Record<string, { text: string; color: ColorName }>;
}

export interface ScreenConfig {
  nr: number;
  type: ScreenType;
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

export interface Layout {
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

export function normaliseLayout(raw: unknown): Layout {
  const root = isObj(raw) ? raw : {};
  const rawScreens = isObj(root.screens) ? root.screens : {};
  const screens: ScreenConfig[] = Object.entries(rawScreens)
    .map(([nr, s]) => {
      const scr = isObj(s) ? s : {};
      const items = Array.isArray(scr.items) ? scr.items.filter(isObj).map(normaliseItem) : [];
      return {
        nr: Number(nr),
        type: ((scr.type as ScreenType) ?? "grid") as ScreenType,
        title: (scr.title as string | undefined) ?? undefined,
        items,
      };
    })
    .filter((s) => Number.isInteger(s.nr))
    .sort((a, b) => a.nr - b.nr);

  const rawTags = isObj(root.tags) ? root.tags : {};
  const tags: Record<string, TagConfig> = {};
  for (const [name, spec] of Object.entries(rawTags)) {
    const t = isObj(spec) ? spec : {};
    tags[name] = {
      type: t.type === "time" ? "time" : "auto",
      demo: t.demo as TagConfig["demo"],
      placeholder: t.placeholder === true,
    };
  }
  return { screens, tags };
}

function normaliseItem(i: Raw): ItemConfig {
  const type = ((i.type as ItemType) ?? "number") as ItemType;
  const states = isObj(i.states)
    ? Object.fromEntries(
        Object.entries(i.states).map(([k, v]) => {
          const st = isObj(v) ? v : {};
          return [String(k), { text: String(st.text ?? k), color: ((st.color as ColorName) ?? "white") as ColorName }];
        }),
      )
    : undefined;
  return {
    type,
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

/** Screen order for the demo cycle: own grid screens first, then OEE, shift pattern, alarms. */
export function demoScreenOrder(layout: Layout): number[] {
  const rank: Record<ScreenType, number> = { grid: 0, oee: 1, shift: 2, alarms: 3 };
  return [...layout.screens].sort((a, b) => rank[a.type] - rank[b.type] || a.nr - b.nr).map((s) => s.nr);
}
