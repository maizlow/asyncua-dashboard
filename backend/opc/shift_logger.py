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

    async def get_shift_pattern(self, hours: int = 12) -> List[Dict]:
        """
        Calculate running vs stopped minutes per hour for the last X hours.
        Robust version that does timestamp filtering in Python to avoid format issues.
        """
        async with aiosqlite.connect(self.db_path) as db:
            now = datetime.now()
            start_time = now - timedelta(hours=hours)

            # Get the last known state before the window
            cursor = await db.execute("""
                SELECT timestamp, state FROM shift_log 
                ORDER BY timestamp DESC LIMIT 1
            """)
            last_before_row = await cursor.fetchone()

            # Fetch recent rows (we filter in Python)
            cursor = await db.execute("""
                SELECT timestamp, state FROM shift_log 
                ORDER BY timestamp ASC
            """)
            all_rows = await cursor.fetchall()

        print(f"\n[ShiftLogger] get_shift_pattern(hours={hours})")
        print(f"[ShiftLogger] Start: {start_time}, Now: {now}")
        print(f"[ShiftLogger] Total rows in DB: {len(all_rows)}")

        # Parse timestamps and filter rows inside the window
        rows_in_window = []
        for ts_str, state in all_rows:
            try:
                # Normalize common formats: '2026-05-22 20:47:15' or '2026-05-22T20:47:15.123'
                ts_clean = ts_str.replace(' ', 'T').split('.')[0]
                ts = datetime.fromisoformat(ts_clean)
                if ts >= start_time:
                    rows_in_window.append((ts, state))
            except Exception:
                continue

        print(f"[ShiftLogger] Rows inside window: {len(rows_in_window)}")

        # Build timeline
        points: List[tuple] = []
        if last_before_row:
            try:
                ts_clean = last_before_row[0].replace(' ', 'T').split('.')[0]
                ts = datetime.fromisoformat(ts_clean)
                if ts < start_time:
                    points.append((ts, last_before_row[1]))
            except Exception:
                pass

        points.extend(rows_in_window)

        if points:
            final_state = points[-1][1]
        else:
            final_state = "Stopped"

        points.append((now, final_state))

        print(f"[ShiftLogger] Timeline points: {len(points)}")
        for p in points[-6:]:
            print(f"    {p[0].isoformat()} -> {p[1]}")

        # Initialize hourly buckets
        hourly_data: dict[str, dict] = {}
        bucket_time = start_time.replace(minute=0, second=0, microsecond=0)
        for _ in range(hours):
            key = bucket_time.strftime("%H:00")
            hourly_data[key] = {"running": 0.0, "stopped": 0.0}
            bucket_time += timedelta(hours=1)

        # Distribute time across hours
        for i in range(len(points) - 1):
            t0, state = points[i]
            t1 = points[i + 1][0]

            seg_start = max(t0, start_time)
            seg_end = min(t1, now)

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

        # Build result
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


# Global instance
shift_logger = ShiftLogger()
