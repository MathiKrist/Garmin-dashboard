const $ = (id) => document.getElementById(id);
const charts = {};
let data = null;
let pollTimer = null;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtDayYear = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtShort =(iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const round = (v, d = 0) => (v == null ? null : Number(v).toFixed(d));

function fmtDuration(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtPace(sPerKm) {
  if (!sPerKm) return "";
  const m = Math.floor(sPerKm / 60), s = Math.round(sPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}
function fmtSleep(s) {
  if (!s) return null;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return `${h}<span>h</span> ${m}<span>min</span>`;
}

let lastJson = "";
async function load() {
  const res = await fetch("/api/dashboard");
  const text = await res.text();
  if (text !== lastJson) {  // skip redrawing the charts when nothing changed
    lastJson = text;
    data = JSON.parse(text);
    render();
  }
  clearTimeout(pollTimer);
  if (data.syncing) pollTimer = setTimeout(load, 5000);
}

function render() {
  $("demo").hidden = !data.demo;
  const btn = $("syncBtn");
  btn.disabled = data.syncing || data.demo;
  btn.textContent = data.syncing ? "Syncing…" : "Sync now";
  $("synced").textContent = data.meta.last_sync_at
    ? "Synced " + new Date(data.meta.last_sync_at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : "Not synced yet";

  const notice = $("notice");
  if (data.meta.last_error) {
    notice.className = "notice";
    notice.textContent = `Last sync failed: ${data.meta.last_error}`;
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  if (!data.has_data) {
    $("main").hidden = true;
    $("nav").hidden = true;
    $("empty").hidden = false;
    if (!data.syncing && !data.meta.last_sync_at) $("emptyText").textContent =
      "Nothing synced yet. Run python backend/login.py on the server machine if you haven't, then press Sync now.";
    return;
  }
  $("empty").hidden = true;
  $("main").hidden = false;
  $("nav").hidden = false;
  renderNav();
  showPage();
}

// ---- Pages: the menu on the left picks one, kept in the address (#overview, #health, #activities, #sport/run)

const PAGES = { overview: renderOverview, health: renderHealth, activities: renderActivities };
function route() {
  const [page, key] = location.hash.slice(1).split("/");
  if (page === "sport" && hasPage(key)) return { page: "sport", key, id: `sport/${key}` };
  return PAGES[page] ? { page, id: page } : { page: "overview", id: "overview" };
}

let shownPage = "";
function showPage() {
  const r = route();
  // Show the page before drawing it, so its charts are drawn at their real size
  document.querySelectorAll(".page").forEach((el) => { el.hidden = el.id !== `page-${r.page}`; });
  document.querySelectorAll("#nav a").forEach((a) => {
    if (a.dataset.page === r.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (r.page !== "overview") lastMap.stop();
  if (r.page === "sport") renderSport(r.key); else PAGES[r.page]();
  const title = r.page === "sport" ? sportLabel(r.key) : $(`page-${r.page}`).dataset.title;
  document.title = r.page === "overview" ? "Training" : `${title} · Training`;
  if (r.id !== shownPage) {  // a new page starts at the top; a background refresh of the same page keeps its place
    if (shownPage) scrollTo(0, 0);
    shownPage = r.id;
  }
}
addEventListener("hashchange", () => { if (data?.has_data) showPage(); });

function sportCounts() {
  const counts = {};
  data.activities.forEach((a) => { counts[a.sport] = (counts[a.sport] || 0) + 1; });
  return counts;
}
// The sports you have, most-used first, "Other" always last: [[key, label], ...]
function sportsByCount(counts = sportCounts()) {
  return SPORTS.filter(([key]) => counts[key])
    .sort((a, b) => (a[0] === "other") - (b[0] === "other") || counts[b[0]] - counts[a[0]]);
}
const sportLabel = (key) => SPORTS.find(([k]) => k === key)?.[1] || "Other";
// Sports with a page of their own: done at least 3 times, and with something to follow over time. One-offs, Other
// (a mix of types) and disc golf (Garmin keeps no scores) stay in the activities list instead.
const NO_PAGE = ["other", "disc_golf"];
const hasPage = (key, counts = sportCounts()) => counts[key] >= 3 && !NO_PAGE.includes(key);
// The sport's color in the menu and on its page (sports without one use the neutral grey)
const sportColor = (key) => css(`--sp-${key}`) || css("--nohr");

function renderNav() {
  const counts = sportCounts(), sports = sportsByCount(counts).filter(([key]) => hasPage(key, counts));
  $("navActCount").textContent = data.activities.length;
  $("navSportsLabel").hidden = !sports.length;
  $("navSports").innerHTML = sports.map(([key, label]) => `<li><a href="#sport/${key}" data-page="sport/${key}">
    <span class="label"><i class="swatch" style="background:${sportColor(key)}"></i>${label}</span><span class="count">${counts[key]}</span></a></li>`).join("");
}

// ---- Overview: the athlete's story, then the big picture

function renderOverview() {
  renderStory();
  renderRace();
  renderHero();
  renderTrainingStatus();
  renderLastActivity();
  renderFitnessCharts();
  const t = tableParts(data.activities.slice(0, 15), "all");
  $("recentHead").innerHTML = t.head;
  $("recentBody").innerHTML = t.body;
  // Your main sport (the one you do most): its weekly chart, and this week and this year next to the activities
  const main = sportsByCount().find(([key]) => key !== "other")?.[0];
  $("weeklySection").hidden = $("ovVolume").hidden = !main;
  if (!main) return;
  const list = data.activities.filter((a) => a.sport === main), m = measureFor(list);
  $("weeklyTitle").textContent = `Weekly ${sportLabel(main).toLowerCase()}`;
  $("weeklySub").textContent = main === "run" ? lowShare(list) : "";
  weeklyChart("weeklyChart", "weeklyLegend", main, list, weekStarts(12), m);
  renderVolume($("ovVolume"), list, sportLabel(main), main);
}

// What each sport's activities are called in a sentence
const SPORT_NOUNS = {
  run: ["run", "runs"], bike: ["ride", "rides"], walk: ["walk", "walks"], hike: ["hike", "hikes"], swim: ["swim", "swims"],
  strength: ["strength session", "strength sessions"], cardio: ["cardio session", "cardio sessions"],
  disc_golf: ["round of disc golf", "rounds of disc golf"], yoga: ["yoga session", "yoga sessions"],
  winter: ["day on snow", "days on snow"], other: ["other activity", "other activities"],
};
const plural = (n, [one, many]) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;
const sum = (as, f) => as.reduce((t, a) => t + (a[f] || 0), 0);
const between = (list, from, to) => list.filter((a) => a.date >= from && a.date < to);
const fmtKm = (v) => (v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1));

// Every run's personal best events, oldest first: [{m, s, a}] whenever a run beat the best so far over a distance.
// A distance's first time doesn't count, as there was nothing to beat.
function pbEvents() {
  const best = {}, events = [];
  data.activities.filter((a) => a.sport === "run" && a.best).slice().reverse().forEach((a) => {
    Object.entries(a.best).forEach(([m, s]) => {
      if (!(m in BEST_LABELS)) return;
      if (best[m] != null && s < best[m]) events.push({ m, s, a });
      if (best[m] == null || s < best[m]) best[m] = s;
    });
  });
  return events;
}
const pbText = (e) => `${BEST_LABELS[e.m]} in ${fmtDuration(e.s)}`;
const listText = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);

// A few sentences on where the athlete stands, led by Garmin's training status: what it means, VO2 max,
// personal bests, the year so far and the recent trend in training hours
function renderStory() {
  const parts = [], today = data.generated, ts = data.training_status;
  if (ts) parts.push(`Garmin rates your training as <strong>${ts.label.toLowerCase()}</strong>${ts.since ? ` since ${fmtShort(ts.since)}` : ""}.`);
  const v = data.vo2max;
  if (v) {
    const diff = v.ago_3m != null ? Math.round((v.now - v.ago_3m) * 10) / 10 : 0;
    parts.push(`VO2 max is ${round(v.now, 1)}${Math.abs(diff) >= 0.5 ? `, ${diff > 0 ? "up" : "down"} ${Math.abs(diff).toFixed(1)} in three months` : ""}.`);
  }
  // Personal bests from the last four weeks, or else the latest one
  const pbs = pbEvents(), recent = pbs.filter((e) => e.a.date > addDays(today, -28));
  if (recent.length) {
    // One per distance: the newest
    const latest = Object.values(Object.fromEntries(recent.map((e) => [e.m, e])));
    parts.push(`<strong>New personal best${latest.length > 1 ? "s" : ""}</strong> in the last four weeks: ${listText(latest.map((e) => `${pbText(e)} (${fmtShort(e.a.date)})`))}.`);
  } else if (pbs.length) {
    const e = pbs[pbs.length - 1];
    parts.push(`Your latest personal best is ${pbText(e)}, on ${fmtShort(e.a.date)} ${e.a.date.slice(0, 4)}.`);
  }
  // The year so far: the three sports with the most hours
  const year = data.activities.filter((a) => a.date.startsWith(today.slice(0, 4)));
  const bySport = sportsByCount().map(([key]) => [key, year.filter((a) => a.sport === key)])
    .filter(([, as]) => as.length).sort((a, b) => sum(b[1], "duration_s") - sum(a[1], "duration_s")).slice(0, 3);
  if (bySport.length) {
    parts.push(`So far this year: ${listText(bySport.map(([key, as]) => {
      const km = sum(as, "km");
      return `${plural(as.length, SPORT_NOUNS[key])} (${km > 0 ? `${fmtKm(km)} km` : fmtHours(sum(as, "duration_s"))})`;
    }))}.`);
  }
  // Training hours per week, last 4 weeks against the 4 before
  const now4 = sum(between(data.activities, addDays(today, -27), addDays(today, 1)), "duration_s") / 4;
  const before4 = sum(between(data.activities, addDays(today, -55), addDays(today, -27)), "duration_s") / 4;
  if (now4 && before4) {
    const change = Math.round((now4 - before4) / before4 * 100);
    parts.push(`Over the last four weeks you've trained ${fmtHours(now4)} a week${Math.abs(change) >= 5
      ? `, ${change > 0 ? "up" : "down"} from ${fmtHours(before4)} the four weeks before` : ", about the same as the four weeks before"}.`);
  }
  $("story").innerHTML = parts.join(" ");
}

const mondayOf = (iso) => addDays(iso, -((new Date(iso + "T12:00:00").getDay() + 6) % 7));
// Mondays of the `n` weeks up to the week of `end` (today by default)
const weekStarts = (n, end = data.generated) => [...Array(n)].map((_, i) => addDays(mondayOf(end), -7 * (n - 1 - i)));

function stackedBarOptions(tooltip) {
  const o = baseOptions();
  o.scales.x.stacked = o.scales.y.stacked = true;
  o.plugins.tooltip.callbacks = tooltip;
  return o;
}
// Bars rounded at the top, with a thin line of page color between stacked segments
const barStyle = () => ({ borderRadius: 2, borderSkipped: "bottom", borderWidth: { top: 2 }, borderColor: css("--paper"), maxBarThickness: 34 });

// The share of the last 4 weeks' running kilometres that Garmin rated low aerobic, as a sentence
function lowShare(runs) {
  const recent = runs.filter((a) => a.date > addDays(data.generated, -28));
  const low = sum(recent.filter((a) => a.focus === "low"), "km"), known = sum(recent.filter((a) => a.focus), "km");
  return known ? `Last 4 weeks: ${Math.round(low / known * 100)}% low aerobic.` : "";
}

// Volume per week in `canvas` (km or hours, by `m`); runs are split by Garmin's training effect, like the load focus
function weeklyChart(canvas, legend, key, list, starts, m) {
  const val = (as) => (m.byKm ? +sum(as, "km").toFixed(1) : +(sum(as, "duration_s") / 3600).toFixed(2));
  const inWeek = (w) => list.filter((a) => mondayOf(a.date) === w);
  const fmt = (v) => (m.byKm ? `${v} km` : fmtHours(v * 3600));
  let sets;
  if (key === "run") {
    sets = FOCUS.map(([f, name, color]) => ({ label: name, data: starts.map((w) => val(inWeek(w).filter((a) => a.focus === f))), backgroundColor: css(color) }));
    const unknown = starts.map((w) => val(inWeek(w).filter((a) => !a.focus)));
    if (unknown.some(Boolean)) sets.push({ label: "Unknown", data: unknown, backgroundColor: css("--nohr") });
  } else {
    sets = [{ label: sportLabel(key), data: starts.map((w) => val(inWeek(w))), backgroundColor: sportColor(key) }];
  }
  // A single series needs no legend: the title names it
  $(legend).innerHTML = sets.length > 1 ? sets.map((x) => `<span><i style="background:${x.backgroundColor}"></i>${x.label}</span>`).join("") : "";
  $(canvas).setAttribute("aria-label", `${m.unit} of ${sportLabel(key).toLowerCase()} per week, last ${starts.length} weeks`);
  draw(canvas, {
    type: "bar",
    data: { labels: starts.map((w) => fmtShort(w)), datasets: sets.map((x) => ({ ...x, ...barStyle() })) },
    options: stackedBarOptions({
      title: (items) => `Week of ${fmtShort(starts[items[0].dataIndex])}`,
      label: (c) => (c.parsed.y ? ` ${c.dataset.label}: ${fmt(c.parsed.y)}` : null),
      footer: (items) => {
        const as = inWeek(starts[items[0].dataIndex]);
        return as.length ? `${plural(as.length, SPORT_NOUNS[key])}, ${fmtHours(sum(as, "duration_s"))}` : "";
      },
    }),
  });
}

// ---- Race goal: target, Garmin's prediction and how far apart they are; the result after race day

const RACE_DISTANCES = { 5000: "5 km", 10000: "10 km", 21098: "Half marathon", 42195: "Marathon" };
const raceDistance = (m) => RACE_DISTANCES[m] || `${+(m / 1000).toFixed(2)} km`;
// "50:00" or "1:45:00" -> seconds
function parseTime(text) {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number).reduce((t, v) => t * 60 + v, 0) || null;
}

function renderRace() {
  const r = data.race;
  $("race").hidden = !r;
  $("raceAdd").hidden = !!r;
  if (!r) return;
  const pace = (sec) => fmtPace(sec / r.metres * 1000);
  const d = r.days_to_go;
  $("raceWhen").textContent = [fmtDayYear(r.date), raceDistance(r.metres),
    d > 1 ? `${d} days to go` : d === 1 ? "Tomorrow" : d === 0 ? "Today" : null].filter(Boolean).join(" · ");
  $("raceName").textContent = r.name;
  const items = [["Target", fmtDuration(r.target_s), pace(r.target_s)]];
  if (r.result) {
    // After race day: the time, over or under the target
    const gap = r.result.s - r.target_s;
    items.push(["Result", fmtDuration(r.result.s),
      `<span class="${gap > 0 ? "over" : "under"}">${gap > 0 ? "+" : "−"}${fmtDuration(Math.abs(gap)) || "0:00"}</span> vs target`]);
  } else if (r.predicted_s) {
    const gap = r.predicted_s - r.target_s;
    items.push(["Garmin predicts", fmtDuration(r.predicted_s), pace(r.predicted_s)],
      ["Gap", gap > 0 ? fmtDuration(gap) : "On target", gap > 0 ? "to find" : ""]);
  }
  $("raceStats").innerHTML = statItems(items);

  const h = r.history;
  $("raceTrend").hidden = h.length < 2;
  if (h.length < 2) return;
  const fit = css("--fitness"), ink = css("--ink");
  const o = baseOptions({
    // Faster is higher, so the prediction climbs toward the target as you get fitter
    y: { reverse: true, grid: { color: css("--rule") }, ticks: { color: css("--muted"), callback: (v) => fmtDuration(v) }, border: { display: false },
      suggestedMin: Math.min(r.target_s, ...h.map((x) => x.s)) - 30, suggestedMax: Math.max(r.target_s, ...h.map((x) => x.s)) + 30 },
  });
  o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${fmtDuration(c.parsed.y)}` };
  draw("raceChart", {
    type: "line",
    data: {
      labels: h.map((x) => fmtShort(x.date)),
      datasets: [
        { label: "Garmin predicts", data: h.map((x) => x.s), borderColor: fit, backgroundColor: fit, borderWidth: 2, tension: 0.3,
          pointRadius: h.map((_, i) => (i === h.length - 1 ? 4 : 0)) },
        { label: "Target", data: h.map(() => r.target_s), borderColor: ink, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0 },
      ],
    },
    options: o,
  });
}

const raceDialog = $("raceDialog");
function openRaceForm() {
  const r = data.race;
  $("raceInName").value = r?.name || "";
  $("raceInDate").value = r?.date || "";
  const preset = r && RACE_DISTANCES[r.metres] ? String(r.metres) : r ? "custom" : "10000";
  $("raceInDist").value = preset;
  $("raceInKm").value = preset === "custom" ? +(r.metres / 1000).toFixed(2) : "";
  $("raceInKmWrap").hidden = preset !== "custom";
  $("raceInTime").value = r ? fmtDuration(r.target_s) : "";
  $("raceRemove").hidden = !r;
  $("raceError").hidden = true;
  raceDialog.showModal();
}
async function raceRequest(method, body) {
  const res = await fetch("/api/race", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (res.status === 404 || res.status === 405) throw new Error("The dashboard server is older than this page. Restart it, then try again.");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save the race goal.");
  raceDialog.close();
  lastJson = "";  // redraw even though only the goal changed
  await load();
}
const raceFail = (e) => { $("raceError").textContent = e.message; $("raceError").hidden = false; };
$("raceAdd").addEventListener("click", openRaceForm);
$("raceEdit").addEventListener("click", openRaceForm);
$("raceCancel").addEventListener("click", () => raceDialog.close());
$("raceInDist").addEventListener("change", () => { $("raceInKmWrap").hidden = $("raceInDist").value !== "custom"; });
$("raceRemove").addEventListener("click", () => raceRequest("DELETE").catch(raceFail));
$("raceForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const dist = $("raceInDist").value, metres = dist === "custom" ? Number($("raceInKm").value) * 1000 : Number(dist);
  const target = parseTime($("raceInTime").value);
  if (!metres) return raceFail(new Error("Enter the distance in kilometres."));
  if (!target) return raceFail(new Error("Enter the target time as minutes:seconds or hours:minutes:seconds."));
  raceRequest("POST", { name: $("raceInName").value, date: $("raceInDate").value, metres, target_s: target }).catch(raceFail);
});

// Garmin's own colors per status
const STATUS_COLORS = {
  PEAKING: "--st-peaking", PRODUCTIVE: "--st-productive", MAINTAINING: "--st-maintaining",
  RECOVERY: "--st-recovery", UNPRODUCTIVE: "--st-unproductive", STRAINED: "--st-strained",
  OVERREACHING: "--st-overreaching", DETRAINING: "--st-detraining",
};
const statusColor = (code) => `var(${STATUS_COLORS[code] || "--nohr"})`;
const statusLabel = (code) => code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ") : "No data";

// Garmin's load focus groups: [key, label, color token]
const FOCUS = [["low", "Low aerobic", "--low-aerobic"], ["high", "High aerobic", "--high-aerobic"], ["anaerobic", "Anaerobic", "--anaerobic"]];

function renderLoadFocus() {
  const lf = data.load_focus;
  $("focus").hidden = !lf;
  if (!lf) return;
  $("focusTitle").textContent = lf.title;
  const zoneColor = (key) => FOCUS.find((f) => f[0] === key)?.[2];
  $("focusTitle").style.setProperty("--focus-color", lf.zone ? `var(${zoneColor(lf.zone)})` : "var(--ink)");
  $("focusAdvice").textContent = lf.advice;
  // One shared scale, so the bars compare across zones
  const top = Math.max(...lf.zones.flatMap((z) => [z.value || 0, z.max || 0])) * 1.08 || 1;
  const pct = (v) => `${(v / top) * 100}%`;
  $("focusRows").innerHTML = lf.zones.map((z) => {
    const v = z.value || 0;
    const state = z.min == null ? "" : v < z.min ? "Below" : v > z.max ? "Above" : "In range";
    const range = z.min == null ? "" : `<i class="range" style="left:${pct(z.min)};width:${pct(z.max - z.min)}"></i>`;
    const tip = z.min == null ? "" : ` (optimal ${Math.round(z.min)}–${Math.round(z.max)})`;
    return `<div class="frow" title="${z.label}: ${Math.round(v)}${tip}">
      <span>${z.label}</span><span class="fval">${Math.round(v)}</span>
      <div class="track">${range}<i class="fill" style="width:${pct(v)};background:var(${zoneColor(z.key)})"></i></div>
      <span class="fstate">${state}</span></div>`;
  }).join("");
}

function renderTrainingStatus() {
  const ts = data.training_status;
  $("tstatus").hidden = !ts && !data.load_focus;
  $("tsMain").hidden = !ts;
  renderLoadFocus();
  if (!ts) return;
  $("tsLabel").textContent = ts.label;
  $("tsLabel").style.setProperty("--status-color", statusColor(ts.code));
  $("tsSince").textContent = ts.since ? `since ${fmtDay(ts.since)}` : "";

  const facts = [];
  if (ts.acute_load != null) {
    let load = `Acute load ${Math.round(ts.acute_load)}`;
    if (ts.acute_min != null && ts.acute_max != null) load += ` (optimal ${Math.round(ts.acute_min)}–${Math.round(ts.acute_max)})`;
    if (ts.acwr_status) load += `, ${ts.acwr_status.toLowerCase().replace(/_/g, " ")}`;
    facts.push(load);
  }
  if (ts.vo2max != null) facts.push(`VO2 max ${round(ts.vo2max)}`);
  $("tsFacts").textContent = facts.join(" · ");

  // The last 28 days in blocks of 7, counted back from today
  const weeks = [0, 7, 14, 21].map((i) => ts.history.slice(i, i + 7));
  $("tsWeeks").innerHTML = weeks.map((week, w) => {
    const days = week.map((d) => {
      const style = d.status ? ` style="background:${statusColor(d.status)}"` : "";
      return `<i class="${d.date === data.generated ? "today" : ""}"${style} title="${fmtDay(d.date)}: ${statusLabel(d.status)}"></i>`;
    }).join("");
    const label = w === 3 ? "Last 7 days" : `${fmtShort(week[0].date)} – ${fmtShort(week[6].date)}`;
    return `<div class="week"><div class="days">${days}</div><span>${label}</span></div>`;
  }).join("");
  $("tsWeeks").setAttribute("aria-label", "Training status per day, last 4 weeks: " +
    ts.history.filter((d) => d.status).map((d) => `${fmtShort(d.date)} ${statusLabel(d.status)}`).join(", "));

  const seen = Object.keys(STATUS_COLORS).filter((code) => ts.history.some((d) => d.status === code));
  $("tsLegend").innerHTML = seen.map((code) => `<span><i style="background:${statusColor(code)}"></i>${statusLabel(code)}</span>`).join("");
}

const FORM_COLORS = { Rested: "--hard", Fresh: "--easy", Balanced: "--nohr", Building: "--fitness", Overloaded: "--fatigue" };

// One plain-language sentence on the fitness trend over the last four weeks.
function fitnessReading(f) {
  const fx = data.fitness;
  if (f.ctl < 5 || fx.length < 29) return "";
  const now = Math.round(f.ctl), before = Math.round(fx[fx.length - 29].ctl);
  const change = Math.round((now - before) / before * 100);
  if (Math.abs(change) < 3) return `Fitness ${now}, about the same as four weeks ago.`;
  return `Fitness ${now}, ${change > 0 ? "up" : "down"} from ${before} four weeks ago (${change > 0 ? "+" : ""}${change}%).`;
}

function renderHero() {
  const f = data.form, t = data.today;
  $("state").textContent = f.pct != null ? `${f.state} (${f.pct > 0 ? "+" : ""}${Math.round(f.pct)}%)` : f.state;
  $("state").style.setProperty("--state-color", `var(${FORM_COLORS[f.state] || "--ink"})`);
  $("fitnessReading").textContent = fitnessReading(f);

  $("today").innerHTML = statItems(todayItems().slice(0, 4));
}

// Garmin's readiness and stress levels
const readinessLevel = (v) => (v >= 95 ? "Prime" : v >= 75 ? "High" : v >= 50 ? "Moderate" : v >= 25 ? "Low" : "Poor");
const stressLevel = (v) => (v > 75 ? "High" : v > 50 ? "Medium" : v > 25 ? "Low" : "Resting");

// Last night and today: [label, value, note]; the first four are the overview's, the health page shows them all
function todayItems() {
  const t = data.today;
  let hrvNote = "";
  if (t.hrv_last_night != null && t.hrv_low != null && t.hrv_high != null) {
    hrvNote = t.hrv_last_night < t.hrv_low ? "Below your range" : t.hrv_last_night > t.hrv_high ? "Above your range" : "In your normal range";
  }
  return [
    ["Readiness", t.readiness != null ? round(t.readiness) : null, t.readiness != null ? readinessLevel(t.readiness) : ""],
    ["HRV last night", t.hrv_last_night != null ? `${round(t.hrv_last_night)}<span>ms</span>` : null, hrvNote],
    ["Sleep", fmtSleep(t.sleep_s), t.sleep_score != null ? `Score ${round(t.sleep_score)}` : ""],
    ["Resting HR", t.resting_hr != null ? `${round(t.resting_hr)}<span>bpm</span>` : null, t.resting_hr_7d != null ? `7-day avg: ${t.resting_hr_7d} bpm` : ""],
    ["Body Battery peak", t.bb_high != null ? round(t.bb_high) : null, t.bb_low != null ? `Lowest ${round(t.bb_low)}` : ""],
    ["Average stress", t.stress_avg != null ? round(t.stress_avg) : null, t.stress_avg != null ? stressLevel(t.stress_avg) : ""],
    ["Steps today", t.steps != null ? Math.round(t.steps).toLocaleString("en-GB") : null, ""],
  ].filter((i) => i[1] != null);
}
const statItems = (items) => items
  .map(([label, val, note]) => `<div><dd>${val}</dd><dt>${label}${note ? `<span class="note">${note}</span>` : ""}</dt></div>`).join("");

// The newest activity at the top: name, when, the sport's stats, and its route on a map when it has GPS
function renderLastActivity() {
  const a = data.last_activity;
  $("lastAct").hidden = !a;
  if (!a) return;
  const days = Math.round((new Date(data.generated + "T12:00:00") - new Date(a.date + "T12:00:00")) / 864e5);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : COLUMNS.date[2](a);
  $("lastWhen").textContent = ["Last activity", `${day}${a.start ? `, ${a.start.slice(11, 16)}` : ""}`, a.location].filter(Boolean).join(" · ");
  $("lastName").textContent = a.name || a.type.replace(/_/g, " ");
  $("lastEffect").innerHTML = effectCell(a);
  $("lastEffect").hidden = !$("lastEffect").innerHTML;
  $("lastStats").innerHTML = headlineStats(a);
  lastMap.show(a.track, a.name || "last activity", a.sport);
}

// The sport's table columns minus ascent and load, with the unit set small ("5.08 km" -> 5.08 <span>km</span>)
function headlineStats(a) {
  return (SPORT_COLUMNS[a.sport] || SPORT_COLUMNS.other)
    .filter((key) => !["date", "name", "effect", "ascent", "load"].includes(key))
    .map((key) => [COLUMNS[key][0], String(COLUMNS[key][2](a))])
    .filter(([, v]) => v !== "")
    .map(([label, v]) => `<div><dd>${v.replace(/\s(\S*[a-z]\S*)$/i, "<span>$1</span>")}</dd><dt>${label}</dt></div>`)
    .join("");
}

// Esri's muted grey basemaps (no API key needed), so the route is what stands out; light or dark to match the page
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{z}/{y}/{x}";
const TILES = ESRI.replace("{service}", "Canvas/World_{style}_Gray_Base");
// Terrain shading laid over the grey map (blended in index.html); "" or "_Dark" to match the page
const HILLSHADE = ESRI.replace("{service}", "Elevation/World_Hillshade{shade}");
const SATELLITE = ESRI.replace("{service}", "World_Imagery");

// Sports with their own route color (a CSS variable), pale core and map; everything else is orange on the grey map
const ROUTE_STYLES = {
  winter: { color: "--route-winter", core: "#EAFBFF", map: "hillshade" },  // shading shows the slopes
  swim: { color: "--route-swim", core: "#E2FCFF", map: "satellite" },  // the water and shoreline
  disc_golf: { color: "--route-disc", core: "#FFE0F4", map: "satellite" },  // fairways and tree lines
};
const DEFAULT_ROUTE = { color: "--route", core: "#FFE0B0", map: "grey" };

// A glowing route map in `el`; show(track, name, sport) draws a route (hiding the map when there's no GPS) and replays it once
function routeMap(el) {
  let map = null, layers = null, route = null, stopReplay = null;
  const fitRoute = () => {
    map.invalidateSize();
    map.fitBounds(route.getBounds(), { padding: [24, 24], animate: false });
  };
  // The sport's map: grey, grey with hillshade, or satellite, in the page's light or dark style
  function setBase(kind, dark) {
    const { grey, hillshade, satellite } = layers;
    const wanted = kind === "satellite" ? [satellite] : kind === "hillshade" ? [grey, hillshade] : [grey];
    [grey, hillshade, satellite].forEach((l) => { if (!wanted.includes(l)) l.remove(); });
    const style = dark ? "Dark" : "Light", shade = dark ? "_Dark" : "";
    if (grey.options.style !== style) { grey.options.style = style; grey.redraw(); }
    if (hillshade.options.shade !== shade) { hillshade.options.shade = shade; hillshade.redraw(); }
    wanted.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
  }
  function show(track, name, sport) {
    el.hidden = !(track?.length > 1 && window.L);  // no GPS, or Leaflet didn't load
    if (el.hidden) return;
    const look = ROUTE_STYLES[sport] || DEFAULT_ROUTE;
    if (!map) {
      map = L.map(el, { scrollWheelZoom: false, attributionControl: false });
      // The panel settles its size after the map is made (fonts load, the map stretches to the status column,
      // the popup opens), so refit the whole route whenever the map's size changes
      new ResizeObserver(() => { if (route && el.offsetHeight) fitRoute(); }).observe(el);
      L.control.attribution({ prefix: false }).addTo(map);
      layers = {
        grey: L.tileLayer(TILES, {
          style: "", maxZoom: 16,  // Esri's grey canvas stops at zoom 16
          attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
        }),
        hillshade: L.tileLayer(HILLSHADE, { shade: null, maxZoom: 16, className: "tiles-hillshade", attribution: "Esri, USGS" }),
        satellite: L.tileLayer(SATELLITE, { maxZoom: 18, className: "tiles-satellite", attribution: "Esri, Maxar, Earthstar Geographics" }),
      };
    }
    setBase(look.map, matchMedia("(prefers-color-scheme: dark)").matches);
    stopReplay?.();
    route?.remove();
    const line = css(look.color), paper = css("--paper");
    el.style.setProperty("--route", line);  // the glow filter in index.html follows the route's color
    const dot = (p, color, extra) => L.circleMarker(p, { radius: 5.5, color: paper, weight: 2.5, fillColor: color, fillOpacity: 1, ...extra });
    const stroke = (weight, opacity, extra) => L.polyline(track, { color: line, weight, opacity, lineJoin: "round", lineCap: "round", interactive: false, ...extra });
    const lines = [
      stroke(14, 0.12),  // glow: two wide faint halos fading out from the line
      stroke(8, 0.25),
      stroke(3.5, 1, { className: "route-glow" }),
      stroke(1.2, 0.9, { color: look.core }),  // hot pale centre, like a lit filament
    ];
    // Distance covered at each GPS point, so the replay's runner moves at an even speed
    const along = [0];
    for (let i = 1; i < track.length; i++) along.push(along[i - 1] + metres(track[i - 1], track[i]));
    const finish = dot(track[track.length - 1], css("--fatigue"));
    route = L.featureGroup([...lines, finish, dot(track[0], css("--easy"))]).addTo(map);
    if (el.offsetHeight) fitRoute();  // a map in a closed popup is fitted by the ResizeObserver when it opens
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const runner = dot(track[0], "#FFFFFF", { radius: 6, color: line, className: "route-glow" });
      stopReplay = replayRoute({ map, track, along, lines, finish, runner });
    }
    el.setAttribute("aria-label", `Map of the route: ${name}`);
  }
  return { show, stop: () => stopReplay?.() };
}
const lastMap = routeMap($("lastMap"));
const modalMap = routeMap($("modalMap"));

// Metres between two [lat, lon] points (flat-earth approximation, plenty for points a few metres apart)
function metres([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  return Math.hypot((lon2 - lon1) * rad * Math.cos((lat1 + lat2) / 2 * rad), (lat2 - lat1) * rad) * 6371e3;
}
// The [lat, lon] reached after `m` metres along the track; `along` holds the distance at each point
function pointAt(track, along, m, from = 0) {
  let i = from;
  while (i < track.length - 2 && along[i + 1] < m) i++;
  const f = (m - along[i]) / (along[i + 1] - along[i] || 1);
  return [track[i][0] + (track[i + 1][0] - track[i][0]) * f, track[i][1] + (track[i + 1][1] - track[i][1]) * f];
}

// Draws the route from start to finish once, with a glowing dot running at its head; returns a function that stops it and shows the whole route
const REPLAY_MS = 3500;
function replayRoute({ map, track, along, lines, finish, runner }) {
  const total = along[along.length - 1], paths = lines.map((l) => l.getElement());
  runner.addTo(map);
  finish.getElement().style.opacity = 0;
  let frame, i = 0, len = 0;
  // Measuring a long path is slow, so it's done once and again only after a zoom or pan redraws it at a new size.
  // The four lines share one shape, so the first one's length does for all of them.
  const remeasure = () => { len = 0; };
  map.on("zoomend viewreset moveend", remeasure);
  const t0 = performance.now();
  const step = (now) => {
    const f = Math.min(1, (now - t0) / REPLAY_MS), d = f * total;
    if (!len) {
      len = paths[0].getTotalLength();
      paths.forEach((p) => { p.style.strokeDasharray = len; });
    }
    paths.forEach((p) => { p.style.strokeDashoffset = len * (1 - f); });
    while (i < track.length - 2 && along[i + 1] < d) i++;
    runner.setLatLng(pointAt(track, along, d, i));
    if (f < 1) frame = requestAnimationFrame(step); else stop();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    map.off("zoomend viewreset moveend", remeasure);
    runner.remove();
    paths.forEach((p) => { p.style.strokeDasharray = p.style.strokeDashoffset = ""; });
    finish.getElement().style.opacity = "";
  };
  frame = requestAnimationFrame(step);
  return stop;
}

function baseOptions(extra = {}) {
  const muted = css("--muted"), rule = css("--rule");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    responsive: true, maintainAspectRatio: false, animation: reduce ? false : { duration: 400 },
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--ink"), titleColor: css("--paper"), bodyColor: css("--paper"), padding: 10 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 18 }, border: { color: rule } },
      y: { grid: { color: rule }, ticks: { color: muted }, border: { display: false } },
      ...extra,
    },
    font: { family: css("--body") },
  };
}

function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}

function alpha(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function renderFitnessCharts() {
  Chart.defaults.font.family = css("--body");
  const fit = css("--fitness");

  // Fitness and fatigue on one scale: the gap between them is form
  const fx = data.fitness, fat = css("--fatigue");
  const last = (color) => ({ pointRadius: fx.map((_, i) => (i === fx.length - 1 ? 4 : 0)), pointBackgroundColor: color });
  const o = baseOptions();
  o.plugins.tooltip.callbacks = {
    label: (c) => ` ${c.dataset.label}: ${Math.round(c.parsed.y)}`,
    footer: (items) => {
      const p = fx[items[0].dataIndex].form_pct;
      if (p == null) return "";
      const zone = data.form_zones.find((z) => z.min == null || p > z.min);
      return `Form: ${p > 0 ? "+" : ""}${Math.round(p)}% (${zone.name.toLowerCase()})`;
    },
  };
  draw("fitnessChart", {
    type: "line",
    data: {
      labels: fx.map((d) => fmtShort(d.date)),
      datasets: [
        { label: "Fitness", data: fx.map((d) => d.ctl), borderColor: fit, backgroundColor: alpha(fit, 0.1), fill: "origin", borderWidth: 2.5,
          tension: 0.3, ...last(fit) },
        { label: "Fatigue", data: fx.map((d) => d.atl), borderColor: fat, borderWidth: 1.5, tension: 0.3, ...last(fat) },
      ],
    },
    options: o,
  });

  renderVo2max();
}

// ---- Health: recovery, sleep and the body's daily numbers, last 90 days

// Average of a daily field over the days from `from` to `to` days ago (to excluded), skipping days without it
function trendAvg(field, from, to) {
  const lo = addDays(data.generated, -from), hi = addDays(data.generated, -to);
  const vals = data.trends.filter((d) => d.date > lo && d.date <= hi && d[field] != null).map((d) => d[field]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

function healthReadings() {
  const t = data.today;
  const hrv7 = trendAvg("hrv_last_night", 7, 0);
  $("hrvReading").textContent = hrv7 == null ? "" : `Your HRV has averaged ${Math.round(hrv7)} ms over the last 7 nights` +
    (t.hrv_low != null ? (hrv7 < t.hrv_low ? `, below your normal range of ${round(t.hrv_low)}–${round(t.hrv_high)}.`
      : hrv7 > t.hrv_high ? `, above your normal range of ${round(t.hrv_low)}–${round(t.hrv_high)}.`
      : `, inside your normal range of ${round(t.hrv_low)}–${round(t.hrv_high)}.`) : ".");
  const vs = (now, before, unit, digits = 0) => {
    if (before == null) return ".";
    const d = now - before;
    return Math.abs(d) < (digits ? 0.15 : 1) ? `, the same as the 30 days before.`
      : `, ${Math.abs(d).toFixed(digits)} ${unit} ${d > 0 ? "higher" : "lower"} than the 30 days before.`;
  };
  const rhr7 = trendAvg("resting_hr", 7, 0), rhr30 = trendAvg("resting_hr", 37, 7);
  $("rhrReading").textContent = rhr7 == null ? "" : `Resting heart rate has averaged ${Math.round(rhr7)} bpm this week` + vs(rhr7, rhr30, "bpm");
  const sl7 = trendAvg("sleep_s", 7, 0), sl30 = trendAvg("sleep_s", 37, 7);
  $("sleepReading").textContent = sl7 == null ? "" : `You've slept ${fmtHours(sl7)} a night this week` +
    (sl30 != null ? `, against ${fmtHours(sl30)} over the 30 nights before.` : ".");
  // Today's steps are still counting, so the averages start yesterday
  const st7 = trendAvg("steps", 8, 1), st30 = trendAvg("steps", 38, 8);
  $("stepsReading").textContent = st7 == null ? "" : `${Math.round(st7).toLocaleString("en-GB")} steps a day over the last 7 days` +
    (st30 != null ? `, against ${Math.round(st30).toLocaleString("en-GB")} the 30 days before.` : ".");

}

let healthDays = 90;
try { healthDays = Number(localStorage.getItem("healthDays")) || 90; } catch {}
$("healthRange").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-days]");
  if (!b) return;
  healthDays = Number(b.dataset.days);
  try { localStorage.setItem("healthDays", healthDays); } catch {}
  renderHealth();
});

function renderHealth() {
  Chart.defaults.font.family = css("--body");
  $("healthRange").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === healthDays)));
  $("healthToday").innerHTML = statItems(todayItems().filter(([label]) => label !== "Readiness"));
  healthReadings();
  const from = addDays(data.generated, -healthDays);
  const tr = data.trends.filter((d) => d.date > from), labels = tr.map((d) => fmtShort(d.date));
  const fit = css("--fitness"), muted = css("--muted"), rule = css("--rule"), dots = healthDays > 90 ? 0 : 2;
  const has = (f) => tr.some((d) => d[f] != null);
  // Each measure gets its own chart (one y-axis each); a chart with no data hides its section
  const chart = (section, id, config) => {
    $(section).hidden = !config;
    if (config) draw(id, config);
  };
  const yAxis = (extra = {}) => ({ y: { grid: { color: rule }, ticks: { color: muted }, border: { display: false }, ...extra } });
  const opts = (extra, label) => {
    const o = baseOptions(yAxis(extra));
    if (label) o.plugins.tooltip.callbacks = { label };
    return o;
  };
  const line = (label, f, color) => ({ label, data: tr.map((d) => d[f]), borderColor: color, backgroundColor: color, borderWidth: 2,
    pointRadius: 0, pointHoverRadius: 4, tension: 0.3, spanGaps: true });
  const bars = (label, data, color) => ({ type: "bar", label, data, backgroundColor: color, borderRadius: 2, maxBarThickness: 14 });

  chart("hrvSection", "hrvChart", has("hrv_last_night") && {
    type: "line",
    data: { labels, datasets: [
      { label: "Range high", data: tr.map((d) => d.hrv_high), borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: alpha(fit, 0.12) },
      { label: "Range low", data: tr.map((d) => d.hrv_low), borderWidth: 0, pointRadius: 0, fill: false },
      { ...line("HRV", "hrv_last_night", fit), pointRadius: dots },
    ] },
    options: (() => {
      const o = opts({}, (c) => ` HRV: ${c.parsed.y} ms`);
      o.plugins.tooltip.filter = (i) => !i.dataset.label.startsWith("Range");
      return o;
    })(),
  });
  chart("rhrSection", "rhrChart", has("resting_hr") && {
    type: "line", data: { labels, datasets: [line("Resting HR", "resting_hr", css("--fatigue"))] },
    options: opts({ ticks: { color: muted, precision: 0 } }, (c) => ` Resting HR: ${c.parsed.y} bpm`),
  });
  chart("sleepSection", "sleepChart", has("sleep_s") && {
    data: { labels, datasets: [bars("Sleep", tr.map((d) => (d.sleep_s ? +(d.sleep_s / 3600).toFixed(2) : null)), alpha(css("--nohr"), 0.85))] },
    options: (() => {
      const o = opts({ min: 0 }, (c) => ` ${fmtHours(c.parsed.y * 3600)}`);
      o.plugins.tooltip.callbacks.footer = (items) => { const sc = tr[items[0].dataIndex].sleep_score; return sc != null ? `Sleep score ${sc}` : ""; };
      return o;
    })(),
  });
  // Floating bars from the day's lowest to its highest Body Battery
  chart("bbSection", "bbChart", has("bb_high") && {
    data: { labels, datasets: [bars("Body Battery", tr.map((d) => (d.bb_high != null && d.bb_low != null ? [d.bb_low, d.bb_high] : null)), css("--easy"))] },
    options: opts({ min: 0, max: 100 }, (c) => { const [lo, hi] = c.raw; return ` Body Battery: ${lo} to ${hi}`; }),
  });
  chart("stressSection", "stressChart", has("stress_avg") && {
    data: { labels, datasets: [bars("Stress", tr.map((d) => d.stress_avg), css("--hard"))] },
    options: opts({ min: 0, max: 100 }, (c) => ` Average stress: ${c.parsed.y} (${stressLevel(c.parsed.y).toLowerCase()})`),
  });
  // The 7-day average of the days with steps, counted over the whole history so the first days of the view have one
  const all = data.trends, avg7 = all.map((d, i) => {
    const week = all.slice(Math.max(0, i - 6), i + 1).filter((x) => x.steps != null);
    return d.steps != null && week.length ? Math.round(week.reduce((t, x) => t + x.steps, 0) / week.length) : null;
  }).slice(all.length - tr.length);
  const steps = (v) => `${Math.round(v).toLocaleString("en-GB")} steps`;
  chart("stepsSection", "stepsChart", has("steps") && {
    data: { labels, datasets: [
      bars("Steps", tr.map((d) => d.steps), alpha(fit, 0.55)),
      { type: "line", label: "7-day average", data: avg7, borderColor: css("--ink"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, spanGaps: true },
    ] },
    options: opts({ min: 0 }, (c) => ` ${c.dataset.label === "Steps" ? "" : "7-day average: "}${steps(c.parsed.y)}`),
  });
  // Best day in the period shown
  const best = tr.filter((d) => d.steps != null).reduce((b, d) => (!b || d.steps > b.steps ? d : b), null);
  if (best) $("stepsReading").textContent += ` Best day: ${steps(best.steps)} on ${fmtShort(best.date)}.`;
}

// One plain-language sentence on where VO2 max stands against 3 and 12 months ago.
function vo2Reading(v) {
  const now = round(v.now, 1);
  const vs = (before, when) => {
    if (before == null) return null;
    const diff = Math.round((v.now - before) * 10) / 10;
    if (Math.abs(diff) < 0.5) return `about the same as ${when} (${round(before, 1)})`;
    return `${diff > 0 ? "up" : "down"} ${Math.abs(diff).toFixed(1)} from ${round(before, 1)} ${when}`;
  };
  const parts = [vs(v.ago_3m, "three months ago"), vs(v.ago_12m, "a year ago")].filter(Boolean);
  let text = `VO2 max is ${now}` + (parts.length ? `, ${parts.join(", and ")}.` : ".");
  if (v.peak > v.now + 0.4) text += ` Your highest this year was ${round(v.peak, 1)}.`;
  return text;
}

function renderVo2max() {
  const v = data.vo2max;
  $("vo2Section").hidden = !v;
  if (!v) return;
  $("vo2Reading").textContent = vo2Reading(v);
  const fit = css("--fitness");
  const vals = v.weeks.map((x) => x.vo2max).filter((x) => x != null);
  const o = baseOptions({
    y: { suggestedMin: Math.floor(Math.min(...vals) - 1), suggestedMax: Math.ceil(Math.max(...vals) + 1),
      grid: { color: css("--rule") }, ticks: { color: css("--muted"), precision: 0 }, border: { display: false } },
  });
  // One tick at the first week of each month (every 2nd or 3rd month over long ranges); the tooltip names the week
  const sameYear = v.weeks[0].week.slice(0, 4) === data.generated.slice(0, 4);
  const fmtMonth = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", sameYear ? { month: "short" } : { month: "short", year: "2-digit" });
  const step = v.weeks.length > 80 ? 3 : v.weeks.length > 60 ? 2 : 1;
  const month = (i) => v.weeks[i].week.slice(0, 7);
  const tickAt = (i) => i > 0 && month(i) !== month(i - 1) && Number(month(i).slice(5)) % step === 0;
  o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false, callback: (i) => (tickAt(i) ? fmtMonth(v.weeks[i].week) : null) };
  o.plugins.tooltip.callbacks = {
    title: (items) => `Week of ${fmtShort(v.weeks[items[0].dataIndex].week)}`,
    label: (c) => ` VO2 max: ${c.parsed.y.toFixed(1)}`,
  };
  draw("vo2Chart", {
    type: "line",
    data: {
      labels: v.weeks.map((x) => x.week),
      datasets: [{ label: "VO2 max", data: v.weeks.map((x) => x.vo2max), borderColor: fit, backgroundColor: alpha(fit, 0.1),
        fill: "start", borderWidth: 2, spanGaps: true,
        tension: 0.4, cubicInterpolationMode: "monotone",  // smooth curve that never overshoots past the real values
        pointRadius: v.weeks.map((_, i) => (i === v.weeks.length - 1 ? 4 : 0)), pointBackgroundColor: fit }],
    },
    options: o,
  });
}

// Sport groups from metrics.SPORTS, with their button labels (the filter sorts them by count)
const SPORTS = [
  ["run", "Running"], ["walk", "Walking"], ["hike", "Hiking"], ["bike", "Cycling"], ["swim", "Swimming"],
  ["strength", "Strength"], ["cardio", "Gym & cardio"], ["disc_golf", "Disc golf"], ["yoga", "Yoga"],
  ["winter", "Winter sports"], ["other", "Other"],
];
const PAGE = 25;
let sport = "all";
try { sport = localStorage.getItem("sport") || "all"; } catch {}
let shown = PAGE;

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
function fmtHours(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Pace for foot sports, per 100 m in the pool; speed on the bike (only mixed in the All list)
// Sports measured in km/h rather than a pace
const KMH_SPORTS = ["bike", "winter"];
function fmtSpeed(a) {
  if (!a.speed) return "";
  if (KMH_SPORTS.includes(a.sport)) return `${(a.speed * 3.6).toFixed(1)} km/h`;
  if (a.sport === "swim") return fmtPace(100 / a.speed).replace("/km", "/100m");
  if (["run", "walk", "hike"].includes(a.sport)) return fmtPace(1000 / a.speed);
  return "";
}

// Garmin's primary training effect label -> [name, load focus group for the dot color]
const EFFECTS = {
  RECOVERY: ["Recovery", "low"], AEROBIC_BASE: ["Base", "low"], TEMPO: ["Tempo", "high"],
  LACTATE_THRESHOLD: ["Threshold", "high"], VO2MAX: ["VO2 max", "high"],
  ANAEROBIC_CAPACITY: ["Anaerobic", "anaerobic"], SPRINT: ["Sprint", "anaerobic"],
};

// Garmin's label where there is one; for runs without it, the focus from average HR (marked as such).
// Only for endurance sports: on strength, yoga or a walk the label says little.
const EFFECT_SPORTS = ["run", "bike", "swim", "cardio"];
function effectCell(a) {
  let name, group;
  if (!EFFECT_SPORTS.includes(a.sport)) return "";
  if (a.te_label) {
    [name, group] = EFFECTS[a.te_label] || [statusLabel(a.te_label), ""];
  } else if (a.focus) {
    name = `${FOCUS.find((f) => f[0] === a.focus)[1]} (HR)`;
    group = a.focus;
  } else {
    return "";
  }
  return `<span class="dot ${group}" aria-hidden="true"></span>${name}`;
}

// Table columns: key -> [header, right-aligned, cell]. A cell returns "" when it has nothing to show.
const COLUMNS = {
  date: ["Date", false, (a) => (a.date.slice(0, 4) === data.generated.slice(0, 4) ? fmtDay(a.date) : fmtDayYear(a.date))],
  name: ["Activity", false, (a) => escapeHtml(a.name || a.type.replace(/_/g, " "))],
  effect: ["Effect", false, effectCell],
  distance: ["Distance", true, (a) => (a.km ? `${a.km.toFixed(2)} km` : "")],
  time: ["Time", true, (a) => fmtDuration(a.duration_s)],
  pace: ["Pace", true, fmtSpeed],
  speed: ["Speed", true, (a) => (a.speed ? `${(a.speed * 3.6).toFixed(1)} km/h` : "")],
  ascent: ["Ascent", true, (a) => (a.elev_m >= 1 ? `${Math.round(a.elev_m)} m` : "")],
  descent: ["Descent", true, (a) => (a.descent_m >= 1 ? `${Math.round(a.descent_m)} m` : "")],
  sets: ["Sets", true, (a) => a.sets ?? ""],
  reps: ["Reps", true, (a) => a.reps ?? ""],
  hr: ["Avg HR", true, (a) => (a.avg_hr ? Math.round(a.avg_hr) : "")],
  load: ["Load", true, (a) => (a.load ? Math.round(a.load) : "")],
};
// Which columns each sport shows, in order
const SPORT_COLUMNS = {
  all: ["date", "name", "effect", "distance", "time", "pace", "hr", "load"],
  run: ["date", "name", "effect", "distance", "time", "pace", "hr", "load"],
  walk: ["date", "name", "distance", "time", "pace", "ascent", "hr"],
  hike: ["date", "name", "distance", "time", "ascent", "pace", "hr", "load"],
  bike: ["date", "name", "effect", "distance", "time", "speed", "ascent", "hr", "load"],
  swim: ["date", "name", "effect", "distance", "time", "pace", "hr", "load"],
  strength: ["date", "name", "time", "sets", "reps", "hr", "load"],
  cardio: ["date", "name", "effect", "time", "hr", "load"],
  disc_golf: ["date", "name", "distance", "time", "hr"],
  yoga: ["date", "name", "time", "hr"],
  winter: ["date", "name", "distance", "time", "speed", "descent", "hr", "load"],  // resort skiing records no ascent
  other: ["date", "name", "distance", "time", "hr", "load"],
};

function setSport(s) {
  sport = s;
  shown = PAGE;
  try { localStorage.setItem("sport", s); } catch {}
  renderActivities();
}

// The sport's columns for these rows, minus any that are empty for every row (e.g. sets when Garmin didn't record them)
function tableParts(rows, key) {
  const cols = (SPORT_COLUMNS[key] || SPORT_COLUMNS.other).map((k) => [k, ...COLUMNS[k]])
    .filter(([k, , , cell]) => k === "date" || k === "name" || rows.some((a) => cell(a) !== ""));
  if (key === "all") cols.find((c) => c[0] === "pace")?.splice(1, 1, "Pace / speed");
  return {
    head: `<tr>${cols.map(([, head, num]) => `<th${num ? ' class="num"' : ""}>${head}</th>`).join("")}</tr>`,
    // The whole row opens the activity; the name is a button so it can be reached with the keyboard too
    body: rows.map((a) => `<tr data-id="${a.id}">${cols.map(([k, , num, cell]) => k === "name"
      ? `<td class="name"><button type="button" class="act-link">${cell(a)}</button></td>`
      : `<td${num ? ' class="num"' : ""}>${cell(a)}</td>`).join("")}</tr>`).join(""),
  };
}

function renderActivities() {
  const acts = data.activities, counts = sportCounts();
  if (sport !== "all" && !counts[sport]) sport = "all";
  const options = [["all", "All"], ...sportsByCount(counts)];
  $("sportFilter").innerHTML = options.map(([key, label]) =>
    `<button type="button" data-sport="${key}" aria-pressed="${key === sport}">${label}<span>${key === "all" ? acts.length : counts[key]}</span></button>`).join("");

  const list = sport === "all" ? acts : acts.filter((a) => a.sport === sport);
  const t = tableParts(list.slice(0, shown), sport);
  $("actHead").innerHTML = t.head;
  $("actBody").innerHTML = t.body;
  $("actMore").hidden = list.length <= shown;
  $("actMore").textContent = `Show more (${list.length - shown} left)`;

  renderVolume($("actVolume"), list, sport === "all" ? "All activities" : sportLabel(sport), sport === "all" ? null : sport);
}

// Strava-style totals for a list of activities in the `root` panel: this week day by day, and this year.
// For one sport (`key`) with distances, also the longest one this week and this year.
function renderVolume(root, list, label, key) {
  const q = (cls) => root.querySelector(`.${cls}`);
  const today = data.generated;
  const monday = addDays(today, -((new Date(today + "T12:00:00").getDay() + 6) % 7));
  const year = today.slice(0, 4);
  // Distance where the sport has it (running, cycling…), otherwise time (strength, yoga…)
  const byKm = sum(list.filter((a) => a.date.startsWith(year)), "km") > 0;
  const value = (as) => (byKm ? sum(as, "km") : sum(as, "duration_s"));
  const big = (v) => (byKm ? `${v.toFixed(1)}<span>km</span>` : fmtHours(v).replace(/(\d+)([hm])/g, "$1<span>$2</span>"));
  const small = (v) => (byKm ? `${v.toFixed(1)} km` : fmtHours(v));
  const between = (from, to) => list.filter((a) => a.date >= from && a.date < to);  // this list only
  const count = (n) => `${n} ${n === 1 ? "activity" : "activities"}`;

  q("vol-sport").textContent = label;

  const week = between(monday, addDays(monday, 7));
  q("vol-week").innerHTML = big(value(week));
  const prev4 = value(between(addDays(monday, -28), monday)) / 4;
  const weekNote = [count(week.length)];
  if (byKm && week.length) weekNote.push(fmtHours(sum(week, "duration_s")));
  if (prev4 > 0) weekNote.push(`4-week avg ${small(prev4)}`);
  q("vol-week-note").textContent = weekNote.join(" · ");

  const days = [...Array(7)].map((_, i) => {
    const iso = addDays(monday, i);
    return { iso, v: value(list.filter((a) => a.date === iso)) };
  });
  const top = Math.max(...days.map((d) => d.v)) || 1;
  q("vol-days").innerHTML = days.map((d, i) => {
    const cls = d.iso === today ? "is-today" : d.iso > today ? "future" : "";
    const h = d.v ? Math.max(6, (d.v / top) * 100) : 0;
    return `<div class="${cls}" title="${fmtDay(d.iso)}: ${d.v ? small(d.v) : "rest"}"><div class="bar"><i style="height:${h}%"></i></div><span class="day">${"MTWTFSS"[i]}</span></div>`;
  }).join("");
  q("vol-days").setAttribute("aria-label", `${label} this week by day: ` + days.filter((d) => d.iso <= today).map((d) => `${fmtDay(d.iso)} ${d.v ? small(d.v) : "rest"}`).join(", "));

  const yr = list.filter((a) => a.date.startsWith(year));
  q("vol-year").innerHTML = big(value(yr));
  const elev = sum(yr, "elev_m");
  const yearNote = [count(yr.length)];
  if (byKm) yearNote.push(fmtHours(sum(yr, "duration_s")));
  if (byKm && elev >= 1) yearNote.push(`${Math.round(elev).toLocaleString("en-GB")} m climbed`);
  if (data.activities_from > `${year}-01-01`) yearNote.push(`synced from ${fmtShort(data.activities_from)}`);
  q("vol-year-note").textContent = yearNote.join(" · ");

  const longest = (as) => {
    const a = as.filter((x) => x.km > 0).reduce((b, x) => (!b || x.km > b.km ? x : b), null);
    return key && byKm && a ? `Longest ${SPORT_NOUNS[key][0]}: ${a.km.toFixed(1)} km` : "";
  };
  q("vol-week-long").textContent = longest(week);
  q("vol-year-long").textContent = longest(yr);
}

// ---- Sport pages: one sport's totals, how its volume and speed have developed, its personal bests and its activities

const BEST_LABELS = { 400: "400 m", 1000: "1 km", 1609: "1 mile", 5000: "5 km", 10000: "10 km", 21098: "Half marathon", 42195: "Marathon" };
let sportShown = PAGE, sportShownKey = null;

// Distance for sports that record it, time for the rest
function measureFor(list) {
  const byKm = sum(list, "km") > 0;
  return byKm
    ? { byKm, of: (as) => sum(as, "km"), big: (v) => `${fmtKm(v)}<span>km</span>`, small: (v) => `${fmtKm(v)} km`, unit: "Kilometres" }
    : { byKm, of: (as) => sum(as, "duration_s"), big: (v) => fmtHours(v).replace(/(\d+)([hm])/g, "$1<span>$2</span>"), small: fmtHours, unit: "Hours" };
}

function renderSport(key) {
  Chart.defaults.font.family = css("--body");
  const list = data.activities.filter((a) => a.sport === key);  // newest first
  const label = sportLabel(key), today = data.generated, m = measureFor(list), nouns = SPORT_NOUNS[key];
  if (sportShownKey !== key) { sportShown = PAGE; sportShownKey = key; }
  $("sportTitle").textContent = label;
  $("sportListName").textContent = nouns[1];

  // Tiles: this week, the last 4 weeks (against the 4 before), this year and last year
  const monday = mondayOf(today), tomorrow = addDays(today, 1);
  const week = between(list, monday, tomorrow), four = between(list, addDays(today, -27), tomorrow);
  const fourBefore = between(list, addDays(today, -55), addDays(today, -27)), year = list.filter((a) => a.date.startsWith(today.slice(0, 4)));
  const change = m.of(fourBefore) ? Math.round((m.of(four) - m.of(fourBefore)) / m.of(fourBefore) * 100) : null;
  const yearTile = (y, as) => [y === today.slice(0, 4) ? "This year" : y, m.big(m.of(as)),
    plural(as.length, nouns) + (m.byKm && as.length ? ` · ${fmtHours(sum(as, "duration_s"))}` : "")];
  // A sport you haven't done for a month (a ski trip, a summer sport) shows its latest outing and last year instead of zeros
  const lastYear = String(Number(today.slice(0, 4)) - 1);
  const tiles = four.length || fourBefore.length ? [
    ["This week", m.big(m.of(week)), plural(week.length, nouns)],
    ["Last 4 weeks", m.big(m.of(four)), change == null ? plural(four.length, nouns)
      : `<span class="${change >= 0 ? "up" : "down"}">${change >= 0 ? "+" : "−"}${Math.abs(change)}%</span> vs the 4 weeks before`],
    yearTile(today.slice(0, 4), year),
    yearTile(lastYear, list.filter((a) => a.date.startsWith(lastYear))),
  ] : [
    ["Latest", `${fmtShort(list[0].date)}<span>${list[0].date.slice(0, 4)}</span>`, escapeHtml(list[0].name || "")],
    yearTile(today.slice(0, 4), year),
    yearTile(lastYear, list.filter((a) => a.date.startsWith(lastYear))),
  ];
  $("sportTiles").innerHTML = statItems(tiles);
  $("sportTiles").style.setProperty("--cols", tiles.length);

  renderSportWeekly(key, list, m);
  renderYearOnYear(key, list, m);
  renderMonthly(key, list, m);
  renderRecords(key, list);

  const t = tableParts(list.slice(0, sportShown), key);
  $("sportHead").innerHTML = t.head;
  $("sportBody").innerHTML = t.body;
  $("sportMore").hidden = list.length <= sportShown;
  $("sportMore").textContent = `Show more (${list.length - sportShown} left)`;
}

// Volume per week for the last 26 weeks (or the 26 up to the latest one, for a sport done in a season)
function renderSportWeekly(key, list, m) {
  const latest = list[0].date, current = latest >= weekStarts(26)[0];
  $("sportWeeklyTitle").textContent = `${m.unit} per week`;
  $("sportWeeklySub").textContent = !current ? `Up to ${fmtShort(latest)} ${latest.slice(0, 4)}.` : key === "run" ? lowShare(list) : "";
  weeklyChart("sportWeeklyChart", "sportWeeklyLegend", key, list, weekStarts(26, current ? data.generated : latest), m);
}

// Running total through the year, this year against last year, on a shared January-to-December axis
function renderYearOnYear(key, list, m) {
  const today = data.generated, y = Number(today.slice(0, 4));
  const thisYear = list.filter((a) => a.date.startsWith(String(y))), lastYear = list.filter((a) => a.date.startsWith(String(y - 1)));
  $("sportYoySection").hidden = !lastYear.length;
  if (!lastYear.length) return;
  // Day by day through a 366-day year, so 29 February has a place; each year's total so far on each day
  const days = [...Array(366)].map((_, i) => addDays("2000-01-01", i).slice(5));
  const val = (a) => (m.byKm ? a.km : a.duration_s / 3600);
  const running = (as, year, until) => {
    const per = {};
    as.forEach((a) => { per[a.date.slice(5)] = (per[a.date.slice(5)] || 0) + val(a); });
    let t = 0;
    return days.map((md) => {
      if (until && `${year}-${md}` > until) return null;
      t += per[md] || 0;
      return +t.toFixed(2);
    });
  };
  const now = running(thisYear, y, today), before = running(lastYear, y - 1);
  const md = today.slice(5), idx = days.indexOf(md);
  const fmt = (v) => (m.byKm ? `${fmtKm(v)} km` : fmtHours(v * 3600));
  const thenTotal = before[idx], nowTotal = now[idx];
  $("sportYoyReading").textContent = `${fmt(nowTotal)} so far, against ${fmt(thenTotal)} by this date last year (${fmt(before[365])} in all).`;
  const color = sportColor(key), muted = css("--muted");
  $("sportYoyLegend").innerHTML = `<span><i class="line" style="background:${color}"></i>${y}</span>` +
    `<span><i class="line dashed" style="color:${muted}"></i>${y - 1}</span>`;
  $("sportYoyChart").setAttribute("aria-label", `Running total of ${m.unit.toLowerCase()} through ${y}, against ${y - 1}`);
  const o = baseOptions({ y: { min: 0, grid: { color: css("--rule") }, ticks: { color: muted }, border: { display: false } } });
  // A tick at the start of each month
  o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false,
    callback: (i) => (days[i].endsWith("-01") ? new Date(`2000-${days[i]}T12:00:00`).toLocaleDateString("en-GB", { month: "short" }) : null) };
  o.plugins.tooltip.callbacks = {
    title: (items) => new Date(`2000-${days[items[0].dataIndex]}T12:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "long" }),
    label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y)}`,
  };
  draw("sportYoyChart", {
    type: "line",
    data: {
      labels: days,
      datasets: [
        { label: String(y), data: now, borderColor: color, backgroundColor: color, borderWidth: 2.5, pointRadius: now.map((_, i) => (i === idx ? 4 : 0)), tension: 0 },
        { label: String(y - 1), data: before, borderColor: muted, borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: 0 },
      ],
    },
    options: o,
  });
}

// Distance (or hours) per month, this year next to last year
function renderMonthly(key, list, m) {
  const y = Number(data.generated.slice(0, 4)), month = data.generated.slice(5, 7);
  const perMonth = (year) => [...Array(12)].map((_, i) => {
    const mo = `${year}-${String(i + 1).padStart(2, "0")}`;
    if (year === y && mo.slice(5) > month) return null;  // months still to come
    const as = list.filter((a) => a.date.startsWith(mo));
    return m.byKm ? +sum(as, "km").toFixed(1) : +(sum(as, "duration_s") / 3600).toFixed(2);
  });
  const now = perMonth(y), before = perMonth(y - 1);
  $("sportMonthSection").hidden = !now.some(Boolean) && !before.some(Boolean);
  if ($("sportMonthSection").hidden) return;
  const color = sportColor(key), grey = css("--nohr");
  $("sportMonthTitle").textContent = `${m.unit} per month`;
  $("sportMonthLegend").innerHTML = `<span><i style="background:${color}"></i>${y}</span><span><i style="background:${grey}"></i>${y - 1}</span>`;
  $("sportMonthChart").setAttribute("aria-label", `${m.unit} per month, ${y} against ${y - 1}`);
  const fmt = (v) => (m.byKm ? `${fmtKm(v)} km` : fmtHours(v * 3600));
  const o = baseOptions();
  o.plugins.tooltip.callbacks = { label: (c) => (c.parsed.y == null ? null : ` ${c.dataset.label}: ${fmt(c.parsed.y)}`) };
  const bar = { borderRadius: 2, maxBarThickness: 26, categoryPercentage: 0.7, barPercentage: 0.9 };
  draw("sportMonthChart", {
    type: "bar",
    data: {
      labels: [...Array(12)].map((_, i) => new Date(2000, i, 15).toLocaleDateString("en-GB", { month: "short" })),
      datasets: [
        { label: String(y - 1), data: before, backgroundColor: grey, ...bar },
        { label: String(y), data: now, backgroundColor: color, ...bar },
      ],
    },
    options: o,
  });
}

// The sport's bests: longest, fastest, highest; each opens its activity
function renderRecords(key, list) {
  const top = (as, f, pick = Math.max) => {
    const vs = as.filter((a) => a[f] != null && a[f] > 0);
    if (!vs.length) return null;
    const best = pick(...vs.map((a) => a[f]));
    return vs.find((a) => a[f] === best);
  };
  const recs = [];  // [label, value, activity, or a note when there's no activity]
  const add = (label, a, value) => { if (a) recs.push([label, value(a), a]); };
  if (key === "run") {
    // The fastest time over each distance within any run, 400 m to marathon
    const longest = Math.max(...list.map((a) => a.km)) * 1000;
    Object.entries(BEST_LABELS).forEach(([mtr, name]) => {
      const as = list.filter((a) => a.best?.[mtr]);
      if (!as.length) {
        recs.push([`Fastest ${name}`, "–", longest >= mtr ? "Coming with the next syncs" : "No run this long yet"]);
        return;
      }
      const a = as.reduce((b, x) => (x.best[mtr] < b.best[mtr] ? x : b));
      recs.push([`Fastest ${name}`, `${fmtDuration(a.best[mtr])}<small> · ${fmtPace(a.best[mtr] / mtr * 1000)}</small>`, a]);
    });
  }
  add("Longest distance", top(list, "km"), (a) => `${a.km.toFixed(2)} km`);
  add("Longest time", top(list, "duration_s"), (a) => fmtDuration(a.duration_s));
  if (KMH_SPORTS.includes(key)) add("Top speed", top(list, "max_speed"), (a) => `${(a.max_speed * 3.6).toFixed(1)} km/h`);
  if (key === "winter") add("Most descent", top(list, "descent_m"), (a) => `${Math.round(a.descent_m).toLocaleString("en-GB")} m`);

  $("sportRecordsSection").hidden = !recs.length;
  $("sportRecords").innerHTML = recs.map(([lbl, val, a]) => (typeof a === "string"
    ? `<div class="empty-rec"><span class="rl">${lbl}</span><span class="rv">${val}</span><small>${a}</small></div>`
    : `<button type="button" data-act="${a.id}"><span class="rl">${lbl}</span><span class="rv">${val}</span>
    <small>${COLUMNS.date[2](a)} · ${escapeHtml(a.name || a.type.replace(/_/g, " "))}</small></button>`)).join("");
}

$("sportMore").addEventListener("click", () => { sportShown += PAGE; showPage(); });

$("sportFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sport]");
  if (b) setSport(b.dataset.sport);
});
$("actMore").addEventListener("click", () => { shown += PAGE; renderActivities(); });
// Any activity row, or a personal best, opens the activity
document.addEventListener("click", (e) => {
  const el = e.target.closest(".act-table tbody tr[data-id], [data-act]");
  if (el) openActivity(Number(el.dataset.id || el.dataset.act));
});

// ---- Activity popup: the list's summary straight away, then every stat, the route and the laps once they've loaded

const modal = $("actModal");
let modalAct = null, modalDetail = null;

async function openActivity(id) {
  const a = data.activities.find((x) => x.id === id);
  if (!a) return;
  modalAct = a;
  modalDetail = null;
  $("modalWhen").textContent = [COLUMNS.date[2](a) + (a.start ? `, ${a.start.slice(11, 16)}` : ""), a.location].filter(Boolean).join(" · ");
  $("modalName").textContent = a.name || a.type.replace(/_/g, " ");
  $("modalEffect").innerHTML = effectCell(a);
  $("modalEffect").hidden = !$("modalEffect").innerHTML;
  $("modalStats").innerHTML = headlineStats(a);
  $("modalDetails").innerHTML = "";
  $("modalMap").hidden = true;
  showModalStatus("Loading details…");
  if (!modal.open) {
    modal.showModal();
    document.body.classList.add("modal-open");
  }
  modal.querySelector(".modal-box").scrollTop = 0;
  try {
    const res = await fetch(`/api/activity/${id}`);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    if (modalAct !== a) return;  // another activity was opened meanwhile
    modalDetail = d;
    renderModalDetail();
  } catch {
    if (modalAct === a) showModalStatus("Couldn't load the details. Check that the dashboard server is still running.");
  }
}

function showModalStatus(text) {
  $("modalStatus").textContent = text || "";
  $("modalStatus").hidden = !text;
}

function closeModal() {
  modal.close();
}
modal.addEventListener("close", () => {
  modalMap.stop();
  modalAct = modalDetail = null;
  document.body.classList.remove("modal-open");
});
$("modalClose").addEventListener("click", closeModal);
// The dialog itself only receives clicks on its backdrop, as .modal-box covers everything inside it.
// The press has to start there too, so selecting text and letting go outside doesn't close it.
let pressedOutside = false;
modal.addEventListener("pointerdown", (e) => { pressedOutside = e.target === modal; });
modal.addEventListener("click", (e) => { if (e.target === modal && pressedOutside) closeModal(); });

// Garmin's training effect messages ("IMPROVING_AEROBIC_BASE_8") as words
const teMessage = (m) => (m ? statusLabel(m.replace(/_\d+$/, "")) : "");
const num = (v, digits = 0, unit = "") => (v == null ? null : `${Number(v).toFixed(digits)}${unit ? ` ${unit}` : ""}`);
const signed = (v, unit = "") => (v == null ? null : `${v > 0 ? "+" : ""}${Math.round(v)}${unit ? ` ${unit}` : ""}`);

// Garmin's zone colors, grey to red
const ZONE_COLORS = ["--z1", "--z2", "--z3", "--z4", "--z5"];
function zoneBars(zones, label) {
  const total = zones.reduce((t, s) => t + (s || 0), 0);
  const top = Math.max(...zones) || 1;
  return `<div class="zones" role="img" aria-label="${label}: ${zones.map((s, i) => `zone ${i + 1} ${fmtDuration(s) || "0:00"}`).join(", ")}">` +
    zones.map((s, i) => `<div class="zrow"><span>Zone ${i + 1}</span>
      <div class="zbar"><i style="width:${((s || 0) / top) * 100}%;background:var(${ZONE_COLORS[i]})"></i></div>
      <span class="zval">${fmtDuration(s) || "0:00"}<small>${Math.round(((s || 0) / total) * 100)}%</small></span></div>`).join("") +
    "</div>";
}

// Garmin splits a resort ski day into a lap per run, so winter sports call them runs
const lapName = (d) => (d.sport === "winter" ? "Run" : "Lap");
// Lap table columns: [header, cell], headers taking the activity; columns that are empty for every lap are left out
const LAP_COLUMNS = [
  [lapName, (l, i) => i + 1],
  [() => "Distance", (l) => (l.km ? `${l.km.toFixed(2)} km` : "")],
  [() => "Time", (l) => fmtDuration(l.duration_s)],
  [(d) => (KMH_SPORTS.includes(d.sport) ? "Speed" : "Pace"), (l, i, d) => fmtSpeed({ sport: d.sport, speed: l.speed })],
  [(d) => (KMH_SPORTS.includes(d.sport) ? "Max speed" : "Best pace"), (l, i, d) => fmtSpeed({ sport: d.sport, speed: l.max_speed })],
  [() => "Avg HR", (l) => (l.avg_hr ? Math.round(l.avg_hr) : "")],
  [() => "Max HR", (l) => (l.max_hr ? Math.round(l.max_hr) : "")],
  [() => "Ascent", (l) => (l.elev_gain ? `${Math.round(l.elev_gain)} m` : "")],
  [() => "Descent", (l) => (l.elev_loss ? `${Math.round(l.elev_loss)} m` : "")],
  [() => "Cadence", (l) => (l.cadence ? Math.round(l.cadence) : "")],
  [() => "Power", (l) => (l.power ? `${Math.round(l.power)} W` : "")],
];
function lapTable(d) {
  const cols = LAP_COLUMNS.filter(([, cell]) => d.laps.some((l, i) => cell(l, i, d) !== ""));
  return `<div class="scroll"><table class="laps"><thead><tr>${cols.map(([h], i) => `<th${i ? ' class="num"' : ""}>${h(d)}</th>`).join("")}</tr></thead>
    <tbody>${d.laps.map((l, li) => `<tr>${cols.map(([, cell], i) => `<td${i ? ' class="num"' : ""}>${cell(l, li, d)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderModalDetail() {
  const d = modalDetail, s = d.stats;
  showModalStatus(d.details_error);
  modalMap.show(d.track, d.name || "activity", d.sport);

  const row = (label, value) => (value == null || value === "" ? "" : `<div><dt>${label}</dt><dd>${value}</dd></div>`);
  const group = (title, rows, extra = "", cls = "") => {
    const body = rows.join("");
    return body || extra ? `<section class="dgroup ${cls}"><h3>${title}</h3>${body ? `<dl>${body}</dl>` : ""}${extra}</section>` : "";
  };
  const foot = ["run", "walk", "hike"].includes(d.sport), kmh = KMH_SPORTS.includes(d.sport);
  const speedOf = (v) => (v ? fmtSpeed({ sport: d.sport, speed: v }) : null);
  // Garmin counts vigorous minutes double
  const intensity = s.moderate_min != null || s.vigorous_min != null
    ? `${(s.moderate_min || 0) + 2 * (s.vigorous_min || 0)}<small>${s.moderate_min || 0} moderate · ${s.vigorous_min || 0} vigorous</small>` : null;

  const groups = [
    group("Time and effort", [
      row("Moving time", fmtDuration(d.duration_s)),
      row("Elapsed time", s.elapsed_s && Math.abs(s.elapsed_s - d.duration_s) >= 5 ? fmtDuration(s.elapsed_s) : null),
      row("Training load", d.load ? Math.round(d.load) : null),
      row("Runs", d.sport === "winter" && s.lap_count > 1 ? s.lap_count : null),
      // Garmin's calories include what the body burns at rest anyway
      row("Calories", s.calories == null ? null : num(s.calories, 0, "kcal") +
        (s.bmr_calories ? `<small>${Math.round(s.calories - s.bmr_calories)} active · ${Math.round(s.bmr_calories)} resting</small>` : "")),
      row("Steps", s.steps ? Math.round(s.steps).toLocaleString("en-GB") : null),
      row("Body Battery", signed(s.body_battery)),
      row("Est. sweat loss", num(s.water_ml, 0, "ml")),
      row("Intensity minutes", intensity),
    ]),
    group("Training effect", [
      row("Aerobic", s.aerobic_te != null ? `${num(s.aerobic_te, 1)}<small>${teMessage(s.aerobic_msg)}</small>` : null),
      row("Anaerobic", s.anaerobic_te != null ? `${num(s.anaerobic_te, 1)}<small>${teMessage(s.anaerobic_msg)}</small>` : null),
      row("VO2 max", num(s.vo2max)),
    ]),
    group("Heart rate", [
      row("Average", num(d.avg_hr, 0, "bpm")),
      row("Max", num(s.max_hr, 0, "bpm")),
    ], d.hr_zones ? zoneBars(d.hr_zones, "Time in heart rate zones") : ""),
    group(kmh ? "Speed" : "Pace", [
      row(kmh ? "Average" : "Average pace", speedOf(d.speed)),
      row(kmh ? "Max" : "Best pace", speedOf(s.max_speed)),
      row("Grade-adjusted pace", d.sport === "run" ? speedOf(s.gap_speed) : null),
    ]),
    group("Running dynamics", foot ? [
      row("Cadence", num(s.cadence, 0, "spm")),
      row("Max cadence", num(s.max_cadence, 0, "spm")),
      row("Stride length", s.stride_cm ? num(s.stride_cm / 100, 2, "m") : null),
      row("Ground contact", num(s.gct_ms, 0, "ms")),
      row("Contact balance", s.gct_balance ? `${num(s.gct_balance, 1)}% L / ${num(100 - s.gct_balance, 1)}% R` : null),
      row("Vertical oscillation", num(s.vert_osc_cm, 1, "cm")),
      row("Vertical ratio", num(s.vert_ratio, 1, "%")),
    ] : []),
    group("Cadence", d.sport === "bike" ? [
      row("Average", num(s.bike_cadence, 0, "rpm")),
      row("Max", num(s.max_bike_cadence, 0, "rpm")),
    ] : []),
    group("Power", [
      row("Average", num(s.power, 0, "W")),
      row("Normalized", num(s.norm_power, 0, "W")),
      row("Max", num(s.max_power, 0, "W")),
    ], d.power_zones ? zoneBars(d.power_zones, "Time in power zones") : ""),
    group("Swimming", d.sport === "swim" ? [
      row("Pool length", num(s.pool_m, 0, "m")),
      row("Lengths", s.lengths),
      row("Strokes", s.strokes),
      row("Avg SWOLF", num(s.swolf)),
      row("Distance per stroke", num(s.stroke_m, 2, "m")),
      row("Stroke rate", num(s.swim_cadence, 0, "spm")),
    ] : []),
    group("Strength", [row("Sets", d.sets), row("Reps", d.reps)]),
    group("Elevation", [
      row("Ascent", d.elev_m >= 1 ? num(d.elev_m, 0, "m") : null),
      row("Descent", num(s.elev_loss, 0, "m")),
      row("Lowest", num(s.min_elev, 0, "m")),
      row("Average", num(s.avg_elev, 0, "m")),
      row("Highest", num(s.max_elev, 0, "m")),
      // Mostly noise on flat ground; on a mountain it's how fast you dropped or climbed
      row("Max vertical speed", ["winter", "hike"].includes(d.sport) ? num(s.max_vert_speed, 1, "m/s") : null),
    ]),
    group("Breathing", [
      row("Average", num(s.resp, 0, "brpm")),
      row("Lowest", num(s.min_resp, 0, "brpm")),
      row("Highest", num(s.max_resp, 0, "brpm")),
    ]),
    group("Temperature", [row("Lowest", num(s.min_temp, 0, "°C")), row("Highest", num(s.max_temp, 0, "°C"))]),
    group("Best efforts", d.best.map((b) => row(b.label, `${fmtDuration(b.s)}<small>${fmtPace(b.s / b.m * 1000)}</small>`))),
  ];
  $("modalDetails").innerHTML = groups.join("") +
    (d.laps.length > 1 ? `<section class="dgroup wide"><h3>${lapName(d)}s</h3>${lapTable(d)}</section>` : "");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

$("syncBtn").addEventListener("click", async () => {
  $("syncBtn").disabled = true;
  $("syncBtn").textContent = "Syncing…";
  await fetch("/api/sync", { method: "POST" });
  setTimeout(load, 1500);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (data?.has_data) { renderNav(); showPage(); }
  if (modalDetail) modalMap.show(modalDetail.track, modalDetail.name || "activity", modalDetail.sport);
});
// Pick up background syncs: check every 5 minutes, and right away when the tab comes back into view.
const refresh = () => { if (!document.hidden) load().catch(() => {}); };
setInterval(refresh, 5 * 60 * 1000);
document.addEventListener("visibilitychange", refresh);
load().catch(() => {
  $("notice").className = "notice";
  $("notice").textContent = "Couldn't reach the dashboard server. Check that python backend/app.py is still running.";
  $("notice").hidden = false;
});
