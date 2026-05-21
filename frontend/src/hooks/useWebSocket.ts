import { useEffect, useState } from "react";

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

type ConnectionStatus = "connecting" | "connected" | "disconnected";

// ===================== SINGLETON =====================
let socket: WebSocket | null = null;
let listeners: ((msg: WebSocketMessage) => void)[] = [];
let statusListeners: ((status: ConnectionStatus) => void)[] = [];
let currentStatus: ConnectionStatus = "disconnected";
let reconnectAttempts = 0;
let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

function connectWebSocket() {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
    return;
  }

  currentStatus = "connecting";
  statusListeners.forEach(cb => cb(currentStatus));

  socket = new WebSocket("ws://localhost:8000/ws");

  socket.onopen = () => {
    currentStatus = "connected";
    reconnectAttempts = 0;
    statusListeners.forEach(cb => cb(currentStatus));
    console.log("✅ Global WebSocket connected (singleton)");
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      listeners.forEach(cb => cb(message));
    } catch (e) {
      console.error("Failed to parse message", e);
    }
  };

  socket.onclose = () => {
    currentStatus = "disconnected";
    statusListeners.forEach(cb => cb(currentStatus));
    console.log("🔌 Global WebSocket disconnected");
    attemptReconnect();
  };

  socket.onerror = () => {
    currentStatus = "disconnected";
    statusListeners.forEach(cb => cb(currentStatus));
  };
}

function attemptReconnect() {
  if (reconnectTimeout) clearTimeout(reconnectTimeout);

  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
  reconnectAttempts++;

  reconnectTimeout = setTimeout(() => {
    connectWebSocket();
  }, delay);
}

// ===================== HOOK =====================
export function useWebSocket() {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>(currentStatus);

  useEffect(() => {
    const handleMessage = (msg: WebSocketMessage) => setLastMessage(msg);
    const handleStatus = (s: ConnectionStatus) => setStatus(s);

    listeners.push(handleMessage);
    statusListeners.push(handleStatus);

    // Connect only once (singleton)
    connectWebSocket();

    return () => {
      listeners = listeners.filter(cb => cb !== handleMessage);
      statusListeners = statusListeners.filter(cb => cb !== handleStatus);
    };
  }, []);

  return { lastMessage, status };
}