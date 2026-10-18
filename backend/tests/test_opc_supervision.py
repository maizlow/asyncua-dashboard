import asyncio
from types import SimpleNamespace

import pytest

from backend.opc import opc_data_tags
from backend.opc.opc_client import run_supervised


class FakeClient:
    def __init__(self, fail_after: int):
        self.calls = 0
        self.fail_after = fail_after

    async def create_subscription(self, period, handler):
        async def subscribe_data_change(node):
            return 1

        return SimpleNamespace(subscribe_data_change=subscribe_data_change)

    def get_node(self, nodeid):
        return SimpleNamespace(nodeid=nodeid)

    async def check_connection(self):
        self.calls += 1
        if self.calls > self.fail_after:
            raise ConnectionError("connection lost")


async def test_data_tags_keepalive_propagates_connection_errors(monkeypatch):
    real_sleep = asyncio.sleep
    monkeypatch.setattr(opc_data_tags.asyncio, "sleep", lambda s: real_sleep(0))
    with pytest.raises(ConnectionError):
        await asyncio.wait_for(opc_data_tags.subscribe_data_tags(FakeClient(fail_after=3)), 5)


async def test_data_tags_keepalive_propagates_cancellation(monkeypatch):
    task = asyncio.create_task(opc_data_tags.subscribe_data_tags(FakeClient(fail_after=10**9)))
    await asyncio.sleep(0.05)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task


async def test_supervisor_raises_and_cancels_siblings_when_one_engine_fails():
    async def forever():
        await asyncio.sleep(3600)

    async def boom():
        await asyncio.sleep(0.01)
        raise ConnectionError("dropped")

    sibling = asyncio.create_task(forever())
    tasks = {"alarms": sibling, "data_tags": asyncio.create_task(boom())}
    with pytest.raises(RuntimeError, match="data_tags"):
        await run_supervised(tasks)
    assert sibling.cancelled()


async def test_supervisor_treats_clean_exit_as_failure():
    async def done():
        return None

    with pytest.raises(RuntimeError, match="stopped unexpectedly"):
        await run_supervised({"screen": asyncio.create_task(done())})
