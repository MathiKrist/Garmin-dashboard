# Training

A personal, self-hosted training dashboard. It pulls activities and daily recovery data from Garmin Connect into a local SQLite database and serves a single-page dashboard on your home network, so any device on the wifi can open it.

Built with FastAPI, SQLite and Chart.js. No cloud, no accounts beyond your own Garmin login.

## What it shows

- **Training status**: Garmin's own status (Productive, Maintaining, Recovery, Unproductive…) with what it means, acute load against Garmin's optimal range, VO2 max, and a four-week strip of daily statuses.
- **Load focus**: Garmin's last-four-weeks load in low aerobic, high aerobic and anaerobic against the optimal range for each, with what to train next.
- **Last night and today**: readiness, HRV, sleep and resting HR (with its 7-day average).
- **Fitness**: 42-day (CTL) exponentially weighted training load, with its change over the last four weeks.
- **Form**: fitness minus fatigue (7-day ATL) as a % of fitness, shown next to fitness, drawn over bands (Overloaded, Building, Balanced, Fresh, Rested), with today's state.
- **VO2 max**: Garmin's VO2 max estimate per week, up to `VO2MAX_BACKFILL_DAYS` back (fetched once in a single request), compared with three and twelve months ago.
- **Weekly running**: km per week for the last 12 weeks, split into low aerobic, high aerobic and anaerobic by Garmin's training effect for each run (average HR against your aerobic threshold when Garmin has no label).
- **HRV**: nightly HRV against Garmin's baseline range, with resting HR overlaid.
- **Sleep and readiness**: hours slept and Garmin's training readiness score.
- **Recent activities**: every activity synced from Garmin, 25 at a time with **Show more**. Buttons filter by sport (running, walking, hiking, cycling, swimming, strength, gym & cardio, disc golf, yoga, winter sports, other); only sports you have get a button. Each row shows distance, time, pace (km/h on the bike, per 100 m in the pool), avg HR, load, and an **Effect** column with Garmin's training effect label (Base, Tempo, Threshold, VO2 max…) and a dot in its load focus color. Runs without a Garmin label show the focus from average HR, marked "(HR)". Dates from earlier years include the year.
- **This week / This year**: a side panel next to the activities, following the sport filter. This week shows the total so far, a bar per day and the 4-week average; this year shows distance, time, metres climbed and count. Sports without distance (strength, yoga…) count time instead.

Training load comes from Garmin when available; otherwise it falls back to Banister TRIMP using `MAX_HR` and your median resting HR.

## Project layout

```
.
├── app.py          # FastAPI server, background sync loop, password gate
├── sync.py         # Garmin Connect → SQLite (can also run on its own)
├── metrics.py      # Turns raw tables into dashboard numbers; maps Garmin activity types to sports
├── db.py           # SQLite schema and upserts
├── config.py       # Reads settings from .env
├── login.py        # One-time Garmin login, stores a token
├── demo.py         # Seeds fake data for --demo mode
├── .env.example    # Copy to .env and adjust
├── data/           # athlete.db (and demo.db) live here
└── static/
    ├── index.html
    ├── app.js
    └── chart.umd.js
```

## Setup

Requires Python 3.10+.

```bash
pip install fastapi uvicorn garminconnect python-dotenv
copy .env.example .env        # Windows (use cp on Linux/macOS)
python login.py               # once; stores a token in TOKEN_DIR
```

Your Garmin password never goes in `.env`. `login.py` stores a token, and the sync reuses it.

## Running

```bash
python app.py          # real Garmin data
python app.py --demo   # generated demo data, no Garmin needed
```

On start it prints two addresses: `http://localhost:8000` for this machine and a LAN address for phones and other devices on the same wifi. On Windows you may need to allow Python through the firewall the first time.

The server syncs in the background every `SYNC_INTERVAL_MINUTES`, and the **Sync now** button triggers one immediately. The first sync backfills `ACTIVITY_BACKFILL_DAYS` of activities and `DAILY_BACKFILL_DAYS` of daily data, which takes a few minutes because daily requests are spaced out to stay under Garmin's rate limits. Later syncs only fetch the last few days.

Once, the sync also pages back through your whole Garmin activity history (100 activities per request). It saves its place after every page, so if Garmin rate-limits it, the next sync carries on where it stopped. Daily recovery data is not backfilled this way; it still goes back `DAILY_BACKFILL_DAYS`.

To sync without the server:

```bash
python sync.py
```

### Windows shortcut

A `.bat` file in the project folder can start the dashboard with a double-click, for example:

```bat
@echo off
cd /d "%~dp0"
python app.py
pause
```

## Configuration (`.env`)

| Setting | Default | What it does |
|---|---|---|
| `AEROBIC_THRESHOLD` | 158 | Avg HR (bpm) splitting low from high aerobic runs, only for runs without a Garmin training effect |
| `MAX_HR` | 195 | Only used for TRIMP when Garmin has no load |
| `ACTIVITY_BACKFILL_DAYS` | 180 | How far back the first activity sync goes (the full history is fetched afterwards regardless) |
| `DAILY_BACKFILL_DAYS` | 60 | How far back the first daily sync goes |
| `VO2MAX_BACKFILL_DAYS` | 1095 | How far back VO2 max history is fetched, once, for its chart |
| `SYNC_INTERVAL_MINUTES` | 60 | Background sync interval (minimum 5) |
| `HOST` | 0.0.0.0 | `0.0.0.0` = reachable on LAN, `127.0.0.1` = this machine only |
| `PORT` | 8000 | Server port |
| `DASHBOARD_PASSWORD` | empty | If set, the browser asks for it (any username) |
| `TOKEN_DIR` | ~/.garminconnect | Where the Garmin login token is stored |
| `DB_PATH` | data/athlete.db | SQLite database, relative to the project folder |

## Troubleshooting

- **"Not logged in to Garmin"**: run `python login.py` on the machine that runs the server. Tokens expire eventually; just log in again.
- **"Too many requests" / 429**: Garmin is rate-limiting. Wait a while and sync again; the sync resumes from the last successful date.
- **Can't open it from a phone**: check that `HOST=0.0.0.0`, both devices are on the same network, and the Windows firewall allows Python.
- **Start over**: stop the server and delete `data/athlete.db`. The next sync backfills again.

## Notes

The form states and the 0.8–1.3 load ratio are rules of thumb, not medical advice. HRV range and readiness are Garmin's own numbers, shown as they come.
