import asyncio
import logging
import threading
from contextlib import asynccontextmanager, suppress

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.app import api_server
from backend.app.frontend import mount_frontend
from backend.app.routers import alarms, editor, layout, metrics, opcua, websocket
from backend.app.routers.websocket import broadcast_full_snapshot, broadcaster
from backend.dashboard_config import ConfigError
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
        asyncio.create_task(start_periodic_daily_history(), name="periodic-daily-history"),
        asyncio.create_task(start_shift_tracker(), name="shift-tracker"),
        asyncio.create_task(start_run_tracker(), name="run-tracker"),
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


def create_app(frontend: bool = True) -> FastAPI:
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
    app.include_router(editor.router)
    app.include_router(opcua.router)
    app.include_router(websocket.router)

    @app.get("/api/health")
    async def health():
        return {"status": "ok", "frontend": serving, "opc_connected": data_store.connected}

    # Last: the built TV view and editor at / and /editor/ on the same port (API and /ws take precedence)
    serving = mount_frontend(app, settings.frontend_dist_path) if frontend else False
    if not serving:
        @app.get("/")
        async def root():
            return {"message": "Production Dashboard API is running (frontend build not served)"}

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


async def start_periodic_daily_history():
    """Refresh the 7-day history (screen type: week) every HISTORY_INTERVAL_S and push it.

    Past days are cached in DailyHistory, so each refresh only re-aggregates today.
    """
    from backend.opc.daily import get_daily_history

    history = get_daily_history()
    while True:
        try:
            data = await history.compute(data_store, n=7)
            broadcaster.publish({"type": "daily_history", "data": data})
        except Exception:
            logger.exception("Failed to compute daily history")
        await asyncio.sleep(max(10.0, settings.history_interval_s))


async def start_shift_tracker():
    """Per-shift log (table shifts): boundary detection + settle window, about once a second."""
    from backend.opc.shifts import get_shift_tracker

    tracker = get_shift_tracker()
    while True:
        try:
            await tracker.tick()
        except Exception:
            logger.exception("Shift tracker tick failed")
        await asyncio.sleep(1.0)


async def start_run_tracker():
    """Run-time highscores: apply ProductionState changes every second, push when the list changes
    (and every 15 s for the ongoing run; the display counts the seconds itself)."""
    from backend.opc.highscore import compute_highscores, current_shift_start, get_run_tracker

    tracker = get_run_tracker()
    sent_version, last_push, last_running = -1, 0.0, None
    loop = asyncio.get_running_loop()
    while True:
        try:
            await tracker.tick(connected=data_store.connected, team=data_store.get("ShiftTeam"))
            running = tracker.run is not None
            if tracker.version != sent_version or running != last_running or loop.time() - last_push >= 15:
                data = await compute_highscores(tracker, await current_shift_start())
                tracker.latest = data
                broadcaster.publish({"type": "highscores", "data": data})
                sent_version, last_push, last_running = tracker.version, loop.time(), running
        except Exception:
            logger.exception("Run tracker tick failed")
        await asyncio.sleep(1.0)


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

    from backend.opc.highscore import get_run_tracker
    from backend.opc.shifts import get_shift_tracker

    tracker = get_shift_tracker()
    runs = get_run_tracker()

    def on_production_state_change(key, value):
        if key == "ProductionState":
            shift_logger.log_state_change("Running" if value == 2 else "Stopped")
            runs.on_state(value == 2)

    def on_shift_tag_change(key, value):
        tracker.on_value(key, value)  # cheap; decisions happen in start_shift_tracker()

    def broadcast_alarm_added(alarm_id, alarm):
        broadcaster.publish({"type": "alarm_added", "alarm_id": alarm_id, "alarm": alarm})

    def broadcast_alarm_removed(alarm_id, alarm):
        broadcaster.publish({"type": "alarm_removed", "alarm_id": alarm_id, "alarm": alarm})

    data_store.on_change(on_production_state_change)
    data_store.on_change(on_shift_tag_change)
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
        # Published layout from SQLite; dashboard.yaml is imported the first time and when it has changed.
        # Fail fast with readable errors (file:line key: message) if what would be used is invalid.
        from backend.layout_store import LayoutStore, bootstrap

        try:
            runtime = asyncio.run(bootstrap(LayoutStore(), yaml_import=settings.layout_yaml_import))
        except ConfigError as e:
            logger.critical("%s", e)
            raise SystemExit(1) from None
        logger.info(
            "Layout version %s: display %s, %d screens, %d tags",
            runtime.version, runtime.display_id, len(runtime.screens), len(runtime.tags),
        )
        if settings.retention_days < 7 and runtime.has_kind("week"):
            logger.warning(
                "RETENTION_DAYS=%d < 7: the 7-day screen shows '–' for days older than the retained history",
                settings.retention_days,
            )

        # Initialize databases (shift log + metric history)
        asyncio.run(shift_logger.init_db())
        asyncio.run(data_logger.init_db())
        from backend.opc.shifts import get_shift_store

        asyncio.run(get_shift_store().init_db())
        from backend.opc.highscore import get_run_store

        asyncio.run(get_run_store().init_db())
        from backend.users import get_user_store

        asyncio.run(get_user_store().init_db())

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
