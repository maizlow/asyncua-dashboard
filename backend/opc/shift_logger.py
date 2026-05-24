import aiosqlite
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict

from backend.settings import settings

DB_PATH = settings.db_path

class ShiftLogger:
    def __init__(self):
        self.db_path = DB_PATH

    async def init_db(self):
        """Create the table if it doesn't exist"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS shift_log (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                    state TEXT NOT NULL
                )
            """)
            await db.commit()
        print("✅ Shift logger database initialized")

    async def log_state_change(self, state: str):
        """Log a state change (Running or Stopped)"""
        async with aiosqlite.connect(self.db_path) as db:
            await db.execute(
                "INSERT INTO shift_log (state) VALUES (?)",
                (state,)
            )
            await db.commit()

    async def get_shift_pattern(self, startTime: datetime, endTime: datetime) -> List[Dict]:
        """
        Calculate running vs stopped minutes per hour between two datetimes.
        Robust version that does timestamp filtering in Python to avoid format issues.
        """
        async with aiosqlite.connect(self.db_path) as db:
                        # Get the last known state *before* the shift started
            start_str_for_query = startTime.strftime("%Y-%m-%d %H:%M:%S")
            cursor = await db.execute("""
                SELECT timestamp, state FROM shift_log 
                WHERE timestamp < ?
                ORDER BY timestamp DESC LIMIT 1
            """, (start_str_for_query,))
            last_before_row = await cursor.fetchone()

            # Only fetch rows from the start of the requested window onward.
            # This avoids loading the entire history as the table grows.
            start_str = startTime.strftime("%Y-%m-%d %H:%M:%S")

            cursor = await db.execute("""
                SELECT timestamp, state FROM shift_log 
                WHERE timestamp >= ?
                ORDER BY timestamp ASC
            """, (start_str,))
            all_rows = await cursor.fetchall()

        print(f"\n[ShiftLogger] get_shift_pattern(startTime={startTime}, endTime={endTime})")
        print(f"[ShiftLogger] Total rows in DB: {len(all_rows)}")

        # Parse timestamps and filter rows inside the requested window
        rows_in_window = []
        for ts_str, state in all_rows:
            try:
                ts_clean = ts_str.replace(' ', 'T').split('.')[0]
                ts = datetime.fromisoformat(ts_clean)
                if startTime <= ts <= endTime:
                    rows_in_window.append((ts, state))
            except Exception:
                continue

        print(f"[ShiftLogger] Rows inside window: {len(rows_in_window)}")

        # Build timeline points
        points: List[tuple] = []
        if last_before_row:
            try:
                ts_clean = last_before_row[0].replace(' ', 'T').split('.')[0]
                ts = datetime.fromisoformat(ts_clean)
                if ts < startTime:
                    points.append((ts, last_before_row[1]))
            except Exception:
                pass

        points.extend(rows_in_window)

        # Final point at endTime with last known state
        if points:
            final_state = points[-1][1]
        else:
            final_state = "Stopped"

        points.append((endTime, final_state))

        print(f"[ShiftLogger] Timeline points: {len(points)}")
        for p in points[-6:]:
            print(f"    {p[0].isoformat()} -> {p[1]}")

                # Build hourly buckets covering the *full* shift duration.
        # We always want one row per hour (e.g. 12 rows for a 06:00-18:00 shift).
        hourly_data: dict[str, dict] = {}
        bucket_time = startTime.replace(minute=0, second=0, microsecond=0)

        while bucket_time < endTime:
            key = bucket_time.strftime("%H:00")
            hourly_data[key] = {"running": 0.0, "stopped": 0.0}
            bucket_time += timedelta(hours=1)

        # Distribute time across the hourly buckets
        for i in range(len(points) - 1):
            t0, state = points[i]
            t1 = points[i + 1][0]

            seg_start = max(t0, startTime)
            seg_end = min(t1, endTime)

            if seg_start >= seg_end:
                continue

            current = seg_start
            while current < seg_end:
                hour_key = current.strftime("%H:00")
                if hour_key not in hourly_data:
                    break

                hour_end = current.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
                next_boundary = min(seg_end, hour_end)

                minutes = (next_boundary - current).total_seconds() / 60.0

                if state == "Running":
                    hourly_data[hour_key]["running"] += minutes
                else:
                    hourly_data[hour_key]["stopped"] += minutes

                current = next_boundary

        # Build result list (sorted by hour)
        result: List[Dict] = []
        for hour_key in sorted(hourly_data.keys()):
            data = hourly_data[hour_key]
            result.append({
                "time": hour_key,
                "running": round(data["running"], 1),
                "stopped": round(data["stopped"], 1)
            })

        print("[ShiftLogger] Final result:")
        for r in result:
            print(f"    {r}")
        
        print("[ShiftLogger] Total running:", sum(r["running"] for r in result), "stopped:", sum(r["stopped"] for r in result))

        return result

    def _parse_time_of_day(self, value: str):
        """Parse 'HH:MM:SS' (or 'HH:MM') into a time object."""
        from datetime import time as dt_time
        if not value:
            return dt_time(0, 0, 0)
        parts = value.split(":")
        h = int(parts[0])
        m = int(parts[1]) if len(parts) > 1 else 0
        s = int(parts[2]) if len(parts) > 2 else 0
        return dt_time(h, m, s)

    async def get_current_shift_window(self):
        """
        Returns (startTime, endTime) as datetimes based on the live
        ShiftStart and ShiftEnd values coming from the PLC.

        Raises RuntimeError if the PLC values are missing or invalid.
        No silent fallback is performed.
        """
        from backend.opc.state_store import data_store
        from datetime import datetime, timedelta

        now = datetime.now()
        today = now.date()

        start_str = data_store.get("ShiftStart")
        end_str = data_store.get("ShiftEnd")

        print(f"[ShiftLogger] get_current_shift_window() -> ShiftStart='{start_str}', ShiftEnd='{end_str}'")

        if not start_str or not end_str:
            raise RuntimeError(
                f"ShiftStart or ShiftEnd not available in data_store. "
                f"ShiftStart='{start_str}', ShiftEnd='{end_str}'"
            )

        try:
            start_t = self._parse_time_of_day(start_str)
            end_t = self._parse_time_of_day(end_str)

            start_dt = datetime.combine(today, start_t)
            end_dt = datetime.combine(today, end_t)

            if end_dt <= start_dt:
                # Overnight shift (e.g. 22:00 → 06:00 next day)
                end_dt += timedelta(days=1)

            print(f"[ShiftLogger] Using PLC shift window: {start_dt.strftime('%H:%M')} → {end_dt.strftime('%H:%M')} (overnight={end_dt.date() > start_dt.date()})")
            return start_dt, end_dt

        except Exception as e:
            raise RuntimeError(
                f"Failed to parse ShiftStart/ShiftEnd. ShiftStart='{start_str}', ShiftEnd='{end_str}'. Error: {e}"
            ) from e


# Global instance
shift_logger = ShiftLogger()
