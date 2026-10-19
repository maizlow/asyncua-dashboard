import { create } from "zustand";
import type { Layout } from "@/layout/layout";

interface LayoutStore {
  layout: Layout | null;
  /** Validation errors from the backend (invalid layout), shown on the TV */
  error: string[] | null;
  /** Screen currently shown (for a header slot of kind "title") */
  screenNr: number | null;
  setLayout: (layout: Layout) => void;
  setScreenNr: (nr: number) => void;
  setError: (error: string[]) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  layout: null,
  error: null,
  screenNr: null,
  setScreenNr: (screenNr) => set({ screenNr }),
  setLayout: (layout) => set({ layout, error: null }),
  setError: (error) => set({ error }),
}));
