import aiosqlite
import asyncio
from datetime import datetime, timedelta
from typing import List, Dict

from backend.settings import settings

DB_PATH = settings.shift_db_path

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
        Returns data ready for the frontend chart.
        """
        async with aiosqlite.connect(self.db_path) as db:
            now = datetime.now()
            start_time = now - timedelta(hours=hours)

            cursor = await db.execute("""
                SELECT timestamp, state 
                FROM shift_log 
                WHERE timestamp >= ? 
                ORDER BY timestamp ASC
            """, (start_time.isoformat(),))

            rows = await cursor.fetchall()
            print(rows)
        # Build hourly buckets
        hourly_data = {}
        current_time = start_time.replace(minute=0, second=0, microsecond=0)

        for i in range(hours):
            hour_key = current_time.strftime("%H:00")
            hourly_data[hour_key] = {"running": 0, "stopped": 0}
            current_time += timedelta(hours=1)

        # Process logs
        prev_time = start_time
        prev_state = "Stopped"  # Assume starting as stopped

        for row in rows:
            print(f"Processing log: {row}")
            timestamp = datetime.fromisoformat(row[0])
            state = row[1]

            # Fill time between previous and current log
            delta = (timestamp - prev_time).total_seconds() / 60  # minutes

            if prev_state == "Running":
                hourly_data[prev_time.strftime("%H:00")]["running"] += delta
            else:
                hourly_data[prev_time.strftime("%H:00")]["stopped"] += delta

            prev_time = timestamp
            prev_state = state

        # Convert to list format for frontend
        result = []
        for hour, data in sorted(hourly_data.items()):
            result.append({
                "time": hour,
                "running": round(data["running"], 1),
                "stopped": round(data["stopped"], 1)
            })

        return result


# Global instance
shift_logger = ShiftLogger()