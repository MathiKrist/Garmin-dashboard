"""Serve the dashboard on your local network.

    python backend/app.py          # real Garmin data (run backend/login.py first)
    python backend/app.py --demo   # fake data, to try the dashboard without Garmin
"""
import argparse
import base64
import json
import logging
import secrets
import socket
import threading
import time
from contextlib import asynccontextmanager
from datetime import date

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import config
import db
import metrics
import sync

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
log = logging.getLogger("app")

parser = argparse.ArgumentParser()
parser.add_argument("--demo", action="store_true", help="use generated demo data instead of Garmin")
args, _ = parser.parse_known_args()

DEMO = args.demo
DB_PATH = config.BASE_DIR / "data" / "demo.db" if DEMO else config.DB_PATH
STATIC = config.BASE_DIR / "frontend"


def _sync_loop():
    while True:
        log.info("Background sync: %s", sync.run_sync(DB_PATH))
        time.sleep(max(5, config.SYNC_INTERVAL_MINUTES) * 60)


@asynccontextmanager
async def lifespan(_app):
    if DEMO:
        import demo
        demo.seed(DB_PATH)
    else:
        threading.Thread(target=_sync_loop, daemon=True).start()
    yield


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None)


@app.middleware("http")
async def password_gate(request: Request, call_next):
    if config.DASHBOARD_PASSWORD:
        ok = False
        header = request.headers.get("authorization", "")
        if header.startswith("Basic "):
            try:
                _, _, pw = base64.b64decode(header[6:]).decode().partition(":")
                ok = secrets.compare_digest(pw, config.DASHBOARD_PASSWORD)
            except Exception:
                ok = False
        if not ok:
            return Response(status_code=401, headers={"WWW-Authenticate": 'Basic realm="Training"'})
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"  # revalidate, so code changes show up without a hard refresh
    return response


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/dashboard")
def dashboard():
    data = metrics.build_dashboard(DB_PATH)
    data["demo"] = DEMO
    data["syncing"] = sync.is_running()
    return data


@app.get("/api/activity/{activity_id}")
def activity(activity_id: int):
    """One activity with all its stats, route and laps, for the popup."""
    if DEMO:
        import demo
        demo.fill_details(DB_PATH, activity_id)
        error = None
    else:
        error = sync.fetch_details(DB_PATH, activity_id)
    data = metrics.build_activity(DB_PATH, activity_id)
    if data is None:
        return JSONResponse({"error": "No such activity"}, status_code=404)
    data["details_error"] = error
    return data


@app.post("/api/race")
async def set_race(request: Request):
    """Save the race goal: {name, date (YYYY-MM-DD), metres, target_s}."""
    body = await request.json()
    try:
        goal = {
            "name": str(body.get("name") or "").strip()[:80] or "Race",
            "date": date.fromisoformat(body["date"]).isoformat(),
            "metres": float(body["metres"]),
            "target_s": int(body["target_s"]),
        }
        assert 100 <= goal["metres"] <= 1_000_000 and 0 < goal["target_s"] < 7 * 86400
    except (KeyError, TypeError, ValueError, AssertionError):
        return JSONResponse({"error": "Give a name, a date, a distance and a target time."}, status_code=400)
    conn = db.connect(DB_PATH)
    try:
        db.set_meta(conn, "race_goal", json.dumps(goal))
        conn.commit()
    finally:
        conn.close()
    return {"status": "saved"}


@app.delete("/api/race")
def remove_race():
    conn = db.connect(DB_PATH)
    try:
        conn.execute("DELETE FROM meta WHERE key = 'race_goal'")
        conn.commit()
    finally:
        conn.close()
    return {"status": "removed"}


@app.post("/api/sync")
def sync_now():
    if DEMO:
        return JSONResponse({"status": "Demo mode doesn't sync with Garmin."})
    if sync.is_running():
        return {"status": "already running"}
    threading.Thread(target=sync.run_sync, args=(DB_PATH,), daemon=True).start()
    return {"status": "started"}


app.mount("/static", StaticFiles(directory=STATIC), name="static")


def lan_ip():
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(("10.255.255.255", 1))  # no packet is sent; just picks the LAN interface
        return s.getsockname()[0]
    except OSError:
        return "127.0.0.1"
    finally:
        s.close()


if __name__ == "__main__":
    print(f"\n  Dashboard on this machine:  http://localhost:{config.PORT}")
    if config.HOST == "0.0.0.0":
        print(f"  From other devices on wifi: http://{lan_ip()}:{config.PORT}\n")
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")
