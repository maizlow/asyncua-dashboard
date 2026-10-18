# opc_screen_handler.py
import asyncio
import logging

from asyncua import ua

import backend.config as config
from backend.opc.state_store import general_store

logger = logging.getLogger(__name__)


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
            
            # Cast the raw variant value to an integer for safety
            int_val = int(val)
            general_store.set(alias, int_val)
            logger.debug("Screen tag %s -> %s", alias, int_val)

            # Screen handshake (internal logic only, never driven by HTTP clients):
            # when the PLC requests a screen, the backend broadcasts it to the display
            # (see GeneralStore.set) and acknowledges it by setting ActiveScreenNr,
            # which the write-back loop below then writes to the PLC.
            if alias == "RequestedScreenNr":
                general_store.set("ActiveScreenNr", int_val)

    def status_change_notification(self, status):
        """Called by asyncua when the server reports a status change (common during reconnects or network issues)."""
        # We just log it at warning level so it doesn't spam the "no status_change_notification method" error.
        logger.warning("OPC UA screen subscription status change: %s", status)
            


async def subscribe_screen_tags(client, sync_lock=None):
    """
    Sets up DataChange subscriptions correctly using a single subscription handler
    and manages the bidirectional write-back loop.
    """
    if sync_lock:
        logger.info("Screen tags waiting for the alarm engine to clear the PLC network buffer...")
        await sync_lock.wait()

    logger.info("Initializing screen tag subscription")
    
    # 1. Create ONE central handler instance to manage all nodes in this subscription
    handler_instance = TagChangeHandler()
    
    # 2. Spin up the base subscription framework passing our central handler
    subscription = await client.create_subscription(1000, handler_instance)
    
    # Loop through the config dictionary to subscribe to your target nodes dynamically
    for alias, node_string in config.SCREEN_NODES.items():
        try:
            target_node = client.get_node(node_string)
            
            # Map both variations of the node string so the handler can match it perfectly
            handler_instance.node_map[node_string] = alias
            handler_instance.node_map[str(target_node.nodeid)] = alias
            
            # ✅ FIXED: Call with only the target_node. The second parameter defaults 
            # to ua.AttributeIds.Value automatically, keeping the binary packet clean.
            await subscription.subscribe_data_change(target_node)
            logger.info("DataChange monitoring active for %s", alias)
            # GREEN LIGHT: Unlock the tag engine so it can safely subscribe!
            if sync_lock:
                sync_lock.set()

        except Exception as e:
            logger.critical("Failed to subscribe to node %r (%s): %s", alias, node_string, e)
            raise

    # 3. Bidirectional Write-Back Monitoring Loop
    node_active_out = client.get_node(config.SCREEN_NODES["ActiveScreenNr"])

    # 🛡️ Local safety track: What did we actually send to the PLC?
    # This prevents infinite spam without altering or "faking" general_store values!
    last_sent_screen = None

    while True:
        try:
            await asyncio.sleep(0.5)
            await client.check_connection()
         
            web_active_screen = general_store.get("ActiveScreenNr")

            if web_active_screen is not None and web_active_screen != last_sent_screen:
                # Write the updated screen number back to the PLC whenever it changes in our general store
                await node_active_out.write_value(
                    ua.DataValue(ua.Variant(web_active_screen, ua.VariantType.Int16))
                )
                # Lock it in locally so we don't repeat this write on the next iteration
                last_sent_screen = web_active_screen

                logger.info("Handshake: wrote ActiveScreenNr=%s to PLC", web_active_screen)
                
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.warning("Screen write-back loop error (reconnecting): %s", e)
            raise
