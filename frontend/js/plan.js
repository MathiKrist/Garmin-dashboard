// Training plan, on the workout page: weeks of runs toward a race or general fitness (worked out on the server), the
// time it projects, and the button that sends the coming week to the watch

import { data } from "./state.js";
import { $, fmtDay, fmtDayYear, fmtShort, fmtDuration, fmtPace, fmtRange, statItems, escapeHtml, addDays } from "./util.js";
import { raceDistance, isRaceDistance, parseTime } from "./race.js";
import { total, barHtml, stepsHtml, mainPace } from "./workout.js";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

// Faster is a green triangle up, slower a red one down
const moved = (d) => `<span class="${d > 0 ? "over" : "under"}">${d > 0 ? "▼" : "▲"} ${fmtDuration(Math.abs(d))}</span>`;
const signed = (gap) => `<span class="${gap > 0 ? "over" : "under"}">${gap > 0 ? "+" : "−"}${fmtDuration(Math.abs(gap))}</span>`;

const VERDICT = { better: "Faster than planned", worse: "Slower than planned", "on plan": "On plan" };

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
  const head = `<span class="ps-day">${fmtDay(s.date)}</span><span class="ps-title">${escapeHtml(s.title)}</span>
    <span class="ps-size">${size}</span><span class="ps-pace">${mainPace(s.steps)}</span><span class="ps-status">${status(s)}</span>`;
  if (!s.steps.length) return `<li class="ps is-${s.status}"><div class="ps-row">${head}</div></li>`;
  return `<li class="ps is-${s.status}"><details><summary class="ps-row">${head}</summary>
    <div class="ps-steps"><div class="wk-bar" role="img" aria-label="${escapeHtml(s.title)}">${barHtml(s.steps)}</div>
    <ol class="wk-steps">${stepsHtml(s.steps)}</ol></div></details></li>`;
}

const phaseText = (w) => data.plan.phases[w.phase] + (w.deload ? " · lighter week" : "");

export function renderPlan() {
  const p = data.plan;
  $("planAdd").hidden = !!p;
  $("plan").hidden = !p;
  if (!p) return;
  const c = p.config, race = c.goal === "race", pr = p.projection;
  const left = p.weeks_left;
  $("planWhen").textContent = [race ? fmtDayYear(c.date) : `Until ${fmtDayYear(c.date)}`, race ? null : p.goal_label, raceDistance(c.metres),
    p.over ? "Finished" : left > 1 ? `${left} weeks to go` : "Final week"].filter(Boolean).join(" · ");
  $("planName").textContent = c.name;

  const items = [];
  if (pr) {
    items.push([race ? "Projected on race day" : `Projected ${raceDistance(c.metres)}`, fmtRange(pr.low, pr.high), fmtPace(pr.s / c.metres * 1000)]);
    if (c.target_s) items.push(["Target", fmtDuration(c.target_s), pr.high <= c.target_s ? "Within reach" : `${signed(pr.s - c.target_s)} projected`]);
    const ch = pr.change;
    items.push(["Last change", ch ? moved(pr.s - ch.from_s) : "–", ch ? `${ch.title}, ${fmtShort(ch.date)}` : "None yet"]);
  } else {
    items.push(["Projected", "–", "Needs Garmin's threshold or race prediction"]);
  }
  $("planStats").innerHTML = statItems(items);

  // This week
  const w = p.weeks[p.week_index];
  $("planWeekTitle").textContent = w ? `This week · ${p.week_index + 1} of ${p.weeks.length}` : "This week";
  $("planWeekSub").textContent = w ? `${phaseText(w)} · ${w.km_done} of ${w.km_planned} km` : "Outside the plan";
  $("planSessions").innerHTML = w ? w.sessions.map(sessionItem).join("") : "";

  const send = p.send, btn = $("planSend"), note = $("planSendNote");
  btn.hidden = !send.count;
  btn.disabled = send.sent;
  btn.textContent = send.sent ? "Week on the watch ✓" : "Send week to watch";
  note.className = "";
  note.textContent = !send.count ? "" : send.sent ? `${send.count} sessions in the Garmin calendar`
    : `Next 7 days: ${send.count} session${send.count > 1 ? "s" : ""}`;

  // Every week; the current one open
  $("planWeeks").innerHTML = p.weeks.map((x, i) => {
    const key = x.sessions.filter((s) => s.kind !== "easy" && s.kind !== "shakeout").map((s) => escapeHtml(s.title)).join(", ");
    const past = i < (p.week_index ?? (p.over ? p.weeks.length : 0));
    return `<li class="pw${i === p.week_index ? " now" : ""}${past ? " past" : ""}"><details${i === p.week_index ? " open" : ""}>
      <summary><span class="pw-n">${i + 1}</span><span class="pw-date">${fmtShort(x.start)}</span><span class="pw-phase">${phaseText(x)}</span>
      <span class="pw-km">${past || i === p.week_index ? `${x.km_done} / ` : ""}${x.km_planned} km</span><span class="pw-key">${key}</span></summary>
      <ol class="plan-sessions">${x.sessions.map(sessionItem).join("")}</ol></details></li>`;
  }).join("");
}

// Only this button sends the plan to Garmin
$("planSend").addEventListener("click", async () => {
  const btn = $("planSend"), note = $("planSendNote");
  btn.disabled = true;
  btn.textContent = "Sending…";
  let error = "";
  try {
    const res = await fetch("/api/plan/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: data.plan.send.key }) });
    if (!res.ok) error = (await res.json().catch(() => ({}))).error || "Sending failed.";
  } catch {
    error = "Couldn't reach the dashboard server.";
  }
  if (error) {
    btn.disabled = false;
    btn.textContent = "Send week to watch";
    note.className = "error";
    note.textContent = error;
    return;
  }
  dispatchEvent(new Event("reload"));
});

// ---- Setting the plan up

const dialog = $("planDialog");

function showGoal() {
  const race = $("planInGoal").value === "race";
  $("planInNameWrap").hidden = !race;
  $("planInTimeWrap").hidden = !race;
  $("planInDateLabel").textContent = race ? "Race day" : "End date";
  $("planInDistLabel").textContent = race ? "Distance" : "Project a time for";
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
  $("planInDist").innerHTML = data.race_distances.map((m) => `<option value="${m}">${data.distances[m]}</option>`).join("") +
    '<option value="custom">Other</option>';
  $("planInDist").value = isRaceDistance(metres) ? String(metres) : "custom";
  $("planInKm").value = isRaceDistance(metres) ? "" : +(metres / 1000).toFixed(2);
  $("planInKmWrap").hidden = isRaceDistance(metres);
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
  showGoal();
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

$("planInGoal").addEventListener("change", showGoal);

$("planInDist").addEventListener("change", () => { $("planInKmWrap").hidden = $("planInDist").value !== "custom"; });

$("planInDays").addEventListener("change", () => fillLongDays(+$("planInLong").value));

$("planRemove").addEventListener("click", () => {
  if (confirm("End the plan? Its weeks and progress go with it; the race goal stays.")) planRequest("DELETE").catch(planFail);
});

$("planForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const dist = $("planInDist").value, metres = dist === "custom" ? Number($("planInKm").value) * 1000 : Number(dist);
  const race = $("planInGoal").value === "race";
  const time = $("planInTime").value.trim(), target = race && time ? parseTime(time) : null;
  const days = [...$("planInDays").querySelectorAll("input:checked")].map((x) => +x.value);
  if (!metres) return planFail(new Error("Enter the distance in kilometres."));
  if (race && time && !target) return planFail(new Error("Enter the target time as minutes:seconds or hours:minutes:seconds."));
  if (days.length < 2) return planFail(new Error("Pick at least two run days."));
  planRequest("POST", {
    goal: $("planInGoal").value, name: race ? $("planInName").value : "", date: $("planInDate").value, metres,
    target_s: target, days, long_day: +$("planInLong").value, start_km: Number($("planInVol").value),
  }).catch(planFail);
});
