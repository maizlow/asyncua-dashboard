"""FastAPI serves the built frontend on the API port: TV at /, editor at /editor/, hashed assets cached."""

import logging
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from backend.app import main
from backend.app.frontend import IMMUTABLE, REVALIDATE
from backend.settings import BASE_DIR, settings

TV = "<!doctype html><title>TV</title><script type=module src=/assets/main-AbC123.js></script>"
EDITOR = "<!doctype html><title>Editor</title><script type=module src=/assets/editor-XyZ789.js></script>"


@pytest.fixture
def dist(tmp_path: Path) -> Path:
    (tmp_path / "editor").mkdir()
    (tmp_path / "assets").mkdir()
    (tmp_path / "index.html").write_text(TV)
    (tmp_path / "editor" / "index.html").write_text(EDITOR)
    (tmp_path / "assets" / "main-AbC123.js").write_text("console.log('tv')")
    (tmp_path / "assets" / "editor-XyZ789.css").write_text("body{}")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    (tmp_path.parent / "secret.txt").write_text("outside the build")
    return tmp_path


@pytest.fixture
def client(dist, monkeypatch):
    monkeypatch.setattr(settings, "frontend_dist", str(dist))
    return TestClient(main.create_app())  # no `with`: lifespan (background tasks) not started


def test_tv_view_at_root(client):
    for url in ("/", "/?display=tv2", "/index.html"):
        r = client.get(url)
        assert r.status_code == 200, url
        assert r.text == TV
        assert r.headers["content-type"].startswith("text/html")
        assert r.headers["cache-control"] == REVALIDATE


def test_editor_and_its_client_side_routes(client):
    r = client.get("/editor", follow_redirects=False)
    assert r.status_code in (301, 307) and r.headers["location"].endswith("/editor/")
    for url in ("/editor/", "/editor/?display=tv1", "/editor/screen/3", "/editor/a/b/c"):
        r = client.get(url)
        assert r.status_code == 200, url
        assert r.text == EDITOR, url
        assert r.headers["cache-control"] == REVALIDATE


def test_other_page_paths_fall_back_to_the_tv_view(client):
    r = client.get("/tv2")
    assert r.status_code == 200 and r.text == TV


def test_hashed_assets_are_immutable(client):
    r = client.get("/assets/main-AbC123.js")
    assert r.status_code == 200 and r.text == "console.log('tv')"
    assert "javascript" in r.headers["content-type"]
    assert r.headers["cache-control"] == IMMUTABLE
    assert client.get("/assets/editor-XyZ789.css").headers["cache-control"] == IMMUTABLE


def test_public_files_are_revalidated(client):
    r = client.get("/favicon.svg")
    assert r.status_code == 200 and r.headers["cache-control"] == REVALIDATE


def test_missing_files_are_404_not_html(client):
    # An old cached page asking for an asset from a previous build must not get index.html as JavaScript
    for url in ("/assets/main-OLD.js", "/assets/nope", "/customerLogo.png", "/editor/missing.js"):
        r = client.get(url)
        assert r.status_code == 404, url
        assert "html" not in r.headers.get("content-type", ""), url


def test_not_modified(client):
    first = client.get("/assets/main-AbC123.js")
    r = client.get("/assets/main-AbC123.js", headers={"If-None-Match": first.headers["etag"]})
    assert r.status_code == 304
    assert r.headers["cache-control"] == IMMUTABLE
    page = client.get("/editor/")
    r = client.get("/editor/", headers={"If-None-Match": page.headers["etag"]})
    assert r.status_code == 304 and r.headers["cache-control"] == REVALIDATE


def test_head_works_and_writes_do_not(client):
    assert client.head("/editor/").status_code == 200
    assert client.head("/assets/main-AbC123.js").headers["cache-control"] == IMMUTABLE
    assert client.post("/editor/").status_code == 405
    assert client.put("/").status_code == 405


def test_api_routes_are_not_shadowed(client):
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json()["frontend"] is True
    r = client.get("/api/editor/session")  # editor login still required
    assert r.status_code == 401 and r.headers["content-type"].startswith("application/json")
    r = client.post("/api/editor/login", json={"name": "x", "password": "y"})  # no CSRF header
    assert r.status_code == 403
    for url in ("/api/does-not-exist", "/api/editor/nope", "/api", "/ws/extra"):
        r = client.get(url)
        assert r.status_code == 404, url
        assert r.headers["content-type"].startswith("application/json"), url
    assert client.post("/api/does-not-exist").status_code == 404
    assert client.post("/api/general").status_code == 405  # wrong method on a real route stays 405
    assert client.get("/ws").status_code == 404  # plain GET on the WebSocket path is not a page
    assert client.get("/openapi.json").json()["info"]["title"] == "Production Dashboard API"
    assert client.get("/docs").status_code == 200


def test_websocket_route_wins_over_the_mount(client, monkeypatch):
    sent = {"type": "full_snapshot"}

    async def fake_snapshot():
        return sent

    monkeypatch.setattr(main.websocket, "_build_snapshot", fake_snapshot)
    with client.websocket_connect("/ws") as ws:
        assert ws.receive_json() == sent
    # Any other WebSocket path is refused (closed), never handed to the file server
    with pytest.raises(WebSocketDisconnect), client.websocket_connect("/wsx") as ws:
        ws.receive_text()


def test_no_path_traversal(client):
    for url in ("/../secret.txt", "/%2e%2e/secret.txt", "/assets/..%2f..%2fsecret.txt", "/editor/../../secret.txt"):
        r = client.get(url)
        assert "outside the build" not in r.text, url


def test_without_a_build_only_the_api_is_served(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(settings, "frontend_dist", str(tmp_path / "missing"))
    with caplog.at_level(logging.WARNING):
        c = TestClient(main.create_app())
    assert "Frontend build not found" in caplog.text
    assert "frontend build not served" in c.get("/").json()["message"]
    assert c.get("/api/health").json()["frontend"] is False
    assert c.get("/editor/").status_code == 404


def test_dist_path_setting(monkeypatch):
    monkeypatch.setattr(settings, "frontend_dist", "")
    assert settings.frontend_dist_path == BASE_DIR / "frontend" / "dist"
    monkeypatch.setattr(settings, "frontend_dist", "build/web")
    assert settings.frontend_dist_path == BASE_DIR / "build" / "web"
    monkeypatch.setattr(settings, "frontend_dist", "/srv/dashboard")
    assert settings.frontend_dist_path == Path("/srv/dashboard")


REAL_DIST = BASE_DIR / "frontend" / "dist"


@pytest.mark.skipif(not (REAL_DIST / "editor" / "index.html").is_file(), reason="frontend not built")
def test_real_build_references_resolve(monkeypatch):
    """Every /assets/... file the built pages load exists and is served (base path '/', not the demo's)."""
    import re

    monkeypatch.setattr(settings, "frontend_dist", str(REAL_DIST))
    c = TestClient(main.create_app())
    for page in ("/", "/editor/"):
        html = c.get(page).text
        refs = re.findall(r'(?:src|href)="(/[^"]+)"', html)
        assert any(r.startswith("/assets/") for r in refs), (page, refs)
        assert not any(r.startswith("/asyncua-dashboard/") for r in refs), "demo build in dist"
        for ref in refs:
            r = c.get(ref)
            assert r.status_code == 200, ref
            if ref.startswith("/assets/"):
                assert r.headers["cache-control"] == IMMUTABLE
