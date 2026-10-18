import logging
from dataclasses import asdict, is_dataclass
from datetime import datetime
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import BaseModel

from backend.app.broadcaster import Broadcaster

logger = logging.getLogger(__name__)

router = APIRouter(tags=["WebSocket"])

# Only touched from the uvicorn event loop
active_connections: list[WebSocket] = []


def make_json_safe(obj: Any) -> Any:
    if isinstance(obj, BaseModel):
        return obj.model_dump()
    if is_dataclass(obj) and not isinstance(obj, type):
        data = asdict(obj)
        for key, value in data.items():
            if isinstance(value, datetime):
                data[key] = value.isoformat()
        return data
    if isinstance(obj, datetime):
        return obj.isoformat()
    return obj


async def _build_snapshot() -> dict:
    from backend.opc.state_store import data_store

    data = dict(data_store._data)  # copy: the OPC thread may mutate it concurrently
    histories = {key: await data_store.get_history(key, limit=150) for key in data}
    return {"type": "full_snapshot", "data": data, "histories": histories}


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    logger.info("WebSocket connected. Total clients: %d", len(active_connections))

    # Send full snapshot + shift pattern immediately
    try:
        from backend.opc.shift_logger import shift_logger

        await websocket.send_json(await _build_snapshot())

        try:
            start, end = await shift_logger.get_current_shift_window()
            shift_data = await shift_logger.get_shift_pattern(start, end)
            if any((row.get("running", 0) + row.get("stopped", 0)) > 0 for row in shift_data):
                await websocket.send_json({"type": "shift_pattern_data", "data": shift_data})
        except Exception as e:
            logger.warning("Failed to send initial shift pattern: %s", e)
    except Exception:
        logger.exception("Failed to send initial data")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in active_connections:
            active_connections.remove(websocket)
        logger.info("WebSocket disconnected. Total clients: %d", len(active_connections))


async def broadcast(message: dict):
    """Send to all clients. Must run on the uvicorn loop; use ``broadcaster.publish`` elsewhere."""
    if not active_connections:
        return

    safe_message = {k: make_json_safe(v) for k, v in message.items()}
    for connection in active_connections[:]:
        try:
            await connection.send_json(safe_message)
        except Exception:
            if connection in active_connections:
                active_connections.remove(connection)


# Process-wide broadcaster; started on the uvicorn loop in the app lifespan
broadcaster = Broadcaster(broadcast)


async def broadcast_full_snapshot():
    """Queue a complete snapshot of all current data + histories (from SQLite)."""
    try:
        broadcaster.publish(await _build_snapshot())
    except Exception:
        logger.exception("Failed to build full snapshot")
