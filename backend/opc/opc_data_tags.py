# opc_data_tags.py
import asyncio
import backend.config as config
import datetime
from backend.opc.state_store import data_store


class TagChangeHandler:
    """Central handler that processes all live data-change stream alerts for this subscription."""
    def __init__(self):
        # Map raw Node ID strings back to our friendly config aliases
        self.node_map = {}
        self.datatype_map = {}

    def datachange_notification(self, node, val, data):
        if val is None:
            return

        node_key = str(node.nodeid)
        alias = self.node_map.get(node_key, "Unknown")
        datatype = self.datatype_map.get(alias, "Unknown")

        # Extract raw value
        if hasattr(val, "Value"):
            processed_val = val.Value
        else:
            processed_val = val

        final_val = processed_val

        # ====================== Time_Of_Day handling ======================
        if datatype in ("Time_Of_Day", "TimeOfDay", "TOD") and isinstance(processed_val, (int, float)):
            total_seconds = int(processed_val) // 1000
            hours = total_seconds // 3600
            minutes = (total_seconds % 3600) // 60
            seconds = total_seconds % 60
            final_val = f"{hours:02d}:{minutes:02d}:{seconds:02d}"

        elif isinstance(processed_val, float):
            final_val = round(processed_val, 2)
        elif isinstance(processed_val, int):
            final_val = processed_val
        else:
            final_val = str(processed_val).strip()

        data_store.set(alias, final_val)
        print(f"📡 [Data Tag Sync]: {alias} ({datatype}) -> {final_val} ({type(final_val).__name__})")
            
    def status_change_notification(self, status):
        """Fires when the server status changes (e.g. drops offline)."""
        print(f"⚠️ [OPC UA Connection Status Event]: {status}")

async def subscribe_data_tags(client, sync_lock=None):
    """
    Sets up DataChange subscriptions using datatype from config.
    """
    if sync_lock:
        print("⏳ Tags waiting for Alarm Engine to clear the PLC network buffer...")
        await sync_lock.wait()

    print("🚀 Initializing Data Tag PubSub subscription pipeline...")
    
    handler_instance = TagChangeHandler()
    
    # Create the subscription
    subscription = await client.create_subscription(1000, handler_instance)
    
    # Subscribe to each node and store its datatype
    for item in config.DASHBOARD_DATA_NODES:
        try:
            target_node = client.get_node(item["nodeid"])
            alias = item["alias"]
            datatype = item.get("datatype", "Unknown")

            # Store both node mapping and datatype
            handler_instance.node_map[item["nodeid"]] = alias
            handler_instance.node_map[str(target_node.nodeid)] = alias
            handler_instance.datatype_map[alias] = datatype   # ← New

            await subscription.subscribe_data_change(target_node)
            print(f"✅ Subscribed: {alias} (datatype: {datatype})")
            
        except Exception as e:
            print(f"❌ Failed to subscribe to '{alias}': {e}")
            raise e

    # Keep the subscription alive
    while True:
        try:
            await asyncio.sleep(0.5)
            await client.check_connection()
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ Error in subscription loop: {e}")
            raise e