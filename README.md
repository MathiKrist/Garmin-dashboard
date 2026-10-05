# Garmin training dashboard

A small local server that pulls your Garmin Connect data into a SQLite file and
shows it as a dashboard any device on your wifi can open. Nothing leaves your
network except the requests to Garmin itself.

## Setup (once)

```bash
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # Windows: copy .env.example .env
python login.py                    # Garmin email, password and MFA code if asked
```

`login.py` saves a token in `~/.garminconnect`. Your password isn't stored.

## Run

```bash
python app.py
```

It prints two addresses: `localhost` for the machine itself, and a
`192.168.x.x` one for your phone or other laptops on the same wifi.

The first sync pulls 180 days of activities and 60 days of sleep/HRV/readiness.
The daily part makes four requests per day, so give it a few minutes. After that
it syncs every hour (change `SYNC_INTERVAL_MINUTES` in `.env`), or press
**Sync now**.

Want to see it before logging in? `python app.py --demo` uses fake data.

## Things to know

- **Easy vs hard** is decided per run by average heart rate against
  `AEROBIC_THRESHOLD` (158 by default). It's a run-level split, not time in zone.
- **Fitness / fatigue / form** are 42- and 7-day exponential averages of Garmin's
  own training load per activity (falls back to a heart-rate TRIMP estimate when
  Garmin has none). Give it about six weeks of history before trusting form.
- **Other devices can't connect?** Allow Python through the firewall on the
  server machine (Windows asks the first time; on Linux, open port 8000).
- **Shared wifi** (dorm, flat): set `DASHBOARD_PASSWORD` in `.env`, since
  otherwise anyone on the network can open the page.
- **"Not logged in" banner:** run `python login.py` again, then Sync now.
- Uses the unofficial `garminconnect` library. If Garmin changes something and
  sync breaks, `pip install -U garminconnect` usually fixes it.

## Keeping it running

The dashboard is only reachable while the machine running `app.py` is on.
For an always-on setup, run it on a spare laptop or a Raspberry Pi and start it
at boot (Task Scheduler on Windows, a systemd service or `@reboot` cron on Linux).

## Files

| File | What it does |
| --- | --- |
| `app.py` | Web server, background sync, optional password |
| `sync.py` | Garmin to SQLite (`python sync.py` runs one sync by hand) |
| `metrics.py` | Training load, fitness/fatigue/form, weekly volume |
| `db.py` | Database tables |
| `login.py` | One-time Garmin login |
| `demo.py` | Fake data for `--demo` |
| `static/` | The dashboard page (Chart.js is bundled, no CDN needed) |
