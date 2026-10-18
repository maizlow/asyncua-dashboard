import time as _time
from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.opc.shift_logger import ShiftLogger, parse_time_of_day, resolve_shift_window

STHLM = ZoneInfo("Europe/Stockholm")


def utc(dt):
    # Note: subtracting two datetimes with the *same* tzinfo ignores offsets in Python,
    # so real elapsed time must be computed in UTC.
    return dt.astimezone(timezone.utc)


def local(y, mo, d, h, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=STHLM)


@pytest.mark.parametrize(
    ("now", "expected_start", "expected_end"),
    [
        # Day shift 06:00-18:00
        (local(2026, 6, 10, 10), local(2026, 6, 10, 6), local(2026, 6, 10, 18)),
        (local(2026, 6, 10, 20), local(2026, 6, 10, 6), local(2026, 6, 10, 18)),  # after shift
        (local(2026, 6, 10, 4), local(2026, 6, 9, 6), local(2026, 6, 9, 18)),  # before shift -> last one
    ],
)
def test_day_shift(now, expected_start, expected_end):
    start, end = resolve_shift_window(time(6), time(18), now, STHLM)
    assert (start, end) == (expected_start, expected_end)


@pytest.mark.parametrize(
    ("now", "expected_start", "expected_end"),
    [
        (local(2026, 6, 10, 23), local(2026, 6, 10, 22), local(2026, 6, 11, 6)),  # before midnight
        (local(2026, 6, 11, 2), local(2026, 6, 10, 22), local(2026, 6, 11, 6)),  # after midnight
        (local(2026, 6, 11, 0, 0), local(2026, 6, 10, 22), local(2026, 6, 11, 6)),  # exactly midnight
        (local(2026, 6, 11, 22, 0), local(2026, 6, 11, 22), local(2026, 6, 12, 6)),  # shift start instant
        (local(2026, 6, 11, 10), local(2026, 6, 10, 22), local(2026, 6, 11, 6)),  # between shifts
    ],
)
def test_overnight_shift(now, expected_start, expected_end):
    start, end = resolve_shift_window(time(22), time(6), now, STHLM)
    assert (start, end) == (expected_start, expected_end)


def test_now_in_utc_is_converted_to_plant_time():
    # 2026-06-10 21:30 UTC == 23:30 in Stockholm (CEST): inside tonight's 22-06 shift
    now = datetime(2026, 6, 10, 21, 30, tzinfo=timezone.utc)
    start, end = resolve_shift_window(time(22), time(6), now, STHLM)
    assert start == local(2026, 6, 10, 22)
    assert end == local(2026, 6, 11, 6)


def test_overnight_shift_across_dst_spring_forward_is_7h():
    # Clocks go 02:00 -> 03:00 on 2026-03-29 in Stockholm
    start, end = resolve_shift_window(time(22), time(6), local(2026, 3, 29, 4), STHLM)
    assert start == local(2026, 3, 28, 22)
    assert end == local(2026, 3, 29, 6)
    assert utc(end) - utc(start) == timedelta(hours=7)
    assert start.utcoffset() == timedelta(hours=1) and end.utcoffset() == timedelta(hours=2)


def test_overnight_shift_across_dst_fall_back_is_9h():
    # Clocks go 03:00 -> 02:00 on 2026-10-25 in Stockholm
    start, end = resolve_shift_window(time(22), time(6), local(2026, 10, 25, 1), STHLM)
    assert utc(end) - utc(start) == timedelta(hours=9)


def test_system_local_timezone_is_used_when_no_zone_configured(monkeypatch):
    if not hasattr(_time, "tzset"):
        pytest.skip("tzset not available")
    monkeypatch.setenv("TZ", "Europe/Stockholm")
    _time.tzset()
    try:
        now = datetime(2026, 3, 29, 1, 30, tzinfo=timezone.utc)  # 03:30 local, after spring forward
        start, end = resolve_shift_window(time(22), time(6), now, None)
        assert start == local(2026, 3, 28, 22)
        assert end == local(2026, 3, 29, 6)
        assert utc(end) - utc(start) == timedelta(hours=7)
    finally:
        monkeypatch.undo()
        _time.tzset()


def test_naive_now_is_rejected():
    with pytest.raises(ValueError):
        resolve_shift_window(time(6), time(18), datetime(2026, 1, 1, 10), STHLM)


def test_parse_time_of_day():
    assert parse_time_of_day("06:00:00") == time(6)
    assert parse_time_of_day("22:30") == time(22, 30)
    with pytest.raises(ValueError):
        parse_time_of_day("")


async def _logger(db):
    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    await sl.init_db()
    return sl


async def test_shift_pattern_overnight_is_chronological_and_capped_at_now(db):
    sl = await _logger(db)
    start, end = local(2026, 6, 10, 22), local(2026, 6, 11, 6)
    sl.log_state_change("Running", ts=local(2026, 6, 10, 21))  # before shift -> carries over
    sl.log_state_change("Stopped", ts=local(2026, 6, 10, 23, 30))
    sl.log_state_change("Running", ts=local(2026, 6, 11, 0, 15))
    db.flush()

    rows = await sl.get_shift_pattern(start, end, now=local(2026, 6, 11, 1, 30))
    assert [r["time"] for r in rows] == ["22:00", "23:00", "00:00", "01:00", "02:00", "03:00", "04:00", "05:00"]
    by_time = {r["time"]: r for r in rows}
    assert by_time["22:00"] == {"time": "22:00", "end": "23:00", "minutes": 60.0, "running": 60.0, "stopped": 0.0}
    assert by_time["23:00"] == {"time": "23:00", "end": "00:00", "minutes": 60.0, "running": 30.0, "stopped": 30.0}
    assert by_time["00:00"] == {"time": "00:00", "end": "01:00", "minutes": 60.0, "running": 45.0, "stopped": 15.0}
    assert by_time["01:00"] == {"time": "01:00", "end": "02:00", "minutes": 60.0, "running": 30.0, "stopped": 0.0}
    assert all(r["running"] == r["stopped"] == 0 for r in rows[4:])  # future not counted


async def test_shift_pattern_dst_fall_back_has_nine_hours(db):
    sl = await _logger(db)
    start, end = local(2026, 10, 24, 22), local(2026, 10, 25, 6)
    sl.log_state_change("Running", ts=start)
    db.flush()
    rows = await sl.get_shift_pattern(start, end, now=end + timedelta(hours=1))
    assert len(rows) == 9
    assert [r["time"] for r in rows].count("02:00") == 2  # repeated wall-clock hour kept separate
    assert sum(r["running"] for r in rows) == pytest.approx(9 * 60)


async def test_shift_pattern_no_data_is_all_zero(db):
    sl = await _logger(db)
    rows = await sl.get_shift_pattern(local(2026, 6, 10, 6), local(2026, 6, 10, 18), now=local(2026, 6, 10, 12))
    assert len(rows) == 12
    assert all(r["running"] == 0 and r["stopped"] == 0 for r in rows)


async def test_get_current_shift_window_uses_plc_values(db, monkeypatch):
    from backend.opc.state_store import data_store

    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    monkeypatch.setattr(data_store, "_data", {"ShiftStart": "22:00:00", "ShiftEnd": "06:00:00"})
    start, end = await sl.get_current_shift_window(now=local(2026, 6, 11, 2))
    assert (start, end) == (local(2026, 6, 10, 22), local(2026, 6, 11, 6))

    monkeypatch.setattr(data_store, "_data", {})
    with pytest.raises(RuntimeError):
        await sl.get_current_shift_window()


async def test_shift_pattern_buckets_follow_a_half_hour_shift_start(db):
    """06:30-14:30 is 8 buckets 06:30..13:30 (not 9 clock hours 06:00..14:00)."""
    sl = await _logger(db)
    start, end = local(2026, 6, 10, 6, 30), local(2026, 6, 10, 14, 30)
    sl.log_state_change("Running", ts=start)
    sl.log_state_change("Stopped", ts=local(2026, 6, 10, 7, 0))
    sl.log_state_change("Running", ts=local(2026, 6, 10, 7, 10))
    db.flush()
    rows = await sl.get_shift_pattern(start, end, now=end)
    assert len(rows) == 8
    assert rows[0] == {"time": "06:30", "end": "07:30", "minutes": 60.0, "running": 50.0, "stopped": 10.0}
    assert rows[-1]["time"] == "13:30" and rows[-1]["end"] == "14:30"
    assert sum(r["minutes"] for r in rows) == 8 * 60
    assert sum(r["running"] + r["stopped"] for r in rows) == pytest.approx(8 * 60)


async def test_shift_pattern_partial_last_bucket(db):
    """An 8.5 h shift ends with a 30-minute bucket; nothing outside the shift is counted."""
    sl = await _logger(db)
    start, end = local(2026, 6, 10, 6), local(2026, 6, 10, 14, 30)
    sl.log_state_change("Running", ts=local(2026, 6, 10, 5))
    db.flush()
    rows = await sl.get_shift_pattern(start, end, now=local(2026, 6, 10, 16))
    assert len(rows) == 9
    assert rows[-1] == {"time": "14:00", "end": "14:30", "minutes": 30.0, "running": 30.0, "stopped": 0.0}
    assert sum(r["minutes"] for r in rows) == 510
