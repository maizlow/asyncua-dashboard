"""Per-shift log (table ``shifts``) and aggregation over shifts.

The PLC only exposes the CURRENT shift (ShiftStart, ShiftEnd, ShiftTarget, OeeTarget, PlannedTime,
ShiftTeam). This module turns that into one persisted row per shift and closes the previous row
when a new shift starts. Formulas and the timing design are documented in docs/BERAKNINGAR.md.

Timing design (tags do not arrive in the same OPC frame):

- **Boundary detection.** A new shift is detected when the resolved shift start moves forward:
  either ShiftStart changes to a new time of day (a *fresh* change may be up to EARLY_S = 30 min
  before the scheduled start), or the clock passes the next occurrence of an unchanged ShiftStart
  (single-shift plants where ShiftStart is 06:00 every day). A counter reset alone is never a
  boundary (manual resets happen mid-shift).
- **Boundary time T** = min(scheduled start, time the ShiftStart change arrived). Measurement of the
  new shift (run time, stops) starts at T; the closing shift is measured up to T.
- **Settle window.** Nothing is written at detection. The boundary is *pending* until
  SHIFT_SETTLE_S (default 10 s) after the last ShiftStart change. Then:
  - the closing shift gets the parameters it had at T - SHIFT_SETTLE_S, so values for the next
    shift that arrived just before (or after) ShiftStart never leak into the closing shift;
  - the new shift gets the latest values (incl. ones that arrived before ShiftStart);
  - a ShiftStart that flaps back to the open shift's start cancels the pending boundary;
    a further change within the window replaces the candidate (T keeps the first detection).
- **Counters** are attributed with deltas. For each counter tag the split time is the first counter
  reset (decrease) logged within [T - settle, commit time], otherwise T. Tiles logged between the
  boundary and a late reset therefore still belong to the closing shift, and tiles after an early
  reset belong to the new one.
- **Parameters while open:** every change is applied to the open row immediately (last value wins);
  the closing row is rewritten at commit with the values from before the settle window.
- **ShiftStart going backwards** (earlier than the open shift's start) is ignored and logged.
- **Restart:** the open row is loaded from the DB and its parameters seed the history; if the shift
  changed while the backend was down, the first ShiftStart value starts a pending boundary with
  T = the new scheduled start.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import threading
from datetime import datetime, time, timedelta, timezone, tzinfo
from typing import Any

from backend.opc.daily import _overlap, counter_increment, day_counts
from backend.opc.oee import DEFAULT_OEE_TARGET_PCT, _num, oee_target, stop_stats
from backend.timeutil import from_db_ts, local_datetime, to_db_ts, to_local, utcnow

logger = logging.getLogger(__name__)

PARAM_TAGS = ("ShiftEnd", "ShiftTarget", "OeeTarget", "PlannedTime", "ShiftTeam")
COUNT_TAGS = ("GoodCount", "ProductionCount", "RejectCount")
TRACKED_TAGS = ("ShiftStart", *PARAM_TAGS)

EARLY_S = 1800  # a fresh ShiftStart change may come this long before the scheduled start
REFRESH_S = 30  # how often the open shift's counts/run time are re-measured and written
HISTORY_KEEP = timedelta(hours=24)
HISTORY_MAX = 500
EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# --------------------------------------------------------------------------- pure helpers
def parse_tod(value: Any) -> time | None:
    from backend.opc.shift_logger import parse_time_of_day

    try:
        return parse_time_of_day(value)
    except Exception:
        return None


def resolve_start(start_t: time, now: datetime, tz: tzinfo | None, early_s: float = 0) -> datetime:
    """Latest local occurrence of ``start_t`` that is <= now + early_s, as aware UTC."""
    ref = now + timedelta(seconds=early_s)
    today = to_local(ref, tz).date()
    for back in range(0, 3):
        cand = local_datetime(today - timedelta(days=back), start_t, tz)
        if cand <= ref:
            return cand.astimezone(timezone.utc)
    return local_datetime(today - timedelta(days=3), start_t, tz).astimezone(timezone.utc)


def resolve_end(start: datetime, end_t: time | None, tz: tzinfo | None) -> datetime | None:
    """Scheduled end for a shift starting at ``start``: same local day, or the next if end <= start."""
    if end_t is None:
        return None
    local_start = to_local(start, tz)
    day = local_start.date()
    if end_t <= local_start.time().replace(microsecond=0):
        day += timedelta(days=1)
    return local_datetime(day, end_t, tz).astimezone(timezone.utc)


def planned_seconds(planned_time: Any, start: datetime | None, end: datetime | None) -> tuple[float | None, str | None]:
    """Planned production time of the whole shift: PlannedTime (minutes, excl. breaks) when the PLC
    gives a value in [0, 24 h], else ShiftEnd - ShiftStart."""
    v = _num(planned_time)
    if v is not None and 0 <= v <= 24 * 60:
        return v * 60.0, "PlannedTime"
    if start is not None and end is not None and end > start:
        return (end - start).total_seconds(), "schedule"
    return None, None


def shift_shares(row: dict, lo: datetime, hi: datetime, now: datetime) -> tuple[float, float]:
    """(actual share, plan share) of a shift that falls in [lo, hi).

    The shift covers [start, end_eff] with end_eff = min(end, closed or now). Actual values measured
    so far (counts, run time) are split by time share of that covered part; planned time and target
    by the covered part's share of the whole scheduled shift (so an open shift gives "so far").
    """
    start = row["start"]
    stop = row.get("closed") or now
    end = row.get("end") or stop
    end_eff = min(end, stop)
    if end <= start or end_eff <= start:
        return 0.0, 0.0
    ov = _overlap((start, end_eff), (lo, hi))
    if not ov:
        return 0.0, 0.0
    sec = (ov[1] - ov[0]).total_seconds()
    return sec / (end_eff - start).total_seconds(), sec / (end - start).total_seconds()


def factors_from_sums(
    good: float, total: float, run_s: float, planned_s: float, nominal_tpm: float, have_counts: bool, q_known: bool
) -> dict:
    """A, P, Q and OEE (fractions) recomputed from summed raw totals of any period (shifts, days):
    A = run / planned, P = total / (run x R), Q = good / total, OEE = good / (planned x R), each
    capped at 1. Without counts P is unknown; without RejectCount (q_known False) Q and OEE are."""
    rate_s = nominal_tpm / 60.0
    oee = {"availability": None, "performance": None, "quality": None, "oee": None}
    if planned_s > 0:
        oee["availability"] = min(1.0, run_s / planned_s)
    if have_counts and run_s > 0 and rate_s > 0:
        oee["performance"] = min(1.0, total / (run_s * rate_s))
    if q_known and total > 0:
        oee["quality"] = good / total
    if q_known and planned_s > 0 and rate_s > 0 and oee["performance"] is not None:
        oee["oee"] = min(1.0, good / (planned_s * rate_s))
    return oee


def aggregate_shifts(rows: list[dict], lo: datetime, hi: datetime, now: datetime, nominal_tpm: float) -> dict:
    """Sum the shifts' raw totals in [lo, hi) (time share) and recompute A, P, Q, OEE from the sums.

    OEE = sum G / (sum planned x R); A = sum run / sum planned; P = sum total / (sum run x R);
    Q = sum G / sum total. Target = sum ShiftTarget x plan share. OEE goal = planned-time-weighted
    mean of OeeTarget (85 where a shift has none). A shift without run time is not planned unless the
    PLC gave PlannedTime (then a total breakdown counts as planned, unplanned time = PlannedTime 0).
    """
    good = reject = total = run = planned = target = stop_count = 0.0
    goal_w = goal_sum = 0.0
    n = 0
    have_counts = reject_known = target_known = planned_known = False
    reject_missing = False
    teams: list[str] = []
    sources: set[str] = set()
    for r in rows:
        a, p = shift_shares(r, lo, hi, now)
        if a <= 0:
            continue
        n += 1
        if r.get("team") not in (None, "") and str(r["team"]) not in teams:
            teams.append(str(r["team"]))
        if r.get("good") is not None:
            have_counts = True
            good += r["good"] * a
            total += (r.get("total") if r.get("total") is not None else r["good"]) * a
            if r.get("reject") is None:
                reject_missing = True
            else:
                reject_known = True
                reject += r["reject"] * a
            if r.get("good_source"):
                sources.add(r["good_source"])
        run_s = r.get("run_s") or 0.0
        run += run_s * a
        stop_count += (r.get("stop_count") or 0) * a
        if r.get("planned_s") is not None and (run_s > 0 or r.get("planned_source") == "PlannedTime"):
            part = r["planned_s"] * p
            planned += part
            planned_known = True
            goal = oee_target(r.get("oee_target"))["value"]
            goal_sum += goal * part
            goal_w += part
        if r.get("target") is not None:
            target += r["target"] * p
            target_known = True
    q_known = have_counts and reject_known and not reject_missing
    oee = factors_from_sums(good, total, run, planned, nominal_tpm, have_counts, q_known)
    return {
        "shifts": n,
        "has_data": n > 0,
        "good": round(good) if have_counts else None,
        "reject": round(reject) if have_counts and q_known else None,
        "total": round(total) if have_counts else None,
        "good_source": "/".join(sorted(sources)) or None,
        "planned_s": planned if n else None,
        "run_s": run if n else None,
        "stop_s": max(0.0, planned - run) if n and planned_known else None,
        "stop_count": round(stop_count) if n else None,
        "target": round(target) if target_known else None,
        "oee_target": goal_sum / goal_w if goal_w > 0 else None,
        "teams": teams,
        "oee": oee,
    }


# --------------------------------------------------------------------------- SQL
_RESET_SQL = """
WITH r AS (
    SELECT timestamp, id, CAST(value AS REAL) AS v FROM data_points
    WHERE tag = ? AND timestamp >= ? AND timestamp <= ?
    UNION ALL
    SELECT * FROM (
        SELECT timestamp, id, CAST(value AS REAL) FROM data_points
        WHERE tag = ? AND timestamp < ? ORDER BY timestamp DESC, id DESC LIMIT 1
    )
), d AS (
    SELECT timestamp, id, v, LAG(v) OVER (ORDER BY timestamp, id) AS p FROM r
)
SELECT timestamp FROM d WHERE p IS NOT NULL AND v < p AND timestamp >= ? ORDER BY timestamp, id LIMIT 1
"""


def first_reset(conn: sqlite3.Connection, tag: str, lo: datetime, hi: datetime) -> datetime | None:
    """Timestamp of the first counter decrease (reset) logged in [lo, hi], or None."""
    s, e = to_db_ts(lo), to_db_ts(hi)
    row = conn.execute(_RESET_SQL, (tag, s, e, tag, s, s)).fetchone()
    return from_db_ts(row[0]) if row else None


_COLUMNS = (
    "start_ts", "end_ts", "opened_ts", "closed_ts", "status", "team", "target", "oee_target",
    "planned_s", "planned_source", "good", "reject", "total", "good_source", "run_s", "stop_count",
    "stop_s", "count_from", "params", "updated_ts",
)


def _ts(v: datetime | None) -> str | None:
    return to_db_ts(v) if v is not None else None


def _dt(v: str | None) -> datetime | None:
    return from_db_ts(v) if v else None


def row_to_dict(rec: sqlite3.Row | tuple, names: list[str]) -> dict:
    raw = dict(zip(names, rec, strict=True))
    return {
        "id": raw["id"],
        "start": _dt(raw["start_ts"]),
        "end": _dt(raw["end_ts"]),
        "opened": _dt(raw["opened_ts"]),
        "closed": _dt(raw["closed_ts"]),
        "status": raw["status"],
        "team": raw["team"],
        "target": raw["target"],
        "oee_target": raw["oee_target"],
        "planned_s": raw["planned_s"],
        "planned_source": raw["planned_source"],
        "good": raw["good"],
        "reject": raw["reject"],
        "total": raw["total"],
        "good_source": raw["good_source"],
        "run_s": raw["run_s"],
        "stop_count": raw["stop_count"],
        "stop_s": raw["stop_s"],
        "count_from": {k: from_db_ts(v) for k, v in json.loads(raw["count_from"] or "{}").items()},
        "params": json.loads(raw["params"] or "{}"),
    }


def row_to_json(r: dict) -> dict:
    """API shape: ISO timestamps, no internals."""
    out = {k: v for k, v in r.items() if k not in ("count_from", "params")}
    for k in ("start", "end", "opened", "closed"):
        out[k] = r[k].isoformat() if r.get(k) else None
    return out


class ShiftStore:
    """SQLite access for the ``shifts`` table (never purged by RETENTION_DAYS)."""

    def __init__(self, db=None):
        self._db = db

    @property
    def db(self):
        if self._db is None:
            from backend.opc.database import default_database

            self._db = default_database()
        return self._db

    async def init_db(self, now: datetime | None = None) -> None:
        """Create the table; the first call also records when the shift log started (meta table)."""
        since = to_db_ts(now or utcnow())

        def _init(conn):
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS shifts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    start_ts TEXT NOT NULL,
                    end_ts TEXT,
                    opened_ts TEXT NOT NULL,
                    closed_ts TEXT,
                    status TEXT NOT NULL DEFAULT 'open',
                    team TEXT,
                    target REAL,
                    oee_target REAL,
                    planned_s REAL,
                    planned_source TEXT,
                    good REAL,
                    reject REAL,
                    total REAL,
                    good_source TEXT,
                    run_s REAL,
                    stop_count INTEGER,
                    stop_s REAL,
                    count_from TEXT,
                    params TEXT,
                    updated_ts TEXT
                )
                """
            )
            conn.execute("CREATE INDEX IF NOT EXISTS idx_shifts_start ON shifts (start_ts)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_shifts_status ON shifts (status)")
            conn.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)")
            conn.execute("INSERT OR IGNORE INTO meta (key, value) VALUES ('shift_log_since', ?)", (since,))

        await self.db.run_async(_init)

    @staticmethod
    def _select(conn, where: str = "", args: tuple = (), tail: str = "") -> list[dict]:
        cur = conn.execute(f"SELECT id, {', '.join(_COLUMNS)} FROM shifts {where} {tail}", args)
        names = [c[0] for c in cur.description]
        return [row_to_dict(rec, names) for rec in cur.fetchall()]

    async def load_open(self) -> dict | None:
        rows = await self.db.run_async(
            lambda c: self._select(c, "WHERE status = 'open'", (), "ORDER BY start_ts DESC, id DESC LIMIT 1")
        )
        return rows[0] if rows else None

    async def between(self, lo: datetime, hi: datetime) -> list[dict]:
        """Shifts whose scheduled window can overlap [lo, hi)."""
        lo_s, hi_s = to_db_ts(lo - timedelta(days=2)), to_db_ts(hi)
        return await self.db.run_async(
            lambda c: self._select(c, "WHERE start_ts < ? AND start_ts >= ?", (hi_s, lo_s), "ORDER BY start_ts, id")
        )

    async def recent(self, limit: int = 20) -> list[dict]:
        return await self.db.run_async(lambda c: self._select(c, "", (), f"ORDER BY start_ts DESC, id DESC LIMIT {int(limit)}"))

    async def log_since(self) -> datetime | None:
        """When the shift log started recording (first start of a backend with this feature)."""

        def _q(c):
            try:
                return c.execute("SELECT value FROM meta WHERE key = 'shift_log_since'").fetchone()
            except sqlite3.OperationalError:  # table not created (init_db not run)
                return None

        row = await self.db.run_async(_q)
        return _dt(row[0]) if row else None

    async def set_log_since(self, ts: datetime) -> None:
        await self.db.run_async(
            lambda c: c.execute("INSERT OR REPLACE INTO meta (key, value) VALUES ('shift_log_since', ?)", (to_db_ts(ts),))
        )

    @staticmethod
    def _values(r: dict) -> dict:
        return {
            "start_ts": _ts(r["start"]),
            "end_ts": _ts(r.get("end")),
            "opened_ts": _ts(r["opened"]),
            "closed_ts": _ts(r.get("closed")),
            "status": r["status"],
            "team": None if r.get("team") in (None, "") else str(r["team"]),
            "target": r.get("target"),
            "oee_target": r.get("oee_target"),
            "planned_s": r.get("planned_s"),
            "planned_source": r.get("planned_source"),
            "good": r.get("good"),
            "reject": r.get("reject"),
            "total": r.get("total"),
            "good_source": r.get("good_source"),
            "run_s": r.get("run_s"),
            "stop_count": r.get("stop_count"),
            "stop_s": r.get("stop_s"),
            "count_from": json.dumps({k: to_db_ts(v) for k, v in (r.get("count_from") or {}).items()}),
            "params": json.dumps(r.get("params") or {}, default=str),
            "updated_ts": to_db_ts(utcnow()),
        }

    def save_sync(self, conn, r: dict) -> int:
        vals = self._values(r)
        if r.get("id"):
            sets = ", ".join(f"{k} = ?" for k in vals)
            conn.execute(f"UPDATE shifts SET {sets} WHERE id = ?", (*vals.values(), r["id"]))
            return r["id"]
        cols = ", ".join(vals)
        qs = ", ".join("?" for _ in vals)
        return conn.execute(f"INSERT INTO shifts ({cols}) VALUES ({qs})", tuple(vals.values())).lastrowid

    async def save(self, r: dict) -> int:
        r["id"] = await self.db.run_async(lambda c: self.save_sync(c, r))
        return r["id"]


# --------------------------------------------------------------------------- tracker
def apply_params(r: dict, params: dict, tz: tzinfo | None) -> None:
    """Derived columns of a shift row from its raw PLC parameters."""
    r["params"] = dict(params)
    r["end"] = resolve_end(r["start"], parse_tod(params.get("ShiftEnd")), tz) or r.get("end")
    team = params.get("ShiftTeam")
    r["team"] = None if team in (None, "") else str(team).strip()
    r["target"] = _num(params.get("ShiftTarget"))
    goal = _num(params.get("OeeTarget"))
    r["oee_target"] = goal if goal is not None and 0 < goal <= 100 else None
    r["planned_s"], r["planned_source"] = planned_seconds(params.get("PlannedTime"), r["start"], r.get("end"))


class ShiftTracker:
    """Builds the shift log from the live PLC tags. ``on_value`` is called on the OPC thread for every
    tag change; ``tick`` runs on the event loop (about once a second) and does all decisions and
    database writes, so the logic is testable with explicit timestamps."""

    def __init__(self, store: ShiftStore, shift_logger, settle_s: float = 10.0):
        self.store = store
        self.shift_logger = shift_logger
        self.settle = timedelta(seconds=max(0.0, settle_s))
        self._lock = threading.Lock()
        self._hist: dict[str, list[tuple[datetime, Any]]] = {t: [] for t in TRACKED_TAGS}
        self.open: dict | None = None
        self.pending: dict | None = None
        self._last_refresh: datetime | None = None
        self._warned: set = set()
        self.loaded = False

    # ---------------------------------------------------------------- input (any thread)
    def on_value(self, key: str, value: Any, ts: datetime | None = None) -> None:
        if key not in self._hist:
            return
        ts = ts or utcnow()
        with self._lock:
            h = self._hist[key]
            if h and h[-1][1] == value:
                return  # repeated value (reconnect, duplicate frame): keep the time of the first one
            h.append((ts, value))
            cutoff = ts - HISTORY_KEEP
            while len(h) > 1 and (h[1][0] <= cutoff or len(h) > HISTORY_MAX):
                h.pop(0)

    def _value_at(self, tag: str, t: datetime) -> Any:
        val = None
        for ts, v in self._hist[tag]:
            if ts <= t:
                val = v
            else:
                break
        return val

    def _latest(self, tag: str) -> tuple[datetime, Any] | tuple[None, None]:
        h = self._hist[tag]
        return h[-1] if h else (None, None)

    def _warn_once(self, key, msg, *args):
        if key not in self._warned:
            self._warned.add(key)
            logger.warning(msg, *args)

    # ---------------------------------------------------------------- lifecycle
    async def load(self) -> None:
        """Resume the open shift after a restart; its stored parameters seed the tag history."""
        self.open = await self.store.load_open()
        if self.open:
            tz = self.shift_logger.tz
            with self._lock:
                seed = {"ShiftStart": to_local(self.open["start"], tz).time().replace(microsecond=0).isoformat()}
                seed.update({k: v for k, v in self.open["params"].items() if k in PARAM_TAGS})
                for tag, v in seed.items():
                    if v is not None and not self._hist[tag]:
                        self._hist[tag].append((EPOCH, v))
            logger.info("Resuming open shift %s (started %s)", self.open["id"], self.open["start"].isoformat())
        self.loaded = True

    # ---------------------------------------------------------------- decisions
    def _evaluate(self, now: datetime, tz) -> None:
        tv, raw = self._latest("ShiftStart")
        start_t = parse_tod(raw) if raw is not None else None
        if start_t is None:
            if raw is not None:
                self._warn_once(("bad", raw), "ShiftStart %r is not a time of day; shift log paused", raw)
            self.pending = None
            return
        fresh = tv is not None and tv > EPOCH and (now - tv).total_seconds() <= EARLY_S
        same_tod = False
        if self.open is not None:
            same_tod = to_local(self.open["start"], tz).time().replace(microsecond=0) == start_t
            fresh = fresh and not same_tod
        cand = resolve_start(start_t, now, tz, EARLY_S if fresh else 0)
        if same_tod and cand < self.open["start"]:
            cand = self.open["start"]  # open shift started early and its scheduled start is still ahead

        if self.open is not None:
            if cand == self.open["start"]:
                if self.pending:
                    logger.info("ShiftStart back to the open shift's start; pending boundary cancelled")
                self.pending = None
                return
            if cand < self.open["start"]:
                self._warn_once(("back", raw, self.open["id"]),
                                "ShiftStart %r is before the open shift's start %s; ignored",
                                raw, self.open["start"].isoformat())
                self.pending = None
                return
        boundary = min(cand, tv) if fresh else cand
        if self.open is None:
            boundary = cand  # first shift ever (or after a gap): measure from its scheduled start
        if self.pending is None:
            self.pending = {"start": cand, "T": boundary, "noticed": now}
            logger.info("Shift boundary detected: new start %s (T=%s), settling %ss",
                        cand.isoformat(), boundary.isoformat(), self.settle.total_seconds())
        else:
            self.pending["T"] = min(self.pending["T"], boundary)
            self.pending["start"] = cand
        last_change = tv if tv is not None and tv > EPOCH else now
        self.pending["deadline"] = max(self.pending["noticed"], last_change) + self.settle

    async def tick(self, now: datetime | None = None) -> None:
        now = now or utcnow()
        if not self.loaded:
            await self.load()
        tz = self.shift_logger.tz
        with self._lock:
            self._evaluate(now, tz)
            commit = self.pending is not None and now >= self.pending["deadline"]
            params_now = {t: self._latest(t)[1] for t in PARAM_TAGS}
        if commit:
            await self._commit(now, tz)
            return
        if self.open is None or self.pending is not None:
            return  # while a boundary settles, the open row is left alone
        changed = params_now != self.open["params"]
        if changed:
            apply_params(self.open, params_now, tz)
        if changed or self._last_refresh is None or (now - self._last_refresh).total_seconds() >= REFRESH_S:
            await self._measure(self.open, now)
            await self.store.save(self.open)
            self._last_refresh = now

    async def _commit(self, now: datetime, tz) -> None:
        p = self.pending
        start, boundary = p["start"], p["T"]
        with self._lock:
            new_params = {t: self._latest(t)[1] for t in PARAM_TAGS}
            closing_params = {t: self._value_at(t, boundary - self.settle) for t in PARAM_TAGS}

        lo, hi = boundary - self.settle, now

        def _splits(conn):
            return {t: first_reset(conn, t, lo, hi) or boundary for t in COUNT_TAGS}

        splits = await self.store.db.run_async(_splits)
        if self.open is not None:
            old = self.open
            # Values known before the settle window; fall back to what the row already had
            merged = {t: (closing_params[t] if closing_params[t] is not None else old["params"].get(t)) for t in PARAM_TAGS}
            apply_params(old, merged, tz)
            old["closed"] = boundary
            old["status"] = "closed"
            await self._measure(old, boundary, count_to=splits)
            await self.store.save(old)
            logger.info("Shift %s closed at %s (good=%s)", old["id"], boundary.isoformat(), old.get("good"))
        new = {"id": None, "start": start, "end": None, "opened": boundary, "closed": None, "status": "open",
               "count_from": dict(splits) if self.open is not None else {t: boundary for t in COUNT_TAGS}}
        apply_params(new, new_params, tz)
        await self._measure(new, now)
        await self.store.save(new)
        logger.info("Shift %s opened: start %s, team %r, target %r", new["id"], start.isoformat(), new["team"], new["target"])
        self.open = new
        self.pending = None
        self._last_refresh = now

    async def _measure(self, r: dict, until: datetime, count_to: dict | None = None) -> None:
        """Counts (deltas) and run/stop time of a shift from the raw history, up to ``until``."""
        opened = r["opened"]
        frm = r.get("count_from") or {}

        def _counts(conn):
            out = {}
            for t in COUNT_TAGS:
                a = frm.get(t, opened)
                b = (count_to or {}).get(t, until)
                out[t] = counter_increment(conn, t, a, max(a, b))  # None = tag never logged
            return out

        incs = await self.store.db.run_async(_counts)
        c = day_counts(incs["GoodCount"], incs["ProductionCount"], incs["RejectCount"])
        r.update(good=c["good"], reject=c["reject"], total=c["total"],
                 good_source=c["source"] if c["good"] is not None else None)
        if until > opened:
            segments = await self.shift_logger.get_state_segments(opened, until, until)
            run_s = stop_stats(segments)["run_s"]
            sched_end = min(until, r["end"]) if r.get("end") else until
            stops = stop_stats([s for s in segments if s[1] <= sched_end] +
                               [(s[0], sched_end, s[2]) for s in segments if s[0] < sched_end < s[1]])
        else:
            segments, run_s, stops = [], 0.0, {"count": 0, "total_s": 0.0}
        r.update(run_s=run_s if segments else None, stop_count=stops["count"] if segments else None,
                 stop_s=stops["total_s"] if segments else None)


# --------------------------------------------------------------------------- live helpers
def live_planned(planned_time: Any, elapsed_s: float, duration_s: float) -> dict:
    """Planned time so far for the live OEE screen: PlannedTime pro rata over the shift, else elapsed."""
    v = _num(planned_time)
    if v is not None and 0 <= v <= 24 * 60 and duration_s > 0:
        total = v * 60.0
        return {"so_far_s": total * elapsed_s / duration_s, "shift_s": total, "source": "PlannedTime"}
    return {"so_far_s": elapsed_s, "shift_s": duration_s, "source": "schedule"}


_store: ShiftStore | None = None
_tracker: ShiftTracker | None = None


def get_shift_store() -> ShiftStore:
    global _store
    if _store is None:
        _store = ShiftStore()
    return _store


def get_shift_tracker() -> ShiftTracker:
    global _tracker
    if _tracker is None:
        from backend.opc.shift_logger import shift_logger
        from backend.settings import settings

        _tracker = ShiftTracker(get_shift_store(), shift_logger, settings.shift_settle_s)
    return _tracker


__all__ = [
    "DEFAULT_OEE_TARGET_PCT",
    "ShiftStore",
    "ShiftTracker",
    "aggregate_shifts",
    "factors_from_sums",
    "first_reset",
    "get_shift_store",
    "get_shift_tracker",
    "live_planned",
    "planned_seconds",
    "resolve_end",
    "resolve_start",
    "row_to_json",
    "shift_shares",
]
