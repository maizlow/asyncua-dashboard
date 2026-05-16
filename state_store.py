import sys
import asyncio
import inspect  
from models import AlarmDetails

# 🛡️ THE HOT-RELOAD SHIELD:
# Instead of creating a new dict on every re-import, we check if our unique cache 
# key already exists in Python's protected system module registry. 
# This prevents Streamlit hot reloads from wiping your active data!
if not hasattr(sys, "_INDUSTRIAL_ALARM_CACHE"):
    sys._INDUSTRIAL_ALARM_CACHE = {}
    sys._INDUSTRIAL_GENERAL_CACHE = {}

# Bind our internal variables directly to the protected system-level memory
_SHARED_ALARM_CACHE: dict[str, AlarmDetails] = sys._INDUSTRIAL_ALARM_CACHE
_SHARED_GENERAL_CACHE: dict[str, any] = sys._INDUSTRIAL_GENERAL_CACHE

class AlarmStore:
    """An in-memory state store tracking AlarmDetails that triggers events on changes."""
    def __init__(self):
        self._active_alarms = _SHARED_ALARM_CACHE
        self._on_add_callbacks = []
        self._on_remove_callbacks = []

    def on_add(self, callback):
        self._on_add_callbacks.append(callback)
        return callback

    def on_remove(self, callback):
        self._on_remove_callbacks.append(callback)
        return callback

    def add_alarm(self, event_id: str, alarm: AlarmDetails):
        self._active_alarms[event_id] = alarm
        
        for callback in self._on_add_callbacks:
            if inspect.iscoroutinefunction(callback):
                asyncio.create_task(callback(event_id, alarm))
            else:
                callback(event_id, alarm)

    def remove_alarm(self, event_id: str):
        if event_id in self._active_alarms:
            removed_alarm = self._active_alarms[event_id]
            del self._active_alarms[event_id]
            
            for callback in self._on_remove_callbacks:
                if inspect.iscoroutinefunction(callback):
                    asyncio.create_task(callback(event_id, removed_alarm))
                else:
                    callback(event_id, removed_alarm)

    def clear_store(self):
        self._active_alarms.clear()

    def get_active_alarms(self) -> dict[str, AlarmDetails]:
        return self._active_alarms.copy()


class GeneralStore:
    """A more generic state store for other types of data (not just alarms)."""
    def __init__(self):
        self._data = _SHARED_GENERAL_CACHE
        self._on_change_callbacks = []

    def on_change(self, callback):
        self._on_change_callbacks.append(callback)
        return callback

    def set(self, key: str, value):
        self._data[key] = value
        
        for callback in self._on_change_callbacks:
            if inspect.iscoroutinefunction(callback):
                asyncio.create_task(callback(key, value))
            else:
                callback(key, value)

    def get(self, key: str):
        return self._data.get(key)

    def clear(self):
        self._data.clear()


# Global tracking instances exposed to your application modules
alarm_store = AlarmStore()
general_store = GeneralStore()