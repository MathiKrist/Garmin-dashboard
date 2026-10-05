"""Pull activities and daily recovery data from Garmin Connect into SQLite.

Run on its own with `python sync.py`, or let app.py run it on a timer.
"""
import logging
import re
import threading
import time
from datetime import date, datetime, timedelta

from garminconnect import Garmin

import config
import db

log = logging.getLogger("sync")
_lock = threading.Lock()


def _get(d, *path):
    """Safe nested lookup: _get(x, "a", "b") -> x["a"]["b"] or None."""
    for key in path:
        if not isinstance(d, dict):
            return None
        d = d.get(key)
    return d


def _client():
    client = Garmin()
    client.login(config.TOKEN_DIR)
    return client


def parse_activity(a):
    start = a.get("startTimeLocal") or ""
    return {
        "id": a.get("activityId"),
        "start_local": start,
        "date": start[:10],
        "type": _get(a, "activityType", "typeKey") or "other",
        "name": a.get("activityName"),
        "distance_m": a.get("distance"),
        "duration_s": a.get("movingDuration") or a.get("duration"),
        "avg_hr": a.get("averageHR"),
        "max_hr": a.get("maxHR"),
        "avg_speed": a.get("averageSpeed"),
        "elev_gain": a.get("elevationGain"),
        "training_load": a.get("activityTrainingLoad"),
        "aerobic_te": a.get("aerobicTrainingEffect"),
        "anaerobic_te": a.get("anaerobicTrainingEffect"),
        "te_label": a.get("trainingEffectLabel"),
        "raw": a,
    }


def _try(fn, *args):
    try:
        return fn(*args)
    except Exception as e:  # one missing endpoint shouldn't sink the whole day
        if "429" in str(e) or "Too many" in str(e):
            raise
        log.debug("%s%s failed: %s", fn.__name__, args, e)
        return None


def _primary(by_device):
    """Garmin keys some metrics by device; prefer the primary training device."""
    rows = [r for r in (by_device or {}).values() if isinstance(r, dict)]
    return next((r for r in rows if r.get("primaryTrainingDevice")), rows[0] if rows else {})


def fetch_training_status(client, day):
    ts = _try(client.get_training_status, day.isoformat()) or {}
    s = _primary(_get(ts, "mostRecentTrainingStatus", "latestTrainingStatusData"))
    acute = s.get("acuteTrainingLoadDTO") or {}
    # The phrase ("PRODUCTIVE_3", "RECOVERY_2", ...) names the status; the suffix is just a message variant.
    phrase = s.get("trainingStatusFeedbackPhrase")
    status = "PAUSED" if s.get("trainingPaused") else re.sub(r"_\d+$", "", phrase) if phrase else None
    return {
        "training_status": status,
        "training_status_since": s.get("sinceDate"),
        "acute_load": acute.get("dailyTrainingLoadAcute"),
        "acute_load_min": acute.get("minTrainingLoadChronic"),
        "acute_load_max": acute.get("maxTrainingLoadChronic"),
        "acwr_status": acute.get("acwrStatus"),
        "vo2max": _get(ts, "mostRecentVO2Max", "generic", "vo2MaxPreciseValue"),
    }


def fetch_day(client, day):
    d = day.isoformat()
    stats = _try(client.get_stats, d) or {}
    hrv = _try(client.get_hrv_data, d) or {}
    sleep = _try(client.get_sleep_data, d) or {}
    ready = _try(client.get_training_readiness, d)

    readiness = None
    if isinstance(ready, dict):
        ready = [ready]
    for r in ready or []:
        if isinstance(r, dict) and r.get("score") is not None:
            readiness = r["score"]
            break

    hs = hrv.get("hrvSummary") or {}
    sleep_dto = sleep.get("dailySleepDTO") or {}
    return {
        "date": d,
        "resting_hr": stats.get("restingHeartRate"),
        "bb_high": stats.get("bodyBatteryHighestValue"),
        "bb_low": stats.get("bodyBatteryLowestValue"),
        "stress_avg": stats.get("averageStressLevel"),
        "steps": stats.get("totalSteps"),
        "hrv_last_night": hs.get("lastNightAvg"),
        "hrv_weekly_avg": hs.get("weeklyAvg"),
        "hrv_low": _get(hs, "baseline", "balancedLow"),
        "hrv_high": _get(hs, "baseline", "balancedUpper"),
        "hrv_status": hs.get("status"),
        "sleep_s": sleep_dto.get("sleepTimeSeconds"),
        "sleep_score": _get(sleep_dto, "sleepScores", "overall", "value"),
        "readiness": readiness,
        **fetch_training_status(client, day),
    }


def run_sync(db_path=None):
    """Sync new data. Returns a short status string."""
    if not _lock.acquire(blocking=False):
        return "already running"
    conn = db.connect(db_path or config.DB_PATH)
    try:
        today = date.today()
        last = db.get_meta(conn, "last_sync_date")
        last = date.fromisoformat(last) if last else None
        act_start = last - timedelta(days=3) if last else today - timedelta(days=config.ACTIVITY_BACKFILL_DAYS)
        day_start = last - timedelta(days=2) if last else today - timedelta(days=config.DAILY_BACKFILL_DAYS)

        client = _client()

        activities = client.get_activities_by_date(act_start.isoformat(), today.isoformat())
        for a in activities:
            db.upsert_activity(conn, parse_activity(a))
        conn.commit()
        log.info("Synced %d activities since %s", len(activities), act_start)

        day = day_start
        while day <= today:
            db.upsert_daily(conn, fetch_day(client, day))
            conn.commit()
            day += timedelta(days=1)
            time.sleep(0.4)  # be gentle with Garmin's rate limits

        # Training status was added later: fill four weeks of history once, for the status strip.
        if not db.get_meta(conn, "training_status_backfilled"):
            day = today - timedelta(days=27)
            while day < day_start:
                db.upsert_daily(conn, {"date": day.isoformat(), **fetch_training_status(client, day)})
                conn.commit()
                day += timedelta(days=1)
                time.sleep(0.4)
            db.set_meta(conn, "training_status_backfilled", "1")

        db.set_meta(conn, "last_sync_date", today.isoformat())
        db.set_meta(conn, "last_sync_at", datetime.now().isoformat(timespec="seconds"))
        db.set_meta(conn, "last_error", "")
        conn.commit()
        return "ok"
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        if "Username and password are required" in msg or "garth" in msg:
            msg = "Not logged in to Garmin. Run `python login.py` on the server machine."
        log.error("Sync failed: %s", msg)
        db.set_meta(conn, "last_error", msg)
        db.set_meta(conn, "last_error_at", datetime.now().isoformat(timespec="seconds"))
        conn.commit()
        return f"error: {msg}"
    finally:
        conn.close()
        _lock.release()


def is_running():
    return _lock.locked()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s")
    print(run_sync())
