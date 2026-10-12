"""The training plan: its weeks, sessions, adaptation and projection. Run from the project folder:
python -m unittest discover tests"""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import plans  # noqa: E402

START = date(2026, 9, 7)  # a Monday
PROFILE = {"zones": [99, 118, 138, 158, 177, 198]}
LT = 1000 / 300  # threshold 5:00 /km


def config(**kw):
    cfg = {"goal": "race", "name": "Half", "metres": 21098, "date": (START + timedelta(weeks=12, days=6)).isoformat(),
           "target_s": None, "start": START.isoformat(), "days": [1, 3, 5, 6], "long_day": 6, "start_km": 30, "fitness0": LT}
    return {**cfg, **kw}


def run(id, day, km=8, pace=345, hr=140, minutes=None):
    return {"id": id, "sport": "run", "date": day.isoformat(), "km": km, "speed": 1000 / pace, "avg_hr": hr,
            "duration_s": (minutes or km * pace / 60) * 60}


def history():
    """Easy runs before the plan, for the heart rate model: faster as the heart rate goes up."""
    return [run(100 + i, START - timedelta(days=2 + 3 * i), pace=360 - 4 * i, hr=135 + 2 * i) for i in range(8)]


def build(cfg=None, acts=(), laps=None, today=None):
    return plans.build(cfg or config(), list(acts), laps or {}, PROFILE, today or START + timedelta(days=13))


def sessions(plan, week):
    return plan["weeks"][week]["sessions"]


class Layout(unittest.TestCase):
    def test_taper_by_distance(self):
        for metres, taper in ((5000, 1), (10000, 1), (21098, 2), (42195, 3)):
            phases = [w[1] for w in plans.layout(config(metres=metres))]
            self.assertEqual(phases.count("taper"), taper, metres)
            self.assertEqual(phases[-1], "taper")

    def test_fitness_plan_has_no_taper(self):
        phases = [w[1] for w in plans.layout(config(goal="fitness"))]
        self.assertNotIn("taper", phases)
        self.assertEqual(phases[0], "base")

    def test_volume_ramps_slowly_with_deloads(self):
        cfg = config()
        weeks = plans.layout(cfg)
        kms = plans.volumes(cfg, weeks)
        normal = [km for km, w in zip(kms, weeks) if not w[2] and w[1] != "taper"]
        for a, b in zip(normal, normal[1:]):
            self.assertLessEqual(b, a * 1.1 + 1e-9)
        self.assertTrue(any(w[2] for w in weeks))
        for km, w in zip(kms, weeks):
            if w[2]:
                self.assertLess(km, max(normal))
        self.assertAlmostEqual(max(kms), 50)  # the half's ceiling

    def test_volume_keeps_building_on_a_long_plan(self):
        # 30 weeks from 19 km: up to 2.5 times the start, under the half's ceiling, and held until the taper
        cfg = config(start_km=19, date=(START + timedelta(weeks=29, days=5)).isoformat())
        weeks = plans.layout(cfg)
        kms = plans.volumes(cfg, weeks)
        self.assertAlmostEqual(max(kms), 19 * plans.MAX_GROWTH)
        last = max(i for i, w in enumerate(weeks) if w[1] != "taper" and not w[2])
        self.assertAlmostEqual(kms[last], max(kms))

    def test_long_run_builds_to_the_distance(self):
        cfg = config(start_km=19, date=(START + timedelta(weeks=29, days=5)).isoformat())
        weeks = plans.layout(cfg)
        kms = plans.volumes(cfg, weeks)
        longs = plans.long_runs(cfg, weeks, kms)
        # The longest 3 weeks before race week, then down to 75% and 55% of it
        peak = len(weeks) - 4
        self.assertEqual(plans.long_peak_week(cfg, len(weeks)), peak)
        self.assertAlmostEqual(longs[peak], plans.long_peak_km("race", 21098))
        self.assertEqual(longs.index(max(longs)), peak)
        self.assertAlmostEqual(longs[peak + 1], longs[peak] * 0.75)
        self.assertAlmostEqual(longs[peak + 2], longs[peak] * 0.55)
        self.assertFalse(any(w[2] for w in weeks[peak:]))
        for km, long_km in zip(kms, longs):
            self.assertLessEqual(long_km, max(6, km * plans.LONG_SHARE) + 1e-9)
        normal = [x for x, w in zip(longs, weeks) if w[1] != "taper" and not w[2]]
        for a, b in zip(normal, normal[1:]):
            self.assertLessEqual(b - a, plans.LONG_STEP[1] + 1e-9)

    def test_short_plan_peaks_lower(self):
        # 8 weeks from 30 km: the ramp limits it before the ceiling, and the long run steps at most LONG_STEP
        cfg = config(date=(START + timedelta(weeks=7, days=5)).isoformat())
        weeks = plans.layout(cfg)
        kms = plans.volumes(cfg, weeks)
        self.assertLess(max(kms), 50)
        self.assertLess(max(plans.long_runs(cfg, weeks, kms)), plans.long_peak_km("race", 21098))


class Sessions(unittest.TestCase):
    def test_days_and_long_run_day(self):
        for days in ([2, 6], [1, 3, 6], [0, 2, 4, 6], [0, 1, 3, 4, 6]):
            plan = build(config(days=days, long_day=6))
            week = sessions(plan, 4)
            self.assertEqual(sorted(date.fromisoformat(s["date"]).weekday() for s in week), days)
            self.assertEqual(next(s for s in week if s["kind"] == "long")["date"], (START + timedelta(weeks=4, days=6)).isoformat())

    def test_hard_sessions_not_next_to_the_long_run(self):
        plan = build(config(days=[0, 1, 3, 5, 6], long_day=6))
        for w in plan["weeks"][4:8]:
            for s in w["sessions"]:
                if s["kind"] in plans.HARD_KINDS:
                    self.assertNotIn(date.fromisoformat(s["date"]).weekday(), (0, 5))

    def test_race_week_ends_with_shakeout_and_race(self):
        plan = build()
        last = sessions(plan, -1)
        self.assertEqual(last[-1]["kind"], "race")
        self.assertEqual(last[-1]["date"], config()["date"])
        self.assertEqual(last[-2]["kind"], "shakeout")

    def test_race_week_is_a_touch_of_race_pace_and_a_shakeout(self):
        # Race week's days: Tue, Thu, Sat, Sun race. Tuesday (5 days out) gets the race pace touch, Saturday the
        # shakeout, and Thursday is rest
        last = sessions(build(), -1)
        kinds = [s["kind"] for s in last]
        self.assertEqual(kinds, ["race_pace", "shakeout", "race"])
        touch = [s for s in last if s["kind"] == "race_pace"]
        self.assertEqual(len(touch), 1)
        self.assertEqual(touch[0]["title"], "Race pace touch")
        self.assertEqual(touch[0]["date"], (START + timedelta(weeks=12, days=1)).isoformat())

    def test_one_hard_session_when_the_long_run_needs_room(self):
        # 4 days on a small volume: the long run and two hard sessions don't fit, so the second is easy
        small = build(config(start_km=19, date=(START + timedelta(weeks=12, days=6)).isoformat()))
        peak = plans.long_peak_week(small["config"], len(small["weeks"]))
        for w in small["weeks"][:peak + 1]:
            self.assertLessEqual(sum(1 for s in w["sessions"] if s["kind"] in plans.HARD_KINDS), 1)
        # On a bigger volume both stay
        big = build(config(start_km=45))
        self.assertEqual(sum(1 for s in sessions(big, 6) if s["kind"] in plans.HARD_KINDS), 2)

    def test_race_pace_in_the_peak_for_a_half(self):
        plan = build()
        kinds = {s["kind"] for w in plan["weeks"] if w["phase"] == "peak" for s in w["sessions"]}
        self.assertIn("race_pace", kinds)


class Adaptation(unittest.TestCase):
    def threshold(self, plan, week):
        return next(s for s in sessions(plan, week) if s["kind"] == "threshold")

    def test_no_runs_changes_nothing(self):
        plan = build(acts=history())
        self.assertEqual(plan["factor"], 1.0)

    def test_on_plan_changes_nothing(self):
        base = build(acts=history())
        s = self.threshold(base, 0)
        day = date.fromisoformat(s["date"])
        work = plans._work_step(s["steps"])
        mid = (work["target"]["slow"] + work["target"]["fast"]) / 2
        laps = {1: [{"speed": 1000 / mid, "duration_s": work["s"], "avg_hr": 165}] * 3}
        plan = build(acts=history() + [run(1, day, km=10, pace=mid)], laps=laps)
        self.assertEqual(plan["factor"], 1.0)
        self.assertEqual(self.threshold(plan, 0)["actual"]["verdict"], "on plan")

    def test_faster_intervals_speed_up_capped_per_week(self):
        base = build(acts=history())
        s = self.threshold(base, 0)
        work = plans._work_step(s["steps"])
        laps = {1: [{"speed": 1000 / (work["target"]["fast"] * 0.9), "duration_s": work["s"], "avg_hr": 165}] * 3}
        plan = build(acts=history() + [run(1, date.fromisoformat(s["date"]), km=10)], laps=laps)
        self.assertAlmostEqual(plan["factor"], 1 + plans.WEEK_CAP)
        self.assertEqual(self.threshold(plan, 0)["actual"]["verdict"], "better")
        # Next week's threshold paces are faster, and so is the projection
        self.assertLess(plans._work_step(self.threshold(plan, 2)["steps"])["target"]["fast"],
                        plans._work_step(self.threshold(base, 2)["steps"])["target"]["fast"])
        self.assertLess(plan["projection"]["s"], base["projection"]["s"])
        # The run that moved it, and the time before
        change = plan["projection"]["change"]
        self.assertEqual((change["date"], change["from_s"]), (s["date"], base["projection"]["s"]))

    def test_faster_at_too_high_heart_rate_counts_as_on_plan(self):
        base = build(acts=history())
        s = self.threshold(base, 0)
        work = plans._work_step(s["steps"])
        laps = {1: [{"speed": 1000 / (work["target"]["fast"] * 0.9), "duration_s": work["s"], "avg_hr": 185}] * 3}
        plan = build(acts=history() + [run(1, date.fromisoformat(s["date"]), km=10)], laps=laps)
        self.assertEqual(plan["factor"], 1.0)

    def test_slow_easy_runs_slow_down(self):
        base = build(acts=history(), today=START + timedelta(weeks=4))
        easy = [s for w in base["weeks"][:3] for s in w["sessions"] if s["kind"] == "easy"]
        acts = history() + [run(200 + i, date.fromisoformat(s["date"]), pace=420, hr=145) for i, s in enumerate(easy)]
        plan = build(acts=acts, today=START + timedelta(weeks=4))
        self.assertLess(plan["factor"], 1.0)
        self.assertGreater(plan["projection"]["s"], base["projection"]["s"])


class Reshuffle(unittest.TestCase):
    def test_missed_key_session_moves_to_the_next_easy_day(self):
        # Week 1: Tue easy, Thu a hard session (speed, this week), Sat easy, Sun long. Thursday missed, today Friday.
        today = START + timedelta(weeks=1, days=4)
        plan = build(today=today)
        week = sessions(plan, 1)
        thursday = (START + timedelta(weeks=1, days=3)).isoformat()
        saturday = (START + timedelta(weeks=1, days=5)).isoformat()
        self.assertEqual(next(s for s in week if s["date"] == thursday)["status"], "moved")
        moved = next(s for s in week if s["date"] == saturday)
        self.assertIn(moved["kind"], plans.HARD_KINDS)
        self.assertEqual(moved["moved_from"], thursday)

    def test_missed_easy_run_stays_missed(self):
        today = START + timedelta(weeks=1, days=2)
        week = sessions(build(today=today), 1)
        self.assertEqual(week[0]["status"], "missed")
        self.assertFalse(any(s.get("moved_from") for s in week))


class Projection(unittest.TestCase):
    def test_range_narrows_toward_race_day(self):
        early = build(today=START + timedelta(days=1))["projection"]
        late = build(today=START + timedelta(weeks=12))["projection"]
        self.assertGreater(early["high"] - early["low"], late["high"] - late["low"])
        self.assertLessEqual(early["low"], early["s"])
        self.assertGreaterEqual(early["high"], early["s"])

    def test_no_runs_no_change(self):
        self.assertIsNone(build(acts=history())["projection"]["change"])

    def test_whole_minutes_for_a_half(self):
        p = build()["projection"]
        self.assertEqual((p["low"] % 60, p["high"] % 60), (0, 0))

    def test_no_fitness_no_projection(self):
        plan = build(config(fitness0=None))
        self.assertIsNone(plan["projection"])
        # Targets fall back to heart rate zones
        s = next(s for s in sessions(plan, 0) if s["kind"] == "easy")
        self.assertEqual(s["steps"][0]["target"]["type"], "hr")


class Today(unittest.TestCase):
    def test_plan_day_and_rest_day(self):
        tue = START + timedelta(days=1)
        self.assertEqual(plans.todays(build(today=tue), tue)[0]["kind"], "easy")
        wed = START + timedelta(days=2)
        rest = plans.todays(build(today=wed), wed)[0]
        self.assertEqual(rest["kind"], "rest")
        self.assertEqual(rest["next"]["date"], (START + timedelta(days=3)).isoformat())

    def test_send_key_changes_with_the_paces(self):
        a = build(acts=history())
        s = next(s for s in sessions(a, 0) if s["kind"] == "threshold")
        work = plans._work_step(s["steps"])
        laps = {1: [{"speed": 1000 / (work["target"]["fast"] * 0.9), "duration_s": work["s"], "avg_hr": 165}] * 3}
        b = build(acts=history() + [run(1, date.fromisoformat(s["date"]), km=10)], laps=laps)
        self.assertNotEqual(a["send"]["key"], b["send"]["key"])


class Variants(unittest.TestCase):
    def titles(self, plan, kind):
        return {s["title"] for w in plan["weeks"] for s in w["sessions"] if s["kind"] == kind}

    def test_named_sessions_rotate(self):
        plan = build()
        self.assertTrue({"Tempo run", "Cruise intervals"} <= self.titles(plan, "threshold"))
        self.assertGreater(len(self.titles(plan, "threshold")), 2)
        self.assertGreater(len(self.titles(plan, "vo2") | self.titles(plan, "anaerobic")), 2)
        # Each name has its own steps
        t = plans.Paces(PROFILE, LT, None)
        shapes = {v: tuple(s["label"] for s in plans._flat(plans._variant_steps(v, 50, t))) for v in plans.VARIANTS}
        self.assertEqual(len(set(shapes.values())), len(plans.VARIANTS))

    def test_over_unders_judged_per_rep(self):
        t = plans.Paces(PROFILE, LT, None)
        steps = plans._variant_steps("over_under", 50, t)
        flat = list(plans._flat(steps))
        # Every rep run right at its own target: on plan, though the overs and unders differ
        laps = [{"speed": 2000 / (s["target"]["slow"] + s["target"]["fast"]) if (s["target"] or {}).get("type") == "pace"
                 else 1000 / 400, "duration_s": s["s"], "avg_hr": 160} for s in flat]
        session = {"kind": "threshold", "steps": steps}
        seen, _ = plans.judge(session, {"speed": 3.0}, laps, None, 1, 1.0, t)
        self.assertAlmostEqual(seen, 1.0, places=3)
        # Laps that don't follow the steps: judged by duration against the first rep
        seen, _ = plans.judge(session, {"speed": 3.0}, laps[1:4], None, 1, 1.0, t)
        self.assertIsNotNone(seen)

    def test_speed_reps_are_400_m_or_longer(self):
        t = plans.Paces(PROFILE, LT, None)
        for v in ("400", "600", "400_sets"):
            reps = [s for s in plans._flat(plans._variant_steps(v, 50, t)) if s["intensity"] == "anaerobic"]
            self.assertTrue(reps)
            self.assertTrue(all(int(s["label"].split()[0]) >= 400 for s in reps))


class Speed(unittest.TestCase):
    def kinds(self, plan):
        return [{s["kind"] for s in w["sessions"]} for w in plan["weeks"]]

    def test_speed_only_in_build_and_peak_and_never_in_lighter_weeks(self):
        for cfg in (config(), config(metres=5000), config(goal="fitness"), config(goal="maintain")):
            plan = build(cfg)
            weeks = [w for w, k in zip(plan["weeks"], self.kinds(plan)) if "anaerobic" in k]
            self.assertTrue(weeks, cfg)
            self.assertTrue(all(not w["deload"] and w["phase"] in ("build", "peak", "steady") for w in weeks), cfg)
        # A half has one or two; a base builder none
        self.assertIn(len([k for k in self.kinds(build()) if "anaerobic" in k]), (1, 2))
        self.assertFalse(any("anaerobic" in k for k in self.kinds(build(config(goal="base")))))

    def test_5k_alternates_speed_and_vo2(self):
        plan = build(config(metres=5000))
        build_weeks = [k for w, k in zip(plan["weeks"], self.kinds(plan)) if w["phase"] in ("build", "peak")]
        self.assertTrue(any("anaerobic" in k for k in build_weeks) and any("vo2" in k for k in build_weeks))
        self.assertFalse(any("anaerobic" in k for w, k in zip(plan["weeks"], self.kinds(plan)) if w["phase"] == "taper"))

    def test_speed_sessions_dont_move_the_factor(self):
        base = build(acts=history())
        s = next(s for w in base["weeks"] for s in w["sessions"] if s["kind"] == "anaerobic")
        work = plans._work_step(s["steps"])
        laps = {1: [{"speed": 1000 / (work["target"]["fast"] * 0.85), "duration_s": work["s"], "avg_hr": 175}] * 8}
        plan = build(acts=history() + [run(1, date.fromisoformat(s["date"]), km=8)], laps=laps)
        done = next(x for w in plan["weeks"] for x in w["sessions"] if x["date"] == s["date"])
        self.assertEqual(done["actual"]["verdict"], "better")
        self.assertEqual(plan["factor"], 1.0)


class PlanTypes(unittest.TestCase):
    def plan(self, goal, weeks, **kw):
        return build(config(goal=goal, date=(START + timedelta(weeks=weeks, days=5)).isoformat(), **kw))

    def hard(self, w):
        return [s for s in w["sessions"] if s["kind"] in plans.HARD_KINDS]

    def test_base_builder_climbs_without_a_taper_or_projection(self):
        cfg = config(goal="base", start_km=25, date=(START + timedelta(weeks=20, days=5)).isoformat())
        weeks = plans.layout(cfg)
        self.assertNotIn("taper", [w[1] for w in weeks])
        self.assertAlmostEqual(max(plans.volumes(cfg, weeks)), 50)  # twice the start
        plan = build(cfg)
        self.assertIsNone(plan["projection"])
        self.assertFalse(plan["projects"])
        self.assertTrue(all(len(self.hard(w)) <= 1 for w in plan["weeks"]))

    def test_speed_block_two_sessions_held_volume_short_taper(self):
        cfg = config(goal="speed", metres=5000, start_km=30, date=(START + timedelta(weeks=8, days=5)).isoformat())
        weeks = plans.layout(cfg)
        self.assertEqual([w[1] for w in weeks].count("taper"), 1)
        self.assertLessEqual(max(plans.volumes(cfg, weeks)), 30 * 1.1 + 1e-9)
        plan = build(cfg)
        self.assertTrue(all(len(self.hard(w)) == 2 for w in plan["weeks"][:-1] if not w["deload"]))
        self.assertIsNotNone(plan["projection"])

    def test_return_to_running_builds_from_run_walk(self):
        plan = self.plan("comeback", 8)
        self.assertFalse(any(self.hard(w) for w in plan["weeks"]))
        first, last = plan["weeks"][0]["sessions"][0], plan["weeks"][-2]["sessions"][0]
        self.assertIn("walk", first["title"].lower())
        self.assertNotIn("walk", last["title"].lower())
        self.assertIsNone(plan["projection"])

    def test_maintenance_holds_volume(self):
        cfg = config(goal="maintain", start_km=30, date=(START + timedelta(weeks=8, days=5)).isoformat())
        kms = [km for km, w in zip(plans.volumes(cfg, plans.layout(cfg)), plans.layout(cfg)) if not w[2]]
        self.assertEqual(set(kms), {30})
        self.assertTrue({"steady"} == {w[1] for w in plans.layout(cfg)})


class Setup(unittest.TestCase):
    def check(self, goal, weeks, **kw):
        import app
        body = {"goal": goal, "name": "x", "metres": 10000, "days": [1, 3, 6], "long_day": 6, "start_km": 25,
                "date": (START + timedelta(weeks=weeks)).isoformat(), **kw}
        return app._plan_from(body, None, {}, None, START)

    def test_new_plan_types_and_their_lengths(self):
        self.assertEqual(self.check("comeback", 8, metres=21098)["metres"], 10000)  # no distance of its own
        self.assertEqual(self.check("base", 20)["name"], "Base builder")
        self.assertIsNone(self.check("maintain", 8, target_s=3000)["target_s"])  # only a race has a target
        self.assertEqual(self.check("speed", 8, metres=5000)["metres"], 5000)
        for goal, weeks, kw in (("speed", 20, {}), ("speed", 8, {"metres": 21098}), ("comeback", 30, {}),
                                ("base", 2, {}), ("nope", 8, {})):
            with self.assertRaises((AssertionError, KeyError)):
                self.check(goal, weeks, **kw)


class LongRuns(unittest.TestCase):
    def longs(self, cfg):
        return [(w["phase"], w["deload"], next((s for s in w["sessions"] if s["kind"] == "long"), None))
                for w in build(cfg, today=START)["weeks"]]

    def test_plain_in_base_lighter_weeks_and_taper(self):
        for phase, deload, s in self.longs(config()):
            if s and (deload or phase in ("base", "taper")):
                self.assertEqual(s["title"], "Long run")

    def test_build_weeks_rotate_through_the_kinds(self):
        titles = {s["title"] for phase, deload, s in self.longs(config(metres=10000)) if s and phase == "build"}
        self.assertTrue({"Long run with surges", "Progressive long run"} <= titles)

    def test_peak_is_race_specific(self):
        half = {s["title"] for phase, deload, s in self.longs(config()) if s and phase == "peak" and not deload}
        self.assertEqual(half, {"Race-pace finish long run"})
        marathon = config(metres=42195, start_km=45, date=(START + timedelta(weeks=16, days=6)).isoformat())
        self.assertIn("Marathon-pace long run", {s["title"] for phase, deload, s in self.longs(marathon) if s and phase == "peak"})

    def test_progressive_long_run_is_judged_on_its_faster_laps(self):
        plan = build(config(metres=10000), today=START)
        s = next(s for w in plan["weeks"] for s in w["sessions"] if s["title"] == "Progressive long run")
        self.assertIsNotNone(plans._work_step(s["steps"]))
        self.assertEqual(s["kind"], "long")


def multi(goal="race", **sports):
    """A plan setup with sports beyond runs (runs as config() has them unless given)."""
    run = sports.pop("run", {"days": [1, 3, 5, 6], "long_day": 6, "start_km": 30})
    return config(goal=goal, sports={**({"run": run} if run else {}), **sports})


def tri(distance="half", weeks=16):
    return config(goal="triathlon", tri=distance, metres=plans.TRI_RUN_M[distance],
                  date=(START + timedelta(weeks=weeks, days=6)).isoformat(),
                  sports={"swim": {"days": [0, 2, 4], "start_km": 5, "pool": 25},
                          "bike": {"days": [1, 3, 5], "long_day": 5, "start_h": 4},
                          "run": {"days": [1, 3, 4, 6], "long_day": 6, "start_km": 25}})


def by_sport(plan, sport):
    return [s for w in plan["weeks"] for s in w["sessions"] if s["sport"] == sport]


class MultiSport(unittest.TestCase):
    def test_old_plan_is_runs_only(self):
        cfg = plans.normalize(config())
        self.assertEqual(set(cfg["sports"]), {"run"})
        plan = build(config())
        self.assertFalse(plan["multi"])
        self.assertTrue(all(s["sport"] == "run" for w in plan["weeks"] for s in w["sessions"]))

    def test_rides_go_by_heart_rate_without_ftp_and_watts_with_it(self):
        cfg = multi(goal="base", run=None, bike={"days": [1, 3, 6], "long_day": 6, "start_h": 4})
        hard = lambda plan: next(s for s in by_sport(plan, "bike") if s["kind"] == "sweet_spot")
        work = lambda s: next(x for x in s["steps"] if x["kind"] == "repeat")["steps"][0]["target"]
        self.assertEqual(work(hard(build(cfg)))["type"], "hr")
        watts = work(hard(plans.build(cfg, [], {}, {**PROFILE, "ftp": 250}, START)))
        self.assertEqual((watts["type"], watts["lo"], watts["hi"]), ("power", 220, 235))

    def test_bike_only_plan_has_no_runs_and_no_projection(self):
        plan = build(multi(goal="base", run=None, bike={"days": [1, 3, 6], "long_day": 6, "start_h": 4}))
        self.assertFalse(by_sport(plan, "run"))
        self.assertFalse(plan["projects"])
        self.assertTrue(plan["weeks"][-1]["hours_planned"] > plan["weeks"][0]["hours_planned"])

    def test_triathlon_tapers_bricks_and_opens(self):
        plan = build(tri(), today=START)
        phases = [w["phase"] for w in plan["weeks"]]
        self.assertEqual(phases.count("taper"), 2)  # as for a half marathon, the 70.3's run leg
        self.assertIsNone(plan["projection"])
        bricks = [s for s in by_sport(plan, "run") if s["kind"] == "brick"]
        self.assertTrue(bricks)
        rides = {s["date"]: s for s in by_sport(plan, "bike")}
        self.assertTrue(all(rides[b["date"]]["kind"] != "easy" for b in bricks))
        self.assertIn("Race-effort long ride", {s["title"] for s in by_sport(plan, "bike")})
        last, end = plan["weeks"][-1]["sessions"], date.fromisoformat(plan["config"]["date"])
        self.assertEqual(last[-1]["sport"], "tri")
        race_week = [s for s in last if s["sport"] in ("bike", "swim") and (end - date.fromisoformat(s["date"])).days <= 5]
        self.assertEqual(sorted(s["sport"] for s in race_week), ["bike", "swim"])
        self.assertEqual({s["kind"] for s in race_week}, {"opener"})

    def test_swims_go_by_distance(self):
        plan = build(tri(), today=START)
        s = by_sport(plan, "swim")[0]
        self.assertTrue(all(x.get("m") for x in plans._flat(s["steps"]) if x["intensity"] != "rest"))
        self.assertAlmostEqual(s["km"], plans.multisport.swim_metres(s["steps"]) / 1000)

    def test_each_sport_matches_its_own_activities(self):
        cfg = multi(goal="fitness", bike={"days": [2], "long_day": None, "start_h": 2})
        ride_day = START + timedelta(days=2)
        ride = {"id": 7, "sport": "bike", "type": "road_biking", "date": ride_day.isoformat(), "km": 30,
                "duration_s": 3600, "speed": 8.3, "avg_hr": 130}
        plan = build(cfg, acts=[ride], today=START + timedelta(days=3))
        s = next(s for s in by_sport(plan, "bike") if s["date"] == ride_day.isoformat())
        self.assertEqual(s["status"], "done")
        self.assertIsNone(s["actual"]["verdict"])
        self.assertEqual(plan["weeks"][0]["km_done"], 0)  # a ride isn't run km
        self.assertEqual(plan["weeks"][0]["hours_done"], 1)

    def test_setup_checks_the_sports_each_goal_needs(self):
        import app
        body = lambda goal, **sports: {"goal": goal, "name": "", "tri": "olympic", "metres": 10000, "sports": sports,
                                       "date": (START + timedelta(weeks=12)).isoformat()}
        run = {"days": [1, 3, 6], "long_day": 6, "start_km": 25}
        bike, swim = {"days": [2, 5], "long_day": 5, "start_h": 4}, {"days": [0, 4], "start_km": 4, "pool": 50}
        cfg = app._plan_from(body("triathlon", run=run, bike=bike, swim=swim), None, {}, None, START)
        self.assertEqual((cfg["name"], cfg["metres"], cfg["days"]), ("Olympic triathlon", 10000, [1, 3, 6]))
        self.assertEqual(app._plan_from(body("base", bike=bike), None, {}, None, START)["days"], [])
        for goal, sports in (("triathlon", {"run": run, "bike": bike}), ("race", {"bike": bike}),
                             ("base", {"strength": {"days": [1]}}),
                             ("base", {"bike": {**bike, "long_day": 1}})):
            with self.assertRaises((AssertionError, KeyError)):
                app._plan_from(body(goal, **sports), None, {}, None, START)


class Dashboard(unittest.TestCase):
    def test_plan_run_replaces_the_suggestion(self):
        import tempfile
        import demo
        import metrics
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / "demo.db"
            demo.seed(path)  # comes with a half marathon plan, 5 weeks in
            data = metrics.build_dashboard(path)
        run = next(w for w in data["workouts"] if w["sport"] == "run")
        self.assertTrue(run["plan"])
        self.assertIn(run["kind"], {"rest", "easy", "long", "threshold", "vo2", "race_pace"})
        self.assertEqual(data["plan"]["week_index"], 5)
        self.assertLessEqual(data["race"]["plan"]["low"], data["race"]["plan"]["high"])


if __name__ == "__main__":
    unittest.main()
