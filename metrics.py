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


# Garmin's primary training effect label -> its load focus group.
FOCUS = {
    "RECOVERY": "low", "AEROBIC_BASE": "low",
    "TEMPO": "high", "LACTATE_THRESHOLD": "high", "VO2MAX": "high",
    "ANAEROBIC_CAPACITY": "anaerobic", "SPRINT": "anaerobic",
}


def run_focus(a, threshold):
    """low / high / anaerobic, from Garmin's label; falls back to average HR vs. the aerobic threshold."""
    if a.get("te_label") in FOCUS:
        return FOCUS[a["te_label"]]
    if a.get("avg_hr"):
        return "low" if a["avg_hr"] < threshold else "high"
    return None


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


# Garmin's training statuses, with a plain-language summary of what Garmin means by each.
TRAINING_STATUS = {
    "PEAKING": ("Peaking", "You're in ideal race shape. Recent lighter load has let your body recover and absorb the training."),
    "PRODUCTIVE": ("Productive", "Your fitness is improving and your load is in a good range. Keep it up, with recovery in the plan."),
    "MAINTAINING": ("Maintaining", "Your load is enough to hold your fitness. To improve, add variety or more load."),
    "RECOVERY": ("Recovery", "A lighter load is letting your body recover. Good after a hard block or before a race."),
    "UNPRODUCTIVE": ("Unproductive", "Your load is fine but fitness is dropping. You may be struggling to recover: check sleep, stress and easy days."),
    "STRAINED": ("Strained", "Your HRV suggests you're not recovering well, which is holding back your training. Prioritise rest."),
    "OVERREACHING": ("Overreaching", "Your load is very high and becoming counterproductive. Your body needs rest."),
    "DETRAINING": ("Detraining", "You've trained much less than usual for a week or more, and fitness is starting to slip."),
    "PAUSED": ("Paused", "Training status is paused, for example during illness or a training break."),
    "NO_STATUS": ("No status", "Garmin needs a week or two of activities with VO2 max estimates to work out a status."),
}


def _training_status(days, today):
    """Garmin's latest training status, plus one entry per day for the last four weeks."""
    by_date = {d["date"]: d for d in days}
    history = []
    for i in range(27, -1, -1):
        d = (today - timedelta(days=i)).isoformat()
        history.append({"date": d, "status": (by_date.get(d) or {}).get("training_status")})

    recent = [d for d in days if d.get("training_status") and d["date"] >= (today - timedelta(days=2)).isoformat()]
    if not recent:
        return None
    cur = recent[-1]
    code = cur["training_status"]
    label, about = TRAINING_STATUS.get(code, (code.replace("_", " ").capitalize(), ""))
    vo2 = next((d["vo2max"] for d in reversed(days) if d.get("vo2max")), None)
    return {
        "code": code, "label": label, "about": about, "as_of": cur["date"],
        "since": cur.get("training_status_since"),
        "acute_load": cur.get("acute_load"), "acute_min": cur.get("acute_load_min"),
        "acute_max": cur.get("acute_load_max"), "acwr_status": cur.get("acwr_status"),
        "vo2max": vo2, "history": history,
    }


def build_dashboard(db_path=None):
    conn = db.connect(db_path or config.DB_PATH)
    try:
        acts = [dict(r) for r in conn.execute(
            "SELECT id, start_local, date, type, name, distance_m, duration_s, avg_hr, "
            "max_hr, avg_speed, elev_gain, training_load, aerobic_te, te_label FROM activities "
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
        a["focus"] = run_focus(a, threshold) if is_run(a["type"]) else None
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

    # Weekly running volume, split by Garmin's load focus
    monday = today - timedelta(days=today.weekday())
    weeks = []
    for i in range(11, -1, -1):
        start = monday - timedelta(weeks=i)
        end = start + timedelta(days=7)
        runs = [a for a in acts if is_run(a["type"]) and start.isoformat() <= a["date"] < end.isoformat()]
        km = lambda rs: round(sum((r["distance_m"] or 0) for r in rs) / 1000, 1)
        weeks.append({
            "week": start.isoformat(),
            "low_km": km([r for r in runs if r["focus"] == "low"]),
            "high_km": km([r for r in runs if r["focus"] == "high"]),
            "anaerobic_km": km([r for r in runs if r["focus"] == "anaerobic"]),
            "unknown_km": km([r for r in runs if r["focus"] is None]),
            "runs": len(runs),
            "hours": round(sum((r["duration_s"] or 0) for r in runs) / 3600, 1),
        })
    last4 = weeks[-4:]
    low4 = sum(w["low_km"] for w in last4)
    known4 = low4 + sum(w["high_km"] + w["anaerobic_km"] for w in last4)
    low_share = round(low4 / known4 * 100) if known4 else None

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
            "focus": a["focus"], "te_label": a["te_label"],
        })

    return {
        "generated": today.isoformat(),
        "threshold": threshold,
        "meta": meta,
        "has_data": bool(acts or days),
        "form": {"state": state, "advice": advice, "ctl": now["ctl"], "atl": now["atl"],
                 "tsb": now["tsb"], "ratio": ratio},
        "today": today_vals,
        "training_status": _training_status(days, today),
        "low_share_4w": low_share,
        "fitness": fitness[-120:],
        "weeks": weeks,
        "trends": trends,
        "activities": recent_acts,
    }
