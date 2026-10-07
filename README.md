# Training

A personal, self-hosted training dashboard. It pulls activities and daily recovery data from Garmin Connect into a local SQLite database and serves a single-page dashboard on your home network, so any device on the wifi can open it.

Built with FastAPI, SQLite and Chart.js. No cloud, no accounts beyond your own Garmin login.

## What it shows

- **Last night and today** (top row): readiness, HRV, sleep and resting HR (with its 7-day average).
- **Training status**: Garmin's own status (Productive, Maintaining, Recovery, Unproductive…) with what it means, acute load against Garmin's optimal range, VO2 max, and a four-week strip of daily statuses.
- **Load focus**: Garmin's last-four-weeks load in low aerobic, high aerobic and anaerobic against the optimal range for each, with what to train next. Training status and load focus sit in the left column under the top row.
- **Last activity**: in the right column next to them: your newest activity's name, when and where, Garmin's training effect, and the same stats as its sport's table columns, minus ascent and load. If it was recorded with GPS, its route is drawn as a glowing line, replayed once from start to finish when the page loads (skipped with reduced motion), on Esri's grey basemap (light or dark to match the page; the map tiles need internet). Most sports get an orange line; a few get their own color and map (`ROUTE_STYLES` in `app.js`): winter sports are ice blue on the grey map with Esri's terrain hillshade blended in, open-water swims are aqua and disc golf is magenta, both on dimmed Esri satellite imagery. The activity popup's map uses the same styles. Routes are fetched from Garmin during the sync for the 5 newest activities and stored in the `tracks` table.
- **Fitness**: 42-day (CTL) exponentially weighted training load, with its change over the last four weeks.
- **Form**: fitness minus fatigue (7-day ATL) as a % of fitness, shown next to fitness, drawn over bands (Overloaded, Building, Balanced, Fresh, Rested), with today's state.
- **VO2 max**: Garmin's VO2 max estimate per week as a smooth line, up to `VO2MAX_BACKFILL_DAYS` back (fetched once in a single request), compared with three and twelve months ago.
- **Weekly running**: km per week for the last 12 weeks, split into low aerobic, high aerobic and anaerobic by Garmin's training effect for each run (average HR against your aerobic threshold when Garmin has no label).
- **HRV**: nightly HRV against Garmin's baseline range, with resting HR overlaid.
- **Sleep and readiness**: hours slept and Garmin's training readiness score.
- **Recent activities**: every activity synced from Garmin, 25 at a time with **Show more**. Buttons filter by sport (running, walking, hiking, cycling, swimming, strength, gym & cardio, disc golf, yoga, winter sports, other); only sports you have get a button, sorted by how many activities each has (Other last). The columns depend on the sport: running shows effect, distance, time, pace, avg HR and load; cycling shows speed instead of pace; winter sports show speed and descent; strength shows time, sets, reps, avg HR and load; yoga just time and avg HR; and so on (`SPORT_COLUMNS` in `frontend/app.js`). A column that is empty for every row shown is left out. The **Effect** column (running, cycling, swimming, gym & cardio) shows Garmin's training effect label (Base, Tempo, Threshold, VO2 max…) with a dot in its load focus color. Runs without a Garmin label show the focus from average HR, marked "(HR)". Dates from earlier years include the year.
- **Activity popup**: clicking an activity opens every stat Garmin has for it, grouped by topic (time and effort, training effect, heart rate and zones, pace or speed, running dynamics, power, swimming, elevation, breathing and more); groups the activity has no data for are left out. Cycling and winter sports show speed in km/h, the others pace. Winter sports also show the number of runs and max vertical speed, and their laps are listed as runs. The route and laps (with max speed and descent per lap) are fetched from Garmin the first time an activity is opened and stored in the `tracks` and `laps` tables.
- **This week / This year**: a side panel next to the activities, following the sport filter. This week shows the total so far, a bar per day and the 4-week average; this year shows distance, time, metres climbed and count. Sports without distance (strength, yoga…) count time instead.

Training load comes from Garmin when available; otherwise it falls back to Banister TRIMP using `MAX_HR` and your median resting HR.

## Project layout

```
.
├── Start dashboard.bat   # Double-click launcher (the desktop shortcut points here)
├── README.md
├── requirements.txt
├── .env.example          # Copy to .env and adjust
├── backend/              # Python: server, Garmin sync and the numbers
│   ├── app.py            # FastAPI server, background sync loop, password gate
│   ├── sync.py           # Garmin Connect → SQLite (can also run on its own)
│   ├── metrics.py        # Turns raw tables into dashboard numbers; maps Garmin activity types to sports
│   ├── db.py             # SQLite schema and upserts
│   ├── config.py         # Reads settings from .env
│   ├── login.py          # One-time Garmin login, stores a token
│   └── demo.py           # Seeds fake data for --demo mode
├── frontend/             # The page the browser loads (served at /static)
│   ├── index.html
│   ├── app.js
│   └── vendor/
│       ├── chart.umd.js  # Chart.js, bundled so it works offline
│       └── leaflet/      # Leaflet, for the last activity's map
├── assets/
│   └── dashboard.ico     # Icon for the desktop shortcut
└── data/                 # athlete.db (and demo.db) live here; not in git
```

Run everything from the project folder; paths in `.env` (like `DB_PATH`) are relative to it.

## Setup

Requires Python 3.10+.

```bash
pip install fastapi uvicorn garminconnect python-dotenv
copy .env.example .env        # Windows (use cp on Linux/macOS)
python backend/login.py       # once; stores a token in TOKEN_DIR
```

Your Garmin password never goes in `.env`. `backend/login.py` stores a token, and the sync reuses it.

## Running

```bash
python backend/app.py          # real Garmin data
python backend/app.py --demo   # generated demo data, no Garmin needed
```

On start it prints two addresses: `http://localhost:8000` for this machine and a LAN address for phones and other devices on the same wifi. On Windows you may need to allow Python through the firewall the first time.

The server syncs in the background every `SYNC_INTERVAL_MINUTES`, and the **Sync now** button triggers one immediately. The first sync backfills `ACTIVITY_BACKFILL_DAYS` of activities and `DAILY_BACKFILL_DAYS` of daily data, which takes a few minutes because daily requests are spaced out to stay under Garmin's rate limits. Later syncs only fetch the last few days.

Once, the sync also pages back through your whole Garmin activity history (100 activities per request). It saves its place after every page, so if Garmin rate-limits it, the next sync carries on where it stopped. Daily recovery data is not backfilled this way; it still goes back `DAILY_BACKFILL_DAYS`.

To sync without the server:

```bash
python backend/sync.py
```

### Windows shortcut

`Start dashboard.bat` in the project folder starts the dashboard with a double-click and opens it in the browser. It uses the Python in `.venv`. The desktop shortcut points at this file and takes its icon from `assets/dashboard.ico`, so keep both where they are or update the shortcut.

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

- **"Not logged in to Garmin"**: run `python backend/login.py` on the machine that runs the server. Tokens expire eventually; just log in again.
- **"Too many requests" / 429**: Garmin is rate-limiting. Wait a while and sync again; the sync resumes from the last successful date.
- **Can't open it from a phone**: check that `HOST=0.0.0.0`, both devices are on the same network, and the Windows firewall allows Python.
- **Start over**: stop the server and delete `data/athlete.db`. The next sync backfills again.

## Notes

The form states and the 0.8–1.3 load ratio are rules of thumb, not medical advice. HRV range and readiness are Garmin's own numbers, shown as they come.
