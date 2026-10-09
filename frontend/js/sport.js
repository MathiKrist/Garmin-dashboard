// Sport pages: one sport's totals, how its volume has developed, its personal bests and its activities

import { data } from "./state.js";
import { $, css, fmtShort, fmtDuration, fmtPace, plural, sum, between, fmtKm, mondayOf, statItems, addDays, fmtHours, escapeHtml } from "./util.js";
import { partialColors, baseOptions, draw } from "./charts.js";
import { sportLabel, sportColor, SPORT_NOUNS, weekStarts, lowShare, weeklyChart, PAGE, KMH_SPORTS, COLUMNS, DEFAULT_SORT, sortRows, nextSort, tableParts, measureFor } from "./sports.js";

let sportShown = PAGE, sportShownKey = null, sportSort = DEFAULT_SORT;

export function renderSport(key) {
  Chart.defaults.font.family = css("--body");
  const list = data.activities.filter((a) => a.sport === key);  // newest first
  const label = sportLabel(key), today = data.generated, m = measureFor(list), nouns = SPORT_NOUNS[key];
  if (sportShownKey !== key) { sportShown = PAGE; sportShownKey = key; sportSort = DEFAULT_SORT; }
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

  const t = tableParts(sortRows(list, sportSort).slice(0, sportShown), key, sportSort);
  $("sportHead").innerHTML = t.head;
  $("sportBody").innerHTML = t.body;
  $("sportMore").hidden = list.length <= sportShown;
  $("sportMore").textContent = `Show more (${list.length - sportShown} left)`;
}

// Volume per week for the last 26 weeks (or the 26 up to the latest one, for a sport done in a season)
export function renderSportWeekly(key, list, m) {
  const latest = list[0].date, current = latest >= weekStarts(26)[0];
  $("sportWeeklyTitle").textContent = `${m.unit} per week`;
  $("sportWeeklySub").textContent = !current ? `Up to ${fmtShort(latest)} ${latest.slice(0, 4)}.` : key === "run" ? lowShare(list) : "";
  weeklyChart("sportWeeklyChart", "sportWeeklyLegend", key, list, weekStarts(26, current ? data.generated : latest), m);
}

// Running total through the year, this year against last year, on a shared January-to-December axis
export function renderYearOnYear(key, list, m) {
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
export function renderMonthly(key, list, m) {
  const y = Number(data.generated.slice(0, 4)), month = data.generated.slice(5, 7);
  const perMonth = (year) => [...Array(12)].map((_, i) => {
    const mo = `${year}-${String(i + 1).padStart(2, "0")}`;
    if (year === y && mo.slice(5) > month) return null;  // months still to come
    const as = list.filter((a) => a.date.startsWith(mo));
    return m.byKm ? +sum(as, "km").toFixed(1) : +(sum(as, "duration_s") / 3600).toFixed(2);
  });
  const now = perMonth(y), before = perMonth(y - 1), thisMonth = Number(month) - 1;
  $("sportMonthSection").hidden = !now.some(Boolean) && !before.some(Boolean);
  if ($("sportMonthSection").hidden) return;
  const color = sportColor(key), grey = css("--nohr");
  $("sportMonthTitle").textContent = `${m.unit} per month`;
  $("sportMonthLegend").innerHTML = `<span><i style="background:${color}"></i>${y}</span><span><i style="background:${grey}"></i>${y - 1}</span>`;
  $("sportMonthChart").setAttribute("aria-label", `${m.unit} per month, ${y} against ${y - 1}`);
  const fmt = (v) => (m.byKm ? `${fmtKm(v)} km` : fmtHours(v * 3600));
  const o = baseOptions();
  o.plugins.tooltip.callbacks = { label: (c) => (c.parsed.y == null ? null
    : ` ${c.dataset.label}: ${fmt(c.parsed.y)}${c.dataset.label === String(y) && c.dataIndex === thisMonth ? " so far" : ""}`) };
  const bar = { borderRadius: 2, maxBarThickness: 26, categoryPercentage: 0.7, barPercentage: 0.9 };
  draw("sportMonthChart", {
    type: "bar",
    data: {
      labels: [...Array(12)].map((_, i) => new Date(2000, i, 15).toLocaleDateString("en-GB", { month: "short" })),
      datasets: [
        { label: String(y - 1), data: before, backgroundColor: grey, ...bar },
        { label: String(y), data: now, backgroundColor: partialColors(color, now.map((_, i) => i === thisMonth)), ...bar },
      ],
    },
    options: o,
  });
}

// The sport's bests: longest, fastest, highest; each opens its activity
export function renderRecords(key, list) {
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
    Object.entries(data.distances).forEach(([mtr, name]) => {
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

$("sportMore").addEventListener("click", () => { sportShown += PAGE; renderSport(sportShownKey); });

$("sportHead").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sort]");
  if (!b) return;
  sportSort = nextSort(sportSort, b.dataset.sort);
  renderSport(sportShownKey);
});
