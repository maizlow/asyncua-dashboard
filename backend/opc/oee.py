"""OEE details for the display (roof tile line).

Definitions (planned production time = elapsed shift time; planned breaks are not modelled):
- Tillgänglighet (availability) A = run time / planned time
- Prestanda (performance)       P = total count / (run time [min] x nominal rate), capped at 1
- Kvalitet (quality)            Q = good / total
- OEE = A x P x Q  (equivalent to good / (planned time x nominal rate) when P <= 1)
- Mål hittills (target so far) = elapsed minutes x nominal rate; skiftmål = shift minutes x nominal rate
- Prognos = good / elapsed x shift duration (current average pace, incl. stops)

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


def targets(elapsed_s: float, duration_s: float, nominal_tpm: float) -> dict:
    return {
        "so_far": round(elapsed_s / 60 * nominal_tpm),
        "shift": round(duration_s / 60 * nominal_tpm),
    }


def prognosis(good: float | None, elapsed_s: float, duration_s: float) -> int | None:
    """Expected good count at shift end at the current average pace."""
    if good is None or elapsed_s < MIN_ELAPSED_FOR_PROGNOSIS_S or duration_s <= 0:
        return None
    return round(good / elapsed_s * duration_s)


def oee_factors(
    run_s: float, planned_s: float, total: float | None, good: float | None, nominal_tpm: float
) -> dict:
    """A, P, Q and OEE as fractions (0..1); None where undefined."""
    availability = min(1.0, run_s / planned_s) if planned_s > 0 else None
    performance = None
    if total is not None and run_s > 0 and nominal_tpm > 0:
        performance = min(1.0, total / (run_s / 60 * nominal_tpm))
    quality = good / total if good is not None and total else None
    oee = None
    if availability is not None and performance is not None and quality is not None:
        oee = availability * performance * quality
    return {"availability": availability, "performance": performance, "quality": quality, "oee": oee}


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
    good_tag = "GoodCount" if data_store.get("GoodCount") is not None else "ProductionCount"
    good = _num(data_store.get(good_tag))
    reject = _num(data_store.get("RejectCount"))
    total = good + reject if good is not None and reject is not None else good
    speed = _num(data_store.get("TPM"))

    result: dict[str, Any] = {
        "nominal_tpm": nominal_tpm,
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
    tgt = targets(progress["elapsed_s"], progress["duration_s"], nominal_tpm)

    result["shift"] = {"start": start.isoformat(), "end": end.isoformat(), **progress}
    result["target"] = {
        **tgt,
        "prognosis": prognosis(good, progress["elapsed_s"], progress["duration_s"]),
        "progress_pct": (good / tgt["shift"] * 100) if good is not None and tgt["shift"] else None,
    }
    result["stops"] = stops
    # Without any state info we cannot tell run time, so availability/performance stay unknown
    if segments:
        result["oee"] = oee_factors(stops["run_s"], progress["elapsed_s"], total, good, nominal_tpm)
    else:
        result["oee"]["quality"] = good / total if good is not None and total else None
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
