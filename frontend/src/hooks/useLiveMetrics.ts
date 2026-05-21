import { useEffect, useState } from "react";
import { useWebSocket } from "./useWebSocket";

export function useLiveMetrics() {
  const [metrics, setMetrics] = useState<Record<string, any>>({});
  const [histories, setHistories] = useState<Record<string, number[]>>({});
  const lastMessage = useWebSocket();

  useEffect(() => {
    if (!lastMessage) return;

    if (lastMessage.type === "data_update") {
      // Real-time update
      setMetrics(prev => ({ ...prev, [lastMessage.key]: lastMessage.value }));
      
      if (Array.isArray(lastMessage.history)) {
        setHistories(prev => ({ ...prev, [lastMessage.key]: lastMessage.history }));
      }
    }

    if (lastMessage.type === "full_snapshot") {
      // Full snapshot every 10 seconds
      console.log("📦 Received full snapshot");
      setMetrics(lastMessage.data || {});
      setHistories(lastMessage.histories || {});
    }
  }, [lastMessage]);

  return { metrics, histories };
}