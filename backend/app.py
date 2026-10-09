"""Serve the dashboard on your local network.

    python backend/app.py          # real Garmin data (run backend/login.py first)
    python backend/app.py --demo   # fake data, to try the dashboard without Garmin
"""
import argparse
import asyncio
import hashlib
import hmac
import json
import logging
import secrets
import socket
import threading
import time
from contextlib import asynccontextmanager
from datetime import date
from urllib.parse import parse_qs

import uvicorn
from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, RedirectResponse
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


# ---- Login: with DASHBOARD_PASSWORD set, every page asks for it first (and for DASHBOARD_USERNAME, when that's set too)

SESSION_COOKIE = "training_session"
SESSION_DAYS = 365
OPEN_PATHS = {"/login", "/static/styles.css"}  # reachable before logging in


def _session_token():
    """The cookie value a logged-in browser holds. It's derived from the login details, so changing them logs
    every device out."""
    key = config.DASHBOARD_PASSWORD.encode()
    return hmac.new(key, f"training-session:{config.DASHBOARD_USERNAME}".encode(), hashlib.sha256).hexdigest()


def _logged_in(request):
    return secrets.compare_digest(request.cookies.get(SESSION_COOKIE, ""), _session_token())


@app.middleware("http")
async def login_gate(request: Request, call_next):
    if config.DASHBOARD_PASSWORD and request.url.path not in OPEN_PATHS and not _logged_in(request):
        if request.method == "GET" and not request.url.path.startswith(("/api/", "/static/")):
            return RedirectResponse("/login", status_code=303)
        return JSONResponse({"error": "Not logged in"}, status_code=401)
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-cache"  # revalidate, so code changes show up without a hard refresh
    return response


def login_page(error=""):
    """The login page, with the username field only when a username is set, and the error from the last try."""
    html = (STATIC / "login.html").read_text(encoding="utf-8")
    if config.DASHBOARD_USERNAME:
        html = html.replace('<label id="userField" hidden>', '<label id="userField">').replace(
            'id="username" autocomplete="username"', 'id="username" name="username" autocomplete="username" required')
    if error:
        html = html.replace('<p class="form-error" id="loginError" hidden></p>', f'<p class="form-error" id="loginError" role="alert">{error}</p>')
    return html


@app.get("/login")
def login_form(request: Request):
    if not config.DASHBOARD_PASSWORD or _logged_in(request):
        return RedirectResponse("/", status_code=303)
    return HTMLResponse(login_page())


@app.post("/login")
async def login(request: Request):
    form = parse_qs((await request.body()).decode())
    password = (form.get("password") or [""])[0]
    username = (form.get("username") or [""])[0].strip()
    ok = secrets.compare_digest(password.encode(), config.DASHBOARD_PASSWORD.encode())
    if config.DASHBOARD_USERNAME:
        ok = secrets.compare_digest(username.encode(), config.DASHBOARD_USERNAME.encode()) and ok
    if not ok:
        await asyncio.sleep(1)  # slows down guessing
        what = "username or password" if config.DASHBOARD_USERNAME else "password"
        return HTMLResponse(login_page(f"Wrong {what}. Try again."), status_code=401)
    response = RedirectResponse("/", status_code=303)
    response.set_cookie(SESSION_COOKIE, _session_token(), max_age=SESSION_DAYS * 86400, httponly=True, samesite="lax")
    return response


@app.post("/logout")
def logout():
    response = RedirectResponse("/login", status_code=303)
    response.delete_cookie(SESSION_COOKIE)
    return response


@app.get("/")
def index():
    return FileResponse(STATIC / "index.html")


@app.get("/api/dashboard")
def dashboard():
    data = metrics.build_dashboard(DB_PATH)
    data["demo"] = DEMO
    data["syncing"] = sync.is_running()
    data["login"] = bool(config.DASHBOARD_PASSWORD)  # shows the Log out button
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
    if config.HOST not in ("127.0.0.1", "localhost") and not config.DASHBOARD_PASSWORD:
        print("  WARNING: anyone on this network can open the dashboard and see your health data.\n"
              "  Set DASHBOARD_PASSWORD in .env to ask for a password.\n")
    uvicorn.run(app, host=config.HOST, port=config.PORT, log_level="warning")
