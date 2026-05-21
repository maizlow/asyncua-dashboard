from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List, Any
import asyncio
from dataclasses import asdict, is_dataclass
from datetime import datetime
from pydantic import BaseModel

router = APIRouter(tags=["WebSocket"])

active_connections: List[WebSocket] = []


def make_json_safe(obj: Any) -> Any:
    """Convert objects to JSON-serializable format."""
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

    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        if websocket in active_connections:
            active_connections.remove(websocket)
        print(f"❌ WebSocket disconnected. Total clients: {len(active_connections)}")


async def broadcast(message: dict):
    """Send message to all connected WebSocket clients safely."""
    print(f"📡 Broadcasting: {message.get('type', message)}")
    print(f"📡 Active connections: {len(active_connections)}")

    if not active_connections:
        print("⚠️ No active connections to broadcast to.")
        return

    # Make the entire message JSON safe
    safe_message = {k: make_json_safe(v) for k, v in message.items()}

    disconnected = []
    for connection in active_connections:
        try:
            await connection.send_json(safe_message)
            print(f"✅ Message sent successfully")
        except Exception as e:
            print(f"❌ Failed to send to client: {e}")
            disconnected.append(connection)

    # Clean up dead connections
    for conn in disconnected:
        if conn in active_connections:
            active_connections.remove(conn)

async def broadcast_full_snapshot():
    """Send all current data + histories to all connected clients every 10s"""
    if not active_connections:
        return

    try:
        from backend.opc.state_store import data_store

        snapshot = {
            "type": "full_snapshot",
            "data": data_store._data,
            "histories": {
                key: [v for _, v in history] 
                for key, history in data_store._history.items()
            }
        }
        
        for connection in active_connections:
            try:
                await connection.send_json(snapshot)
            except Exception:
                pass

    except Exception as e:
        print(f"⚠️ Failed to broadcast full snapshot: {e}")