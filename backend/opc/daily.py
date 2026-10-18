"""Daily aggregates for the 7-day screen (``type: week``), from the SQLite history.

Day attribution: **calendar days in TIMEZONE** (default system local; DST-aware, so a day is
23, 24 or 25 h). Everything is split at local midnight: counter increments are assigned by the
timestamp at which they were logged, run/stop segments are clipped to the day, and an overnight
shift (e.g. 22:00-06:00) contributes to both days in proportion to its time in each.

Per day (formulas in docs/BERAKNINGAR.md):
- good / reject / total: sum of positive increments of the shift counters logged during the day
  (a decrease = counter reset, the new value counts), with the same GoodCount / ProductionCount /
  RejectCount rules as the live OEE screen.
- planned time: the parts of the shift windows (current ShiftStart/ShiftEnd, assumed the same every
  day) that fall inside the day and up to now, **only where the line ran at all** (a shift part
  without any run time - weekend, holiday - is not planned).
- run time: Running time inside those planned parts; stop time = planned - run.
- OEE = A x P x Q exactly as live (A = run / planned, P = total / (run x nominal) capped at 1,
  Q = good / total, unknown without RejectCount).
- target: ShiftTarget (last logged value of each shift) x (planned part / shift length).
- has_data: any logged row (data_points or shift_log) inside the day; otherwise every value is None.

Since the shift log (table ``shifts``, backend/opc/shifts.py) exists, a day that the log fully
covers is aggregated from the shift rows instead (``source: "shifts"``): every shift's raw totals are
split at local midnight by time share and A, P, Q, OEE are recomputed from the sums. Days that began
before the shift log started recording (meta ``shift_log_since``) keep the method above
(``source: "raw"``).

Past days are final and cached; only today is recomputed on each refresh (HISTORY_INTERVAL_S).
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from typing import Any

from backend.opc.oee import _num, oee_factors, oee_target
from backend.timeutil import local_datetime, to_db_ts, to_local, utcnow

logger = logging.getLogger(__name__)

MAX_DAYS = 31
# A day is final (cacheable) once its end is this far in the past (lets queued inserts land first)
FINAL_AFTER_S = 120

Interval = tuple[datetime, datetime]


# --------------------------------------------------------------------------- pure helpers
def day_windows(n: int, now: datetime, tz: tzinfo | None) -> list[tuple[date, datetime, datetime]]:
    """The last ``n`` local calendar days incl. today, oldest first: (date, start UTC, end UTC).

    Boundaries are local midnights, so DST days are 23 h / 25 h long.
    """
    today = to_local(now, tz).date()
    out = []
    for i in range(n - 1, -1, -1):
        d = today - timedelta(days=i)
        start = local_datetime(d, time(0), tz).astimezone(timezone.utc)
        end = local_datetime(d + timedelta(days=1), time(0), tz).astimezone(timezone.utc)
        out.append((d, start, end))
    return out


def shift_windows_for_day(
    d: date, start_t: time, end_t: time, tz: tzinfo | None
) -> list[Interval]:
    """Shift windows (UTC) that can overlap local day ``d``: the shifts starting on d-1 and d."""
    out = []
    for sd in (d - timedelta(days=1), d):
        s = local_datetime(sd, start_t, tz).astimezone(timezone.utc)
        ed = sd if end_t > start_t else sd + timedelta(days=1)
        e = local_datetime(ed, end_t, tz).astimezone(timezone.utc)
        if e > s:
            out.append((s, e))
    return out


def _overlap(a: Interval, b: Interval) -> Interval | None:
    lo, hi = max(a[0], b[0]), min(a[1], b[1])
    return (lo, hi) if hi > lo else None


def run_seconds_in(segments: list[tuple[datetime, datetime, str]], window: Interval) -> float:
    total = 0.0
    for s, e, state in segments:
        if state != "Running":
            continue
        ov = _overlap((s, e), window)
        if ov:
            total += (ov[1] - ov[0]).total_seconds()
    return total


def day_counts(good_inc: float | None, prod_inc: float | None, reject_inc: float | None) -> dict:
    """Same rules as backend/opc/oee.production_counts, applied to the day's increments."""
    if good_inc is not None:
        total = good_inc + reject_inc if reject_inc is not None else good_inc
        return {"good": good_inc, "reject": reject_inc, "total": total, "source": "GoodCount"}
    good = max(0.0, prod_inc - reject_inc) if prod_inc is not None and reject_inc is not None else prod_inc
    return {"good": good, "reject": reject_inc, "total": prod_inc, "source": "ProductionCount"}


# --------------------------------------------------------------------------- SQL (DB thread)
_COUNTER_SQL = """
WITH r AS (
    SELECT timestamp, id, CAST(value AS REAL) AS v FROM data_points
    WHERE tag = ? AND timestamp >= ? AND timestamp < ?
    UNION ALL
    SELECT * FROM (
        SELECT timestamp, id, CAST(value AS REAL) FROM data_points
        WHERE tag = ? AND timestamp < ? ORDER BY timestamp DESC, id DESC LIMIT 1
    )
), d AS (
    SELECT timestamp, v, LAG(v) OVER (ORDER BY timestamp, id) AS p FROM r
)
SELECT
    COUNT(*) AS n_all,
    SUM(timestamp >= ?) AS n_day,
    SUM(CASE
        WHEN timestamp < ? THEN 0
        WHEN p IS NULL THEN v
        WHEN v >= p THEN v - p
        ELSE v
    END) AS inc
FROM d
"""


def counter_increment(conn: sqlite3.Connection, tag: str, start: datetime, end: datetime) -> float | None:
    """Sum of increments of a shift counter logged in [start, end); None if the tag has no history.

    The first value of the day is compared with the last value before the day. A decrease means the
    counter was reset (new shift), so the new value is the increment.
    """
    s, e = to_db_ts(start), to_db_ts(end)
    n_all, _n_day, inc = conn.execute(_COUNTER_SQL, (tag, s, e, tag, s, s, s)).fetchone()
    if not n_all:
        return None
    return float(round(inc or 0.0))


def _last_number(conn: sqlite3.Connection, tag: str, ts: datetime) -> float | None:
    row = conn.execute(
        "SELECT value FROM data_points WHERE tag = ? AND timestamp <= ? ORDER BY timestamp DESC, id DESC LIMIT 1",
        (tag, to_db_ts(ts)),
    ).fetchone()
    return _num(row[0]) if row else None


def _last_raw(conn: sqlite3.Connection, tag: str) -> str | None:
    row = conn.execute(
        "SELECT value FROM data_points WHERE tag = ? ORDER BY timestamp DESC, id DESC LIMIT 1", (tag,)
    ).fetchone()
    return row[0] if row else None


def _has_rows(conn: sqlite3.Connection, start: datetime, end: datetime) -> bool:
    s, e = to_db_ts(start), to_db_ts(end)
    q = (
        "SELECT EXISTS(SELECT 1 FROM data_points WHERE timestamp >= ? AND timestamp < ?)"
        " OR EXISTS(SELECT 1 FROM shift_log WHERE timestamp >= ? AND timestamp < ?)"
    )
    return bool(conn.execute(q, (s, e, s, e)).fetchone()[0])


# --------------------------------------------------------------------------- composition
class DailyHistory:
    """Computes and caches the per-day aggregates. Past days are cached, today is refreshed."""

    def __init__(
        self, data_logger, shift_logger, nominal_tpm: float, retention_days: int | None = None, shift_store=None
    ):
        self.data_logger = data_logger
        self.shift_store = shift_store
        self.shift_logger = shift_logger
        self.nominal_tpm = nominal_tpm
        self.retention_days = retention_days
        self._past: dict[tuple, dict] = {}
        self.latest: dict | None = None

    async def compute(self, data_store, n: int = 7, now: datetime | None = None) -> dict:
        n = max(1, min(MAX_DAYS, int(n)))
        now = now or utcnow()
        tz = self.shift_logger.tz
        windows = day_windows(n, now, tz)
        shift_times = await self._shift_times(data_store)
        log_since = await self.shift_store.log_since() if self.shift_store is not None else None
        days = []
        for d, start, end in windows:
            final = end <= now - timedelta(seconds=FINAL_AFTER_S)
            use_shifts = log_since is not None and log_since <= start
            key = (d, shift_times, self.nominal_tpm, use_shifts)
            if final and key in self._past:
                days.append({**self._past[key], "today": False})
                continue
            if use_shifts:
                row, closed = await self._compute_day_from_shifts(d, start, end, now)
                final = final and closed
            else:
                row = await self._compute_day(d, start, end, now, tz, shift_times)
            if final:
                self._past[key] = row
            days.append(row)
        # Forget cached days that left the window
        oldest = windows[0][0]
        self._past = {k: v for k, v in self._past.items() if k[0] >= oldest}

        today = windows[-1][0]
        for row in days:
            row["today"] = row["date"] == today.isoformat()
        result = {
            "days": days,
            "nominal_tpm": self.nominal_tpm,
            "oee_target": oee_target(data_store.get("OeeTarget")),
            "retention_days": self.retention_days,
            "shift": {"start": shift_times[0], "end": shift_times[1]} if shift_times else None,
            "updated": now.isoformat(),
        }
        if n == 7:
            self.latest = result
        return result

    async def _shift_times(self, data_store) -> tuple[str, str] | None:
        """(ShiftStart, ShiftEnd) as 'HH:MM:SS': live values, else the last logged ones."""
        from backend.opc.shift_logger import parse_time_of_day

        start, end = data_store.get("ShiftStart"), data_store.get("ShiftEnd")
        if not start or not end:
            def _q(conn):
                return _last_raw(conn, "ShiftStart"), _last_raw(conn, "ShiftEnd")

            start, end = await self.data_logger.db.run_async(_q)
        try:
            return parse_time_of_day(start).isoformat(), parse_time_of_day(end).isoformat()
        except Exception:
            return None

    async def _compute_day(self, d, start, end, now, tz, shift_times) -> dict:
        horizon = min(end, now)
        row: dict[str, Any] = {
            "date": d.isoformat(),
            "weekday": d.weekday(),  # 0 = Monday
            "start": start.isoformat(),
            "end": end.isoformat(),
            "today": False,
            "source": "raw",
            "has_data": False,
            "good": None,
            "reject": None,
            "total": None,
            "good_source": None,
            "planned_s": None,
            "run_s": None,
            "stop_s": None,
            "target": None,
            "oee_target": None,
            "teams": [],
            "shifts": None,
            "oee": {"availability": None, "performance": None, "quality": None, "oee": None},
        }
        if horizon <= start:
            return row

        shifts = []
        if shift_times:
            st, et = time.fromisoformat(shift_times[0]), time.fromisoformat(shift_times[1])
            shifts = shift_windows_for_day(d, st, et, tz)

        def _query(conn):
            if not _has_rows(conn, start, horizon):
                return None
            incs = {t: counter_increment(conn, t, start, horizon) for t in ("GoodCount", "ProductionCount", "RejectCount")}
            targets = [_last_number(conn, "ShiftTarget", min(e, now)) for _s, e in shifts]
            return incs, targets

        res = await self.data_logger.db.run_async(_query)
        if res is None:
            return row
        incs, shift_targets = res
        counts = day_counts(incs["GoodCount"], incs["ProductionCount"], incs["RejectCount"])

        segments = await self.shift_logger.get_state_segments(start, end, now)
        planned = run = 0.0
        target = 0.0
        target_known = False
        for (s, e), st_value in zip(shifts, shift_targets, strict=True):
            part = _overlap((s, e), (start, horizon))
            if not part:
                continue
            part_run = run_seconds_in(segments, part)
            if part_run <= 0:
                continue  # no run time at all in this shift part: not planned (weekend, holiday)
            part_s = (part[1] - part[0]).total_seconds()
            planned += part_s
            run += part_run
            if st_value is not None:
                target += st_value * part_s / (e - s).total_seconds()
                target_known = True

        row.update(
            {
                "has_data": True,
                "good": counts["good"],
                "reject": counts["reject"],
                "total": counts["total"],
                "good_source": counts["source"],
                "planned_s": planned if shifts else None,
                "run_s": run if shifts else None,
                "stop_s": planned - run if shifts else None,
                "target": round(target) if target_known else None,
            }
        )
        if planned > 0:
            row["oee"] = oee_factors(run, planned, counts["total"], counts["good"], self.nominal_tpm, counts["reject"])
        return row


    async def _compute_day_from_shifts(self, d, start, end, now) -> tuple[dict, bool]:
        """Day row from the shift log; returns (row, every overlapping shift closed)."""
        from backend.opc.shifts import aggregate_shifts, shift_shares

        rows = await self.shift_store.between(start, end)
        rows = [r for r in rows if shift_shares(r, start, end, now)[0] > 0]
        agg = aggregate_shifts(rows, start, end, now, self.nominal_tpm)
        row = {
            "date": d.isoformat(),
            "weekday": d.weekday(),
            "start": start.isoformat(),
            "end": end.isoformat(),
            "today": False,
            "source": "shifts",
            **agg,
        }
        return row, all(r["status"] == "closed" for r in rows)


_instance: DailyHistory | None = None


def get_daily_history() -> DailyHistory:
    """Process-wide instance (cache shared by the periodic task and GET /api/history/days)."""
    global _instance
    if _instance is None:
        from backend.opc.data_logger import data_logger
        from backend.opc.shift_logger import shift_logger
        from backend.opc.shifts import get_shift_store
        from backend.settings import settings

        _instance = DailyHistory(
            data_logger, shift_logger, settings.nominal_rate_tpm, settings.retention_days, get_shift_store()
        )
    return _instance
