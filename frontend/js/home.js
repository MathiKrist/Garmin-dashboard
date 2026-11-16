// Home: this week at a glance, the latest activity, today's session, then where fitness, the race goal and
// recovery stand. Each card opens the page that has the rest.

import { data } from "./state.js";
import { $, fmtDay, fmtDayYear, fmtDuration, fmtHours, plural, sum, between, mondayOf, addDays, statItems, escapeHtml } from "./util.js";
import { routeMap } from "./map.js";
import { lastCard, actRows, sportLabel, hasPage, measureFor, weekBars, SPORT_NOUNS } from "./sports.js";
import { mainSport, formText, formColor, fitnessReading, statusColor } from "./progress.js";
import { todayItems, staleDay } from "./health.js";
import { icon } from "./icons.js";
import { currentSport, total, barHtml, watchRequest } from "./workout.js";
import { raceDistance } from "./race.js";

export const lastMap = routeMap($("lastMap"), { preview: true });

export function renderHome() {
  $("homeDate").textContent = new Date(data.generated + "T12:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  renderWeek();
  lastCard($("lastAct"), data.last_activity, lastMap, "Latest activity");
  renderToday();
  renderFitness();
  renderRaceCard();
  const items = todayItems().slice(0, 4);
  $("homeRecovery").hidden = !items.length;
  $("todayFrom").textContent = staleDay() ? `from ${fmtDay(staleDay())}` : "this morning";
  $("today").innerHTML = statItems(items);
  // The activities before the latest one
  const rest = data.activities.filter((a) => a.id !== data.last_activity?.id).slice(0, 5);
  $("homeRecent").hidden = !rest.length;
  $("recentList").innerHTML = actRows(rest);
}

// This week in your main sport as a ring: against the plan's week when a plan sets one in km, else against the
// average of the last four weeks. Under it, the week day by day.
function renderWeek() {
  const main = mainSport(), el = $("homeWeek");
  el.hidden = !main;
  if (!main) return;
  const list = data.activities.filter((a) => a.sport === main), m = measureFor(list);
  const monday = mondayOf(data.generated), next = addDays(monday, 7);
  const week = between(list, monday, next), done = m.of(week);
  const p = data.plan, planned = p && !p.multi && main === "run" && m.byKm && p.week_index != null ? p.weeks[p.week_index].km_planned : 0;
  const goal = planned || m.of(between(list, addDays(monday, -28), monday)) / 4;
  const pct = goal ? Math.round(done / goal * 100) : null;
  const r = 33, c = 2 * Math.PI * r;
  const note = [plural(week.length, SPORT_NOUNS[main])];
  if (m.byKm && week.length) note.push(fmtHours(sum(week, "duration_s")));
  const others = between(data.activities, monday, next).length - week.length;
  if (others) note.push(`${others} other ${others === 1 ? "activity" : "activities"}`);
  const bars = weekBars(list, m.of, m.small, sportLabel(main));
  el.href = hasPage(main) ? `#sport/${main}` : "#activities";
  el.innerHTML = `
    <div class="week-top">
      <svg class="ring${pct >= 100 ? " full" : ""}" viewBox="0 0 80 80" role="img" aria-label="${pct == null ? "No goal yet" : `${pct}% of the week's goal`}">
        <circle cx="40" cy="40" r="${r}" class="ring-track"/>
        <circle cx="40" cy="40" r="${r}" class="ring-fill" stroke-dasharray="${(Math.min(1, (pct || 0) / 100) * c).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 40 40)"/>
        <text x="40" y="45" class="ring-pct">${pct == null ? "–" : `${pct}%`}</text>
      </svg>
      <div class="week-main">
        <p class="eyebrow">This week · ${sportLabel(main)}</p>
        <p class="week-big">${m.big(done)}${goal ? `<small>of ${m.small(goal)}</small>` : ""}</p>
        <p class="week-note">${note.join(" · ")}</p>
      </div>
    </div>
    <div class="vol-days" role="img" aria-label="${bars.label}">${bars.html}</div>
    <p class="week-goal">${!goal ? "" : planned ? `The plan has ${m.small(goal)} this week` : `Your last four weeks averaged ${m.small(goal)}`}</p>`;
}

// Today's session for the sport last looked at on Train, with its shape; sent to the watch from here too
function renderToday() {
  const list = data.workouts || [], w = list.find((x) => x.sport === currentSport()) || list[0], el = $("homeToday");
  el.hidden = !w;
  if (!w) return;
  const rest = !w.steps.length;
  const size = rest ? (w.next ? `Next: ${escapeHtml(w.next.title)}, ${fmtDay(w.next.date)}` : "")
    : [w.total_s ? total(w.total_s) : "", w.km ? `about ${w.km.toFixed(1)} km` : ""].filter(Boolean).join(" · ");
  const state = w.done ? '<span class="done">Done ✓</span>' : w.sent ? '<span class="done">On the watch ✓</span>'
    : rest ? "" : `<button type="button" class="primary" id="homeSend" data-sport="${w.sport}" data-send="Send to watch">${icon("watch")}Send to watch</button>`;
  el.innerHTML = `
    <a class="today-link" href="#train">
      <p class="eyebrow">Today · ${escapeHtml(w.label || "Run")}</p>
      <h2 id="homeTodayTitle">${escapeHtml(w.title)}</h2>
      <p class="today-total">${size}</p>
      ${rest ? "" : `<div class="wk-bar" role="img" aria-label="The session's shape">${barHtml(w.steps, w.kind)}</div>`}
    </a>
    <div class="wk-send">${state}<span id="homeSendNote" role="status"></span><a class="more-link" href="#train">${rest ? "Plan" : "Steps"}</a></div>`;
}

$("homeToday").addEventListener("click", (e) => {
  const btn = e.target.closest("#homeSend");
  if (!btn) return;
  const w = data.workouts.find((x) => x.sport === btn.dataset.sport);
  watchRequest(btn, $("homeSendNote"), "POST", `/api/workout/${w.sport}`, { title: w.title });
});

// Fitness as a number with its last 12 weeks as a line, Garmin's training status and today's form
function renderFitness() {
  const f = data.form, fx = (data.fitness || []).slice(-84), el = $("homeFitness");
  el.hidden = fx.length < 14 || f.ctl < 1;
  if (el.hidden) return;
  const vals = fx.map((d) => d.ctl), lo = Math.min(...vals), hi = Math.max(...vals), span = hi - lo || 1;
  const W = 300, H = 56, pad = 5;
  const pts = vals.map((v, i) => [(i / (vals.length - 1)) * W, pad + (1 - (v - lo) / span) * (H - 2 * pad)]);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join("");
  const [ex, ey] = pts[pts.length - 1];
  const ts = data.training_status;
  const reading = fitnessReading(f).replace(/^Fitness \d+, /, "").replace(/^./, (ch) => ch.toUpperCase());
  el.innerHTML = `
    <div class="section-head"><h2>Fitness</h2>${icon("chevron")}</div>
    <div class="fit-row">
      <p class="fit-big">${Math.round(f.ctl)}</p>
      <div class="fit-chips">
        ${ts ? `<span class="chip" style="--c:${statusColor(ts.code)}">${escapeHtml(ts.label)}</span>` : ""}
        <span class="chip" style="--c:${formColor(f)}">Form: ${formText(f).toLowerCase()}</span>
      </div>
    </div>
    <div class="spark"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Fitness over the last 12 weeks">
      <path d="${line}L${W} ${H}L0 ${H}Z" class="spark-area"/><path d="${line}" class="spark-line"/>
    </svg><i class="spark-dot" style="left:${(ex / W) * 100}%;top:${(ey / H) * 100}%"></i></div>
    <p class="fit-note">${reading}</p>`;
}

// The race goal in short: how long to go, the target, and what Garmin predicts (or the result, after race day)
function renderRaceCard() {
  const r = data.race, el = $("homeRace");
  el.hidden = !r;
  if (!r) return;
  const d = r.days_to_go;
  const count = r.result ? "" : d > 1 ? `<b>${d}</b> days to go` : d === 1 ? "<b>Tomorrow</b>" : d === 0 ? "<b>Today</b>" : "";
  const gapNote = (s) => { const gap = s - r.target_s; return `<span class="${gap > 0 ? "over" : "under"}">${gap > 0 ? "+" : "−"}${fmtDuration(Math.abs(gap)) || "0:00"}</span>`; };
  const items = [["Target", fmtDuration(r.target_s), ""]];
  if (r.result) items.push(["Result", fmtDuration(r.result.s), gapNote(r.result.s)]);
  else if (r.predicted_s) items.push(["Garmin predicts", fmtDuration(r.predicted_s), r.predicted_s > r.target_s ? gapNote(r.predicted_s) : '<span class="under">On target</span>']);
  el.innerHTML = `
    <div class="section-head"><h2>${escapeHtml(r.name)}</h2>${icon("chevron")}</div>
    <p class="race-count">${count}<span>${raceDistance(r.metres)} · ${fmtDayYear(r.date)}</span></p>
    <dl class="tiles two">${statItems(items)}</dl>`;
}
