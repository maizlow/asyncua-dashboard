/**
 * Pure operations on the layout document (schema_version 2, as stored by the backend). The editor keeps
 * the whole document as its draft; every change goes through these functions on a copy, so undo/redo
 * is a stack of documents. Rules mirror backend/layout_doc.py (24 × 12 grid, value elements at least
 * 12 × 4, built-in screens alone and full size, screen numbers 1–99 = the PLC's ActiveScreenNr).
 */
import { BUILTIN_KINDS, GRID_COLS, GRID_ROWS, splitRef } from "@/layout/doc";
import type { Doc } from "./backend";

export const MIN_W = 12;
export const MIN_H = 4;
export const VALUE_KINDS = ["number", "percent", "counter", "time", "status"] as const;
export type ValueKind = (typeof VALUE_KINDS)[number];
export type BuiltinKind = (typeof BUILTIN_KINDS)[number];

export interface Widget {
  id: string;
  kind: string;
  x: number;
  y: number;
  w: number;
  h: number;
  label?: string;
  tag?: string;
  connection?: string;
  [key: string]: unknown;
}
export interface Screen {
  title?: string;
  items: Widget[];
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export const isBuiltin = (kind: string) => (BUILTIN_KINDS as readonly string[]).includes(kind);

export function display(doc: Doc, did: string): Doc {
  const d = (doc.displays as Record<string, Doc>)[did];
  if (!d) throw new Error(`okänd display ${did}`);
  d.screens ??= {};
  return d;
}

export function screens(doc: Doc, did: string): Record<string, Screen> {
  return display(doc, did).screens as Record<string, Screen>;
}

export function screen(doc: Doc, did: string, nr: number): Screen | undefined {
  const s = screens(doc, did)[String(nr)];
  if (s) s.items ??= [];
  return s;
}

export function connectionIds(doc: Doc): string[] {
  return isObj(doc.connections) ? Object.keys(doc.connections) : [];
}

/** The display's default connection (explicit, else the only one) */
export function defaultConnection(doc: Doc, did: string): string | null {
  const d = display(doc, did);
  if (typeof d.default_connection === "string") return d.default_connection;
  const ids = connectionIds(doc);
  return ids.length === 1 ? ids[0] : null;
}

export function tagsOf(doc: Doc, conn: string): string[] {
  const c = (doc.connections as Record<string, Doc> | undefined)?.[conn];
  return c && isObj(c.tags) ? Object.keys(c.tags) : [];
}

export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
export const inGrid = (r: Rect) => r.x >= 0 && r.y >= 0 && r.x + r.w <= GRID_COLS && r.y + r.h <= GRID_ROWS;

/** Free spot for a w × h element: the requested one if free, else the nearest free one (or null) */
export function freeSpot(items: Rect[], w: number, h: number, want?: { x: number; y: number }): Rect | null {
  const fits = (r: Rect) => inGrid(r) && !items.some((o) => overlaps(r, o));
  const cands: Rect[] = [];
  for (let y = 0; y + h <= GRID_ROWS; y++) for (let x = 0; x + w <= GRID_COLS; x++) cands.push({ x, y, w, h });
  const free = cands.filter(fits);
  if (!free.length) return null;
  if (!want) return free[0];
  const d = (r: Rect) => (r.x - want.x) ** 2 + (r.y - want.y) ** 2;
  return free.reduce((best, r) => (d(r) < d(best) ? r : best));
}

export function allIds(doc: Doc): Set<string> {
  const ids = new Set<string>();
  for (const d of Object.values((doc.displays ?? {}) as Record<string, Doc>))
    for (const s of Object.values((d.screens ?? {}) as Record<string, Screen>)) for (const w of s.items ?? []) ids.add(w.id);
  return ids;
}

export function newId(doc: Doc, did: string, kind: string): string {
  const ids = allIds(doc);
  for (let n = 1; ; n++) {
    const id = `${did}-${kind}-${n}`;
    if (!ids.has(id)) return id;
  }
}

/** Reserved tags (OEE, shifts, highscore) are not offered first for a new element */
const RESERVED = new Set(["ShiftStart", "ShiftEnd", "ProductionState", "PlannedTime", "GoodCount", "RejectCount"]);

/** A new value element with defaults that pass validation (bound to the display's default PLC) */
export function newValueWidget(doc: Doc, did: string, kind: ValueKind, at: Rect): Widget {
  const conn = defaultConnection(doc, did) ?? connectionIds(doc)[0];
  const tags = conn ? tagsOf(doc, conn) : [];
  const tag = tags.find((t) => !RESERVED.has(t)) ?? tags[0] ?? "Tagg";
  const short = defaultConnection(doc, did) === conn;
  const w: Widget = {
    id: newId(doc, did, kind),
    kind,
    ...at,
    label: { number: "Tal", percent: "Procent", counter: "Antal", time: "Tid", status: "Status" }[kind],
    tag: short ? tag : `${conn}.${tag}`,
  };
  if (kind === "counter") w.unit = "st";
  if (kind === "status")
    w.states = { 1: { text: "STOPP", color: "red" }, 2: { text: "KÖR", color: "green" } };
  return w;
}

export function nextScreenNr(doc: Doc, did: string, after = 0): number | null {
  const used = new Set(Object.keys(screens(doc, did)).map(Number));
  for (let n = after + 1; n <= 99; n++) if (!used.has(n)) return n;
  for (let n = 1; n <= 99; n++) if (!used.has(n)) return n;
  return null;
}

/** Sorted screen numbers of a display */
export function screenNumbers(doc: Doc, did: string): number[] {
  return Object.keys(screens(doc, did)).map(Number).sort((a, b) => a - b);
}

function setScreens(doc: Doc, did: string, entries: [number, Screen][]) {
  display(doc, did).screens = Object.fromEntries(entries.sort(([a], [b]) => a - b).map(([n, s]) => [String(n), s]));
}

// ------------------------------------------------------------------ screen operations (mutate `doc`)

export const BUILTIN_TITLES: Record<string, string> = {
  alarms: "Larm",
  shift: "Skiftmönster",
  oee: "OEE",
  week: "7 dagar",
  highscore: "Highscore",
};

export function addScreen(doc: Doc, did: string, kind: "grid" | BuiltinKind, after?: number): number {
  const nr = nextScreenNr(doc, did, after ?? Math.max(0, ...screenNumbers(doc, did)));
  if (nr === null) throw new Error("alla skärmnummer 1–99 är upptagna");
  const s: Screen =
    kind === "grid"
      ? { title: "Ny skärm", items: [] }
      : {
          title: BUILTIN_TITLES[kind],
          items: [
            {
              id: newId(doc, did, kind),
              kind,
              connection: defaultConnection(doc, did) ?? connectionIds(doc)[0],
              x: 0,
              y: 0,
              w: GRID_COLS,
              h: GRID_ROWS,
            },
          ],
        };
  setScreens(doc, did, [...Object.entries(screens(doc, did)).map(([n, x]) => [Number(n), x] as [number, Screen]), [nr, s]]);
  return nr;
}

export function duplicateScreen(doc: Doc, did: string, nr: number): number {
  const src = screen(doc, did, nr);
  if (!src) throw new Error(`skärm ${nr} finns inte`);
  const to = nextScreenNr(doc, did, nr);
  if (to === null) throw new Error("alla skärmnummer 1–99 är upptagna");
  const copy: Screen = structuredClone(src);
  if (copy.title) copy.title = `${copy.title} (kopia)`.slice(0, 40);
  // New ids, unique in the document and among the copies
  const seen = allIds(doc);
  for (const w of copy.items) {
    let n = 1;
    let id = `${did}-${w.kind}-${n}`;
    while (seen.has(id)) id = `${did}-${w.kind}-${++n}`;
    w.id = id;
    seen.add(id);
  }
  setScreens(doc, did, [...Object.entries(screens(doc, did)).map(([n, x]) => [Number(n), x] as [number, Screen]), [to, copy]]);
  return to;
}

export function deleteScreen(doc: Doc, did: string, nr: number) {
  delete screens(doc, did)[String(nr)];
}

/** Give screen `from` the number `to` (1–99, not taken) */
export function renumberScreen(doc: Doc, did: string, from: number, to: number) {
  if (!Number.isInteger(to) || to < 1 || to > 99) throw new Error("skärmnumret måste vara 1–99");
  if (from === to) return;
  const all = screens(doc, did);
  if (all[String(to)]) throw new Error(`skärm ${to} finns redan`);
  const s = all[String(from)];
  delete all[String(from)];
  setScreens(doc, did, [...Object.entries(all).map(([n, x]) => [Number(n), x] as [number, Screen]), [to, s]]);
}

/** Swap a screen with its neighbour in number order (the PLC numbers move with the content) */
export function moveScreen(doc: Doc, did: string, nr: number, dir: -1 | 1): number {
  const nrs = screenNumbers(doc, did);
  const i = nrs.indexOf(nr);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= nrs.length) return nr;
  const all = screens(doc, did);
  const other = nrs[j];
  const a = all[String(nr)];
  all[String(nr)] = all[String(other)];
  all[String(other)] = a;
  return other;
}

// ------------------------------------------------------------------ element operations (mutate `doc`)

export function findWidget(doc: Doc, did: string, nr: number, id: string): Widget | undefined {
  return screen(doc, did, nr)?.items.find((w) => w.id === id);
}

/** Why `rect` is not allowed for `id` on the screen (null = OK) */
export function placementProblem(doc: Doc, did: string, nr: number, id: string | null, kind: string, rect: Rect): string | null {
  const s = screen(doc, did, nr);
  if (!s) return "skärmen finns inte";
  if (!inGrid(rect)) return `utanför rutnätet ${GRID_COLS}×${GRID_ROWS}`;
  if (isBuiltin(kind)) return "inbyggda skärmar fyller hela skärmen";
  if (s.items.some((w) => w.id !== id && isBuiltin(w.kind))) return "skärmen är en inbyggd skärm – lägg till en rutnätsskärm";
  if (rect.w < MIN_W || rect.h < MIN_H) return `minst ${MIN_W}×${MIN_H} rutor för värden`;
  const other = s.items.find((w) => w.id !== id && overlaps(rect, w));
  return other ? `överlappar ${other.label ?? other.id}` : null;
}

export function setRect(doc: Doc, did: string, nr: number, id: string, rect: Rect) {
  const w = findWidget(doc, did, nr, id);
  if (!w) return;
  Object.assign(w, rect);
}

/** Place a new value element at (or near) `want`; returns its id, or throws with the reason */
export function addValueWidget(doc: Doc, did: string, nr: number, kind: ValueKind, want?: { x: number; y: number }): string {
  const s = screen(doc, did, nr);
  if (!s) throw new Error("välj en skärm först");
  if (s.items.some((w) => isBuiltin(w.kind))) throw new Error("det här är en inbyggd skärm – lägg till en rutnätsskärm för egna element");
  const spot = freeSpot(s.items, MIN_W, MIN_H, want);
  if (!spot) throw new Error(`ingen ledig plats för ${MIN_W}×${MIN_H} rutor – minska eller ta bort ett element`);
  const w = newValueWidget(doc, did, kind, spot);
  s.items.push(w);
  return w.id;
}

export function removeWidget(doc: Doc, did: string, nr: number, id: string) {
  const s = screen(doc, did, nr);
  if (s) s.items = s.items.filter((w) => w.id !== id);
}

/** For the clipboard: a copy whose tag references no longer depend on the source display's default PLC */
export function portableCopy(doc: Doc, did: string, w: Widget): Widget {
  const copy = structuredClone(w);
  const def = defaultConnection(doc, did);
  for (const f of ["tag", "target"] as const) {
    const v = copy[f];
    if (typeof v === "string" && def) copy[f] = splitRef(v, def).join(".");
  }
  return copy;
}

/** Paste a copied value element near its old position (same size if it fits, else the minimum) */
export function pasteWidget(doc: Doc, did: string, nr: number, src: Widget): string {
  const s = screen(doc, did, nr);
  if (!s) throw new Error("välj en skärm först");
  if (isBuiltin(src.kind)) throw new Error("inbyggda skärmar kopieras som hel skärm (Duplicera skärm)");
  if (s.items.some((w) => isBuiltin(w.kind))) throw new Error("det här är en inbyggd skärm – klistra in på en rutnätsskärm");
  const spot = freeSpot(s.items, src.w, src.h, src) ?? freeSpot(s.items, MIN_W, MIN_H, src);
  if (!spot) throw new Error("ingen ledig plats på skärmen");
  const w: Widget = { ...structuredClone(src), ...spot, id: newId(doc, did, src.kind) };
  // Shorten references to this display's default PLC again
  const def = defaultConnection(doc, did);
  for (const f of ["tag", "target"] as const) {
    const v = w[f];
    if (typeof v === "string" && def && v.startsWith(`${def}.`)) w[f] = v.slice(def.length + 1);
  }
  s.items.push(w);
  return w.id;
}
