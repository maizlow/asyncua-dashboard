/**
 * Editor state: the draft document (the whole layout document), undo/redo as a stack of documents,
 * the selected display/screen/element and the clipboard. Every change is `edit(fn)`: fn mutates a copy.
 */
import { create } from "zustand";
import type { Doc } from "./backend";
import { documentView } from "@/layout/doc";
import { normaliseLayout, type Layout } from "@/layout/layout";
import { findWidget, portableCopy, screenNumbers, type Widget } from "./ops";
import type { ItemAudit } from "./audit";

const MAX_HISTORY = 200;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function displaysOf(doc: Doc | null): Record<string, Doc> {
  return doc && isObj(doc.displays) ? (doc.displays as Record<string, Doc>) : {};
}

/** The TV's view of the selected display (what /api/layout would serve after publishing) */
export function previewLayout(doc: Doc, displayId: string, version: number | null): Layout {
  return normaliseLayout(documentView(doc, displayId, version));
}

interface EditorStore {
  doc: Doc | null;
  /** The published document (to show unpublished changes) */
  published: Doc | null;
  version: number | null;
  past: Doc[];
  future: Doc[];
  displayId: string | null;
  screenNr: number | null;
  selected: string | null;
  clipboard: Widget | null;
  /** Legibility audit of the current screen (worst-case values), per element id */
  audit: Record<string, ItemAudit>;
  /** Merge key of the last edit: typing in one field is one undo step */
  lastMerge: string | null;
  /** Last message for the status line (e.g. why a drop was refused) */
  notice: { text: string; kind: "info" | "error" } | null;
  setLoaded: (doc: Doc, version: number | null) => void;
  /** Apply a change to a copy of the draft; throw Error(msg) inside fn to refuse it (shown as notice) */
  edit: (
    fn: (doc: Doc) => void,
    after?: Partial<Pick<EditorStore, "screenNr" | "selected">> | ((doc: Doc) => Partial<Pick<EditorStore, "screenNr" | "selected">>),
    merge?: string,
  ) => boolean;
  setAudit: (audit: Record<string, ItemAudit>) => void;
  undo: () => void;
  redo: () => void;
  selectDisplay: (id: string) => void;
  selectScreen: (nr: number | null) => void;
  select: (id: string | null) => void;
  copy: () => void;
  notify: (text: string, kind?: "info" | "error") => void;
}

/** Keep screen/element selection valid after the document changed under it (undo, delete …) */
function fixSelection(doc: Doc, displayId: string | null, screenNr: number | null, selected: string | null) {
  const ids = Object.keys(displaysOf(doc));
  const did = displayId && ids.includes(displayId) ? displayId : (ids[0] ?? null);
  const nrs = did ? screenNumbers(doc, did) : [];
  const nr = screenNr !== null && nrs.includes(screenNr) ? screenNr : (nrs[0] ?? null);
  const sel = did && nr !== null && selected && findWidget(doc, did, nr, selected) ? selected : null;
  return { displayId: did, screenNr: nr, selected: sel };
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  doc: null,
  published: null,
  version: null,
  past: [],
  future: [],
  displayId: null,
  screenNr: null,
  selected: null,
  clipboard: null,
  notice: null,
  audit: {},
  lastMerge: null,

  setLoaded: (doc, version) => {
    const want = new URLSearchParams(window.location.search).get("display");
    const ids = Object.keys(displaysOf(doc));
    const displayId = want && ids.includes(want) ? want : (ids[0] ?? null);
    set({
      doc,
      published: structuredClone(doc),
      version,
      past: [],
      future: [],
      ...fixSelection(doc, displayId, null, null),
    });
  },

  edit: (fn, after, merge) => {
    const { doc, past, displayId, screenNr, selected, lastMerge } = get();
    if (!doc) return false;
    const next = structuredClone(doc);
    try {
      fn(next);
    } catch (e) {
      set({ notice: { text: (e as Error).message, kind: "error" } });
      return false;
    }
    const extra = typeof after === "function" ? after(next) : (after ?? {});
    const sel = fixSelection(next, displayId, extra.screenNr ?? screenNr, extra.selected !== undefined ? extra.selected : selected);
    const same = merge !== undefined && merge === lastMerge && past.length > 0;
    set({ doc: next, past: same ? past : [...past, doc].slice(-MAX_HISTORY), future: [], notice: null, lastMerge: merge ?? null, ...sel });
    return true;
  },

  undo: () => {
    const { doc, past, future, displayId, screenNr, selected } = get();
    if (!doc || !past.length) return;
    const prev = past[past.length - 1];
    set({ doc: prev, past: past.slice(0, -1), future: [doc, ...future], notice: null, lastMerge: null, ...fixSelection(prev, displayId, screenNr, selected) });
  },

  redo: () => {
    const { doc, past, future, displayId, screenNr, selected } = get();
    if (!doc || !future.length) return;
    const next = future[0];
    set({ doc: next, past: [...past, doc], future: future.slice(1), notice: null, lastMerge: null, ...fixSelection(next, displayId, screenNr, selected) });
  },

  selectDisplay: (id) => {
    const { doc } = get();
    if (doc) set({ ...fixSelection(doc, id, null, null), notice: null });
  },
  selectScreen: (nr) => set({ screenNr: nr, selected: null, notice: null, lastMerge: null }),
  select: (id) => set({ selected: id, lastMerge: null }),

  copy: () => {
    const { doc, displayId, screenNr, selected } = get();
    if (!doc || !displayId || screenNr === null || !selected) return;
    const w = findWidget(doc, displayId, screenNr, selected);
    if (w) set({ clipboard: portableCopy(doc, displayId, w), notice: { text: `Kopierade ${w.label ?? w.id}`, kind: "info" } });
  },

  notify: (text, kind = "info") => set({ notice: { text, kind } }),
  setAudit: (audit) => set({ audit }),
}));
