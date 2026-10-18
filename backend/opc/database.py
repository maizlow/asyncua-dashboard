"""Single-writer SQLite access.

All SQLite work runs on one dedicated thread with one long-lived connection:
- ``enqueue_insert`` is non-blocking and thread-safe (callable from the OPC thread,
  the uvicorn loop, or anywhere). Inserts are batched with ``executemany``.
- ``run`` executes an arbitrary function against the connection on the DB thread and
  returns a ``concurrent.futures.Future``; ``run_async`` awaits it from any event loop.

This avoids opening a new connection per value change and avoids binding a connection
to a particular asyncio loop.
"""

from __future__ import annotations

import asyncio
import logging
import queue
import sqlite3
import threading
from collections.abc import Callable
from concurrent.futures import Future
from typing import TypeVar

logger = logging.getLogger(__name__)

T = TypeVar("T")

_BATCH_MAX = 500
_STOP = object()


class Database:
    def __init__(self, path: str):
        self.path = path
        self._queue: queue.Queue = queue.Queue()
        self._thread: threading.Thread | None = None
        self._start_lock = threading.Lock()

    # ------------------------------------------------------------------ lifecycle
    def _ensure_started(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        with self._start_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._worker, name="SQLite_Writer", daemon=True)
            self._thread.start()

    def close(self, timeout: float = 5.0) -> None:
        """Flush pending work and stop the DB thread."""
        if self._thread is None:
            return
        self._queue.put(_STOP)
        self._thread.join(timeout)
        self._thread = None

    # ------------------------------------------------------------------ API
    def enqueue_insert(self, sql: str, params: tuple) -> None:
        """Queue a write; returns immediately. Consecutive identical statements are batched."""
        self._ensure_started()
        self._queue.put(("insert", sql, params))

    def run(self, fn: Callable[[sqlite3.Connection], T]) -> Future[T]:
        """Run ``fn(conn)`` on the DB thread after all previously queued work."""
        self._ensure_started()
        fut: Future[T] = Future()
        self._queue.put(("call", fn, fut))
        return fut

    async def run_async(self, fn: Callable[[sqlite3.Connection], T]) -> T:
        return await asyncio.wrap_future(self.run(fn))

    def flush(self, timeout: float = 5.0) -> None:
        """Block until everything queued so far has been written (used by tests/shutdown)."""
        self.run(lambda conn: None).result(timeout)

    # ------------------------------------------------------------------ worker
    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.path, check_same_thread=False)
        try:
            conn.execute("PRAGMA journal_mode=WAL")
        except sqlite3.DatabaseError:  # e.g. :memory: or unsupported FS; not critical
            pass
        conn.execute("PRAGMA synchronous=NORMAL")
        return conn

    def _worker(self) -> None:
        conn = self._connect()
        try:
            while True:
                item = self._queue.get()
                if item is _STOP:
                    return
                batch = [item]
                # Drain whatever else is already waiting so inserts can be batched
                while len(batch) < _BATCH_MAX:
                    try:
                        nxt = self._queue.get_nowait()
                    except queue.Empty:
                        break
                    batch.append(nxt)
                stop = self._process(conn, batch)
                if stop:
                    return
        finally:
            conn.close()

    def _process(self, conn: sqlite3.Connection, batch: list) -> bool:
        stop = False
        i = 0
        while i < len(batch):
            item = batch[i]
            if item is _STOP:
                stop = True
                i += 1
                continue
            kind = item[0]
            if kind == "insert":
                sql = item[1]
                params = [item[2]]
                i += 1
                while i < len(batch) and batch[i] is not _STOP and batch[i][0] == "insert" and batch[i][1] == sql:
                    params.append(batch[i][2])
                    i += 1
                try:
                    conn.executemany(sql, params)
                    conn.commit()
                except Exception:
                    # Non-critical path: losing history points must not kill the writer
                    logger.exception("SQLite batch insert failed (%d rows dropped)", len(params))
                    conn.rollback()
            else:
                _, fn, fut = item
                i += 1
                if not fut.set_running_or_notify_cancel():
                    continue
                try:
                    result = fn(conn)
                    conn.commit()
                    fut.set_result(result)
                except BaseException as e:  # propagate to the caller
                    conn.rollback()
                    fut.set_exception(e)
        return stop


_default: Database | None = None
_default_lock = threading.Lock()


def default_database() -> Database:
    """Process-wide Database for ``settings.db_path`` (created lazily)."""
    global _default
    if _default is None:
        with _default_lock:
            if _default is None:
                from backend.settings import settings

                _default = Database(settings.db_path)
    return _default
