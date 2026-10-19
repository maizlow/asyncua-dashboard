"""Editor drafts, validation, publishing and versions over /api/editor (etapp 2)."""

import asyncio
import copy
import secrets
from pathlib import Path

import pytest
import yaml
from fastapi.testclient import TestClient

import backend.app.routers.editor as editor_router
import backend.layout_store as layout_store
import backend.users as users
from backend.app.main import create_app
from backend.layout_store import LayoutStore, bootstrap

BASE_DIR = Path(__file__).resolve().parents[2]
EXAMPLE = BASE_DIR / "dashboard.yaml"
MULTI = BASE_DIR / "docs" / "examples" / "flera-displayer.yaml"
H = {"X-Editor": "1"}
PW = secrets.token_urlsafe(16)
USER = "johan"


@pytest.fixture
def client(db, tmp_path, monkeypatch):
    us = users.UserStore(db)
    asyncio.run(us.init_db())
    asyncio.run(us.add(USER, PW))
    store = LayoutStore(db)
    p = tmp_path / "dashboard.yaml"
    p.write_text(EXAMPLE.read_text(encoding="utf-8"), encoding="utf-8")
    asyncio.run(bootstrap(store, p))
    monkeypatch.setattr(editor_router, "get_user_store", lambda: us)
    monkeypatch.setattr(editor_router, "get_layout_store", lambda: store)
    editor_router._failures.clear()
    c = TestClient(create_app())
    assert c.post("/api/editor/login", json={"name": USER, "password": PW}, headers=H).status_code == 200
    c.store = store
    c.yaml_path = p
    yield c
    layout_store._runtime = None


def published(c):
    return c.get("/api/editor/document").json()


def test_everything_needs_a_session(db):
    c = TestClient(create_app())
    for method, path in [("get", "/draft"), ("put", "/draft"), ("post", "/validate"), ("post", "/publish"), ("get", "/versions"), ("get", "/versions/1")]:
        r = getattr(c, method)(f"/api/editor{path}", headers=H, **({"json": {"document": {}}} if method in ("put", "post") else {}))
        assert r.status_code == 401, (method, path)


def test_validate_reports_paths(client):
    doc = published(client)["document"]
    assert client.post("/api/editor/validate", json={"document": doc}, headers=H).json() == {"ok": True, "problems": [], "runtime": []}
    bad = copy.deepcopy(doc)
    bad["displays"]["tv1"]["screens"]["2"]["items"][0]["tag"] = "ProductionCuont"
    r = client.post("/api/editor/validate", json={"document": bad}, headers=H).json()
    assert not r["ok"]
    assert r["problems"] == [{"path": ["displays", "tv1", "screens", 2, "items", 0, "tag"], "message": "okänd tagg 'ProductionCuont' i plc1 (menade du 'ProductionCount'?)"}]
    bad["displays"]["tv1"]["screens"]["2"]["items"][0]["w"] = 99
    r = client.post("/api/editor/validate", json={"document": bad}, headers=H).json()
    assert r["problems"][0]["path"][-1] == "w"


def test_publish_makes_a_new_version_and_clears_the_draft(client):
    pub = published(client)
    doc = pub["document"]
    doc["displays"]["tv1"]["screens"]["2"]["title"] = "Från editorn"
    assert client.put("/api/editor/draft", json={"document": doc, "base_version": pub["version"]}, headers=H).status_code == 200
    d = client.get("/api/editor/draft").json()["draft"]
    assert d["document"]["displays"]["tv1"]["screens"]["2"]["title"] == "Från editorn" and d["author"] == USER and not d["stale"]
    r = client.post("/api/editor/publish", json={"document": doc, "base_version": pub["version"], "comment": "ny titel"}, headers=H)
    assert r.status_code == 200, r.text
    assert r.json() == {"version": pub["version"] + 1, "restart_needed": False}
    assert layout_store.get_runtime().screens[2].title == "Från editorn"
    assert client.get("/api/editor/draft").json() == {"draft": None}
    v = client.get("/api/editor/versions").json()
    assert v["published"] == pub["version"] + 1
    assert (v["versions"][0]["source"], v["versions"][0]["author"], v["versions"][0]["comment"]) == ("editor", USER, "ny titel")
    # the editor has published: LAYOUT_YAML_IMPORT=auto no longer imports a changed file
    assert asyncio.run(client.store.editor_used())


def test_publish_needs_a_valid_document_the_runtime_can_run(client):
    pub = published(client)
    bad = copy.deepcopy(pub["document"])
    bad["displays"]["tv1"]["screens"]["2"]["items"][0]["label"] = "x" * 30
    r = client.post("/api/editor/publish", json={"document": bad, "base_version": pub["version"]}, headers=H)
    assert r.status_code == 422 and r.json()["detail"]["problems"]
    multi = yaml.safe_load(MULTI.read_text(encoding="utf-8"))
    r = client.post("/api/editor/publish", json={"document": multi, "base_version": pub["version"]}, headers=H)
    assert r.status_code == 422 and any("etapp 4" in m for m in r.json()["detail"]["runtime"])
    assert published(client)["version"] == pub["version"]


def test_publish_refuses_a_stale_base_version(client):
    pub = published(client)
    doc = pub["document"]
    assert client.post("/api/editor/publish", json={"document": doc, "base_version": pub["version"]}, headers=H).status_code == 200
    # a second editor still on the old version
    r = client.post("/api/editor/publish", json={"document": doc, "base_version": pub["version"]}, headers=H)
    assert r.status_code == 409 and "har publicerats sedan du började" in r.json()["detail"]
    client.put("/api/editor/draft", json={"document": doc, "base_version": pub["version"]}, headers=H)
    assert client.get("/api/editor/draft").json()["draft"]["stale"] is True


def test_new_tags_say_restart(client):
    pub = published(client)
    doc = pub["document"]
    doc["connections"]["plc1"]["tags"]["Temp"] = 'ns=3;s="DB"."temp"'
    r = client.post("/api/editor/publish", json={"document": doc, "base_version": pub["version"]}, headers=H)
    assert r.json()["restart_needed"] is True


def test_versions_restore_and_yaml_export(client):
    pub = published(client)
    doc = pub["document"]
    doc["displays"]["tv1"]["screens"]["2"]["title"] = "Version två"
    client.post("/api/editor/publish", json={"document": doc, "base_version": pub["version"]}, headers=H)
    # restoring = load version 1 as the draft and publish it again (a new version, nothing overwritten)
    v1 = client.get("/api/editor/versions/1").json()
    assert v1["document"]["displays"]["tv1"]["screens"]["2"].get("title") != "Version två"
    r = client.post("/api/editor/publish", json={"document": v1["document"], "base_version": pub["version"] + 1, "comment": "återställd från version 1"}, headers=H)
    assert r.json()["version"] == pub["version"] + 2
    y = client.get("/api/editor/versions/2/export.yaml")
    assert y.headers["content-type"].startswith("application/yaml")
    assert yaml.safe_load(y.text)["displays"]["tv1"]["screens"]["2"]["title"] == "Version två"
    assert client.get("/api/editor/versions/99").status_code == 404


def test_editor_code_never_writes_to_the_plc():
    """The editor API reads and stores layouts; nothing under it may write OPC UA values."""
    for f in ["backend/app/routers/editor.py", "backend/users.py", "backend/layout_store.py", "backend/layout_doc.py"]:
        text = (BASE_DIR / f).read_text(encoding="utf-8")
        for call in ("write_value", "set_value", "write_attribute"):
            assert call not in text, f"{f} innehåller {call}"
