from fastapi import APIRouter

from backend.opc.shift_logger import shift_logger
from backend.opc.state_store import data_store, general_store

router = APIRouter(prefix="/api", tags=["Metrics"])


@router.get("/data")
async def get_all_data():
    """Returns all current values from the data store."""
    return data_store._data


@router.get("/data/{key}")
async def get_single_value(key: str):
    """Get a single value by key."""
    value = data_store.get(key)
    if value is None:
        return {"error": f"Key '{key}' not found"}
    return {key: value}


@router.get("/history/{key}")
async def get_history(key: str, limit: int = 150):
    """Get history for a specific key (values only, for sparklines)."""
    history = await data_store.get_history(key, limit=limit)
    return {"key": key, "history": history}


@router.get("/history/{key}/points")
async def get_history_points(key: str, limit: int = 150):
    """Get history for a specific key with timestamps."""
    points = await data_store.get_history_points(key, limit=limit)
    return {"key": key, "points": points}


@router.get("/general")
async def get_general_data():
    """Returns general store data (e.g. screen number, status, etc)."""
    return general_store._data

# NOTE: there is intentionally no POST/PUT for the general store.
# The dashboard is display-only; ActiveScreenNr is set exclusively by the
# internal screen handler (backend/opc/opc_screen_handler.py), which is the
# only code path that writes to the PLC.


# ===================== NEW ENDPOINTS FOR BETTER SCREEN SWITCH UX =====================

@router.get("/shift-pattern")
async def get_current_shift_pattern():
    """Returns the current shift pattern based on the live PLC ShiftStart / ShiftEnd values."""
    try:
        start, end = await shift_logger.get_current_shift_window()
        data = await shift_logger.get_shift_pattern(start, end)
        return {"data": data}
    except Exception as e:
        return {"error": str(e)}


@router.get("/oee")
async def get_oee_details():
    """OEE breakdown, production vs target, scrap, speed, stops and shift progress."""
    from backend.opc.data_logger import data_logger
    from backend.opc.oee import compute_oee_details
    from backend.settings import settings

    return await compute_oee_details(data_store, shift_logger, data_logger, settings.nominal_rate_tpm)


@router.post("/snapshot")
async def trigger_full_snapshot():
    """Forces an immediate full data snapshot broadcast. Useful when entering the Dashboard.

    Read-only with respect to the PLC: this only re-broadcasts current values to WebSocket clients.
    """
    from backend.app.routers.websocket import broadcast_full_snapshot
    await broadcast_full_snapshot()
    return {"status": "ok"}