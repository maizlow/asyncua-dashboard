"""The dashboard's OPC client without OPC_USERNAME/OPC_PASSWORD: anonymous session, certificate only.

Before the fix the runtime client always called set_password(settings.opc_password), which asyncua
rejects for None ("Password must be a string"), so the dashboard reconnected forever."""

import asyncio
import secrets
import socket
import threading
from pathlib import Path

import pytest
from asyncua import Client, Server, ua
from asyncua.crypto.cert_gen import setup_self_signed_certificate
from asyncua.crypto.security_policies import SecurityPolicyBasic256Sha256
from cryptography.x509.oid import ExtendedKeyUsageOID

from backend.opc import browse
from backend.opc.opc_client_manager import OPCClientManager, apply_credentials
from backend.settings import settings


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


async def _cert(dir_: Path, name: str, uri: str, usage) -> tuple[Path, Path]:
    cert, key = dir_ / f"{name}.der", dir_ / f"{name}.pem"
    await setup_self_signed_certificate(key, cert, uri, "localhost", [usage], {"commonName": name})
    return cert, key


class SecureServer:
    """Basic256Sha256 Sign & Encrypt only, like the S7-1500, with anonymous logon allowed."""

    def __init__(self, tmp: Path):
        self.tmp = tmp
        self.url = f"opc.tcp://127.0.0.1:{_free_port()}/"
        self.loop = asyncio.new_event_loop()
        self.ready = threading.Event()
        self.stop = None
        self.error = None
        self.thread = threading.Thread(target=self.loop.run_until_complete, args=(self._main(),), daemon=True)

    async def _main(self):
        try:
            cert, key = await _cert(self.tmp, "server", "urn:test:server", ExtendedKeyUsageOID.SERVER_AUTH)
            server = Server()
            await server.init()
            server.set_endpoint(self.url)
            server.set_security_policy([ua.SecurityPolicyType.Basic256Sha256_SignAndEncrypt])
            await server.load_certificate(str(cert))
            await server.load_private_key(str(key))
            self.stop = asyncio.Event()
            async with server:
                self.ready.set()
                await self.stop.wait()
        except Exception as exc:  # surfaced by start()
            self.error = exc
            self.ready.set()

    def start(self):
        self.thread.start()
        assert self.ready.wait(30), "test server did not start"
        assert self.error is None, self.error

    def shutdown(self):
        self.loop.call_soon_threadsafe(self.stop.set)
        self.thread.join(10)


@pytest.fixture(scope="module")
def secure(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("opc-certs")
    server = SecureServer(tmp)
    server.start()
    cert, key = asyncio.run(_cert(tmp, "client", "urn:asyncua-dashboard:client", ExtendedKeyUsageOID.CLIENT_AUTH))
    server.client_cert, server.client_key = cert, key
    yield server
    server.shutdown()


@pytest.fixture
def anonymous(secure, monkeypatch):
    monkeypatch.setattr(settings, "opc_endpoint_url", secure.url)
    monkeypatch.setattr(settings, "client_cert_path", str(secure.client_cert))
    monkeypatch.setattr(settings, "client_key_path", str(secure.client_key))
    monkeypatch.setattr(settings, "opc_username", None)
    monkeypatch.setattr(settings, "opc_password", None)
    return secure


def test_no_username_means_no_credentials(monkeypatch):
    monkeypatch.setattr(settings, "opc_username", None)
    monkeypatch.setattr(settings, "opc_password", None)
    client = Client("opc.tcp://127.0.0.1:4840/")
    apply_credentials(client)  # used to raise TypeError: Password must be a string
    assert client._username is None and client._password is None


def test_password_alone_is_ignored(monkeypatch, caplog):
    monkeypatch.setattr(settings, "opc_username", None)
    monkeypatch.setattr(settings, "opc_password", secrets.token_urlsafe(16))  # throwaway, per run
    client = Client("opc.tcp://127.0.0.1:4840/")
    apply_credentials(client)
    assert client._username is None and client._password is None
    assert "connecting anonymously" in caplog.text


def test_username_without_password_sends_an_empty_password(monkeypatch):
    monkeypatch.setattr(settings, "opc_username", "dashboard")
    monkeypatch.setattr(settings, "opc_password", None)
    client = Client("opc.tcp://127.0.0.1:4840/")
    apply_credentials(client)
    assert (client._username, client._password) == ("dashboard", "")


def test_runtime_client_connects_anonymously_with_certificate(anonymous):
    async def main():
        OPCClientManager._client = None
        OPCClientManager._lock = asyncio.Lock()  # bind to this test's event loop
        try:
            client = await OPCClientManager.get_client()
            assert await OPCClientManager.get_client() is client  # reused, not reconnected
            assert client.security_policy.URI == SecurityPolicyBasic256Sha256.URI
            assert client._username is None
            # A real request over the encrypted, anonymous session
            name = await client.nodes.server.read_browse_name()
            assert name.Name == "Server"
        finally:
            await OPCClientManager.close()

    asyncio.run(main())


def test_browse_client_connects_the_same_way(anonymous):
    async def main():
        client = await browse.make_client(anonymous.url)
        await client.connect()
        try:
            assert client._username is None
            assert (await client.nodes.server.read_browse_name()).Name == "Server"
        finally:
            await client.disconnect()

    asyncio.run(main())


def test_failed_connect_leaves_no_half_built_client(anonymous, monkeypatch):
    monkeypatch.setattr(settings, "opc_endpoint_url", f"opc.tcp://127.0.0.1:{_free_port()}/")

    async def main():
        OPCClientManager._client = None
        OPCClientManager._lock = asyncio.Lock()
        with pytest.raises((OSError, asyncio.TimeoutError)):
            await OPCClientManager.get_client()
        assert OPCClientManager._client is None
        await OPCClientManager.close()

    asyncio.run(main())
