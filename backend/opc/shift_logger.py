"""Running/stopped state log and per-hour shift pattern.

Timestamps are stored in UTC; shift start/end from the PLC are plant-local wall-clock
times, resolved in the configured TIMEZONE (or system local), DST-aware.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import date, datetime, time, timedelta, timezone, tzinfo

from backend.opc.database import Database, default_database
from backend.timeutil import from_db_ts, get_local_tz, local_datetime, to_db_ts, to_local, utcnow

logger = logging.getLogger(__name__)


def parse_time_of_day(value: str) -> time:
    """Parse 'HH:MM:SS' or 'HH:MM' into a time object."""
    if not value:
        raise ValueError("empty time of day")
    parts = [int(p) for p in str(value).strip().split(":")]
    h = parts[0]
    m = parts[1] if len(parts) > 1 else 0
    s = parts[2] if len(parts) > 2 else 0
    return time(h % 24, m, s)


def resolve_shift_window(
    start_t: time, end_t: time, now: datetime, tz: tzinfo | None
) -> tuple[datetime, datetime]:
    """Return the (start, end) of the current shift as aware datetimes.

    The current shift is the most recent one that has started at ``now``: for a 22:00-06:00
    shift, 23:00 -> today 22:00..tomorrow 06:00 and 02:00 -> yesterday 22:00..today 06:00.
    Between shifts (e.g. 10:00 for 22:00-06:00) the last, completed shift is returned.
    ``end <= start`` means the shift crosses midnight. Durations are real elapsed time, so a
    shift spanning a DST change is 1 h shorter/longer.
    """
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    local_now = to_local(now, tz)
    today: date = local_now.date()

    start_dt = None
    for day in (today, today - timedelta(days=1)):
        candidate = local_datetime(day, start_t, tz)
        if candidate <= now:
            start_dt = candidate
            break
    if start_dt is None:  # only possible with odd DST edge cases; fall back two days
        start_dt = local_datetime(today - timedelta(days=2), start_t, tz)

    start_day = to_local(start_dt, tz).date()
    end_day = start_day if end_t > start_t else start_day + timedelta(days=1)
    end_dt = local_datetime(end_day, end_t, tz)
    return start_dt, end_dt


def hour_buckets(start: datetime, end: datetime, tz: tzinfo | None) -> list[dict]:
    """Hourly buckets on local clock hours covering [start, end), stepped in UTC.

    Each bucket: {"start", "end" (aware UTC), "time" ("HH:00" local)}. DST-safe: a
    fall-back night simply has two "02:00" buckets.
    """
    first = to_local(start, tz).replace(minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    end_utc = end.astimezone(timezone.utc)
    buckets = []
    b = first
    while b < end_utc:
        buckets.append({"start": b, "end": b + timedelta(hours=1), "time": to_local(b, tz).strftime("%H:00")})
        b += timedelta(hours=1)
    return buckets


class ShiftLogger:
    def __init__(self, db: Database | None = None, tz_name: str | None = None):
        self._db = db
        self._tz_name = tz_name

    @property
    def db(self) -> Database:
        if self._db is None:
            self._db = default_database()
        return self._db

    @property
    def tz(self) -> tzinfo | None:
        if self._tz_name is None:
            from backend.settings import settings

            self._tz_name = settings.timezone
        return get_local_tz(self._tz_name)

    async def init_db(self) -> None:
        def _init(conn: sqlite3.Connection) -> None:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS shift_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    state TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_shift_log_time ON shift_log (timestamp)")

        await self.db.run_async(_init)
        logger.info("Shift logger database initialized")

    def log_state_change(self, state: str, ts: datetime | None = None) -> None:
        """Queue a state change ('Running' / 'Stopped'). Non-blocking, thread-safe."""
        self.db.enqueue_insert(
            "INSERT INTO shift_log (timestamp, state) VALUES (?, ?)", (to_db_ts(ts or utcnow()), state)
        )

    async def get_state_segments(
        self, start: datetime, end: datetime, now: datetime | None = None
    ) -> list[tuple[datetime, datetime, str]]:
        """(from, to, state) segments in UTC, clipped to [start, min(end, now)].

        The last state logged before ``start`` applies from ``start``. Adjacent segments
        with the same state are merged (the PLC may report the same state repeatedly,
        e.g. after a reconnect).
        """
        if start.tzinfo is None or end.tzinfo is None:
            raise ValueError("start/end must be timezone-aware")
        now = now or utcnow()
        start_s, end_s = to_db_ts(start), to_db_ts(end)

        def _query(conn: sqlite3.Connection):
            before = conn.execute(
                "SELECT timestamp, state FROM shift_log WHERE timestamp < ? ORDER BY timestamp DESC, id DESC LIMIT 1",
                (start_s,),
            ).fetchone()
            rows = conn.execute(
                "SELECT timestamp, state FROM shift_log WHERE timestamp >= ? AND timestamp <= ? "
                "ORDER BY timestamp ASC, id ASC",
                (start_s, end_s),
            ).fetchall()
            return before, rows

        before, rows = await self.db.run_async(_query)

        start_utc = start.astimezone(timezone.utc)
        horizon = min(end, now).astimezone(timezone.utc)
        points: list[tuple[datetime, str]] = []
        if before:
            points.append((start_utc, before[1]))
        for ts, state in rows:
            try:
                points.append((from_db_ts(ts), state))
            except ValueError:
                logger.warning("Skipping shift_log row with bad timestamp %r", ts)

        segments: list[tuple[datetime, datetime, str]] = []
        for i, (t0, state) in enumerate(points):
            t1 = points[i + 1][0] if i + 1 < len(points) else horizon
            seg_start, seg_end = max(t0, start_utc), min(t1, horizon)
            if seg_start >= seg_end:
                continue
            if segments and segments[-1][2] == state and segments[-1][1] == seg_start:
                segments[-1] = (segments[-1][0], seg_end, state)
            else:
                segments.append((seg_start, seg_end, state))
        return segments

    async def get_shift_pattern(
        self, start: datetime, end: datetime, now: datetime | None = None
    ) -> list[dict]:
        """Running vs stopped minutes per local clock hour between ``start`` and ``end``.

        Rows are returned in chronological order. Time after ``now`` is not counted.
        """
        segments = await self.get_state_segments(start, end, now)
        buckets = [{**b, "running": 0.0, "stopped": 0.0} for b in hour_buckets(start, end, self.tz)]
        for seg_start, seg_end, state in segments:
            field = "running" if state == "Running" else "stopped"
            for bucket in buckets:
                overlap = (min(seg_end, bucket["end"]) - max(seg_start, bucket["start"])).total_seconds()
                if overlap > 0:
                    bucket[field] += overlap / 60.0

        result = [
            {"time": bk["time"], "running": round(bk["running"], 1), "stopped": round(bk["stopped"], 1)}
            for bk in buckets
        ]
        logger.debug("Shift pattern %s -> %s: %s", start, end, result)
        return result

    async def get_current_shift_window(self, now: datetime | None = None) -> tuple[datetime, datetime]:
        """(start, end) of the current shift from the live PLC ShiftStart/ShiftEnd values.

        Raises RuntimeError if the PLC values are missing or invalid (no silent fallback).
        """
        from backend.opc.state_store import data_store

        start_str = data_store.get("ShiftStart")
        end_str = data_store.get("ShiftEnd")
        if not start_str or not end_str:
            raise RuntimeError(
                f"ShiftStart or ShiftEnd not available in data_store. ShiftStart={start_str!r}, ShiftEnd={end_str!r}"
            )
        try:
            start_t = parse_time_of_day(start_str)
            end_t = parse_time_of_day(end_str)
        except Exception as e:
            raise RuntimeError(f"Failed to parse ShiftStart={start_str!r} / ShiftEnd={end_str!r}: {e}") from e

        start_dt, end_dt = resolve_shift_window(start_t, end_t, now or utcnow(), self.tz)
        logger.debug("Shift window %s -> %s", start_dt.isoformat(), end_dt.isoformat())
        return start_dt, end_dt


# Global instance
shift_logger = ShiftLogger()
