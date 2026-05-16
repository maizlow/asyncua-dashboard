import asyncio
import threading
import sys
import streamlit.web.cli as stcli
import opc_client

# ------------------------------------------------------------------
# 🧵 1. THE BACKGROUND COMMUNICATION THREAD WORKER
# ------------------------------------------------------------------
def run_opc_background_engine():
    """
    Target function for our background thread.
    Creates a fresh, isolated asyncio event loop and executes your 
    existing opc_client pipeline within it.
    """
    # 1. Spin up a new dedicated event loop for this thread
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    
    try:
        print("🔌 [Engine Init]: Launching background OPC-UA process loops...")
        # 2. Directly run your existing main pipeline from opc_client.py
        loop.run_until_complete(opc_client.main())
    except Exception as e:
        print(f"❌ CRITICAL ERROR IN BACKGROUND OPC ENGINE: {e}")
    finally:
        loop.close()

# ------------------------------------------------------------------
# 🚀 2. UNIFIED APP RUNTIME ENTRY POINT
# ------------------------------------------------------------------
if __name__ == "__main__":
    # Ensure this block only triggers once during the initial master process spawn
    if threading.current_thread().name == "MainThread":
        print("🧵 [System]: Spawning background industrial communications thread...")
        
        # Create and kickstart the background worker thread
        opc_thread = threading.Thread(
            target=run_opc_background_engine,
            name="OPC_UA_Background_Worker",
            daemon=True # Ensures the thread shuts down cleanly when the main app closes
        )
        opc_thread.start()
        print("✅ [System]: Thread active. Memory mapping bound successfully.")

    # 🖥️ 3. HAND OVER CONTROL TO THE STREAMLIT SERVER PROGRAMMATICALLY
    print("🖥️ [System]: Launching Production TV Interface with Hot Reload...")
    sys.argv = [
        "streamlit", 
        "run", 
        "dashboard.py", 
        "--server.headless=true", 
        "--server.runOnSave=true" # <-- Added this flag
    ]
    sys.exit(stcli.main())