import threading
from datetime import datetime, timedelta, timezone

from backend.opc.data_logger import DataLogger

T0 = datetime(2026, 1, 1, 12, 0, tzinfo=timezone.utc)


async def test_history_returns_newest_n_in_chronological_order(db):
    logger = DataLogger(db)
    await logger.init_db()
    for i in range(200):
        logger.log_value("OEE", i, ts=T0 + timedelta(seconds=i))
    db.flush()

    values = await logger.get_history_values("OEE", limit=150)
    assert values == list(range(50, 200))


async def test_history_points_have_utc_timestamps_and_ties_keep_insert_order(db):
    logger = DataLogger(db)
    await logger.init_db()
    for v in ("1.5", "2.5", "3.5"):
        logger.log_value("TPM", v, ts=T0)  # identical timestamps
    logger.log_value("Other", 99, ts=T0)
    db.flush()

    points = await logger.get_history_points("TPM", limit=2)
    assert [p["value"] for p in points] == [2.5, 3.5]
    assert points[0]["timestamp"] == "2026-01-01T12:00:00+00:00"


async def test_value_coercion(db):
    logger = DataLogger(db)
    await logger.init_db()
    for v in (7, 7.25, "06:13:12"):
        logger.log_value("Mixed", v, ts=T0)
    logger.log_value("Mixed", None, ts=T0)  # ignored
    db.flush()
    assert await logger.get_history_values("Mixed") == [7, 7.25, "06:13:12"]


async def test_concurrent_writers_lose_nothing(db):
    logger = DataLogger(db)
    await logger.init_db()

    def writer(n):
        for i in range(500):
            logger.log_value(f"tag{n}", i)

    threads = [threading.Thread(target=writer, args=(n,)) for n in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    db.flush()

    for n in range(4):
        assert await logger.get_history_values(f"tag{n}", limit=1000) == list(range(500))


async def test_retention_cleanup_removes_only_old_points(db):
    logger = DataLogger(db)
    await logger.init_db()
    now = T0
    logger.log_value("OEE", 1, ts=now - timedelta(days=45))
    logger.log_value("OEE", 2, ts=now - timedelta(days=31))
    logger.log_value("OEE", 3, ts=now - timedelta(days=29))
    logger.log_value("OEE", 4, ts=now)
    db.flush()

    assert await logger.purge_older_than(30, now=now) == 2
    assert await logger.get_history_values("OEE") == [3, 4]
    assert await logger.purge_older_than(0, now=now) == 0  # disabled
    assert await logger.get_history_values("OEE") == [3, 4]


async def test_retention_handles_legacy_current_timestamp_rows(db):
    """Rows written by the old code used SQLite CURRENT_TIMESTAMP (UTC, no fraction)."""
    logger = DataLogger(db)
    await logger.init_db()
    await db.run_async(
        lambda c: c.execute(
            "INSERT INTO data_points (timestamp, tag, value) VALUES ('2025-11-01 10:00:00', 'OEE', '1')"
        )
    )
    logger.log_value("OEE", 2, ts=T0)
    db.flush()
    assert await logger.purge_older_than(30, now=T0) == 1
    assert await logger.get_history_values("OEE") == [2]
