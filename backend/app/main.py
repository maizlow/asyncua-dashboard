import asyncio
from contextlib import asynccontextmanager
import threading
from fastapi import FastAPI

from backend.opc import opc_client
from backend.opc.shift_logger import shift_logger
from backend.app import api_server
from backend.app.routers import metrics, websocket, alarms
from backend.opc.state_store import alarm_store, data_store
from backend.app.routers.websocket import broadcast_full_snapshot, broadcast
from backend.settings import settings

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ===================== STARTUP =====================
    print("✅ Starting periodic snapshot task (every 10 seconds)")
    asyncio.create_task(start_periodic_snapshot())
    asyncio.create_task(start_periodic_shift_pattern())

    yield  # App is now running

    # ===================== SHUTDOWN =====================
    print("🛑 Shutting down...")

def create_app() -> FastAPI:
    app = FastAPI(
        title="Production Dashboard API",
        lifespan=lifespan,
        description="API for Production Dashboard with OPC-UA integration, shift logging, and real-time WebSocket updates.")

    from fastapi.middleware.cors import CORSMiddleware

    origins = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
    ]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(metrics.router)
    app.include_router(alarms.router)
    app.include_router(websocket.router)

    @app.get("/")
    async def root():
        return {"message": "Production Dashboard API is running"}

    return app


async def start_periodic_snapshot():
    while True:
        await asyncio.sleep(settings.snapshot_interval_ms / 1000)
        await broadcast_full_snapshot()

async def start_periodic_shift_pattern():
    """Send shift pattern data every 30 seconds"""
    while True:
        await asyncio.sleep(30)  # Update every 30 seconds
        try:
            data = await shift_logger.get_shift_pattern(hours=12)
            if data and len(data) > 0:
                await broadcast({
                    "type": "shift_pattern_data",
                    "data": data
                })
        except Exception as e:
            print(f"⚠️ Failed to broadcast shift pattern: {e}")

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

        # Initialize shift logger database
        asyncio.run(shift_logger.init_db())

        # Start OPC UA in background thread
        opc_thread = threading.Thread(
            target=run_opc_background_engine,
            name="OPC_UA_Background_Worker",
            daemon=True
        )
        opc_thread.start()

        # Create FastAPI app
        app = create_app()

        # Connect ProductionState changes to shift logger
        def on_production_state_change(key, value):
            if key == "ProductionState":
                state = "Running" if value == 2 else "Stopped"
                asyncio.create_task(shift_logger.log_state_change(state))

        data_store.on_change(on_production_state_change)

        # Connect AlarmStore to WebSocket broadcast
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

        # Start FastAPI server in its own thread
        api_thread = threading.Thread(
            target=api_server.run_fastapi_server,
            args=(app,),
            name="FastAPI_Server",
            daemon=True
        )
        api_thread.start()

        print("✅ System running. API + WebSocket + Shift Logging ready.")

        try:
            while True:
                threading.Event().wait(1)
        except KeyboardInterrupt:
            print("\n🛑 Shutting down...")