"""History aggregates for the chart elements (kpi, bars, trend, table, timeline ...).

Read-only, computed in the backend so the frontend never re-implements a formula:

- ``days``: the last 30 local calendar days (midnight to midnight in TIMEZONE, today up to now), the same
  rows as the 7-day screen (backend/opc/daily.py, cached: only today is recomputed).
- ``sums``: totals over the last 7, 14 and 30 days (today included): raw totals summed and A, P, Q,
  OEE recomputed from the sums (``factors_from_sums``, the same formula as a day of the shift log).
- ``shifts``: the last shifts of the shift log (table ``shifts``), oldest first, each with A, P, Q, OEE
  from its own totals (``aggregate_shifts`` over the whole shift). The open shift is last.
- ``today``, ``yesterday``, ``current_shift``: shortcuts into the lists above.
- ``segments``: run/stop segments of the current shift window (for the run/stop timeline).

Everything is for the display's default connection: history per connection comes with etapp 4 (multi-PLC
runtime). Pushed as the WebSocket message ``aggregates`` every HISTORY_INTERVAL_S and served by
``GET /api/aggregates``. Formulas: docs/BERAKNINGAR.md (Diagram och historik).
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from backend.opc.oee import oee_target
from backend.opc.shifts import aggregate_shifts, factors_from_sums, row_to_json
from backend.timeutil import utcnow

logger = logging.getLogger(__name__)

PERIOD_DAYS = (7, 14, 30)
MAX_DAYS_SHOWN = max(PERIOD_DAYS)
MAX_SHIFTS = 14
MAX_SEGMENTS = 2000


def scrap_pct(row: dict) -> float | None:
    """Kassation % = reject / total x 100 (as on the OEE screen); None without RejectCount or output."""
    reject, total = row.get("reject"), row.get("total")
    return reject / total * 100 if reject is not None and total else None


def _with_scrap(row: dict) -> dict:
    return {**row, "scrap_pct": scrap_pct(row)}


def combine_days(days: list[dict], nominal_tpm: float) -> dict:
    """Totals over several day rows: counts, run and planned time summed, A, P, Q, OEE recomputed from
    the sums. Days without data are skipped; Q and OEE stay unknown if any day lacks RejectCount."""
    rows = [d for d in days if d.get("has_data")]
    good = total = reject = run = planned = target = stops = 0.0
    goal_sum = goal_w = 0.0
    have_counts = target_known = stops_known = False
    q_known = bool(rows)
    teams: list[str] = []
    for d in rows:
        if d.get("good") is not None:
            have_counts = True
            good += d["good"]
            total += d["total"] if d.get("total") is not None else d["good"]
        if d.get("reject") is None:
            q_known = False
        else:
            reject += d["reject"]
        run += d.get("run_s") or 0.0
        part = d.get("planned_s") or 0.0
        planned += part
        if part > 0:
            goal = oee_target(d.get("oee_target"))["value"]
            goal_sum += goal * part
            goal_w += part
        if d.get("target") is not None:
            target += d["target"]
            target_known = True
        if d.get("stop_count") is not None:
            stops += d["stop_count"]
            stops_known = True
        for t in d.get("teams") or []:
            if t not in teams:
                teams.append(t)
    q_known = q_known and have_counts
    out = {
        "has_data": bool(rows),
        "days": len(rows),
        "good": round(good) if have_counts else None,
        "reject": round(reject) if have_counts and q_known else None,
        "total": round(total) if have_counts else None,
        "planned_s": planned if rows else None,
        "run_s": run if rows else None,
        "stop_s": max(0.0, planned - run) if rows else None,
        "stop_count": round(stops) if stops_known else None,
        "target": round(target) if target_known else None,
        "oee_target": goal_sum / goal_w if goal_w > 0 else None,
        "teams": teams,
        "oee": factors_from_sums(good, total, run, planned, nominal_tpm, have_counts, q_known),
    }
    return _with_scrap(out)


def shift_aggregate(row: dict, now: datetime, nominal_tpm: float) -> dict:
    """One shift of the shift log with A, P, Q, OEE from its own totals (the whole shift, not split)."""
    lo = row["start"]
    hi = max(row.get("end") or now, row.get("closed") or now, now) + timedelta(seconds=1)
    agg = aggregate_shifts([row], lo, hi, now, nominal_tpm)
    base = row_to_json(row)
    return _with_scrap({
        "id": base["id"],
        "start": base["start"],
        "end": base["end"],
        "closed": base["closed"],
        "status": base["status"],
        "team": base["team"],
        **{k: v for k, v in agg.items() if k not in ("teams", "shifts")},
    })


async def current_segments(shift_logger, now: datetime) -> tuple[dict | None, list[dict]]:
    """The current shift window and its run/stop segments (merged, oldest first)."""
    try:
        start, end = await shift_logger.get_current_shift_window(now=now)
    except RuntimeError:
        return None, []
    segs = await shift_logger.get_state_segments(start, end, now)
    out = [{"start": s.isoformat(), "end": e.isoformat(), "running": st == "Running"} for s, e, st in segs]
    return {"start": start.isoformat(), "end": end.isoformat()}, out[-MAX_SEGMENTS:]


async def compute_aggregates(
    history,
    data_store,
    shift_store,
    shift_logger,
    nominal_tpm: float,
    connection: str | None = None,
    now: datetime | None = None,
    daily: dict | None = None,
) -> dict[str, Any]:
    """Everything the chart elements read from the history, JSON-serialisable (see module docstring).

    ``daily`` = an already computed DailyHistory result for MAX_DAYS_SHOWN days (the periodic task
    computes it once and slices the 7-day screen from it)."""
    now = now or utcnow()
    if daily is None:
        daily = await history.compute(data_store, n=MAX_DAYS_SHOWN, now=now)
    days = [_with_scrap(r) for r in daily["days"]]
    rows = await shift_store.recent(MAX_SHIFTS) if shift_store is not None else []
    shifts = [shift_aggregate(r, now, nominal_tpm) for r in reversed(rows)]
    window, segments = await current_segments(shift_logger, now)
    open_shift = next((s for s in reversed(shifts) if s["status"] == "open"), None)
    return {
        "connection": connection,
        "updated": now.isoformat(),
        "nominal_tpm": nominal_tpm,
        "oee_target": daily["oee_target"],
        "today": days[-1] if days else None,
        "yesterday": days[-2] if len(days) > 1 else None,
        "days": days[-MAX_DAYS_SHOWN:],
        "sums": {str(n): combine_days(days[-n:], nominal_tpm) for n in PERIOD_DAYS},
        "shifts": shifts,
        "current_shift": open_shift,
        "shift_window": window,
        "segments": segments,
    }


class AggregateCache:
    """The latest aggregates (refreshed by the periodic task in backend/app/main.py)."""

    def __init__(self):
        self.latest: dict | None = None


_cache = AggregateCache()


def get_aggregate_cache() -> AggregateCache:
    return _cache
