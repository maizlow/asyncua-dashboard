import asyncio
import logging

from backend.opc.opc_client_manager import OPCClientManager
from backend.opc.opc_data_tags import subscribe_data_tags
from backend.opc.opc_program_alarm_events import subscribe_program_alarms
from backend.opc.opc_screen_handler import subscribe_screen_tags
from backend.opc.state_store import alarm_store, data_store, general_store

logger = logging.getLogger(__name__)

RECONNECT_DELAY_S = 5


async def _connection_watchdog(client) -> None:
    while True:
        await asyncio.sleep(1)
        await client.check_connection()  # raises if the server is gone


async def run_supervised(tasks: dict[str, asyncio.Task]) -> None:
    """Wait until any sub-engine stops, cancel the rest, and raise so the caller reconnects.

    Previously the sub-engine tasks were fire-and-forget: if one died (e.g. a failed
    subscription or a dropped connection inside it) the error was never retrieved and the
    dashboard silently stopped updating.
    """
    try:
        done, _ = await asyncio.wait(tasks.values(), return_when=asyncio.FIRST_COMPLETED)
    finally:
        for task in tasks.values():
            task.cancel()
        await asyncio.gather(*tasks.values(), return_exceptions=True)

    for name, task in tasks.items():
        if task in done:
            if task.cancelled():
                raise RuntimeError(f"OPC sub-engine '{name}' was cancelled")
            exc = task.exception()
            if exc is not None:
                raise RuntimeError(f"OPC sub-engine '{name}' failed: {exc}") from exc
            raise RuntimeError(f"OPC sub-engine '{name}' stopped unexpectedly")


async def main():
    while True:
        try:
            # 1. Establish core client connection instance
            client = await OPCClientManager.get_client()
            logger.info("OPC UA client is ready")

            # 2. Flush caches on startup/reconnect to prevent ghost records
            alarm_store.clear()
            general_store.clear()
            data_store.clear()

            # Synchronization lock to prevent PLC network collisions
            sync_lock = asyncio.Event()

            tasks = {
                "alarms": asyncio.create_task(subscribe_program_alarms(client, sync_lock)),
                "screen": asyncio.create_task(subscribe_screen_tags(client, sync_lock)),
                "data_tags": asyncio.create_task(subscribe_data_tags(client, sync_lock)),
                "watchdog": asyncio.create_task(_connection_watchdog(client)),
            }
            logger.info("Monitoring sub-engines engaged")

            # 3. Circuit breaker: any sub-engine failing or the connection dropping -> reconnect
            await run_supervised(tasks)

        except asyncio.CancelledError:
            await OPCClientManager.close()
            raise
        except Exception as e:
            logger.error("Connection lost: %s. Reconnecting in %d seconds...", e, RECONNECT_DELAY_S)
            await OPCClientManager.close()
            await asyncio.sleep(RECONNECT_DELAY_S)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        logger.info("Application closed by user.")
