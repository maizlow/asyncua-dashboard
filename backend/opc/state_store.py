from collections import deque
from datetime import datetime
from typing import Any, Callable


class DataStore:
    def __init__(self, history_seconds: int = 300, sample_interval: int = 2):
        self._data: dict[str, Any] = {}
        self._history: dict[str, deque] = {}
        self._maxlen = int(history_seconds / sample_interval)
        self._on_change_callbacks: list[Callable] = []

    def _normalize_key(self, key: str) -> str:
        """Normalize key to lowercase for case-insensitive access."""
        return key.lower()

    def set(self, key: str, value: Any):
        norm_key = self._normalize_key(key)
        self._data[norm_key] = value

        if norm_key not in self._history:
            self._history[norm_key] = deque(maxlen=self._maxlen)

        self._history[norm_key].append((datetime.now(), value))

        for callback in self._on_change_callbacks:
            callback(key, value)

    def get(self, key: str, default: Any = None) -> Any:
        norm_key = self._normalize_key(key)
        return self._data.get(norm_key, default)

    def get_history(self, key: str) -> list:
        """Returns list of values (oldest first). Case-insensitive."""
        norm_key = self._normalize_key(key)
        if norm_key in self._history:
            return [v for _, v in self._history[norm_key]]
        return []

    def on_change(self, callback: Callable):
        self._on_change_callbacks.append(callback)

    def clear(self):
        self._data.clear()
        self._history.clear()


class AlarmStore:
    def __init__(self):
        self._active_alarms: dict[str, Any] = {}

    def add(self, event_id: str, alarm: Any):
        self._active_alarms[event_id] = alarm

    def remove(self, event_id: str):
        self._active_alarms.pop(event_id, None)

    def get_all(self) -> dict:
        return self._active_alarms.copy()

    def clear(self):
        self._active_alarms.clear()


class GeneralStore:
    def __init__(self):
        self._data: dict[str, Any] = {}

    def set(self, key: str, value: Any):
        self._data[key] = value

    def get(self, key: str, default: Any = None) -> Any:
        return self._data.get(key, default)

    def clear(self):
        self._data.clear()


# ============================================================
# GLOBAL INSTANCES
# ============================================================

data_store = DataStore(history_seconds=300, sample_interval=2)
alarm_store = AlarmStore()
general_store = GeneralStore()