import asyncio
import threading

import pytest

from backend.app.broadcaster import Broadcaster


def run_in_foreign_loop_thread(fn):
    """Run ``fn`` inside a different thread that has its *own* running event loop
    (like the OPC UA thread)."""
    errors = []

    def target():
        loop = asyncio.new_event_loop()

        async def body():
            fn()

        try:
            loop.run_until_complete(body())
        except Exception as e:  # pragma: no cover - surfaced below
            errors.append(e)
        finally:
            loop.close()

    t = threading.Thread(target=target, name="fake-opc-thread")
    t.start()
    t.join(10)
    assert not errors, errors


async def test_cross_thread_publish_is_delivered_in_order_on_the_owner_loop():
    owner_loop = asyncio.get_running_loop()
    received = []
    wrong_loop = []

    async def send(msg):
        if asyncio.get_running_loop() is not owner_loop:
            wrong_loop.append(msg)
        await asyncio.sleep(0)  # yield, as a real socket send would
        received.append(msg["n"])

    b = Broadcaster(send)
    await b.start()

    def publish_many():
        for n in range(2000):
            b.publish({"type": "data_update", "n": n})

    await asyncio.to_thread(run_in_foreign_loop_thread, publish_many)
    await asyncio.wait_for(b.wait_idle(), 5)

    assert received == list(range(2000))
    assert wrong_loop == []
    await b.stop()


async def test_messages_published_before_start_are_flushed():
    received = []

    async def send(msg):
        received.append(msg["n"])

    b = Broadcaster(send)
    for n in range(5):
        b.publish({"type": "x", "n": n})
    await b.start()
    await asyncio.wait_for(b.wait_idle(), 5)
    assert received == [0, 1, 2, 3, 4]
    await b.stop()


async def test_send_errors_do_not_stop_the_consumer():
    received = []

    async def send(msg):
        if msg["n"] == 1:
            raise RuntimeError("socket died")
        received.append(msg["n"])

    b = Broadcaster(send)
    await b.start()
    for n in range(3):
        b.publish({"type": "x", "n": n})
    await asyncio.wait_for(b.wait_idle(), 5)
    assert received == [0, 2]
    await b.stop()


def test_publish_after_loop_closed_does_not_raise():
    async def send(msg):
        pass

    b = Broadcaster(send)
    loop = asyncio.new_event_loop()
    loop.run_until_complete(b.start())
    b._task.cancel()
    loop.run_until_complete(asyncio.sleep(0))
    loop.close()  # simulate uvicorn shutting down without stop()
    b.publish({"type": "x"})  # must not raise


async def test_store_setters_from_opc_thread_reach_websocket_loop(monkeypatch):
    """DataStore/GeneralStore/AlarmStore changes fired on a foreign loop are broadcast on ours."""
    from backend.app import main as app_main
    from backend.opc import state_store

    owner_loop = asyncio.get_running_loop()
    received = []

    async def send(msg):
        assert asyncio.get_running_loop() is owner_loop
        received.append(msg)

    b = Broadcaster(send)
    monkeypatch.setattr(state_store, "broadcaster", b)
    monkeypatch.setattr(app_main, "broadcaster", b)
    monkeypatch.setattr(state_store.data_logger, "log_value", lambda *a, **k: None)

    data_store = state_store.DataStore()
    general_store = state_store.GeneralStore()
    alarm_store = state_store.AlarmStore()
    monkeypatch.setattr(app_main, "data_store", data_store)
    monkeypatch.setattr(app_main, "alarm_store", alarm_store)
    monkeypatch.setattr(app_main.shift_logger, "log_state_change", lambda *a, **k: None)
    app_main.wire_store_callbacks()
    await b.start()

    def opc_side():
        data_store.set("OEE", 88.5)
        general_store.set("RequestedScreenNr", 3)
        alarm_store.add("5", {"ID": 5, "message": "Jam"})
        alarm_store.remove(5)

    await asyncio.to_thread(run_in_foreign_loop_thread, opc_side)
    await asyncio.wait_for(b.wait_idle(), 5)

    assert [m["type"] for m in received] == ["data_update", "screen_change", "alarm_added", "alarm_removed"]
    assert received[0] == {"type": "data_update", "key": "OEE", "value": 88.5}
    assert received[1] == {"type": "screen_change", "screen": 3}
    await b.stop()


@pytest.mark.parametrize("n_clients", [0, 2])
async def test_broadcast_sends_to_all_connections(monkeypatch, n_clients):
    from backend.app.routers import websocket as ws

    class FakeSocket:
        def __init__(self):
            self.sent = []

        async def send_json(self, data):
            self.sent.append(data)

    sockets = [FakeSocket() for _ in range(n_clients)]
    monkeypatch.setattr(ws, "active_connections", list(sockets))
    await ws.broadcast({"type": "data_update", "key": "OEE", "value": 1})
    assert all(s.sent == [{"type": "data_update", "key": "OEE", "value": 1}] for s in sockets)
