"""Today's workout: which session, its targets, and Garmin's format. Run from the project folder: python -m unittest discover tests"""
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import workouts  # noqa: E402

TODAY = date(2026, 10, 11)
PROFILE = {"lt_speed": 1000 / 330, "zones": [99, 118, 138, 158, 177, 198]}  # threshold 5:30 /km


def run(days_ago, label="AEROBIC_BASE", minutes=50):
    return {"date": (TODAY - timedelta(days=days_ago)).isoformat(), "sport": "run", "te_label": label,
            "focus": None, "duration_s": minutes * 60}


def recommend(acts=(), readiness=80, status="PRODUCTIVE", focus="BALANCED", race=None, sent=()):
    return workouts.recommend(list(acts), TODAY, readiness=readiness, status=status, focus=focus, focus_title="Focus",
                              race=race, profile=PROFILE, pred_5k=1500, sent=list(sent))


class Session(unittest.TestCase):
    def test_low_readiness_is_easy(self):
        self.assertEqual(recommend(readiness=40)[0]["kind"], "easy")

    def test_very_low_readiness_or_overreaching_is_recovery(self):
        self.assertEqual(recommend(readiness=20)[0]["kind"], "recovery")
        self.assertEqual(recommend(status="OVERREACHING")[0]["kind"], "recovery")

    def test_hard_yesterday_is_easy(self):
        self.assertEqual(recommend([run(1, "VO2MAX")])[0]["kind"], "easy")

    def test_load_focus_picks_the_session(self):
        self.assertEqual(recommend(focus="AEROBIC_HIGH_SHORTAGE")[0]["kind"], "threshold")
        self.assertEqual(recommend(focus="ANAEROBIC_SHORTAGE")[0]["kind"], "anaerobic")
        self.assertEqual(recommend(focus="AEROBIC_LOW_SHORTAGE")[0]["kind"], "long")

    def test_threshold_this_week_makes_it_vo2_max(self):
        self.assertEqual(recommend([run(4, "LACTATE_THRESHOLD")], focus="AEROBIC_HIGH_SHORTAGE")[0]["kind"], "vo2")

    def test_race_in_two_days_is_a_shakeout(self):
        self.assertEqual(recommend(race={"days_to_go": 2})[0]["kind"], "shakeout")

    def test_main_sport_first(self):
        acts = [run(3), {**run(5), "sport": "bike"}, {**run(6), "sport": "bike"}]
        self.assertEqual([w["sport"] for w in recommend(acts)], ["bike", "run"])

    def test_sent_today(self):
        title = recommend()[0]["title"]
        self.assertTrue(recommend(sent=[{"date": TODAY.isoformat(), "sport": "run", "title": title}])[0]["sent"])
        self.assertFalse(recommend(sent=[{"date": "2026-10-10", "sport": "run", "title": title}])[0]["sent"])


class Targets(unittest.TestCase):
    def test_paces_from_threshold(self):
        t = workouts.Targets(PROFILE, None)
        self.assertEqual(t.pace("threshold"), {"type": "pace", "slow": round(330 / 0.97), "fast": round(330 / 1.01)})

    def test_threshold_from_5k_without_garmin_threshold(self):
        self.assertAlmostEqual(workouts.Targets({}, 1500).lt, 5000 / 1500 * workouts.LT_FROM_5K)

    def test_heart_rate_zones(self):
        t = workouts.Targets(PROFILE, None)
        self.assertEqual(t.hr(2), {"type": "hr", "zone": 2, "lo": 118, "hi": 137})
        self.assertEqual(t.hr(5), {"type": "hr", "zone": 5, "lo": 177, "hi": 198})


class GarminFormat(unittest.TestCase):
    def test_steps_and_repeats(self):
        w = recommend(focus="AEROBIC_HIGH_SHORTAGE")[0]
        g = workouts.to_garmin(w, TODAY)
        steps = g["workoutSegments"][0]["workoutSteps"]
        self.assertEqual([s["type"] for s in steps], ["ExecutableStepDTO", "RepeatGroupDTO", "ExecutableStepDTO"])
        # Steps are numbered through the repeat: 1, the group 2, its steps 3 and 4, then 5
        self.assertEqual([steps[0]["stepOrder"], steps[1]["stepOrder"], *[s["stepOrder"] for s in steps[1]["workoutSteps"]],
                          steps[2]["stepOrder"]], [1, 2, 3, 4, 5])
        hard = steps[1]["workoutSteps"][0]
        self.assertEqual(hard["targetType"]["workoutTargetTypeKey"], "pace.zone")
        self.assertLess(hard["targetValueOne"], hard["targetValueTwo"])  # m/s, the slow end first
        self.assertEqual(g["estimatedDurationInSecs"], w["total_s"])


if __name__ == "__main__":
    unittest.main()
