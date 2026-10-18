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


@router.get("/history/days")
async def get_daily_history(n: int = 7):
    """Per-day aggregates for the last ``n`` local calendar days incl. today (screen type: week).

    Declared before /history/{key} so "days" is not taken as a tag name. Served from the cache
    refreshed every HISTORY_INTERVAL_S (computed on demand if empty or for another ``n``).
    """
    from backend.opc.daily import MAX_DAYS
    from backend.opc.daily import get_daily_history as _daily

    history = _daily()
    n = max(1, min(MAX_DAYS, n))
    if n == 7 and history.latest is not None:
        return history.latest
    return await history.compute(data_store, n=n)


@router.get("/shifts")
async def get_shifts(limit: int = 20):
    """The shift log (newest first): one row per shift with parameters, counts and run/stop time.

    ``pending`` is set while a detected shift change waits for SHIFT_SETTLE_S (see backend/opc/shifts.py).
    """
    from backend.opc.shifts import get_shift_store, get_shift_tracker, row_to_json

    rows = await get_shift_store().recent(max(1, min(500, limit)))
    pending = get_shift_tracker().pending
    return {
        "shifts": [row_to_json(r) for r in rows],
        "pending": {k: v.isoformat() for k, v in pending.items()} if pending else None,
    }


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