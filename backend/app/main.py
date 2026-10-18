import asyncio
import logging
import threading
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import api_server
from backend.app.routers import alarms, layout, metrics, websocket
from backend.app.routers.websocket import broadcast_full_snapshot, broadcaster
from backend.dashboard_config import ConfigError, get_dashboard
from backend.opc import opc_client
from backend.opc.data_logger import data_logger
from backend.opc.oee import compute_oee_details
from backend.opc.shift_logger import shift_logger
from backend.opc.state_store import alarm_store, data_store
from backend.settings import settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # ===================== STARTUP (runs on uvicorn's event loop) =====================
    await broadcaster.start()
    tasks = [
        asyncio.create_task(start_periodic_snapshot(), name="periodic-snapshot"),
        asyncio.create_task(start_periodic_shift_pattern(), name="periodic-shift-pattern"),
        asyncio.create_task(start_periodic_retention(), name="periodic-retention"),
        asyncio.create_task(start_periodic_oee(), name="periodic-oee"),
    ]
    logger.info("Background tasks started (snapshot every %d ms)", settings.snapshot_interval_ms)

    yield  # App is now running

    # ===================== SHUTDOWN =====================
    logger.info("Shutting down...")
    for task in tasks:
        task.cancel()
    for task in tasks:
        with suppress(asyncio.CancelledError):
            await task
    await broadcaster.stop()


def create_app() -> FastAPI:
    app = FastAPI(
        title="Production Dashboard API",
        lifespan=lifespan,
        description="API for Production Dashboard with OPC-UA integration, shift logging, and real-time WebSocket updates.",
    )

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
    app.include_router(layout.router)
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
    """Send shift pattern data every 30 seconds using the PLC-defined shift window (supports overnight shifts)."""
    while True:
        await asyncio.sleep(30)
        try:
            start, end = await shift_logger.get_current_shift_window()
            data = await shift_logger.get_shift_pattern(start, end)
            if data:
                broadcaster.publish({"type": "shift_pattern_data", "data": data})
        except Exception as e:
            logger.warning("Failed to broadcast shift pattern: %s", e)


async def start_periodic_oee():
    """Push OEE details (derived from PLC counts + shift log) every OEE_INTERVAL_S."""
    while True:
        await asyncio.sleep(max(1.0, settings.oee_interval_s))
        try:
            details = await compute_oee_details(data_store, shift_logger, data_logger, settings.nominal_rate_tpm)
            broadcaster.publish({"type": "oee_details", "data": details})
        except Exception:
            logger.exception("Failed to compute OEE details")


async def start_periodic_retention():
    """Delete data_points older than RETENTION_DAYS (once at startup, then periodically)."""
    while True:
        try:
            await data_logger.purge_older_than(settings.retention_days)
        except Exception:
            logger.exception("Retention cleanup failed")
        await asyncio.sleep(max(60, settings.retention_cleanup_interval_s))


def wire_store_callbacks() -> None:
    """Connect store changes (fired on the OPC thread) to logging and WebSocket broadcast."""

    def on_production_state_change(key, value):
        if key == "ProductionState":
            shift_logger.log_state_change("Running" if value == 2 else "Stopped")

    def broadcast_alarm_added(alarm_id, alarm):
        broadcaster.publish({"type": "alarm_added", "alarm_id": alarm_id, "alarm": alarm})

    def broadcast_alarm_removed(alarm_id, alarm):
        broadcaster.publish({"type": "alarm_removed", "alarm_id": alarm_id, "alarm": alarm})

    data_store.on_change(on_production_state_change)
    alarm_store.on_add(broadcast_alarm_added)
    alarm_store.on_remove(broadcast_alarm_removed)


def run_opc_background_engine():
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        loop.run_until_complete(opc_client.main())
    except Exception:
        logger.exception("OPC background engine stopped")
    finally:
        loop.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=settings.log_level, format="%(asctime)s %(levelname)s [%(threadName)s] %(name)s: %(message)s"
    )
    if threading.current_thread().name == "MainThread":
        # Fail fast with readable errors (file:line key: message) if dashboard.yaml is invalid
        try:
            dashboard = get_dashboard()
        except ConfigError as e:
            logger.critical("%s", e)
            raise SystemExit(1) from None
        logger.info("Dashboard config: %d screens, %d tags", len(dashboard.screens), len(dashboard.tags))

        # Initialize databases (shift log + metric history)
        asyncio.run(shift_logger.init_db())
        asyncio.run(data_logger.init_db())

        wire_store_callbacks()

        logger.info("Starting background OPC-UA thread...")
        opc_thread = threading.Thread(target=run_opc_background_engine, name="OPC_UA_Background_Worker", daemon=True)
        opc_thread.start()

        app = create_app()

        # Start FastAPI server in its own thread
        api_thread = threading.Thread(
            target=api_server.run_fastapi_server, args=(app,), name="FastAPI_Server", daemon=True
        )
        api_thread.start()

        logger.info("System running. API + WebSocket + Shift Logging ready.")

        try:
            while True:
                threading.Event().wait(1)
        except KeyboardInterrupt:
            logger.info("Shutting down...")
