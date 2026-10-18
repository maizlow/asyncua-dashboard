"""In-memory state shared between the OPC thread and the API/WebSocket thread.

Setters are called from the OPC UA thread. They never touch WebSockets directly: messages
go through ``broadcaster.publish`` (thread-safe hand-off to the uvicorn loop) and history
writes go through the single SQLite writer thread.
"""

import logging
import threading
from collections.abc import Callable
from typing import Any

from backend.app.routers.websocket import broadcaster
from backend.opc.data_logger import data_logger

logger = logging.getLogger(__name__)


class DataStore:
    def __init__(self):
        self._data: dict[str, Any] = {}
        self._on_change_callbacks: list[Callable] = []
        # True while the OPC UA data subscription is up (set by opc_client.main); the highscore
        # tracker ends an ongoing run when the connection is lost instead of extending it
        self.connected = False

    def set(self, key: str, value: Any):
        self._data[key] = value

        # Persistent history (queued, non-blocking) + live value to all clients
        try:
            data_logger.log_value(key, value)
        except Exception:
            logger.exception("Failed to queue history point for %s", key)
        broadcaster.publish({"type": "data_update", "key": key, "value": value})

        for callback in self._on_change_callbacks:
            try:
                callback(key, value)
            except Exception:
                logger.exception("DataStore on_change callback failed for %s", key)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    async def get_history(self, key: str, limit: int = 150) -> list:
        """The most recent N values (chronological) for sparklines."""
        return await data_logger.get_history_values(key, limit=limit)

    async def get_history_points(self, key: str, limit: int = 150) -> list:
        """The most recent N points with timestamps."""
        return await data_logger.get_history_points(key, limit=limit)

    def on_change(self, callback: Callable):
        self._on_change_callbacks.append(callback)

    def clear(self):
        self._data.clear()


class AlarmStore:
    def __init__(self):
        self._lock = threading.Lock()
        self._active_alarms: dict[Any, Any] = {}
        self._on_add_callbacks: list[Callable] = []
        self._on_remove_callbacks: list[Callable] = []

    @staticmethod
    def _normalize_id(event_id):
        try:
            return int(event_id)
        except (ValueError, TypeError):
            return event_id

    def on_add(self, callback: Callable):
        self._on_add_callbacks.append(callback)

    def on_remove(self, callback: Callable):
        self._on_remove_callbacks.append(callback)

    def add(self, event_id, alarm: Any):
        norm_id = self._normalize_id(event_id)
        with self._lock:
            self._active_alarms[norm_id] = alarm
        for callback in self._on_add_callbacks:
            try:
                callback(norm_id, alarm)
            except Exception:
                logger.exception("AlarmStore on_add callback failed")

    def remove(self, event_id):
        norm_id = self._normalize_id(event_id)
        with self._lock:
            removed_alarm = self._active_alarms.pop(norm_id, None)
        if removed_alarm is None:
            return
        for callback in self._on_remove_callbacks:
            try:
                callback(norm_id, removed_alarm)
            except Exception:
                logger.exception("AlarmStore on_remove callback failed")

    def get_all(self) -> dict:
        with self._lock:
            return self._active_alarms.copy()

    def clear(self):
        with self._lock:
            self._active_alarms.clear()


class GeneralStore:
    def __init__(self):
        self._data: dict[str, Any] = {}
        self._on_change_callbacks: list[Callable] = []

    def set(self, key: str, value: Any):
        self._data[key] = value

        if key == "RequestedScreenNr" and isinstance(value, int):
            logger.info("Screen changed to %s, broadcasting to frontend", value)
            broadcaster.publish({"type": "screen_change", "screen": value})

        for callback in self._on_change_callbacks:
            try:
                callback(key, value)
            except Exception:
                logger.exception("GeneralStore on_change callback failed for %s", key)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def clear(self):
        self._data.clear()


# ============================================================
# GLOBAL INSTANCES
# ============================================================

data_store = DataStore()
alarm_store = AlarmStore()
general_store = GeneralStore()
