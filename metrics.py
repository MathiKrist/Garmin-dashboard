"""Turn the raw tables into the numbers the dashboard shows."""
import math
from datetime import date, timedelta
from statistics import median

import config
import db

CTL_DAYS = 42  # fitness: long-term average load
ATL_DAYS = 7   # fatigue: short-term average load


def is_run(activity_type):
    return "running" in (activity_type or "")


def trimp(duration_s, avg_hr, rest_hr, max_hr):
    """Banister TRIMP, used only when Garmin has no training load."""
    if not duration_s or not avg_hr or max_hr <= rest_hr:
        return 0.0
    hrr = max(0.0, min(1.0, (avg_hr - rest_hr) / (max_hr - rest_hr)))
    return duration_s / 60 * hrr * 0.64 * math.exp(1.92 * hrr)


def _form_state(ctl, tsb):
    if ctl < 5:
        return "Warming up", "Not enough training history yet. Form gets meaningful after a few weeks of data."
    pct = tsb / ctl * 100
    if pct > 25:
        return "Rested", "Very little recent fatigue. Fitness will start to slip if this lasts."
    if pct > 5:
        return "Fresh", "A good day for a hard session or a race."
    if pct > -10:
        return "Balanced", "Steady training. Normal sessions are fine."
    if pct > -30:
        return "Building", "Productive fatigue. Keep the easy days easy."
    return "Overloaded", "Fatigue is high compared to your fitness. An easy day or rest would help."


def build_dashboard(db_path=None):
    conn = db.connect(db_path or config.DB_PATH)
    try:
        acts = [dict(r) for r in conn.execute(
            "SELECT id, start_local, date, type, name, distance_m, duration_s, avg_hr, "
            "max_hr, avg_speed, elev_gain, training_load, aerobic_te FROM activities "
            "WHERE date IS NOT NULL AND date != '' ORDER BY start_local")]
        days = [dict(r) for r in conn.execute("SELECT * FROM daily ORDER BY date")]
        meta = {
            "last_sync_at": db.get_meta(conn, "last_sync_at"),
            "last_error": db.get_meta(conn, "last_error") or None,
            "last_error_at": db.get_meta(conn, "last_error_at"),
        }
    finally:
        conn.close()

    today = date.today()
    threshold = config.AEROBIC_THRESHOLD
    rests = [d["resting_hr"] for d in days if d.get("resting_hr")]
    rest_hr = median(rests) if rests else 55

    # Load per activity and per day
    load_by_day = {}
    for a in acts:
        load = a["training_load"]
        if load is None:
            load = trimp(a["duration_s"], a["avg_hr"], rest_hr, config.MAX_HR)
        a["load"] = round(load or 0, 1)
        load_by_day[a["date"]] = load_by_day.get(a["date"], 0) + a["load"]

    # Fitness / fatigue / form
    fitness = []
    if acts:
        first = date.fromisoformat(acts[0]["date"])
        k_ctl = 1 - math.exp(-1 / CTL_DAYS)
        k_atl = 1 - math.exp(-1 / ATL_DAYS)
        ctl = atl = 0.0
        d = first
        while d <= today:
            load = load_by_day.get(d.isoformat(), 0)
            ctl += (load - ctl) * k_ctl
            atl += (load - atl) * k_atl
            fitness.append({"date": d.isoformat(), "load": round(load, 1),
                            "ctl": round(ctl, 1), "atl": round(atl, 1), "tsb": round(ctl - atl, 1)})
            d += timedelta(days=1)
    now = fitness[-1] if fitness else {"ctl": 0, "atl": 0, "tsb": 0}
    state, advice = _form_state(now["ctl"], now["tsb"])
    ratio = round(now["atl"] / now["ctl"], 2) if now["ctl"] >= 5 else None

    # Weekly running volume, split at the aerobic threshold (by average HR per run)
    monday = today - timedelta(days=today.weekday())
    weeks = []
    for i in range(11, -1, -1):
        start = monday - timedelta(weeks=i)
        end = start + timedelta(days=7)
        runs = [a for a in acts if is_run(a["type"]) and start.isoformat() <= a["date"] < end.isoformat()]
        km = lambda rs: round(sum((r["distance_m"] or 0) for r in rs) / 1000, 1)
        weeks.append({
            "week": start.isoformat(),
            "easy_km": km([r for r in runs if r["avg_hr"] and r["avg_hr"] < threshold]),
            "hard_km": km([r for r in runs if r["avg_hr"] and r["avg_hr"] >= threshold]),
            "no_hr_km": km([r for r in runs if not r["avg_hr"]]),
            "runs": len(runs),
            "hours": round(sum((r["duration_s"] or 0) for r in runs) / 3600, 1),
        })
    last4 = weeks[-4:]
    easy4 = sum(w["easy_km"] for w in last4)
    hr4 = easy4 + sum(w["hard_km"] for w in last4)
    easy_share = round(easy4 / hr4 * 100) if hr4 else None

    # Recovery trends (last 60 days)
    cutoff = (today - timedelta(days=59)).isoformat()
    trends = [{k: d.get(k) for k in ("date", "hrv_last_night", "hrv_low", "hrv_high",
                                       "resting_hr", "sleep_s", "sleep_score", "readiness")}
              for d in days if d["date"] >= cutoff]

    # Today: newest value of each field from the last two days
    recent = [d for d in days if d["date"] >= (today - timedelta(days=1)).isoformat()]
    recent.sort(key=lambda d: d["date"], reverse=True)

    def latest(field):
        for d in recent:
            if d.get(field) is not None:
                return d[field]
        return None

    today_vals = {f: latest(f) for f in (
        "readiness", "hrv_last_night", "hrv_weekly_avg", "hrv_low", "hrv_high",
        "hrv_status", "sleep_s", "sleep_score", "resting_hr", "bb_high", "bb_low", "stress_avg")}

    recent_acts = []
    for a in reversed(acts[-25:]):
        pace = None
        if is_run(a["type"]) and a["avg_speed"]:
            pace = 1000 / a["avg_speed"]  # seconds per km
        recent_acts.append({
            "date": a["date"], "start": a["start_local"], "type": a["type"], "name": a["name"],
            "km": round((a["distance_m"] or 0) / 1000, 2), "duration_s": a["duration_s"],
            "pace_s_per_km": pace, "avg_hr": a["avg_hr"], "load": a["load"],
            "easy": (a["avg_hr"] < threshold) if (a["avg_hr"] and is_run(a["type"])) else None,
        })

    return {
        "generated": today.isoformat(),
        "threshold": threshold,
        "meta": meta,
        "has_data": bool(acts or days),
        "form": {"state": state, "advice": advice, "ctl": now["ctl"], "atl": now["atl"],
                 "tsb": now["tsb"], "ratio": ratio},
        "today": today_vals,
        "easy_share_4w": easy_share,
        "fitness": fitness[-120:],
        "weeks": weeks,
        "trends": trends,
        "activities": recent_acts,
    }
