import { useServerMessages } from "./useWebSocket";
import { useAlarmStore } from "@/stores/useAlarmStore";
import { useMetricsStore } from "@/stores/useMetricsStore";
import { qualifiedKey } from "@/lib/connection";

const qualifyAll = <T,>(connection: string | undefined, rec: Record<string, T> | undefined) =>
  Object.fromEntries(Object.entries(rec ?? {}).map(([k, v]) => [qualifiedKey(connection, k), v]));

/**
 * Routes pushed messages into the global stores. Mounted once (in App) so data keeps
 * flowing regardless of which screen is currently visible.
 */
export function useDataFeed() {
  useServerMessages((msg) => {
    switch (msg.type) {
      // The backend sends tag names within a connection; the demo sends qualified keys already
      case "data_update":
        useMetricsStore.getState().applyUpdate(qualifiedKey(msg.connection, msg.key), msg.value);
        break;
      case "full_snapshot":
        useMetricsStore.getState().applySnapshot(qualifyAll(msg.connection, msg.data), qualifyAll(msg.connection, msg.histories), msg.connection);
        for (const [c, up] of Object.entries(msg.connected ?? {})) useMetricsStore.getState().setConnected(c, up);
        break;
      case "connection_status":
        useMetricsStore.getState().setConnected(msg.connection, msg.connected);
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
      case "aggregates":
        if (msg.data) useMetricsStore.getState().setAggregates(msg.data);
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
