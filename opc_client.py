from opc_client_manager import OPCClientManager
import asyncio

from state_store import alarm_store
from models import AlarmDetails
from opc_program_alarm_events import subscribe_program_alarms

active_alarm_list = []  # Global list to track active alarms

async def main():
    while True:
        try:
            client = await OPCClientManager.get_client()
            print("Client is ready to use!")

            await subscribe_program_alarms(client)    

            print("Program is running. Press Ctrl+C to exit.")

            # You can add test code here to read/write nodes or subscribe to events
        except KeyboardInterrupt:
            await OPCClientManager.close()
            print("\nApplication closed.")
            break  # Exit the loop on Ctrl+C

        except asyncio.CancelledError:
            break  # Exit the loop if the task is cancelled

        except Exception as e:
            print(f"\n❌ Connection lost: {e}. Reconnecting in 5 seconds...")
            await OPCClientManager.close()
            await asyncio.sleep(5)
    


# Register an async listener for when an alarm is added
@alarm_store.on_add
async def handle_new_alarm(event_id: str, alarm: AlarmDetails):
    print(f"🚨 EVENT TRIGGERED: New Alarm Added! -> ID: {event_id} | {alarm.message}")
    # Here you could push data to a websocket, send a slack alert, etc.

# Register a listener for when an alarm is cleared
@alarm_store.on_remove
async def handle_cleared_alarm(event_id: str, alarm: AlarmDetails):
    print(f"✅ EVENT TRIGGERED: Alarm Cleared! -> ID: {event_id} was resolved.")    
    