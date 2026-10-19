import { create } from "zustand";
import type { Doc } from "./backend";
import { documentView } from "@/layout/doc";
import { normaliseLayout, type Layout } from "@/layout/layout";

interface EditorStore {
  doc: Doc | null;
  version: number | null;
  displayId: string | null;
  screenNr: number | null;
  setLoaded: (doc: Doc, version: number | null) => void;
  selectDisplay: (id: string) => void;
  selectScreen: (nr: number) => void;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export function displaysOf(doc: Doc | null): Record<string, Doc> {
  return doc && isObj(doc.displays) ? (doc.displays as Record<string, Doc>) : {};
}

export function screenNrs(doc: Doc | null, displayId: string | null): number[] {
  const d = displayId ? displaysOf(doc)[displayId] : undefined;
  return d && isObj(d.screens) ? Object.keys(d.screens).map(Number).sort((a, b) => a - b) : [];
}

/** The TV's view of the selected display (what /api/layout would serve after publishing) */
export function previewLayout(doc: Doc, displayId: string, version: number | null): Layout {
  return normaliseLayout(documentView(doc, displayId, version));
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  doc: null,
  version: null,
  displayId: null,
  screenNr: null,
  setLoaded: (doc, version) => {
    const want = new URLSearchParams(window.location.search).get("display");
    const ids = Object.keys(displaysOf(doc));
    const displayId = want && ids.includes(want) ? want : (ids[0] ?? null);
    set({ doc, version, displayId, screenNr: screenNrs(doc, displayId)[0] ?? null });
  },
  selectDisplay: (id) => set({ displayId: id, screenNr: screenNrs(get().doc, id)[0] ?? null }),
  selectScreen: (nr) => set({ screenNr: nr }),
}));
