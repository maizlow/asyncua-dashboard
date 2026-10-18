import { useServerMessages } from "./useWebSocket";
import { useAlarmStore } from "@/stores/useAlarmStore";
import { useMetricsStore } from "@/stores/useMetricsStore";

/**
 * Routes pushed messages into the global stores. Mounted once (in App) so data keeps
 * flowing regardless of which screen is currently visible.
 */
export function useDataFeed() {
  useServerMessages((msg) => {
    switch (msg.type) {
      case "data_update":
        useMetricsStore.getState().applyUpdate(msg.key, msg.value);
        break;
      case "full_snapshot":
        useMetricsStore.getState().applySnapshot(msg.data, msg.histories);
        break;
      case "shift_pattern_data":
        if (Array.isArray(msg.data)) useMetricsStore.getState().setShiftPattern(msg.data);
        break;
      case "daily_history":
        if (msg.data) useMetricsStore.getState().setDailyHistory(msg.data);
        break;
      case "highscores":
        if (msg.data) useMetricsStore.getState().setHighscores(msg.data);
        break;
      case "oee_details":
        if (msg.data) useMetricsStore.getState().setOeeDetails(msg.data);
        break;
      case "alarm_added":
        if (msg.alarm) useAlarmStore.getState().addAlarm(msg.alarm);
        break;
      case "alarm_removed":
        if (msg.alarm_id !== undefined && msg.alarm_id !== null) {
          useAlarmStore.getState().removeAlarm(msg.alarm_id);
        }
        break;
    }
  });
}
