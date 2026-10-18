from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.opc.data_logger import DataLogger
from backend.opc.oee import (
    compute_oee_details,
    counter_increments,
    oee_factors,
    oee_target,
    production_counts,
    prognosis,
    quality,
    shift_progress,
    stop_stats,
    targets,
)
from backend.opc.shift_logger import ShiftLogger

STHLM = ZoneInfo("Europe/Stockholm")
T0 = datetime(2026, 6, 10, 6, 0, tzinfo=STHLM).astimezone(timezone.utc)


def at(minutes):
    return T0 + timedelta(minutes=minutes)


def test_shift_progress_clamps_to_shift():
    start, end = at(0), at(600)
    assert shift_progress(start, end, at(150)) == {"duration_s": 36000, "elapsed_s": 9000, "remaining_s": 27000}
    assert shift_progress(start, end, at(-10))["elapsed_s"] == 0
    assert shift_progress(start, end, at(700))["remaining_s"] == 0


def test_targets_come_from_plc_shift_target_pro_rata():
    # 2.5 h into a 10 h shift, PLC ShiftTarget 71 400 (140 tiles/min x 85 %)
    assert targets(9000, 36000, 71_400) == {"so_far": 17_850, "shift": 71_400}


def test_targets_without_plc_target_are_unknown_not_nominal():
    assert targets(9000, 36000, None) == {"so_far": None, "shift": None}
    assert targets(0, 0, 71_400) == {"so_far": None, "shift": None}


def test_prognosis_at_current_pace():
    assert prognosis(17000, 9000, 36000) == 68000
    assert prognosis(100, 60, 36000) is None  # too early to be meaningful
    assert prognosis(None, 9000, 36000) is None


def test_stop_stats_counts_stops_including_ongoing():
    segments = [
        (at(0), at(50), "Running"),
        (at(50), at(55), "Stopped"),
        (at(55), at(120), "Running"),
        (at(120), at(132), "Stopped"),
        (at(132), at(140), "Running"),
        (at(140), at(143), "Stopped"),  # still stopped now
    ]
    s = stop_stats(segments)
    assert s["count"] == 3
    assert s["total_s"] == 20 * 60
    assert s["longest_s"] == 12 * 60
    assert s["run_s"] == 123 * 60
    assert s["mtbf_s"] == pytest.approx(41 * 60)
    assert s["mttr_s"] == pytest.approx(20 / 3 * 60)
    assert s["running"] is False


def test_stop_stats_without_stops():
    s = stop_stats([(at(0), at(60), "Running")])
    assert (s["count"], s["mtbf_s"], s["mttr_s"], s["running"]) == (0, None, None, True)
    assert stop_stats([])["running"] is None


def test_oee_is_product_of_factors_and_equals_good_over_target():
    # 600 min planned, 540 min run, 140 TPM nominal; 70 000 produced, 1 400 rejected
    f = oee_factors(run_s=540 * 60, planned_s=600 * 60, total=70_000, good=68_600, nominal_tpm=140)
    assert f["availability"] == pytest.approx(0.9)
    assert f["performance"] == pytest.approx(70_000 / (540 * 140))
    assert f["quality"] == pytest.approx(0.98)
    assert f["oee"] == pytest.approx(f["availability"] * f["performance"] * f["quality"])
    assert f["oee"] == pytest.approx(68_600 / (600 * 140))  # good / target so far
    assert 0.80 <= f["oee"] <= 0.85


def test_oee_factors_handle_missing_and_overspeed():
    assert oee_factors(0, 0, None, None, 140) == {
        "availability": None,
        "performance": None,
        "quality": None,
        "oee": None,
    }
    assert oee_factors(60, 60, 1000, 1000, 140)["performance"] == 1.0  # capped


def test_counter_increments_handles_reset():
    assert counter_increments([100, 250, 400, 30, 90]) == [150, 150, 30, 60]
    assert counter_increments([None, 50, None]) == [50, None]


async def test_compute_oee_details_end_to_end(db, monkeypatch):
    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    dl = DataLogger(db)
    await sl.init_db()
    await dl.init_db()

    store = {
        "ShiftStart": "06:00:00",
        "ShiftEnd": "16:00:00",
        "GoodCount": 13_720,
        "RejectCount": 280,
        "TPM": 133.0,
        "ShiftTarget": 71_400,
        "OeeTarget": 82,
    }

    # 06:00-07:30 running, 07:30-07:40 stopped, 07:40-08:00 running (now = 08:00)
    sl.log_state_change("Running", ts=at(-5))
    sl.log_state_change("Stopped", ts=at(90))
    sl.log_state_change("Running", ts=at(100))
    for minute, value in [(0, 0), (60, 7_900), (120, 13_720)]:
        dl.log_value("GoodCount", value, ts=at(minute))
    db.flush()

    import backend.opc.state_store as state_store

    monkeypatch.setattr(state_store, "data_store", store)  # shift window reads ShiftStart/End from here
    d = await compute_oee_details(store, sl, dl, 140, now=at(120))

    assert d["shift"]["elapsed_s"] == 7200 and d["shift"]["remaining_s"] == 8 * 3600
    assert d["target"] == {
        "so_far": 14_280,  # 71 400 x 2 h / 10 h
        "shift": 71_400,
        "source": "ShiftTarget",
        "prognosis": 68_600,
        "progress_pct": pytest.approx(13_720 / 714),
    }
    assert d["oee_target"] == {"value": 82.0, "source": "OeeTarget"}
    assert d["stops"]["count"] == 1 and d["stops"]["total_s"] == 600
    assert d["counts"]["scrap_pct"] == pytest.approx(2.0)
    assert d["speed"]["pct"] == pytest.approx(95.0)
    oee = d["oee"]
    assert oee["availability"] == pytest.approx(110 / 120)
    assert oee["oee"] == pytest.approx(13_720 / 16_800)
    assert [h["good"] for h in d["hourly"][:3]] == [7_900, 5_820, None]
    assert [h["elapsed_s"] for h in d["hourly"][:3]] == [3600, 3600, 0]
    assert len(d["hourly"]) == 10


async def test_compute_oee_details_without_shift_window(db, monkeypatch):
    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    dl = DataLogger(db)
    import backend.opc.state_store as state_store

    store = {"ProductionCount": 500}
    monkeypatch.setattr(state_store, "data_store", store)
    d = await compute_oee_details(store, sl, dl, 140, now=at(10))
    assert d["shift"] is None and d["counts"]["good"] == 500 and d["counts"]["good_source"] == "ProductionCount"


# ----- fix: Kvalitet unknown without RejectCount
def test_quality_unknown_without_reject_count():
    assert quality(34_440, 34_440, None) is None
    assert quality(34_440, 35_140, 700) == pytest.approx(0.98008, abs=1e-5)
    f = oee_factors(267 * 60, 300 * 60, 35_140, 35_140, 140, reject=None)
    assert f["quality"] is None and f["oee"] is None and f["performance"] is not None


# ----- fix: no double counting of rejects with the ProductionCount fallback
def test_counts_good_count_plus_rejects():
    assert production_counts(34_440, 99_999, 700) == {
        "good": 34_440, "reject": 700, "total": 35_140, "source": "GoodCount"
    }


def test_counts_production_count_includes_rejects():
    c = production_counts(None, 35_140, 700)
    assert c == {"good": 34_440, "reject": 700, "total": 35_140, "source": "ProductionCount"}
    assert production_counts(None, 35_140, None) == {
        "good": 35_140, "reject": None, "total": 35_140, "source": "ProductionCount"
    }
    assert production_counts(None, 100, 250)["good"] == 0  # counters out of sync never go negative
    assert production_counts(None, None, None)["good"] is None


# ----- OEE goal from the PLC (OeeTarget), default 85 %
def test_oee_target_tag_or_default():
    assert oee_target(None) == {"value": 85.0, "source": "default"}
    assert oee_target("") == {"value": 85.0, "source": "default"}
    assert oee_target(0) == {"value": 85.0, "source": "default"}
    assert oee_target(120) == {"value": 85.0, "source": "default"}
    assert oee_target(82.5) == {"value": 82.5, "source": "OeeTarget"}


async def _details(db, monkeypatch, store, now_min=300):
    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    dl = DataLogger(db)
    await sl.init_db()
    await dl.init_db()
    sl.log_state_change("Running", ts=at(-5))
    db.flush()
    import backend.opc.state_store as state_store

    monkeypatch.setattr(state_store, "data_store", store)
    return await compute_oee_details(store, sl, dl, 140, now=at(now_min))


async def test_details_without_shift_target_show_no_targets(db, monkeypatch):
    store = {"ShiftStart": "06:00:00", "ShiftEnd": "14:00:00", "GoodCount": 34_440, "RejectCount": 700}
    d = await _details(db, monkeypatch, store)
    assert d["target"]["so_far"] is None and d["target"]["shift"] is None and d["target"]["source"] is None
    assert d["target"]["progress_pct"] is None
    assert d["target"]["prognosis"] == 55_104  # prognosis does not need a target
    assert d["oee_target"]["source"] == "default"


async def test_details_production_count_fallback_and_quality(db, monkeypatch):
    store = {"ShiftStart": "06:00:00", "ShiftEnd": "14:00:00", "ProductionCount": 35_140, "RejectCount": 700}
    d = await _details(db, monkeypatch, store)
    assert d["counts"] == {
        "good": 34_440, "reject": 700, "total": 35_140,
        "scrap_pct": pytest.approx(700 / 35_140 * 100), "good_source": "ProductionCount",
    }
    assert d["oee"]["quality"] == pytest.approx(34_440 / 35_140)

    store = {"ShiftStart": "06:00:00", "ShiftEnd": "14:00:00", "ProductionCount": 35_140}
    d = await _details(db, monkeypatch, store)
    assert d["oee"]["quality"] is None and d["oee"]["oee"] is None and d["counts"]["scrap_pct"] is None


async def test_live_availability_uses_planned_time_pro_rata(db, monkeypatch):
    """PlannedTime 420 min of an 8 h shift: planned so far after 5 h = 420 x 5/8 min (breaks excluded)."""
    base = {"ShiftStart": "06:00:00", "ShiftEnd": "14:00:00", "GoodCount": 34_440, "RejectCount": 700}
    d = await _details(db, monkeypatch, {**base, "PlannedTime": 420, "ShiftTeam": "B"})
    assert d["shift"]["planned_source"] == "PlannedTime" and d["shift"]["team"] == "B"
    assert d["shift"]["planned_s"] == pytest.approx(420 * 60 * 5 / 8)
    assert d["oee"]["availability"] == 1.0  # ran the whole 5 h > planned so far -> capped
    d = await _details(db, monkeypatch, base)
    assert d["shift"]["planned_source"] == "schedule" and d["shift"]["planned_s"] == 5 * 3600
    assert d["shift"]["team"] is None
