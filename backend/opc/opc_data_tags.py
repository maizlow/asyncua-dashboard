# opc_data_tags.py
import asyncio
import backend.config as config
from backend.opc.state_store import data_store

class TagChangeHandler:
    """Central handler that processes all live data-change stream alerts for this subscription."""
    def __init__(self):
        # Map raw Node ID strings back to our friendly config aliases
        self.node_map = {}

    def datachange_notification(self, node, val, data):
        """Fires automatically whenever any monitored tag value changes on the PLC."""
        if val is not None:
            # Find the friendly alias using the string representation of the incoming Node ID
            node_key = str(node.nodeid)
            alias = self.node_map.get(node_key, "Unknown")
            
            # 🛡️ Extract the raw value if it arrives wrapped inside an asyncua Variant object
            if hasattr(val, "Value"):
                processed_val = val.Value
            else:
                processed_val = val

            # 🛠️ Sanitize based on data type group
            if isinstance(processed_val, bool):
                final_val = processed_val
            elif isinstance(processed_val, float):
                # 🎯 Lock floats down to 2 decimal points instantly
                final_val = round(processed_val, 2)
            elif isinstance(processed_val, int):
                final_val = processed_val
            else:
                final_val = str(processed_val).strip()

            # Store the polished value into the global memory cache
            data_store.set(alias, final_val)
            print(f"📡 [Data Tag Sync]: {alias} updated on server -> Stored value: {final_val} ({type(final_val).__name__})")
            
    def status_change_notification(self, status):
        """Fires when the server status changes (e.g. drops offline)."""
        print(f"⚠️ [OPC UA Connection Status Event]: {status}")

async def subscribe_data_tags(client, sync_lock=None):
    """
    Sets up DataChange subscriptions correctly using a single subscription handler
    """
    if sync_lock:
        print("⏳ Tags waiting for Alarm Engine to clear the PLC network buffer...")
        await sync_lock.wait()

    print("🚀 Initializing Data Tag PubSub subscription pipeline...")
    
    # 1. Create ONE central handler instance to manage all nodes in this subscription
    handler_instance = TagChangeHandler()
    
    # 2. Spin up the base subscription framework passing our central handler
    subscription = await client.create_subscription(2000, handler_instance)
    
    # Loop through the config dictionary to subscribe to your target nodes dynamically
    for item in config.DASHBOARD_DATA_NODES:
        try:
            target_node = client.get_node(item["nodeid"])
            alias = item["alias"]

            # Map both variations of the node string so the handler can match it perfectly
            handler_instance.node_map[item["nodeid"]] = alias
            handler_instance.node_map[str(target_node.nodeid)] = alias
            
            await subscription.subscribe_data_change(target_node)
            print(f"✅ DataChange monitoring active for node alias: {alias}")
            
        except Exception as e:
            print(f"❌ CRITICAL: Failed to subscribe to node '{alias}' ({item['nodeid']}): {e}")
            raise e

    while True:
        try:
            await asyncio.sleep(0.5)
            await client.check_connection()
         
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"⚠️ Error in Tag PubSub write-back tracking thread: {e}")
            raise e