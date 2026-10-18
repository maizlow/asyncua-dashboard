import { create } from "zustand";
import type { DailyHistory, MetricValue, OeeDetails, ShiftPatternRow } from "@/data/types";

// How many points we keep per tag for sparklines (rolling buffer)
const MAX_SPARKLINE_POINTS = 300;

interface MetricsStore {
  metrics: Record<string, MetricValue>;
  histories: Record<string, MetricValue[]>;
  shiftPattern: ShiftPatternRow[] | null;
  oeeDetails: OeeDetails | null;
  dailyHistory: DailyHistory | null;
  applyUpdate: (key: string, value: MetricValue) => void;
  applySnapshot: (data: Record<string, MetricValue>, histories: Record<string, MetricValue[]>) => void;
  setShiftPattern: (rows: ShiftPatternRow[]) => void;
  setOeeDetails: (details: OeeDetails) => void;
  setDailyHistory: (history: DailyHistory) => void;
}

export const useMetricsStore = create<MetricsStore>((set) => ({
  metrics: {},
  histories: {},
  shiftPattern: null,
  oeeDetails: null,
  dailyHistory: null,

  applyUpdate: (key, value) =>
    set((state) => ({
      metrics: { ...state.metrics, [key]: value },
      histories: {
        ...state.histories,
        [key]: [...(state.histories[key] ?? []), value].slice(-MAX_SPARKLINE_POINTS),
      },
    })),

  // Full snapshot (every ~10 s) is an authoritative reset from the server
  applySnapshot: (data, histories) => set({ metrics: data ?? {}, histories: histories ?? {} }),

  setShiftPattern: (rows) => set({ shiftPattern: rows }),

  setOeeDetails: (details) => set({ oeeDetails: details }),

  setDailyHistory: (history) => set({ dailyHistory: history }),
}));
