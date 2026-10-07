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
      "Nothing synced yet. Run python backend/login.py on the server machine if you haven't, then press Sync now.";
    return;
  }
  $("empty").hidden = true;
  $("main").hidden = false;

  renderLastActivity();
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

// The newest activity at the top: name, when, the sport's stats, and its route on a map when it has GPS
function renderLastActivity() {
  const a = data.last_activity;
  $("lastAct").hidden = !a;
  if (!a) return;
  const days = Math.round((new Date(data.generated + "T12:00:00") - new Date(a.date + "T12:00:00")) / 864e5);
  const day = days === 0 ? "Today" : days === 1 ? "Yesterday" : COLUMNS.date[2](a);
  $("lastWhen").textContent = ["Last activity", `${day}${a.start ? `, ${a.start.slice(11, 16)}` : ""}`, a.location].filter(Boolean).join(" · ");
  $("lastName").textContent = a.name || a.type.replace(/_/g, " ");
  $("lastEffect").innerHTML = effectCell(a);
  $("lastEffect").hidden = !$("lastEffect").innerHTML;
  $("lastStats").innerHTML = headlineStats(a);
  lastMap.show(a.track, a.name || "last activity", a.sport);
}

// The sport's table columns minus ascent and load, with the unit set small ("5.08 km" -> 5.08 <span>km</span>)
function headlineStats(a) {
  return (SPORT_COLUMNS[a.sport] || SPORT_COLUMNS.other)
    .filter((key) => !["date", "name", "effect", "ascent", "load"].includes(key))
    .map((key) => [COLUMNS[key][0], String(COLUMNS[key][2](a))])
    .filter(([, v]) => v !== "")
    .map(([label, v]) => `<div><dd>${v.replace(/\s(\S*[a-z]\S*)$/i, "<span>$1</span>")}</dd><dt>${label}</dt></div>`)
    .join("");
}

// Esri's muted grey basemaps (no API key needed), so the route is what stands out; light or dark to match the page
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{z}/{y}/{x}";
const TILES = ESRI.replace("{service}", "Canvas/World_{style}_Gray_Base");
// Terrain shading laid over the grey map (blended in index.html); "" or "_Dark" to match the page
const HILLSHADE = ESRI.replace("{service}", "Elevation/World_Hillshade{shade}");
const SATELLITE = ESRI.replace("{service}", "World_Imagery");

// Sports with their own route color (a CSS variable), pale core and map; everything else is orange on the grey map
const ROUTE_STYLES = {
  winter: { color: "--route-winter", core: "#EAFBFF", map: "hillshade" },  // shading shows the slopes
  swim: { color: "--route-swim", core: "#E2FCFF", map: "satellite" },  // the water and shoreline
  disc_golf: { color: "--route-disc", core: "#FFE0F4", map: "satellite" },  // fairways and tree lines
};
const DEFAULT_ROUTE = { color: "--route", core: "#FFE0B0", map: "grey" };

// A glowing route map in `el`; show(track, name, sport) draws a route (hiding the map when there's no GPS) and replays it once
function routeMap(el) {
  let map = null, layers = null, route = null, stopReplay = null;
  const fitRoute = () => {
    map.invalidateSize();
    map.fitBounds(route.getBounds(), { padding: [24, 24], animate: false });
  };
  // The sport's map: grey, grey with hillshade, or satellite, in the page's light or dark style
  function setBase(kind, dark) {
    const { grey, hillshade, satellite } = layers;
    const wanted = kind === "satellite" ? [satellite] : kind === "hillshade" ? [grey, hillshade] : [grey];
    [grey, hillshade, satellite].forEach((l) => { if (!wanted.includes(l)) l.remove(); });
    const style = dark ? "Dark" : "Light", shade = dark ? "_Dark" : "";
    if (grey.options.style !== style) { grey.options.style = style; grey.redraw(); }
    if (hillshade.options.shade !== shade) { hillshade.options.shade = shade; hillshade.redraw(); }
    wanted.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
  }
  function show(track, name, sport) {
    el.hidden = !(track?.length > 1 && window.L);  // no GPS, or Leaflet didn't load
    if (el.hidden) return;
    const look = ROUTE_STYLES[sport] || DEFAULT_ROUTE;
    if (!map) {
      map = L.map(el, { scrollWheelZoom: false, attributionControl: false });
      // The panel settles its size after the map is made (fonts load, the map stretches to the status column,
      // the popup opens), so refit the whole route whenever the map's size changes
      new ResizeObserver(() => { if (route && el.offsetHeight) fitRoute(); }).observe(el);
      L.control.attribution({ prefix: false }).addTo(map);
      layers = {
        grey: L.tileLayer(TILES, {
          style: "", maxZoom: 16,  // Esri's grey canvas stops at zoom 16
          attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
        }),
        hillshade: L.tileLayer(HILLSHADE, { shade: null, maxZoom: 16, className: "tiles-hillshade", attribution: "Esri, USGS" }),
        satellite: L.tileLayer(SATELLITE, { maxZoom: 18, className: "tiles-satellite", attribution: "Esri, Maxar, Earthstar Geographics" }),
      };
    }
    setBase(look.map, matchMedia("(prefers-color-scheme: dark)").matches);
    stopReplay?.();
    route?.remove();
    const line = css(look.color), paper = css("--paper");
    el.style.setProperty("--route", line);  // the glow filter in index.html follows the route's color
    const dot = (p, color, extra) => L.circleMarker(p, { radius: 5.5, color: paper, weight: 2.5, fillColor: color, fillOpacity: 1, ...extra });
    const stroke = (weight, opacity, extra) => L.polyline(track, { color: line, weight, opacity, lineJoin: "round", lineCap: "round", interactive: false, ...extra });
    const lines = [
      stroke(14, 0.12),  // glow: two wide faint halos fading out from the line
      stroke(8, 0.25),
      stroke(3.5, 1, { className: "route-glow" }),
      stroke(1.2, 0.9, { color: look.core }),  // hot pale centre, like a lit filament
    ];
    // Distance covered at each GPS point, so the replay's runner moves at an even speed
    const along = [0];
    for (let i = 1; i < track.length; i++) along.push(along[i - 1] + metres(track[i - 1], track[i]));
    const finish = dot(track[track.length - 1], css("--fatigue"));
    route = L.featureGroup([...lines, finish, dot(track[0], css("--easy"))]).addTo(map);
    if (el.offsetHeight) fitRoute();  // a map in a closed popup is fitted by the ResizeObserver when it opens
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const runner = dot(track[0], "#FFFFFF", { radius: 6, color: line, className: "route-glow" });
      stopReplay = replayRoute({ map, track, along, lines, finish, runner });
    }
    el.setAttribute("aria-label", `Map of the route: ${name}`);
  }
  return { show, stop: () => stopReplay?.() };
}
const lastMap = routeMap($("lastMap"));
const modalMap = routeMap($("modalMap"));

// Metres between two [lat, lon] points (flat-earth approximation, plenty for points a few metres apart)
function metres([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  return Math.hypot((lon2 - lon1) * rad * Math.cos((lat1 + lat2) / 2 * rad), (lat2 - lat1) * rad) * 6371e3;
}
// The [lat, lon] reached after `m` metres along the track; `along` holds the distance at each point
function pointAt(track, along, m, from = 0) {
  let i = from;
  while (i < track.length - 2 && along[i + 1] < m) i++;
  const f = (m - along[i]) / (along[i + 1] - along[i] || 1);
  return [track[i][0] + (track[i + 1][0] - track[i][0]) * f, track[i][1] + (track[i + 1][1] - track[i][1]) * f];
}

// Draws the route from start to finish once, with a glowing dot running at its head; returns a function that stops it and shows the whole route
const REPLAY_MS = 3500;
function replayRoute({ map, track, along, lines, finish, runner }) {
  const total = along[along.length - 1], paths = lines.map((l) => l.getElement());
  runner.addTo(map);
  finish.getElement().style.opacity = 0;
  let frame, i = 0, len = 0;
  // Measuring a long path is slow, so it's done once and again only after a zoom or pan redraws it at a new size.
  // The four lines share one shape, so the first one's length does for all of them.
  const remeasure = () => { len = 0; };
  map.on("zoomend viewreset moveend", remeasure);
  const t0 = performance.now();
  const step = (now) => {
    const f = Math.min(1, (now - t0) / REPLAY_MS), d = f * total;
    if (!len) {
      len = paths[0].getTotalLength();
      paths.forEach((p) => { p.style.strokeDasharray = len; });
    }
    paths.forEach((p) => { p.style.strokeDashoffset = len * (1 - f); });
    while (i < track.length - 2 && along[i + 1] < d) i++;
    runner.setLatLng(pointAt(track, along, d, i));
    if (f < 1) frame = requestAnimationFrame(step); else stop();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    map.off("zoomend viewreset moveend", remeasure);
    runner.remove();
    paths.forEach((p) => { p.style.strokeDasharray = p.style.strokeDashoffset = ""; });
    finish.getElement().style.opacity = "";
  };
  frame = requestAnimationFrame(step);
  return stop;
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
        fill: "start", borderWidth: 2, spanGaps: true,
        tension: 0.4, cubicInterpolationMode: "monotone",  // smooth curve that never overshoots past the real values
        pointRadius: v.weeks.map((_, i) => (i === v.weeks.length - 1 ? 4 : 0)), pointBackgroundColor: fit }],
    },
    options: o,
  });
}

// Sport groups from metrics.SPORTS, with their button labels (the filter sorts them by count)
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

// Pace for foot sports, per 100 m in the pool; speed on the bike (only mixed in the All list)
// Sports measured in km/h rather than a pace
const KMH_SPORTS = ["bike", "winter"];
function fmtSpeed(a) {
  if (!a.speed) return "";
  if (KMH_SPORTS.includes(a.sport)) return `${(a.speed * 3.6).toFixed(1)} km/h`;
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

// Garmin's label where there is one; for runs without it, the focus from average HR (marked as such).
// Only for endurance sports: on strength, yoga or a walk the label says little.
const EFFECT_SPORTS = ["run", "bike", "swim", "cardio"];
function effectCell(a) {
  let name, group;
  if (!EFFECT_SPORTS.includes(a.sport)) return "";
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

// Table columns: key -> [header, right-aligned, cell]. A cell returns "" when it has nothing to show.
const COLUMNS = {
  date: ["Date", false, (a) => (a.date.slice(0, 4) === data.generated.slice(0, 4) ? fmtDay(a.date) : fmtDayYear(a.date))],
  name: ["Activity", false, (a) => escapeHtml(a.name || a.type.replace(/_/g, " "))],
  effect: ["Effect", false, effectCell],
  distance: ["Distance", true, (a) => (a.km ? `${a.km.toFixed(2)} km` : "")],
  time: ["Time", true, (a) => fmtDuration(a.duration_s)],
  pace: ["Pace", true, fmtSpeed],
  speed: ["Speed", true, (a) => (a.speed ? `${(a.speed * 3.6).toFixed(1)} km/h` : "")],
  ascent: ["Ascent", true, (a) => (a.elev_m >= 1 ? `${Math.round(a.elev_m)} m` : "")],
  descent: ["Descent", true, (a) => (a.descent_m >= 1 ? `${Math.round(a.descent_m)} m` : "")],
  sets: ["Sets", true, (a) => a.sets ?? ""],
  reps: ["Reps", true, (a) => a.reps ?? ""],
  hr: ["Avg HR", true, (a) => (a.avg_hr ? Math.round(a.avg_hr) : "")],
  load: ["Load", true, (a) => (a.load ? Math.round(a.load) : "")],
};
// Which columns each sport shows, in order
const SPORT_COLUMNS = {
  all: ["date", "name", "effect", "distance", "time", "pace", "hr", "load"],
  run: ["date", "name", "effect", "distance", "time", "pace", "hr", "load"],
  walk: ["date", "name", "distance", "time", "pace", "ascent", "hr"],
  hike: ["date", "name", "distance", "time", "ascent", "pace", "hr", "load"],
  bike: ["date", "name", "effect", "distance", "time", "speed", "ascent", "hr", "load"],
  swim: ["date", "name", "effect", "distance", "time", "pace", "hr", "load"],
  strength: ["date", "name", "time", "sets", "reps", "hr", "load"],
  cardio: ["date", "name", "effect", "time", "hr", "load"],
  disc_golf: ["date", "name", "distance", "time", "hr"],
  yoga: ["date", "name", "time", "hr"],
  winter: ["date", "name", "distance", "time", "speed", "descent", "hr", "load"],  // resort skiing records no ascent
  other: ["date", "name", "distance", "time", "hr", "load"],
};

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
  // Most-used sports first; "Other" always last
  const options = [["all", "All"], ...SPORTS.filter(([key]) => counts[key])
    .sort((a, b) => (a[0] === "other") - (b[0] === "other") || counts[b[0]] - counts[a[0]])];
  $("sportFilter").innerHTML = options.map(([key, label]) =>
    `<button type="button" data-sport="${key}" aria-pressed="${key === sport}">${label}<span>${key === "all" ? acts.length : counts[key]}</span></button>`).join("");

  const list = sport === "all" ? acts : acts.filter((a) => a.sport === sport);
  const rows = list.slice(0, shown);
  // The sport's columns, minus any that are empty for every row shown (e.g. sets when Garmin didn't record them)
  const cols = (SPORT_COLUMNS[sport] || SPORT_COLUMNS.other).map((key) => [key, ...COLUMNS[key]])
    .filter(([key, , , cell]) => key === "date" || key === "name" || rows.some((a) => cell(a) !== ""));
  if (sport === "all") cols.find((c) => c[0] === "pace")?.splice(1, 1, "Pace / speed");
  $("actHead").innerHTML = `<tr>${cols.map(([, head, num]) => `<th${num ? ' class="num"' : ""}>${head}</th>`).join("")}</tr>`;
  // The whole row opens the activity; the name is a button so it can be reached with the keyboard too
  $("actBody").innerHTML = rows.map((a) => `<tr data-id="${a.id}">${cols.map(([key, , num, cell]) => key === "name"
    ? `<td class="name"><button type="button" class="act-link">${cell(a)}</button></td>`
    : `<td${num ? ' class="num"' : ""}>${cell(a)}</td>`).join("")}</tr>`).join("");
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
$("actBody").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-id]");
  if (row) openActivity(Number(row.dataset.id));
});

// ---- Activity popup: the list's summary straight away, then every stat, the route and the laps once they've loaded

const modal = $("actModal");
let modalAct = null, modalDetail = null;

async function openActivity(id) {
  const a = data.activities.find((x) => x.id === id);
  if (!a) return;
  modalAct = a;
  modalDetail = null;
  $("modalWhen").textContent = [COLUMNS.date[2](a) + (a.start ? `, ${a.start.slice(11, 16)}` : ""), a.location].filter(Boolean).join(" · ");
  $("modalName").textContent = a.name || a.type.replace(/_/g, " ");
  $("modalEffect").innerHTML = effectCell(a);
  $("modalEffect").hidden = !$("modalEffect").innerHTML;
  $("modalStats").innerHTML = headlineStats(a);
  $("modalDetails").innerHTML = "";
  $("modalMap").hidden = true;
  showModalStatus("Loading details…");
  if (!modal.open) {
    modal.showModal();
    document.body.classList.add("modal-open");
  }
  modal.querySelector(".modal-box").scrollTop = 0;
  try {
    const res = await fetch(`/api/activity/${id}`);
    if (!res.ok) throw new Error(res.status);
    const d = await res.json();
    if (modalAct !== a) return;  // another activity was opened meanwhile
    modalDetail = d;
    renderModalDetail();
  } catch {
    if (modalAct === a) showModalStatus("Couldn't load the details. Check that the dashboard server is still running.");
  }
}

function showModalStatus(text) {
  $("modalStatus").textContent = text || "";
  $("modalStatus").hidden = !text;
}

function closeModal() {
  modal.close();
}
modal.addEventListener("close", () => {
  modalMap.stop();
  modalAct = modalDetail = null;
  document.body.classList.remove("modal-open");
});
$("modalClose").addEventListener("click", closeModal);
// The dialog itself only receives clicks on its backdrop, as .modal-box covers everything inside it.
// The press has to start there too, so selecting text and letting go outside doesn't close it.
let pressedOutside = false;
modal.addEventListener("pointerdown", (e) => { pressedOutside = e.target === modal; });
modal.addEventListener("click", (e) => { if (e.target === modal && pressedOutside) closeModal(); });

// Garmin's training effect messages ("IMPROVING_AEROBIC_BASE_8") as words
const teMessage = (m) => (m ? statusLabel(m.replace(/_\d+$/, "")) : "");
const num = (v, digits = 0, unit = "") => (v == null ? null : `${Number(v).toFixed(digits)}${unit ? ` ${unit}` : ""}`);
const signed = (v, unit = "") => (v == null ? null : `${v > 0 ? "+" : ""}${Math.round(v)}${unit ? ` ${unit}` : ""}`);

// Garmin's zone colors, grey to red
const ZONE_COLORS = ["--z1", "--z2", "--z3", "--z4", "--z5"];
function zoneBars(zones, label) {
  const total = zones.reduce((t, s) => t + (s || 0), 0);
  const top = Math.max(...zones) || 1;
  return `<div class="zones" role="img" aria-label="${label}: ${zones.map((s, i) => `zone ${i + 1} ${fmtDuration(s) || "0:00"}`).join(", ")}">` +
    zones.map((s, i) => `<div class="zrow"><span>Zone ${i + 1}</span>
      <div class="zbar"><i style="width:${((s || 0) / top) * 100}%;background:var(${ZONE_COLORS[i]})"></i></div>
      <span class="zval">${fmtDuration(s) || "0:00"}<small>${Math.round(((s || 0) / total) * 100)}%</small></span></div>`).join("") +
    "</div>";
}

// Garmin splits a resort ski day into a lap per run, so winter sports call them runs
const lapName = (d) => (d.sport === "winter" ? "Run" : "Lap");
// Lap table columns: [header, cell], headers taking the activity; columns that are empty for every lap are left out
const LAP_COLUMNS = [
  [lapName, (l, i) => i + 1],
  [() => "Distance", (l) => (l.km ? `${l.km.toFixed(2)} km` : "")],
  [() => "Time", (l) => fmtDuration(l.duration_s)],
  [(d) => (KMH_SPORTS.includes(d.sport) ? "Speed" : "Pace"), (l, i, d) => fmtSpeed({ sport: d.sport, speed: l.speed })],
  [(d) => (KMH_SPORTS.includes(d.sport) ? "Max speed" : "Best pace"), (l, i, d) => fmtSpeed({ sport: d.sport, speed: l.max_speed })],
  [() => "Avg HR", (l) => (l.avg_hr ? Math.round(l.avg_hr) : "")],
  [() => "Max HR", (l) => (l.max_hr ? Math.round(l.max_hr) : "")],
  [() => "Ascent", (l) => (l.elev_gain ? `${Math.round(l.elev_gain)} m` : "")],
  [() => "Descent", (l) => (l.elev_loss ? `${Math.round(l.elev_loss)} m` : "")],
  [() => "Cadence", (l) => (l.cadence ? Math.round(l.cadence) : "")],
  [() => "Power", (l) => (l.power ? `${Math.round(l.power)} W` : "")],
];
function lapTable(d) {
  const cols = LAP_COLUMNS.filter(([, cell]) => d.laps.some((l, i) => cell(l, i, d) !== ""));
  return `<div class="scroll"><table class="laps"><thead><tr>${cols.map(([h], i) => `<th${i ? ' class="num"' : ""}>${h(d)}</th>`).join("")}</tr></thead>
    <tbody>${d.laps.map((l, li) => `<tr>${cols.map(([, cell], i) => `<td${i ? ' class="num"' : ""}>${cell(l, li, d)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function renderModalDetail() {
  const d = modalDetail, s = d.stats;
  showModalStatus(d.details_error);
  modalMap.show(d.track, d.name || "activity", d.sport);

  const row = (label, value) => (value == null || value === "" ? "" : `<div><dt>${label}</dt><dd>${value}</dd></div>`);
  const group = (title, rows, extra = "", cls = "") => {
    const body = rows.join("");
    return body || extra ? `<section class="dgroup ${cls}"><h3>${title}</h3>${body ? `<dl>${body}</dl>` : ""}${extra}</section>` : "";
  };
  const foot = ["run", "walk", "hike"].includes(d.sport), kmh = KMH_SPORTS.includes(d.sport);
  const speedOf = (v) => (v ? fmtSpeed({ sport: d.sport, speed: v }) : null);
  // Garmin counts vigorous minutes double
  const intensity = s.moderate_min != null || s.vigorous_min != null
    ? `${(s.moderate_min || 0) + 2 * (s.vigorous_min || 0)}<small>${s.moderate_min || 0} moderate · ${s.vigorous_min || 0} vigorous</small>` : null;

  const groups = [
    group("Time and effort", [
      row("Moving time", fmtDuration(d.duration_s)),
      row("Elapsed time", s.elapsed_s && Math.abs(s.elapsed_s - d.duration_s) >= 5 ? fmtDuration(s.elapsed_s) : null),
      row("Training load", d.load ? Math.round(d.load) : null),
      row("Runs", d.sport === "winter" && s.lap_count > 1 ? s.lap_count : null),
      // Garmin's calories include what the body burns at rest anyway
      row("Calories", s.calories == null ? null : num(s.calories, 0, "kcal") +
        (s.bmr_calories ? `<small>${Math.round(s.calories - s.bmr_calories)} active · ${Math.round(s.bmr_calories)} resting</small>` : "")),
      row("Steps", s.steps ? Math.round(s.steps).toLocaleString("en-GB") : null),
      row("Body Battery", signed(s.body_battery)),
      row("Est. sweat loss", num(s.water_ml, 0, "ml")),
      row("Intensity minutes", intensity),
    ]),
    group("Training effect", [
      row("Aerobic", s.aerobic_te != null ? `${num(s.aerobic_te, 1)}<small>${teMessage(s.aerobic_msg)}</small>` : null),
      row("Anaerobic", s.anaerobic_te != null ? `${num(s.anaerobic_te, 1)}<small>${teMessage(s.anaerobic_msg)}</small>` : null),
      row("VO2 max", num(s.vo2max)),
    ]),
    group("Heart rate", [
      row("Average", num(d.avg_hr, 0, "bpm")),
      row("Max", num(s.max_hr, 0, "bpm")),
    ], d.hr_zones ? zoneBars(d.hr_zones, "Time in heart rate zones") : ""),
    group(kmh ? "Speed" : "Pace", [
      row(kmh ? "Average" : "Average pace", speedOf(d.speed)),
      row(kmh ? "Max" : "Best pace", speedOf(s.max_speed)),
      row("Grade-adjusted pace", d.sport === "run" ? speedOf(s.gap_speed) : null),
    ]),
    group("Running dynamics", foot ? [
      row("Cadence", num(s.cadence, 0, "spm")),
      row("Max cadence", num(s.max_cadence, 0, "spm")),
      row("Stride length", s.stride_cm ? num(s.stride_cm / 100, 2, "m") : null),
      row("Ground contact", num(s.gct_ms, 0, "ms")),
      row("Contact balance", s.gct_balance ? `${num(s.gct_balance, 1)}% L / ${num(100 - s.gct_balance, 1)}% R` : null),
      row("Vertical oscillation", num(s.vert_osc_cm, 1, "cm")),
      row("Vertical ratio", num(s.vert_ratio, 1, "%")),
    ] : []),
    group("Cadence", d.sport === "bike" ? [
      row("Average", num(s.bike_cadence, 0, "rpm")),
      row("Max", num(s.max_bike_cadence, 0, "rpm")),
    ] : []),
    group("Power", [
      row("Average", num(s.power, 0, "W")),
      row("Normalized", num(s.norm_power, 0, "W")),
      row("Max", num(s.max_power, 0, "W")),
    ], d.power_zones ? zoneBars(d.power_zones, "Time in power zones") : ""),
    group("Swimming", d.sport === "swim" ? [
      row("Pool length", num(s.pool_m, 0, "m")),
      row("Lengths", s.lengths),
      row("Strokes", s.strokes),
      row("Avg SWOLF", num(s.swolf)),
      row("Distance per stroke", num(s.stroke_m, 2, "m")),
      row("Stroke rate", num(s.swim_cadence, 0, "spm")),
    ] : []),
    group("Strength", [row("Sets", d.sets), row("Reps", d.reps)]),
    group("Elevation", [
      row("Ascent", d.elev_m >= 1 ? num(d.elev_m, 0, "m") : null),
      row("Descent", num(s.elev_loss, 0, "m")),
      row("Lowest", num(s.min_elev, 0, "m")),
      row("Average", num(s.avg_elev, 0, "m")),
      row("Highest", num(s.max_elev, 0, "m")),
      // Mostly noise on flat ground; on a mountain it's how fast you dropped or climbed
      row("Max vertical speed", ["winter", "hike"].includes(d.sport) ? num(s.max_vert_speed, 1, "m/s") : null),
    ]),
    group("Breathing", [
      row("Average", num(s.resp, 0, "brpm")),
      row("Lowest", num(s.min_resp, 0, "brpm")),
      row("Highest", num(s.max_resp, 0, "brpm")),
    ]),
    group("Temperature", [row("Lowest", num(s.min_temp, 0, "°C")), row("Highest", num(s.max_temp, 0, "°C"))]),
    group("Best efforts", d.best.map((b) => row(b.label, `${fmtDuration(b.s)}<small>${fmtPace(b.s / b.m * 1000)}</small>`))),
  ];
  $("modalDetails").innerHTML = groups.join("") +
    (d.laps.length > 1 ? `<section class="dgroup wide"><h3>${lapName(d)}s</h3>${lapTable(d)}</section>` : "");
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

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (data) { renderCharts(); renderLastActivity(); }
  if (modalDetail) modalMap.show(modalDetail.track, modalDetail.name || "activity", modalDetail.sport);
});
// Pick up background syncs: check every 5 minutes, and right away when the tab comes back into view.
const refresh = () => { if (!document.hidden) load().catch(() => {}); };
setInterval(refresh, 5 * 60 * 1000);
document.addEventListener("visibilitychange", refresh);
load().catch(() => {
  $("notice").className = "notice";
  $("notice").textContent = "Couldn't reach the dashboard server. Check that python backend/app.py is still running.";
  $("notice").hidden = false;
});
