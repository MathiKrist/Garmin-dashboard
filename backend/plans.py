"""A training plan: weeks of runs on the days the athlete picked, toward a race or general fitness, with the race-day
time it projects. Paces follow how the runs go: a run better than planned makes the next paces (and the projection)
faster, a worse one slower, and a run on plan changes nothing.

Everything is worked out again from the stored setup and the synced runs on every build, so nothing else is stored."""
import hashlib
import json
import math
from datetime import date, timedelta

import changes as chat_changes
import workouts
from workouts import LT_FROM_5K, _flat, _repeat, _round5, _run_steps, _step, km_of

GOALS = {"race": "Race", "fitness": "General fitness"}
PHASES = {"base": "Base", "build": "Build", "peak": "Peak", "taper": "Taper"}
DAY_NAMES = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")

WEEKLY_GAIN = 0.005  # planned threshold speed gain per training week
MAX_GAIN = 0.08  # in all, over the plan
TAPER_GAIN = 0.015  # freshness on race day after the taper
RAMP = 1.08  # weekly volume grows at most this much
DELOAD = 0.75  # every 4th week
TAPER_VOLUME = (0.75, 0.6, 0.45)  # of peak volume, the last taper week (race week) last
EASY_MIN_KM = 4
MAX_GROWTH = 2.5  # the weekly volume never goes past this times the starting volume
LONG_STEP = (0.5, 1.5)  # km the long run grows in a normal week, at least and at most
LONG_SHARE = 0.5  # of the week's km, at most
LONG_DOWN = {False: (0.7,), True: (0.75, 0.55)}  # the long run after its peak, as a share of it, for races up to 10 km and longer
TOUCH_REPS = 3  # race week's race-pace session: this many km at race pace

# Adaptation: each run moves the fitness factor this share of the way toward what it showed (half for easy runs,
# whose heart rate says less), unless within the deadband ("on plan"); the factor moves at most WEEK_CAP a week and
# stays within FACTOR_LIMITS
SMOOTHING = 0.3
DEADBAND = 0.01
WEEK_CAP = 0.015
FACTOR_LIMITS = (0.85, 1.15)
WORK_LAP_SHARE = 0.9  # a work rep is a lap at least this share of the work target's slow speed,
WORK_LAP_LENGTH = (0.8, 1.2)  # and about as long as the work step (laps as the watch records the plan's workout)
HR_MODEL_DAYS = 60  # easy runs this long before the plan set the expected pace at each heart rate
HARD_KINDS = ("threshold", "vo2", "race_pace")
KEY_KINDS = HARD_KINDS + ("long",)
TITLES = {**workouts.TITLES, "race_pace": "Race pace", "race": "Race"}


def taper_weeks(metres):
    return 1 if metres <= 10000 else 2 if metres <= 21098 else 3


def ceiling_km(goal, metres):
    """The weekly km a plan builds toward, by race distance (a fitness plan as for 10 km)."""
    if goal == "fitness":
        return 45
    return 35 if metres <= 5000 else 45 if metres <= 10000 else 50 if metres <= 21098 else 70


def long_peak_km(goal, metres):
    """The longest long run, by race distance."""
    if goal == "fitness":
        return 16
    return 12 if metres <= 5000 else 16 if metres <= 10000 else 19 if metres <= 21098 else 32


def long_cap_min(metres):
    return 110 if metres <= 10000 else 150 if metres <= 21098 else 210


def monday(d):
    return d - timedelta(days=d.weekday())


def race_time(lt_speed, metres):
    """Seconds over the distance from threshold speed: 5 km speed from the threshold, then Riegel, as the race goal
    scales Garmin's predictions."""
    t5k = 5000 / (lt_speed / LT_FROM_5K)
    return t5k * (metres / 5000) ** 1.06


def time_range(s, weeks_left, metres):
    """(low, high) around a projected time: wider the further off race day is, rounded to whole minutes for the half
    and longer, 10 s below."""
    spread = 0.01 + 0.0015 * max(0, weeks_left)
    step = 60 if metres > 10000 else 10
    return step * math.floor(s * (1 - spread) / step), step * math.ceil(s * (1 + spread) / step)


# ---- The plan's weeks: phases, volume and sessions

def layout(cfg):
    """[(week start, phase, deload)] from the plan's first Monday to the week of its end date."""
    first, last = monday(date.fromisoformat(cfg["start"])), monday(date.fromisoformat(cfg["date"]))
    n = (last - first).days // 7 + 1
    taper = min(taper_weeks(cfg["metres"]), max(0, n - 2)) if cfg["goal"] == "race" else 0
    train = n - taper
    base = max(1, round(train * (0.4 if cfg["goal"] == "race" else 0.5)))
    build = train - base if cfg["goal"] == "fitness" else max(0, round(train * 0.35))
    out = []
    for i in range(n):
        phase = "base" if i < base else "build" if i < base + build else "peak" if i < train else "taper"
        # Every 4th week is lighter, up to the long run's peak week and the last before the taper (or the plan's end)
        deload = phase != "taper" and (i + 1) % 4 == 0 and i < min(train - 1, long_peak_week(cfg, n))
        out.append((first + timedelta(weeks=i), phase, deload))
    return out


def volumes(cfg, weeks):
    """Planned km per week: up RAMP a week from the starting volume until the taper, stopping at the distance's
    ceiling (or MAX_GROWTH times the start, if lower); less in deload weeks (which don't count as a step up) and taper
    weeks, which take a share of the highest week."""
    start = cfg["start_km"]
    ceiling = max(start, min(ceiling_km(cfg["goal"], cfg["metres"]), start * MAX_GROWTH))
    out, level, tapers = [], start, [w for w in weeks if w[1] == "taper"]
    for i, (_, phase, deload) in enumerate(weeks):
        if phase == "taper":
            out.append(level * TAPER_VOLUME[len(TAPER_VOLUME) - len(tapers) + tapers.index(weeks[i])])
        elif deload:
            out.append(level * DELOAD)
        else:
            level = min(ceiling, level * RAMP) if i else level
            out.append(level)
    return out


def long_peak_week(cfg, n):
    """The week (index) of the longest long run: 3 weeks before race week for the half and longer, 2 for shorter races,
    the last week for a fitness plan."""
    if cfg["goal"] != "race":
        return n - 1
    return max(0, n - 1 - len(LONG_DOWN[cfg["metres"] > 10000]) - 1)


def long_runs(cfg, weeks, kms):
    """The long run's km each week: from 30% of the starting week, up a steady step each normal week so it reaches the
    distance's longest in its peak week (long_peak_week); never more than LONG_SHARE of its week. Deload weeks take
    DELOAD of it without stepping; after the peak it steps down by LONG_DOWN of the longest, to race week."""
    race = cfg["goal"] == "race"
    first = max(6 if race else 5, cfg["start_km"] * 0.3)
    top = max(first, long_peak_km(cfg["goal"], cfg["metres"]))
    peak = long_peak_week(cfg, len(weeks))
    down = LONG_DOWN[cfg["metres"] > 10000]
    steps = sum(1 for i, w in enumerate(weeks) if 0 < i <= peak and not w[2])
    step = min(LONG_STEP[1], max(LONG_STEP[0], (top - first) / steps)) if steps else 0
    out, level, longest = [], first, first
    for i, (w, km) in enumerate(zip(weeks, kms)):
        if i > peak:
            out.append(max(first, longest * down[min(i - peak, len(down)) - 1]))
            continue
        if i and not w[2]:
            level = min(top, level + step)
        long_km = max(first, min(level * (DELOAD if w[2] else 1), km * LONG_SHARE))
        longest = max(longest, long_km)
        out.append(long_km)
    return out


def _circular(a, b):
    return min((a - b) % 7, (b - a) % 7)


def session_days(days, long_day, hard):
    """{weekday: kind}: the long run on its day, the hard sessions as far from it and from each other as the days
    allow, easy runs on the rest."""
    plan = {long_day: "long"}
    free = sorted(d for d in days if d != long_day)
    for kind in hard:
        if not free:
            break
        best = max(free, key=lambda d: (min(_circular(d, x) for x in plan), -d))
        plan[best] = kind
        free.remove(best)
    for d in free:
        plan[d] = "easy"
    return plan


def hard_kinds(cfg, phase, n_days, week_index):
    """The week's hard sessions: one in the base phase or with three days or fewer, two otherwise."""
    long_race = cfg["goal"] == "race" and cfg["metres"] > 10000
    if phase in ("base", "taper"):
        kinds = ["threshold"]
    elif phase in ("build", "taper"):
        kinds = ["threshold", "vo2"] if week_index % 2 == 0 else ["vo2", "threshold"]
    else:  # peak: race pace for the half and longer
        kinds = ["race_pace", "threshold"] if long_race else ["vo2", "threshold"]
    return kinds[:1] if phase in ("base", "taper") or n_days <= 3 else kinds[:2]


class Paces(workouts.Targets):
    """The workout targets from the plan's threshold speed for the week, and its race pace."""

    def __init__(self, profile, lt, race_speed):
        super().__init__({**profile, "lt_speed": lt}, None)
        self.race_speed = race_speed

    def race(self):
        if not self.race_speed:
            return None
        return {"type": "pace", "slow": round(1000 / (self.race_speed * 0.985)), "fast": round(1000 / (self.race_speed * 1.015))}


def _race_pace_steps(total, t):
    n = max(2, min(5, round((total - 25) / 12)))
    return [_step("warmup", "Warm-up", 900, "easy", t.run("easy", 2)),
            _repeat(n, _step("interval", "Race pace", 600, "high", t.race() or t.hr(4)),
                    _step("recovery", "Easy jog", 120, "rest")),
            _step("cooldown", "Cool-down", 600, "easy")]


def _touch_steps(t):
    """Race week: a little race pace to stay sharp, 15 min easy then TOUCH_REPS × 1 km with jogs."""
    rep = round(1000 / t.race_speed) if t.race_speed else 300
    return [_step("warmup", "Warm-up", 900, "easy", t.run("easy", 2)),
            _repeat(TOUCH_REPS, _step("interval", "Race pace", rep, "high", t.race() or t.hr(4)),
                    _step("recovery", "Easy jog", 120, "rest")),
            _step("cooldown", "Cool-down", 300, "easy")]


def _long_steps(total, t, race_finish):
    if not race_finish:
        return _run_steps("long", total, t)
    finish = _round5(total * 0.2)
    return [_step("interval", "Long run", (total - finish) * 60, "easy", t.run("easy", 2)),
            _step("interval", "Race pace finish", finish * 60, "high", t.race() or t.hr(4))]


def make_session(kind, day, cfg, phase, deload, t, km=None, touch=False):
    """One session: its steps, length and distance. `km` sets the length of easy and long runs; `touch` makes a race
    pace session race week's short one."""
    easy = t.pace("easy")
    easy_pace = (easy["slow"] + easy["fast"]) / 120 if easy else 6.5  # min/km
    if kind == "race":
        s = round(cfg["metres"] / t.race_speed) if t.race_speed else None
        return {"date": day.isoformat(), "kind": "race", "title": cfg["name"], "steps": [], "total_s": s,
                "km": round(cfg["metres"] / 1000, 1)}
    if kind in ("easy", "long"):
        cap = long_cap_min(cfg["metres"]) if kind == "long" else 90
        total = _round5(min(km * easy_pace, cap))
        race_finish = kind == "long" and phase == "peak" and not deload and cfg["goal"] == "race" and cfg["metres"] > 10000
        steps = _long_steps(total, t, race_finish) if kind == "long" else _run_steps("easy", total, t)
    elif kind == "shakeout":
        steps = _run_steps("shakeout", 25, t)
    else:
        total = 40 if deload or phase == "taper" else {"base": 45, "build": 50, "peak": 55}[phase]
        steps = (_touch_steps(t) if touch else _race_pace_steps(total, t)) if kind == "race_pace" else _run_steps(kind, total, t)
    title = "Race pace touch" if touch else f"{TITLES[kind]} run" if kind in ("easy", "long", "shakeout") else TITLES[kind]
    flat = list(_flat(steps))
    return {"date": day.isoformat(), "kind": kind, "title": title, "steps": steps,
            "total_s": sum(s["s"] for s in flat), "km": km_of(steps, t) or (round(km, 1) if km else None)}


def race_week(cfg):
    """{date: kind} for the plan days in the 5 days before a race: the one closest to 4 days out (3 at the least) is
    a touch of race pace, the last one a shakeout, and the rest rest days (None)."""
    end = date.fromisoformat(cfg["date"])
    before = [end - timedelta(days=k) for k in range(5, 0, -1) if (end - timedelta(days=k)).weekday() in cfg["days"]]
    roles = dict.fromkeys(before)
    far = [d for d in before if (end - d).days >= 3]
    touch = min(far, key=lambda d: (abs((end - d).days - 4), -(end - d).days)) if far else None
    if touch:
        roles[touch] = "race_pace"
    shake = next((d for d in reversed(before) if d != touch), None)
    if shake:
        roles[shake] = "shakeout"
    return roles


def week_sessions(cfg, i, week, km, t, first_day, long_km):
    """The week's sessions, in date order. Days before the plan started and after its end are left out. The 5 days
    before a race hold only a race pace touch and a shakeout (race_week), and race day is the race. When the long run,
    the hard sessions and the shortest easy runs come to more than the week's km, the second hard session is easy."""
    start, phase, deload = week
    end = date.fromisoformat(cfg["date"])
    days = session_days(cfg["days"], cfg["long_day"], hard_kinds(cfg, phase, len(cfg["days"]), i))
    race = cfg["goal"] == "race"
    roles = race_week(cfg) if race else {}
    out = []
    for wd in sorted(days):
        day = start + timedelta(days=wd)
        if day < first_day or day > end:
            continue
        kind = days[wd]
        if race and day == end:
            kind = "race"
        elif day in roles:
            if roles[day] is None:
                continue
            kind = roles[day]
        out.append([day, kind])
    if race and start <= end < start + timedelta(days=7) and all(d != end for d, _ in out):
        out.append([end, "race"])
        out.sort()

    def hard(day, kind):
        return make_session(kind, day, cfg, phase, deload, t, touch=roles.get(day) == "race_pace")

    hard_runs = {d: hard(d, k) for d, k in out if k in HARD_KINDS}
    n_easy = sum(1 for _, k in out if k == "easy")
    # Room for the long run: two hard sessions only when they leave the easy runs their shortest within the week's km
    # The week's first hard kind stays; the second goes
    kinds = hard_kinds(cfg, phase, len(cfg["days"]), i)
    hard_order = sorted(hard_runs, key=lambda d: kinds.index(hard_runs[d]["kind"]) if hard_runs[d]["kind"] in kinds else len(kinds))
    if len(hard_order) > 1 and long_km + sum(s["km"] or 0 for s in hard_runs.values()) + n_easy * EASY_MIN_KM > km * 1.05:
        second = hard_order[1]
        del hard_runs[second]
        next(x for x in out if x[0] == second)[1] = "easy"
        n_easy += 1
    hard_km = sum(s["km"] or 0 for s in hard_runs.values())
    # An easy run is never longer than 80% of the long run, even when the week then comes out shorter
    easy_km = max(EASY_MIN_KM, min(long_km * 0.8, (km - long_km - hard_km) / n_easy)) if n_easy else 0
    return [hard_runs[day] if day in hard_runs else make_session(kind, day, cfg, phase, deload, t,
                                                                  long_km if kind == "long" else easy_km)
            for day, kind in out]


# ---- How the runs went

def hr_model(acts, start, zones):
    """Expected speed (m/s) at an average heart rate, from easy runs in the HR_MODEL_DAYS before the plan: a line
    fitted through them when it slopes up, otherwise speed per beat. None without enough runs."""
    since = (start - timedelta(days=HR_MODEL_DAYS)).isoformat()
    ceiling = zones[3] if zones else None  # zone 4's floor
    pts = [(a["avg_hr"], a["speed"]) for a in acts
           if a["sport"] == "run" and since <= a["date"] < start.isoformat() and a.get("avg_hr") and a.get("speed")
           and (a.get("duration_s") or 0) >= 1200 and (not ceiling or a["avg_hr"] < ceiling)]
    if len(pts) < 3:
        return None
    n = len(pts)
    mx, my = sum(h for h, _ in pts) / n, sum(v for _, v in pts) / n
    var = sum((h - mx) ** 2 for h, _ in pts)
    slope = sum((h - mx) * (v - my) for h, v in pts) / var if var else 0
    if n >= 6 and slope > 0:
        return lambda hr: my + slope * (hr - mx)
    per_beat = sorted(v / h for h, v in pts)[n // 2]
    return lambda hr: per_beat * hr


def _work_step(steps):
    """The first paced work step."""
    return next((s for s in _flat(steps)
                 if s["kind"] == "interval" and (s["target"] or {}).get("type") == "pace" and s["intensity"] == "high"), None)


def judge(session, run, laps, model, gain, factor, t):
    """(what the run says the fitness factor is, the run's actual pace for the page), or (None, pace) when the run
    can't say: no heart rate for an easy run, no laps for intervals."""
    pace = round(1000 / run["speed"]) if run.get("speed") else None
    kind = session["kind"]
    if kind in ("easy", "long"):
        # A run at zone 4 or harder wasn't easy, and the heart rate model only knows easy runs
        if not (model and run.get("avg_hr") and run.get("speed")) or run["avg_hr"] >= t.floors[3]:
            return None, pace
        return run["speed"] / (model(run["avg_hr"]) * gain), pace
    if kind in HARD_KINDS:
        step = _work_step(session["steps"])
        if not (step and laps):
            return None, pace
        target, lo, hi = step["target"], step["s"] * WORK_LAP_LENGTH[0], step["s"] * WORK_LAP_LENGTH[1]
        work = [l for l in laps if l.get("speed") and lo <= (l.get("duration_s") or 0) <= hi
                and l["speed"] >= 1000 / target["slow"] * WORK_LAP_SHARE]
        if not work:
            return None, pace
        secs = sum(l["duration_s"] for l in work)
        speed = sum(l["speed"] * l["duration_s"] for l in work) / secs
        mid = 2000 / (target["slow"] + target["fast"])
        seen = factor * speed / mid
        hrs = [l["avg_hr"] for l in work if l.get("avg_hr")]
        ceiling = t.floors[4] if kind in ("threshold", "race_pace") else None  # zone 5's floor
        if ceiling and hrs and sum(hrs) / len(hrs) > ceiling:
            seen = min(seen, factor)  # faster, but only by working harder than the session asks
        return seen, round(1000 / speed)
    return None, pace


def _match(sessions, runs):
    """{session index: run}: the longest run on the session's day, else one a day either side on a day without its
    own session."""
    by_day = {}
    for r in runs:
        by_day.setdefault(r["date"], []).append(r)
    planned = {s["date"] for s in sessions}
    used, out = set(), {}
    for i, s in enumerate(sessions):
        d = date.fromisoformat(s["date"])
        options = by_day.get(s["date"], [])
        if not options:
            for near in (d - timedelta(days=1), d + timedelta(days=1)):
                if near.isoformat() not in planned and monday(near) == monday(d):
                    options = [r for r in by_day.get(near.isoformat(), []) if r["id"] not in used]
                    if options:
                        break
        options = [r for r in options if r["id"] not in used]
        if options:
            r = max(options, key=lambda r: r.get("km") or 0)
            used.add(r["id"])
            out[i] = r
    return out


def reshuffle(sessions, today):
    """A key session (hard or long) missed this week moves to the next plan day from today on, in place of an easy
    run, which is dropped; a missed easy run is just missed. A run on that day counts for the moved session. Days
    changed in the chat stay as they are."""
    for s in sessions:
        if s["status"] != "missed" or s["kind"] not in KEY_KINDS or s.get("changed"):
            continue
        spot = next((x for x in sessions if x["kind"] == "easy" and x["date"] >= today.isoformat()
                     and not x.get("moved_from") and not x.get("changed")), None)
        if spot:
            moved = {**s, "date": spot["date"], "status": spot["status"], "run": spot["run"],
                     "moved_from": s["date"]}
            sessions[sessions.index(spot)] = moved
            s["status"] = "moved"
    return sessions


def apply_changes(sessions, changes, t):
    """The week's sessions with the chat's changes: a changed day's session replaced, removed for a rest day, or
    added on a day without one."""
    days = {c["date"]: c for c in changes}
    out = [s for s in sessions if s["date"] not in days]
    out += [x for x in (chat_changes.session(c, t) for c in days.values()) if x]
    return sorted(out, key=lambda s: s["date"])


# ---- The whole plan

def fitness_now(profile, pred_5k):
    """Threshold speed (m/s) to start a plan from: Garmin's lactate threshold, or from its 5 km prediction."""
    return workouts.Targets(profile, pred_5k).lt


def build(cfg, acts, laps_by_id, profile, today, sent=(), changes=()):
    """The plan as the page shows it. `acts` are the activity summaries (any order); `changes` are the chat's, of which
    the runs within the plan count."""
    start = date.fromisoformat(cfg["start"])
    end = date.fromisoformat(cfg["date"])
    weeks = layout(cfg)
    kms = volumes(cfg, weeks)
    longs = long_runs(cfg, weeks, kms)
    lt0 = cfg.get("fitness0")
    zones = profile.get("zones") or workouts.Targets(profile, None).floors
    model = hr_model(acts, start, zones)
    runs = [a for a in acts if a["sport"] == "run" and start.isoformat() <= a["date"] <= end.isoformat()]
    train_weeks = sum(1 for w in weeks if w[1] != "taper")
    race = cfg["goal"] == "race"
    sent_keys = {(x["date"], x["key"]) for x in sent}

    def gain(i):
        return 1 + min(MAX_GAIN, WEEKLY_GAIN * i)

    def projection(factor):
        if not lt0:
            return None
        lt = lt0 * gain(train_weeks) * factor * (1 + TAPER_GAIN if race else 1)
        return round(race_time(lt, cfg["metres"]))

    factor, change, out_weeks, this_week = 1.0, None, [], monday(today)
    for i, (wk, km, long_km) in enumerate(zip(weeks, kms, longs)):
        lt = lt0 * gain(i) * factor if lt0 else None
        race_s = projection(factor)
        t = Paces(profile, lt, cfg["metres"] / race_s if race_s and race else None)
        week_start = wk[0]
        week_end = week_start + timedelta(days=6)
        sessions = week_sessions(cfg, i, wk, km, t, start, long_km)
        sessions = apply_changes(sessions, [c for c in changes if c["sport"] == "run" and max(week_start, start)
                                            <= date.fromisoformat(c["date"]) <= min(week_end, end)], t)
        week_runs = [r for r in runs if monday(date.fromisoformat(r["date"])) == week_start]
        matched = _match(sessions, week_runs)
        for j, s in enumerate(sessions):
            r = matched.get(j)
            s["status"] = "done" if r else "upcoming" if s["date"] > today.isoformat() else "today" if s["date"] == today.isoformat() else "missed"
            s["run"] = r
        if week_start == this_week:
            sessions = reshuffle(sessions, today)
        # How the done runs went, in date order, moving the factor for the weeks after
        week_factor = factor
        for s in sessions:
            r = s.pop("run", None)
            if s["status"] != "done":
                continue
            seen, pace = judge(s, r, laps_by_id.get(r["id"]), model, gain(i), factor, t)
            s["actual"] = {"id": r["id"], "km": r.get("km"), "pace": pace, "hr": r.get("avg_hr"),
                           "verdict": None if seen is None else "better" if seen > factor * (1 + DEADBAND)
                           else "worse" if seen < factor * (1 - DEADBAND) else "on plan"}
            if seen is not None and abs(seen - factor) > factor * DEADBAND:
                before = projection(factor)
                factor += SMOOTHING * (0.5 if s["kind"] in ("easy", "long") else 1) * (seen - factor)
                factor = max(week_factor * (1 - WEEK_CAP), min(week_factor * (1 + WEEK_CAP), factor))
                factor = max(FACTOR_LIMITS[0], min(FACTOR_LIMITS[1], factor))
                if before and projection(factor) != before:
                    change = {"date": s["date"], "title": s["title"], "from_s": before}
        for s in sessions:
            s["key"] = session_key(s)
            s["sent"] = (s["date"], s["key"]) in sent_keys
            s["sendable"] = bool(s["steps"]) and s["status"] in ("today", "upcoming")
        out_weeks.append({
            "start": week_start.isoformat(), "phase": wk[1], "deload": wk[2],
            "km_planned": round(sum(s["km"] or 0 for s in sessions if s["kind"] != "race"), 1),
            "km_done": round(sum(r.get("km") or 0 for r in week_runs), 1),
            "sessions": sessions,
        })

    weeks_left = max(0, (end - today).days / 7)
    s = projection(factor)
    proj = None
    if s:
        low, high = time_range(s, weeks_left, cfg["metres"])
        # The last run that moved the projection, and what it was before
        proj = {"s": s, "low": low, "high": high, "change": change}
    plan = {
        "config": cfg, "goal_label": GOALS[cfg["goal"]], "weeks": out_weeks, "factor": round(factor, 4),
        "week_index": next((i for i, w in enumerate(weeks) if w[0] == this_week), None),
        "weeks_left": math.ceil(weeks_left), "projection": proj,
        "phases": PHASES, "over": today > end,
    }
    coming = coming_week(plan, today)
    plan["send"] = {"key": week_key(coming), "count": len(coming), "sent": bool(coming) and all(s["sent"] for s in coming)}
    return plan


def session_key(s):
    """Changes whenever what would be sent to the watch changes."""
    return hashlib.sha256(json.dumps([s["date"], s["title"], s["steps"]], sort_keys=True).encode()).hexdigest()[:16]


def coming_week(plan, today):
    """The sessions in the next 7 days, today first, that can go to the watch."""
    until = (today + timedelta(days=6)).isoformat()
    return [s for w in plan["weeks"] for s in w["sessions"] if today.isoformat() <= s["date"] <= until and s["sendable"]]


def week_key(sessions):
    return hashlib.sha256("|".join(s["key"] for s in sessions).encode()).hexdigest()[:16]


def todays(plan, today):
    """Today's run as a workout for the Workout page (the shape workouts.recommend gives), or a rest day."""
    if plan["over"]:
        return None
    day = today.isoformat()
    all_sessions = [(w, s) for w in plan["weeks"] for s in w["sessions"]]
    found = next(((w, s) for w, s in all_sessions if s["date"] == day and s["status"] in ("today", "done")), None)
    i = plan["week_index"]
    why = [f"Plan week {i + 1} of {len(plan['weeks'])}" if i is not None else "Plan"]
    if found:
        w, s = found
        why.append(PHASES[w["phase"]] + (" · deload" if w["deload"] else ""))
        if s.get("changed"):
            why.append("Changed in chat" + (f": {s['reason']}" if s["reason"] else ""))
        return {"sport": "run", "label": workouts.SPORTS["run"], "kind": s["kind"], "title": s["title"],
                "total_s": s["total_s"] or 0, "km": s["km"], "why": why, "steps": s["steps"], "paces": True,
                "plan": True, "key": s["key"], "sent": s["sent"]}
    nxt = next((s for _, s in all_sessions if s["date"] > day and s["status"] == "upcoming"), None)
    return {"sport": "run", "label": workouts.SPORTS["run"], "kind": "rest", "title": "Rest day", "total_s": 0,
            "km": None, "why": why, "steps": [], "paces": False, "plan": True, "sent": False,
            "next": {"date": nxt["date"], "title": nxt["title"]} if nxt else None}
