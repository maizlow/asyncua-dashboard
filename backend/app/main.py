import asyncio
import threading
from fastapi import FastAPI

from backend.opc import opc_client
from backend.app import api_server
from backend.app.routers import metrics, websocket, alarms
from backend.opc.state_store import alarm_store


def create_app() -> FastAPI:
    app = FastAPI(title="Production Dashboard API")

    # ===================== CORS =====================
    from fastapi.middleware.cors import CORSMiddleware

    # Allow common development origins + production later
    origins = [
        "http://localhost:5173",      # Vite dev server
        "http://127.0.0.1:5173",
        "http://localhost:3000",      # Alternative React port
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ===================== Routers =====================
    app.include_router(metrics.router)
    app.include_router(alarms.router)
    app.include_router(websocket.router)

    @app.get("/")
    async def root():
        return {"message": "Production Dashboard API is running"}

    return app


def run_opc_background_engine():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(opc_client.main())
    except Exception as e:
        print(f"❌ OPC Background Error: {e}")
    finally:
        loop.close()


if __name__ == "__main__":
    if threading.current_thread().name == "MainThread":
        print("🧵 Starting background OPC-UA thread...")

        # Start OPC UA
        opc_thread = threading.Thread(
            target=run_opc_background_engine,
            name="OPC_UA_Background_Worker",
            daemon=True
        )
        opc_thread.start()

        # Create FastAPI app
        app = create_app()

        # === Connect AlarmStore to WebSocket broadcast ===
        from backend.app.routers.websocket import broadcast

        def broadcast_alarm_added(alarm_id, alarm):
            asyncio.create_task(broadcast({
                "type": "alarm_added",
                "alarm_id": alarm_id,
                "alarm": alarm
            }))

        def broadcast_alarm_removed(alarm_id, alarm):
            asyncio.create_task(broadcast({
                "type": "alarm_removed",
                "alarm_id": alarm_id,
                "alarm": alarm
            }))

        alarm_store.on_add(broadcast_alarm_added)
        alarm_store.on_remove(broadcast_alarm_removed)

        # Start FastAPI
        api_thread = threading.Thread(
            target=api_server.run_fastapi_server,
            args=(app,),
            name="FastAPI_Server",
            daemon=True
        )
        api_thread.start()

        print("✅ System running. API + WebSocket ready.")

        try:
            while True:
                threading.Event().wait(1)
        except KeyboardInterrupt:
            print("\n🛑 Shutting down...")