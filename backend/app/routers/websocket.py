from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import List
import asyncio

router = APIRouter(tags=["WebSocket"])

active_connections: List[WebSocket] = []


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    active_connections.append(websocket)
    print(f"🔌 WebSocket client connected. Total: {len(active_connections)}")

    try:
        while True:
            # Keep connection alive (client can also send messages if needed)
            await websocket.receive_text()
    except WebSocketDisconnect:
        active_connections.remove(websocket)
        print(f"❌ WebSocket client disconnected. Total: {len(active_connections)}")


# Helper function to broadcast messages to all connected clients
async def broadcast(message: dict):
    """Send a message to all connected WebSocket clients."""
    disconnected = []
    for connection in active_connections:
        try:
            await connection.send_json(message)
        except Exception:
            disconnected.append(connection)

    # Clean up dead connections
    for conn in disconnected:
        if conn in active_connections:
            active_connections.remove(conn)