"""History aggregates for the chart elements: days, period sums, per-shift rows, segments, endpoint."""

import pytest
from fastapi.testclient import TestClient

from backend.opc.aggregates import combine_days, compute_aggregates, get_aggregate_cache, scrap_pct
from backend.opc.daily import DailyHistory

from .test_shifts import L, Line, _shift, utc

R = 140


@pytest.fixture
async def line(db):
    return await Line(db).init()


async def save(line, *rows, since=None):
    for r in rows:
        r.update(id=None, opened=r["start"], count_from={}, params={})
        await line.store.save(r)
    await line.store.set_log_since(utc(since or L(1, 0)))
    line.db.flush()


def no_window(line):
    async def _raise(now=None):
        raise RuntimeError("no ShiftStart")

    line.sl.get_current_shift_window = _raise


async def agg(line, now):
    h = DailyHistory(line.dl, line.sl, R, 30, line.store)
    return await compute_aggregates(h, {}, line.store, line.sl, R, connection="plc2", now=utc(now))


async def test_two_shift_days_today_yesterday_sums_and_shift_rows(line):
    no_window(line)
    await save(
        line,
        _shift(L(15, 6), L(15, 14), good=50_000, total=51_000, reject=1_000, run=7 * 3600, planned=8 * 3600,
               target=54_000, goal=85, team="A"),
        _shift(L(15, 14), L(15, 22), good=40_000, total=42_000, reject=2_000, run=6 * 3600, planned=8 * 3600,
               target=54_000, goal=85, team="B"),
        _shift(L(16, 6), L(16, 14), good=45_000, total=45_500, reject=500, run=8 * 3600, planned=8 * 3600,
               target=54_000, team="A"),
        _shift(L(16, 14), L(16, 22), good=44_000, total=45_000, reject=1_000, run=7 * 3600, planned=8 * 3600,
               target=54_000, team="B"),
        _shift(L(17, 6), L(17, 14), good=20_000, total=20_400, reject=400, run=3 * 3600, planned=8 * 3600,
               target=54_000, team="A", closed=False),
    )
    a = await agg(line, L(17, 10))
    assert a["connection"] == "plc2" and len(a["days"]) == 30
    assert a["days"][-1]["date"] == "2026-10-17" and a["days"][0]["date"] == "2026-09-18"
    y, t = a["yesterday"], a["today"]
    assert y["date"] == "2026-10-16" and y["good"] == 89_000 and y["target"] == 108_000
    assert y["scrap_pct"] == pytest.approx(1_500 / 90_500 * 100)
    # the open shift counts so far: 4 of 8 h planned, target pro rata
    assert t["good"] == 20_000 and t["planned_s"] == 4 * 3600 and t["target"] == 27_000
    s7 = a["sums"]["7"]
    good, total, run, planned = 50_000 + 40_000 + 89_000 + 20_000, 51_000 + 42_000 + 90_500 + 20_400, \
        (7 + 6 + 8 + 7 + 3) * 3600, (32 + 4) * 3600
    assert s7["days"] == 3 and s7["good"] == good and s7["total"] == total and s7["planned_s"] == planned
    assert s7["oee"]["availability"] == pytest.approx(run / planned)
    assert s7["oee"]["performance"] == pytest.approx(total / (run / 60 * R))
    assert s7["oee"]["quality"] == pytest.approx(good / total)
    assert s7["oee"]["oee"] == pytest.approx(good / (planned / 60 * R))
    assert s7["teams"] == ["A", "B"] and s7["target"] == 4 * 54_000 + 27_000
    assert a["sums"]["30"]["good"] == good
    # per-shift rows: oldest first, the open one last and as current_shift
    shifts = a["shifts"]
    assert [s["team"] for s in shifts] == ["A", "B", "A", "B", "A"]
    assert shifts[1]["good"] == 40_000 and shifts[1]["oee"]["oee"] == pytest.approx(40_000 / (8 * 60 * R))
    assert shifts[1]["scrap_pct"] == pytest.approx(2_000 / 42_000 * 100)
    assert a["current_shift"]["status"] == "open" and a["current_shift"]["good"] == 20_000
    assert a["current_shift"]["target"] == 27_000


async def test_night_shift_split_at_midnight_in_days_but_whole_in_shift_rows(line):
    no_window(line)
    await save(line, _shift(L(15, 22), L(16, 6), good=40_000, total=41_000, reject=1_000, run=8 * 3600,
                            planned=8 * 3600, target=56_000, team="C"))
    a = await agg(line, L(17, 12))
    days = {d["date"]: d for d in a["days"]}
    assert days["2026-10-15"]["good"] == 10_000 and days["2026-10-16"]["good"] == 30_000
    assert days["2026-10-15"]["target"] == 14_000 and days["2026-10-16"]["target"] == 42_000
    assert days["2026-10-17"]["has_data"] is False
    (night,) = a["shifts"]
    assert night["good"] == 40_000 and night["target"] == 56_000 and night["planned_s"] == 8 * 3600
    s = a["sums"]["7"]
    assert s["good"] == 40_000 and s["days"] == 2 and s["target"] == 56_000
    assert s["oee"]["oee"] == pytest.approx(night["oee"]["oee"])
    assert a["current_shift"] is None


async def test_missing_data_gives_nulls_not_zeros(line):
    no_window(line)
    a = await agg(line, L(17, 12))
    assert len(a["days"]) == 30 and not any(d["has_data"] for d in a["days"])
    assert a["today"]["good"] is None and a["today"]["scrap_pct"] is None
    for n in ("7", "14", "30"):
        s = a["sums"][n]
        assert s["has_data"] is False and s["good"] is None and s["planned_s"] is None
        assert s["oee"] == {"availability": None, "performance": None, "quality": None, "oee": None}
    assert a["shifts"] == [] and a["current_shift"] is None
    assert a["shift_window"] is None and a["segments"] == []


def test_missing_reject_count_leaves_quality_and_oee_unknown():
    day = {"has_data": True, "good": 900, "total": 1000, "reject": 100, "run_s": 3600, "planned_s": 7200}
    blind = {**day, "reject": None}
    s = combine_days([day, blind, {"has_data": False}], R)
    assert s["days"] == 2 and s["good"] == 1800 and s["total"] == 2000
    assert s["oee"]["availability"] == pytest.approx(0.5)
    assert s["oee"]["quality"] is None and s["oee"]["oee"] is None and s["reject"] is None
    assert s["scrap_pct"] is None
    assert scrap_pct({"reject": 0, "total": 0}) is None and scrap_pct({"reject": 5, "total": 100}) == 5


async def test_segments_of_current_shift_window(line):
    start, end = utc(L(17, 6)), utc(L(17, 14))

    async def window(now=None):
        return start, end

    line.sl.get_current_shift_window = window
    line.state(True, L(17, 5))
    line.state(False, L(17, 7))
    line.state(False, L(17, 7, 5))  # repeated state: merged
    line.state(True, L(17, 7, 30))
    line.db.flush()
    await save(line)
    a = await agg(line, L(17, 8))
    assert a["shift_window"] == {"start": start.isoformat(), "end": end.isoformat()}
    segs = a["segments"]
    assert [s["running"] for s in segs] == [True, False, True]
    assert segs[0]["start"] == start.isoformat() and segs[-1]["end"] == utc(L(17, 8)).isoformat()
    assert segs[1]["end"] == utc(L(17, 7, 30)).isoformat()


def test_aggregates_endpoint_serves_cache_and_computes_when_empty(db, monkeypatch):
    import asyncio

    import backend.opc.daily as daily
    import backend.opc.shifts as shifts
    from backend.app.main import create_app

    line = asyncio.run(Line(db).init())
    h = DailyHistory(line.dl, line.sl, R, 30, line.store)
    monkeypatch.setattr(daily, "get_daily_history", lambda: h)
    monkeypatch.setattr(shifts, "get_shift_store", lambda: line.store)
    cache = get_aggregate_cache()
    monkeypatch.setattr(cache, "latest", None)
    client = TestClient(create_app())
    r = client.get("/api/aggregates")
    assert r.status_code == 200
    body = r.json()
    assert len(body["days"]) == 30 and set(body["sums"]) == {"7", "14", "30"} and body["shifts"] == []
    cache.latest = {"cached": True}
    assert client.get("/api/aggregates").json() == {"cached": True}
    assert client.post("/api/aggregates").status_code == 405


async def test_short_window_does_not_evict_cached_long_window_days(line):
    await save(line, _shift(L(1, 6), L(1, 14), good=1_000, total=1_000, run=3600, planned=3600), since=L(1, 0, mo=9))
    h = DailyHistory(line.dl, line.sl, R, 30, line.store)
    await h.compute({}, n=30, now=utc(L(17, 12)))
    cached = len(h._past)
    await h.compute({}, n=7, now=utc(L(17, 12)))
    assert len(h._past) == cached == 29
