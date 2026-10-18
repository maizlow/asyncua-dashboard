from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import pytest

from backend.opc.data_logger import DataLogger
from backend.opc.oee import (
    compute_oee_details,
    counter_increments,
    oee_factors,
    prognosis,
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


def test_targets_use_nominal_rate():
    # 2.5 h into a 10 h shift at 140 tiles/min
    assert targets(9000, 36000, 140) == {"so_far": 21000, "shift": 84000}


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

    store = {"ShiftStart": "06:00:00", "ShiftEnd": "16:00:00", "GoodCount": 13_720, "RejectCount": 280, "TPM": 133.0}

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
        "so_far": 16_800,
        "shift": 84_000,
        "prognosis": 68_600,
        "progress_pct": pytest.approx(13_720 / 840),
    }
    assert d["stops"]["count"] == 1 and d["stops"]["total_s"] == 600
    assert d["counts"]["scrap_pct"] == pytest.approx(2.0)
    assert d["speed"]["pct"] == pytest.approx(95.0)
    oee = d["oee"]
    assert oee["availability"] == pytest.approx(110 / 120)
    assert oee["oee"] == pytest.approx(13_720 / 16_800)
    assert [h["good"] for h in d["hourly"][:3]] == [7_900, 5_820, None]
    assert len(d["hourly"]) == 10


async def test_compute_oee_details_without_shift_window(db, monkeypatch):
    sl = ShiftLogger(db, tz_name="Europe/Stockholm")
    dl = DataLogger(db)
    import backend.opc.state_store as state_store

    store = {"ProductionCount": 500}
    monkeypatch.setattr(state_store, "data_store", store)
    d = await compute_oee_details(store, sl, dl, 140, now=at(10))
    assert d["shift"] is None and d["counts"]["good"] == 500 and d["counts"]["good_source"] == "ProductionCount"
