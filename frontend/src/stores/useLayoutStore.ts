import { create } from "zustand";
import type { Layout } from "@/layout/layout";

interface LayoutStore {
  layout: Layout | null;
  /** Validation errors from the backend (invalid dashboard.yaml), shown on the TV */
  error: string[] | null;
  setLayout: (layout: Layout) => void;
  setError: (error: string[]) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  layout: null,
  error: null,
  setLayout: (layout) => set({ layout, error: null }),
  setError: (error) => set({ error }),
}));
