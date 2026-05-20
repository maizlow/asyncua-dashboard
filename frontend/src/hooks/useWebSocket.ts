import { useEffect, useState } from "react";

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

// === True Singleton ===
let socket: WebSocket | null = null;
let listeners: Set<(msg: WebSocketMessage) => void> = new Set();
let isConnecting = false;

function connectWebSocket() {
  // Prevent multiple connections (including during StrictMode double mount)
  if (socket || isConnecting) {
    return;
  }

  isConnecting = true;

  socket = new WebSocket("ws://localhost:8000/ws");

  socket.onopen = () => {
    console.log("✅ Global WebSocket connected");
    isConnecting = false;
  };

  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      listeners.forEach((listener) => listener(message));
    } catch (err) {
      console.error("Failed to parse WebSocket message", err);
    }
  };

  socket.onclose = () => {
    console.log("🔌 Global WebSocket disconnected");
    socket = null;
    isConnecting = false;
  };

  socket.onerror = (err) => {
    console.error("WebSocket error:", err);
    isConnecting = false;
  };
}

export function useWebSocket() {
  const [lastMessage, setLastMessage] = useState<WebSocketMessage | null>(null);

  useEffect(() => {
    const listener = (msg: WebSocketMessage) => setLastMessage(msg);
    listeners.add(listener);

    connectWebSocket();

    return () => {
      listeners.delete(listener);
    };
  }, []);

  return lastMessage;
}