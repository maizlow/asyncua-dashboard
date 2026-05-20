import asyncio
import threading
from fastapi import FastAPI

from backend.opc import opc_client
from backend.app import api_server
from backend.app.routers import metrics, websocket


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(title="Production Dashboard API", version="1.0")

    # Include routers
    app.include_router(metrics.router)
    app.include_router(websocket.router)

    @app.get("/")
    async def root():
        return {"message": "Production Dashboard API is running"}

    return app


# ------------------------------------------------------------------
# 🧵 1. THE BACKGROUND COMMUNICATION THREAD WORKER
# ------------------------------------------------------------------
def run_opc_background_engine():
    """
    Target function for our background thread.
    Creates a fresh, isolated asyncio event loop and executes your 
    existing opc_client pipeline within it.
    """
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        print("🔌 [Engine Init]: Launching background OPC-UA process loops...")
        loop.run_until_complete(opc_client.main())
    except Exception as e:
        print(f"❌ CRITICAL ERROR IN BACKGROUND OPC ENGINE: {e}")
    finally:
        loop.close()


# ------------------------------------------------------------------
# 🚀 2. UNIFIED APP RUNTIME ENTRY POINT
# ------------------------------------------------------------------
if __name__ == "__main__":
    if threading.current_thread().name == "MainThread":
        print("🧵 [System]: Spawning background industrial communications thread...")

        # Start OPC UA in background thread
        opc_thread = threading.Thread(
            target=run_opc_background_engine,
            name="OPC_UA_Background_Worker",
            daemon=True
        )
        opc_thread.start()

        # Create FastAPI app with routers
        app = create_app()

        # Start FastAPI server in its own thread
        # We pass the app we just created
        api_thread = threading.Thread(
            target=api_server.run_fastapi_server,
            args=(app,),                    # ← Pass the app here
            name="FastAPI_Server",
            daemon=True
        )
        api_thread.start()

        print("✅ [System]: Threads active. API available at http://localhost:8000")

        # Keep main thread alive
        try:
            while True:
                threading.Event().wait(1)
        except KeyboardInterrupt:
            print("\n🛑 Shutting down...")