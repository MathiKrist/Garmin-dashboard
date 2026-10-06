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


# Garmin type key -> sport group for the activity filter. First match wins; keys are matched as substrings.
SPORTS = [
    ("run", ("running",)),
    ("bike", ("cycling", "biking", "virtual_ride", "bmx")),
    ("swim", ("swimming",)),
    ("walk", ("walking",)),
    ("hike", ("hiking", "mountaineering")),
    ("strength", ("strength",)),
    ("disc_golf", ("disc_golf",)),
    ("yoga", ("yoga", "pilates", "breathwork", "meditation")),
    ("cardio", ("cardio", "hiit", "elliptical", "stair", "rowing", "fitness_equipment", "floor_climbing", "jump_rope", "boxing")),
    ("winter", ("ski", "snowboard", "snowshoe", "skating")),
]


def sport_of(activity_type):
    t = activity_type or ""
    return next((sport for sport, keys in SPORTS if any(k in t for k in keys)), "other")


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


# Form as % of fitness: (name, lower bound, advice). The chart draws these as bands.
FORM_ZONES = [
    ("Rested", 25, "Very little recent fatigue. Fine before a race or after a hard block, but fitness starts to slip if it lasts."),
    ("Fresh", 5, "Recovered and ready. A good day for a hard session or a race."),
    ("Balanced", -10, "Training roughly matches what you're used to. Normal sessions are fine."),
    ("Building", -30, "You're carrying fatigue from training more than usual. That's how fitness grows; keep the easy days easy."),
    ("Overloaded", None, "Fatigue is high compared to your fitness. An easy day or rest would help."),
]


def _form_pct(ctl, atl):
    return round((ctl - atl) / ctl * 100, 1) if ctl >= 5 else None


def _form_state(pct):
    if pct is None:
        return "Warming up", "Not enough training history yet. Form gets meaningful after a few weeks of data."
    for name, low, advice in FORM_ZONES:
        if low is None or pct > low:
            return name, advice


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


# Garmin's load focus zones: phrase prefix -> (key, name, what to add when short of it)
LOAD_ZONES = {
    "AEROBIC_LOW": ("low", "low aerobic", "easy runs and long runs at a conversational pace"),
    "AEROBIC_HIGH": ("high", "high aerobic", "tempo runs, threshold intervals or VO2 max intervals"),
    "ANAEROBIC": ("anaerobic", "anaerobic", "short, very hard intervals of 30 seconds to 2 minutes, or strides and sprints"),
}


def _load_focus_text(phrase):
    """Garmin's phrase ("AEROBIC_HIGH_SHORTAGE", "BALANCED", ...) -> (title, advice, zone key)."""
    phrase = phrase or ""
    for prefix, (key, name, tip) in LOAD_ZONES.items():
        if phrase.startswith(prefix + "_SHORTAGE"):
            return f"Short on {name}", f"Your {name} load is below its optimal range. Add more {tip}.", key
        if phrase.startswith(prefix + "_FOCUS"):
            return f"Focused on {name}", f"Most of your load is {name}. Mix in the other zones to keep improving.", key
    if phrase.startswith("BALANCED"):
        return "Balanced", "All three zones are in their optimal range. Keep training the way you are.", None
    return phrase.replace("_", " ").capitalize() or "No load focus yet", "", None


def _load_focus(days, today):
    recent = [d for d in days if d.get("load_low") is not None and d["date"] >= (today - timedelta(days=2)).isoformat()]
    if not recent:
        return None
    cur = recent[-1]
    title, advice, key = _load_focus_text(cur.get("load_focus"))
    zones = [{"key": k, "label": name.capitalize(), "value": cur.get(f"load_{k}"),
              "min": cur.get(f"load_{k}_min"), "max": cur.get(f"load_{k}_max")}
             for k, name, _ in LOAD_ZONES.values()]
    return {"title": title, "advice": advice, "zone": key, "zones": zones, "as_of": cur["date"]}


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


def _vo2max(days, today):
    """Garmin's VO2 max at the end of each week, plus where it stood 3 and 12 months ago."""
    points = [(d["date"], d["vo2max"]) for d in days if d.get("vo2max")]
    if len(points) < 2:
        return None
    first = date.fromisoformat(points[0][0])
    week_end = first + timedelta(days=6 - first.weekday())  # Sunday of the first week
    weeks, i, value = [], 0, None
    while True:
        end = min(week_end, today)
        while i < len(points) and points[i][0] <= end.isoformat():
            value = points[i][1]
            i += 1
        weeks.append({"week": (week_end - timedelta(days=6)).isoformat(), "vo2max": value})
        if week_end >= today:
            break
        week_end += timedelta(days=7)

    def as_of(day):
        before = [v for d, v in points if d <= day.isoformat()]
        return before[-1] if before else None

    year_ago = (today - timedelta(days=365)).isoformat()
    return {
        "now": points[-1][1], "updated": points[-1][0],
        "peak": max(v for d, v in points if d >= year_ago) if points[-1][0] >= year_ago else points[-1][1],
        "ago_3m": as_of(today - timedelta(days=91)), "ago_12m": as_of(today - timedelta(days=365)),
        "weeks": weeks[-53:],  # the chart shows the last year
    }


def build_dashboard(db_path=None):
    conn = db.connect(db_path or config.DB_PATH)
    try:
        acts = [dict(r) for r in conn.execute(
            "SELECT id, start_local, date, type, name, distance_m, duration_s, avg_hr, "
            "max_hr, avg_speed, elev_gain, training_load, aerobic_te, te_label, "
            "json_extract(raw, '$.activeSets') AS sets, json_extract(raw, '$.totalReps') AS reps, "
            "json_extract(raw, '$.locationName') AS location FROM activities "
            "WHERE date IS NOT NULL AND date != '' ORDER BY start_local")]
        track = db.get_track(conn, acts[-1]["id"]) if acts else None
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
                            "ctl": round(ctl, 1), "atl": round(atl, 1), "tsb": round(ctl - atl, 1),
                            "form_pct": _form_pct(ctl, atl)})
            d += timedelta(days=1)
    now = fitness[-1] if fitness else {"ctl": 0, "atl": 0, "tsb": 0, "form_pct": None}
    state, advice = _form_state(now["form_pct"])
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
    week_rhr = [d["resting_hr"] for d in days if d.get("resting_hr") and d["date"] > (today - timedelta(days=7)).isoformat()]
    today_vals["resting_hr_7d"] = round(sum(week_rhr) / len(week_rhr)) if week_rhr else None

    # Every activity, newest first, so the page can filter by sport and total up this week and this year
    recent_acts = []
    for a in reversed(acts):
        recent_acts.append({
            "date": a["date"], "start": a["start_local"], "type": a["type"], "sport": sport_of(a["type"]),
            "name": a["name"], "km": round((a["distance_m"] or 0) / 1000, 2), "duration_s": a["duration_s"],
            "speed": a["avg_speed"], "elev_m": a["elev_gain"], "avg_hr": a["avg_hr"], "load": a["load"],
            "sets": a["sets"], "reps": a["reps"],
            "focus": a["focus"], "te_label": a["te_label"],
        })

    return {
        "generated": today.isoformat(),
        "threshold": threshold,
        "meta": meta,
        "has_data": bool(acts or days),
        "form": {"state": state, "advice": advice, "ctl": now["ctl"], "atl": now["atl"],
                 "tsb": now["tsb"], "pct": now["form_pct"], "ratio": ratio},
        "form_zones": [{"name": n, "min": low} for n, low, _ in FORM_ZONES],
        "today": today_vals,
        "training_status": _training_status(days, today),
        "load_focus": _load_focus(days, today),
        "vo2max": _vo2max(days, today),
        "low_share_4w": low_share,
        "fitness": fitness[-120:],
        "weeks": weeks,
        "trends": trends,
        "activities": recent_acts,
        # The newest activity, with its GPS track when it has one (for the map at the top)
        "last_activity": {**recent_acts[0], "location": acts[-1]["location"], "track": track or None} if acts else None,
        "activities_from": acts[0]["date"] if acts else None,  # the first synced activity, for "this year" totals
    }
