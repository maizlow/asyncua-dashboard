export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export type MetricValue = number | string;

export interface Alarm {
  ID: number | string;
  message: string;
  timestamp: string;
  displayClass: number;
}

export interface ShiftPatternRow {
  time: string;
  running: number;
  stopped: number;
}

export type ServerMessage =
  | { type: "data_update"; key: string; value: MetricValue }
  | {
      type: "full_snapshot";
      data: Record<string, MetricValue>;
      histories: Record<string, MetricValue[]>;
    }
  | { type: "alarm_added"; alarm_id: number | string; alarm: Alarm }
  | { type: "alarm_removed"; alarm_id: number | string; alarm?: Alarm }
  | { type: "shift_pattern_data"; data: ShiftPatternRow[] }
  | { type: "screen_change"; screen: number };

/**
 * Everything the UI needs from "the outside world". The real implementation talks
 * to the FastAPI backend (WebSocket + read-only REST); the demo implementation
 * simulates a production line in the browser.
 */
export interface DataSource {
  /** Subscribe to every pushed message. Returns an unsubscribe function. */
  subscribe(listener: (msg: ServerMessage) => void): () => void;
  /** Subscribe to connection status changes. Returns an unsubscribe function. */
  subscribeStatus(listener: () => void): () => void;
  getStatus(): ConnectionStatus;
  /** Screen currently selected by the PLC, if known. */
  getActiveScreen(): Promise<number | undefined>;
  getAlarms(): Promise<Alarm[]>;
  getShiftPattern(): Promise<ShiftPatternRow[] | undefined>;
  /** Ask for an immediate full_snapshot push (read-only, no PLC write). */
  requestSnapshot(): void;
}
