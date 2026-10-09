# Training

A personal, self-hosted training dashboard. It pulls activities and daily recovery data from Garmin Connect into a local SQLite database and serves a single-page dashboard on your home network, so any device on the wifi can open it.

Built with FastAPI, SQLite and Chart.js. No cloud, no accounts beyond your own Garmin login.

## What it shows

A menu on the left (a sideways-scrolling row on phones) picks the page; the address keeps it (`#overview`, `#health`, `#activities`, `#sport/run`), so a page can be bookmarked.

### Overview

The athlete's story and overall progression.

- **Story**: a few sentences at the top on what the sections below don't show: personal bests (any set in the last four weeks, otherwise the latest one), the year so far in your three biggest sports, and weekly training hours over the last four weeks against the four before.
- **Race goal**: set with **+ Race goal** under the story: race name, date, distance (5 km, 10 km, half, marathon or any other in km) and target time. Saved on the server (in the `meta` table), so every device shows the same goal. Shows the date, distance and days to go, the target with its pace, Garmin's race predictor for that distance (other distances are scaled from the nearest predicted one) and the gap between them, with a chart of the prediction over the last 6 months against the target line. After race day the run on that date shows as the result against the target (its elapsed time, as a race is timed), for a week; then the goal goes away. Garmin's predictions are synced daily (a year back, once) into the `daily` table.
- **Last night and today**: readiness, HRV, sleep and resting HR (with its 7-day average). If a value isn't from today (the watch or the sync is behind), the newest one from the last week is shown with its day ("from Wed 7 Oct"); the same goes for training status and load focus.
- **Training status**: Garmin's own status (Productive, Maintaining, Recovery, Unproductive…), acute load against Garmin's optimal range, and a four-week strip of daily statuses.
- **Load focus**: Garmin's last-four-weeks load in low aerobic, high aerobic and anaerobic against the optimal range for each, with what to train next. Training status and load focus sit in the left column under the top row.
- **Last activity**: in the right column next to them: your newest activity's name, when and where, Garmin's training effect, and the same stats as its sport's table columns, minus ascent and load. If it was recorded with GPS, its route is drawn as a glowing line, replayed once from start to finish when the page loads (skipped with reduced motion), on Esri's grey basemap (light or dark to match the page; the map tiles need internet). Most sports get an orange line; a few get their own color and map (`ROUTE_STYLES` in `frontend/js/map.js`): winter sports are ice blue on the grey map with Esri's terrain hillshade blended in, open-water swims are aqua and disc golf is magenta, both on dimmed Esri satellite imagery. The activity popup's map uses the same styles. Routes are fetched from Garmin during the sync for the 5 newest activities and stored in the `tracks` table.
- **Fitness and form**: one chart with fitness (42-day exponentially weighted training load, CTL) and fatigue (the same over 7 days, ATL) on one scale; form is the gap between them, as a % of fitness, named by band (Overloaded, Building, Balanced, Fresh, Rested) for today and in the tooltip, with the change in fitness over the last four weeks. The gap is shaded blue where fitness is ahead (positive form) and red where fatigue is. A switch shows the last 120 days or the whole year (remembered per device).
- **Weekly running** (your main sport, the one you do most): kilometres per week for the last 12 weeks, split by Garmin's training effect for each run, with the low aerobic share of the last 4 weeks. Other main sports show their kilometres or hours per week.
- **VO2 max**: Garmin's VO2 max estimate per week as a smooth line, up to `VO2MAX_BACKFILL_DAYS` back (fetched once in a single request), compared with three and twelve months ago.
- **Latest activities**: the 15 newest, linking to the full list, with the **This week / This year** panel for your main sport next to them.

### Health

- **Today**: HRV, sleep, resting HR, Body Battery peak and low, average stress (with Garmin's level) and steps so far. Training readiness is a training number, so it's on the overview only.
- **Charts for the last 90 days or the last year** (a switch at the top, remembered per device), one measure each: HRV against Garmin's normal range, resting heart rate, sleep (score in the tooltip), Body Battery (a bar from each day's low to its high), average stress and steps (with a 7-day average line and the best day in the period). HRV, resting HR, sleep and steps each get a sentence comparing the last 7 days with the 30 before.

### Activities

- **Every activity** synced from Garmin, 25 at a time with **Show more**. Buttons filter by sport (running, walking, hiking, cycling, swimming, strength, gym & cardio, disc golf, yoga, winter sports, other); only sports you have get a button, sorted by how many activities each has (Other last). The columns depend on the sport: running shows effect, distance, time, pace, avg HR and load; cycling shows speed instead of pace; winter sports show speed and descent; strength shows time, sets, reps, avg HR and load; yoga just time and avg HR; and so on (`SPORT_COLUMNS` in `frontend/js/sports.js`; the sport groups and their names are `SPORTS` in `backend/metrics.py`). A column that is empty for every row shown is left out. The **Effect** column (running, cycling, swimming, gym & cardio) shows Garmin's training effect label (Base, Tempo, Threshold, VO2 max…) with a dot in its load focus color. Runs without a Garmin label show the focus from average HR, marked "(HR)". Dates from earlier years include the year. Click a column header to sort by it (biggest or fastest first; again to reverse), and search by name, place or type in the box at the top; the totals panel follows the sport filter only. On phones the table leaves out effect, heart rate, load, climbing and the weekday, so it fits the screen; the popup has them all.
- **This week / This year**: a side panel next to the activities, following the sport filter. This week shows the total so far, a bar per day and the 4-week average; this year shows distance, time, metres climbed and count. For a single sport with distances, each also shows the longest one (for running, the longest run). Sports without distance (strength, yoga…) count time instead.

### A page per sport

Every sport you've done at least 3 times gets a page in the menu, most-used first, with its own color (`--sp-*` in `frontend/styles.css`). One-offs, Other and disc golf (Garmin keeps no scores, so there's little to follow) get no page; their activities are in the activities list and its sport filter like everything else.

- **Totals**: this week, the last 4 weeks (with the change against the 4 before), this year and last year. Distance for sports that record it, time for the rest. A sport you haven't done for four weeks (a ski trip, a summer sport) shows its latest outing, this year and last year instead of zeros.
- **Per week**: kilometres or hours per week for the last 26 weeks (or the 26 weeks up to the latest one). Running is split by Garmin's training effect, with the low aerobic share of the last 4 weeks.
- **This year against last year**: the running total of kilometres (or hours) through the year, this year as a solid line and last year dashed, with both totals on today's date. Shown when there's anything from last year.
- **Per month**: kilometres (or hours) per month, this year's bars next to last year's.
- **Personal bests**: for running, the fastest 400 m, 1 km, mile, 5 km, 10 km, half marathon and marathon within any run (distances you haven't run yet are listed as such); for every sport, the longest distance and time; for cycling and winter sports, top speed; for winter sports, most descent. Each opens its activity.

  The running bests are worked out from each run's second-by-second data (elapsed time, as Garmin's own splits use, so a stop counts against a split) and stored in the `efforts` table. They match Garmin's fastest splits to the tenth of a second and add 400 m, which Garmin doesn't keep. The sync works through your runs 40 at a time, newest first, one request each; until a run has been worked out, Garmin's own splits (1 km to marathon) are used.
- **All of the sport's activities**, with the same columns as the activities page, sortable the same way.

### Activity popup

- Clicking any activity row or personal best opens every stat Garmin has for it, grouped by topic (time and effort, training effect, heart rate and zones, pace or speed, running dynamics, power, swimming, elevation, breathing and more); groups the activity has no data for are left out. Cycling and winter sports show speed in km/h, the others pace. Winter sports also show the number of runs and max vertical speed, and their laps are listed as runs. The route and laps (with max speed and descent per lap) are fetched from Garmin the first time an activity is opened and stored in the `tracks` and `laps` tables.

In the bar charts, a week, month or day that isn't over yet (this week, this month, today's steps) is drawn paler and marked "so far" in the tooltip, so it doesn't read as a drop.

Training load comes from Garmin when available; otherwise it falls back to Banister TRIMP using `MAX_HR` and your median resting HR, converted to Garmin's scale by the median ratio between the two over your activities that have both (once there are 10 of them).

## Project layout

```
.
├── Start dashboard.bat   # Double-click launcher (the desktop shortcut points here)
├── README.md
├── requirements.txt
├── .env.example          # Copy to .env and adjust
├── backend/              # Python: server, Garmin sync and the numbers
│   ├── app.py            # FastAPI server, background sync loop, login
│   ├── sync.py           # Garmin Connect → SQLite (can also run on its own)
│   ├── metrics.py        # Turns raw tables into dashboard numbers; maps Garmin activity types to sports
│   ├── db.py             # SQLite schema and upserts
│   ├── config.py         # Reads settings from .env
│   ├── login.py          # One-time Garmin login, stores a token
│   └── demo.py           # Seeds fake data for --demo mode
├── frontend/             # The page the browser loads (served at /static); no build step
│   ├── index.html        # The page's markup
│   ├── login.html        # The login page, when DASHBOARD_PASSWORD is set
│   ├── styles.css
│   ├── js/               # ES modules, loaded from main.js
│   │   ├── main.js       # Loads the data, keeps it fresh, routes between pages
│   │   ├── state.js      # The dashboard data, shared by every module
│   │   ├── util.js       # Formatting and small helpers
│   │   ├── charts.js     # Chart.js setup
│   │   ├── map.js        # Route maps and their replay
│   │   ├── sports.js     # Sport groups, table columns, weekly volume and the This week / This year panel
│   │   ├── overview.js   # Overview page (with race.js for the race goal)
│   │   ├── race.js
│   │   ├── health.js     # Health page
│   │   ├── activities.js # Activities page
│   │   ├── sport.js      # A page per sport
│   │   └── modal.js      # Activity popup
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

On start it prints two addresses: `http://localhost:8000` for this machine and a LAN address for phones and other devices on the same wifi. On Windows you may need to allow Python through the firewall the first time. If the dashboard is reachable from the network without `DASHBOARD_PASSWORD`, it also prints a warning: anyone on the same wifi could then see your health data.

The server syncs in the background every `SYNC_INTERVAL_MINUTES`, and the **Sync now** button triggers one immediately. The first sync backfills `ACTIVITY_BACKFILL_DAYS` of activities and `DAILY_BACKFILL_DAYS` of daily data, which takes a few minutes because daily requests are spaced out to stay under Garmin's rate limits. Later syncs only fetch the last few days, and once a day the last 30 days of activities, so activities edited or deleted on Garmin since are changed or removed here too.

Each sync runs in order of importance: new activities, race predictions and VO2 max (a request each), the daily numbers since the last sync, then routes, best efforts and the one-off backfills. If Garmin rate-limits a step, the rest waits for the next sync, which starts after the daily numbers already saved.

Once, the sync also pages back through your whole Garmin activity history (100 activities per request). It saves its place after every page, so if Garmin rate-limits it, the next sync carries on where it stopped. Daily health data (HRV, sleep, Body Battery, stress, steps…) is backfilled the same way, once, back to `HEALTH_HISTORY_DAYS`: 45 days per sync, working backwards from the oldest day already synced, saving its place after every day.

### Login

With `DASHBOARD_PASSWORD` set in `.env`, the dashboard opens with a login page (and with `DASHBOARD_USERNAME` set too, it asks for that as well). Logging in keeps the device logged in for a year, with a cookie; **Log out** in the menu ends it. Wrong tries are answered after a second, to slow down guessing. The password travels unencrypted on your wifi (plain HTTP), so don't reuse an important one.

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
| `HEALTH_HISTORY_DAYS` | 365 | How far back daily health data is backfilled, 45 days per sync |
| `VO2MAX_BACKFILL_DAYS` | 1095 | How far back VO2 max history is fetched, once, for its chart |
| `SYNC_INTERVAL_MINUTES` | 60 | Background sync interval (minimum 5) |
| `HOST` | 0.0.0.0 | `0.0.0.0` = reachable on LAN, `127.0.0.1` = this machine only |
| `PORT` | 8000 | Server port |
| `DASHBOARD_PASSWORD` | empty | If set, the dashboard opens with a login page asking for it. Recommended with `HOST=0.0.0.0` |
| `DASHBOARD_USERNAME` | empty | If set, the login page asks for this username too; empty means password only |
| `TOKEN_DIR` | ~/.garminconnect | Where the Garmin login token is stored |
| `DB_PATH` | data/athlete.db | SQLite database, relative to the project folder |

## Troubleshooting

- **"Not logged in to Garmin"**: run `python backend/login.py` on the machine that runs the server. Tokens expire eventually; just log in again.
- **"Too many requests" / 429**: Garmin is rate-limiting. Wait a while and sync again; the sync resumes from the last successful date.
- **Logged out on every device**: changing `DASHBOARD_PASSWORD` or `DASHBOARD_USERNAME` logs everyone out; log in again with the new details.
- **Can't open it from a phone**: check that `HOST=0.0.0.0`, both devices are on the same network, and the Windows firewall allows Python.
- **Start over**: stop the server and delete `data/athlete.db`. The next sync backfills again.

## Notes

The form states and the 0.8–1.3 load ratio are rules of thumb, not medical advice. HRV range and readiness are Garmin's own numbers, shown as they come.
