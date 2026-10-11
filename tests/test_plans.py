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
        work = s["steps"][1]["steps"][0]
        mid = (work["target"]["slow"] + work["target"]["fast"]) / 2
        laps = {1: [{"speed": 1000 / mid, "duration_s": work["s"], "avg_hr": 165}] * 3}
        plan = build(acts=history() + [run(1, day, km=10, pace=mid)], laps=laps)
        self.assertEqual(plan["factor"], 1.0)
        self.assertEqual(self.threshold(plan, 0)["actual"]["verdict"], "on plan")

    def test_faster_intervals_speed_up_capped_per_week(self):
        base = build(acts=history())
        s = self.threshold(base, 0)
        work = s["steps"][1]["steps"][0]
        laps = {1: [{"speed": 1000 / (work["target"]["fast"] * 0.9), "duration_s": work["s"], "avg_hr": 165}] * 3}
        plan = build(acts=history() + [run(1, date.fromisoformat(s["date"]), km=10)], laps=laps)
        self.assertAlmostEqual(plan["factor"], 1 + plans.WEEK_CAP)
        self.assertEqual(self.threshold(plan, 0)["actual"]["verdict"], "better")
        # Next week's threshold paces are faster, and so is the projection
        self.assertLess(self.threshold(plan, 1)["steps"][1]["steps"][0]["target"]["fast"],
                        self.threshold(base, 1)["steps"][1]["steps"][0]["target"]["fast"])
        self.assertLess(plan["projection"]["s"], base["projection"]["s"])
        # The run that moved it, and the time before
        change = plan["projection"]["change"]
        self.assertEqual((change["date"], change["from_s"]), (s["date"], base["projection"]["s"]))

    def test_faster_at_too_high_heart_rate_counts_as_on_plan(self):
        base = build(acts=history())
        s = self.threshold(base, 0)
        work = s["steps"][1]["steps"][0]
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
        # Week 1: Tue easy, Thu threshold, Sat easy, Sun long. Thursday missed, today Friday.
        today = START + timedelta(weeks=1, days=4)
        plan = build(today=today)
        week = sessions(plan, 1)
        thursday = (START + timedelta(weeks=1, days=3)).isoformat()
        saturday = (START + timedelta(weeks=1, days=5)).isoformat()
        self.assertEqual(next(s for s in week if s["date"] == thursday)["status"], "moved")
        moved = next(s for s in week if s["date"] == saturday)
        self.assertEqual((moved["kind"], moved["moved_from"]), ("threshold", thursday))

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
        self.assertEqual(plans.todays(build(today=tue), tue)["kind"], "easy")
        wed = START + timedelta(days=2)
        rest = plans.todays(build(today=wed), wed)
        self.assertEqual(rest["kind"], "rest")
        self.assertEqual(rest["next"]["date"], (START + timedelta(days=3)).isoformat())

    def test_send_key_changes_with_the_paces(self):
        a = build(acts=history())
        s = next(s for s in sessions(a, 0) if s["kind"] == "threshold")
        work = s["steps"][1]["steps"][0]
        laps = {1: [{"speed": 1000 / (work["target"]["fast"] * 0.9), "duration_s": work["s"], "avg_hr": 165}] * 3}
        b = build(acts=history() + [run(1, date.fromisoformat(s["date"]), km=10)], laps=laps)
        self.assertNotEqual(a["send"]["key"], b["send"]["key"])


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
