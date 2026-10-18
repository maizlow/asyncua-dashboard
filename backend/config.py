"""OPC UA node configuration, read from dashboard.yaml (see backend/dashboard_config.py, docs/CONFIG.md).

Kept as a thin compatibility layer so the OPC modules can keep using
``config.DEFAULT_NODES``, ``config.SCREEN_NODES`` and ``config.DASHBOARD_DATA_NODES``.
Values are resolved lazily (on first access) so importing the backend never fails just
because the YAML is being edited; ``main`` validates it explicitly at startup.
"""

from typing import Any

from backend.dashboard_config import CONDITION_TYPE_NODE, get_dashboard


def __getattr__(name: str) -> Any:
    dash = get_dashboard()
    if name == "DEFAULT_NODES":
        return {"ConditionType": CONDITION_TYPE_NODE, "ProgramAlarms": dash.opc.alarms.strip()}
    if name == "SCREEN_NODES":
        return {"ActiveScreenNr": dash.opc.screen.active, "RequestedScreenNr": dash.opc.screen.requested}
    if name == "DASHBOARD_DATA_NODES":
        # Empty node id = TODO(PLC) placeholder -> skipped by the subscription
        return dash.data_nodes()
    raise AttributeError(name)
