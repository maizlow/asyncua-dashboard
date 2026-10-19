# opc_client_manager.py
import asyncio
import logging

from asyncua import Client
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256

from backend.layout_store import get_runtime
from backend.settings import settings

logger = logging.getLogger(__name__)

def apply_credentials(client: Client) -> None:
    """User name and password only when OPC_USERNAME is set. Without it the session is anonymous and
    the client certificate alone identifies the dashboard (the PLC must allow anonymous access).
    asyncua refuses a non-string password, so a missing OPC_PASSWORD is sent as an empty one."""
    if settings.opc_username:
        client.set_user(settings.opc_username)
        client.set_password(settings.opc_password or "")
    elif settings.opc_password:
        logger.warning("OPC_PASSWORD is set but OPC_USERNAME is not: connecting anonymously")


async def _quiet_disconnect(client: Client) -> None:
    try:
        await client.disconnect()
    except Exception:
        pass


class OPCClientManager:
    _client = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_client(cls):
        """The connected runtime client. It is only kept once connect() has succeeded; after a lost
        connection the runtime loop calls close() and asks again. (asyncua's Client has no public
        "connected" flag; the old check read a `_connected` attribute that does not exist.)"""
        if cls._client is not None:
            return cls._client
        async with cls._lock:
            if cls._client is not None:
                return cls._client
            url = settings.opc_endpoint_url or get_runtime().connection.url
            if not url:
                raise RuntimeError("No OPC UA endpoint: set OPC_ENDPOINT_URL in .env or the connection url in the layout")
            client = Client(
                url,
                timeout=10,               # Wait up to 10s for replies before throwing a TimeoutError
                watchdog_intervall=5.0,   # Check server health every 5s instead of every 1s
            )
            client.application_uri = "urn:asyncua-dashboard:client"
            await client.set_security(
                SecurityPolicyBasic256Sha256,
                certificate=settings.client_cert_path,
                private_key=settings.client_key_path,
            )
            apply_credentials(client)
            await client.connect()
            try:
                await client.load_data_type_definitions()
            except BaseException:
                await _quiet_disconnect(client)
                raise
            cls._client = client
            logger.info("OPC UA client connected to %s (%s)", url, "user " + settings.opc_username if settings.opc_username else "anonymous")
            return client

    @classmethod
    async def close(cls):
        if cls._client:
            try:
                await cls._client.disconnect()
            except Exception:
                pass  # Ignore errors if already disconnected
            cls._client = None