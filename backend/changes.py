"""Workouts changed in the chat: a session put on a day in place of the suggested or planned one, or a rest day.

Changes are stored as named targets ("easy", "threshold", "zone 2") rather than paces, so they follow the same paces as
everything else: a plan's paces still adapt, and a change to a plan day gets that week's paces."""
import json
from datetime import date, timedelta

import db
import workouts
from workouts import TITLES, NOUN, _flat, _round5, _run_steps, _bike_steps, _step, _repeat, km_of

KINDS = tuple(TITLES) + ("race_pace", "custom")
STEP_TYPES = ("warmup", "interval", "recovery", "cooldown")
TARGETS = ("recovery", "easy", "threshold", "vo2", "anaerobic", "race", "zone1", "zone2", "zone3", "zone4", "zone5", "none")
HARD_TARGETS = {"threshold", "vo2", "race", "zone4", "zone5"}
BIKE_ZONE = {"recovery": 1, "easy": 2, "threshold": 4, "vo2": 5, "race": 4}
RUN_ZONE = {"recovery": 1, "easy": 2, "threshold": 4, "vo2": 5}
AHEAD_DAYS = 120  # how far ahead a change can go
KEEP_DAYS = 120  # how long past changes are kept (a plan's history shows them)
MAX_S = 6 * 3600


def load(conn):
    return json.loads(conn.execute("SELECT value FROM meta WHERE key = 'workout_changes'").fetchone()[0]) \
        if conn.execute("SELECT 1 FROM meta WHERE key = 'workout_changes'").fetchone() else []


def save(conn, changes, today):
    keep = (today - timedelta(days=KEEP_DAYS)).isoformat()
    changes = sorted((c for c in changes if c["date"] >= keep), key=lambda c: (c["date"], c["sport"]))
    db.set_meta(conn, "workout_changes", json.dumps(changes))


def put(changes, change):
    """The list with the change in place of any other on its day and sport."""
    return [c for c in changes if (c["date"], c["sport"]) != (change["date"], change["sport"])] + [change]


# ---- Checking what the chat asks for

def check_day(day, today):
    d = date.fromisoformat(day)
    if d < today:
        raise ValueError(f"{day} is in the past. Only today and later can change.")
    if d > today + timedelta(days=AHEAD_DAYS):
        raise ValueError(f"{day} is too far ahead (at most {AHEAD_DAYS} days).")
    return d.isoformat()


def _check_steps(steps, depth=0):
    if not isinstance(steps, list) or not steps:
        raise ValueError("steps must be a non-empty list.")
    out = []
    for s in steps:
        if s.get("type") == "repeat":
            if depth:
                raise ValueError("A repeat can't hold another repeat.")
            times = int(s.get("times") or 0)
            if not 1 <= times <= 30:
                raise ValueError("A repeat is done 1 to 30 times.")
            out.append({"type": "repeat", "times": times, "steps": _check_steps(s.get("steps"), depth + 1)})
            continue
        if s.get("type") not in STEP_TYPES:
            raise ValueError(f"Step type must be one of {', '.join(STEP_TYPES + ('repeat',))}.")
        minutes = float(s.get("minutes") or 0)
        if not 0 < minutes <= 300:
            raise ValueError("Each step needs minutes between 0 and 300 (use 0.5 for 30 seconds).")
        target = s.get("target") or "none"
        if target not in TARGETS:
            raise ValueError(f"target must be one of {', '.join(TARGETS)}.")
        out.append({"type": s["type"], "label": str(s.get("label") or s["type"].capitalize())[:40], "minutes": minutes,
                    "target": target, "note": str(s["note"])[:60] if s.get("note") else None})
    return out


def make(day, sport, *, kind, minutes=None, title=None, steps=None, reason="", today):
    """A change putting a session on a day, checked; ValueError says what's wrong, for the chat to fix."""
    if sport not in workouts.SPORTS:
        raise ValueError("sport must be run or bike.")
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}.")
    change = {"date": check_day(day, today), "sport": sport, "rest": False, "kind": kind,
              "title": str(title).strip()[:60] if title else None, "reason": str(reason or "")[:120]}
    if steps:
        change["steps"] = _check_steps(steps)
    elif kind in TITLES and minutes:
        change["minutes"] = max(5, min(300, round(float(minutes))))
    else:
        raise ValueError("Give minutes for a standard session, or steps for anything else (custom and race_pace need steps).")
    return change


def rest(day, sport, reason, today):
    if sport not in workouts.SPORTS:
        raise ValueError("sport must be run or bike.")
    return {"date": check_day(day, today), "sport": sport, "rest": True, "reason": str(reason or "")[:120]}


def copy(session, day, sport, reason):
    """A change putting an existing session (already worked out, with its paces) on another day."""
    return {"date": day, "sport": sport, "rest": False, "kind": session.get("kind", "custom"), "title": session["title"],
            "fixed_steps": session["steps"], "reason": str(reason or "")[:120]}


# ---- Turning a change into a session

def _target(name, sport, t):
    if name == "none":
        return None
    if name.startswith("zone"):
        return t.hr(int(name[4:]))
    if sport == "bike":
        return t.hr(BIKE_ZONE[name]) if name in BIKE_ZONE else None
    if name == "race":
        return (t.race() if hasattr(t, "race") else None) or t.run("threshold", 4)
    if name == "anaerobic":
        return t.pace("anaerobic")
    return t.run(name, RUN_ZONE[name])


def _intensity(step):
    if step["type"] == "recovery":
        return "rest"
    if step["target"] == "anaerobic":
        return "anaerobic"
    return "high" if step["target"] in HARD_TARGETS else "easy"


def _steps(steps, sport, t):
    out = []
    for s in steps:
        if s["type"] == "repeat":
            out.append(_repeat(s["times"], *_steps(s["steps"], sport, t)))
        else:
            out.append(_step(s["type"], s["label"], s["minutes"] * 60, _intensity(s), _target(s["target"], sport, t), s["note"]))
    return out


def title_of(change):
    kind = change["kind"]
    if change.get("title"):
        return change["title"]
    if kind in ("recovery", "easy", "long", "shakeout"):
        return f"{TITLES[kind]} {NOUN[change['sport']]}"
    return {"race_pace": "Race pace", "custom": "Workout"}.get(kind) or TITLES[kind]


def session(change, t):
    """The session a change puts on its day, as the plan holds sessions; None for a rest day."""
    if change["rest"]:
        return None
    sport, kind = change["sport"], change["kind"]
    if change.get("fixed_steps"):
        steps = change["fixed_steps"]
    elif change.get("steps"):
        steps = _steps(change["steps"], sport, t)
    else:
        steps = (_run_steps if sport == "run" else _bike_steps)(kind, _round5(change["minutes"]), t)
    title = title_of(change)
    total = sum(s["s"] for s in _flat(steps))
    return {"date": change["date"], "kind": kind, "title": title, "steps": steps, "total_s": min(total, MAX_S),
            "km": km_of(steps, t) if sport == "run" else None, "changed": True, "reason": change.get("reason") or ""}


def workout(change, t, sent):
    """Today's workout from a change, in the shape workouts.recommend gives."""
    sport = change["sport"]
    why = ["Changed in chat"] + ([change["reason"]] if change.get("reason") else [])
    s = session(change, t)
    base = {"sport": sport, "label": workouts.SPORTS[sport], "why": why, "changed": True}
    if not s:
        return {**base, "kind": "rest", "title": "Rest day", "total_s": 0, "km": None, "steps": [], "paces": False,
                "sent": False, "next": None}
    return {**base, "kind": s["kind"], "title": s["title"], "total_s": s["total_s"], "km": s["km"], "steps": s["steps"],
            "paces": sport == "run" and t.lt is not None,
            "sent": any(x.get("date") == change["date"] and x.get("sport") == sport and x.get("title") == s["title"] for x in sent)}
