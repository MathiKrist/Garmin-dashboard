const $ = (id) => document.getElementById(id);
const charts = {};
let data = null;
let pollTimer = null;

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
const fmtDayYear = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtShort =(iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });
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

let lastJson = "";
async function load() {
  const res = await fetch("/api/dashboard");
  const text = await res.text();
  if (text !== lastJson) {  // skip redrawing the charts when nothing changed
    lastJson = text;
    data = JSON.parse(text);
    render();
  }
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

  renderVo2max();

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

// One plain-language sentence on where VO2 max stands against 3 and 12 months ago.
function vo2Reading(v) {
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

function renderVo2max() {
  const v = data.vo2max;
  $("vo2Section").hidden = !v;
  if (!v) return;
  $("vo2Reading").textContent = vo2Reading(v);
  const fit = css("--fitness");
  const vals = v.weeks.map((x) => x.vo2max).filter((x) => x != null);
  const o = baseOptions({
    y: { suggestedMin: Math.floor(Math.min(...vals) - 1), suggestedMax: Math.ceil(Math.max(...vals) + 1),
      grid: { color: css("--rule") }, ticks: { color: css("--muted"), precision: 0 }, border: { display: false } },
  });
  // One tick at the first week of each month (every 2nd or 3rd month over long ranges); the tooltip names the week
  const sameYear = v.weeks[0].week.slice(0, 4) === data.generated.slice(0, 4);
  const fmtMonth = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", sameYear ? { month: "short" } : { month: "short", year: "2-digit" });
  const step = v.weeks.length > 80 ? 3 : v.weeks.length > 60 ? 2 : 1;
  const month = (i) => v.weeks[i].week.slice(0, 7);
  const tickAt = (i) => i > 0 && month(i) !== month(i - 1) && Number(month(i).slice(5)) % step === 0;
  o.scales.x.ticks = { ...o.scales.x.ticks, autoSkip: false, callback: (i) => (tickAt(i) ? fmtMonth(v.weeks[i].week) : null) };
  o.plugins.tooltip.callbacks = {
    title: (items) => `Week of ${fmtShort(v.weeks[items[0].dataIndex].week)}`,
    label: (c) => ` VO2 max: ${c.parsed.y.toFixed(1)}`,
  };
  draw("vo2Chart", {
    type: "line",
    data: {
      labels: v.weeks.map((x) => x.week),
      datasets: [{ label: "VO2 max", data: v.weeks.map((x) => x.vo2max), borderColor: fit, backgroundColor: alpha(fit, 0.1),
        fill: "start", borderWidth: 2, stepped: "before", spanGaps: true,
        pointRadius: v.weeks.map((_, i) => (i === v.weeks.length - 1 ? 4 : 0)), pointBackgroundColor: fit }],
    },
    options: o,
  });
}

// Sport groups from metrics.SPORTS, in the order the filter shows them
const SPORTS = [
  ["run", "Running"], ["walk", "Walking"], ["hike", "Hiking"], ["bike", "Cycling"], ["swim", "Swimming"],
  ["strength", "Strength"], ["cardio", "Gym & cardio"], ["disc_golf", "Disc golf"], ["yoga", "Yoga"],
  ["winter", "Winter sports"], ["other", "Other"],
];
const PAGE = 25;
let sport = "all";
try { sport = localStorage.getItem("sport") || "all"; } catch {}
let shown = PAGE;

const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
function fmtHours(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

// Pace for foot sports, speed on the bike, per 100 m in the pool
function fmtSpeed(a) {
  if (!a.speed) return "";
  if (a.sport === "bike") return `${(a.speed * 3.6).toFixed(1)} km/h`;
  if (a.sport === "swim") return fmtPace(100 / a.speed).replace("/km", "/100m");
  if (["run", "walk", "hike"].includes(a.sport)) return fmtPace(1000 / a.speed);
  return "";
}

// Garmin's primary training effect label -> [name, load focus group for the dot color]
const EFFECTS = {
  RECOVERY: ["Recovery", "low"], AEROBIC_BASE: ["Base", "low"], TEMPO: ["Tempo", "high"],
  LACTATE_THRESHOLD: ["Threshold", "high"], VO2MAX: ["VO2 max", "high"],
  ANAEROBIC_CAPACITY: ["Anaerobic", "anaerobic"], SPRINT: ["Sprint", "anaerobic"],
};

// Garmin's label where there is one; for runs without it, the focus from average HR (marked as such)
function effectCell(a) {
  let name, group;
  if (a.te_label) {
    [name, group] = EFFECTS[a.te_label] || [statusLabel(a.te_label), ""];
  } else if (a.focus) {
    name = `${FOCUS.find((f) => f[0] === a.focus)[1]} (HR)`;
    group = a.focus;
  } else {
    return "";
  }
  return `<span class="dot ${group}" aria-hidden="true"></span>${name}`;
}

function setSport(s) {
  sport = s;
  shown = PAGE;
  try { localStorage.setItem("sport", s); } catch {}
  renderActivities();
}

function renderActivities() {
  const acts = data.activities;
  const counts = {};
  acts.forEach((a) => { counts[a.sport] = (counts[a.sport] || 0) + 1; });
  if (sport !== "all" && !counts[sport]) sport = "all";
  const options = [["all", "All"], ...SPORTS.filter(([key]) => counts[key])];
  $("sportFilter").innerHTML = options.map(([key, label]) =>
    `<button type="button" data-sport="${key}" aria-pressed="${key === sport}">${label}<span>${key === "all" ? acts.length : counts[key]}</span></button>`).join("");

  const list = sport === "all" ? acts : acts.filter((a) => a.sport === sport);
  $("paceHead").textContent = sport === "bike" ? "Speed" : sport === "all" ? "Pace / speed" : "Pace";
  $("actBody").innerHTML = list.slice(0, shown).map((a) => {
    const typeName = a.type.replace(/_/g, " ");
    return `<tr>
      <td>${a.date.slice(0, 4) === data.generated.slice(0, 4) ? fmtDay(a.date) : fmtDayYear(a.date)}</td>
      <td class="name">${escapeHtml(a.name || typeName)}</td>
      <td>${effectCell(a)}</td>
      <td class="num">${a.km ? a.km.toFixed(2) + " km" : ""}</td>
      <td class="num">${fmtDuration(a.duration_s)}</td>
      <td class="num">${fmtSpeed(a)}</td>
      <td class="num">${a.avg_hr ? Math.round(a.avg_hr) : ""}</td>
      <td class="num">${a.load ? Math.round(a.load) : ""}</td>
    </tr>`;
  }).join("");
  $("actMore").hidden = list.length <= shown;
  $("actMore").textContent = `Show more (${list.length - shown} left)`;

  renderVolume(list);
}

// Strava-style totals for the selected sport: this week day by day, and this year
function renderVolume(list) {
  const today = data.generated;
  const monday = addDays(today, -((new Date(today + "T12:00:00").getDay() + 6) % 7));
  const year = today.slice(0, 4);
  const sum = (as, f) => as.reduce((t, a) => t + (a[f] || 0), 0);
  // Distance where the sport has it (running, cycling…), otherwise time (strength, yoga…)
  const byKm = sum(list.filter((a) => a.date.startsWith(year)), "km") > 0;
  const value = (as) => (byKm ? sum(as, "km") : sum(as, "duration_s"));
  const big = (v) => (byKm ? `${v.toFixed(1)}<span>km</span>` : fmtHours(v).replace(/(\d+)([hm])/g, "$1<span>$2</span>"));
  const small = (v) => (byKm ? `${v.toFixed(1)} km` : fmtHours(v));
  const between = (from, to) => list.filter((a) => a.date >= from && a.date < to);
  const count = (n) => `${n} ${n === 1 ? "activity" : "activities"}`;

  const label = sport === "all" ? "All activities" : SPORTS.find(([key]) => key === sport)[1];
  $("volSport").textContent = label;

  const week = between(monday, addDays(monday, 7));
  $("volWeek").innerHTML = big(value(week));
  const prev4 = value(between(addDays(monday, -28), monday)) / 4;
  const weekNote = [count(week.length)];
  if (byKm && week.length) weekNote.push(fmtHours(sum(week, "duration_s")));
  if (prev4 > 0) weekNote.push(`4-week avg ${small(prev4)}`);
  $("volWeekNote").textContent = weekNote.join(" · ");

  const days = [...Array(7)].map((_, i) => {
    const iso = addDays(monday, i);
    return { iso, v: value(list.filter((a) => a.date === iso)) };
  });
  const top = Math.max(...days.map((d) => d.v)) || 1;
  $("volDays").innerHTML = days.map((d, i) => {
    const cls = d.iso === today ? "is-today" : d.iso > today ? "future" : "";
    const h = d.v ? Math.max(6, (d.v / top) * 100) : 0;
    return `<div class="${cls}" title="${fmtDay(d.iso)}: ${d.v ? small(d.v) : "rest"}"><div class="bar"><i style="height:${h}%"></i></div><span class="day">${"MTWTFSS"[i]}</span></div>`;
  }).join("");
  $("volDays").setAttribute("aria-label", `${label} this week by day: ` + days.filter((d) => d.iso <= today).map((d) => `${fmtDay(d.iso)} ${d.v ? small(d.v) : "rest"}`).join(", "));

  const yr = list.filter((a) => a.date.startsWith(year));
  $("volYear").innerHTML = big(value(yr));
  const elev = sum(yr, "elev_m");
  const yearNote = [count(yr.length)];
  if (byKm) yearNote.push(fmtHours(sum(yr, "duration_s")));
  if (byKm && elev >= 1) yearNote.push(`${Math.round(elev).toLocaleString("en-GB")} m climbed`);
  if (data.activities_from > `${year}-01-01`) yearNote.push(`synced from ${fmtShort(data.activities_from)}`);
  $("volYearNote").textContent = yearNote.join(" · ");
}

$("sportFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sport]");
  if (b) setSport(b.dataset.sport);
});
$("actMore").addEventListener("click", () => { shown += PAGE; renderActivities(); });

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
// Pick up background syncs: check every 5 minutes, and right away when the tab comes back into view.
const refresh = () => { if (!document.hidden) load().catch(() => {}); };
setInterval(refresh, 5 * 60 * 1000);
document.addEventListener("visibilitychange", refresh);
load().catch(() => {
  $("notice").className = "notice";
  $("notice").textContent = "Couldn't reach the dashboard server. Check that python app.py is still running.";
  $("notice").hidden = false;
});
