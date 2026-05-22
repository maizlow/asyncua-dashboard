from typing import Any, Callable
from backend.app.routers.websocket import broadcast
import asyncio

from backend.opc.data_logger import data_logger

class DataStore:
    def __init__(self):
        self._data: dict[str, Any] = {}
        self._on_change_callbacks: list[Callable] = []

    def set(self, key: str, value: Any):
        self._data[key] = value

        # Best-effort async write to persistent history (non-blocking)
        try:
            loop = asyncio.get_running_loop()
            asyncio.run_coroutine_threadsafe(
                data_logger.log_value(key, value),
                loop
            )
            # Broadcast live value only (no history in the hot path)
            asyncio.run_coroutine_threadsafe(
                broadcast({
                    "type": "data_update",
                    "key": key,
                    "value": value
                }),
                loop
            )
        except RuntimeError:
            # Fallback if no running loop
            print(f"⚠️ Could not broadcast data_update for {key} - no event loop")

        # Call other callbacks if any
        for callback in self._on_change_callbacks:
            callback(key, value)

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    async def get_history(self, key: str, limit: int = 150) -> list:
        """Return the most recent N values (oldest first) for sparklines."""
        return await data_logger.get_history_values(key, limit=limit)

    async def get_history_points(self, key: str, limit: int = 150) -> list:
        """Return the most recent N points with timestamps."""
        return await data_logger.get_history_points(key, limit=limit)

    def on_change(self, callback: Callable):
        self._on_change_callbacks.append(callback)

    def clear(self):
        self._data.clear()


class AlarmStore:
    def __init__(self):
        self._active_alarms: dict[int, Any] = {}
        self._on_add_callbacks: list = []
        self._on_remove_callbacks: list = []

    def _normalize_id(self, event_id):
        try:
            return int(event_id)
        except (ValueError, TypeError):
            return event_id

    def on_add(self, callback):
        self._on_add_callbacks.append(callback)

    def on_remove(self, callback):
        self._on_remove_callbacks.append(callback)

    def add(self, event_id, alarm: Any):
        norm_id = self._normalize_id(event_id)
        self._active_alarms[norm_id] = alarm

        # Notify listeners
        for callback in self._on_add_callbacks:
            callback(norm_id, alarm)

    def remove(self, event_id):
        norm_id = self._normalize_id(event_id)
        if norm_id in self._active_alarms:
            removed_alarm = self._active_alarms[norm_id]
            del self._active_alarms[norm_id]

            for callback in self._on_remove_callbacks:
                callback(norm_id, removed_alarm)

    def get_all(self) -> dict:
        return self._active_alarms.copy()

    def clear(self):
        self._active_alarms.clear()


class GeneralStore:
    def __init__(self):
        self._data: dict[str, Any] = {}
        self._on_change_callbacks: list = []

    def set(self, key: str, value: Any):
        self._data[key] = value

        # === Broadcast screen changes (thread-safe) ===
        if key == "RequestedScreenNr" and isinstance(value, int):
            print(f"📺 Screen changed to {value}, broadcasting to frontend...")

            try:
                # Get the running event loop from the main thread
                loop = asyncio.get_running_loop()
                asyncio.run_coroutine_threadsafe(
                    broadcast({
                        "type": "screen_change",
                        "screen": value
                    }),
                    loop
                )
            except RuntimeError:
                # Fallback if no running loop (shouldn't normally happen)
                print("⚠️ Could not broadcast screen change - no event loop found")

        for callback in self._on_change_callbacks:
            callback(key, value)

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