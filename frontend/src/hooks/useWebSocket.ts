import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { dataSource } from "@/data/dataSource";
import type { ConnectionStatus, ServerMessage } from "@/data/types";

/** Current connection status of the data source (WebSocket, or the demo simulator). */
export function useConnectionStatus(): ConnectionStatus {
  return useSyncExternalStore(dataSource.subscribeStatus, dataSource.getStatus);
}

/**
 * Calls `handler` for every pushed message. Unlike a "lastMessage" state value,
 * no message is lost when several arrive within the same render.
 */
export function useServerMessages(handler: (msg: ServerMessage) => void) {
  const handlerRef = useRef(handler);
  useLayoutEffect(() => {
    handlerRef.current = handler;
  });
  useEffect(() => dataSource.subscribe((msg) => handlerRef.current(msg)), []);
}
