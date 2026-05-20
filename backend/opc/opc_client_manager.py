# opc_client_manager.py
from asyncua import Client
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256

import asyncio
import logging

from backend.settings import settings

logging.basicConfig(level=settings.log_level)

class OPCClientManager:
    _client = None
    _lock = asyncio.Lock()

    @classmethod
    async def get_client(cls):
        if cls._client is None or not cls._client._connected:
            async with cls._lock:
                if cls._client is None or not cls._client._connected:
                    # FIX: Relax the watchdog interval and increase the request timeout
                    cls._client = Client(
                        settings.opc_endpoint_url, 
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
                    print("✅ OPC UA Client connected")
        return cls._client

    @classmethod
    async def close(cls):
        if cls._client:
            try:
                await cls._client.disconnect()
            except Exception:
                pass  # Ignore errors if already disconnected
            cls._client = None