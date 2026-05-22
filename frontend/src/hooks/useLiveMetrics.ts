import { useEffect, useState } from "react";
import { useWebSocket } from "./useWebSocket";

// How many points we keep per tag for sparklines (rolling buffer)
const MAX_SPARKLINE_POINTS = 300;

export function useLiveMetrics() {
  const [metrics, setMetrics] = useState<Record<string, any>>({});
  const [histories, setHistories] = useState<Record<string, any[]>>({});
  const { lastMessage } = useWebSocket();

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "data_update") {
      const { key, value } = lastMessage;

      // Update current value
      setMetrics(prev => ({ ...prev, [key]: value }));

      // Append to local rolling history for smooth, near real-time sparklines
      setHistories(prev => {
        const current = prev[key] ?? [];
        const next = [...current, value].slice(-MAX_SPARKLINE_POINTS);
        return { ...prev, [key]: next };
      });
    }

    if (lastMessage.type === "full_snapshot") {
      // Full snapshot every 10 seconds - authoritative reset from server
      console.log("📦 Received full snapshot");
      setMetrics(lastMessage.data || {});
      setHistories(lastMessage.histories || {});
    }
  }, [lastMessage]);

  return { metrics, histories };
}