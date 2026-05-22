import aiosqlite
from datetime import datetime
from typing import Any, List, Dict, Optional

from backend.settings import settings

DB_PATH = settings.db_path


class DataLogger:
    """Persistent append-only logger for all data tag changes."""

    def __init__(self):
        self.db_path = DB_PATH

    async def init_db(self):
        """Create table and index if they do not exist."""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS data_points (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    tag TEXT NOT NULL,
                    value TEXT NOT NULL
                )
            """)
            await db.execute("""
                CREATE INDEX IF NOT EXISTS idx_data_points_tag_time
                ON data_points (tag, timestamp)
            """)
            await db.commit()
        print("✅ Data logger database initialized")

    async def log_value(self, tag: str, value: Any):
        """Append a new value for the given tag. Best-effort, non-blocking."""
        if value is None:
            return
        # Store everything as text; frontend already handles string vs number
        val_str = str(value)
        try:
            async with aiosqlite.connect(self.db_path) as db:
                await db.execute(
                    "INSERT INTO data_points (tag, value) VALUES (?, ?)",
                    (tag, val_str)
                )
                await db.commit()
        except Exception as e:
            # Non-critical path — missing a point is acceptable
            print(f"⚠️ DataLogger failed to write {tag}: {e}")

    async def get_history_values(self, tag: str, limit: int = 150) -> List[Any]:
        """Return the most recent N values for a tag, oldest first (for sparklines)."""
        try:
            async with aiosqlite.connect(self.db_path) as db:
                cursor = await db.execute(
                    """
                    SELECT value FROM data_points
                    WHERE tag = ?
                    ORDER BY timestamp ASC
                    LIMIT ?
                    """,
                    (tag, limit)
                )
                rows = await cursor.fetchall()
            # Try to return proper types where obvious
            result = []
            for (v,) in rows:
                result.append(self._coerce_value(v))
            return result
        except Exception as e:
            print(f"⚠️ DataLogger get_history_values failed for {tag}: {e}")
            return []

    async def get_history_points(self, tag: str, limit: int = 150) -> List[Dict]:
        """Return the most recent N points with timestamps, oldest first."""
        try:
            async with aiosqlite.connect(self.db_path) as db:
                cursor = await db.execute(
                    """
                    SELECT timestamp, value FROM data_points
                    WHERE tag = ?
                    ORDER BY timestamp ASC
                    LIMIT ?
                    """,
                    (tag, limit)
                )
                rows = await cursor.fetchall()
            result = []
            for ts, v in rows:
                result.append({
                    "timestamp": ts,
                    "value": self._coerce_value(v)
                })
            return result
        except Exception as e:
            print(f"⚠️ DataLogger get_history_points failed for {tag}: {e}")
            return []

    def _coerce_value(self, raw: str) -> Any:
        """Best-effort conversion back to int/float when possible."""
        if raw is None:
            return None
        # Try int first
        try:
            if "." not in raw and "e" not in raw.lower():
                return int(raw)
        except ValueError:
            pass
        # Try float
        try:
            return float(raw)
        except ValueError:
            pass
        # Return as string (covers Time_Of_Day formatted strings etc.)
        return raw


# Global instance
data_logger = DataLogger()