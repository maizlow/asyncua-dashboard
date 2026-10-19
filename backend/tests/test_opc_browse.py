"""Read-only OPC UA browsing (etapp 3) against a real asyncua test server laid out like an S7-1500:
Objects → PLC_1 → DataBlocksGlobal → "DB Production TV" → dashboardData → variables, plus a DB with
1200 variables for the caps."""

import asyncio
import inspect
import re
import secrets
import socket
import threading

import pytest
from asyncua import Client, Server, ua
from fastapi.testclient import TestClient

import backend.app.routers.editor as editor_router
import backend.layout_store as layout_store
import backend.opc.browse as browse
import backend.users as users
from backend.app.main import create_app

H = {"X-Editor": "1"}
PW = secrets.token_urlsafe(16)
USER = "johan"
DB = '"DB Production TV"'
DATA = f'ns=3;s={DB}."dashboardData"'


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OpcServer:
    """An asyncua server on its own thread and event loop."""

    def __init__(self):
        self.port = _free_port()
        self.url = f"opc.tcp://127.0.0.1:{self.port}/"
        self.loop = asyncio.new_event_loop()
        self.ready = threading.Event()
        self.thread = threading.Thread(target=self.loop.run_until_complete, args=(self._main(),), daemon=True)

    async def _main(self):
        self.stop = asyncio.Event()
        server = Server()
        await server.init()
        server.set_endpoint(self.url)
        server.set_server_name("S7-1500 test")
        await server.register_namespace("urn:test:dummy")  # 2
        ns = await server.register_namespace("http://www.siemens.com/simatic-s7-opcua")  # 3
        assert ns == 3
        objects = server.nodes.objects
        plc = await objects.add_object(ua.NodeId("PLC_1", 3), ua.QualifiedName("PLC_1", 3))
        dbs = await plc.add_object(ua.NodeId("DataBlocksGlobal", 3), ua.QualifiedName("DataBlocksGlobal", 3))
        await plc.add_object(ua.NodeId("Inputs", 3), ua.QualifiedName("Inputs", 3))
        db = await dbs.add_object(ua.NodeId(DB, 3), ua.QualifiedName("DB Production TV", 3))
        data = await db.add_object(ua.NodeId(f'{DB}."dashboardData"', 3), ua.QualifiedName("dashboardData", 3))

        async def var(name, value, vtype):
            return await data.add_variable(ua.NodeId(f'{DB}."dashboardData"."{name}"', 3), ua.QualifiedName(name, 3), ua.Variant(value, vtype))

        await var("actual", 45832, ua.VariantType.Int32)
        await var("oee", 86.4, ua.VariantType.Float)
        await var("prodState", 2, ua.VariantType.Int16)
        await var("running", True, ua.VariantType.Boolean)
        await var("batch", "A-17", ua.VariantType.String)
        await var("history", [1.0, 2.0, 3.0], ua.VariantType.Float)
        self.setpoint = await var("setpoint", 12.5, ua.VariantType.Double)
        await self.setpoint.set_writable()
        big = await dbs.add_object(ua.NodeId('"DB Big"', 3), ua.QualifiedName("DB Big", 3))
        for i in range(1200):
            await big.add_variable(ua.NodeId(f'"DB Big"."v{i}"', 3), ua.QualifiedName(f"v{i}", 3), ua.Variant(i, ua.VariantType.UInt16))
        async with server:
            self.ready.set()
            await self.stop.wait()

    def start(self):
        self.thread.start()
        assert self.ready.wait(30), "test server did not start"

    def run(self, coro):
        return asyncio.run_coroutine_threadsafe(coro, self.loop).result(10)

    def shutdown(self):
        self.loop.call_soon_threadsafe(self.stop.set)
        self.thread.join(10)


@pytest.fixture(scope="module")
def opc():
    srv = OpcServer()
    srv.start()
    yield srv
    srv.shutdown()


@pytest.fixture
def client(db, opc, monkeypatch):
    us = users.UserStore(db)
    asyncio.run(us.init_db())
    asyncio.run(us.add(USER, PW))
    monkeypatch.setattr(editor_router, "get_user_store", lambda: us)
    editor_router._failures.clear()
    layout_store._runtime = None  # dashboard.yaml: one connection, plc1

    async def plain_client(url):  # the test server has no security
        return Client(url, timeout=5)

    monkeypatch.setattr(browse, "make_client", plain_client)
    from backend.settings import settings

    monkeypatch.setattr(settings, "opc_endpoint_url", opc.url)
    monkeypatch.setattr(browse, "_service", None)
    c = TestClient(create_app())
    assert c.post("/api/editor/login", json={"name": USER, "password": PW}, headers=H).status_code == 200
    yield c
    layout_store._runtime = None


def get(c, what, **params):
    return c.get(f"/api/editor/opcua/plc1/{what}", params=params)


def by_name(children):
    return {ch["browse_name"]: ch for ch in children}


def test_needs_editor_login(db):
    c = TestClient(create_app())
    for what in ("browse", "read?node=i=85", "search?q=oee"):
        assert c.get(f"/api/editor/opcua/plc1/{what}").status_code == 401


def test_browse_one_level_at_a_time(client):
    root = get(client, "browse").json()
    assert root["node"] == "i=85" and not root["truncated"]
    names = [ch["browse_name"] for ch in root["children"]]
    assert "PLC_1" in names and names[-1] == "Server"  # the server's diagnostics sorted last
    plc = by_name(root["children"])["PLC_1"]
    assert plc == {"node_id": "ns=3;s=PLC_1", "browse_name": "PLC_1", "display_name": "PLC_1", "node_class": "Object", "has_children": True}

    dbs = by_name(get(client, "browse", node="ns=3;s=PLC_1").json()["children"])
    assert set(dbs) == {"DataBlocksGlobal", "Inputs"}
    assert dbs["Inputs"]["has_children"] is False

    data = get(client, "browse", node=f"ns=3;s={DB}").json()["children"]
    assert [d["browse_name"] for d in data] == ["dashboardData"]
    vars_ = by_name(get(client, "browse", node=data[0]["node_id"]).json()["children"])
    assert vars_["actual"] | {} == {
        "node_id": f'{DATA}."actual"',
        "browse_name": "actual",
        "display_name": "actual",
        "node_class": "Variable",
        "has_children": False,
        "data_type": "Int32",
        "readable": True,
        "writable": False,
        "array": False,
    }
    assert vars_["oee"]["data_type"] == "Float"
    assert vars_["running"]["data_type"] == "Boolean"
    assert vars_["batch"]["data_type"] == "String"
    assert vars_["history"]["array"] is True
    assert vars_["setpoint"]["writable"] is True


def test_read_value_and_type(client):
    r = get(client, "read", node=f'{DATA}."oee"').json()
    assert r["data_type"] == "Float" and abs(r["value"] - 86.4) < 1e-4 and r["status"] == "Good"
    assert r["browse_name"] == "oee" and r["readable"] and not r["writable"]
    assert get(client, "read", node=f'{DATA}."batch"').json()["value"] == "A-17"
    assert get(client, "read", node=f'{DATA}."history"').json()["value"] == [1.0, 2.0, 3.0]
    # Objects have no value
    r = get(client, "read", node="ns=3;s=PLC_1")
    assert r.status_code == 400 and "inte en variabel" in r.json()["detail"]


def test_bad_and_unknown_nodes(client):
    r = get(client, "browse", node="ns=3;s=nope")
    assert r.status_code == 404 and r.json()["detail"] == "Noden finns inte i PLC:n."
    r = get(client, "read", node="ns=3;s=nope")
    assert r.status_code == 404
    r = get(client, "browse", node="inte ett nod-id")
    assert r.status_code == 400 and "Ogiltigt nod-id" in r.json()["detail"]
    assert client.get("/api/editor/opcua/plc9/browse").json()["detail"].startswith("PLC:n 'plc9' finns inte i den publicerade layouten")


def test_caps_on_big_data_blocks(client):
    r = get(client, "browse", node='ns=3;s="DB Big"', limit=100).json()
    assert len(r["children"]) == 100 and r["truncated"] is True
    r = get(client, "browse", node='ns=3;s="DB Big"').json()
    assert len(r["children"]) == 200 and r["truncated"] is True and r["limit"] == 200
    assert get(client, "browse", node='ns=3;s="DB Big"', limit=5000).status_code == 422


def test_search(client, monkeypatch):
    r = get(client, "search", q="OEE").json()
    hit = next(x for x in r["results"] if x["browse_name"] == "oee")
    assert hit["path"] == ["PLC_1", "DataBlocksGlobal", "DB Production TV", "dashboardData"]
    assert hit["data_type"] == "Float" and "has_children" in hit
    assert all(not x["node_id"].startswith("i=") for x in r["results"])  # nothing from the server's diagnostics
    # Search below a node id fragment
    assert {x["browse_name"] for x in get(client, "search", q="prodstate", root=f"ns=3;s={DB}").json()["results"]} == {"prodState"}
    # Caps: visited nodes
    monkeypatch.setattr(browse, "SEARCH_MAX_NODES", 50)
    r = get(client, "search", q="v11").json()
    assert r["complete"] is False and r["stopped_by"] == "antal"
    assert get(client, "search", q="x").status_code == 422


def test_unreachable_plc_gives_a_swedish_message(client, monkeypatch):
    from backend.settings import settings

    monkeypatch.setattr(settings, "opc_endpoint_url", f"opc.tcp://127.0.0.1:{_free_port()}/")
    r = get(client, "browse")
    assert r.status_code == 503
    assert re.match(r"Kan inte nå PLC:n 'plc1' \(opc\.tcp://127\.0\.0\.1:\d+/\): anslutningen nekades", r.json()["detail"])


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(browse, "RATE_MAX", 3)
    codes = [get(client, "read", node=f'{DATA}."actual"').status_code for _ in range(4)]
    assert codes == [200, 200, 200, 429]


def test_read_only(client, opc, monkeypatch):
    """Nothing in the browse module can write, call methods or subscribe."""
    src = inspect.getsource(browse)
    code = "\n".join(line for line in src.splitlines() if not line.lstrip().startswith("#"))
    code = re.sub(r'"""[\s\S]*?"""', "", code)
    for forbidden in ("write", "create_subscription", "call_method", ".call(", "add_nodes", "delete_nodes", "set_value"):
        assert forbidden not in code, forbidden

    from asyncua.client.ua_client import UaClient
    from asyncua.common.node import Node

    def trap(*_a, **_k):
        raise AssertionError("browsing must never write or subscribe")

    for name in ("write", "create_subscription", "call", "add_nodes", "delete_nodes"):
        monkeypatch.setattr(UaClient, name, trap)
    for name in ("write_attribute", "write_value", "set_value", "call_method"):
        monkeypatch.setattr(Node, name, trap)
    monkeypatch.setattr(Client, "create_subscription", trap)

    sp = f'{DATA}."setpoint"'
    assert get(client, "browse", node=f'{DATA}').status_code == 200
    assert get(client, "read", node=sp).json()["value"] == 12.5
    assert get(client, "search", q="setpoint").status_code == 200
    assert opc.run(opc.setpoint.read_value()) == 12.5  # unchanged on the server


def test_routes_are_get_only():
    from backend.app.routers import opcua

    assert {m for r in opcua.router.routes for m in r.methods} == {"GET"}


def test_idle_session_is_closed(opc, monkeypatch):
    """The browse session closes itself after IDLE_S without a request."""

    async def plain_client(url):
        return Client(url, timeout=5)

    from backend.settings import settings

    monkeypatch.setattr(browse, "make_client", plain_client)
    monkeypatch.setattr(settings, "opc_endpoint_url", opc.url)
    monkeypatch.setattr(browse, "IDLE_S", 0.2)
    layout_store._runtime = None

    async def main():
        svc = browse.BrowseService()
        await svc.read("plc1", f'{DATA}."actual"')
        assert "plc1" in svc._sessions
        await asyncio.sleep(0.6)
        assert "plc1" not in svc._sessions

    asyncio.run(main())
