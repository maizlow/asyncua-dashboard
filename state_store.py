from models import AlarmDetails
import asyncio
import inspect  # Added to replace the deprecated asyncio check

class AlarmStore:
    """An in-memory state store tracking AlarmDetails that triggers events on changes."""
    def __init__(self):
        self._active_alarms: dict[str, AlarmDetails] = {}
        self._on_add_callbacks = []
        self._on_remove_callbacks = []

    def on_add(self, callback):
        """Decorator or method to register a function for when an alarm is added/updated."""
        self._on_add_callbacks.append(callback)
        return callback

    def on_remove(self, callback):
        """Decorator or method to register a function for when an alarm is removed."""
        self._on_remove_callbacks.append(callback)
        return callback

    def add_alarm(self, event_id: str, alarm: AlarmDetails):
        self._active_alarms[event_id] = alarm
        
        for callback in self._on_add_callbacks:
            # Clean, non-deprecated way to check if a function is 'async def'
            if inspect.iscoroutinefunction(callback):
                asyncio.create_task(callback(event_id, alarm))
            else:
                callback(event_id, alarm)

    def remove_alarm(self, event_id: str):
        if event_id in self._active_alarms:
            removed_alarm = self._active_alarms[event_id]
            del self._active_alarms[event_id]
            
            for callback in self._on_remove_callbacks:
                # Clean, non-deprecated way to check if a function is 'async def'
                if inspect.iscoroutinefunction(callback):
                    asyncio.create_task(callback(event_id, removed_alarm))
                else:
                    callback(event_id, removed_alarm)

    def get_active_alarms(self) -> dict[str, AlarmDetails]:
        return self._active_alarms.copy()

# Create the single instance to be used across the app
alarm_store = AlarmStore()