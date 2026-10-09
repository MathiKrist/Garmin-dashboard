// Health: recovery, sleep and the body's daily numbers

import { data } from "./state.js";
import { $, css, fmtShort, round, fmtSleep, fromDay, statItems, alpha, addDays, fmtHours } from "./util.js";
import { PARTIAL_ALPHA, baseOptions, draw } from "./charts.js";

// Garmin's readiness and stress levels
export const readinessLevel = (v) => (v >= 95 ? "Prime" : v >= 75 ? "High" : v >= 50 ? "Moderate" : v >= 25 ? "Low" : "Poor");

export const stressLevel = (v) => (v > 75 ? "High" : v > 50 ? "Medium" : v > 25 ? "Low" : "Resting");

// Last night and today: [label, value, note]; the first four are the overview's, the health page shows them all
export function todayItems() {
  const t = data.today, day = (field) => fromDay(t.dates[field]);
  let hrvNote = "";
  if (t.hrv_last_night != null && t.hrv_low != null && t.hrv_high != null) {
    hrvNote = t.hrv_last_night < t.hrv_low ? "Below your range" : t.hrv_last_night > t.hrv_high ? "Above your range" : "In your normal range";
  }
  return [
    ["Readiness", t.readiness != null ? round(t.readiness) : null, t.readiness != null ? readinessLevel(t.readiness) : "", day("readiness")],
    ["HRV last night", t.hrv_last_night != null ? `${round(t.hrv_last_night)}<span>ms</span>` : null, hrvNote, day("hrv_last_night")],
    ["Sleep", fmtSleep(t.sleep_s), t.sleep_score != null ? `Score ${round(t.sleep_score)}` : "", day("sleep_s")],
    ["Resting HR", t.resting_hr != null ? `${round(t.resting_hr)}<span>bpm</span>` : null, t.resting_hr_7d != null ? `7-day avg: ${t.resting_hr_7d} bpm` : "", day("resting_hr")],
    ["Body Battery peak", t.bb_high != null ? round(t.bb_high) : null, t.bb_low != null ? `Lowest ${round(t.bb_low)}` : "", day("bb_high")],
    ["Average stress", t.stress_avg != null ? round(t.stress_avg) : null, t.stress_avg != null ? stressLevel(t.stress_avg) : "", day("stress_avg")],
    ["Steps today", t.steps != null ? Math.round(t.steps).toLocaleString("en-GB") : null, "", day("steps")],
  ].filter((i) => i[1] != null).map(([label, val, note, from]) => [label, val, [note, from].filter(Boolean).join(" · ")]);
}

// Average of a daily field over the days from `from` to `to` days ago (to excluded), skipping days without it
export function trendAvg(field, from, to) {
  const lo = addDays(data.generated, -from), hi = addDays(data.generated, -to);
  const vals = data.trends.filter((d) => d.date > lo && d.date <= hi && d[field] != null).map((d) => d[field]);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

export function healthReadings() {
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

export function renderHealth() {
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
      // Today's steps are still counting: paler, like the other unfinished periods
      bars("Steps", tr.map((d) => d.steps), tr.map((d) => alpha(fit, d.date === data.generated ? 0.55 * PARTIAL_ALPHA : 0.55))),
      { type: "line", label: "7-day average", data: avg7, borderColor: css("--ink"), borderWidth: 2, pointRadius: 0, pointHoverRadius: 3, tension: 0.3, spanGaps: true },
    ] },
    options: opts({ min: 0 }, (c) => c.dataset.label === "Steps"
      ? ` ${steps(c.parsed.y)}${tr[c.dataIndex].date === data.generated ? " so far" : ""}` : ` 7-day average: ${steps(c.parsed.y)}`),
  });
  // Best day in the period shown
  const best = tr.filter((d) => d.steps != null).reduce((b, d) => (!b || d.steps > b.steps ? d : b), null);
  if (best) $("stepsReading").textContent += ` Best day: ${steps(best.steps)} on ${fmtShort(best.date)}.`;
}
