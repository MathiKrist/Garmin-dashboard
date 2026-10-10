# Training

A personal, self-hosted training dashboard. It pulls activities and daily recovery data from Garmin Connect into a local SQLite database and serves a single-page dashboard on your home network, so any device on the wifi can open it.

Built with FastAPI, SQLite and Chart.js. No cloud, and no accounts beyond your own Garmin login. Everything the page needs is bundled, so it works offline apart from the map tiles.

## Quick start

Requires Python 3.10+. From the project folder, on Windows:

```bash
python -m venv .venv                          # a Python just for the dashboard (the .bat launchers use it)
.venv\Scripts\pip install -r requirements.txt
copy .env.example .env                        # then adjust .env
.venv\Scripts\python backend/login.py         # once; stores a Garmin token in TOKEN_DIR
.venv\Scripts\python backend/app.py           # or --demo for generated data, no Garmin needed
```

On Linux/macOS use `.venv/bin/pip`, `.venv/bin/python` and `cp`. Run everything from the project folder; paths in `.env` (like `DB_PATH`) are relative to it.

Your Garmin password never goes in `.env`: `login.py` stores a token and the sync reuses it. `requirements.txt` pins versions known to work; if a sync starts failing after Garmin changes something, try `pip install -U garminconnect` first.

On start the server prints two addresses: `http://localhost:8000` for this machine and a LAN address for other devices on the wifi. On Windows you may need to allow Python through the firewall the first time. If the dashboard is reachable from the network without `DASHBOARD_PASSWORD`, it warns you: anyone on the wifi could see your health data.

## Launchers

| File | What it does |
|---|---|
| `Start dashboard.bat` | Starts the server and opens the page in the browser |
| `Dashboard app.bat` | Opens the dashboard in its own window (the desktop app), starting a local server if none runs. `--demo` for demo data |
| `Open dashboard.bat` | Only opens the page in the browser, for a server running on another device |

All use the Python in `.venv`. `Dashboard app.bat` and `Open dashboard.bat` connect to `DASHBOARD_URL` from `.env` (the "From other devices on wifi" address the server prints), or this machine when it's empty.

**Desktop app.** A window onto the server, with no console, using Edge WebView2 through pywebview (included in Windows 11). If it starts the server itself, it also runs the background sync and stops the server when the window closes; phones can connect meanwhile. If nothing answers at `DASHBOARD_URL`, it says so with a **Try again** button. It keeps its login and remembered switches in `data/webview` and logs from its server to `data/desktop.log`.

**Desktop shortcuts.** Right-click a `.bat` → **Show more options** → **Send to** → **Desktop (create shortcut)**, then pick an icon from `assets/` under the shortcut's **Properties** → **Change Icon…**. Moving the `.bat` or icon breaks the shortcut.

## What it shows

A menu on the left (a sideways-scrolling row on phones) picks the page. The address keeps it (`#overview`, `#health`, `#activities`, `#sport/run`), so pages can be bookmarked.

The page is dark from 20:00 to 07:00 and otherwise follows the system setting. The **Auto / Light / Dark** switch at the bottom of the menu overrides that, per device.

In bar charts, a period that isn't over yet (this week, this month, today) is drawn paler and marked "so far", so it doesn't read as a drop.

### Overview

- **Story**: a few sentences on what the sections below don't show: recent personal bests, the year so far in your three biggest sports, and weekly training hours over the last four weeks against the four before.
- **Race goal** (set with **+ Race goal**): name, date, distance and target time, stored on the server so every device shows it. Shows days to go, target pace, Garmin's race prediction for that distance (scaled from the nearest predicted distance if needed) and the gap, with a 6-month chart of the prediction against the target. For a week after race day it shows the result (the run's elapsed time) against the target, then goes away.
- **Last night and today**: readiness, HRV, sleep and resting HR (with 7-day average), and a ring of today's calories burnt (active in red, resting in blue). A value that isn't from today is replaced by the newest from the last week, labelled with its day ("from Wed 7 Oct").
- **Training status**: Garmin's status, acute load against the optimal range, and a four-week strip of daily statuses.
- **Load focus**: Garmin's four-week load in low aerobic, high aerobic and anaerobic against each optimal range, with what to train next.
- **Last activity**: name, time, place, training effect and its sport's key stats. With GPS, the route is drawn as a glowing line that replays once on load (skipped with reduced motion). Colors and basemaps per sport are in `ROUTE_STYLES` in `frontend/js/map.js`: orange on Esri grey by default, ice blue with hillshade for winter sports, aqua and magenta on dimmed satellite for open-water swims and disc golf.
- **Fitness and form**: fitness (CTL, 42-day weighted load) and fatigue (ATL, 7-day) on one chart; form is the gap as a % of fitness, named by band (Overloaded, Building, Balanced, Fresh, Rested), shaded blue where fitness leads and red where fatigue does. Last 120 days or the whole year.
- **Weekly running** (or your main sport): kilometres per week for 12 weeks, split by training effect, with the low aerobic share of the last 4 weeks. Other main sports show kilometres or hours. Click a week to see its activities.
- **VO2 max**: Garmin's estimate per week, against three and twelve months ago.
- **Training calendar**: 53 weeks, a square per day shaded by training load in four quartile steps; rest days grey. Hover for details, click to open the day's biggest activity. Above it: training days, days per week and longest streak.
- **Latest activities**: the 15 newest, with the **This week / This year** panel for your main sport.

### Health

- **Today**: HRV, sleep, resting HR, Body Battery peak and low, average stress, steps and calories burnt so far. (Readiness is a training number, so it's on the overview.)
- **Charts** for the last 90 days or year, one measure each: HRV against Garmin's normal range, resting HR, sleep, Body Battery (daily low to high), stress, steps and calories burnt (active and resting split in the tooltip). Steps and calories show a 7-day average line and the best day. HRV, resting HR, sleep, steps and calories each get a sentence comparing the last 7 days with the 30 before.

### Activities

- **Every activity**, 25 at a time with **Show more**. Sport filter buttons appear only for sports you have, sorted by count. Columns depend on the sport (`SPORT_COLUMNS` in `frontend/js/sports.js`; sport groups are `SPORTS` in `backend/metrics.py`), and columns empty for every row are hidden. The **Effect** column shows Garmin's training effect label with a dot in its load focus color; runs without one get a focus from average HR, marked "(HR)". Click a header to sort, and search by name, place or type. On phones the table drops effect, HR, load, climbing and weekday; the popup has them all.
- **This week / This year**: a side panel following the sport filter. This week: total so far, a bar per day and the 4-week average. This year: distance, time, climbing and count. Single sports with distance also show the longest one; sports without distance count time.

### A page per sport

Every sport done at least 3 times gets a page, most-used first, with its own color (`--sp-*` in `frontend/styles.css`). Other and disc golf (Garmin keeps no scores) get no page.

- **Totals**: this week, the last 4 weeks (against the 4 before), this year and last year, in distance or time. A sport not done for four weeks shows its latest outing instead of zeros.
- **Per week**: the last 26 weeks (or the 26 up to the latest), running split by training effect. Click a week to see its activities.
- **This year against last year**: the cumulative total through the year, last year dashed.
- **Per month**: this year's bars next to last year's.
- **Personal bests**: for running, the fastest 400 m, 1 km, mile, 5 km, 10 km, half and marathon within any run; for every sport, the longest distance and time; top speed for cycling and winter sports; most descent for winter sports. Each opens its activity.
- **All of the sport's activities**, with the same columns as the activities page.

### Activity popup

Clicking an activity or personal best shows every stat Garmin has for it, grouped by topic (effort, training effect, heart rate zones, pace or speed, running dynamics, power, swimming, elevation, breathing…), with the route and laps. Empty groups are left out. Winter sports list their laps as runs, with max speed and descent each.

## How the numbers are worked out

- **Training load** is Garmin's when available. Otherwise it's Banister TRIMP from `MAX_HR` and your median resting HR, scaled to Garmin's by the median ratio over activities that have both (once there are 10).
- **Running bests** come from each run's second-by-second data, using elapsed time like Garmin's splits (so stops count). They match Garmin's fastest splits to a tenth of a second and add 400 m. Until a run has been processed, Garmin's own splits are used.
- **Form bands** and the 0.8–1.3 load ratio are rules of thumb, not medical advice. HRV range, readiness and race predictions are Garmin's own numbers, shown as they come.

## Syncing

The server syncs every `SYNC_INTERVAL_MINUTES`; **Sync now** triggers one immediately. To sync without the server, run `backend/sync.py`.

Each sync runs in order of importance: new activities, race predictions and VO2 max, daily numbers since the last sync, then routes, best efforts and one-off backfills. If Garmin rate-limits a step, the rest waits for the next sync, which resumes where it stopped.

- **First sync**: `ACTIVITY_BACKFILL_DAYS` of activities and `DAILY_BACKFILL_DAYS` of daily data. Takes a few minutes, as daily requests are spaced out for Garmin's rate limits.
- **Later syncs**: the last few days, plus once a day the last 30 days of activities, so edits and deletions on Garmin carry over.
- **One-off backfills**, each saving its place so they survive rate limits:
  - full activity history, 100 per request;
  - daily health data back to `HEALTH_HISTORY_DAYS`, 45 days per sync;
  - calories for days synced before they were added, 45 days per sync;
  - race predictions a year back, and VO2 max back to `VO2MAX_BACKFILL_DAYS`, one request each.
- **Routes** for the 5 newest activities are fetched during the sync; any other activity's route and laps are fetched when first opened.
- **Running bests** are processed 40 runs per sync, newest first.

## Login

With `DASHBOARD_PASSWORD` set, the dashboard opens with a login page (also asking for `DASHBOARD_USERNAME` if set). A device stays logged in for a year; **Log out** in the menu ends it. Wrong tries are answered after a second to slow guessing. The password travels unencrypted over plain HTTP on your wifi, so don't reuse an important one. Changing either setting logs everyone out.

## Configuration (`.env`)

| Setting | Default | What it does |
|---|---|---|
| `AEROBIC_THRESHOLD` | 158 | Avg HR (bpm) splitting low from high aerobic, for runs without a Garmin training effect |
| `MAX_HR` | 195 | Only used for TRIMP when Garmin has no load |
| `ACTIVITY_BACKFILL_DAYS` | 180 | How far back the first activity sync goes (the full history follows regardless) |
| `DAILY_BACKFILL_DAYS` | 60 | How far back the first daily sync goes |
| `HEALTH_HISTORY_DAYS` | 365 | How far back daily health data is backfilled |
| `VO2MAX_BACKFILL_DAYS` | 1095 | How far back VO2 max history is fetched, once |
| `SYNC_INTERVAL_MINUTES` | 60 | Background sync interval (minimum 5) |
| `HOST` | 0.0.0.0 | `0.0.0.0` = reachable on LAN, `127.0.0.1` = this machine only |
| `PORT` | 8000 | Server port |
| `DASHBOARD_URL` | empty | Where the desktop app and `Open dashboard.bat` connect when the server is on another device (e.g. `http://192.168.1.20:8000`) |
| `DASHBOARD_PASSWORD` | empty | Turns on the login page. Recommended with `HOST=0.0.0.0` |
| `DASHBOARD_USERNAME` | empty | Also asks for a username; empty means password only |
| `TOKEN_DIR` | ~/.garminconnect | Where the Garmin login token is stored |
| `DB_PATH` | data/athlete.db | SQLite database, relative to the project folder |

## Project layout

```
.
├── Start dashboard.bat   # Starts the server and opens the browser
├── Dashboard app.bat     # The desktop app
├── Open dashboard.bat    # Opens the browser only, for a server elsewhere
├── requirements.txt
├── .env.example          # Copy to .env and adjust
├── backend/
│   ├── app.py            # FastAPI server, background sync loop, login
│   ├── sync.py           # Garmin Connect → SQLite (can also run on its own)
│   ├── metrics.py        # Raw tables → dashboard numbers; Garmin activity types → sports
│   ├── db.py             # SQLite schema and upserts
│   ├── config.py         # Reads .env
│   ├── login.py          # One-time Garmin login
│   └── demo.py           # Fake data for --demo
├── desktop/
│   └── main.py           # Desktop app window (pywebview)
├── frontend/             # Served at /static; no build step
│   ├── index.html
│   ├── login.html        # When DASHBOARD_PASSWORD is set
│   ├── styles.css
│   ├── js/               # ES modules, loaded from main.js
│   │   ├── main.js       # Loads and refreshes data, routes between pages
│   │   ├── theme.js      # Light or dark (plain script, runs before the page draws)
│   │   ├── state.js      # Shared dashboard data
│   │   ├── util.js       # Formatting helpers
│   │   ├── charts.js     # Chart.js setup
│   │   ├── map.js        # Route maps and replay
│   │   ├── sports.js     # Sport groups, table columns, weekly volume, This week / This year
│   │   ├── overview.js
│   │   ├── race.js       # Race goal (overview)
│   │   ├── calendar.js   # Training calendar (overview)
│   │   ├── health.js
│   │   ├── activities.js
│   │   ├── sport.js      # Per-sport pages
│   │   └── modal.js      # Activity popup and a week's activities
│   └── vendor/           # Bundled for offline use
│       ├── chart.umd.js  # Chart.js
│       ├── fonts/        # Barlow and Barlow Condensed (SIL OFL)
│       └── leaflet/      # Leaflet
├── tests/
├── assets/               # Shortcut icons: dashboard.ico and six icon-*.ico options
└── data/                 # athlete.db, demo.db, desktop app data; not in git
```

Database tables of note: `daily` (health numbers and race predictions), `tracks` and `laps` (routes), `efforts` (running bests), `meta` (race goal and backfill progress).

## Tests

```bash
.venv\Scripts\python -m unittest discover tests
```

`test_metrics.py` checks the numbers (best efforts, race predictions, form, training load, sports, VO2 max). `test_sync.py` runs the sync against a stand-in for Garmin on a throwaway database (the daily recheck for edits and deletions, and rate-limit handling).

## Troubleshooting

- **"Not logged in to Garmin"**: run `backend/login.py` on the machine running the server. Tokens expire eventually.
- **"Too many requests" / 429**: Garmin is rate-limiting. Wait and sync again; it resumes where it stopped.
- **Logged out on every device**: `DASHBOARD_PASSWORD` or `DASHBOARD_USERNAME` changed; log in with the new details.
- **Can't open it from a phone**: check `HOST=0.0.0.0`, that both devices are on the same network, and that the Windows firewall allows Python.
- **Desktop app says "Can't reach the dashboard"**: the server at `DASHBOARD_URL` isn't running, the address is wrong, or a firewall blocks it. For a server the app started itself, see `data/desktop.log`.
- **Start over**: stop the server and delete `data/athlete.db`. The next sync backfills again.
