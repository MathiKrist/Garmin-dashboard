// Workout: today's suggested session per sport (worked out on the server), and the button that sends it to the watch

import { data } from "./state.js";
import { $, fmtDay, escapeHtml } from "./util.js";

// Intensity colours, the same as training effect and load focus
const COLOR = { easy: "var(--easy)", high: "var(--hard)", anaerobic: "var(--anaerobic)", rest: "var(--nohr)" };
const HEIGHT = { rest: 30, easy: 50, high: 80, anaerobic: 100 };

let sport = null;

try { sport = localStorage.getItem("workoutSport"); } catch {}

const total = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

const pace = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const len = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s / 60} min`);

function target(step) {
  const t = step.target, parts = [];
  if (t?.type === "pace") parts.push(`${pace(t.fast)}–${pace(t.slow)} /km`);
  if (t?.type === "hr") parts.push(`Zone ${t.zone} · ${t.lo}–${t.hi} bpm`);
  if (step.note) parts.push(step.note);
  return parts.join(" · ") || (step.intensity === "rest" || step.kind === "cooldown" ? "Easy, by feel" : "");
}

const stepItem = (s) => `<li style="--c:${COLOR[s.intensity]}"><span class="len">${len(s.s)}</span>
  <span class="what">${escapeHtml(s.label)}</span><span class="target">${target(s)}</span></li>`;

// The steps in order, with each repeat once per round, for the workout's shape
const flat = (steps) => steps.flatMap((s) => (s.kind === "repeat" ? Array(s.n).fill(s.steps).flat() : [s]));

export function renderWorkout() {
  const list = data.workouts || [];
  if (!list.some((w) => w.sport === sport)) sport = list[0]?.sport;
  const w = list.find((x) => x.sport === sport);
  $("workoutSport").innerHTML = list.map((x) => `<button type="button" data-sport="${x.sport}" aria-pressed="${x.sport === sport}">${x.label}</button>`).join("");
  $("workout").hidden = !w;
  if (!w) return;

  $("wkWhen").textContent = `${fmtDay(data.generated)} · ${w.label}`;
  $("wkTitle").textContent = w.title;
  $("wkTotal").textContent = total(w.total_s) + (w.km ? ` · about ${w.km.toFixed(1)} km` : "");
  $("wkWhy").textContent = w.why.join(" · ");
  $("wkBar").innerHTML = flat(w.steps).map((s) => `<i style="flex:${s.s};height:${HEIGHT[s.intensity]}%;background:${COLOR[s.intensity]}"></i>`).join("");
  $("wkBar").setAttribute("aria-label", `${w.title}, ${total(w.total_s)}`);
  $("wkSteps").innerHTML = w.steps.map((s) => (s.kind === "repeat"
    ? `<li class="reps" style="--c:${COLOR[s.steps[0].intensity]}"><span class="len">${s.n} ×</span><ol>${s.steps.map(stepItem).join("")}</ol></li>`
    : stepItem(s))).join("");

  const btn = $("wkSend"), note = $("wkSendNote");
  btn.disabled = w.sent;
  btn.textContent = w.sent ? "Sent to watch ✓" : "Send to watch";
  note.className = "";
  note.textContent = w.sent ? "In today's Garmin calendar" : "Adds it to today's Garmin calendar";
}

$("workoutSport").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sport]");
  if (!b) return;
  sport = b.dataset.sport;
  try { localStorage.setItem("workoutSport", sport); } catch {}
  renderWorkout();
});

// Only this button sends anything to Garmin
$("wkSend").addEventListener("click", async () => {
  const w = data.workouts.find((x) => x.sport === sport), btn = $("wkSend"), note = $("wkSendNote");
  btn.disabled = true;
  btn.textContent = "Sending…";
  let error = "";
  try {
    const res = await fetch(`/api/workout/${w.sport}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: w.title }) });
    if (!res.ok) error = (await res.json().catch(() => ({}))).error || "Sending failed.";
  } catch {
    error = "Couldn't reach the dashboard server.";
  }
  if (error) {
    btn.disabled = false;
    btn.textContent = "Send to watch";
    note.className = "error";
    note.textContent = error;
    return;
  }
  dispatchEvent(new Event("reload"));  // the server now marks it as sent
});
