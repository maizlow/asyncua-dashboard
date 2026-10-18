# opc_client_manager.py
import asyncio
import logging

from asyncua import Client
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256

from backend.dashboard_config import get_dashboard
from backend.settings import settings

logger = logging.getLogger(__name__)

class OPCClientManager:
    _client = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_client(cls):
        if cls._client is None or not cls._client._connected:
            async with cls._lock:
                if cls._client is None or not cls._client._connected:
                    url = settings.opc_endpoint_url or get_dashboard().opc.url
                    if not url:
                        raise RuntimeError("No OPC UA endpoint: set OPC_ENDPOINT_URL in .env or opc.url in dashboard.yaml")
                    # FIX: Relax the watchdog interval and increase the request timeout
                    cls._client = Client(
                        url, 
                        timeout=10,               # Wait up to 10s for replies before throwing a TimeoutError
                        watchdog_intervall=5.0    # Check server health every 5s instead of every 1s
                    )
                    cls._client.application_uri = "urn:asyncua-dashboard:client"

                    await cls._client.set_security(
                        SecurityPolicyBasic256Sha256,
                        certificate=settings.client_cert_path,
                        private_key=settings.client_key_path
                    )
                    cls._client.set_user(settings.opc_username)
                    cls._client.set_password(settings.opc_password)

                    await cls._client.connect()
                    await cls._client.load_data_type_definitions()
                    logger.info("OPC UA client connected to %s", url)
        return cls._client

    @classmethod
    async def close(cls):
        if cls._client:
            try:
                await cls._client.disconnect()
            except Exception:
                pass  # Ignore errors if already disconnected
            cls._client = None