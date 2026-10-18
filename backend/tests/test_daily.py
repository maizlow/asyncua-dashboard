"""7-day history (screen type: week): day boundaries, midnight split, DST, missing days, caching."""

from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.opc.daily import (
    DailyHistory,
    day_counts,
    day_windows,
    shift_windows_for_day,
)
from backend.opc.data_logger import DataLogger
from backend.opc.shift_logger import ShiftLogger

STHLM = ZoneInfo("Europe/Stockholm")


def local(y, mo, d, h=0, mi=0):
    return datetime(y, mo, d, h, mi, tzinfo=STHLM)


# ----------------------------------------------------------------- pure helpers
def test_day_windows_are_local_midnights_oldest_first():
    days = day_windows(7, local(2026, 10, 18, 21, 30), STHLM)
    assert [d for d, _, _ in days] == [date(2026, 10, 12) + timedelta(days=i) for i in range(7)]
    d, start, end = days[-1]
    assert start == local(2026, 10, 18) and end == local(2026, 10, 19)
    assert all(e == s2 for (_, _, e), (_, s2, _) in zip(days, days[1:], strict=False))  # contiguous


def test_dst_days_are_23_and_25_hours():
    fall = {d: (e - s) for d, s, e in day_windows(3, local(2026, 10, 26, 12), STHLM)}
    assert fall[date(2026, 10, 25)] == timedelta(hours=25)
    assert fall[date(2026, 10, 24)] == fall[date(2026, 10, 26)] == timedelta(hours=24)
    spring = {d: (e - s) for d, s, e in day_windows(2, local(2026, 3, 30, 12), STHLM)}
    assert spring[date(2026, 3, 29)] == timedelta(hours=23)


def test_shift_windows_for_day_include_previous_overnight_shift():
    w = shift_windows_for_day(date(2026, 10, 14), time(22), time(6), STHLM)
    assert w == [
        (local(2026, 10, 13, 22).astimezone(timezone.utc), local(2026, 10, 14, 6).astimezone(timezone.utc)),
        (local(2026, 10, 14, 22).astimezone(timezone.utc), local(2026, 10, 15, 6).astimezone(timezone.utc)),
    ]


def test_day_counts_same_rules_as_live():
    assert day_counts(34_440, None, 700) == {"good": 34_440, "reject": 700, "total": 35_140, "source": "GoodCount"}
    assert day_counts(None, 35_140, 700)["good"] == 34_440
    assert day_counts(None, 35_140, None) == {"good": 35_140, "reject": None, "total": 35_140, "source": "ProductionCount"}


# ----------------------------------------------------------------- with SQLite
async def _setup(db):
    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    dl = DataLogger(db)
    await sl.init_db()
    await dl.init_db()
    return sl, dl


def _by_date(result):
    return {r["date"]: r for r in result["days"]}


async def test_overnight_shift_is_split_at_local_midnight(db):
    """22:00-06:00 at 140/min x 85 %: production and run time go to the calendar day they happened."""
    sl, dl = await _setup(db)
    # Night 13->14 Oct: runs the whole shift; counter reset at 22:00, logged every hour
    sl.log_state_change("Stopped", ts=local(2026, 10, 13, 12))
    sl.log_state_change("Running", ts=local(2026, 10, 13, 22))
    sl.log_state_change("Stopped", ts=local(2026, 10, 14, 6))
    for m in range(481):  # every minute 22:00 .. 06:00 (in practice the PLC counter is logged ~1/s)
        ts = local(2026, 10, 13, 22) + timedelta(minutes=m)
        dl.log_value("ProductionCount", m * 119, ts=ts)  # 119 tiles/min = 85 % of 140
        dl.log_value("RejectCount", m * 2, ts=ts)
    dl.log_value("ShiftTarget", 57_120, ts=local(2026, 10, 13, 21))
    db.flush()

    store = {"ShiftStart": "22:00:00", "ShiftEnd": "06:00:00"}
    h = DailyHistory(dl, sl, 140, retention_days=30)
    res = await h.compute(store, n=7, now=local(2026, 10, 16, 12))
    days = _by_date(res)

    d13, d14 = days["2026-10-13"], days["2026-10-14"]
    # Increments are attributed to the day they were logged: rows 22:01..23:59 -> 13th, 00:00..06:00 -> 14th
    assert d13["total"] == 119 * 119 and d13["reject"] == 119 * 2
    assert d14["total"] == 361 * 119 and d14["good"] == 361 * 117
    assert d13["total"] + d14["total"] == 480 * 119  # nothing lost or double counted at midnight
    assert d13["run_s"] == 2 * 3600 and d14["run_s"] == 6 * 3600
    assert d13["planned_s"] == 2 * 3600 and d14["planned_s"] == 6 * 3600 and d14["stop_s"] == 0
    assert d13["target"] == 57_120 * 2 // 8 and d14["target"] == 57_120 * 6 // 8
    # A = 1, P = total / (360 min x 140) < 1, so OEE = good / (planned min x 140) ~ 0.838
    assert d14["oee"]["oee"] == pytest.approx(361 * 117 / (360 * 140))
    assert d13["oee"]["availability"] == 1.0
    # The 14th's own night shift (22:00) never ran -> not planned, no target
    assert d14["target"] == 57_120 * 6 // 8
    assert days["2026-10-15"]["has_data"] is False


async def test_missing_days_show_no_values(db):
    sl, dl = await _setup(db)
    dl.log_value("GoodCount", 100, ts=local(2026, 10, 15, 10))
    db.flush()
    res = await DailyHistory(dl, sl, 140).compute({}, n=7, now=local(2026, 10, 18, 12))
    days = _by_date(res)
    assert len(res["days"]) == 7 and res["days"][-1]["today"] is True
    empty = days["2026-10-12"]
    assert empty["has_data"] is False and empty["good"] is None and empty["oee"]["oee"] is None
    # Data but no shift times known: counts yes, planned/OEE unknown
    d15 = days["2026-10-15"]
    assert d15["has_data"] and d15["good"] == 100 and d15["planned_s"] is None and d15["oee"]["oee"] is None
    # Next day: GoodCount known (value before the day) but unchanged -> 0 only if something was logged that day
    assert days["2026-10-16"]["has_data"] is False


async def test_counter_reset_and_dst_day(db):
    """25 h day (DST end): reset at shift start counts the new value; the extra hour is included."""
    sl, dl = await _setup(db)
    store = {"ShiftStart": "00:00:00", "ShiftEnd": "00:00:00"}  # 24 h "shift" from midnight
    sl.log_state_change("Running", ts=local(2026, 10, 24, 23))
    dl.log_value("GoodCount", 50_000, ts=local(2026, 10, 24, 23, 30))  # previous day's last value
    # 25 Oct: reset after midnight, then +1000 per real hour (25 h)
    start = local(2026, 10, 25).astimezone(timezone.utc)
    for i in range(26):
        dl.log_value("GoodCount", i * 1000, ts=start + timedelta(hours=i, minutes=1 if i == 0 else 0))
    db.flush()
    res = await DailyHistory(dl, sl, 140).compute(store, n=2, now=local(2026, 10, 26, 12))
    d = _by_date(res)["2026-10-25"]
    assert d["good"] == 24_000  # 0 (reset) + 24 increments of 1000 within the 25 h day
    assert d["run_s"] == 25 * 3600 and d["planned_s"] == 25 * 3600


async def test_past_days_are_cached_today_is_refreshed(db):
    sl, dl = await _setup(db)
    store = {"ShiftStart": "06:00:00", "ShiftEnd": "14:00:00"}
    sl.log_state_change("Running", ts=local(2026, 10, 17, 6))
    dl.log_value("GoodCount", 1000, ts=local(2026, 10, 17, 8))
    dl.log_value("GoodCount", 2000, ts=local(2026, 10, 18, 8))
    db.flush()
    h = DailyHistory(dl, sl, 140)
    now = local(2026, 10, 18, 9)
    first = _by_date(await h.compute(store, n=7, now=now))
    assert first["2026-10-17"]["good"] == 1000 and first["2026-10-18"]["good"] == 1000  # 1000 -> 2000

    dl.log_value("GoodCount", 500, ts=local(2026, 10, 17, 7))  # late row in a past day: cached, ignored
    dl.log_value("GoodCount", 2500, ts=local(2026, 10, 18, 8, 30))
    db.flush()
    second = _by_date(await h.compute(store, n=7, now=now + timedelta(minutes=5)))
    assert second["2026-10-17"]["good"] == 1000
    assert second["2026-10-18"]["good"] == 1500
    assert h.latest is not None and h.latest["days"][-1]["today"]


def test_history_days_route_is_not_shadowed_by_tag_history(monkeypatch):
    from fastapi.testclient import TestClient

    import backend.opc.daily as daily
    from backend.app.main import create_app

    class Fake:
        latest = {"days": [], "marker": True}

    monkeypatch.setattr(daily, "get_daily_history", lambda: Fake())
    r = TestClient(create_app()).get("/api/history/days")
    assert r.status_code == 200 and r.json()["marker"] is True
