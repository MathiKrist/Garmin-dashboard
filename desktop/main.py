"""The dashboard in its own window, as a desktop app.

    pythonw desktop/main.py          # connects to DASHBOARD_URL, or this machine
    pythonw desktop/main.py --demo   # with no server running here, starts one on demo data

It's a client: it shows the page from the server at DASHBOARD_URL. When that's this machine and nothing answers
there, it starts the server itself, in this process, until the window closes.
"""
import ctypes
import html
import os
import socket
import sys
import threading
import time
from pathlib import Path
from urllib.parse import urlparse

BASE_DIR = Path(__file__).resolve().parent.parent
DATA = BASE_DIR / "data"
DATA.mkdir(exist_ok=True)

# pythonw has no console, and uvicorn's logging fails without one: the logs go to a file instead
if sys.stdout is None or sys.stderr is None:
    sys.stdout = sys.stderr = open(DATA / "desktop.log", "a", encoding="utf-8", buffering=1)

sys.path.insert(0, str(BASE_DIR / "backend"))
import config  # noqa: E402
import webview  # noqa: E402

URL = config.DASHBOARD_URL or f"http://127.0.0.1:{config.PORT}"
LOCAL = urlparse(URL).hostname in ("localhost", "127.0.0.1")
ICON = BASE_DIR / "assets" / "dashboard.ico"


def reachable(url):
    """True when a server listens at url. This machine answers at once, while Windows takes 2 s to give up on a
    closed port, so it gets a short timeout."""
    parts = urlparse(url)
    try:
        socket.create_connection((parts.hostname, parts.port or (443 if parts.scheme == "https" else 80)), timeout=0.3 if LOCAL else 3).close()
        return True
    except OSError:
        return False


def start_local_server():
    """Runs the dashboard's server in this process. Returns a function that stops it once it's listening,
    or None if it failed (the port taken by something else, say)."""
    import uvicorn
    import app

    server = uvicorn.Server(uvicorn.Config(app.app, host=config.HOST, port=config.PORT, log_level="warning"))
    thread = threading.Thread(target=server.run, daemon=True)
    thread.start()
    deadline = time.monotonic() + 15
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.1)
    if not server.started:
        return None

    def stop():  # don't wait long for the window's open connections
        server.should_exit = True
        thread.join(0.5)
    return stop


def unreachable_page():
    return f"""<!doctype html><meta charset="utf-8">
<style>:root{{color-scheme:light dark}}body{{font:16px system-ui,sans-serif;display:grid;place-items:center;
height:100vh;margin:0;text-align:center}}button{{font:inherit;padding:.5em 1.4em;margin-top:1em;cursor:pointer}}</style>
<div><h2>Can't reach the dashboard</h2><p>Nothing answers at {html.escape(URL)}.</p>
<button onclick="this.textContent='Trying…';pywebview.api.retry().then(ok=>{{if(!ok)this.textContent='Try again'}})">Try again</button></div>"""


class Api:
    """Called from the "Can't reach" page."""

    def retry(self):
        if not reachable(URL):
            return False
        webview.windows[0].load_url(URL)
        return True


def set_icon(window):
    """Windows takes the window's icon from pythonw.exe; this gives it the dashboard's."""
    hwnd = window.native.Handle.ToInt64()
    load = ctypes.windll.user32.LoadImageW
    load.restype = ctypes.c_void_p
    send = ctypes.windll.user32.SendMessageW
    send.argtypes = [ctypes.c_void_p, ctypes.c_uint, ctypes.c_void_p, ctypes.c_void_p]
    for size, which in ((16, 0), (32, 1)):  # WM_SETICON: ICON_SMALL, ICON_BIG
        icon = load(None, str(ICON), 1, size, size, 0x10)  # IMAGE_ICON, LR_LOADFROMFILE
        if icon:
            send(hwnd, 0x80, which, icon)


def main():
    if sys.platform == "win32":  # its own taskbar button, not grouped with other Python windows
        ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID("Training.Dashboard")

    up = reachable(URL)
    stop_server = start_local_server() if not up and LOCAL else None

    page = {"url": URL} if up or stop_server else {"html": unreachable_page()}
    window = webview.create_window("Training", **page, js_api=Api(), width=1400, height=900, min_size=(800, 600))
    if sys.platform == "win32":
        window.events.shown += lambda: set_icon(window)
    # Not private, so the login cookie and the remembered switches are kept between runs
    webview.start(private_mode=False, storage_path=str(DATA / "webview"))

    if stop_server:
        stop_server()


if __name__ == "__main__":
    main()
    # The window is gone; unloading .NET (pywebview's) on a normal exit takes ~5 s, holding the port meanwhile
    sys.stdout.flush()
    os._exit(0)
