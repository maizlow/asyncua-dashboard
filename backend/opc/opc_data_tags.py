# opc_data_tags.py
import asyncio
import logging

from asyncua import ua
from asyncua.ua import uaerrors

import backend.config as config
from backend.opc.state_store import data_store

logger = logging.getLogger(__name__)

# Errors that concern a single node (wrong ID, missing, no access). Connection-level
# errors are NOT in this list and still propagate so the supervisor reconnects.
NODE_LEVEL_ERRORS = (
    ValueError,  # unparsable node ID string (UaStringParsingError is not a ValueError)
    ua.UaStringParsingError,
    uaerrors.BadNodeIdUnknown,
    uaerrors.BadNodeIdInvalid,
    uaerrors.BadAttributeIdInvalid,
    uaerrors.BadNotReadable,
    uaerrors.BadUserAccessDenied,
)


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
        logger.debug("Data tag %s (%s) -> %r", alias, datatype, final_val)
            
    def status_change_notification(self, status):
        """Fires when the server status changes (e.g. drops offline)."""
        logger.warning("OPC UA data subscription status change: %s", status)

async def subscribe_data_tags(client, sync_lock=None):
    """Set up DataChange subscriptions (datatype from config) and keep them alive.

    Any error (failed subscription, dropped connection) propagates so the supervisor in
    opc_client.main() reconnects. Cancellation is propagated, not swallowed.
    """
    if sync_lock:
        logger.info("Data tags waiting for the alarm engine to clear the PLC network buffer...")
        await sync_lock.wait()

    logger.info("Initializing data tag subscription")
    handler_instance = TagChangeHandler()
    subscription = await client.create_subscription(1000, handler_instance)

    subscribed, skipped = [], []
    for item in config.DASHBOARD_DATA_NODES:
        alias = item.get("alias", item.get("nodeid"))
        datatype = item.get("datatype", "Unknown")
        nodeid = item.get("nodeid")
        if not nodeid or item.get("placeholder"):
            logger.info("Skipping %s: node ID not configured yet (placeholder)", alias)
            skipped.append(alias)
            continue
        try:
            target_node = client.get_node(nodeid)
            handler_instance.node_map[nodeid] = alias
            handler_instance.node_map[str(target_node.nodeid)] = alias
            handler_instance.datatype_map[alias] = datatype
            await subscription.subscribe_data_change(target_node)
            subscribed.append(alias)
            logger.info("Subscribed: %s (datatype: %s)", alias, datatype)
        except NODE_LEVEL_ERRORS as e:
            # A wrong/missing node must not break the subscription for all other tags
            logger.warning("Skipping %s: node %s not usable (%s)", alias, nodeid, e)
            skipped.append(alias)
        except Exception:
            logger.exception("Failed to subscribe to %r", alias)
            raise
    logger.info("Data tags subscribed: %d, skipped: %d %s", len(subscribed), len(skipped), skipped or "")

    # Keep-alive: raises when the connection is gone -> supervisor reconnects
    while True:
        await asyncio.sleep(0.5)
        await client.check_connection()
