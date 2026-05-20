import { create } from 'zustand';

interface Alarm {
  ID: number;
  message: string;
  timestamp: string;
  displayClass: number;
}

interface AlarmStore {
  alarms: Alarm[];
  setAlarms: (alarms: Alarm[]) => void;
  addAlarm: (alarm: Alarm) => void;
  removeAlarm: (alarmId: number) => void;
  clearAlarms: () => void;
}

export const useAlarmStore = create<AlarmStore>((set) => ({
  alarms: [],

  setAlarms: (alarms) => set({ alarms }),

  addAlarm: (alarm) =>
    set((state) => {
      const exists = state.alarms.some((a) => a.ID === alarm.ID);
      if (exists) return state;
      return { alarms: [...state.alarms, alarm] };
    }),

  removeAlarm: (alarmId) =>
    set((state) => ({
      alarms: state.alarms.filter((a) => a.ID !== alarmId),
    })),

  clearAlarms: () => set({ alarms: [] }),
}));