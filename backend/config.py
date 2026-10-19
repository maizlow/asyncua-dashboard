"""OPC UA node configuration from the published layout (backend/layout_store.py, docs/CONFIG.md).

Kept as a thin compatibility layer so the OPC modules can keep using
``config.DEFAULT_NODES``, ``config.SCREEN_NODES`` and ``config.DASHBOARD_DATA_NODES``.
Values are resolved lazily (on first access) so importing the backend never fails just
because the YAML is being edited; ``main`` validates it explicitly at startup.
"""

from typing import Any

from backend.dashboard_config import CONDITION_TYPE_NODE
from backend.layout_store import get_runtime


def __getattr__(name: str) -> Any:
    rt = get_runtime()
    if name == "DEFAULT_NODES":
        return {"ConditionType": CONDITION_TYPE_NODE, "ProgramAlarms": rt.connection.alarms.strip()}
    if name == "SCREEN_NODES":
        return {"ActiveScreenNr": rt.display.screen.active, "RequestedScreenNr": rt.display.screen.requested}
    if name == "DASHBOARD_DATA_NODES":
        # Empty node id = TODO(PLC) placeholder -> skipped by the subscription
        return rt.data_nodes()
    raise AttributeError(name)
