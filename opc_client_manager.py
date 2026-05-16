# opc_client_manager.py
from asyncua import Client
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256
import config
import asyncio
import logging

logging.basicConfig(level=logging.WARNING)

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
                        config.OPC_ENDPOINT_URL, 
                        timeout=10,               # Wait up to 10s for replies before throwing a TimeoutError
                        watchdog_intervall=5.0    # Check server health every 5s instead of every 1s
                    )
                    cls._client.application_uri = "urn:asyncua-dashboard:client"

                    await cls._client.set_security(
                        SecurityPolicyBasic256Sha256,
                        certificate=config.CLIENT_CERT,
                        private_key=config.CLIENT_KEY
                    )
                    cls._client.set_user(config.OPC_USERNAME)
                    cls._client.set_password(config.OPC_PASSWORD)

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