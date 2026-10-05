import json
import sqlite3
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    id            INTEGER PRIMARY KEY,
    start_local   TEXT,
    date          TEXT,
    type          TEXT,
    name          TEXT,
    distance_m    REAL,
    duration_s    REAL,
    avg_hr        REAL,
    max_hr        REAL,
    avg_speed     REAL,
    elev_gain     REAL,
    training_load REAL,
    aerobic_te    REAL,
    anaerobic_te  REAL,
    raw           TEXT
);
CREATE INDEX IF NOT EXISTS idx_activities_date ON activities(date);

CREATE TABLE IF NOT EXISTS daily (
    date           TEXT PRIMARY KEY,
    resting_hr     REAL,
    hrv_last_night REAL,
    hrv_weekly_avg REAL,
    hrv_low        REAL,
    hrv_high       REAL,
    hrv_status     TEXT,
    sleep_s        REAL,
    sleep_score    REAL,
    bb_high        REAL,
    bb_low         REAL,
    stress_avg     REAL,
    steps          REAL,
    readiness      REAL
);

CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
"""

ACTIVITY_COLS = [
    "id", "start_local", "date", "type", "name", "distance_m", "duration_s",
    "avg_hr", "max_hr", "avg_speed", "elev_gain", "training_load",
    "aerobic_te", "anaerobic_te", "raw",
]
DAILY_COLS = [
    "date", "resting_hr", "hrv_last_night", "hrv_weekly_avg", "hrv_low",
    "hrv_high", "hrv_status", "sleep_s", "sleep_score", "bb_high", "bb_low",
    "stress_avg", "steps", "readiness",
]


def connect(db_path):
    Path(db_path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    return conn


def upsert_activity(conn, row):
    row = dict(row)
    if isinstance(row.get("raw"), (dict, list)):
        row["raw"] = json.dumps(row["raw"])
    values = [row.get(c) for c in ACTIVITY_COLS]
    conn.execute(
        f"INSERT OR REPLACE INTO activities ({','.join(ACTIVITY_COLS)}) "
        f"VALUES ({','.join('?' * len(ACTIVITY_COLS))})",
        values,
    )


def upsert_daily(conn, row):
    """Merge non-empty fields into the day's row, keeping what's already there."""
    existing = conn.execute("SELECT * FROM daily WHERE date = ?", (row["date"],)).fetchone()
    merged = dict(existing) if existing else {}
    merged.update({k: v for k, v in row.items() if v is not None})
    values = [merged.get(c) for c in DAILY_COLS]
    conn.execute(
        f"INSERT OR REPLACE INTO daily ({','.join(DAILY_COLS)}) "
        f"VALUES ({','.join('?' * len(DAILY_COLS))})",
        values,
    )


def set_meta(conn, key, value):
    conn.execute("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", (key, value))


def get_meta(conn, key, default=None):
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default
