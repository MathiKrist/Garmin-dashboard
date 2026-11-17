// Progress: the athlete's story, then the big picture of fitness and training

import { data } from "./state.js";
import { $, css, fmtDay, fmtShort, round, fmtDuration, plural, sum, between, fmtKm, listText, statusLabel, fromDay, alpha, addDays, fmtHours } from "./util.js";
import { baseOptions, draw, monthTicks } from "./charts.js";
import { sportCounts, sportsByCount, sportLabel, hasPage, SPORT_NOUNS, weekStarts, lowShare, weeklyChart, FOCUS, measureFor } from "./sports.js";
import { sportIcon, icon } from "./icons.js";
import { renderRace } from "./race.js";
import { renderCalendar } from "./calendar.js";

// Your main sport: the one you do most
export const mainSport = () => sportsByCount().find(([key]) => key !== "other")?.[0];

export function renderProgress() {
  renderStory();
  renderRace();
  renderForm();
  renderTrainingStatus();
  renderFitnessCharts();
  renderCalendar();
  renderSportCards();
  // The main sport's weekly chart
  const main = mainSport();
  $("weeklySection").hidden = !main;
  if (!main) return;
  const list = data.activities.filter((a) => a.sport === main), m = measureFor(list);
  $("weeklyTitle").textContent = `Weekly ${sportLabel(main).toLowerCase()}`;
  $("weeklySub").textContent = main === "run" ? lowShare(list) : "";
  weeklyChart("weeklyChart", "weeklyLegend", main, list, weekStarts(12), m);
}

// The sports with a page of their own, each with this year so far; a card opens its page
function renderSportCards() {
  const counts = sportCounts(), sports = sportsByCount(counts).filter(([key]) => hasPage(key, counts));
  $("sportsSection").hidden = !sports.length;
  const year = data.generated.slice(0, 4);
  $("sportCards").innerHTML = sports.map(([key, label]) => {
    const list = data.activities.filter((a) => a.sport === key && a.date.startsWith(year)), m = measureFor(list);
    return `<a class="sport-card" href="#sport/${key}">${sportIcon(key)}
      <span class="sc-main"><b>${label}</b><span>${plural(list.length, SPORT_NOUNS[key])} this year</span></span>
      <span class="sc-big">${list.length ? m.big(m.of(list)) : ""}</span>${icon("chevron")}</a>`;
  }).join("");
}

// Every run's personal best events, oldest first: [{m, s, a}] whenever a run beat the best so far over a distance.
// A distance's first time doesn't count, as there was nothing to beat.
export function pbEvents() {
  const best = {}, events = [];
  data.activities.filter((a) => a.sport === "run" && a.best).slice().reverse().forEach((a) => {
    Object.entries(a.best).forEach(([m, s]) => {
      if (!(m in data.distances)) return;
      if (best[m] != null && s < best[m]) events.push({ m, s, a });
      if (best[m] == null || s < best[m]) best[m] = s;
    });
  });
  return events;
}

export const pbText = (e) => `${data.distances[e.m]} in ${fmtDuration(e.s)}`;

// A few sentences on what the page's sections don't show: personal bests, the year so far and the recent trend in
// training hours (training status and VO2 max have sections of their own)
export function renderStory() {
  const parts = [], today = data.generated;
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
  $("storyCard").hidden = !parts.length;
}

// Garmin's own colors per status
export const STATUS_COLORS = {
  PEAKING: "--st-peaking", PRODUCTIVE: "--st-productive", MAINTAINING: "--st-maintaining",
  RECOVERY: "--st-recovery", UNPRODUCTIVE: "--st-unproductive", STRAINED: "--st-strained",
  OVERREACHING: "--st-overreaching", DETRAINING: "--st-detraining",
};

export const statusColor = (code) => `var(${STATUS_COLORS[code] || "--nohr"})`;

export function renderLoadFocus() {
  const lf = data.load_focus;
  $("focus").hidden = !lf;
  if (!lf) return;
  $("focusEyebrow").textContent = ["Garmin load focus · last 4 weeks", fromDay(lf.as_of)].filter(Boolean).join(" · ");
  $("focusTitle").textContent = lf.title;
  const zoneColor = (key) => FOCUS.find((f) => f[0] === key)?.[2];
  $("focusTitle").style.setProperty("--focus-color", lf.zone ? "var(--accent)" : "var(--ink)");
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

export function renderTrainingStatus() {
  const ts = data.training_status;
  $("tstatus").hidden = !ts && !data.load_focus;
  $("tsMain").hidden = !ts;
  renderLoadFocus();
  if (!ts) return;
  $("tsEyebrow").textContent = ["Garmin training status", fromDay(ts.as_of)].filter(Boolean).join(" · ");
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
  $("tsFacts").textContent = facts.join(" · ");

  // The last 28 days in blocks of 7, counted back from today
  const weeks = [0, 7, 14, 21].map((i) => ts.history.slice(i, i + 7));
  $("tsWeeks").innerHTML = weeks.map((week, w) => {
    const days = week.map((d) => {
      const style = d.status ? ` style="background:${statusColor(d.status)}"` : "";
      return `<i class="${d.date === data.generated ? "today" : ""}"${style} title="${fmtDay(d.date)}: ${statusLabel(d.status)}"></i>`;
    }).join("");
    // "21–27 Oct", or "28 Oct–3 Nov" across two months
    const [a, b] = [week[0].date, week[6].date];
    const label = w === 3 ? "Last 7 days" : `${a.slice(5, 7) === b.slice(5, 7) ? +a.slice(8) : fmtShort(a)}–${fmtShort(b)}`;
    return `<div class="week"><div class="days">${days}</div><span>${label}</span></div>`;
  }).join("");
  $("tsWeeks").setAttribute("aria-label", "Training status per day, last 4 weeks: " +
    ts.history.filter((d) => d.status).map((d) => `${fmtShort(d.date)} ${statusLabel(d.status)}`).join(", "));

  const seen = Object.keys(STATUS_COLORS).filter((code) => ts.history.some((d) => d.status === code));
  $("tsLegend").innerHTML = seen.map((code) => `<span><i style="background:${statusColor(code)}"></i>${statusLabel(code)}</span>`).join("");
}

export const FORM_COLORS = { Rested: "--hard", Fresh: "--easy", Balanced: "--nohr", Building: "--fitness", Overloaded: "--fatigue" };

// One plain-language sentence on the fitness trend over the last four weeks.
export function fitnessReading(f) {
  const fx = data.fitness;
  if (f.ctl < 5 || fx.length < 29) return "";
  const now = Math.round(f.ctl), before = Math.round(fx[fx.length - 29].ctl);
  if (!before) return `Fitness ${now}, up from 0 four weeks ago.`;
  const change = Math.round((now - before) / before * 100);
  if (Math.abs(change) < 3) return `Fitness ${now}, about the same as four weeks ago.`;
  return `Fitness ${now}, ${change > 0 ? "up" : "down"} from ${before} four weeks ago (${change > 0 ? "+" : ""}${change}%).`;
}

// Form in words: "Building (−14%)"
export const formText = (f) => (f.pct != null ? `${f.state} (${f.pct > 0 ? "+" : "−"}${Math.abs(Math.round(f.pct))}%)` : f.state);

export const formColor = (f) => `var(${FORM_COLORS[f.state] || "--ink"})`;

function renderForm() {
  const f = data.form;
  $("state").textContent = formText(f);
  $("state").style.setProperty("--state-color", formColor(f));
  $("fitnessReading").textContent = fitnessReading(f);
}

// Today's calories so far as a ring: active against resting, the total in the middle
export function renderCalRing() {
  const t = data.today, ring = $("calRing");
  ring.hidden = t.cal_total == null;
  if (ring.hidden) return;
  const fmt = (v) => Math.round(v).toLocaleString("en-GB");
  const active = t.cal_active || 0, resting = t.cal_resting ?? t.cal_total - active;
  const r = 52, c = 2 * Math.PI * r, share = Math.min(1, active / t.cal_total);
  const from = t.dates.cal_total === data.generated ? "Burnt today" : `Burnt ${fmtDay(t.dates.cal_total)}`;
  ring.innerHTML = `
    <svg viewBox="0 0 120 120" role="img" aria-label="${fmt(t.cal_total)} kcal: ${fmt(active)} active, ${fmt(resting)} resting">
      <circle cx="60" cy="60" r="${r}" class="cal-rest"/>
      <circle cx="60" cy="60" r="${r}" class="cal-active" stroke-dasharray="${(share * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 60 60)"/>
      <text x="60" y="60" class="cal-total">${fmt(t.cal_total)}</text>
      <text x="60" y="78" class="cal-unit">kcal</text>
    </svg>
    <div class="cal-key">
      <p class="eyebrow">${from}</p>
      <p><i class="active"></i><b>${fmt(active)}</b> active</p>
      <p><i></i><b>${fmt(resting)}</b> resting</p>
    </div>`;
}

// The fitness chart's period: 120 days or the year the server sends, remembered per device
let fitnessDays = 120;
try { fitnessDays = Number(localStorage.getItem("fitnessDays")) || 120; } catch {}

$("fitnessRange").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-days]");
  if (!b) return;
  fitnessDays = Number(b.dataset.days);
  try { localStorage.setItem("fitnessDays", fitnessDays); } catch {}
  renderFitnessCharts();
});

export function renderFitnessCharts() {
  const fit = css("--accent");
  $("fitnessRange").querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.days) === fitnessDays)));
  $("fitnessChart").setAttribute("aria-label", `Fitness and fatigue over the last ${fitnessDays === 120 ? "120 days" : "year"}`);

  // Fitness and fatigue on one scale: the gap between them is form, shaded orange where fitness is ahead (positive
  // form) and grey where fatigue is
  const fx = data.fitness.slice(-fitnessDays), fat = css("--muted");
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
        { label: "Fitness", data: fx.map((d) => d.ctl), borderColor: fit, backgroundColor: fit, borderWidth: 2.5,
          tension: 0.3, ...last(fit) },
        { label: "Fatigue", data: fx.map((d) => d.atl), borderColor: fat, backgroundColor: fat, borderWidth: 1.5, tension: 0.3, ...last(fat),
          fill: { target: 0, above: alpha(fat, 0.16), below: alpha(fit, 0.16) } },
      ],
    },
    options: o,
  });

  renderVo2max();
}

// One plain-language sentence on where VO2 max stands against 3 and 12 months ago.
export function vo2Reading(v) {
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

export function renderVo2max() {
  const v = data.vo2max;
  $("vo2Section").hidden = !v;
  if (!v) return;
  $("vo2Reading").textContent = vo2Reading(v);
  const fit = css("--accent");
  const vals = v.weeks.map((x) => x.vo2max).filter((x) => x != null);
  const o = baseOptions({
    y: { suggestedMin: Math.floor(Math.min(...vals) - 1), suggestedMax: Math.ceil(Math.max(...vals) + 1),
      grid: { color: css("--rule") }, ticks: { color: css("--muted"), precision: 0 }, border: { display: false } },
  });
  // One tick at the first week of a month, as many months as the chart has room for; the tooltip names the week
  const sameYear = v.weeks[0].week.slice(0, 4) === data.generated.slice(0, 4);
  const fmtMonth = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", sameYear ? { month: "short" } : { month: "short", year: "2-digit" });
  const month = (i) => v.weeks[i].week.slice(0, 7);
  const firsts = v.weeks.map((_, i) => i).filter((i) => i > 0 && month(i) !== month(i - 1));
  const shown = monthTicks("vo2Chart", firsts, sameYear ? 34 : 52);
  o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false, callback: (i) => (shown.has(i) ? fmtMonth(v.weeks[i].week) : null) };
  o.plugins.tooltip.callbacks = {
    title: (items) => `Week of ${fmtShort(v.weeks[items[0].dataIndex].week)}`,
    label: (c) => ` VO2 max: ${c.parsed.y.toFixed(1)}`,
  };
  draw("vo2Chart", {
    type: "line",
    data: {
      labels: v.weeks.map((x) => x.week),
      datasets: [{ label: "VO2 max", data: v.weeks.map((x) => x.vo2max), borderColor: fit, backgroundColor: alpha(fit, 0.1),
        fill: "start", borderWidth: 2.5, spanGaps: true,
        tension: 0.4, cubicInterpolationMode: "monotone",  // smooth curve that never overshoots past the real values
        pointRadius: v.weeks.map((_, i) => (i === v.weeks.length - 1 ? 4 : 0)), pointBackgroundColor: fit }],
    },
    options: o,
  });
}
