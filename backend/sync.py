"""Pull activities and daily recovery data from Garmin Connect into SQLite.

Run on its own with `python backend/sync.py`, or let app.py run it on a timer.
"""
import json
import logging
import re
import threading
import time
from datetime import date, datetime, timedelta

from garminconnect import Garmin

import config
import db
import metrics
import review

log = logging.getLogger("sync")
_lock = threading.Lock()
ACTIVITY_PAGE = 100  # activities per request when fetching the full history
TRACK_ACTIVITIES = 5  # GPS tracks are fetched for this many of the newest activities
HEALTH_DAYS_PER_SYNC = 45  # the health backfill fetches this many days per sync, so one sync never runs for long
EFFORT_RUNS_PER_SYNC = 40  # runs whose best efforts are worked out per sync (one request each)
PLAN_LAPS_PER_SYNC = 20  # runs in the training plan whose laps are fetched per sync
RECHECK_DAYS = 30  # once a day, activities this far back are fetched again, to pick up edits and deletions on Garmin
EFFORT_DISTANCES = tuple(metrics.DISTANCES)
SPLIT_EVERY = {"run": 1000, "bike": 5000}  # splits for a run or ride recorded without laps: per km, per 5 km


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
    lb = _primary(_get(ts, "mostRecentTrainingLoadBalance", "metricsTrainingLoadBalanceDTOMap"))
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
        # Load focus: the last four weeks of load per zone, against Garmin's optimal range for each
        "load_low": lb.get("monthlyLoadAerobicLow"),
        "load_low_min": lb.get("monthlyLoadAerobicLowTargetMin"),
        "load_low_max": lb.get("monthlyLoadAerobicLowTargetMax"),
        "load_high": lb.get("monthlyLoadAerobicHigh"),
        "load_high_min": lb.get("monthlyLoadAerobicHighTargetMin"),
        "load_high_max": lb.get("monthlyLoadAerobicHighTargetMax"),
        "load_anaerobic": lb.get("monthlyLoadAnaerobic"),
        "load_anaerobic_min": lb.get("monthlyLoadAnaerobicTargetMin"),
        "load_anaerobic_max": lb.get("monthlyLoadAnaerobicTargetMax"),
        "load_focus": lb.get("trainingBalanceFeedbackPhrase"),
    }


def fetch_profile(client):
    """Lactate threshold and heart rate zones, for the workout targets: {lt_speed (m/s), lt_hr, zones: [zone 1-5 floors,
    max HR]}, or None when Garmin has neither."""
    lt = (_try(client.get_lactate_threshold) or {}).get("speed_and_heart_rate") or {}
    speed = lt.get("speed")
    # Garmin gives the threshold speed in tenths of m/s (0.30 for 3.0 m/s, 5:30 /km)
    if speed and speed < 1:
        speed *= 10
    rows = [r for r in (_try(client.get_heart_rate_zones) or []) if isinstance(r, dict)]
    z = next((r for r in rows if r.get("sport") == "RUNNING"), None) or next((r for r in rows if r.get("sport") == "DEFAULT"), None)
    zones = [z.get(f"zone{i}Floor") for i in range(1, 6)] + [z.get("maxHeartRateUsed")] if z else None
    profile = {"lt_speed": speed, "lt_hr": lt.get("heartRate"), "zones": zones if zones and all(zones) else None,
               "ftp": _ftp(_try(client.get_cycling_ftp))}
    return profile if any(profile.values()) else None


def _ftp(answer):
    """Cycling FTP in watts from Garmin's answer (one entry, or a list of them), or None."""
    entry = (answer[0] if answer else None) if isinstance(answer, list) else answer
    ftp = entry.get("functionalThresholdPower") if isinstance(entry, dict) else None
    return round(ftp) if isinstance(ftp, (int, float)) and 50 <= ftp <= 600 else None


def fetch_track(client, activity_id):
    """The activity's GPS points as [[lat, lon], ...], or None if the request failed."""
    details = _try(client.get_activity_details, activity_id, 1, 1000)
    if details is None:
        return None
    points = _get(details, "geoPolylineDTO", "polyline") or []
    return [[round(p["lat"], 6), round(p["lon"], 6)] for p in points
            if isinstance(p, dict) and p.get("lat") is not None and p.get("lon") is not None]


def fetch_laps(client, activity_id):
    """The activity's laps, or None if the request failed."""
    splits = _try(client.get_activity_splits, activity_id)
    if splits is None:
        return None
    return [{
        "km": round((l.get("distance") or 0) / 1000, 3),
        # The timer's time, as Garmin Connect shows it: moving time leaves out standing still and is cut to whole
        # seconds, so a timed 15 min step would read 14:54
        "duration_s": l.get("duration") or l.get("movingDuration"),
        "moving_s": l.get("movingDuration"),
        "speed": l.get("averageSpeed") or l.get("averageMovingSpeed"),
        "max_speed": l.get("maxSpeed"),
        "avg_hr": l.get("averageHR"),
        "max_hr": l.get("maxHR"),
        "elev_gain": l.get("elevationGain"),
        "elev_loss": l.get("elevationLoss"),
        "cadence": l.get("averageRunCadence") or l.get("averageBikeCadence"),
        "power": l.get("averagePower"),
        "step": l.get("wktStepIndex"),  # the workout step the lap was run in; auto-laps split a step into several
    } for l in splits.get("lapDTOs") or [] if isinstance(l, dict)]


def best_efforts(samples, distances=EFFORT_DISTANCES):
    """The fastest time over each distance within one activity, from (elapsed seconds, metres) samples.
    The start of each window is interpolated between samples, so the span is exactly the distance."""
    out = {}
    for m in distances:
        if not samples or samples[-1][1] - samples[0][1] < m:
            continue
        best, j = None, 0
        for i, (t, d) in enumerate(samples):
            if d - samples[0][1] < m:
                continue
            while samples[j + 1][1] <= d - m:
                j += 1
            (t0, d0), (t1, d1) = samples[j], samples[j + 1]
            start = t0 + (t1 - t0) * ((d - m - d0) / (d1 - d0) if d1 > d0 else 0)
            if best is None or t - start < best:
                best = t - start
        out[m] = round(best, 1)
    return out


def _stream(details, times):
    """(seconds, metres, heart rate, elevation) samples from an activity's second-by-second data, the time from the
    first of `times` Garmin sent. Heart rate and elevation are None where missing."""
    keys = {m.get("key"): m.get("metricsIndex") for m in details.get("metricDescriptors") or []}
    ti, di = next((keys[k] for k in times if keys.get(k) is not None), None), keys.get("sumDistance")
    if ti is None or di is None:
        return []
    hi, ei = keys.get("directHeartRate"), keys.get("directElevation")
    samples, last = [], (-1, -1)
    for row in details.get("activityDetailMetrics") or []:
        vals = row.get("metrics") or []
        get = lambda i: vals[i] if i is not None and i < len(vals) else None  # noqa: E731
        t, d = get(ti), get(di)
        if t is None or d is None or t < last[0] or d < last[1]:
            continue  # gaps and the odd backwards step from GPS corrections
        samples.append((t, d, get(hi), get(ei)))
        last = (t, d)
    return samples


def efforts_from(details):
    # Elapsed time, as Garmin's own fastest splits use: a stop in the middle of a 5 km counts against it
    return best_efforts([(t, d) for t, d, _, _ in _stream(details, ("sumElapsedDuration", "sumDuration"))])


def distance_splits(samples, every):
    """Splits every `every` metres from (seconds, metres, heart rate, elevation) samples, as auto-lap would have
    recorded them: each with its time, speed, time-weighted heart rate and net climb. The crossing of each boundary
    is interpolated between samples; a last part shorter than a tenth of a split is left out."""
    if len(samples) < 2:
        return []
    out = []
    t_s, d_s, _, e_s = samples[0]
    hr, edge = [0.0, 0.0], d_s + every

    def lerp(a, b, f):
        return None if a is None or b is None else a + (b - a) * f

    def close(t, d, e):
        out.append({"km": round((d - d_s) / 1000, 3), "duration_s": round(t - t_s, 1),
                    "speed": round((d - d_s) / (t - t_s), 3) if t > t_s else None,
                    "avg_hr": round(hr[0] / hr[1]) if hr[1] else None,
                    "elev": None if e is None or e_s is None else round(e - e_s)})

    for (t0, d0, _, e0), (t1, d1, h1, e1) in zip(samples, samples[1:]):
        tc = t0  # where the part of this step not yet counted starts
        while d1 >= edge:
            f = (edge - d0) / (d1 - d0)
            t, e = t0 + (t1 - t0) * f, lerp(e0, e1, f)
            if h1:
                hr[0] += h1 * (t - tc)
                hr[1] += t - tc
            close(t, edge, e)
            t_s, d_s, e_s, tc, hr, edge = t, edge, e, t, [0.0, 0.0], edge + every
        if h1:
            hr[0] += h1 * (t1 - tc)
            hr[1] += t1 - tc
    t1, d1, _, e1 = samples[-1]
    if d1 - d_s >= every / 10:
        close(t1, d1, e1)
    return out


def splits_from(details, every):
    # The timer's time, as auto-lap uses: a pause doesn't count against the split it falls in
    return distance_splits(_stream(details, ("sumDuration", "sumElapsedDuration")), every)


def fetch_efforts(client, activity_id):
    """A run's best efforts from its second-by-second data, or None if the request failed."""
    details = _try(client.get_activity_details, activity_id, 100000, 1)
    return None if details is None else efforts_from(details)


_shared_client = None  # logged in once and kept, for activities opened on the page
FRESH_DAYS = 2  # an activity this recent with no laps stored gets them asked for again: Garmin works them out after upload


def _fresh(day):
    return bool(day) and day >= (date.today() - timedelta(days=FRESH_DAYS)).isoformat()


def fetch_details(db_path, activity_id):
    """Fetch an activity's GPS track and laps from Garmin if they aren't stored yet, and a run's best efforts.
    Returns None when all is well, or a message saying why they couldn't be fetched."""
    global _shared_client
    conn = db.connect(db_path)

    def client():
        global _shared_client
        _shared_client = _shared_client or _client()
        return _shared_client

    try:
        row = conn.execute("SELECT json_extract(raw, '$.hasPolyline') AS gps, type, date FROM activities WHERE id = ?",
                           (activity_id,)).fetchone()
        if not row:
            return None
        fresh = _fresh(row["date"])
        if bool(row["gps"]) and db.get_track(conn, activity_id) is None:
            points = fetch_track(client(), activity_id)
            if points is not None:  # a failed request is retried the next time the activity is opened
                db.set_track(conn, activity_id, points)
        laps = db.get_laps(conn, activity_id)
        # Laps stored before max speed, descent, the workout step and the timer's time were added are fetched again,
        # and so are none on a fresh activity: Garmin may not have worked them out when they were first asked for
        if laps is None or (laps and not {"max_speed", "step", "moving_s"} <= laps[0].keys()) or (fresh and not laps):
            laps = fetch_laps(client(), activity_id)
            if laps is not None:
                db.set_laps(conn, activity_id, laps)
        # A run synced since the last batch of best efforts gets them now, so its 400 m shows straight away
        need_efforts = "running" in (row["type"] or "") and db.get_efforts(conn, activity_id) is None
        # A run or ride recorded without laps gets its splits worked out, so it can be read km by km
        every = SPLIT_EVERY.get(metrics.sport_of(row["type"]))
        splits = db.get_splits(conn, activity_id)
        need_splits = bool(every) and laps is not None and len(laps) < 2 and (splits is None or (fresh and not splits))
        if need_efforts or need_splits:
            details = _try(client().get_activity_details, activity_id, 100000, 1)
            if details is not None:  # a failed request is retried the next time the activity is opened
                if need_efforts:
                    db.set_efforts(conn, activity_id, efforts_from(details))
                if need_splits:
                    db.set_splits(conn, activity_id, splits_from(details, every))
        conn.commit()
        return None
    except Exception as e:
        _shared_client = None  # log in again next time
        msg = str(e) or e.__class__.__name__
        if "Username and password are required" in msg or "garth" in msg:
            msg = "not logged in to Garmin"
        log.warning("Fetching details for %s failed: %s", activity_id, msg)
        return f"Couldn't fetch the route and laps from Garmin ({msg})."
    finally:
        conn.close()


def fetch_sent_workouts(db_path):
    """review.recover() from the page, when a run is reviewed before the next sync has fetched its workout."""
    global _shared_client
    conn = db.connect(db_path)
    def client():
        global _shared_client
        _shared_client = _shared_client or _client()
        return _shared_client

    try:
        review.recover(conn, client, date.today())
    except Exception as e:
        _shared_client = None
        log.warning("Fetching the sent workouts failed: %s", e)
    finally:
        conn.close()


def fetch_vo2max_history(client, start, end):
    """One row per day Garmin updated the VO2 max estimate."""
    rows = _try(client.get_max_metrics_range, start.isoformat(), end.isoformat()) or []
    out = []
    for r in rows:
        g = _get(r, "generic") or {}
        if g.get("calendarDate") and g.get("vo2MaxPreciseValue"):
            out.append({"date": g["calendarDate"], "vo2max": g["vo2MaxPreciseValue"]})
    return out


PREDICTIONS = {"time5K": "pred_5k", "time10K": "pred_10k", "timeHalfMarathon": "pred_half", "timeMarathon": "pred_marathon"}


def fetch_predictions(client, start, end):
    """Garmin's race predictions (5 km to marathon) for each day from start to end (at most a year)."""
    rows = _try(client.get_race_predictions, start.isoformat(), end.isoformat(), "daily") or []
    return [{"date": r["calendarDate"], **{col: r.get(key) for key, col in PREDICTIONS.items()}}
            for r in rows if isinstance(r, dict) and r.get("calendarDate")]


def _calories(stats):
    return {"cal_total": stats.get("totalKilocalories"), "cal_active": stats.get("activeKilocalories"),
            "cal_resting": stats.get("bmrKilocalories")}


def fetch_day(client, day):
    d = day.isoformat()
    stats = _try(client.get_stats, d) or {}
    hrv = _try(client.get_hrv_data, d) or {}
    sleep = _try(client.get_sleep_data, d) or {}
    ready = _try(client.get_training_readiness, d)

    # Garmin can return several scores per day (e.g. last evening's update and the morning one); take the newest.
    if isinstance(ready, dict):
        ready = [ready]
    scored = [r for r in ready or [] if isinstance(r, dict) and r.get("score") is not None]
    readiness = max(scored, key=lambda r: r.get("timestamp") or "")["score"] if scored else None
    # Recovery time (minutes) counts down through the day and jumps after a workout: the day is planned from the
    # wake-up value, or the newest one before it
    timed = sorted((r for r in ready or [] if isinstance(r, dict) and r.get("recoveryTime") is not None),
                   key=lambda r: r.get("timestamp") or "")
    woke = [r for r in timed if r.get("inputContext") == "AFTER_WAKEUP_RESET"]
    recovery = (woke or timed)[-1]["recoveryTime"] if timed else None

    hs = hrv.get("hrvSummary") or {}
    sleep_dto = sleep.get("dailySleepDTO") or {}
    return {
        "date": d,
        "resting_hr": stats.get("restingHeartRate"),
        "bb_high": stats.get("bodyBatteryHighestValue"),
        "bb_low": stats.get("bodyBatteryLowestValue"),
        "stress_avg": stats.get("averageStressLevel"),
        "steps": stats.get("totalSteps"),
        **_calories(stats),
        "hrv_last_night": hs.get("lastNightAvg"),
        "hrv_weekly_avg": hs.get("weeklyAvg"),
        "hrv_low": _get(hs, "baseline", "balancedLow"),
        "hrv_high": _get(hs, "baseline", "balancedUpper"),
        "hrv_status": hs.get("status"),
        "sleep_s": sleep_dto.get("sleepTimeSeconds"),
        "sleep_score": _get(sleep_dto, "sleepScores", "overall", "value"),
        "readiness": readiness,
        "recovery_h": round(recovery / 60, 1) if recovery is not None else None,
        **fetch_training_status(client, day),
    }


def run_sync(db_path=None):
    """Sync new data. Returns a short status string.

    The steps run in order of importance, cheapest first: new activities, today's numbers, then the one-off backfills.
    If Garmin rate-limits a step, the ones after it wait for the next sync; every backfill saves its own progress."""
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

        # Once a day, look further back, so activities edited or deleted on Garmin since are changed here too
        # (the first sync looks further back anyway, and counts as today's)
        recheck = db.get_meta(conn, "activities_rechecked") != today.isoformat()
        if recheck:
            act_start = min(act_start, today - timedelta(days=RECHECK_DAYS))
        activities = client.get_activities_by_date(act_start.isoformat(), today.isoformat())
        for a in activities:
            db.upsert_activity(conn, parse_activity(a))
        log.info("Synced %d activities since %s", len(activities), act_start)
        if recheck and activities:  # an empty answer may be a failed request, so nothing is deleted on it
            seen = {a.get("activityId") for a in activities}
            gone = [r["id"] for r in conn.execute("SELECT id FROM activities WHERE date >= ?", (act_start.isoformat(),))
                    if r["id"] not in seen]
            db.delete_activities(conn, gone)
            if gone:
                log.info("Removed %d activities deleted on Garmin", len(gone))
            db.set_meta(conn, "activities_rechecked", today.isoformat())
        conn.commit()

        # Race predictions: the last year once (one request), then the days since the last sync
        pred_start = day_start if db.get_meta(conn, "predictions_backfilled") else today - timedelta(days=364)
        rows = fetch_predictions(client, pred_start, today)
        for row in rows:
            db.upsert_daily(conn, row)
        if rows:
            db.set_meta(conn, "predictions_backfilled", "1")
        conn.commit()

        # Lactate threshold and heart rate zones for the Train page, once a day
        if db.get_meta(conn, "profile_date") != today.isoformat():
            profile = fetch_profile(client)
            if profile:  # a failed request keeps the last one
                db.set_meta(conn, "training_profile", json.dumps(profile))
                db.set_meta(conn, "profile_date", today.isoformat())
                conn.commit()

        # VO2 max history for its chart: one request covers years, so fetch it once.
        if not db.get_meta(conn, "vo2max_backfilled"):
            start = today - timedelta(days=config.VO2MAX_BACKFILL_DAYS)
            rows = fetch_vo2max_history(client, start, today)
            for row in rows:
                db.upsert_daily(conn, row)
            if rows:  # an empty answer may be a failed request; try again next sync
                db.set_meta(conn, "vo2max_backfilled", "1")
            conn.commit()

        # The daily numbers since the last sync. Once they're in, the next sync starts from here, even if a backfill
        # below is cut short.
        day = day_start
        while day <= today:
            db.upsert_daily(conn, fetch_day(client, day))
            conn.commit()
            day += timedelta(days=1)
            time.sleep(0.4)  # be gentle with Garmin's rate limits
        db.set_meta(conn, "last_sync_date", today.isoformat())
        conn.commit()

        # GPS tracks for the newest activities, for the map in the last activity panel
        missing = conn.execute(
            "SELECT id FROM (SELECT id, raw FROM activities ORDER BY start_local DESC LIMIT ?) "
            "WHERE json_extract(raw, '$.hasPolyline') = 1 AND id NOT IN (SELECT activity_id FROM tracks)",
            (TRACK_ACTIVITIES,)).fetchall()
        for row in missing:
            points = fetch_track(client, row["id"])
            if points is not None:  # a failed request is retried next sync
                db.set_track(conn, row["id"], points)
                conn.commit()

        # Workouts the dashboard sent before it kept them, fetched back for the review of runs done from them, and
        # so today's sent session stays the one on the watch
        try:
            review.recover(conn, lambda: client, date.today())
        except Exception as e:
            log.info("Couldn't fetch the sent workouts back: %s", e)

        # Laps of the training plan's runs, so the plan can see how the intervals went
        plan = json.loads(db.get_meta(conn, "training_plan") or "null")
        if plan:
            todo = conn.execute(
                "SELECT id, date FROM activities WHERE type LIKE '%running%' AND date >= ? "
                "AND id NOT IN (SELECT activity_id FROM laps) ORDER BY start_local DESC LIMIT ?",
                (plan["start"], PLAN_LAPS_PER_SYNC)).fetchall()
            for row in todo:
                laps = fetch_laps(client, row["id"])
                # A failed request is retried next sync, and so is no laps on a run just uploaded: Garmin may not have
                # worked them out yet
                if laps is not None and (laps or not _fresh(row["date"])):
                    db.set_laps(conn, row["id"], laps)
                    conn.commit()

        # Best efforts (400 m to marathon) for runs that don't have them yet, newest first, a batch per sync
        todo = conn.execute(
            "SELECT id FROM activities WHERE type LIKE '%running%' AND id NOT IN (SELECT activity_id FROM efforts) "
            "ORDER BY start_local DESC LIMIT ?", (EFFORT_RUNS_PER_SYNC,)).fetchall()
        for row in todo:
            bests = fetch_efforts(client, row["id"])
            if bests is not None:  # a failed request is retried next sync
                db.set_efforts(conn, row["id"], bests)
                conn.commit()
            time.sleep(0.5)

        # Full activity history: page back through everything on Garmin once, newest first.
        # The offset is saved per page, so a rate limit just resumes from there on the next sync.
        if not db.get_meta(conn, "activity_history_done"):
            offset = int(db.get_meta(conn, "activity_history_offset") or 0)
            while True:
                page = client.get_activities(offset, ACTIVITY_PAGE)
                page = page if isinstance(page, list) else []
                for a in page:
                    db.upsert_activity(conn, parse_activity(a))
                offset += len(page)
                db.set_meta(conn, "activity_history_offset", str(offset))
                conn.commit()
                if len(page) < ACTIVITY_PAGE:
                    break
                time.sleep(1)
            db.set_meta(conn, "activity_history_done", "1")
            conn.commit()
            log.info("Activity history complete: %d activities", offset)

        # Health history: a year of daily data (HRV, sleep, Body Battery...), fetched once, backwards from the oldest
        # day already synced. A chunk per sync, saving progress per day, so a rate limit just resumes on the next sync.
        oldest = db.get_meta(conn, "health_backfill_from") or conn.execute(
            "SELECT min(date) FROM daily WHERE resting_hr IS NOT NULL OR sleep_s IS NOT NULL").fetchone()[0]
        day = date.fromisoformat(oldest) if oldest else day_start
        target = today - timedelta(days=config.HEALTH_HISTORY_DAYS)
        for _ in range(HEALTH_DAYS_PER_SYNC):
            if day <= target:
                break
            day -= timedelta(days=1)
            db.upsert_daily(conn, fetch_day(client, day))
            db.set_meta(conn, "health_backfill_from", day.isoformat())
            conn.commit()
            time.sleep(0.4)

        # Calories for the days synced before they were stored: once, backwards from the newest day without them,
        # a chunk per sync (one request a day), saving its place after every day
        start = db.get_meta(conn, "calories_backfill_from")
        day = date.fromisoformat(start) if start else day_start
        done = 0
        while day > target and done < HEALTH_DAYS_PER_SYNC:
            day -= timedelta(days=1)
            row = conn.execute("SELECT cal_total FROM daily WHERE date = ?", (day.isoformat(),)).fetchone()
            if row and row["cal_total"] is None:
                stats = _try(client.get_stats, day.isoformat()) or {}
                db.upsert_daily(conn, {"date": day.isoformat(), **_calories(stats)})
                done += 1
                time.sleep(0.4)
            db.set_meta(conn, "calories_backfill_from", day.isoformat())
            conn.commit()

        db.set_meta(conn, "last_sync_at", datetime.now().isoformat(timespec="seconds"))
        db.set_meta(conn, "last_error", "")
        conn.commit()
        return "ok"
    except Exception as e:
        msg = str(e) or e.__class__.__name__
        if "Username and password are required" in msg or "garth" in msg:
            msg = "Not logged in to Garmin. Run `python backend/login.py` on the server machine."
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
