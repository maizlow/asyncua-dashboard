from fastapi import APIRouter
from backend.opc.state_store import data_store, general_store
from backend.opc.shift_logger import shift_logger

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

@router.post("/general")
async def set_general_value(payload: dict):
    key = payload.get("key")
    value = payload.get("value")
    if key and value is not None:
        general_store.set(key, value)
        return {"status": "ok"}
    return {"status": "error", "message": "Missing key or value"}


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


@router.post("/snapshot")
async def trigger_full_snapshot():
    """Forces an immediate full data snapshot broadcast. Useful when entering the Dashboard."""
    from backend.app.routers.websocket import broadcast_full_snapshot
    await broadcast_full_snapshot()
    return {"status": "ok"}