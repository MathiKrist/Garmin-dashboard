// Training plan, on the workout page: weeks of runs (and rides and swims if picked) toward a race,
// a triathlon or general fitness (worked out on the server), the time it projects, and the button that sends the
// coming week to the watch

import { data } from "./state.js";
import { $, fmtDay, fmtShort, fmtDuration, fmtPace, fmtRange, escapeHtml, addDays } from "./util.js";
import { raceDistance, parseTime } from "./race.js";
import { total, barHtml, stepsHtml, mainPace, currentSport, setSport, todaysWorkout, showWorkout, watchButton,
  watchRequest } from "./workout.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SPORTS = [["run", "Run"], ["bike", "Bike"], ["swim", "Swim"]];

// Faster is a Volt triangle up, slower a Puls one down
const moved = (d) => `<span class="${d > 0 ? "over" : "under"}">${d > 0 ? "▼" : "▲"} ${fmtDuration(Math.abs(d))}</span>`;
const signed = (gap) => `<span class="${gap > 0 ? "over" : "under"}">${gap > 0 ? "+" : "−"}${fmtDuration(Math.abs(gap))}</span>`;

const VERDICT = { better: "Faster than planned", worse: "Slower than planned", "on plan": "On plan" };

// Each run type's colour: Volt for easy running, Puls for hard. A plan with more than runs colours by sport instead
const KIND = { easy: "easy", shakeout: "easy", recovery: "easy", long: "long", threshold: "threshold", race_pace: "threshold", vo2: "vo2",
  anaerobic: "anaerobic", race: "vo2", brick: "threshold" };
const LEGEND = [["easy", "Easy"], ["long", "Long run"], ["threshold", "Threshold"], ["vo2", "VO2 max"], ["anaerobic", "Speed"]];
const sportVar = (sport) => `var(--sp-${sport === "tri" ? "run" : sport})`;
const colorOf = (s) => (data.plan.multi ? sportVar(s.sport) : `var(--k-${KIND[s.kind] || "easy"})`);
// A triathlon's race day counts as a run day
const tabOf = (s) => (s.sport === "tri" ? "run" : s.sport);

let pick = null, week = null;  // the strip's picked session ({day, sport}) and the chart's picked week; null is today and this week

function status(s) {
  if (s.status === "done") {
    const a = s.actual;
    return `<span class="ps-done">✓ ${a.pace ? fmtPace(a.pace) : ""}</span>` +
      (a.verdict ? `<span class="verdict ${a.verdict.replace(" ", "-")}">${VERDICT[a.verdict]}${
        a.verdict !== "on plan" && a.by_hr ? " for its heart rate" : ""}</span>` : "");
  }
  if (s.status === "missed") return '<span class="ps-missed">Missed</span>';
  if (s.status === "moved") return '<span class="ps-missed">Moved later in the week</span>';
  const parts = [];
  if (s.status === "today") parts.push("<b>Today</b>");
  if (s.moved_from) parts.push(`Moved from ${DAYS[(new Date(s.moved_from + "T12:00:00").getDay() + 6) % 7]}`);
  if (s.changed) parts.push("Changed in chat");
  if (s.sent) parts.push("On the watch");
  return parts.join(" · ");
}

const sizeOf = (s) => [s.km ? `${s.km.toFixed(1)} km` : "", s.total_s ? total(s.total_s) : ""].filter(Boolean).join(" · ");

function sessionItem(s) {
  const head = `<span class="ps-day">${fmtDay(s.date)}</span><span class="ps-title"><i class="kdot" style="--c:${colorOf(s)}"></i>${escapeHtml(s.title)}</span>
    <span class="ps-size">${sizeOf(s)}</span><span class="ps-pace">${mainPace(s.steps)}</span><span class="ps-status">${status(s)}</span>`;
  if (!s.steps.length) return `<li class="ps is-${s.status}"><div class="ps-row">${head}</div></li>`;
  return `<li class="ps is-${s.status}"><details><summary class="ps-row">${head}</summary>
    <div class="ps-steps"><div class="wk-bar" role="img" aria-label="${escapeHtml(s.title)}">${barHtml(s.steps, s.kind)}</div>
    <ol class="wk-steps">${stepsHtml(s.steps, s.kind)}</ol></div></details></li>`;
}

const phaseText = (w) => data.plan.phases[w.phase] + (w.deload ? " · lighter week" : "");

// The sessions on a date, leaving out ones that moved to another day
const sessionsOn = (p, iso) => p.weeks.flatMap((w) => w.sessions).filter((s) => s.date === iso && s.status !== "moved");
const weekOf = (p, iso) => p.weeks.findIndex((w) => w.start <= iso && iso <= addDays(w.start, 6));
const hours = (h) => `${h.toFixed(1).replace(/\.0$/, "")} h`;

export function renderPlan() {
  const p = data.plan, sport = currentSport();
  // A plan shows with the sports it holds; without one, it can be set up from any of them
  const shown = !!p && (sport in p.sports || (sport === "run" && p.config.goal === "triathlon"));
  $("planAdd").hidden = !!p;
  $("planTop").hidden = $("planWeeksSec").hidden = !shown;
  if (!shown) return;
  const c = p.config, race = c.goal === "race", pr = p.projection;

  // The plan in one line
  $("planName").textContent = c.name;
  $("planProj").hidden = !p.projects;
  $("planProj").innerHTML = pr ? `<b>${fmtRange(pr.low, pr.high)}</b><span>${race ? "on race day" : raceDistance(c.metres).toLowerCase()} · ${fmtPace(pr.s / c.metres * 1000)}</span>`
    : "<span>No projection yet: needs Garmin's threshold or race prediction</span>";
  const ch = pr?.change;
  $("planChange").hidden = !pr || !p.projects;
  $("planChange").innerHTML = ch ? `${moved(pr.s - ch.from_s)}<span>${escapeHtml(ch.title)}, ${fmtShort(ch.date)}</span>` : "<span>No change yet</span>";
  $("planTarget").hidden = !(pr && c.target_s);
  if (pr && c.target_s) $("planTarget").innerHTML = `<span>Target ${fmtDuration(c.target_s)}</span>${pr.high <= c.target_s ? "<span>within reach</span>" : signed(pr.s - c.target_s)}`;
  const left = p.weeks_left, racing = race || c.goal === "triathlon";
  $("planWhen").textContent = [p.week_index != null ? `Week ${p.week_index + 1} of ${p.weeks.length}` : null,
    p.over ? "Finished" : racing ? fmtDay(c.date) : `until ${fmtShort(c.date)}`, !p.over && left > 1 ? `${left} weeks to go` : null].filter(Boolean).join(" · ");

  renderStrip(p);
  renderWeeks(p);

  const send = p.send, btn = $("planSend"), note = $("planSendNote");
  btn.hidden = !send.count;
  watchButton(btn, send.sent, "Send next 7 days");
  note.className = "";
  note.textContent = !send.count ? "" : send.sent ? `${send.count} sessions in the Garmin calendar` : `${send.count} session${send.count > 1 ? "s" : ""}`;
}

// The next 7 days, today first, one button per session (two on a day with two sports); a picked one opens in the
// workout section
function renderStrip(p) {
  const today = data.generated, dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i));
  if (!pick || !dates.includes(pick.day) || pick.day === today) pick = { day: today, sport: currentSport() };
  $("planStrip").innerHTML = dates.map((iso) => {
    const list = sessionsOn(p, iso), name = `${DAYS[(new Date(iso + "T12:00:00").getDay() + 6) % 7]} ${+iso.slice(8)}`;
    const tag = (s) => (iso === today ? '<span class="tag">Today</span>' : s?.sent ? '<span class="tag sent">✓</span>' : "");
    if (!list.length) {
      return `<div class="col"><button type="button" class="day rest" data-day="${iso}" aria-pressed="${pick.day === iso}">
        <span class="dn">${name}</span><span class="dt">Rest</span>${tag()}</button></div>`;
    }
    const picked = list.find((s) => tabOf(s) === pick.sport) || list[0];
    return `<div class="col${list.length > 1 ? " two" : ""}">${list.map((s, i) => {
      const size = sizeOf(s);
      return `<button type="button" class="day" data-day="${iso}" data-sport="${tabOf(s)}" aria-pressed="${pick.day === iso && s === picked}" style="--c:${colorOf(s)}">
        ${i === 0 ? `<span class="dn">${name}</span>` : ""}<span class="dt">${escapeHtml(s.title)}</span>
        ${size ? `<span class="dk">${size}</span>` : ""}${i === 0 ? tag(s) : ""}</button>`;
    }).join("")}</div>`;
  }).join("");
  const w = todaysWorkout();
  if (pick.day === today) { if (w) showWorkout(w); return; }
  const list = sessionsOn(p, pick.day), s = list.find((x) => tabOf(x) === pick.sport) || list[0], i = weekOf(p, pick.day);
  const why = i < 0 ? [] : [`Plan · week ${i + 1} of ${p.weeks.length} · ${phaseText(p.weeks[i]).toLowerCase()}`];
  if (s?.moved_from) why.push(`moved from ${fmtDay(s.moved_from)}`);
  if (s?.changed) why.push("changed in chat");
  if (s?.sent) why.push("on the watch");
  const next = p.weeks.flatMap((x) => x.sessions).find((x) => x.date > pick.day && x.status !== "moved");
  const label = s ? p.sports[tabOf(s)] || "Run" : w?.label || "Run";
  showWorkout(s ? { ...s, label, why } : { kind: "rest", title: "Rest day", label, steps: [], why: [], next }, pick.day);
}

// Planned km per week, each bar split by run type, or for a plan with more than runs planned hours split by sport; a
// picked bar lists its sessions below
function renderWeeks(p) {
  const now = p.week_index ?? (p.over ? p.weeks.length - 1 : 0);
  if (week == null || week >= p.weeks.length) week = now;
  const multi = p.multi, size = (w) => (multi ? w.hours_planned : w.km_planned), done = (w) => (multi ? w.hours_done : w.km_done);
  const max = Math.max(...p.weeks.map(size), 1), n = p.weeks.length, labels = n <= 16;
  const keys = multi ? Object.keys(p.sports) : ["long", "easy", "threshold", "vo2", "anaerobic"];
  $("planLegend").innerHTML = (multi ? keys.map((k) => [`sp-${k}`, p.sports[k]]) : LEGEND.map(([k, l]) => [`k-${k}`, l]))
    .map(([v, l]) => `<span><i style="background:var(--${v})"></i>${l}</span>`).join("") +
    `<span>Faded: lighter week</span><span>Line: ${multi ? "hours" : "km"} done</span>`;
  $("planChart").setAttribute("aria-label", multi ? "Planned hours per week" : "Planned km per week");
  const bars = p.weeks.map((w, i) => {
    const by = {};
    if (multi) Object.assign(by, w.by_sport);
    else for (const s of w.sessions) if (s.km && s.kind !== "race") by[KIND[s.kind] || "easy"] = (by[KIND[s.kind] || "easy"] || 0) + s.km;
    const parts = keys.filter((k) => by[k]).map((k) => `<i style="flex:${by[k]};background:var(--${multi ? "sp" : "k"}-${k})"></i>`).join("");
    const line = i <= now && done(w) ? `<b class="done" style="bottom:${Math.min(done(w) / max, 1.1) * 82}%"></b>` : "";
    const what = multi ? `${hours(w.hours_planned)} planned${i <= now ? `, ${hours(w.hours_done)} done` : ""}`
      : `${w.km_planned} km planned${i <= now ? `, ${w.km_done} done` : ""}`;
    const num = multi ? (w.hours_planned ? Math.round(w.hours_planned) : "") : Math.round(w.km_planned) || "";
    return `<button type="button" class="wbar${w.deload ? " light" : ""}" data-week="${i}" aria-pressed="${i === week}"
      aria-label="Week ${i + 1}, ${what}">
      ${labels ? `<span class="km">${num}</span>` : ""}<span class="stack" style="height:${(size(w) / max) * 82}%">${parts}</span>${line}</button>`;
  }).join("");
  // Phase names under the bars, one per run of weeks
  const phases = [];
  p.weeks.forEach((w) => (phases.length && phases.at(-1).phase === w.phase ? phases.at(-1).n++ : phases.push({ phase: w.phase, n: 1 })));
  $("planChart").style.setProperty("--n", n);
  $("planChart").innerHTML = `<div class="bars">${bars}</div>
    <div class="wnums">${p.weeks.map((_, i) => `<span${i === now ? ' class="now"' : ""}>${labels || i % 4 === 0 || i === now ? i + 1 : ""}</span>`).join("")}</div>
    <div class="wphases">${phases.map((x) => `<span style="grid-column:span ${x.n}">${p.phases[x.phase]}</span>`).join("")}</div>`;

  const w = p.weeks[week];
  const amount = multi ? (week <= now ? `${hours(w.hours_done)} of ${hours(w.hours_planned)}` : hours(w.hours_planned))
    : week <= now ? `${w.km_done} of ${w.km_planned} km` : `${w.km_planned} km`;
  $("planWeekTitle").textContent = [`Week ${week + 1} of ${n}`, fmtShort(w.start), phaseText(w), amount].join(" · ");
  $("planSessions").innerHTML = w.sessions.length ? w.sessions.map(sessionItem).join("")
    : `<li class="ps"><div class="ps-row"><span class="ps-day">${multi ? "No sessions" : "No runs"}</span></div></li>`;
}

$("planStrip").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-day]");
  if (!b) return;
  pick = { day: b.dataset.day, sport: b.dataset.sport || currentSport() };
  // Today's session of another sport: its tab, where it can be sent
  if (pick.day === data.generated && pick.sport !== currentSport()) return setSport(pick.sport);
  renderStrip(data.plan);
});

$("planChart").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-week]");
  if (!b) return;
  week = +b.dataset.week;
  renderWeeks(data.plan);
});

addEventListener("sportchange", renderPlan);

// Only this button sends the plan to Garmin, or, once the next 7 days are on it, takes the plan's sessions from today
// on off again (the watch drops them at its next sync)
$("planSend").addEventListener("click", () => {
  const btn = $("planSend"), note = $("planSendNote"), send = data.plan.send;
  if (!send.sent) return watchRequest(btn, note, "POST", "/api/plan/send", { key: send.key });
  const n = send.on_watch;
  if (confirm(`Remove the plan's ${n === 1 ? "session" : `${n} sessions`} from today on from Garmin and the watch?`)) {
    watchRequest(btn, note, "DELETE", "/api/plan/send");
  }
});

// ---- Setting the plan up

const dialog = $("planDialog");

// What each plan type asks for: a race's name and target time, a triathlon's name and distance, a distance (any, or 5
// and 10 km only), and the sports it needs
const GOAL_FIELDS = { race: { race: true, dist: "any", needs: ["run"] }, triathlon: { named: true, tri: true, needs: ["swim", "bike", "run"] },
  fitness: { dist: "any" }, maintain: { dist: "any" }, speed: { dist: "short", needs: ["run"] }, base: {}, comeback: { needs: ["run"] } };

function fillDist(which, metres) {
  const sel = $("planInDist");
  const want = metres ?? (sel.value === "custom" ? Number($("planInKm").value) * 1000 : Number(sel.value));
  const list = which === "short" ? [5000, 10000] : data.race_distances;
  sel.innerHTML = list.map((m) => `<option value="${m}">${data.distances[m]}</option>`).join("") +
    (which === "short" ? "" : '<option value="custom">Other</option>');
  sel.value = list.includes(want) ? String(want) : which === "short" ? "5000" : "custom";
  if (sel.value === "custom") $("planInKm").value = want ? +(want / 1000).toFixed(2) : "";
  $("planInKmWrap").hidden = !which || sel.value !== "custom";
}

// The days ticked for a sport in the grid, Monday first
const gridDays = (sport) => [...$("planInGrid").querySelectorAll(`input[data-sport="${sport}"]:checked`)].map((x) => +x.dataset.day);

function tick(sport, days) {
  for (const x of $("planInGrid").querySelectorAll(`input[data-sport="${sport}"]`)) x.checked = days.includes(+x.dataset.day);
}

// Rides and swims only when asked for (a triathlon always has them): their rows in the grid, their fields
const multiOn = () => $("planInMulti").checked;

// `fresh` when the plan type or the rides and swims tick just changed: rides and swims with nothing ticked yet then
// start from a usual week
function showGoal(metres, fresh = false) {
  const f = GOAL_FIELDS[$("planInGoal").value];
  if (f.tri) $("planInMulti").checked = true;
  $("planInMulti").disabled = !!f.tri;
  if (fresh && multiOn() && !gridDays("swim").length) tick("swim", [0, 2, 4]);
  if (fresh && multiOn() && !gridDays("bike").length) tick("bike", [1, 3, 5]);
  for (const row of $("planInGrid").querySelectorAll("tr[data-sport]")) row.hidden = row.dataset.sport !== "run" && !multiOn();
  $("planInNameWrap").hidden = !(f.race || f.named);
  $("planInTimeWrap").hidden = !f.race;
  $("planInTriWrap").hidden = !f.tri;
  $("planInDateLabel").textContent = f.race || f.tri ? "Race day" : "End date";
  $("planInDistLabel").textContent = f.race ? "Distance" : "Project a time for";
  // A distance to project a time for only matters with runs in the plan
  const dist = f.dist && (f.race || gridDays("run").length) ? f.dist : null;
  $("planInDistWrap").hidden = !dist;
  fillDist(dist, metres);
  showSports();
}

// Each ticked sport's own fields: long run and ride days among its days, the volume now, the pool
function showSports() {
  const fill = (sel, days, none) => {
    const keep = sel.value === "" ? null : +sel.value;
    const pick = days.includes(keep) ? keep : none && keep == null ? "" : days[days.length - 1];
    sel.innerHTML = (none ? '<option value="">No long ride</option>' : "") +
      days.map((d) => `<option value="${d}">${DAYS[d]}</option>`).join("");
    sel.value = String(pick ?? "");
  };
  const run = gridDays("run"), bike = gridDays("bike");
  fill($("planInLong"), run);
  fill($("planInLongRide"), bike, true);
  $("planInRun").hidden = !run.length;
  $("planInBike").hidden = !multiOn() || !bike.length;
  $("planInSwim").hidden = !multiOn() || !gridDays("swim").length;
}

// A sport's weekly km (or seconds) over the last 4 weeks
function weekly(sport, field) {
  const since = addDays(data.generated, -28);
  return data.activities.filter((a) => a.sport === sport && a.date >= since).reduce((t, a) => t + (a[field] || 0), 0) / 4;
}

function openPlanForm() {
  const c = data.plan?.config, r = data.race;
  const metres = c?.metres ?? r?.metres ?? 21098;
  const sports = c?.sports || { run: { days: [1, 3, 5, 6], long_day: 6 } };
  $("planInGoal").value = c?.goal || "race";
  $("planInName").value = c && (c.goal === "race" || c.goal === "triathlon") ? c.name : r?.name || "";
  $("planInTri").value = c?.tri || "olympic";
  $("planInDate").value = c?.date || r?.date || addDays(data.generated, 12 * 7);
  const target = c ? c.target_s : r?.target_s;
  $("planInTime").value = target ? fmtDuration(target) : "";
  $("planInGrid").innerHTML = `<tr><th></th>${DAYS.map((d) => `<th scope="col">${d}</th>`).join("")}</tr>` +
    SPORTS.map(([k, l]) => `<tr data-sport="${k}"><th scope="row">${l}</th>${DAYS.map((d, i) =>
      `<td><input type="checkbox" data-sport="${k}" data-day="${i}" aria-label="${l} on ${d}"${sports[k]?.days.includes(i) ? " checked" : ""}></td>`).join("")}</tr>`).join("");
  $("planInMulti").checked = !!(sports.bike || sports.swim);
  // The saved long days, for showSports() to keep
  $("planInLong").innerHTML = `<option value="${sports.run?.long_day ?? 6}"></option>`;
  $("planInLongRide").innerHTML = `<option value="${sports.bike ? sports.bike.long_day ?? "" : 5}"></option>`;
  // How much now: what was saved, or the last 4 weeks' average
  $("planInVol").value = sports.run?.start_km ?? (Math.round(weekly("run", "km")) || 20);
  $("planInBikeH").value = sports.bike?.start_h ?? (Math.round(weekly("bike", "duration_s") / 1800) / 2 || 3);
  $("planInSwimKm").value = sports.swim?.start_km ?? (Math.round(weekly("swim", "km") * 2) / 2 || 3);
  $("planInPool").value = String(sports.swim?.pool || 25);
  $("planRemove").hidden = !c;
  $("planError").hidden = true;
  showGoal(metres);
  dialog.showModal();
}

async function planRequest(method, body) {
  const res = await fetch("/api/plan", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (res.status === 404 || res.status === 405) throw new Error("The dashboard server is older than this page. Restart it, then try again.");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save the plan.");
  dialog.close();
  dispatchEvent(new Event("reload"));
}

const planFail = (e) => { $("planError").textContent = e.message; $("planError").hidden = false; };

$("planAdd").addEventListener("click", openPlanForm);

$("planEdit").addEventListener("click", openPlanForm);

$("planCancel").addEventListener("click", () => dialog.close());

$("planInGoal").addEventListener("change", () => showGoal(undefined, true));

$("planInDist").addEventListener("change", () => { $("planInKmWrap").hidden = $("planInDist").value !== "custom"; });

$("planInGrid").addEventListener("change", () => showGoal());

$("planInMulti").addEventListener("change", () => showGoal(undefined, true));

$("planRemove").addEventListener("click", () => {
  if (confirm("End the plan? Its weeks and progress go with it; the race goal stays.")) planRequest("DELETE").catch(planFail);
});

$("planForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = $("planInGoal").value, f = GOAL_FIELDS[goal], race = goal === "race";
  const dist = $("planInDist").value, needsDist = !$("planInDistWrap").hidden;
  const metres = !needsDist ? 10000 : dist === "custom" ? Number($("planInKm").value) * 1000 : Number(dist);
  const time = $("planInTime").value.trim(), target = race && time ? parseTime(time) : null;
  const sports = {};
  for (const [k] of SPORTS) if (gridDays(k).length && (k === "run" || multiOn())) sports[k] = { days: gridDays(k) };
  if (sports.run) Object.assign(sports.run, { long_day: +$("planInLong").value, start_km: Number($("planInVol").value) });
  if (sports.bike) Object.assign(sports.bike, { long_day: $("planInLongRide").value === "" ? null : +$("planInLongRide").value,
    start_h: Number($("planInBikeH").value) });
  if (sports.swim) Object.assign(sports.swim, { start_km: Number($("planInSwimKm").value), pool: +$("planInPool").value });
  const missing = (f.needs || []).filter((k) => !sports[k]).map((k) => SPORTS.find((s) => s[0] === k)[1].toLowerCase());
  if (!metres) return planFail(new Error("Enter the distance in kilometres."));
  if (race && time && !target) return planFail(new Error("Enter the target time as minutes:seconds or hours:minutes:seconds."));
  if (!Object.keys(sports).length) return planFail(new Error("Tick the days for at least one sport."));
  if (missing.length) return planFail(new Error(`This plan needs ${missing.join(", ")} days.`));
  if (sports.run && sports.run.days.length < 2) return planFail(new Error("Pick at least two run days."));
  if (sports.run && !(sports.run.start_km > 0)) return planFail(new Error("Enter the km you run a week now."));
  if (sports.bike && !(sports.bike.start_h > 0)) return planFail(new Error("Enter the hours you ride a week now."));
  if (sports.swim && !(sports.swim.start_km > 0)) return planFail(new Error("Enter the km you swim a week now."));
  planRequest("POST", {
    goal, name: race || f.named ? $("planInName").value : "", tri: f.tri ? $("planInTri").value : null,
    date: $("planInDate").value, metres, target_s: target, sports,
  }).catch(planFail);
});
