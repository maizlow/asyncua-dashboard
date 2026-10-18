"""Thread-safe bridge from any thread / event loop to the uvicorn event loop.

WebSocket objects belong to uvicorn's event loop. OPC UA callbacks run on the OPC
thread's own loop, so they must never await or schedule socket I/O there. Instead
they call ``Broadcaster.publish()``, which hands the message to the uvicorn loop via
``loop.call_soon_threadsafe``; a single consumer task sends messages in order.
Messages published before the loop is attached are buffered and flushed on start.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections import deque
from collections.abc import Awaitable, Callable
from typing import Any

logger = logging.getLogger(__name__)

SendFn = Callable[[dict[str, Any]], Awaitable[None]]


class Broadcaster:
    def __init__(self, send: SendFn, max_pending: int = 10_000):
        self._send = send
        self._lock = threading.Lock()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._queue: asyncio.Queue | None = None
        self._task: asyncio.Task | None = None
        self._pending: deque[dict[str, Any]] = deque(maxlen=max_pending)

    @property
    def loop(self) -> asyncio.AbstractEventLoop | None:
        return self._loop

    async def start(self) -> None:
        """Attach to the *current* running loop (call from uvicorn's lifespan)."""
        loop = asyncio.get_running_loop()
        queue: asyncio.Queue = asyncio.Queue()
        with self._lock:
            self._loop = loop
            self._queue = queue
            while self._pending:
                queue.put_nowait(self._pending.popleft())
        self._task = loop.create_task(self._run(queue), name="ws-broadcaster")
        logger.info("Broadcaster attached to event loop %r", loop)

    async def stop(self, timeout: float = 5.0) -> None:
        """Send what is already queued (up to ``timeout``), then detach from the loop."""
        with self._lock:
            queue = self._queue
            self._loop = None
            self._queue = None
        if queue is not None:
            try:
                await asyncio.wait_for(queue.join(), timeout)
            except TimeoutError:
                logger.warning("Broadcaster stop: %d messages not sent", queue.qsize())
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    def publish(self, message: dict[str, Any]) -> None:
        """Queue ``message`` for broadcast. Safe to call from any thread or loop."""
        with self._lock:
            loop, queue = self._loop, self._queue
            if loop is None or queue is None:
                if len(self._pending) == self._pending.maxlen:
                    logger.warning("Broadcaster not started; dropping oldest pending message")
                self._pending.append(message)
                return
        try:
            loop.call_soon_threadsafe(queue.put_nowait, message)
        except RuntimeError:  # loop closed during shutdown
            logger.warning("Broadcast loop is closed; message dropped: %s", message.get("type"))

    async def wait_idle(self) -> None:
        """Wait until all queued messages have been sent (for tests)."""
        await asyncio.sleep(0)  # let call_soon_threadsafe callbacks enqueue first
        if self._queue is not None:
            await self._queue.join()

    async def _run(self, queue: asyncio.Queue) -> None:
        while True:
            msg = await queue.get()
            try:
                await self._safe_send(msg)
            finally:
                queue.task_done()

    async def _safe_send(self, msg: dict[str, Any]) -> None:
        try:
            await self._send(msg)
        except Exception:
            logger.exception("Broadcast of %s failed", msg.get("type"))
