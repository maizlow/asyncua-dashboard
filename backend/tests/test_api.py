from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_general_store_is_read_only():
    client = TestClient(create_app())
    assert client.post("/api/general", json={"key": "ActiveScreenNr", "value": 3}).status_code == 405
    assert client.get("/api/general").status_code == 200


def test_highscores_and_shifts_endpoints(db, monkeypatch):
    import asyncio

    import backend.opc.highscore as hs
    import backend.opc.shifts as shifts
    from backend.opc.shift_logger import ShiftLogger

    store = hs.RunStore(db)
    sstore = shifts.ShiftStore(db)
    asyncio.run(store.init_db())
    asyncio.run(sstore.init_db())
    tracker = hs.RunTracker(store, 0)
    monkeypatch.setattr(hs, "get_run_tracker", lambda: tracker)
    monkeypatch.setattr(shifts, "get_shift_store", lambda: sstore)
    monkeypatch.setattr(shifts, "get_shift_tracker", lambda: shifts.ShiftTracker(sstore, ShiftLogger(db, "Europe/Stockholm")))
    client = TestClient(create_app())
    r = client.get("/api/highscores?n=5")
    assert r.status_code == 200 and r.json()["records"] == [] and r.json()["current"] is None
    r = client.get("/api/shifts")
    assert r.status_code == 200 and r.json() == {"shifts": [], "pending": None}
