// Training plan, on the workout page: weeks of runs toward a race or general fitness (worked out on the server), the
// time it projects, and the button that sends the coming week to the watch

import { data } from "./state.js";
import { $, fmtDay, fmtShort, fmtDuration, fmtPace, fmtRange, escapeHtml, addDays } from "./util.js";
import { raceDistance, parseTime } from "./race.js";
import { total, barHtml, stepsHtml, mainPace, currentSport, todaysWorkout, showWorkout, watchButton, watchRequest } from "./workout.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Faster is a Volt triangle up, slower a Puls one down
const moved = (d) => `<span class="${d > 0 ? "over" : "under"}">${d > 0 ? "▼" : "▲"} ${fmtDuration(Math.abs(d))}</span>`;
const signed = (gap) => `<span class="${gap > 0 ? "over" : "under"}">${gap > 0 ? "+" : "−"}${fmtDuration(Math.abs(gap))}</span>`;

const VERDICT = { better: "Faster than planned", worse: "Slower than planned", "on plan": "On plan" };

// Each session type's colour: Volt for easy running, Puls for hard
const KIND = { easy: "easy", shakeout: "easy", recovery: "easy", long: "long", threshold: "threshold", race_pace: "threshold", vo2: "vo2",
  anaerobic: "anaerobic", race: "vo2" };
const kindColor = (kind) => `var(--k-${KIND[kind] || "easy"})`;
const LEGEND = [["easy", "Easy"], ["long", "Long run"], ["threshold", "Threshold"], ["vo2", "VO2 max"], ["anaerobic", "Speed"]];

let day = null, week = null;  // the strip's picked day and the chart's picked week; null is today and this week

function status(s) {
  if (s.status === "done") {
    const a = s.actual;
    return `<span class="ps-done">✓ ${a.pace ? fmtPace(a.pace) : ""}</span>` +
      (a.verdict ? `<span class="verdict ${a.verdict.replace(" ", "-")}">${VERDICT[a.verdict]}${
        a.verdict !== "on plan" && (s.kind === "easy" || s.kind === "long") ? " for its heart rate" : ""}</span>` : "");
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

function sessionItem(s) {
  const size = [s.km ? `${s.km.toFixed(1)} km` : "", s.total_s ? total(s.total_s) : ""].filter(Boolean).join(" · ");
  const head = `<span class="ps-day">${fmtDay(s.date)}</span><span class="ps-title"><i class="kdot" style="--c:${kindColor(s.kind)}"></i>${escapeHtml(s.title)}</span>
    <span class="ps-size">${size}</span><span class="ps-pace">${mainPace(s.steps)}</span><span class="ps-status">${status(s)}</span>`;
  if (!s.steps.length) return `<li class="ps is-${s.status}"><div class="ps-row">${head}</div></li>`;
  return `<li class="ps is-${s.status}"><details><summary class="ps-row">${head}</summary>
    <div class="ps-steps"><div class="wk-bar" role="img" aria-label="${escapeHtml(s.title)}">${barHtml(s.steps, s.kind)}</div>
    <ol class="wk-steps">${stepsHtml(s.steps, s.kind)}</ol></div></details></li>`;
}

const phaseText = (w) => data.plan.phases[w.phase] + (w.deload ? " · lighter week" : "");

// The session on a date, leaving out one that moved to another day
const sessionOn = (p, iso) => p.weeks.flatMap((w) => w.sessions).find((s) => s.date === iso && s.status !== "moved");
const weekOf = (p, iso) => p.weeks.findIndex((w) => w.start <= iso && iso <= addDays(w.start, 6));
const sizeOf = (s) => [s.km ? `${s.km.toFixed(1)} km` : "", s.total_s ? total(s.total_s) : ""].filter(Boolean).join(" · ");

export function renderPlan() {
  const p = data.plan, run = currentSport() === "run";
  $("planAdd").hidden = !!p || !run;
  $("planTop").hidden = $("planWeeksSec").hidden = !p || !run;
  if (!p || !run) return;
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
  const left = p.weeks_left;
  $("planWhen").textContent = [p.week_index != null ? `Week ${p.week_index + 1} of ${p.weeks.length}` : null,
    p.over ? "Finished" : race ? fmtDay(c.date) : `until ${fmtShort(c.date)}`, !p.over && left > 1 ? `${left} weeks to go` : null].filter(Boolean).join(" · ");

  renderStrip(p);
  renderWeeks(p);

  const send = p.send, btn = $("planSend"), note = $("planSendNote");
  btn.hidden = !send.count;
  watchButton(btn, send.sent, "Send next 7 days");
  note.className = "";
  note.textContent = !send.count ? "" : send.sent ? `${send.count} sessions in the Garmin calendar` : `${send.count} session${send.count > 1 ? "s" : ""}`;
}

// The next 7 days, today first; a picked day opens in the workout section
function renderStrip(p) {
  const today = data.generated, dates = [0, 1, 2, 3, 4, 5, 6].map((i) => addDays(today, i));
  if (!dates.includes(day)) day = today;
  $("planStrip").innerHTML = dates.map((iso) => {
    const s = sessionOn(p, iso), name = DAYS[(new Date(iso + "T12:00:00").getDay() + 6) % 7], size = s ? sizeOf(s) : "";
    return `<button type="button" class="day${s ? "" : " rest"}" data-day="${iso}" aria-pressed="${iso === day}"${s ? ` style="--c:${kindColor(s.kind)}"` : ""}>
      <span class="dn">${name} ${+iso.slice(8)}</span><span class="dt">${s ? escapeHtml(s.title) : "Rest"}</span>
      ${size ? `<span class="dk">${size}</span>` : ""}${iso === today ? '<span class="tag">Today</span>' : s?.sent ? '<span class="tag sent">✓</span>' : ""}</button>`;
  }).join("");
  const w = todaysWorkout();
  if (day === today) { if (w) showWorkout(w); return; }
  const s = sessionOn(p, day), i = weekOf(p, day);
  const why = i < 0 ? [] : [`Plan · week ${i + 1} of ${p.weeks.length} · ${phaseText(p.weeks[i]).toLowerCase()}`];
  if (s?.moved_from) why.push(`moved from ${fmtDay(s.moved_from)}`);
  if (s?.changed) why.push("changed in chat");
  if (s?.sent) why.push("on the watch");
  const next = p.weeks.flatMap((x) => x.sessions).find((x) => x.date > day && x.status !== "moved");
  const label = w?.label || "Run";
  showWorkout(s ? { ...s, label, why } : { kind: "rest", title: "Rest day", label, steps: [], why: [], next }, day);
}

// Planned km per week, each bar split by session type; a picked bar lists its sessions below
function renderWeeks(p) {
  const now = p.week_index ?? (p.over ? p.weeks.length - 1 : 0);
  if (week == null || week >= p.weeks.length) week = now;
  const max = Math.max(...p.weeks.map((w) => w.km_planned), 1), n = p.weeks.length, labels = n <= 16;
  $("planLegend").innerHTML = LEGEND.map(([k, l]) => `<span><i style="background:var(--k-${k})"></i>${l}</span>`).join("") +
    "<span>Faded: lighter week</span><span>Line: km done</span>";
  const bars = p.weeks.map((w, i) => {
    const by = {};
    for (const s of w.sessions) if (s.km && s.kind !== "race") by[KIND[s.kind] || "easy"] = (by[KIND[s.kind] || "easy"] || 0) + s.km;
    const parts = ["long", "easy", "threshold", "vo2", "anaerobic"].filter((k) => by[k]).map((k) => `<i style="flex:${by[k]};background:var(--k-${k})"></i>`).join("");
    const done = i <= now && w.km_done ? `<b class="done" style="bottom:${Math.min(w.km_done / max, 1.1) * 82}%"></b>` : "";
    return `<button type="button" class="wbar${w.deload ? " light" : ""}" data-week="${i}" aria-pressed="${i === week}"
      aria-label="Week ${i + 1}, ${w.km_planned} km planned${i <= now ? `, ${w.km_done} done` : ""}">
      ${labels ? `<span class="km">${Math.round(w.km_planned) || ""}</span>` : ""}<span class="stack" style="height:${(w.km_planned / max) * 82}%">${parts}</span>${done}</button>`;
  }).join("");
  // Phase names under the bars, one per run of weeks
  const phases = [];
  p.weeks.forEach((w) => (phases.length && phases.at(-1).phase === w.phase ? phases.at(-1).n++ : phases.push({ phase: w.phase, n: 1 })));
  $("planChart").style.setProperty("--n", n);
  $("planChart").innerHTML = `<div class="bars">${bars}</div>
    <div class="wnums">${p.weeks.map((_, i) => `<span${i === now ? ' class="now"' : ""}>${labels || i % 4 === 0 || i === now ? i + 1 : ""}</span>`).join("")}</div>
    <div class="wphases">${phases.map((x) => `<span style="grid-column:span ${x.n}">${p.phases[x.phase]}</span>`).join("")}</div>`;

  const w = p.weeks[week];
  $("planWeekTitle").textContent = [`Week ${week + 1} of ${n}`, fmtShort(w.start), phaseText(w),
    week <= now ? `${w.km_done} of ${w.km_planned} km` : `${w.km_planned} km`].join(" · ");
  $("planSessions").innerHTML = w.sessions.length ? w.sessions.map(sessionItem).join("")
    : '<li class="ps"><div class="ps-row"><span class="ps-day">No runs</span></div></li>';
}

$("planStrip").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-day]");
  if (!b) return;
  day = b.dataset.day;
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

// What each plan type asks for: a race's name and target time, and a distance (any, or 5 and 10 km only)
const GOAL_FIELDS = { race: { race: true, dist: "any" }, fitness: { dist: "any" }, maintain: { dist: "any" },
  speed: { dist: "short" }, base: {}, comeback: {} };

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

function showGoal(metres) {
  const f = GOAL_FIELDS[$("planInGoal").value];
  $("planInNameWrap").hidden = $("planInTimeWrap").hidden = !f.race;
  $("planInDateLabel").textContent = f.race ? "Race day" : "End date";
  $("planInDistLabel").textContent = f.race ? "Distance" : "Project a time for";
  $("planInDistWrap").hidden = !f.dist;
  fillDist(f.dist, metres);
}

function fillLongDays(keep) {
  const days = [...$("planInDays").querySelectorAll("input:checked")].map((x) => +x.value);
  const pick = days.includes(keep) ? keep : days[days.length - 1];
  $("planInLong").innerHTML = days.map((d) => `<option value="${d}"${d === pick ? " selected" : ""}>${DAYS[d]}</option>`).join("");
}

function openPlanForm() {
  const c = data.plan?.config, r = data.race;
  const metres = c?.metres ?? r?.metres ?? 21098;
  $("planInGoal").value = c?.goal || "race";
  $("planInName").value = c?.goal === "race" ? c.name : r?.name || "";
  $("planInDate").value = c?.date || r?.date || addDays(data.generated, 12 * 7);
  const target = c ? c.target_s : r?.target_s;
  $("planInTime").value = target ? fmtDuration(target) : "";
  const days = c?.days || [1, 3, 5, 6];
  $("planInDays").innerHTML = DAYS.map((d, i) => `<label><input type="checkbox" value="${i}"${days.includes(i) ? " checked" : ""}>${d}</label>`).join("");
  fillLongDays(c?.long_day ?? 6);
  // Running now: the last 4 weeks' average
  const since = addDays(data.generated, -28);
  const km = data.activities.filter((a) => a.sport === "run" && a.date >= since).reduce((t, a) => t + (a.km || 0), 0) / 4;
  $("planInVol").value = c?.start_km ?? (Math.round(km) || 20);
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

$("planInGoal").addEventListener("change", () => showGoal());

$("planInDist").addEventListener("change", () => { $("planInKmWrap").hidden = $("planInDist").value !== "custom"; });

$("planInDays").addEventListener("change", () => fillLongDays(+$("planInLong").value));

$("planRemove").addEventListener("click", () => {
  if (confirm("End the plan? Its weeks and progress go with it; the race goal stays.")) planRequest("DELETE").catch(planFail);
});

$("planForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const goal = $("planInGoal").value, needsDist = !!GOAL_FIELDS[goal].dist, race = goal === "race";
  const dist = $("planInDist").value, metres = !needsDist ? 10000 : dist === "custom" ? Number($("planInKm").value) * 1000 : Number(dist);
  const time = $("planInTime").value.trim(), target = race && time ? parseTime(time) : null;
  const days = [...$("planInDays").querySelectorAll("input:checked")].map((x) => +x.value);
  if (!metres) return planFail(new Error("Enter the distance in kilometres."));
  if (race && time && !target) return planFail(new Error("Enter the target time as minutes:seconds or hours:minutes:seconds."));
  if (days.length < 2) return planFail(new Error("Pick at least two run days."));
  planRequest("POST", {
    goal, name: race ? $("planInName").value : "", date: $("planInDate").value, metres,
    target_s: target, days, long_day: +$("planInLong").value, start_km: Number($("planInVol").value),
  }).catch(planFail);
});
