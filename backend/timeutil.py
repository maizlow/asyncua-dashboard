"""Time helpers.

Conventions used throughout the backend:
- Timestamps are *stored* in SQLite as UTC text ``YYYY-MM-DD HH:MM:SS[.ffffff]``
  (the same format SQLite's ``CURRENT_TIMESTAMP`` produces, so older rows stay compatible).
- All comparisons are done on timezone-aware datetimes.
- Plant-local wall-clock times (shift start/end from the PLC) are interpreted in the
  configured ``TIMEZONE`` or, if empty, the system local timezone (DST-aware).
"""

from __future__ import annotations

from datetime import date, datetime, time, timezone, tzinfo
from zoneinfo import ZoneInfo

DB_TS_FORMAT = "%Y-%m-%d %H:%M:%S.%f"


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def to_db_ts(dt: datetime) -> str:
    """Aware datetime -> UTC text for SQLite."""
    if dt.tzinfo is None:
        raise ValueError("naive datetime passed to to_db_ts; use an aware datetime")
    return dt.astimezone(timezone.utc).strftime(DB_TS_FORMAT)


def from_db_ts(value: str) -> datetime:
    """UTC text from SQLite (with or without fraction / 'T') -> aware UTC datetime."""
    dt = datetime.fromisoformat(value.strip().replace(" ", "T"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def get_local_tz(name: str | None = None) -> tzinfo | None:
    """ZoneInfo for ``name``; None means "system local timezone" (see local_datetime)."""
    return ZoneInfo(name) if name else None


def local_datetime(d: date, t: time, tz: tzinfo | None) -> datetime:
    """Aware datetime for wall-clock time ``t`` on date ``d`` in ``tz`` (None = system local).

    Both branches are DST-aware: ZoneInfo resolves the offset for that specific date, and a
    naive ``datetime.astimezone()`` asks the OS for the local offset at that instant.
    """
    naive = datetime.combine(d, t)
    if tz is None:
        return naive.astimezone()
    return naive.replace(tzinfo=tz)


def to_local(dt: datetime, tz: tzinfo | None) -> datetime:
    return dt.astimezone(tz) if tz is not None else dt.astimezone()
