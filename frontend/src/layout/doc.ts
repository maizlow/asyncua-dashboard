/**
 * Layout document (schema_version 2) -> the view one display needs, the same JSON as GET /api/layout.
 * Mirrors backend/layout_doc.py (migrate_v1 + layout_view); scripts/test-layout.mjs checks both against
 * the shared fixtures in ./fixtures. Pure and dependency-free: vite.config.ts also runs it at build
 * time for the demo, which has no backend. Validation stays in the backend (python -m backend.layout_doc).
 */

export const GRID_COLS = 24;
export const GRID_ROWS = 12;
export const BUILTIN_KINDS = ["alarms", "shift", "oee", "week", "highscore"] as const;
const DEFAULT_CONNECTION = "plc1";
const DEFAULT_DISPLAY = "tv1";

type Raw = Record<string, unknown>;
const isObj = (v: unknown): v is Raw => typeof v === "object" && v !== null && !Array.isArray(v);

export interface HeaderSlotView {
  kind: "logo" | "clock" | "text" | "title" | "none";
  asset?: "customer" | "vendor";
  text?: string;
}
export interface LayoutView {
  schema_version: 2;
  version: number | null;
  display: { id: string; name: string | null; theme: string; header: Record<"left" | "center" | "right", HeaderSlotView> };
  displays: { id: string; name: string | null }[];
  grid: { cols: number; rows: number };
  screens: Record<string, { title: string | null; items: Raw[] }>;
  tags: Record<string, Raw>;
}

/** Today's grid screen: 1 item = full size, else 2 columns and ceil(n/2) rows -> [x, y, w, h]. */
export function gridPlacement(n: number): [number, number, number, number][] {
  if (n <= 1) return [[0, 0, GRID_COLS, GRID_ROWS]];
  const h = Math.floor(GRID_ROWS / Math.ceil(n / 2));
  return Array.from({ length: n }, (_, i) => [(i % 2) * (GRID_COLS / 2), Math.floor(i / 2) * h, GRID_COLS / 2, h]);
}

// Item fields with their dashboard.yaml defaults (dropped when equal, as pydantic's exclude_defaults)
const ITEM_DEFAULTS: Raw = { trend: false, better: "high" };

/** dashboard.yaml (version 1) -> document: opc + tags = connection plc1, screens = display tv1. */
export function migrateV1(raw: unknown): Raw {
  const root = isObj(raw) ? raw : {};
  const opc = isObj(root.opc) ? root.opc : {};
  const screens: Raw = {};
  for (const [nr, s] of Object.entries(isObj(root.screens) ? root.screens : {})) {
    const scr = isObj(s) ? s : {};
    const type = (scr.type as string | undefined) ?? "grid";
    let items: Raw[];
    if (type === "grid") {
      const src = (Array.isArray(scr.items) ? scr.items : []).filter(isObj);
      const place = gridPlacement(src.length);
      items = src.map((item, i) => {
        const { type: kind = "number", ...rest } = item;
        const fields = Object.fromEntries(Object.entries(rest).filter(([k, v]) => v !== null && ITEM_DEFAULTS[k] !== v));
        const [x, y, w, h] = place[i];
        return { id: `s${nr}-${i + 1}`, kind, x, y, w, h, ...fields };
      });
    } else {
      items = [{ id: `s${nr}-1`, kind: type, x: 0, y: 0, w: GRID_COLS, h: GRID_ROWS }];
    }
    screens[nr] = { title: scr.title ?? null, items };
  }
  return {
    schema_version: 2,
    connections: { [DEFAULT_CONNECTION]: { url: opc.url ?? null, alarms: opc.alarms ?? "", tags: root.tags ?? {} } },
    displays: { [DEFAULT_DISPLAY]: { connection: DEFAULT_CONNECTION, screen: opc.screen, screens } },
  };
}

const DEFAULT_HEADER: LayoutView["display"]["header"] = {
  left: { kind: "logo", asset: "customer" },
  center: { kind: "clock" },
  right: { kind: "logo", asset: "vendor" },
};

function headerView(raw: unknown): LayoutView["display"]["header"] {
  const h = isObj(raw) ? raw : {};
  const slot = (key: "left" | "center" | "right"): HeaderSlotView => {
    const s = h[key];
    if (!isObj(s)) return DEFAULT_HEADER[key];
    const out: HeaderSlotView = { kind: (s.kind as HeaderSlotView["kind"]) ?? "none" };
    if (s.asset != null) out.asset = s.asset as HeaderSlotView["asset"];
    if (s.text != null) out.text = String(s.text);
    return out;
  };
  return { left: slot("left"), center: slot("center"), right: slot("right") };
}

function widgetView(w: Raw): Raw {
  const out: Raw = Object.fromEntries(Object.entries(w).filter(([, v]) => v !== null && v !== undefined));
  if (out.kind === "percent" && out.unit === undefined) out.unit = "%";
  if (isObj(out.states))
    out.states = Object.fromEntries(
      Object.entries(out.states).map(([k, v]) => [String(k), { color: "white", ...(isObj(v) ? v : {}) }]),
    );
  return out;
}

function tagView(spec: unknown): Raw {
  const t = isObj(spec) ? spec : { node: spec };
  const out: Raw = { type: t.type ?? "auto" };
  if (t.demo != null) out.demo = t.demo;
  out.placeholder = !String(t.node ?? "").trim(); // TODO(PLC) tag without node id
  return out;
}

/** A v2 document -> the view of one display (default: the first). No node ids, no URLs. */
export function documentView(doc: Raw, displayId?: string, version: number | null = null): LayoutView {
  const displays = isObj(doc.displays) ? doc.displays : {};
  const connections = isObj(doc.connections) ? doc.connections : {};
  const id = displayId ?? Object.keys(displays)[0];
  const d = isObj(displays[id]) ? (displays[id] as Raw) : {};
  const conn = connections[(d.connection as string | undefined) ?? DEFAULT_CONNECTION];
  const tags = isObj(conn) && isObj(conn.tags) ? conn.tags : {};
  const screens = isObj(d.screens) ? d.screens : {};
  return {
    schema_version: 2,
    version,
    display: { id, name: (d.name as string | undefined) ?? null, theme: (d.theme as string | undefined) ?? "abece-dark", header: headerView(d.header) },
    displays: Object.entries(displays).map(([k, v]) => ({ id: k, name: (isObj(v) && (v.name as string)) || null })),
    grid: { cols: GRID_COLS, rows: GRID_ROWS },
    screens: Object.fromEntries(
      Object.entries(screens)
        .sort(([a], [b]) => Number(a) - Number(b))
        .map(([nr, s]) => {
          const scr = isObj(s) ? s : {};
          return [nr, { title: (scr.title as string | undefined) ?? null, items: (Array.isArray(scr.items) ? scr.items : []).filter(isObj).map(widgetView) }];
        }),
    ),
    tags: Object.fromEntries(Object.entries(tags).map(([name, spec]) => [name, tagView(spec)])),
  };
}

/** Either file format (v2 if it has schema_version, else dashboard.yaml v1) -> document. */
export function toDocument(raw: unknown): Raw {
  return isObj(raw) && raw.schema_version !== undefined ? raw : migrateV1(raw);
}

/** Views of every display in a file (the demo bundles these: nothing secret, no node ids). */
export function displayViews(raw: unknown): Record<string, LayoutView> {
  const doc = toDocument(raw);
  return Object.fromEntries(Object.keys(isObj(doc.displays) ? doc.displays : {}).map((id) => [id, documentView(doc, id)]));
}
