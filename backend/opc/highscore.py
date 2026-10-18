"""Run-time highscores (screen type ``highscore``): the longest continuous runs without a stop.

A **run** is a period where ProductionState == 2 (Running) without interruption. A stop shorter than
HIGHSCORE_MIN_STOP_S is bridged (the run continues and the short stop counts as part of the run's
wall-clock duration); with the default 0 every stop ends the run. The run ends when the stop began.

Runs are tracked live from the ProductionState changes (exact timestamps, so a sub-second stop is
seen) and persisted in the table ``run_records`` (never purged by RETENTION_DAYS). The ongoing run
is written every HEARTBEAT_S with its last confirmed running time; after a backend restart, or when
the OPC connection is lost, the run is closed at that last confirmed time (it is not extended through
time the backend could not see). History from before the feature existed is not back-filled because
shift_log cannot tell backend downtime from running.

Team = ShiftTeam at the start of the run; a run that spans a shift change with another team is
shown as "A→B". Ties: the earlier run ranks first.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from typing import Any

from backend.timeutil import from_db_ts, to_db_ts, utcnow

logger = logging.getLogger(__name__)

HEARTBEAT_S = 5
TOP_N = 5


def team_label(start_team: Any, end_team: Any) -> str | None:
    a = None if start_team in (None, "") else str(start_team).strip()
    b = None if end_team in (None, "") else str(end_team).strip()
    if a and b and a != b:
        return f"{a}→{b}"
    return a or b


class RunStore:
    def __init__(self, db=None):
        self._db = db

    @property
    def db(self):
        if self._db is None:
            from backend.opc.database import default_database

            self._db = default_database()
        return self._db

    async def init_db(self) -> None:
        def _init(conn):
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS run_records (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    start_ts TEXT NOT NULL,
                    end_ts TEXT NOT NULL,
                    duration_s REAL NOT NULL,
                    team_start TEXT,
                    team_end TEXT,
                    status TEXT NOT NULL DEFAULT 'open'
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_run_records_duration ON run_records (status, duration_s)")

        await self.db.run_async(_init)

    @staticmethod
    def _row(rec) -> dict:
        rid, start, end, dur, ts, te, status = rec
        return {"id": rid, "start": from_db_ts(start), "end": from_db_ts(end), "duration_s": dur,
                "team_start": ts, "team_end": te, "status": status}

    async def save(self, r: dict) -> None:
        vals = (to_db_ts(r["start"]), to_db_ts(r["end"]), (r["end"] - r["start"]).total_seconds(),
                r.get("team_start"), r.get("team_end"), r["status"])

        def _q(conn):
            if r.get("id"):
                conn.execute(
                    "UPDATE run_records SET start_ts=?, end_ts=?, duration_s=?, team_start=?, team_end=?, status=? WHERE id=?",
                    (*vals, r["id"]),
                )
                return r["id"]
            return conn.execute(
                "INSERT INTO run_records (start_ts, end_ts, duration_s, team_start, team_end, status) VALUES (?,?,?,?,?,?)",
                vals,
            ).lastrowid

        r["id"] = await self.db.run_async(_q)

    async def open_runs(self) -> list[dict]:
        rows = await self.db.run_async(lambda c: c.execute(
            "SELECT id, start_ts, end_ts, duration_s, team_start, team_end, status FROM run_records WHERE status='open'"
        ).fetchall())
        return [self._row(r) for r in rows]

    async def top(self, n: int = TOP_N) -> list[dict]:
        rows = await self.db.run_async(lambda c: c.execute(
            "SELECT id, start_ts, end_ts, duration_s, team_start, team_end, status FROM run_records "
            "WHERE status='closed' AND duration_s > 0 ORDER BY duration_s DESC, start_ts ASC LIMIT ?",
            (int(n),),
        ).fetchall())
        return [self._row(r) for r in rows]


class RunTracker:
    """``on_state`` (any thread) queues ProductionState changes; ``tick`` (event loop) applies them."""

    def __init__(self, store: RunStore, min_stop_s: float = 0.0):
        self.store = store
        self.min_stop = timedelta(seconds=max(0.0, min_stop_s))
        self._lock = threading.Lock()
        self._events: list[tuple[datetime, bool]] = []
        self.run: dict | None = None  # {"start", "end" (last confirmed running), "team_start", "team_end", "id"}
        self.stop_since: datetime | None = None
        self.loaded = False
        self._last_save: datetime | None = None
        self.version = 0  # bumped whenever the record list may have changed
        self.latest: dict | None = None  # last pushed result (sent to new WebSocket clients)

    def on_state(self, running: bool, ts: datetime | None = None) -> None:
        with self._lock:
            self._events.append((ts or utcnow(), bool(running)))

    async def load(self) -> None:
        """Close runs left open by a previous process at their last confirmed running time."""
        for r in await self.store.open_runs():
            r["status"] = "closed"
            await self.store.save(r)
            logger.info("Run %s closed after restart at %s (%.0f s)", r["id"], r["end"].isoformat(), r["duration_s"])
            self.version += 1
        self.loaded = True

    async def _close(self, end: datetime) -> None:
        r = self.run
        self.run, self.stop_since = None, None
        if r is None:
            return
        r["end"] = max(r["start"], end)
        r["status"] = "closed"
        await self.store.save(r)
        self.version += 1

    async def tick(self, now: datetime | None = None, *, connected: bool = True, team: Any = None) -> None:
        now = now or utcnow()
        if not self.loaded:
            await self.load()
        with self._lock:
            events, self._events = sorted(self._events, key=lambda e: e[0]), []
        for ts, running in events:
            if running:
                if self.run is not None and self.stop_since is not None:
                    if ts - self.stop_since < self.min_stop:
                        self.stop_since = None  # short stop bridged
                    else:
                        await self._close(self.stop_since)
                if self.run is None:
                    self.run = {"id": None, "start": ts, "end": ts, "team_start": team, "team_end": team, "status": "open"}
                    await self.store.save(self.run)
                    self._last_save = now
                self.run["end"] = max(self.run["end"], ts)
            elif self.run is not None and self.stop_since is None:
                self.stop_since = ts
                if self.min_stop.total_seconds() == 0:
                    await self._close(ts)
        if self.run is None:
            return
        if not connected:
            await self._close(self.stop_since or self.run["end"])
            return
        if self.stop_since is not None:
            if now - self.stop_since >= self.min_stop:
                await self._close(self.stop_since)
            return
        self.run["end"] = max(self.run["end"], now)
        self.run["team_end"] = team if team not in (None, "") else self.run["team_end"]
        if self._last_save is None or (now - self._last_save).total_seconds() >= HEARTBEAT_S:
            await self.store.save(self.run)
            self._last_save = now

    def current(self, now: datetime | None = None) -> dict | None:
        """The ongoing run (a bridged short stop still counts as running)."""
        r = self.run
        if r is None:
            return None
        now = now or utcnow()
        end = now if self.stop_since is None else max(r["end"], now)
        return {"start": r["start"], "duration_s": (end - r["start"]).total_seconds(),
                "team": team_label(r["team_start"], r["team_end"]), "running": self.stop_since is None}


async def compute_highscores(tracker: RunTracker, shift_start: datetime | None, n: int = TOP_N,
                             now: datetime | None = None) -> dict:
    """Top ``n`` completed runs plus the ongoing one; ``current_shift`` marks runs started in this shift."""
    now = now or utcnow()
    rows = await tracker.store.top(n)
    cur = tracker.current(now)

    def _json(r):
        return {
            "start": r["start"].isoformat(),
            "end": r["end"].isoformat(),
            "duration_s": round(r["duration_s"], 1),
            "team": team_label(r["team_start"], r["team_end"]),
            "current_shift": bool(shift_start and r["start"] >= shift_start),
        }

    return {
        "records": [_json(r) for r in rows],
        "current": {**cur, "start": cur["start"].isoformat(), "duration_s": round(cur["duration_s"], 1),
                    "current_shift": bool(shift_start and cur["start"] >= shift_start)} if cur else None,
        "shift_start": shift_start.isoformat() if shift_start else None,
        "min_stop_s": tracker.min_stop.total_seconds(),
        "updated": now.isoformat(),
    }


async def current_shift_start() -> datetime | None:
    """Start of the current shift (highlight): the shift log's open row, else the live PLC shift window."""
    from backend.opc.shift_logger import shift_logger
    from backend.opc.shifts import get_shift_tracker

    open_row = get_shift_tracker().open
    if open_row is not None:
        return open_row["opened"]
    try:
        start, _end = await shift_logger.get_current_shift_window()
        return start
    except RuntimeError:
        return None


_store: RunStore | None = None
_tracker: RunTracker | None = None


def get_run_store() -> RunStore:
    global _store
    if _store is None:
        _store = RunStore()
    return _store


def get_run_tracker() -> RunTracker:
    global _tracker
    if _tracker is None:
        from backend.settings import settings

        _tracker = RunTracker(get_run_store(), settings.highscore_min_stop_s)
    return _tracker
