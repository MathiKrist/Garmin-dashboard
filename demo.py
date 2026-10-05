"""Generate believable fake training data so the dashboard can be tried without Garmin."""
import random
from datetime import date, datetime, timedelta

import db

# weekday -> (kind, km range, avg HR range, pace s/km range)
PLAN = {
    0: None,
    1: ("intervals", (8, 11), (161, 170), (250, 280)),
    2: ("easy", (6, 9), (138, 152), (330, 360)),
    3: ("tempo", (9, 12), (158, 166), (270, 295)),
    4: None,
    5: ("easy", (6, 10), (140, 153), (325, 355)),
    6: ("long", (16, 24), (145, 156), (320, 350)),
}


def seed(db_path, days=180):
    conn = db.connect(db_path)
    if db.get_meta(conn, "demo_date") == date.today().isoformat():
        conn.close()
        return
    conn.executescript("DELETE FROM activities; DELETE FROM daily; DELETE FROM meta;")
    rng = random.Random(7)
    today = date.today()
    fatigue = 0.0
    for i in range(days, -1, -1):
        d = today - timedelta(days=i)
        build = 0.75 + 0.35 * (1 - i / days)          # volume grows over the block
        if (d.isocalendar()[1] % 4) == 0:              # every 4th week is a recovery week
            build *= 0.65
        plan = PLAN[d.weekday()]
        load = 0.0
        if plan and rng.random() > 0.08 and i > 0:
            kind, km_r, hr_r, pace_r = plan
            km = rng.uniform(*km_r) * build
            pace = rng.uniform(*pace_r)
            hr = rng.uniform(*hr_r)
            dur = km * pace
            load = dur / 60 * (hr - 120) / 30 * (1.6 if kind in ("intervals", "tempo") else 1.0)
            start = datetime.combine(d, datetime.min.time()) + timedelta(hours=rng.choice([6, 7, 17, 18]), minutes=rng.randint(0, 59))
            db.upsert_activity(conn, {
                "id": int(d.strftime("%Y%m%d")) * 10 + 1, "start_local": start.strftime("%Y-%m-%d %H:%M:%S"),
                "date": d.isoformat(), "type": "running",
                "name": {"intervals": "Odense intervals", "tempo": "Tempo run", "easy": "Easy run", "long": "Long run"}[kind],
                "distance_m": km * 1000, "duration_s": dur, "avg_hr": round(hr), "max_hr": round(hr + rng.uniform(8, 18)),
                "avg_speed": 1000 / pace, "elev_gain": rng.uniform(20, 120), "training_load": round(load),
                "aerobic_te": round(rng.uniform(2.5, 4.2), 1), "anaerobic_te": round(rng.uniform(0, 2.5), 1), "raw": None,
            })
        if d.weekday() == 3 and i > 0:
            db.upsert_activity(conn, {
                "id": int(d.strftime("%Y%m%d")) * 10 + 2,
                "start_local": f"{d.isoformat()} 19:30:00", "date": d.isoformat(), "type": "strength_training",
                "name": "Strength", "distance_m": 0, "duration_s": 2400, "avg_hr": 112, "max_hr": 140,
                "avg_speed": None, "elev_gain": 0, "training_load": 25, "aerobic_te": 1.2, "anaerobic_te": 0.8, "raw": None,
            })
            load += 25
        fatigue = fatigue * 0.8 + load * 0.2
        hrv = 64 - fatigue * 0.12 + rng.gauss(0, 5)
        db.upsert_daily(conn, {
            "date": d.isoformat(), "resting_hr": round(48 + fatigue * 0.04 + rng.gauss(0, 1.5)),
            "hrv_last_night": round(hrv), "hrv_weekly_avg": round(64 - fatigue * 0.1), "hrv_low": 54, "hrv_high": 72,
            "hrv_status": "BALANCED" if hrv >= 54 else "UNBALANCED",
            "sleep_s": rng.uniform(6.2, 8.6) * 3600, "sleep_score": rng.randint(62, 92),
            "bb_high": rng.randint(70, 98), "bb_low": rng.randint(10, 35), "stress_avg": rng.randint(20, 40),
            "steps": rng.randint(5000, 15000),
            "readiness": max(5, min(100, round(85 - fatigue * 0.5 + rng.gauss(0, 8)))),
        })
    now = datetime.now().isoformat(timespec="seconds")
    db.set_meta(conn, "last_sync_at", now)
    db.set_meta(conn, "demo_date", today.isoformat())
    conn.commit()
    conn.close()
