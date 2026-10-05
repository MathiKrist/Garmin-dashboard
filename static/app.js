const $ = (id) => document.getElementById(id);
const charts = {};
let data = null;
let pollTimer = null;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtShort = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const round = (v, d = 0) => (v == null ? null : Number(v).toFixed(d));

function fmtDuration(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
function fmtPace(sPerKm) {
  if (!sPerKm) return "";
  const m = Math.floor(sPerKm / 60), s = Math.round(sPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}
function fmtSleep(s) {
  if (!s) return null;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return `${h}<span>h</span> ${m}<span>min</span>`;
}

async function load() {
  const res = await fetch("/api/dashboard");
  data = await res.json();
  render();
  clearTimeout(pollTimer);
  if (data.syncing) pollTimer = setTimeout(load, 5000);
}

function render() {
  $("demo").hidden = !data.demo;
  const btn = $("syncBtn");
  btn.disabled = data.syncing || data.demo;
  btn.textContent = data.syncing ? "Syncing…" : "Sync now";
  $("synced").textContent = data.meta.last_sync_at
    ? "Synced " + new Date(data.meta.last_sync_at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : "Not synced yet";

  const notice = $("notice");
  if (data.meta.last_error) {
    notice.className = "notice";
    notice.textContent = `Last sync failed: ${data.meta.last_error}`;
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  if (!data.has_data) {
    $("main").hidden = true;
    $("empty").hidden = false;
    if (!data.syncing && !data.meta.last_sync_at) $("emptyText").textContent =
      "Nothing synced yet. Run python login.py on the server machine if you haven't, then press Sync now.";
    return;
  }
  $("empty").hidden = true;
  $("main").hidden = false;

  renderTrainingStatus();
  renderHero();
  renderCharts();
  renderActivities();
}

// Garmin's own colors per status
const STATUS_COLORS = {
  PEAKING: "--st-peaking", PRODUCTIVE: "--st-productive", MAINTAINING: "--st-maintaining",
  RECOVERY: "--st-recovery", UNPRODUCTIVE: "--st-unproductive", STRAINED: "--st-strained",
  OVERREACHING: "--st-overreaching", DETRAINING: "--st-detraining",
};
const statusColor = (code) => `var(${STATUS_COLORS[code] || "--nohr"})`;
const statusLabel = (code) => code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ") : "No data";

// Garmin's load focus groups: [key, label, color token]
const FOCUS = [["low", "Low aerobic", "--low-aerobic"], ["high", "High aerobic", "--high-aerobic"], ["anaerobic", "Anaerobic", "--anaerobic"]];

function renderLoadFocus() {
  const lf = data.load_focus;
  $("focus").hidden = !lf;
  if (!lf) return;
  $("focusTitle").textContent = lf.title;
  const zoneColor = (key) => FOCUS.find((f) => f[0] === key)?.[2];
  $("focusTitle").style.setProperty("--focus-color", lf.zone ? `var(${zoneColor(lf.zone)})` : "var(--ink)");
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

function renderTrainingStatus() {
  const ts = data.training_status;
  $("tstatus").hidden = !ts && !data.load_focus;
  $("tsMain").hidden = !ts;
  renderLoadFocus();
  if (!ts) return;
  $("tsLabel").textContent = ts.label;
  $("tsLabel").style.setProperty("--status-color", statusColor(ts.code));
  $("tsSince").textContent = ts.since ? `since ${fmtDay(ts.since)}` : "";
  $("tsAbout").textContent = ts.about;

  const facts = [];
  if (ts.acute_load != null) {
    let load = `Acute load ${Math.round(ts.acute_load)}`;
    if (ts.acute_min != null && ts.acute_max != null) load += ` (optimal ${Math.round(ts.acute_min)}–${Math.round(ts.acute_max)})`;
    if (ts.acwr_status) load += `, ${ts.acwr_status.toLowerCase().replace(/_/g, " ")}`;
    facts.push(load);
  }
  if (ts.vo2max != null) facts.push(`VO2 max ${round(ts.vo2max)}`);
  $("tsFacts").textContent = facts.join(" · ");

  // The last 28 days in blocks of 7, counted back from today
  const weeks = [0, 7, 14, 21].map((i) => ts.history.slice(i, i + 7));
  $("tsWeeks").innerHTML = weeks.map((week, w) => {
    const days = week.map((d) => {
      const style = d.status ? ` style="background:${statusColor(d.status)}"` : "";
      return `<i class="${d.date === data.generated ? "today" : ""}"${style} title="${fmtDay(d.date)}: ${statusLabel(d.status)}"></i>`;
    }).join("");
    const label = w === 3 ? "Last 7 days" : `${fmtShort(week[0].date)} – ${fmtShort(week[6].date)}`;
    return `<div class="week"><div class="days">${days}</div><span>${label}</span></div>`;
  }).join("");
  $("tsWeeks").setAttribute("aria-label", "Training status per day, last 4 weeks: " +
    ts.history.filter((d) => d.status).map((d) => `${fmtShort(d.date)} ${statusLabel(d.status)}`).join(", "));

  const seen = Object.keys(STATUS_COLORS).filter((code) => ts.history.some((d) => d.status === code));
  $("tsLegend").innerHTML = seen.map((code) => `<span><i style="background:${statusColor(code)}"></i>${statusLabel(code)}</span>`).join("");
}

const FORM_COLORS = { Rested: "--hard", Fresh: "--easy", Balanced: "--nohr", Building: "--fitness", Overloaded: "--fatigue" };

// One plain-language sentence on the fitness trend over the last four weeks.
function fitnessReading(f) {
  const fx = data.fitness;
  if (f.ctl < 5 || fx.length < 29) return "";
  const now = Math.round(f.ctl), before = Math.round(fx[fx.length - 29].ctl);
  const change = Math.round((now - before) / before * 100);
  if (change >= 3) return `Fitness is ${now}, up from ${before} four weeks ago (+${change}%). You're getting fitter.`;
  if (change <= -3) return `Fitness is ${now}, down from ${before} four weeks ago (${change}%). Normal during a recovery week or taper; if it keeps falling, you're losing fitness.`;
  return `Fitness is ${now}, about the same as four weeks ago (${before}). You're holding your fitness.`;
}

// Chart.js plugin: shades the form bands behind the line and names them in the right margin.
const formBands = {
  id: "formBands",
  beforeDatasetsDraw(chart) {
    const { ctx, chartArea: a, scales: { y } } = chart;
    const zones = data.form_zones;
    const clamp = (px) => Math.max(a.top, Math.min(a.bottom, px));
    ctx.save();
    zones.forEach((z, i) => {
      const top = i === 0 ? a.top : clamp(y.getPixelForValue(zones[i - 1].min));
      const bottom = z.min == null ? a.bottom : clamp(y.getPixelForValue(z.min));
      if (bottom - top < 1) return;
      ctx.fillStyle = alpha(css(FORM_COLORS[z.name]), 0.14);
      ctx.fillRect(a.left, top, a.right - a.left, bottom - top);
      if (bottom - top >= 14) {
        ctx.fillStyle = css("--muted");
        ctx.font = `500 11px ${css("--body")}`;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(z.name, a.right + 8, (top + bottom) / 2);
      }
    });
    ctx.restore();
  },
};

function renderHero() {
  const f = data.form, t = data.today;
  $("state").textContent = f.pct != null ? `${f.state} (${f.pct > 0 ? "+" : ""}${Math.round(f.pct)}%)` : f.state;
  $("state").style.setProperty("--state-color", `var(${FORM_COLORS[f.state] || "--ink"})`);
  $("advice").textContent = f.advice;
  $("fitnessReading").textContent = fitnessReading(f);

  let hrvNote = "";
  if (t.hrv_last_night != null && t.hrv_low != null && t.hrv_high != null) {
    hrvNote = t.hrv_last_night < t.hrv_low ? "Below your range" : t.hrv_last_night > t.hrv_high ? "Above your range" : "In your normal range";
  }
  const items = [
    ["Readiness", t.readiness != null ? round(t.readiness) : null, ""],
    ["HRV last night", t.hrv_last_night != null ? `${round(t.hrv_last_night)}<span>ms</span>` : null, hrvNote],
    ["Sleep", fmtSleep(t.sleep_s), t.sleep_score != null ? `Score ${round(t.sleep_score)}` : ""],
    ["Resting HR", t.resting_hr != null ? `${round(t.resting_hr)}<span>bpm</span>` : null, t.resting_hr_7d != null ? `7-day avg: ${t.resting_hr_7d} bpm` : ""],
  ].filter((i) => i[1] != null);
  $("today").innerHTML = items
    .map(([label, val, note]) => `<div><dd>${val}</dd><dt>${label}${note ? `<span class="note">${note}</span>` : ""}</dt></div>`)
    .join("");
}

function baseOptions(extra = {}) {
  const muted = css("--muted"), rule = css("--rule");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  return {
    responsive: true, maintainAspectRatio: false, animation: reduce ? false : { duration: 400 },
    interaction: { mode: "index", intersect: false },
    plugins: { legend: { display: false }, tooltip: { backgroundColor: css("--ink"), titleColor: css("--paper"), bodyColor: css("--paper"), padding: 10 } },
    scales: {
      x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: 18 }, border: { color: rule } },
      y: { grid: { color: rule }, ticks: { color: muted }, border: { display: false } },
      ...extra,
    },
    font: { family: css("--body") },
  };
}

function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}

function alpha(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

function renderCharts() {
  Chart.defaults.font.family = css("--body");
  const easy = css("--easy"), fit = css("--fitness"), fat = css("--fatigue"), nohr = css("--nohr"), muted = css("--muted");

  // Fitness and fatigue
  const fx = data.fitness;
  const fxLabels = fx.map((d) => fmtShort(d.date));
  draw("fitnessChart", {
    type: "line",
    data: {
      labels: fxLabels,
      datasets: [
        { label: "Fitness", data: fx.map((d) => d.ctl), borderColor: fit, backgroundColor: alpha(fit, 0.1), fill: "origin", borderWidth: 2.5,
          tension: 0.3, pointRadius: fx.map((_, i) => (i === fx.length - 1 ? 4 : 0)), pointBackgroundColor: fit },
      ],
    },
    options: baseOptions(),
  });

  // Form, against the bands
  const pcts = fx.map((d) => d.form_pct).filter((v) => v != null);
  const formOpts = baseOptions({
    y: {
      min: Math.floor(Math.min(-45, ...pcts) / 10) * 10, max: Math.ceil(Math.max(40, ...pcts) / 10) * 10,
      grid: { display: false }, ticks: { color: muted, callback: (v) => `${v > 0 ? "+" : ""}${v}%` }, border: { display: false },
    },
  });
  formOpts.layout = { padding: { right: 72 } };
  formOpts.plugins.tooltip.callbacks = { label: (c) => ` Form: ${c.parsed.y > 0 ? "+" : ""}${Math.round(c.parsed.y)}%` };
  draw("formChart", {
    type: "line",
    data: {
      labels: fxLabels,
      datasets: [{ label: "Form", data: fx.map((d) => d.form_pct), borderColor: css("--ink"), borderWidth: 2, tension: 0.3, spanGaps: true,
        pointRadius: fx.map((_, i) => (i === fx.length - 1 ? 4 : 0)), pointBackgroundColor: css("--ink") }],
    },
    options: formOpts,
    plugins: [formBands],
  });

  // Weekly running
  const w = data.weeks;
  const anyUnknown = w.some((x) => x.unknown_km > 0);
  $("weeklySub").textContent = "Kilometres per week, split by Garmin's training effect for each run." +
    (data.low_share_4w != null ? ` Last 4 weeks: ${data.low_share_4w}% low aerobic.` : "");
  const sets = FOCUS.map(([key, label, color]) => ({ label, data: w.map((x) => x[`${key}_km`]), backgroundColor: css(color) }));
  if (anyUnknown) sets.push({ label: "Unknown", data: w.map((x) => x.unknown_km), backgroundColor: nohr });
  $("weeklyLegend").innerHTML = sets.map((s) => `<span><i style="background:${s.backgroundColor}"></i>${s.label}</span>`).join("");
  const wopts = baseOptions();
  wopts.scales.x.stacked = true;
  wopts.scales.y.stacked = true;
  wopts.plugins.tooltip.callbacks = {
    label: (c) => ` ${c.dataset.label}: ${c.parsed.y} km`,
    footer: (items) => { const x = w[items[0].dataIndex]; return `${x.runs} runs, ${x.hours} h`; },
  };
  draw("weeklyChart", { type: "bar", data: { labels: w.map((x) => fmtShort(x.week)), datasets: sets.map((s) => ({ ...s, borderRadius: 2, maxBarThickness: 34 })) }, options: wopts });

  // HRV with normal range
  const tr = data.trends;
  const labels = tr.map((d) => fmtShort(d.date));
  draw("hrvChart", {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Range high", data: tr.map((d) => d.hrv_high), borderWidth: 0, pointRadius: 0, fill: "+1", backgroundColor: alpha(fit, 0.12), yAxisID: "y" },
        { label: "Range low", data: tr.map((d) => d.hrv_low), borderWidth: 0, pointRadius: 0, fill: false, yAxisID: "y" },
        { label: "HRV (ms)", data: tr.map((d) => d.hrv_last_night), borderColor: fit, backgroundColor: fit, borderWidth: 2, pointRadius: 2, tension: 0.25, spanGaps: true, yAxisID: "y" },
        { label: "Resting HR (bpm)", data: tr.map((d) => d.resting_hr), borderColor: alpha(fat, 0.7), borderWidth: 1.25, borderDash: [4, 3], pointRadius: 0, tension: 0.25, spanGaps: true, yAxisID: "y2" },
      ],
    },
    options: (() => {
      const o = baseOptions({ y2: { position: "right", grid: { display: false }, ticks: { color: muted }, border: { display: false } } });
      o.plugins.tooltip.filter = (i) => !i.dataset.label.startsWith("Range");
      return o;
    })(),
  });

  // Sleep and readiness
  draw("sleepChart", {
    data: {
      labels,
      datasets: [
        { type: "bar", label: "Sleep (h)", data: tr.map((d) => (d.sleep_s ? +(d.sleep_s / 3600).toFixed(1) : null)), backgroundColor: alpha(nohr, 0.75), borderRadius: 2, yAxisID: "y" },
        { type: "line", label: "Readiness", data: tr.map((d) => d.readiness), borderColor: easy, borderWidth: 2, pointRadius: 0, tension: 0.3, spanGaps: true, yAxisID: "y2" },
      ],
    },
    options: baseOptions({
      y: { min: 0, grid: { color: css("--rule") }, ticks: { color: muted }, border: { display: false } },
      y2: { position: "right", min: 0, max: 100, grid: { display: false }, ticks: { color: muted }, border: { display: false } },
    }),
  });
}

function renderActivities() {
  $("actSub").textContent = `The dot shows Garmin's training effect for each run. Runs without a Garmin label use average heart rate against ${data.threshold} bpm.`;
  $("actLegend").innerHTML = FOCUS.map(([, label, color]) => `<span><i style="background:var(${color})"></i>${label}</span>`).join("");
  $("actBody").innerHTML = data.activities.map((a) => {
    const typeName = a.type.replace(/_/g, " ");
    const effect = a.te_label ? statusLabel(a.te_label).replace("Vo2max", "VO2 max") : FOCUS.find((f) => f[0] === a.focus)?.[1];
    return `<tr>
      <td>${fmtDay(a.date)}</td>
      <td class="name"><span class="dot ${a.focus || ""}" ${effect ? `title="${effect}"` : ""} aria-hidden="true"></span>${escapeHtml(a.name || typeName)}</td>
      <td class="num">${a.km ? a.km.toFixed(2) + " km" : ""}</td>
      <td class="num">${fmtDuration(a.duration_s)}</td>
      <td class="num">${fmtPace(a.pace_s_per_km)}</td>
      <td class="num">${a.avg_hr ? Math.round(a.avg_hr) : ""}</td>
      <td class="num">${a.load ? Math.round(a.load) : ""}</td>
    </tr>`;
  }).join("");
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

$("syncBtn").addEventListener("click", async () => {
  $("syncBtn").disabled = true;
  $("syncBtn").textContent = "Syncing…";
  await fetch("/api/sync", { method: "POST" });
  setTimeout(load, 1500);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => data && renderCharts());
load().catch(() => {
  $("notice").className = "notice";
  $("notice").textContent = "Couldn't reach the dashboard server. Check that python app.py is still running.";
  $("notice").hidden = false;
});
