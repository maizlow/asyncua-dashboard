"""Shift log: boundary detection, settle window, out-of-order / delayed tags, counter resets,
restart, flapping, aggregation over shifts and the 7-day screen on top of it."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.opc.daily import DailyHistory
from backend.opc.data_logger import DataLogger
from backend.opc.shift_logger import ShiftLogger, parse_time_of_day
from backend.opc.shifts import (
    ShiftStore,
    ShiftTracker,
    aggregate_shifts,
    live_planned,
    planned_seconds,
    resolve_end,
    resolve_start,
    shift_shares,
)

STHLM = ZoneInfo("Europe/Stockholm")


def L(d, h, mi=0, s=0, mo=10, y=2026):
    return datetime(y, mo, d, h, mi, s, tzinfo=STHLM)


def utc(dt):
    return dt.astimezone(timezone.utc)


class Line:
    """Test harness: PLC tag changes with explicit timestamps + tracker ticks."""

    def __init__(self, db, settle=10):
        self.db = db
        self.sl = ShiftLogger(db, tz_name="Europe/Stockholm")
        self.dl = DataLogger(db)
        self.store = ShiftStore(db)
        self.tracker = ShiftTracker(self.store, self.sl, settle_s=settle)
        self.queue = []

    async def init(self):
        await self.sl.init_db()
        await self.dl.init_db()
        await self.store.init_db(now=utc(L(14, 6)))  # shift log "installed" 14 Oct 06:00
        return self

    def tag(self, key, value, ts):
        """What DataStore.set does: log the value and notify the tracker."""
        self.dl.log_value(key, value, ts=ts)
        self.tracker.on_value(key, value, ts)

    def later(self, key, value, ts):
        """Tag change that the PLC delivers at ``ts``; applied by run() when the clock gets there."""
        self.queue.append((ts, key, value))

    def state(self, running, ts):
        self.sl.log_state_change("Running" if running else "Stopped", ts=ts)

    async def run(self, frm, to, step=1):
        t = frm
        while t <= to:
            for ev in sorted([e for e in self.queue if e[0] <= t], key=lambda e: e[0]):
                self.queue.remove(ev)
                self.tag(ev[1], ev[2], ev[0])
            self.db.flush()
            await self.tracker.tick(t)
            t += timedelta(seconds=step)

    async def rows(self):
        self.db.flush()
        return sorted(await self.store.recent(50), key=lambda r: r["start"])


@pytest.fixture
async def line(db):
    return await Line(db).init()


def params(line, ts, start, end, target=None, goal=None, team=None, planned=None):
    line.tag("ShiftStart", start, ts)
    line.tag("ShiftEnd", end, ts)
    for k, v in (("ShiftTarget", target), ("OeeTarget", goal), ("ShiftTeam", team), ("PlannedTime", planned)):
        if v is not None:
            line.tag(k, v, ts)


async def first_shift(line, at=None):
    """Shift A 06:00-14:00, team A, target 50 000, running from 06:00, counter from 0."""
    at = at or L(14, 6, 0, 1)
    line.state(True, L(14, 6))
    line.tag("ProductionCount", 0, L(14, 6))
    params(line, at, "06:00:00", "14:00:00", target=50_000, goal=85, team="A", planned=450)
    await line.run(at, at + timedelta(seconds=12))
    rows = await line.rows()
    assert len(rows) == 1 and rows[0]["status"] == "open"
    return rows[0]


# ----------------------------------------------------------------- pure helpers
def test_resolve_start_latest_occurrence_and_early_window():
    t = parse_time_of_day("14:00")
    assert resolve_start(t, utc(L(14, 15)), STHLM) == utc(L(14, 14))
    assert resolve_start(t, utc(L(14, 13, 58)), STHLM) == utc(L(13, 14))  # not started yet: yesterday's
    assert resolve_start(t, utc(L(14, 13, 58)), STHLM, early_s=1800) == utc(L(14, 14))  # fresh change, early
    assert resolve_end(utc(L(14, 22)), parse_time_of_day("06:00"), STHLM) == utc(L(15, 6))
    # DST night (25 Oct 2026): 22:00-06:00 is 9 h
    assert resolve_end(utc(L(24, 22)), parse_time_of_day("06:00"), STHLM) - utc(L(24, 22)) == timedelta(hours=9)


def test_planned_seconds_prefers_planned_time():
    s, e = utc(L(14, 6)), utc(L(14, 14))
    assert planned_seconds(450, s, e) == (27_000.0, "PlannedTime")
    assert planned_seconds(None, s, e) == (28_800.0, "schedule")
    assert planned_seconds("", s, e) == (28_800.0, "schedule")
    assert planned_seconds(-5, s, e) == (28_800.0, "schedule")  # invalid -> fallback
    assert planned_seconds(None, s, None) == (None, None)
    assert live_planned(450, 3600, 28_800) == {"so_far_s": 3375.0, "shift_s": 27_000.0, "source": "PlannedTime"}
    assert live_planned(None, 3600, 28_800)["so_far_s"] == 3600


# ----------------------------------------------------------------- timing / boundaries
async def test_params_after_shiftstart_go_to_new_shift_closing_keeps_old(line):
    a = await first_shift(line)
    assert (a["team"], a["target"], a["oee_target"], a["planned_s"]) == ("A", 50_000, 85, 27_000)
    # 14:00:00 ShiftStart/ShiftEnd change; target/goal arrive 3 s later, team and planned 5 s later
    line.later("ShiftStart", "14:00:00", L(14, 14))
    line.later("ShiftEnd", "22:00:00", L(14, 14))
    line.later("ShiftTarget", 48_000, L(14, 14, 0, 3))
    line.later("OeeTarget", 80, L(14, 14, 0, 3))
    line.later("ShiftTeam", "B", L(14, 14, 0, 5))
    line.later("PlannedTime", 420, L(14, 14, 0, 5))
    await line.run(L(14, 13, 59, 58), L(14, 14, 0, 9))
    assert len(await line.rows()) == 1 and line.tracker.pending  # still settling, nothing written
    await line.run(L(14, 14, 0, 10), L(14, 14, 0, 12))
    a, b = await line.rows()
    assert a["status"] == "closed" and a["closed"] == utc(L(14, 14))
    assert (a["team"], a["target"], a["oee_target"], a["planned_s"]) == ("A", 50_000, 85, 27_000)
    assert a["end"] == utc(L(14, 14))
    assert b["status"] == "open" and b["start"] == utc(L(14, 14)) and b["end"] == utc(L(14, 22))
    assert (b["team"], b["target"], b["oee_target"], b["planned_s"]) == ("B", 48_000, 80, 25_200)


async def test_params_arriving_before_shiftstart_do_not_leak_into_closing_shift(line):
    await first_shift(line)
    # New target/team arrive 4 s BEFORE ShiftStart; the open row is updated briefly ...
    line.later("ShiftTarget", 48_000, L(14, 13, 59, 56))
    line.later("ShiftTeam", "B", L(14, 13, 59, 56))
    await line.run(L(14, 13, 59, 55), L(14, 13, 59, 59))
    assert (await line.rows())[0]["team"] == "B"
    # ... but at the boundary the closing shift gets its values from before the settle window back
    line.later("ShiftStart", "14:00:00", L(14, 14))
    line.later("ShiftEnd", "22:00:00", L(14, 14, 0, 2))
    await line.run(L(14, 14), L(14, 14, 0, 13))
    a, b = await line.rows()
    assert (a["team"], a["target"]) == ("A", 50_000)
    assert (b["team"], b["target"]) == ("B", 48_000)
    assert b["end"] == utc(L(14, 22))  # ShiftEnd arrived 2 s after ShiftStart


async def test_late_counter_reset_counts_go_to_closing_shift(line):
    await first_shift(line)
    line.tag("ProductionCount", 50_000, L(14, 13, 59, 59))
    # Boundary at 14:00:00, but the PLC resets the counter 4 s later; 12 tiles in between are shift A's
    line.later("ShiftStart", "14:00:00", L(14, 14))
    line.later("ProductionCount", 50_012, L(14, 14, 0, 3))
    line.later("ProductionCount", 0, L(14, 14, 0, 4))
    line.later("ProductionCount", 9, L(14, 14, 0, 8))
    await line.run(L(14, 13, 59, 59), L(14, 14, 0, 12))
    a, b = await line.rows()
    assert a["total"] == 50_012 and b["total"] == 9
    assert b["count_from"]["ProductionCount"] == utc(L(14, 14, 0, 4))


async def test_early_counter_reset_counts_go_to_new_shift(line):
    await first_shift(line)
    line.later("ProductionCount", 50_000, L(14, 13, 59, 55))
    line.later("ProductionCount", 0, L(14, 13, 59, 57))  # reset 3 s before ShiftStart changes
    line.later("ProductionCount", 5, L(14, 13, 59, 59))
    line.later("ShiftStart", "14:00:00", L(14, 14))
    line.later("ProductionCount", 7, L(14, 14, 0, 1))
    await line.run(L(14, 13, 59, 55), L(14, 14, 0, 12))
    a, b = await line.rows()
    assert a["total"] == 50_000 and b["total"] == 7


async def test_counter_without_reset_uses_deltas_split_at_boundary(line):
    await first_shift(line)
    line.tag("ProductionCount", 50_000, L(14, 13, 59, 59))
    line.tag("ShiftStart", "14:00:00", L(14, 14))
    line.tag("ProductionCount", 50_010, L(14, 14, 0, 5))  # totaliser that never resets
    line.tag("ProductionCount", 51_000, L(14, 14, 30))
    await line.run(L(14, 14), L(14, 14, 0, 12))
    await line.run(L(14, 14, 30, 1), L(14, 14, 30, 1))
    a, b = await line.rows()
    assert a["total"] == 50_000 and b["total"] == 1_000


async def test_flapping_shiftstart_is_cancelled_within_settle(line):
    await first_shift(line)
    line.later("ShiftStart", "14:00:00", L(14, 13, 59))
    line.later("ShiftStart", "06:00:00", L(14, 13, 59, 2))  # glitch: back to the open shift's start
    await line.run(L(14, 13, 59), L(14, 13, 59, 1))
    assert line.tracker.pending is not None
    await line.run(L(14, 13, 59, 2), L(14, 13, 59, 20))
    assert len(await line.rows()) == 1 and line.tracker.pending is None
    # Duplicates of the same value (reconnect) never start a shift
    line.tracker.on_value("ShiftStart", "06:00:00", utc(L(14, 12, 5)))
    await line.run(L(14, 12, 5), L(14, 12, 5, 15))
    assert len(await line.rows()) == 1


async def test_second_change_within_settle_replaces_candidate(line):
    await first_shift(line)
    line.tag("ShiftStart", "14:00:00", L(14, 14))
    await line.run(L(14, 14), L(14, 14, 0, 3))
    line.tag("ShiftStart", "14:05:00", L(14, 14, 0, 4))  # corrected within the window
    await line.run(L(14, 14, 0, 4), L(14, 14, 0, 13))
    assert len(await line.rows()) == 1  # settle restarted at the second change
    await line.run(L(14, 14, 0, 14), L(14, 14, 0, 16))
    a, b = await line.rows()
    assert b["start"] == utc(L(14, 14, 5)) and b["opened"] == utc(L(14, 14)) and a["closed"] == utc(L(14, 14))


async def test_shiftstart_going_backwards_is_ignored(line):
    await first_shift(line)
    line.tag("ShiftStart", "22:00:00", L(14, 10))  # most recent 22:00 is yesterday: before the open shift
    await line.run(L(14, 10), L(14, 10, 0, 20))
    assert len(await line.rows()) == 1 and line.tracker.pending is None


async def test_early_switch_before_scheduled_start(line):
    await first_shift(line)
    line.tag("ShiftStart", "14:00:00", L(14, 13, 58))  # PLC switches 2 min early
    await line.run(L(14, 13, 58), L(14, 13, 58, 12))
    a, b = await line.rows()
    assert b["start"] == utc(L(14, 14)) and b["opened"] == utc(L(14, 13, 58)) and a["closed"] == utc(L(14, 13, 58))


async def test_single_shift_plant_boundary_by_clock(line):
    """ShiftStart is 06:00 every day and never changes: the next day's 06:00 closes the shift."""
    await first_shift(line)
    line.tag("ShiftEnd", "16:00:00", L(14, 6, 1))
    await line.run(L(15, 6) - timedelta(seconds=2), L(15, 6, 0, 12))
    a, b = await line.rows()
    assert a["closed"] == utc(L(15, 6)) and a["end"] == utc(L(14, 16))
    assert b["start"] == utc(L(15, 6)) and b["team"] == "A"


async def test_late_param_correction_while_open_last_value_wins(line):
    await first_shift(line)
    line.tag("ShiftTarget", 45_000, L(14, 10))
    await line.run(L(14, 10), L(14, 10, 0, 1))
    assert (await line.rows())[0]["target"] == 45_000
    line.tag("ShiftStart", "14:00:00", L(14, 14))
    await line.run(L(14, 14), L(14, 14, 0, 12))
    a, _b = await line.rows()
    assert a["target"] == 45_000  # the correction made during the shift is kept


async def test_missing_optional_tags(line):
    line.state(True, L(14, 6))
    line.tag("ShiftStart", "06:00:00", L(14, 6, 0, 1))
    line.tag("ShiftEnd", "14:00:00", L(14, 6, 0, 1))
    await line.run(L(14, 6, 0, 1), L(14, 6, 0, 12))
    (a,) = await line.rows()
    assert a["team"] is None and a["target"] is None and a["oee_target"] is None
    assert a["planned_source"] == "schedule" and a["planned_s"] == 8 * 3600
    assert a["good"] is None  # no counter tag at all


async def test_no_shiftstart_no_rows(line):
    line.tag("ShiftTarget", 1000, L(14, 6))
    await line.run(L(14, 6), L(14, 6, 0, 15))
    assert await line.rows() == []


async def test_restart_mid_shift_resumes_open_row(db, line):
    await first_shift(line)
    line.tag("ProductionCount", 20_000, L(14, 10))
    await line.run(L(14, 10), L(14, 10, 0, 1))
    # Backend restarts: new tracker, OPC re-sends the same values
    line2 = Line(db)
    line2.store, line2.sl, line2.dl = line.store, line.sl, line.dl
    line2.tracker = ShiftTracker(line.store, line.sl, settle_s=10)
    params(line2, L(14, 10, 5), "06:00:00", "14:00:00", target=50_000, goal=85, team="A", planned=450)
    await line2.run(L(14, 10, 5), L(14, 10, 5, 20))
    rows = await line2.rows()
    assert len(rows) == 1 and rows[0]["status"] == "open" and rows[0]["total"] == 20_000


async def test_restart_after_shift_change_closes_old_at_scheduled_start(db, line):
    await first_shift(line)
    line.tag("ProductionCount", 30_000, L(14, 12))
    await line.run(L(14, 12), L(14, 12, 0, 1))
    # Backend down 12:00 -> 15:00; meanwhile shift B started at 14:00 and the counter was reset
    line2 = Line(db)
    line2.store, line2.sl, line2.dl = line.store, line.sl, line.dl
    line2.tracker = ShiftTracker(line.store, line.sl, settle_s=10)
    line2.tag("ProductionCount", 6_000, L(14, 15))
    params(line2, L(14, 15), "14:00:00", "22:00:00", target=48_000, team="B")
    await line2.run(L(14, 15), L(14, 15, 0, 12))
    a, b = await line2.rows()
    assert a["closed"] == utc(L(14, 14)) and (a["team"], a["target"]) == ("A", 50_000)
    assert b["opened"] == utc(L(14, 14)) and (b["team"], b["target"]) == ("B", 48_000)
    assert a["total"] == 30_000 and b["total"] == 6_000  # reset seen as a decrease -> new value counts


async def test_run_time_and_stops_per_shift(line):
    await first_shift(line)
    line.state(False, L(14, 9))
    line.state(True, L(14, 9, 30))
    line.state(False, L(14, 13, 50))
    line.tag("ShiftStart", "14:00:00", L(14, 14))
    line.state(True, L(14, 14, 10))
    await line.run(L(14, 14), L(14, 14, 0, 12))
    await line.run(L(14, 15), L(14, 15))
    a, b = await line.rows()
    assert a["run_s"] == (8 * 3600 - 1800 - 600) and a["stop_count"] == 2 and a["stop_s"] == 2400
    assert b["run_s"] == 50 * 60 and b["stop_count"] == 1


# ----------------------------------------------------------------- aggregation
def _shift(start, end, *, good, total, run, planned, target=None, goal=None, team=None, src="schedule",
           closed=True, reject=0):
    return {"start": utc(start), "end": utc(end), "closed": utc(end) if closed else None,
            "status": "closed" if closed else "open", "good": good, "total": total, "reject": reject,
            "good_source": "GoodCount", "run_s": run, "planned_s": planned, "planned_source": src,
            "target": target, "oee_target": goal, "team": team, "stop_s": planned - run, "stop_count": 1}


def test_night_shift_split_at_midnight_by_time_share():
    night = _shift(L(13, 22), L(14, 6), good=48_000, total=49_000, run=8 * 3600, planned=8 * 3600, target=57_000)
    s13, s14 = shift_shares(night, utc(L(13, 0)), utc(L(14, 0)), utc(L(15, 0)))
    assert (s13, s14) == (0.25, 0.25)
    d14 = aggregate_shifts([night], utc(L(14, 0)), utc(L(15, 0)), utc(L(15, 12)), 140)
    assert d14["good"] == 36_000 and d14["target"] == 42_750 and d14["planned_s"] == 6 * 3600


def test_day_aggregate_recomputes_from_sums():
    R = 140
    a = _shift(L(14, 6), L(14, 14), good=50_000, total=51_000, run=7 * 3600, planned=8 * 3600,
               target=54_000, goal=85, team="A")
    b = _shift(L(14, 14), L(14, 22), good=40_000, total=42_000, run=6 * 3600, planned=7 * 3600,
               target=46_000, goal=80, team="B", src="PlannedTime")
    d = aggregate_shifts([a, b], utc(L(14, 0)), utc(L(15, 0)), utc(L(15, 12)), R)
    planned, run, good, total = 15 * 3600, 13 * 3600, 90_000, 93_000
    assert d["oee"]["availability"] == pytest.approx(run / planned)
    assert d["oee"]["performance"] == pytest.approx(total / (run / 60 * R))
    assert d["oee"]["quality"] == pytest.approx(good / total)
    assert d["oee"]["oee"] == pytest.approx(good / (planned / 60 * R))
    assert d["oee"]["oee"] == pytest.approx(d["oee"]["availability"] * d["oee"]["performance"] * d["oee"]["quality"])
    assert d["target"] == 100_000 and d["teams"] == ["A", "B"] and d["shifts"] == 2
    assert d["oee_target"] == pytest.approx((85 * 8 + 80 * 7) / 15)


def test_shift_without_run_time_is_unplanned_unless_planned_time_given():
    idle = _shift(L(17, 6), L(17, 14), good=0, total=0, run=0, planned=8 * 3600)
    assert aggregate_shifts([idle], utc(L(17, 0)), utc(L(18, 0)), utc(L(19, 0)), 140)["planned_s"] == 0
    broke = {**idle, "planned_source": "PlannedTime"}
    d = aggregate_shifts([broke], utc(L(17, 0)), utc(L(18, 0)), utc(L(19, 0)), 140)
    assert d["planned_s"] == 8 * 3600 and d["oee"]["availability"] == 0


def test_open_shift_counts_so_far_and_target_pro_rata():
    open_b = _shift(L(14, 14), L(14, 22), good=12_000, total=12_300, run=7000, planned=8 * 3600,
                    target=48_000, closed=False)
    d = aggregate_shifts([open_b], utc(L(14, 0)), utc(L(15, 0)), utc(L(14, 16)), 140)
    assert d["good"] == 12_000 and d["target"] == 12_000 and d["planned_s"] == 7200


# ----------------------------------------------------------------- 7-day screen on the shift log
async def test_week_uses_shift_log_for_covered_days_and_raw_before(line):
    a = await first_shift(line, at=L(14, 6, 0, 1))
    line.tag("ProductionCount", 50_000, L(14, 13, 59))
    line.tag("RejectCount", 0, L(14, 6))
    line.tag("ShiftStart", "14:00:00", L(14, 14))
    line.tag("ShiftEnd", "22:00:00", L(14, 14))
    line.tag("ProductionCount", 0, L(14, 14, 0, 1))
    await line.run(L(14, 14), L(14, 14, 0, 12))
    # 13 Oct: raw data only (before the shift log existed)
    line.tag("ProductionCount", 1, L(13, 10))
    line.state(True, L(13, 10))
    line.tag("ProductionCount", 7_000, L(13, 11))
    line.db.flush()
    h = DailyHistory(line.dl, line.sl, 140, 30, line.store)

    class Store(dict):
        pass

    res = await h.compute(Store(ShiftStart="14:00:00", ShiftEnd="22:00:00"), n=3, now=utc(L(15, 12)))
    days = {r["date"]: r for r in res["days"]}
    assert days["2026-10-13"]["source"] == "raw"
    assert days["2026-10-14"]["source"] == "raw"  # log started 06:00, not at midnight
    assert days["2026-10-15"]["source"] == "shifts"
    assert days["2026-10-15"]["has_data"] is False  # no shift overlaps 15 Oct -> "–"
    assert a["start"] == utc(L(14, 6))


async def test_week_day_from_three_shifts_with_night_split(line):
    rows = [
        _shift(L(15, 6), L(15, 14), good=50_000, total=51_000, run=7 * 3600, planned=8 * 3600, target=54_000, team="A"),
        _shift(L(15, 14), L(15, 22), good=48_000, total=49_000, run=7 * 3600, planned=8 * 3600, target=54_000, team="B"),
        _shift(L(15, 22), L(16, 6), good=40_000, total=41_000, run=6 * 3600, planned=8 * 3600, target=54_000, team="C"),
    ]
    for r in rows:
        r.update(id=None, opened=r["start"], count_from={}, params={})
        await line.store.save(r)
    await line.store.set_log_since(utc(L(15, 0)))
    h = DailyHistory(line.dl, line.sl, 140, 30, line.store)
    res = await h.compute({}, n=3, now=utc(L(17, 12)))
    d15, d16, d17 = res["days"]
    assert d15["source"] == "shifts" and d15["teams"] == ["A", "B", "C"]
    assert d15["good"] == 50_000 + 48_000 + 10_000 and d16["good"] == 30_000
    assert d15["target"] == 54_000 * 2 + 13_500 and d16["target"] == 40_500
    assert d15["planned_s"] == 18 * 3600 and d16["planned_s"] == 6 * 3600
    assert d15["oee"]["oee"] == pytest.approx(108_000 / (18 * 60 * 140))
    assert d17["has_data"] is False
