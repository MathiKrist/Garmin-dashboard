"""Sessions changed in the chat: checking them, their steps and paces, the plan with them, and the chat's tools.
Run from the project folder: python -m unittest discover tests"""
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import changes  # noqa: E402
import coach  # noqa: E402
import db  # noqa: E402
import plans  # noqa: E402
import workouts  # noqa: E402

START = date(2026, 9, 7)  # a Monday
TODAY = START + timedelta(days=8)  # Tuesday of the plan's second week
PROFILE = {"lt_speed": 1000 / 300, "zones": [99, 118, 138, 158, 177, 198]}  # threshold 5:00 /km
T = workouts.Targets(PROFILE, None)
CFG = {"goal": "race", "name": "Half", "metres": 21098, "date": (START + timedelta(weeks=12, days=6)).isoformat(),
       "target_s": None, "start": START.isoformat(), "days": [1, 3, 5, 6], "long_day": 6, "start_km": 30,
       "fitness0": 1000 / 300}


def day(n):
    return (TODAY + timedelta(days=n)).isoformat()


def build(stored=()):
    return plans.build(CFG, [], {}, PROFILE, TODAY, (), list(stored))


def plan_day(plan, iso):
    return next((s for w in plan["weeks"] for s in w["sessions"] if s["date"] == iso), None)


class Checking(unittest.TestCase):
    def test_past_and_far_days_are_refused(self):
        with self.assertRaises(ValueError):
            changes.make(day(-1), "run", kind="easy", minutes=30, today=TODAY)
        with self.assertRaises(ValueError):
            changes.make(day(200), "run", kind="easy", minutes=30, today=TODAY)

    def test_needs_minutes_or_steps(self):
        with self.assertRaises(ValueError):
            changes.make(day(0), "run", kind="easy", today=TODAY)
        with self.assertRaises(ValueError):
            changes.make(day(0), "run", kind="custom", minutes=30, today=TODAY)

    def test_bad_steps_are_refused(self):
        for steps in ([{"type": "sprint", "minutes": 1}], [{"type": "interval", "minutes": 1, "target": "fast"}],
                      [{"type": "repeat", "times": 3, "steps": [{"type": "repeat", "times": 2, "steps": []}]}]):
            with self.assertRaises(ValueError):
                changes.make(day(0), "run", kind="custom", steps=steps, today=TODAY)


class Sessions(unittest.TestCase):
    def test_standard_session_gets_the_athletes_paces(self):
        s = changes.session(changes.make(day(0), "run", kind="easy", minutes=30, reason="Short on time", today=TODAY), T)
        self.assertEqual((s["title"], s["total_s"]), ("Easy run", 1800))
        self.assertEqual(s["steps"][0]["target"], T.pace("easy"))
        self.assertTrue(s["changed"])
        self.assertEqual(s["reason"], "Short on time")

    def test_custom_steps_resolve_targets_and_intensity(self):
        steps = [{"type": "warmup", "minutes": 10, "target": "easy"},
                 {"type": "repeat", "times": 5, "steps": [{"type": "interval", "label": "Hard", "minutes": 3, "target": "vo2"},
                                                         {"type": "recovery", "label": "Jog", "minutes": 2, "target": "none"}]},
                 {"type": "cooldown", "minutes": 5}]
        s = changes.session(changes.make(day(1), "run", kind="vo2", steps=steps, today=TODAY), T)
        work, rest = s["steps"][1]["steps"]
        self.assertEqual(s["total_s"], (10 + 5 * 5 + 5) * 60)
        self.assertEqual((work["intensity"], work["target"]), ("high", T.pace("vo2")))
        self.assertEqual((rest["intensity"], rest["target"]), ("rest", None))
        self.assertEqual(s["title"], "VO2 max intervals")

    def test_bike_targets_are_heart_rate_zones(self):
        s = changes.session(changes.make(day(0), "bike", kind="threshold", minutes=60, today=TODAY), T)
        self.assertEqual(s["steps"][1]["steps"][0]["target"]["type"], "hr")
        self.assertIsNone(s["km"])

    def test_rest_day_has_no_session(self):
        self.assertIsNone(changes.session(changes.rest(day(0), "run", "Tired", TODAY), T))
        w = changes.workout(changes.rest(day(0), "run", "Tired", TODAY), T, [])
        self.assertEqual((w["kind"], w["steps"]), ("rest", []))

    def test_a_change_replaces_the_one_on_its_day(self):
        a = changes.make(day(0), "run", kind="easy", minutes=30, today=TODAY)
        b = changes.rest(day(0), "run", "", TODAY)
        self.assertEqual(changes.put([a], b), [b])
        self.assertEqual(len(changes.put([a], changes.rest(day(0), "bike", "", TODAY))), 2)


class Plan(unittest.TestCase):
    def test_changes_replace_remove_and_add_plan_days(self):
        plain = build()
        tue = plan_day(plain, day(0))
        self.assertIsNotNone(tue)
        self.assertIsNone(plan_day(plain, day(1)))  # Wednesday is not a run day
        stored = [changes.make(day(0), "run", kind="easy", minutes=20, today=TODAY),
                  changes.make(day(1), "run", kind="easy", minutes=25, today=TODAY),
                  changes.rest(day(2), "run", "", TODAY)]
        plan = build(stored)
        self.assertEqual((plan_day(plan, day(0))["total_s"], plan_day(plan, day(0))["status"]), (1200, "today"))
        self.assertEqual(plan_day(plan, day(1))["total_s"], 1500)
        self.assertIsNone(plan_day(plan, day(2)))
        self.assertEqual(plans.todays(plan, TODAY)[0]["total_s"], 1200)
        self.assertIn("Changed in chat", plans.todays(plan, TODAY)[0]["why"])

    def test_changes_outside_the_plan_are_left_out(self):
        late = (date.fromisoformat(CFG["date"]) + timedelta(days=3)).isoformat()
        plan = build([{**changes.make(day(1), "run", kind="easy", minutes=25, today=TODAY), "date": late}])
        self.assertIsNone(plan_day(plan, late))

    def test_a_missed_session_doesnt_move_onto_a_changed_day(self):
        # Friday of week 2 with no runs: the week's hard session was missed and moves to Saturday's easy run, unless
        # Saturday was changed in the chat
        fri = START + timedelta(days=11)
        sat = (fri + timedelta(days=1)).isoformat()
        moved = plans.build(CFG, [], {}, PROFILE, fri)
        self.assertIn("moved_from", plan_day(moved, sat))
        kept = plans.build(CFG, [], {}, PROFILE, fri, (), [changes.make(sat, "run", kind="easy", minutes=40, today=fri)])
        self.assertNotIn("moved_from", plan_day(kept, sat))
        self.assertEqual(plan_day(kept, sat)["total_s"], 2400)


class Tools(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.conn = db.connect(Path(self.tmp.name) / "t.db")
        plan = build()
        self.d = {"generated": TODAY.isoformat(), "plan": plan, "workouts": plans.todays(plan, TODAY)}

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def stored(self):
        return changes.load(self.conn)

    def test_move_leaves_a_rest_day_and_copies_the_session(self):
        thu = day(2)
        session = plan_day(self.d["plan"], thu)
        result, line = coach.run_tool("move_workout", {"sport": "run", "from_date": thu, "to_date": day(3), "reason": "Busy"},
                                      self.d, self.conn, TODAY)
        rest, moved = sorted(self.stored(), key=lambda c: c["date"])
        self.assertTrue(rest["rest"])
        self.assertEqual((moved["date"], moved["title"], moved["fixed_steps"]), (day(3), session["title"], session["steps"]))
        self.assertIn(session["title"], line)

    def test_move_from_an_empty_day_fails(self):
        with self.assertRaises(ValueError):
            coach.run_tool("move_workout", {"sport": "run", "from_date": day(1), "to_date": day(3), "reason": ""},
                           self.d, self.conn, TODAY)

    def test_set_then_undo(self):
        coach.run_tool("set_workout", {"date": day(0), "sport": "run", "kind": "easy", "minutes": 30, "reason": "Short on time"},
                       self.d, self.conn, TODAY)
        self.assertEqual(len(self.stored()), 1)
        coach.run_tool("undo_change", {"date": day(0), "sport": "run"}, self.d, self.conn, TODAY)
        self.assertEqual(self.stored(), [])
        with self.assertRaises(ValueError):
            coach.run_tool("undo_change", {"date": day(0), "sport": "run"}, self.d, self.conn, TODAY)

    def test_replacing_a_session_says_so(self):
        result, _ = coach.run_tool("set_rest_day", {"date": day(0), "sport": "run", "reason": "Tired"}, self.d, self.conn, TODAY)
        self.assertIn("Replaced", result)


class State(unittest.TestCase):
    def test_steps_text(self):
        steps = changes.session(changes.make(day(0), "run", kind="threshold", minutes=50, today=TODAY), T)["steps"]
        text = coach.steps_text(steps)
        self.assertIn("15 min Warm-up", text)
        self.assertRegex(text, r"\d x \[8 min Threshold @ \d:\d\d-\d:\d\d/km, 2 min Easy jog\]")


if __name__ == "__main__":
    unittest.main()
