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

function renderTrainingStatus() {
  const ts = data.training_status;
  $("tstatus").hidden = !ts;
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

  $("tsStrip").innerHTML = ts.history
    .map((d) => `<i style="${d.status ? `background:${statusColor(d.status)}` : ""}" title="${fmtDay(d.date)}: ${statusLabel(d.status)}"></i>`)
    .join("");
  $("tsStrip").setAttribute("aria-label", "Training status per day, last 4 weeks: " +
    ts.history.filter((d) => d.status).map((d) => `${fmtShort(d.date)} ${statusLabel(d.status)}`).join(", "));
}

function renderHero() {
  const f = data.form, t = data.today;
  const colors = { Fresh: "--easy", Rested: "--easy", Balanced: "--ink", Building: "--fitness", Overloaded: "--fatigue" };
  $("state").textContent = f.state;
  $("state").style.setProperty("--state-color", `var(${colors[f.state] || "--ink"})`);
  $("advice").textContent = f.advice;
  $("formNums").textContent = f.ctl >= 5
    ? `Fitness ${Math.round(f.ctl)}, fatigue ${Math.round(f.atl)}, form ${Math.round(f.tsb) > 0 ? "+" : ""}${Math.round(f.tsb) || 0}. Load ratio ${f.ratio.toFixed(2)} (0.8 to 1.3 is the usual safe range).`
    : "";

  let hrvNote = "";
  if (t.hrv_last_night != null && t.hrv_low != null && t.hrv_high != null) {
    hrvNote = t.hrv_last_night < t.hrv_low ? "Below your range" : t.hrv_last_night > t.hrv_high ? "Above your range" : "In your normal range";
  }
  const items = [
    ["Readiness", t.readiness != null ? round(t.readiness) : null, ""],
    ["HRV last night", t.hrv_last_night != null ? `${round(t.hrv_last_night)}<span>ms</span>` : null, hrvNote],
    ["Sleep", fmtSleep(t.sleep_s), t.sleep_score != null ? `Score ${round(t.sleep_score)}` : ""],
    ["Resting HR", t.resting_hr != null ? `${round(t.resting_hr)}<span>bpm</span>` : null, ""],
    ["Body Battery", t.bb_high != null ? round(t.bb_high) : null, t.bb_low != null ? `Low of ${round(t.bb_low)}` : ""],
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
  // Chart.js stacks axes in key order, bottom first: form strip below, fitness above.
  const fopts = baseOptions();
  fopts.scales = {
    x: fopts.scales.x,
    y2: { stack: "fit", stackWeight: 1.5, offset: true, grid: { color: css("--rule") }, ticks: { color: muted, maxTicksLimit: 3 }, border: { display: false } },
    y: { stack: "fit", stackWeight: 3, offset: true, grid: { color: css("--rule") }, ticks: { color: muted }, border: { display: false } },
  };
  draw("fitnessChart", {
    data: {
      labels: fx.map((d) => fmtShort(d.date)),
      datasets: [
        { type: "line", label: "Fitness", data: fx.map((d) => d.ctl), borderColor: fit, borderWidth: 2.5, pointRadius: 0, tension: 0.3, yAxisID: "y" },
        { type: "line", label: "Fatigue", data: fx.map((d) => d.atl), borderColor: alpha(fat, 0.8), borderWidth: 1.25, pointRadius: 0, tension: 0.3, yAxisID: "y" },
        { type: "bar", label: "Form", data: fx.map((d) => d.tsb), backgroundColor: fx.map((d) => alpha(d.tsb >= 0 ? easy : fat, 0.55)), yAxisID: "y2", barPercentage: 1, categoryPercentage: 1 },
      ],
    },
    options: fopts,
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
  $("actSub").innerHTML = "Dot colour is Garmin's training effect: " +
    FOCUS.map(([key, label]) => `<span class="dot ${key}" aria-hidden="true"></span>${label.toLowerCase()}`).join(", ") +
    `. Runs without a Garmin label use average heart rate against ${data.threshold} bpm.`;
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
