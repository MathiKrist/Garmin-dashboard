import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent
load_dotenv(BASE_DIR / ".env")


def _int(name, default):
    try:
        return int(os.getenv(name, default))
    except ValueError:
        return default


AEROBIC_THRESHOLD = _int("AEROBIC_THRESHOLD", 158)
MAX_HR = _int("MAX_HR", 195)
ACTIVITY_BACKFILL_DAYS = _int("ACTIVITY_BACKFILL_DAYS", 180)
DAILY_BACKFILL_DAYS = _int("DAILY_BACKFILL_DAYS", 60)
SYNC_INTERVAL_MINUTES = _int("SYNC_INTERVAL_MINUTES", 60)
HOST = os.getenv("HOST", "0.0.0.0")
PORT = _int("PORT", 8000)
DASHBOARD_PASSWORD = os.getenv("DASHBOARD_PASSWORD", "")
TOKEN_DIR = str(Path(os.getenv("TOKEN_DIR", "~/.garminconnect")).expanduser())
DB_PATH = BASE_DIR / os.getenv("DB_PATH", "data/athlete.db")
