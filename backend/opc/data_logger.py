"""Persistent append-only history of data tag values (used for sparklines)."""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timedelta
from typing import Any

from backend.opc.database import Database, default_database
from backend.timeutil import from_db_ts, to_db_ts, utcnow

logger = logging.getLogger(__name__)

_INSERT_SQL = "INSERT INTO data_points (timestamp, tag, value) VALUES (?, ?, ?)"


class DataLogger:
    def __init__(self, db: Database | None = None):
        self._db = db

    @property
    def db(self) -> Database:
        if self._db is None:
            self._db = default_database()
        return self._db

    async def init_db(self) -> None:
        """Create table and indexes if they do not exist."""

        def _init(conn: sqlite3.Connection) -> None:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS data_points (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    tag TEXT NOT NULL,
                    value TEXT NOT NULL
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_data_points_tag_time ON data_points (tag, timestamp)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_data_points_time ON data_points (timestamp)")

        await self.db.run_async(_init)
        logger.info("Data logger database initialized")

    def log_value(self, tag: str, value: Any, ts: datetime | None = None) -> None:
        """Queue a value for the given tag (UTC timestamp). Non-blocking, thread-safe."""
        if value is None:
            return
        self.db.enqueue_insert(_INSERT_SQL, (to_db_ts(ts or utcnow()), tag, str(value)))

    def _newest(self, conn: sqlite3.Connection, tag: str, limit: int) -> list[tuple[str, str]]:
        # Newest N rows, returned oldest-first (chronological) for charts
        rows = conn.execute(
            """
            SELECT timestamp, value FROM data_points
            WHERE tag = ?
            ORDER BY timestamp DESC, id DESC
            LIMIT ?
            """,
            (tag, limit),
        ).fetchall()
        rows.reverse()
        return rows

    async def get_history_values(self, tag: str, limit: int = 150) -> list[Any]:
        """The most recent ``limit`` values for a tag, in chronological order."""
        try:
            rows = await self.db.run_async(lambda conn: self._newest(conn, tag, limit))
        except Exception:
            logger.exception("get_history_values failed for %s", tag)
            return []
        return [self._coerce_value(v) for _, v in rows]

    async def get_history_points(self, tag: str, limit: int = 150) -> list[dict]:
        """The most recent ``limit`` points with ISO-8601 UTC timestamps, chronological."""
        try:
            rows = await self.db.run_async(lambda conn: self._newest(conn, tag, limit))
        except Exception:
            logger.exception("get_history_points failed for %s", tag)
            return []
        return [{"timestamp": from_db_ts(ts).isoformat(), "value": self._coerce_value(v)} for ts, v in rows]

    async def purge_older_than(self, days: int, now: datetime | None = None) -> int:
        """Delete data_points older than ``days``. Returns the number of rows removed."""
        if days <= 0:
            return 0
        cutoff = to_db_ts((now or utcnow()) - timedelta(days=days))

        def _purge(conn: sqlite3.Connection) -> int:
            return conn.execute("DELETE FROM data_points WHERE timestamp < ?", (cutoff,)).rowcount

        removed = await self.db.run_async(_purge)
        if removed:
            logger.info("Retention: removed %d data_points older than %d days", removed, days)
        return removed

    @staticmethod
    def _coerce_value(raw: str) -> Any:
        """Best-effort conversion back to int/float when possible."""
        if raw is None:
            return None
        try:
            if "." not in raw and "e" not in raw.lower():
                return int(raw)
        except ValueError:
            pass
        try:
            return float(raw)
        except ValueError:
            pass
        return raw  # e.g. Time_Of_Day strings


# Global instance
data_logger = DataLogger()
