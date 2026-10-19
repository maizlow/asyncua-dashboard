import type { Alarm, ConnectionStatus, DailyHistory, DataSource, Highscores, OeeDetails, ServerMessage, ShiftPatternRow } from "./types";
import { LayoutError } from "./types";
import { normaliseLayout } from "@/layout/layout";

/** ws(s)://<page host>/ws unless VITE_WS_URL overrides it. */
export function resolveWebSocketUrl(): string {
  const override = import.meta.env.VITE_WS_URL;
  if (override) return override;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws`;
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`);
  return (await res.json()) as T;
}

export function createLiveDataSource(): DataSource {
  let socket: WebSocket | null = null;
  let status: ConnectionStatus = "disconnected";
  let reconnectAttempts = 0;
  let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<(msg: ServerMessage) => void>();
  const statusListeners = new Set<() => void>();

  const setStatus = (next: ConnectionStatus) => {
    if (status === next) return;
    status = next;
    statusListeners.forEach((cb) => cb());
  };

  const scheduleReconnect = () => {
    if (reconnectTimeout) clearTimeout(reconnectTimeout);
    const delay = Math.min(1000 * 2 ** reconnectAttempts, 30000);
    reconnectAttempts++;
    reconnectTimeout = setTimeout(connect, delay);
  };

  function connect() {
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }
    setStatus("connecting");
    socket = new WebSocket(resolveWebSocketUrl());

    socket.onopen = () => {
      reconnectAttempts = 0;
      setStatus("connected");
      console.log("✅ WebSocket connected");
    };

    socket.onmessage = (event) => {
      let message: ServerMessage;
      try {
        message = JSON.parse(event.data) as ServerMessage;
      } catch (e) {
        console.error("Failed to parse message", e);
        return;
      }
      listeners.forEach((cb) => cb(message));
    };

    socket.onclose = () => {
      setStatus("disconnected");
      console.log("🔌 WebSocket disconnected");
      scheduleReconnect();
    };

    socket.onerror = () => {
      setStatus("disconnected");
    };
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      connect();
      return () => listeners.delete(listener);
    },
    subscribeStatus(listener) {
      statusListeners.add(listener);
      connect();
      return () => statusListeners.delete(listener);
    },
    getStatus: () => status,
    async getActiveScreen() {
      const data = await getJson<{ ActiveScreenNr?: number }>("/api/general");
      return typeof data.ActiveScreenNr === "number" ? data.ActiveScreenNr : undefined;
    },
    async getAlarms() {
      const data = await getJson<{ alarms?: Alarm[] }>("/api/alarms");
      return data.alarms ?? [];
    },
    async getShiftPattern() {
      const data = await getJson<{ data?: ShiftPatternRow[] }>("/api/shift-pattern");
      return data.data;
    },
    async getOeeDetails() {
      return await getJson<OeeDetails>("/api/oee");
    },
    async getDailyHistory() {
      return await getJson<DailyHistory>("/api/history/days?n=7");
    },
    async getHighscores() {
      return await getJson<Highscores>("/api/highscores?n=5");
    },
    async getLayout() {
      // ?display=tv2 picks one of several displays on this computer (default: the first)
      const display = new URLSearchParams(window.location.search).get("display");
      const res = await fetch(display ? `/api/layout?display=${encodeURIComponent(display)}` : "/api/layout");
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { details?: string[] } | null;
        throw new LayoutError(body?.details ?? [`/api/layout -> HTTP ${res.status}`]);
      }
      return normaliseLayout(await res.json());
    },
    requestSnapshot() {
      fetch("/api/snapshot", { method: "POST" }).catch(() => {});
    },
  };
}
