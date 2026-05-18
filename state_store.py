from collections import deque
from datetime import datetime
import sys
import asyncio
import inspect  
from models import AlarmDetails
import config

# 🛡️ THE HOT-RELOAD SHIELD:
# Instead of creating a new dict on every re-import, we check if our unique cache 
# key already exists in Python's protected system module registry. 
# This prevents Streamlit hot reloads from wiping your active data!
if not hasattr(sys, "_INDUSTRIAL_ALARM_CACHE"):
    sys._INDUSTRIAL_ALARM_CACHE = {}

if not hasattr(sys, "_INDUSTRIAL_GENERAL_CACHE"):
    sys._INDUSTRIAL_GENERAL_CACHE = {}

if not hasattr(sys, "_INDUSTRIAL_DATA_CACHE"):
    sys._INDUSTRIAL_DATA_CACHE = {}

if not hasattr(sys, "_INDUSTRIAL_HISTORY_CACHE"):
    sys._INDUSTRIAL_HISTORY_CACHE = {}


# Bind our internal variables directly to the protected system-level memory
_SHARED_ALARM_CACHE: dict[str, AlarmDetails] = sys._INDUSTRIAL_ALARM_CACHE
_SHARED_GENERAL_CACHE: dict[str, any] = sys._INDUSTRIAL_GENERAL_CACHE
_SHARED_DATA_CACHE: dict[str, any] = sys._INDUSTRIAL_DATA_CACHE

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

class DataStore:
    """A simple in-memory key-value store with change event support."""
    def __init__(self, history_seconds: int = 300, sample_interval: int = 2):
        self._data = _SHARED_DATA_CACHE
        self._history: dict[str, deque] = sys._INDUSTRIAL_HISTORY_CACHE
        self._on_change_callbacks = []

        self._maxlen = int(history_seconds / sample_interval)

    def on_change(self, callback):
        self._on_change_callbacks.append(callback)
        return callback

    def set(self, key: str, value):
        # Find the config item for this key (if it exists)
        item_config = next(
            (item for item in config.DASHBOARD_DATA_NODES if item.get("alias") == key), 
            None
        )

        # Only record history if the item has "historical": True
        if not item_config or not item_config.get("historical"):
            self._data[key] = value
            return
        
        # Only apply reset logic for numeric values
        if isinstance(value, (int, float)):
            if key in self._history and len(self._history[key]) > 0:
                # Get all values from current history
                current_values = [v for _, v in self._history[key]]
                max_value = max(current_values)

                # If new value is smaller than the previous maximum, reset history
                #if value < max_value:                    
                #    self._history[key].clear()

        self._data[key] = value
        
        # Save to rolling history
        if key not in self._history:
            self._history[key] = deque(maxlen=self._maxlen)
        self._history[key].append((datetime.now(), value))
        
        for callback in self._on_change_callbacks:
            if inspect.iscoroutinefunction(callback):
                asyncio.create_task(callback(key, value))
            else:
                callback(key, value)

    def get_history(self, key: str):
        """Returns list of values (newest last)."""
        return [v for _, v in self._history.get(key, [])]
    
    def get(self, key: str, default=None):
        return self._data.get(key, default)

    def clear(self):
        self._data.clear()

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
data_store = DataStore()  