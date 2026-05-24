from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List, Any
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pydantic import BaseModel

router = APIRouter(tags=["WebSocket"])

active_connections: List[WebSocket] = []


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


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"🔌 WebSocket connected. Total clients: {len(active_connections)}")

        # Send full snapshot + shift pattern immediately
    try:
        from backend.opc.state_store import data_store
        from backend.opc.shift_logger import shift_logger

        # Full data snapshot (histories read from SQLite)
        histories = {}
        for key in list(data_store._data.keys()):
            histories[key] = await data_store.get_history(key, limit=150)

        snapshot = {
            "type": "full_snapshot",
            "data": data_store._data,
            "histories": histories
        }
        await websocket.send_json(snapshot)

        # Shift pattern using the PLC-defined shift window (supports overnight shifts)
        try:
            start, end = await shift_logger.get_current_shift_window()
            shift_data = await shift_logger.get_shift_pattern(start, end)
            has_activity = any(
                (row.get("running", 0) + row.get("stopped", 0)) > 0
                for row in shift_data
            )
            if has_activity:
                await websocket.send_json({
                    "type": "shift_pattern_data",
                    "data": shift_data
                })
        except Exception as e:
            print(f"⚠️ Failed to send initial shift pattern: {e}")

    except Exception as e:
        print(f"⚠️ Failed to send initial data: {e}")

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)
        print(f"❌ WebSocket disconnected. Total clients: {len(active_connections)}")


async def broadcast(message: dict):
    if not active_connections:
        print("No active connections to broadcast to.")
        return

    safe_message = {k: make_json_safe(v) for k, v in message.items()}
    disconnected = []

    for connection in active_connections[:]:   # copy list
        try:
            await connection.send_json(safe_message)
        except Exception:
            disconnected.append(connection)

    for conn in disconnected:
        if conn in active_connections:
            active_connections.remove(conn)

async def broadcast_full_snapshot():
    """Send a complete snapshot of all current data + histories (from SQLite)"""
    from backend.opc.state_store import data_store

    try:
        histories = {}
        for key in list(data_store._data.keys()):
            histories[key] = await data_store.get_history(key, limit=150)

        snapshot = {
            "type": "full_snapshot",
            "data": data_store._data,
            "histories": histories
        }
        await broadcast(snapshot)
    except Exception as e:
        print(f"⚠️ Failed to broadcast full snapshot: {e}")            