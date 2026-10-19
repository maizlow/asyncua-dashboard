import { create } from "zustand";
import type { DailyHistory, Highscores, MetricValue, OeeDetails, ShiftPatternRow } from "@/data/types";

// How many points we keep per tag for sparklines (rolling buffer)
const MAX_SPARKLINE_POINTS = 300;

interface MetricsStore {
  /** Keyed by qualified tag: plc1.OEE (see src/lib/connection.ts) */
  metrics: Record<string, MetricValue>;
  /** Per connection (PLC): false while its OPC UA connection is down */
  connected: Record<string, boolean>;
  histories: Record<string, MetricValue[]>;
  shiftPattern: ShiftPatternRow[] | null;
  oeeDetails: OeeDetails | null;
  dailyHistory: DailyHistory | null;
  highscores: Highscores | null;
  /** Date.now() when `highscores` arrived (the ongoing run is counted on from here) */
  highscoresAt: number;
  applyUpdate: (key: string, value: MetricValue) => void;
  /** Snapshot of one connection (keys already qualified); without connection it replaces everything */
  applySnapshot: (data: Record<string, MetricValue>, histories: Record<string, MetricValue[]>, connection?: string) => void;
  setConnected: (connection: string, connected: boolean) => void;
  setShiftPattern: (rows: ShiftPatternRow[]) => void;
  setOeeDetails: (details: OeeDetails) => void;
  setDailyHistory: (history: DailyHistory) => void;
  setHighscores: (data: Highscores) => void;
}

export const useMetricsStore = create<MetricsStore>((set) => ({
  metrics: {},
  connected: {},
  histories: {},
  shiftPattern: null,
  oeeDetails: null,
  dailyHistory: null,
  highscores: null,
  highscoresAt: 0,

  applyUpdate: (key, value) =>
    set((state) => ({
      metrics: { ...state.metrics, [key]: value },
      histories: {
        ...state.histories,
        [key]: [...(state.histories[key] ?? []), value].slice(-MAX_SPARKLINE_POINTS),
      },
    })),

  // Full snapshot (every ~10 s) is an authoritative reset from the server, for its connection only
  applySnapshot: (data, histories, connection) =>
    set((state) => {
      if (!connection) return { metrics: data ?? {}, histories: histories ?? {} };
      const keep = <T,>(rec: Record<string, T>) => Object.fromEntries(Object.entries(rec).filter(([k]) => !k.startsWith(`${connection}.`)));
      return { metrics: { ...keep(state.metrics), ...data }, histories: { ...keep(state.histories), ...histories } };
    }),

  setConnected: (connection, connected) => set((state) => ({ connected: { ...state.connected, [connection]: connected } })),

  setShiftPattern: (rows) => set({ shiftPattern: rows }),

  setOeeDetails: (details) => set({ oeeDetails: details }),

  setDailyHistory: (history) => set({ dailyHistory: history }),

  setHighscores: (data) => set({ highscores: data, highscoresAt: Date.now() }),
}));
