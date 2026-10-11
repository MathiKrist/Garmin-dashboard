// Workout: today's suggested session per sport (worked out on the server), and the button that sends it to the watch

import { data } from "./state.js";
import { $, fmtDay, escapeHtml } from "./util.js";

// Volt for easy running, Puls for hard (darker for threshold); a long run's easy steps take the long run's full Volt
const COLOR = { easy: "var(--k-easy)", high: "var(--k-threshold)", anaerobic: "var(--k-vo2)", rest: "var(--k-jog)" };
const color = (intensity, kind) => (intensity === "easy" && kind === "long" ? "var(--k-long)"
  : intensity === "high" && kind === "vo2" ? "var(--k-vo2)" : COLOR[intensity]);
const HEIGHT = { rest: 30, easy: 50, high: 80, anaerobic: 100 };

let sport = null;

try { sport = localStorage.getItem("workoutSport"); } catch {}

export const total = (s) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };

export const pace = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

const len = (s) => (s < 60 ? `${s} s` : s % 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")} min` : `${s / 60} min`);

function target(step) {
  const t = step.target, parts = [];
  if (t?.type === "pace") parts.push(`${pace(t.fast)}–${pace(t.slow)} /km`);
  if (t?.type === "hr") parts.push(`Zone ${t.zone} · ${t.lo}–${t.hi} bpm`);
  if (step.note) parts.push(step.note);
  return parts.join(" · ") || (step.intensity === "rest" || step.kind === "cooldown" ? "Easy, by feel" : "");
}

const stepItem = (s, kind) => `<li style="--c:${color(s.intensity, kind)}"><span class="len">${len(s.s)}</span>
  <span class="what">${escapeHtml(s.label)}</span><span class="target">${target(s)}</span></li>`;

// The steps in order, with each repeat once per round, for the workout's shape
const flat = (steps) => steps.flatMap((s) => (s.kind === "repeat" ? Array(s.n).fill(s.steps).flat() : [s]));

// The workout's shape: each block as long as the step and as tall as it's hard
export const barHtml = (steps, kind) => flat(steps).map((s) =>
  `<i style="flex:${s.s};height:${HEIGHT[s.intensity]}%;background:${color(s.intensity, kind)}"></i>`).join("");

export const stepsHtml = (steps, kind) => steps.map((s) => (s.kind === "repeat"
  ? `<li class="reps" style="--c:${color(s.steps[0].intensity, kind)}"><span class="len">${s.n} ×</span><ol>${s.steps.map((x) => stepItem(x, kind)).join("")}</ol></li>`
  : stepItem(s, kind))).join("");

// The pace the session is about: its first hard step's, else its first step's
export function mainPace(steps) {
  const all = flat(steps), s = all.find((x) => x.intensity === "high") || all[0];
  return s?.target?.type === "pace" ? `${pace(s.target.fast)}–${pace(s.target.slow)} /km` : "";
}

export const currentSport = () => sport;

export const todaysWorkout = () => (data.workouts || []).find((x) => x.sport === sport);

export function renderWorkout() {
  const list = data.workouts || [];
  if (!list.some((w) => w.sport === sport)) sport = list[0]?.sport;
  const w = todaysWorkout();
  $("workoutSport").innerHTML = list.map((x) => `<button type="button" data-sport="${x.sport}" aria-pressed="${x.sport === sport}">${x.label}</button>`).join("");
  $("workout").hidden = !w;
  if (w) showWorkout(w);
}

// One session in the detail: today's workout, or a later plan day picked in the strip (sent with the week, not on its own)
export function showWorkout(w, day = null) {
  const today = !day;
  $("wkWhen").textContent = `${today ? "Today" : fmtDay(day)} · ${w.label || "Run"}`;
  $("wkTitle").textContent = w.title;
  $("wkTotal").textContent = w.kind === "rest" ? (w.next ? `Next: ${w.next.title}, ${fmtDay(w.next.date)}` : "")
    : (w.total_s ? total(w.total_s) : "") + (w.km ? ` · about ${w.km.toFixed(1)} km` : "");
  $("wkWhy").textContent = w.why.join(" · ");
  // Later days changed in the chat, outside a plan (the plan shows its own)
  const ahead = today ? (data.workouts_ahead || []).filter((x) => x.sport === w.sport) : [];
  $("wkAhead").hidden = !ahead.length;
  $("wkAhead").innerHTML = ahead.map((x) => `<li>${fmtDay(x.date)} · <b>${escapeHtml(x.title)}</b>${x.total_s ? ` · ${total(x.total_s)}` : ""}</li>`).join("");
  $("wkBar").innerHTML = barHtml(w.steps, w.kind);
  $("wkBar").setAttribute("aria-label", `${w.title}, ${total(w.total_s)}`);
  $("wkSteps").innerHTML = stepsHtml(w.steps, w.kind);
  // A rest day or race day has nothing to send
  $("wkSend").parentElement.hidden = !today || !w.steps.length;

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
  dispatchEvent(new Event("sportchange"));
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
