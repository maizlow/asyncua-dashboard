"""Run-time highscores: run definition, short-stop bridging, restart/disconnect, teams, ranking."""

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from backend.opc.data_logger import DataLogger
from backend.opc.highscore import RunStore, RunTracker, compute_highscores, team_label

STHLM = ZoneInfo("Europe/Stockholm")


def L(d, h, mi=0, s=0, ms=0):
    return datetime(2026, 10, d, h, mi, s, ms * 1000, tzinfo=STHLM).astimezone(timezone.utc)


async def make(db, min_stop=0):
    store = RunStore(db)
    await store.init_db()
    t = RunTracker(store, min_stop)
    await t.tick(L(14, 5, 59))  # load
    return t


async def play(t, events, until, team="A", connected=True):
    """events: [(ts, running)]; ticks every second from the first event to ``until``."""
    events = sorted(events)
    now = events[0][0] if events else until
    i = 0
    while now <= until:
        while i < len(events) and events[i][0] <= now:
            t.on_state(events[i][1], events[i][0])
            i += 1
        await t.tick(now, team=team, connected=connected)
        now += timedelta(seconds=1)


async def test_longest_runs_ranked_with_hh_mm_ss_durations(db):
    t = await make(db)
    await play(t, [(L(14, 6), True), (L(14, 7), False), (L(14, 7, 5), True), (L(14, 9, 5, 30), False)], L(14, 9, 6))
    top = await t.store.top()
    assert [r["duration_s"] for r in top] == [2 * 3600 + 30, 3600]
    assert top[0]["start"] == L(14, 7, 5) and top[0]["end"] == L(14, 9, 5, 30)


async def test_every_stop_breaks_by_default_even_sub_second(db):
    t = await make(db)
    await play(t, [(L(14, 6), True), (L(14, 6, 30, 0, 0), False), (L(14, 6, 30, 0, 400), True), (L(14, 7), False)], L(14, 7, 0, 1))
    assert sorted(r["duration_s"] for r in await t.store.top()) == [1799.6, 1800.0]


async def test_short_stops_bridged_with_min_stop(db):
    t = await make(db, min_stop=30)
    events = [(L(14, 6), True), (L(14, 7), False), (L(14, 7, 0, 10), True),  # 10 s stop: bridged
              (L(14, 8), False), (L(14, 8, 2), True), (L(14, 9), False)]       # 2 min stop: breaks
    await play(t, events, L(14, 9, 1))
    top = await t.store.top()
    assert [r["duration_s"] for r in top] == [2 * 3600, 3480]  # 06:00-08:00 incl. the 10 s stop; 08:02-09:00


async def test_ongoing_run_and_current_shift_flag(db):
    t = await make(db)
    await play(t, [(L(14, 5), True), (L(14, 5, 30), False), (L(14, 14, 10), True)], L(14, 15, 10), team="B")
    res = await compute_highscores(t, shift_start=L(14, 14), now=L(14, 15, 10))
    assert res["current"]["duration_s"] == 3600 and res["current"]["team"] == "B" and res["current"]["current_shift"]
    assert res["records"][0]["duration_s"] == 1800 and res["records"][0]["current_shift"] is False


async def test_restart_closes_open_run_at_last_heartbeat(db):
    t = await make(db)
    await play(t, [(L(14, 6), True)], L(14, 7))  # running, heartbeat saved every 5 s
    # Process dies at 07:00; restarts at 09:00 while the line runs again
    t2 = RunTracker(t.store, 0)
    await play(t2, [(L(14, 9), True)], L(14, 9, 0, 5))
    top = await t2.store.top()
    assert len(top) == 1 and timedelta(seconds=top[0]["duration_s"]) >= timedelta(minutes=59, seconds=55)
    assert top[0]["end"] <= L(14, 7)  # not extended through the 2 h the backend could not see
    assert t2.current(L(14, 9, 0, 5))["start"] == L(14, 9)


async def test_connection_loss_ends_run(db):
    t = await make(db)
    await play(t, [(L(14, 6), True)], L(14, 6, 30))
    await t.tick(L(14, 6, 45), connected=False)
    top = await t.store.top()
    assert top[0]["end"] == L(14, 6, 30) and t.run is None


async def test_team_label_and_tie_break(db):
    assert team_label("A", "B") == "A→B" and team_label("A", "A") == "A" and team_label(None, "") is None
    assert team_label(1, None) == "1"
    t = await make(db)
    await play(t, [(L(14, 6), True), (L(14, 7), False)], L(14, 7, 0, 1), team="C")
    await play(t, [(L(14, 8), True), (L(14, 9), False)], L(14, 9, 0, 1), team="A")
    top = await t.store.top()
    assert [r["team_start"] for r in top] == ["C", "A"]  # equal length: the earlier run first


async def test_run_records_survive_retention(db):
    t = await make(db)
    dl = DataLogger(db)
    await dl.init_db()
    await play(t, [(L(14, 6), True), (L(14, 7), False)], L(14, 7, 0, 1))
    await dl.purge_older_than(1, now=L(30, 12))
    assert len(await t.store.top()) == 1


async def test_doc_example(db):
    """BERAKNINGAR.md: 06:00-07:00, 5 min stop, 07:05-09:05:30."""
    ev = [(L(14, 6), True), (L(14, 7), False), (L(14, 7, 5), True), (L(14, 9, 5, 30), False)]
    t = await make(db, min_stop=0)
    await play(t, ev, L(14, 9, 6))
    assert [r["duration_s"] for r in await t.store.top()] == [7230, 3600]
    t2 = RunTracker(RunStore(db), 600)
    await t2.store.db.run_async(lambda c: c.execute("DELETE FROM run_records"))
    await play(t2, ev, L(14, 9, 20))
    assert [r["duration_s"] for r in await t2.store.top()] == [3 * 3600 + 330]
