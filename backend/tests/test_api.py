from fastapi.testclient import TestClient

from backend.app.main import create_app


def test_general_store_is_read_only():
    client = TestClient(create_app())
    assert client.post("/api/general", json={"key": "ActiveScreenNr", "value": 3}).status_code == 405
    assert client.get("/api/general").status_code == 200
