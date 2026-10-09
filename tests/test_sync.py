"""The sync, against a stand-in for Garmin on a throwaway database. Run: python -m unittest discover tests"""
import sqlite3
import sys
import tempfile
import unittest
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))
import db  # noqa: E402
import sync  # noqa: E402

TODAY = date.today()


def activity(i, days_ago, name="Run"):
    d = TODAY - timedelta(days=days_ago)
    return {"activityId": i, "startTimeLocal": f"{d.isoformat()} 07:00:00", "activityType": {"typeKey": "running"},
            "activityName": name, "distance": 5000, "movingDuration": 1500, "averageHR": 150, "hasPolyline": True}


class FakeGarmin:
    """Answers the calls the sync makes, with a few activities and one day of numbers."""

    def __init__(self, activities, rate_limit_details=False):
        self.activities, self.rate_limit_details, self.fetched_from = activities, rate_limit_details, []

    def get_activities_by_date(self, start, end):
        self.fetched_from.append(start)
        return [a for a in self.activities if start <= a["startTimeLocal"][:10] <= end]

    def get_activities(self, offset, limit):
        return self.activities[offset:offset + limit]

    def get_race_predictions(self, start, end, kind):
        return [{"calendarDate": TODAY.isoformat(), "time5K": 1300}]

    def get_max_metrics_range(self, start, end):
        return [{"generic": {"calendarDate": TODAY.isoformat(), "vo2MaxPreciseValue": 51.5}}]

    def get_stats(self, d):
        return {"restingHeartRate": 50}

    def get_activity_details(self, *args):
        if self.rate_limit_details:
            raise Exception("429 Too many requests")
        return {"geoPolylineDTO": {"polyline": [{"lat": 55.0, "lon": 10.0}, {"lat": 55.001, "lon": 10.001}]}}

    def __getattr__(self, name):  # HRV, sleep, readiness, training status, splits: nothing
        return lambda *args: {}


class Sync(unittest.TestCase):
    def setUp(self):
        self.path = Path(tempfile.mkdtemp()) / "test.db"
        self._sleep, self._client = sync.time.sleep, sync._client
        sync.time.sleep = lambda s: None  # no rate-limit pauses in tests

    def tearDown(self):
        sync.time.sleep, sync._client = self._sleep, self._client

    def run_sync(self, garmin):
        sync._client = lambda: garmin
        return sync.run_sync(self.path)

    def query(self, sql, *args):
        conn = sqlite3.connect(self.path)
        try:
            return conn.execute(sql, args).fetchall()
        finally:
            conn.close()

    def set_meta(self, **values):
        conn = db.connect(self.path)
        for key, value in values.items():
            db.set_meta(conn, key, value)
        conn.commit()
        conn.close()

    def test_first_sync(self):
        self.assertEqual(self.run_sync(FakeGarmin([activity(1, 1), activity(2, 5)])), "ok")
        self.assertEqual(self.query("SELECT id FROM activities ORDER BY id"), [(1,), (2,)])
        self.assertEqual(self.query("SELECT pred_5k FROM daily WHERE date = ?", TODAY.isoformat()), [(1300.0,)])
        self.assertEqual(self.query("SELECT count(*) FROM tracks"), [(2,)])

    def test_daily_recheck_picks_up_edits_and_deletions(self):
        self.run_sync(FakeGarmin([activity(1, 1), activity(2, 5), activity(3, 20), activity(4, 40)]))
        yesterday = (TODAY - timedelta(days=1)).isoformat()
        self.set_meta(last_sync_date=yesterday, activities_rechecked=yesterday)
        # On Garmin since: 2 deleted, 3 renamed; 4 is older than the recheck window
        garmin = FakeGarmin([activity(1, 1), activity(3, 20, "Renamed"), activity(4, 40)])
        self.assertEqual(self.run_sync(garmin), "ok")
        self.assertEqual(garmin.fetched_from[0], (TODAY - timedelta(days=sync.RECHECK_DAYS)).isoformat())
        self.assertEqual(self.query("SELECT id FROM activities ORDER BY id"), [(1,), (3,), (4,)])
        self.assertEqual(self.query("SELECT name FROM activities WHERE id = 3"), [("Renamed",)])
        self.assertEqual(self.query("SELECT count(*) FROM tracks WHERE activity_id = 2"), [(0,)])

    def test_recheck_once_a_day(self):
        self.run_sync(FakeGarmin([activity(1, 1)]))
        garmin = FakeGarmin([activity(1, 1)])
        self.run_sync(garmin)
        self.assertEqual(garmin.fetched_from[0], (TODAY - timedelta(days=3)).isoformat())

    def test_empty_answer_deletes_nothing(self):
        self.run_sync(FakeGarmin([activity(1, 1)]))
        self.set_meta(activities_rechecked="2000-01-01")
        self.run_sync(FakeGarmin([]))
        self.assertEqual(self.query("SELECT id FROM activities"), [(1,)])

    def test_rate_limit_keeps_the_daily_numbers(self):
        self.run_sync(FakeGarmin([activity(1, 1)]))
        self.set_meta(last_sync_date=(TODAY - timedelta(days=5)).isoformat())
        result = self.run_sync(FakeGarmin([activity(1, 1), activity(2, 0)], rate_limit_details=True))
        self.assertTrue(result.startswith("error: 429"))
        # The routes come after the daily numbers: those are saved, and the next sync starts from today
        self.assertEqual(self.query("SELECT value FROM meta WHERE key = 'last_sync_date'"), [(TODAY.isoformat(),)])
        self.assertEqual(self.query("SELECT id FROM activities ORDER BY id"), [(1,), (2,)])


if __name__ == "__main__":
    unittest.main()
