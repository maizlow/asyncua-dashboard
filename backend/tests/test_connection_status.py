"""A PLC going down is announced per connection, so the displays can show '–' for the elements
bound to it while elements of other PLCs keep updating (frontend: src/lib/connection.ts)."""

from backend.opc import state_store
from backend.opc.state_store import DataStore


def test_connection_status_is_published_on_change_only(monkeypatch):
    sent = []
    monkeypatch.setattr(state_store.broadcaster, "publish", sent.append)
    monkeypatch.setattr(state_store, "data_logger", type("L", (), {"log_value": lambda *a: None})())
    store = DataStore()
    store.connected = True
    store.connected = True
    store.set("OEE", 81.5)
    store.connected = False
    assert sent == [
        {"type": "connection_status", "connection": "plc1", "connected": True},
        {"type": "data_update", "connection": "plc1", "key": "OEE", "value": 81.5},
        {"type": "connection_status", "connection": "plc1", "connected": False},
    ]
