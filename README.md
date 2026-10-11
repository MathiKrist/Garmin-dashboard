# Training

A personal, self-hosted training dashboard. It pulls activities and daily recovery data from Garmin Connect into a local SQLite database and serves a single-page dashboard on your home network, so any device on the wifi can open it.

Built with FastAPI, SQLite and Chart.js. No cloud, and no accounts beyond your own Garmin login (and Claude, for the workout chat). Everything the page needs is bundled, so it works offline apart from the map tiles.

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

A menu on the left picks the page. On phones it hides behind the ☰ button in the bar on top, which also shows the page's name, and slides in from the left. The address keeps it (`#overview`, `#workout`, `#health`, `#activities`, `#sport/run`), so pages can be bookmarked.

The page is dark from 20:00 to 07:00 and otherwise follows the system setting. The **Auto / Light / Dark** switch at the bottom of the menu overrides that, per device.

In bar charts, a period that isn't over yet (this week, this month, today) is drawn paler and marked "so far", so it doesn't read as a drop.

### Overview

- **Story**: a few sentences on what the sections below don't show: recent personal bests, the year so far in your three biggest sports, and weekly training hours over the last four weeks against the four before.
- **Race goal** (set with **+ Race goal**, or by a race plan): name, date, distance and target time, stored on the server so every device shows it. Shows days to go, target pace, Garmin's race prediction for that distance (scaled from the nearest predicted distance if needed) and the gap, the plan's projected range when a plan leads to this race, with a 6-month chart of the prediction against the target. For a week after race day it shows the result (the run's elapsed time) against the target, then goes away.
- **Last night and today**: readiness, HRV, sleep and resting HR (with 7-day average), and a ring of today's calories burnt (active in red, resting in blue). A value that isn't from today is replaced by the newest from the last week, labelled with its day ("from Wed 7 Oct").
- **Training status**: Garmin's status, acute load against the optimal range, and a four-week strip of daily statuses.
- **Load focus**: Garmin's four-week load in low aerobic, high aerobic and anaerobic against each optimal range, with what to train next.
- **Last activity**: name, time, place, training effect and its sport's key stats. With GPS, the route is drawn as a glowing line that replays once on load (skipped with reduced motion). Colors and basemaps per sport are in `ROUTE_STYLES` in `frontend/js/map.js`: orange on Esri grey by default, ice blue with hillshade for winter sports, aqua and magenta on dimmed satellite for open-water swims and disc golf.
- **Fitness and form**: fitness (CTL, 42-day weighted load) and fatigue (ATL, 7-day) on one chart; form is the gap as a % of fitness, named by band (Overloaded, Building, Balanced, Fresh, Rested), shaded blue where fitness leads and red where fatigue does. Last 120 days or the whole year.
- **Weekly running** (or your main sport): kilometres per week for 12 weeks, split by training effect, with the low aerobic share of the last 4 weeks. Other main sports show kilometres or hours. Click a week to see its activities.
- **VO2 max**: Garmin's estimate per week, against three and twelve months ago.
- **Training calendar**: 53 weeks, a square per day shaded by training load in four quartile steps; rest days grey. Hover for details, click to open the day's biggest activity. Above it: training days, days per week and longest streak.
- **Latest activities**: the 15 newest, with the **This week / This year** panel for your main sport.

### Workout

A chat at the top, then today's session and, below it, the training plan it comes from (or **+ Training plan** to start one).

#### Chat

Tell it what to change, as you would a coach: "I only have 40 minutes today", "move Thursday's intervals to Friday", "make today a ride instead". Claude (Sonnet) changes the sessions and lists each change under its answer; the workout and plan redraw at once.

- **Which Claude**: Claude Code on the machine running the server, covered by its Claude subscription. Install it and log in once (run `claude` in a terminal); the server finds it on PATH or in `~/.local/bin`. A reply takes about 10 seconds and counts toward the subscription's usage limits. With `ANTHROPIC_API_KEY` in `.env` the chat uses the Anthropic API instead: a few seconds a reply, about a cent or two a message, billed to the API account.

- **What it can do**: put a session on any day from today on (a standard one by kind and minutes, or its own steps), make a rest day, move a session to another day (leaving a rest day), and undo a change. With each message it gets today's numbers, the workouts, the plan's next three weeks and the last 14 days of activities.
- **Paces stay yours**: a changed session names its targets (easy, threshold, zone 2…) and gets the same paces as everything else, so a changed plan day still adapts. A moved session keeps the paces it had.
- **Where changes show**: today's run or ride, marked "Changed in chat" with the reason; plan days the same; later days outside a plan listed under today's workout. Changed plan days are left alone when a missed session moves. Nothing goes to the watch until you press Send.
- **One chat a day**, kept on the server so every device sees it. **New chat** starts over (the changes stay); **Undo all changes** takes back every change from today on.
- Claude Code keeps the day's conversation as a session run from `data/coach`, where it sees none of the project's files and has no tools of its own: it answers with a reply and the changes to make, which the server checks and carries out (telling it about any that fail).

Today's suggested session for running and cycling (the one you do most first), in steps like a Garmin workout: warm-up, the main set with its repeats and targets, cool-down. A bar shows its shape, each block as long as the step and as tall as it's hard. Under the title: total time, distance for runs, and what decided it.

- **Which session**: readiness under 25 or Overreaching gives a recovery session; readiness under 50 or a hard session yesterday or today gives an easy one. Otherwise the load focus decides: short on high aerobic gives threshold intervals (VO2 max intervals if you've done threshold in the last week), short on anaerobic gives anaerobic repeats, short on low aerobic a long session. Balanced gives threshold every third day or so. In the 10 days before a race goal the volume drops by 30%, and the last 2 days are a shakeout.
- **How long**: your median session for that sport over the last 60 days (45 min run, 75 min ride without any); long sessions are 1.4 times that.
- **Targets**: run paces as a share of Garmin's lactate threshold pace (easy 74–82%, threshold 97–101%), intervals off Garmin's predicted 5 km pace. Without a threshold it's estimated from the 5 km prediction. Rides use Garmin's heart rate zones (from `MAX_HR` until they're synced).
- **Send to watch**: puts the workout in today's Garmin Connect calendar; the watch has it after its next sync. Nothing is ever sent unless you press it. If the suggestion has changed since the page loaded, it asks you to look again first. The button then shows it's sent for the rest of the day.
- **With a training plan** the run is the plan's session for today, or a rest day with the next session. A low readiness or Overreaching adds a note but doesn't change the session. Cycling is unchanged.

#### Training plan

A running plan toward a race or general fitness, set up with **+ Training plan** under today's workout. You pick the race day (or end date), the distance, an optional target time, the run days, the long-run day and your current km a week (prefilled from the last 4 weeks). A race plan also sets the race goal; without a target time the projection is used.

- **Header**: the projected time on race day as a range with its pace, the target, and how far the projection has moved since the start. Below it, a chart of the projection per week against the target.
- **This week**: each session with its distance, time and main pace. Click one to see its steps. Done sessions show the run's pace and whether it was faster, on plan or slower; missed ones are crossed out.
- **All weeks**: phase, km done / planned and the key sessions, each week opening its sessions.
- **Send week to watch**: puts the next 7 days in the Garmin calendar. If paces have adapted since, pressing it again replaces the changed sessions on Garmin. Nothing is ever sent unless you press it.
- **Edit** keeps the plan's start and history; **End plan** removes it (the race goal stays).

### Health

- **Today**: HRV, sleep, resting HR, Body Battery peak and low, average stress, steps and calories burnt so far. (Readiness is a training number, so it's on the overview.)
- **Charts** for the last 90 days or year, one measure each: HRV against Garmin's normal range, resting HR, sleep, sleep score, Body Battery (daily low to high), stress, steps and calories burnt (active and resting split in the tooltip). Sleep score, steps and calories show a 7-day average line; steps and calories also the best day. HRV, resting HR, sleep, sleep score, steps and calories each get a sentence comparing the last 7 days with the 30 before.

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
- **The plan**: the weeks split into base, build, peak and a taper (1 week for 5–10 km, 2 for the half, 3 for the marathon; a fitness plan has none). Volume climbs at most 8% a week from your current km toward 1.3–1.7 times it (by distance), every 4th week is 25% lighter, and the taper drops to 75/60/45% of the peak. The long run is about 30% of the week; one hard session a week in base and taper, two in build and peak with 4 or more days (threshold, VO2 max, race pace for the half and longer), kept away from the long run. The last two plan days before the race are shakeouts.
- **Plan paces** are Workout's paces from a threshold speed that starts at Garmin's lactate threshold and is planned to rise 0.5% a week (8% at most, plus 1.5% from the taper). How the runs go moves it: interval runs by the pace of their work laps against the target (when run as the plan's workout, so the laps match the steps; faster at a heart rate above zone 4 doesn't count), easy and long runs by pace at their heart rate against your easy runs in the 60 days before the plan. Each run moves it 30% of the way (15% for easy runs), less than 1% off counts as on plan, and it moves at most 1.5% a week. The projection is that threshold on race day as a 5 km time, scaled to the distance like the race goal, ±1% plus 0.15% per week to go.
- **Missed sessions**: a run on the planned day or a day either side counts. A hard or long session missed this week moves to the next easy day from today, which is dropped; a missed easy run is just missed.
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
- **Lactate threshold and heart rate zones**, for the workout targets: once a day.
- **Laps of the plan's runs**, so the plan sees how intervals went: 20 per sync.
- **Routes** for the 5 newest activities are fetched during the sync; any other activity's route and laps are fetched when first opened.
- **Running bests** are processed 40 runs per sync, newest first.

## Login

With `DASHBOARD_PASSWORD` set, the dashboard opens with a login page (also asking for `DASHBOARD_USERNAME` if set). A device stays logged in for a year; **Log out** in the menu ends it. Wrong tries are answered after a second to slow guessing. The password travels unencrypted over plain HTTP on your wifi (not through `tailscale serve`, which encrypts it), so don't reuse an important one. Changing either setting logs everyone out.

## On your phone, away from home

[Tailscale](https://tailscale.com) connects the phone to the server PC from anywhere, encrypted. Install it on both and log in with the same account. On the PC, run once:

```
tailscale serve --bg 8000
```

This gives the dashboard an https address, `https://<pc-name>.<tailnet>.ts.net`, which `tailscale serve status` shows. The first time, it links to the Tailscale admin page where you turn on HTTPS certificates. The address keeps working after restarts.

Open the address in Chrome or Samsung Internet on the phone and choose **Install app** (or **Add to home screen** → **Install**). It then opens as its own app, with its own icon and no address bar. Installing only works over https, so a plain `http://100.x.x.x:8000` address gives a browser shortcut instead.

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
| `ANTHROPIC_API_KEY` | empty | The workout chat uses the Anthropic API (billed per message) instead of Claude Code |
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
│   ├── workouts.py       # Today's suggested workout, and Garmin's workout format for Send to watch
│   ├── plans.py          # The training plan: weeks, sessions, adaptation and projection
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
│   ├── manifest.json     # Name, icon and full screen when installed as a phone app
│   ├── sw.js             # Service worker, served at /sw.js; what makes the app installable
│   ├── icons/            # App icon: icon.svg, rendered to icon-192.png and icon-512.png
│   ├── js/               # ES modules, loaded from main.js
│   │   ├── main.js       # Loads and refreshes data, routes between pages
│   │   ├── theme.js      # Light or dark (plain script, runs before the page draws)
│   │   ├── state.js      # Shared dashboard data
│   │   ├── util.js       # Formatting helpers
│   │   ├── charts.js     # Chart.js setup
│   │   ├── map.js        # Route maps and replay
│   │   ├── sports.js     # Sport groups, table columns, weekly volume, This week / This year
│   │   ├── overview.js
│   │   ├── workout.js    # Today's workout and Send to watch
│   │   ├── plan.js       # Training plan (on the workout page), its setup and Send week
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

Database tables of note: `daily` (health numbers and race predictions), `tracks` and `laps` (routes), `efforts` (running bests), `meta` (race goal, training plan, training profile, workouts sent, plan sessions sent, backfill progress).

## Tests

```bash
.venv\Scripts\python -m unittest discover tests
```

`test_metrics.py` checks the numbers (best efforts, race predictions, form, training load, sports, VO2 max). `test_workouts.py` checks which session is picked, its targets and Garmin's workout format. `test_plans.py` checks the plan's phases, volume, session days, adaptation, reshuffling and projection. `test_sync.py` runs the sync against a stand-in for Garmin on a throwaway database (the daily recheck for edits and deletions, and rate-limit handling).

## Troubleshooting

- **"Not logged in to Garmin"**: run `backend/login.py` on the machine running the server. Tokens expire eventually.
- **"Too many requests" / 429**: Garmin is rate-limiting. Wait and sync again; it resumes where it stopped.
- **Logged out on every device**: `DASHBOARD_PASSWORD` or `DASHBOARD_USERNAME` changed; log in with the new details.
- **Can't open it from a phone**: check `HOST=0.0.0.0`, that both devices are on the same network, and that the Windows firewall allows Python.
- **Tailscale says "State store failed to initialize … TPM"**: its saved login can't be read anymore (often after a BIOS or Windows update). In an administrator PowerShell: `Stop-Service Tailscale; Rename-Item C:\ProgramData\Tailscale\server-state.conf server-state.conf.bak; Start-Service Tailscale; tailscale up`, then log in again.
- **Desktop app says "Can't reach the dashboard"**: the server at `DASHBOARD_URL` isn't running, the address is wrong, or a firewall blocks it. For a server the app started itself, see `data/desktop.log`.
- **Start over**: stop the server and delete `data/athlete.db`. The next sync backfills again.
