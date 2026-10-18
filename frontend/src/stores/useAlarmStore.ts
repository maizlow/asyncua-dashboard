import { create } from "zustand";
import type { Alarm } from "@/data/types";

interface AlarmStore {
  alarms: Alarm[];
  setAlarms: (alarms: Alarm[]) => void;
  addAlarm: (alarm: Alarm) => void;
  removeAlarm: (alarmId: Alarm["ID"]) => void;
  clearAlarms: () => void;
}

// The backend normalises IDs to int where possible, but the alarm payload may carry
// the raw value. Compare as strings so "5" and 5 are treated as the same alarm.
const sameId = (a: Alarm["ID"], b: Alarm["ID"]) => String(a) === String(b);

export const useAlarmStore = create<AlarmStore>((set) => ({
  alarms: [],

  setAlarms: (alarms) => set({ alarms }),

  addAlarm: (alarm) =>
    set((state) => {
      if (state.alarms.some((a) => sameId(a.ID, alarm.ID))) return state;
      return { alarms: [...state.alarms, alarm] };
    }),

  removeAlarm: (alarmId) =>
    set((state) => ({
      alarms: state.alarms.filter((a) => !sameId(a.ID, alarmId)),
    })),

  clearAlarms: () => set({ alarms: [] }),
}));
