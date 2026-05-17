import asyncio
from asyncua import ua
import config

from opc_client_manager import OPCClientManager
from opc_screen_handler import subscribe_screen_tags
from opc_data_tags import subscribe_data_tags
from opc_program_alarm_events import subscribe_program_alarms
from state_store import alarm_store, general_store, data_store

async def main():
    while True:
        try:
            # 1. Establish core client connection instance
            client = await OPCClientManager.get_client()
            print("Client is ready to use!")

            # 2. Flush caches on startup/reconnect to prevent ghost records
            alarm_store.clear_store()
            general_store.clear()
            data_store.clear()

            # Create a synchronization lock to prevent PLC network collisions
            sync_lock = asyncio.Event()

            # Pass the lock into both sub-engines
            alarm_task = asyncio.create_task(subscribe_program_alarms(client, sync_lock))
            screen_handler_task = asyncio.create_task(subscribe_screen_tags(client, sync_lock))  
            data_tags_task = asyncio.create_task(subscribe_data_tags(client, sync_lock))

            print("🚀 Monitoring sub-engines engaged. Awaiting sync completion...")

            print("🚀 Monitoring sub-engines engaged successfully.")

            # 3. Main wrapper loop acting as our network circuit-breaker
            try:
                while True:
                    await asyncio.sleep(1)
                    await client.check_connection()
            finally:
                # Cleanly cancel and unwind background workers if check_connection drops
                alarm_task.cancel()
                screen_handler_task.cancel()
                data_tags_task.cancel()
                await asyncio.gather(alarm_task, screen_handler_task, data_tags_task, return_exceptions=True)

        except Exception as e:
            print(f"\n❌ Connection lost: {e}. Reconnecting in 5 seconds...")
            await OPCClientManager.close()
            await asyncio.sleep(5)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nApplication closed by user.")