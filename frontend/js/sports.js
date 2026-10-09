// Sports and activity tables: grouping, labels, columns, weekly volume and the This week / This year panel

import { data } from "./state.js";
import { $, css, fmtDay, fmtDayYear, fmtShort, fmtDuration, fmtPace, plural, sum, between, fmtKm, mondayOf, statusLabel, addDays, fmtHours, escapeHtml } from "./util.js";
import { stackedBarOptions, barStyle, partialColors, draw } from "./charts.js";

export function sportCounts() {
  const counts = {};
  data.activities.forEach((a) => { counts[a.sport] = (counts[a.sport] || 0) + 1; });
  return counts;
}

// The sports you have, most-used first, "Other" always last: [[key, label], ...]
export function sportsByCount(counts = sportCounts()) {
  return data.sports.filter(([key]) => counts[key])
    .sort((a, b) => (a[0] === "other") - (b[0] === "other") || counts[b[0]] - counts[a[0]]);
}

export const sportLabel = (key) => data.sports.find(([k]) => k === key)?.[1] || "Other";

// Sports with a page of their own: done at least 3 times, and with something to follow over time. One-offs, Other
// (a mix of types) and disc golf (Garmin keeps no scores) stay in the activities list instead.
export const NO_PAGE = ["other", "disc_golf"];

export const hasPage = (key, counts = sportCounts()) => counts[key] >= 3 && !NO_PAGE.includes(key);

// The sport's color in the menu and on its page (sports without one use the neutral grey)
export const sportColor = (key) => css(`--sp-${key}`) || css("--nohr");

// What each sport's activities are called in a sentence
export const SPORT_NOUNS = {
  run: ["run", "runs"], bike: ["ride", "rides"], walk: ["walk", "walks"], hike: ["hike", "hikes"], swim: ["swim", "swims"],
  strength: ["strength session", "strength sessions"], cardio: ["cardio session", "cardio sessions"],
  disc_golf: ["round of disc golf", "rounds of disc golf"], yoga: ["yoga session", "yoga sessions"],
  winter: ["day on snow", "days on snow"], other: ["other activity", "other activities"],
};

// Mondays of the `n` weeks up to the week of `end` (today by default)
export const weekStarts = (n, end = data.generated) => [...Array(n)].map((_, i) => addDays(mondayOf(end), -7 * (n - 1 - i)));

// The share of the last 4 weeks' running kilometres that Garmin rated low aerobic, as a sentence
export function lowShare(runs) {
  const recent = runs.filter((a) => a.date > addDays(data.generated, -28));
  const low = sum(recent.filter((a) => a.focus === "low"), "km"), known = sum(recent.filter((a) => a.focus), "km");
  return known ? `Last 4 weeks: ${Math.round(low / known * 100)}% low aerobic.` : "";
}

// Volume per week in `canvas` (km or hours, by `m`); runs are split by Garmin's training effect, like the load focus
export function weeklyChart(canvas, legend, key, list, starts, m) {
  const val = (as) => (m.byKm ? +sum(as, "km").toFixed(1) : +(sum(as, "duration_s") / 3600).toFixed(2));
  const inWeek = (w) => list.filter((a) => mondayOf(a.date) === w);
  const fmt = (v) => (m.byKm ? `${v} km` : fmtHours(v * 3600));
  const thisWeek = mondayOf(data.generated), partial = starts.map((w) => w === thisWeek);
  let sets;
  if (key === "run") {
    sets = FOCUS.map(([f, name, color]) => ({ label: name, data: starts.map((w) => val(inWeek(w).filter((a) => a.focus === f))), color: css(color) }));
    const unknown = starts.map((w) => val(inWeek(w).filter((a) => !a.focus)));
    if (unknown.some(Boolean)) sets.push({ label: "Unknown", data: unknown, color: css("--nohr") });
  } else {
    sets = [{ label: sportLabel(key), data: starts.map((w) => val(inWeek(w))), color: sportColor(key) }];
  }
  // A single series needs no legend: the title names it
  $(legend).innerHTML = sets.length > 1 ? sets.map((x) => `<span><i style="background:${x.color}"></i>${x.label}</span>`).join("") : "";
  $(canvas).setAttribute("aria-label", `${m.unit} of ${sportLabel(key).toLowerCase()} per week, last ${starts.length} weeks`);
  draw(canvas, {
    type: "bar",
    data: { labels: starts.map((w) => fmtShort(w)),
      datasets: sets.map(({ color, ...x }) => ({ ...x, backgroundColor: partialColors(color, partial), ...barStyle() })) },
    options: stackedBarOptions({
      title: (items) => `Week of ${fmtShort(starts[items[0].dataIndex])}${partial[items[0].dataIndex] ? " (so far)" : ""}`,
      label: (c) => (c.parsed.y ? ` ${c.dataset.label}: ${fmt(c.parsed.y)}` : null),
      footer: (items) => {
        const as = inWeek(starts[items[0].dataIndex]);
        return as.length ? `${plural(as.length, SPORT_NOUNS[key])}, ${fmtHours(sum(as, "duration_s"))}` : "";
      },
    }),
  });
}

// Garmin's load focus groups: [key, label, color token]
export const FOCUS = [["low", "Low aerobic", "--low-aerobic"], ["high", "High aerobic", "--high-aerobic"], ["anaerobic", "Anaerobic", "--anaerobic"]];

// The sport's table columns minus ascent and load, with the unit set small ("5.08 km" -> 5.08 <span>km</span>)
export function headlineStats(a) {
  return (SPORT_COLUMNS[a.sport] || SPORT_COLUMNS.other)
    .filter((key) => !["date", "name", "effect", "ascent", "load"].includes(key))
    .map((key) => [COLUMNS[key][0], String(COLUMNS[key][2](a))])
    .filter(([, v]) => v !== "")
    .map(([label, v]) => `<div><dd>${v.replace(/\s(\S*[a-z]\S*)$/i, "<span>$1</span>")}</dd><dt>${label}</dt></div>`)
    .join("");
}

export const PAGE = 25;

// Pace for foot sports, per 100 m in the pool; speed on the bike (only mixed in the All list)
// Sports measured in km/h rather than a pace
export const KMH_SPORTS = ["bike", "winter"];

export function fmtSpeed(a) {
  if (!a.speed) return "";
  if (KMH_SPORTS.includes(a.sport)) return `${(a.speed * 3.6).toFixed(1)} km/h`;
  if (a.sport === "swim") return fmtPace(100 / a.speed).replace("/km", "/100m");
  if (["run", "walk", "hike"].includes(a.sport)) return fmtPace(1000 / a.speed);
  return "";
}

// Garmin's label where there is one; for runs without it, the focus from average HR (marked as such).
// Only for endurance sports: on strength, yoga or a walk the label says little.
export const EFFECT_SPORTS = ["run", "bike", "swim", "cardio"];

export function effectCell(a) {
  let name, group;
  if (!EFFECT_SPORTS.includes(a.sport)) return "";
  if (a.te_label) {
    [name, group] = data.effects[a.te_label] || [statusLabel(a.te_label), ""];  // Garmin's label -> [name, load focus group]
  } else if (a.focus) {
    name = `${FOCUS.find((f) => f[0] === a.focus)[1]} (HR)`;
    group = a.focus;
  } else {
    return "";
  }
  return `<span class="dot ${group}" aria-hidden="true"></span>${name}`;
}

// Table columns: key -> [header, right-aligned, cell]. A cell returns "" when it has nothing to show.
export const COLUMNS = {
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
export const SPORT_COLUMNS = {
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

// The sport's columns for these rows, minus any that are empty for every row (e.g. sets when Garmin didn't record them)
// What a column sorts by. Numbers sort biggest first on the first click (pace: fastest first), text A to Z.
const SORT_VALUES = {
  date: (a) => a.start || a.date,
  name: (a) => (a.name || a.type).toLowerCase(),
  distance: (a) => a.km || null,
  time: (a) => a.duration_s,
  pace: (a) => a.speed,
  speed: (a) => a.speed,
  ascent: (a) => a.elev_m,
  descent: (a) => a.descent_m,
  sets: (a) => a.sets,
  reps: (a) => a.reps,
  hr: (a) => a.avg_hr,
  load: (a) => a.load || null,
};
// The activity list's order: newest first until a column header is clicked
export const DEFAULT_SORT = { col: "date", desc: true };

// The rows in the order `sort` asks for; rows without a value go last either way
export function sortRows(rows, sort) {
  const value = SORT_VALUES[sort.col];
  if (!value) return rows;
  return rows.slice().sort((a, b) => {
    const x = value(a), y = value(b);
    if (x == null || y == null) return (x == null) - (y == null);
    return (x < y ? -1 : x > y ? 1 : 0) * (sort.desc ? -1 : 1);
  });
}

// A click on a sortable header: the same column flips direction, a new one starts biggest first (A to Z for names)
export function nextSort(sort, col) {
  return col === sort.col ? { col, desc: !sort.desc } : { col, desc: col !== "name" };
}

// "Thu 8 Oct" with the weekday in its own span, which phones leave out (styles.css)
const weekdaySpan = (date) => date.replace(/^(\S+) /, '<span class="weekday">$1 </span>');

// The table for these rows. With `sort`, the headers are buttons that sort the list (see nextSort).
export function tableParts(rows, key, sort = null) {
  const cols = (SPORT_COLUMNS[key] || SPORT_COLUMNS.other).map((k) => [k, ...COLUMNS[k]])
    .filter(([k, , , cell]) => k === "date" || k === "name" || rows.some((a) => cell(a) !== ""));
  if (key === "all") cols.find((c) => c[0] === "pace")?.splice(1, 1, "Pace / speed");
  // A class per column, so narrow screens can leave some out (styles.css)
  const cls = (k, num) => ` class="col-${k}${num ? " num" : ""}"`;
  const th = (k, head, num) => {
    if (!sort || !SORT_VALUES[k]) return `<th${cls(k, num)}>${head}</th>`;
    const on = sort.col === k, dir = sort.desc ? "descending" : "ascending";
    return `<th${cls(k, num)}${on ? ` aria-sort="${dir}"` : ""}><button type="button" class="sort" data-sort="${k}">${head}` +
      `<span aria-hidden="true">${on ? (sort.desc ? " ↓" : " ↑") : ""}</span></button></th>`;
  };
  return {
    head: `<tr>${cols.map(([k, head, num]) => th(k, head, num)).join("")}</tr>`,
    // The whole row opens the activity; the name is a button so it can be reached with the keyboard too
    body: rows.map((a) => `<tr data-id="${a.id}">${cols.map(([k, , num, cell]) => k === "name"
      ? `<td class="name col-name"><button type="button" class="act-link">${cell(a)}</button></td>`
      : `<td${cls(k, num)}>${k === "date" ? weekdaySpan(cell(a)) : cell(a)}</td>`).join("")}</tr>`).join(""),
    width: cols.length,
  };
}

// Strava-style totals for a list of activities in the `root` panel: this week day by day, and this year.
// For one sport (`key`) with distances, also the longest one this week and this year.
export function renderVolume(root, list, label, key) {
  if (!root.firstElementChild) root.append($("volumeTemplate").content.cloneNode(true));  // the panel's markup, once
  const q = (cls) => root.querySelector(`.${cls}`);
  const today = data.generated, monday = mondayOf(today), year = today.slice(0, 4);
  // Distance where the sport has it (running, cycling…), otherwise time (strength, yoga…), like the weekly chart
  const { byKm, of: value, big, small } = measureFor(list);
  const count = (n) => `${n} ${n === 1 ? "activity" : "activities"}`;

  q("vol-sport").textContent = label;

  const week = between(list, monday, addDays(monday, 7));
  q("vol-week").innerHTML = big(value(week));
  const prev4 = value(between(list, addDays(monday, -28), monday)) / 4;
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

// Distance for sports that record it, time for the rest
export function measureFor(list) {
  const byKm = sum(list, "km") > 0;
  return byKm
    ? { byKm, of: (as) => sum(as, "km"), big: (v) => `${fmtKm(v)}<span>km</span>`, small: (v) => `${fmtKm(v)} km`, unit: "Kilometres" }
    : { byKm, of: (as) => sum(as, "duration_s"), big: (v) => fmtHours(v).replace(/(\d+)([hm])/g, "$1<span>$2</span>"), small: fmtHours, unit: "Hours" };
}
