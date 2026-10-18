"""OEE details for the display (roof tile line).

Definitions (planned production time = elapsed shift time; planned breaks are not modelled):
- Tillgänglighet (availability) A = run time / planned time
- Prestanda (performance)       P = total count / (run time [min] x nominal rate), capped at 1
- Kvalitet (quality)            Q = good / total (only when RejectCount is known)
- OEE = A x P x Q
- Skiftmål = PLC tag ShiftTarget (whole shift, st); Mål hittills = ShiftTarget x elapsed / shift duration.
  No ShiftTarget -> no targets (never a silent fallback to the nominal rate)
- Prognos = good / elapsed x shift duration (current average pace, incl. stops)
- OEE goal = PLC tag OeeTarget (%), default 85 when empty/invalid

Counts: GoodCount (+ RejectCount) when GoodCount has a value. Otherwise ProductionCount is the total
output *including* rejects: total = ProductionCount, good = ProductionCount - RejectCount.
See docs/BERAKNINGAR.md for every formula and edge case.

Everything that can be derived (stops, run time, elapsed/remaining, targets) is computed here
from the shift log and shift window; only counts and speed come from PLC tags.
"""

from __future__ import annotations

import logging
import sqlite3
from datetime import datetime, timezone
from typing import Any

from backend.timeutil import to_db_ts, utcnow

logger = logging.getLogger(__name__)

Segment = tuple[datetime, datetime, str]  # (from, to, "Running" | other)

MIN_ELAPSED_FOR_PROGNOSIS_S = 300
DEFAULT_OEE_TARGET_PCT = 85.0


def _num(value: Any) -> float | None:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    return n if n == n else None  # filter NaN


# --------------------------------------------------------------------------- pure functions
def shift_progress(start: datetime, end: datetime, now: datetime) -> dict:
    duration = max(0.0, (end.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds())
    elapsed = (now.astimezone(timezone.utc) - start.astimezone(timezone.utc)).total_seconds()
    elapsed = min(max(0.0, elapsed), duration)
    return {"duration_s": duration, "elapsed_s": elapsed, "remaining_s": duration - elapsed}


def stop_stats(segments: list[Segment]) -> dict:
    """Stop count/time, longest stop, run time and MTBF/MTTR from state segments.

    A stop is a maximal run of non-"Running" time; one still in progress counts too.
    """
    run_s = 0.0
    stops: list[float] = []
    prev_state = None
    for seg_start, seg_end, state in segments:
        dur = (seg_end - seg_start).total_seconds()
        if state == "Running":
            run_s += dur
        elif prev_state is not None and prev_state != "Running" and stops:
            stops[-1] += dur  # same stop continues (e.g. different stop reason)
        else:
            stops.append(dur)
        prev_state = state
    count = len(stops)
    total = sum(stops)
    return {
        "count": count,
        "total_s": total,
        "longest_s": max(stops) if stops else 0.0,
        "run_s": run_s,
        "mtbf_s": run_s / count if count else None,
        "mttr_s": total / count if count else None,
        "running": segments[-1][2] == "Running" if segments else None,
    }


def targets(elapsed_s: float, duration_s: float, shift_target: float | None) -> dict:
    """Skiftmål from the PLC (ShiftTarget) and the pro-rata target so far; None without a PLC target."""
    if shift_target is None or duration_s <= 0:
        return {"so_far": None, "shift": None}
    return {
        "so_far": round(shift_target * elapsed_s / duration_s),
        "shift": round(shift_target),
    }


def production_counts(good_count: Any, production_count: Any, reject_count: Any) -> dict:
    """good / reject / total from the PLC counters without double-counting rejects.

    GoodCount set:   good = GoodCount, total = GoodCount + RejectCount (or GoodCount without rejects).
    Otherwise:       ProductionCount is assumed to include rejects: total = ProductionCount,
                     good = ProductionCount - RejectCount (>= 0), or ProductionCount without rejects.
    """
    good_c, prod_c, reject = _num(good_count), _num(production_count), _num(reject_count)
    if good_count is not None:
        source, good = "GoodCount", good_c
        total = good + reject if good is not None and reject is not None else good
    else:
        source, total = "ProductionCount", prod_c
        good = max(0.0, prod_c - reject) if prod_c is not None and reject is not None else prod_c
    return {"good": good, "reject": reject, "total": total, "source": source}


def oee_target(value: Any) -> dict:
    """OEE goal in % from the PLC tag OeeTarget; DEFAULT_OEE_TARGET_PCT when empty or outside (0, 100]."""
    v = _num(value)
    if v is not None and 0 < v <= 100:
        return {"value": v, "source": "OeeTarget"}
    return {"value": DEFAULT_OEE_TARGET_PCT, "source": "default"}


def quality(good: float | None, total: float | None, reject: float | None) -> float | None:
    """Q = good / total; unknown (None) without RejectCount, since every tile would count as good."""
    return good / total if good is not None and total and reject is not None else None


def prognosis(good: float | None, elapsed_s: float, duration_s: float) -> int | None:
    """Expected good count at shift end at the current average pace."""
    if good is None or elapsed_s < MIN_ELAPSED_FOR_PROGNOSIS_S or duration_s <= 0:
        return None
    return round(good / elapsed_s * duration_s)


def oee_factors(
    run_s: float,
    planned_s: float,
    total: float | None,
    good: float | None,
    nominal_tpm: float,
    reject: float | None = 0.0,
) -> dict:
    """A, P, Q and OEE as fractions (0..1); None where undefined."""
    availability = min(1.0, run_s / planned_s) if planned_s > 0 else None
    performance = None
    if total is not None and run_s > 0 and nominal_tpm > 0:
        performance = min(1.0, total / (run_s / 60 * nominal_tpm))
    q = quality(good, total, reject)
    oee = None
    if availability is not None and performance is not None and q is not None:
        oee = availability * performance * q
    return {"availability": availability, "performance": performance, "quality": q, "oee": oee}


def counter_increments(boundary_values: list[float | None]) -> list[int | None]:
    """Per-interval increments of a shift counter sampled at bucket boundaries.

    A decrease means the counter was reset (new shift), so the new value is the increment.
    """
    out: list[int | None] = []
    for prev, cur in zip(boundary_values, boundary_values[1:], strict=False):
        if cur is None:
            out.append(None)
        elif prev is None or cur < prev:
            out.append(round(cur))
        else:
            out.append(round(cur - prev))
    return out


# --------------------------------------------------------------------------- composition
def _last_value_at(conn: sqlite3.Connection, tag: str, ts: datetime) -> float | None:
    row = conn.execute(
        "SELECT value FROM data_points WHERE tag = ? AND timestamp <= ? ORDER BY timestamp DESC, id DESC LIMIT 1",
        (tag, to_db_ts(ts)),
    ).fetchone()
    return _num(row[0]) if row else None


async def hourly_good(
    data_logger,
    tag: str,
    buckets: list[dict],
    now: datetime,
    shift_start: datetime | None = None,
    shift_end: datetime | None = None,
) -> list[dict]:
    """Good tiles per local clock hour of the shift (from the logged counter values)."""
    if not buckets:
        return []
    now_utc = now.astimezone(timezone.utc)
    boundaries = [buckets[0]["start"]] + [min(b["end"], now_utc) for b in buckets]

    def _query(conn):
        return [_last_value_at(conn, tag, ts) for ts in boundaries]

    values = await data_logger.db.run_async(_query)
    increments = counter_increments(values)
    rows = []
    for bucket, inc in zip(buckets, increments, strict=True):
        future = bucket["start"] >= now_utc
        lo = max(bucket["start"], shift_start) if shift_start else bucket["start"]
        hi = min(bucket["end"], now_utc, shift_end) if shift_end else min(bucket["end"], now_utc)
        rows.append(
            {
                "time": bucket["time"],
                "good": None if future else inc,
                # seconds of this hour that are inside the shift and already passed
                "elapsed_s": max(0.0, (hi - lo).total_seconds()),
            }
        )
    return rows


async def compute_oee_details(
    data_store, shift_logger, data_logger, nominal_tpm: float, now: datetime | None = None
) -> dict:
    """Everything the OEE screen needs, JSON-serialisable. Missing inputs -> None fields."""
    from backend.opc.shift_logger import hour_buckets

    now = now or utcnow()
    counts = production_counts(
        data_store.get("GoodCount"), data_store.get("ProductionCount"), data_store.get("RejectCount")
    )
    good, reject, total, good_tag = counts["good"], counts["reject"], counts["total"], counts["source"]
    speed = _num(data_store.get("TPM"))
    shift_target = _num(data_store.get("ShiftTarget"))

    result: dict[str, Any] = {
        "nominal_tpm": nominal_tpm,
        "oee_target": oee_target(data_store.get("OeeTarget")),
        "counts": {
            "good": good,
            "reject": reject,
            "total": total,
            "scrap_pct": (reject / total * 100) if reject is not None and total else None,
            "good_source": good_tag,
        },
        "speed": {
            "current": speed,
            "nominal": nominal_tpm,
            "pct": (speed / nominal_tpm * 100) if speed is not None and nominal_tpm else None,
        },
        "shift": None,
        "target": None,
        "stops": None,
        "oee": {"availability": None, "performance": None, "quality": None, "oee": None},
        "hourly": [],
    }

    try:
        start, end = await shift_logger.get_current_shift_window(now=now)
    except RuntimeError as e:
        logger.debug("OEE details without shift window: %s", e)
        return result

    progress = shift_progress(start, end, now)
    segments = await shift_logger.get_state_segments(start, end, now)
    stops = stop_stats(segments)
    tgt = targets(progress["elapsed_s"], progress["duration_s"], shift_target)

    result["shift"] = {"start": start.isoformat(), "end": end.isoformat(), **progress}
    result["target"] = {
        **tgt,
        "source": "ShiftTarget" if tgt["shift"] is not None else None,
        "prognosis": prognosis(good, progress["elapsed_s"], progress["duration_s"]),
        "progress_pct": (good / tgt["shift"] * 100) if good is not None and tgt["shift"] else None,
    }
    result["stops"] = stops
    # Without any state info we cannot tell run time, so availability/performance stay unknown
    if segments:
        result["oee"] = oee_factors(stops["run_s"], progress["elapsed_s"], total, good, nominal_tpm, reject)
    else:
        result["oee"]["quality"] = quality(good, total, reject)
    try:
        result["hourly"] = await hourly_good(
            data_logger,
            good_tag,
            hour_buckets(start, end, shift_logger.tz),
            now,
            start.astimezone(timezone.utc),
            end.astimezone(timezone.utc),
        )
    except Exception:
        logger.exception("Failed to compute hourly good counts")
    return result
