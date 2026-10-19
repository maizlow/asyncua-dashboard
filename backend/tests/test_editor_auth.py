"""Editor accounts, sessions and the /api/editor guard (decision 13)."""

import asyncio
import secrets

import pytest
from fastapi.testclient import TestClient

import backend.app.routers.editor as editor_router
import backend.users as users
from backend.app.main import create_app

H = {"X-Editor": "1"}
# Throwaway test credentials, generated per run (no fixed strings that look like secrets)
PW = secrets.token_urlsafe(16)
PW2 = secrets.token_urlsafe(16)
PW3 = secrets.token_urlsafe(16)
USER, OTHER = "johan", "kollega"
UNKNOWN, INVALID_NAME = "okänd", "Johan Kring"


@pytest.fixture
def store(db, monkeypatch):
    s = users.UserStore(db)
    asyncio.run(s.init_db())
    asyncio.run(s.add(USER, PW))
    monkeypatch.setattr(editor_router, "get_user_store", lambda: s)
    editor_router._failures.clear()
    return s


def test_passwords_are_hashed_and_verified(store, db):
    rows = asyncio.run(db.run_async(lambda c: c.execute("SELECT hash FROM editor_users WHERE name='johan'").fetchone()))
    assert rows[0].startswith("$argon2id$") and PW not in rows[0]
    assert asyncio.run(store.verify(USER, PW))
    assert not asyncio.run(store.verify(USER, PW[::-1]))
    assert not asyncio.run(store.verify(UNKNOWN, PW))


def test_account_rules(store):
    with pytest.raises(ValueError, match="minst"):
        asyncio.run(store.add(OTHER, PW[:4]))
    with pytest.raises(ValueError, match="finns redan"):
        asyncio.run(store.add(USER, PW2))
    with pytest.raises(ValueError, match="namnet"):
        asyncio.run(store.add(INVALID_NAME, PW2))
    asyncio.run(store.add(OTHER, PW2))
    assert asyncio.run(store.names()) == [USER, OTHER]


def test_login_session_logout(store):
    c = TestClient(create_app())
    assert c.get("/api/editor/session").status_code == 401
    assert c.get("/api/editor/document").status_code == 401
    r = c.post("/api/editor/login", json={"name": USER, "password": PW}, headers=H)
    assert r.status_code == 200 and r.json() == {"user": USER}
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=strict" in cookie and "Path=/api/editor" in cookie
    assert c.get("/api/editor/session").json() == {"user": USER}
    doc = c.get("/api/editor/document").json()
    assert doc["document"]["schema_version"] == 2 and "connections" in doc["document"]
    assert c.post("/api/editor/logout", headers=H).status_code == 200
    assert c.get("/api/editor/session").status_code == 401


def test_session_token_is_not_stored_in_clear(store, db):
    token = asyncio.run(store.create_session(USER))
    stored = asyncio.run(db.run_async(lambda c: [r[0] for r in c.execute("SELECT token_hash FROM editor_sessions")]))
    assert token not in stored and len(stored) == 1


def test_password_change_and_removal_end_sessions(store):
    token = asyncio.run(store.create_session(USER))
    asyncio.run(store.set_password(USER, PW3))
    assert asyncio.run(store.session_user(token)) is None
    token = asyncio.run(store.create_session(USER))
    asyncio.run(store.remove(USER))
    assert asyncio.run(store.session_user(token)) is None


def test_state_changing_requests_need_the_editor_header(store):
    c = TestClient(create_app())
    r = c.post("/api/editor/login", json={"name": USER, "password": PW})
    assert r.status_code == 403


def test_login_is_rate_limited(store):
    c = TestClient(create_app())
    for _ in range(editor_router.MAX_FAILURES):
        assert c.post("/api/editor/login", json={"name": USER, "password": PW[::-1]}, headers=H).status_code == 401
    r = c.post("/api/editor/login", json={"name": USER, "password": PW}, headers=H)
    assert r.status_code == 429


def test_cli_add_prompts_for_the_password(db, monkeypatch, capsys):
    monkeypatch.setattr(users.UserStore, "__init__", lambda self, d=None: setattr(self, "_db", db))
    answers = iter([PW, PW])
    monkeypatch.setattr("getpass.getpass", lambda prompt="": next(answers))
    assert users._cli(["add", OTHER]) == 0
    assert users._cli(["list"]) == 0
    assert OTHER in capsys.readouterr().out
    answers = iter([PW, PW2])
    assert users._cli(["passwd", OTHER]) == 1
