// An activity in its own window (the whole screen on phones): the list's summary straight away, then every stat,
// the route and the laps once they've loaded, and for a run or ride the coach's review when asked for

import { data } from "./state.js";
import { $, fmtDuration, fmtPace, statusLabel, sum, fmtHours } from "./util.js";
import { routeMap } from "./map.js";
import { headlineStats, KMH_SPORTS, fmtSpeed, effectCell, COLUMNS, measureFor, tableParts, sportLabel, actRows } from "./sports.js";
import { sportIcon } from "./icons.js";
import { loadReview, reviewLabel } from "./workout.js";
import { sheetStep } from "./nav.js";

// The sports the coach reviews (the server's review.SPORTS), and what one of their activities is called
const REVIEW_NOUN = { run: "run", bike: "ride" };

export const modalMap = routeMap($("modalMap"));

// Lists an activity can be opened from: activity rows, the table's rows, a personal best's top 5
const LISTS = ".acts, .act-table tbody, .rec-top";

const actId = (el) => Number(el.dataset.id || el.dataset.act);

// Any activity row, or a personal best, opens the activity, and swiping moves along the list it was in
document.addEventListener("click", (e) => {
  const el = e.target.closest(".act-table tbody tr[data-id], [data-act]");
  if (!el) return;
  const box = el.closest(LISTS);
  openActivity(actId(el), box ? [...new Set([...box.querySelectorAll("tr[data-id], [data-act]")].map(actId))] : null);
});

const modal = $("actModal");

let modalAct = null, modalDetail = null;

// The activities a swipe (or the arrow keys) moves through: the list the activity was opened from, in the order
// shown (a week's, the Activities page with its filter and sort, a sport's, a personal best's top 5), or else every
// activity, newest first
let modalList = [];

const newestFirst = () => data.activities.slice()
  .sort((a, b) => (b.start || b.date).localeCompare(a.start || a.date)).map((a) => a.id);

// Whether an activity is shown (rather than a week's list)
export const showingActivity = () => !!modalAct;

// The activity before (dir -1) or after (dir 1) the one shown, in its list, or with a week shown the week before or
// after that has any; null at either end
export function neighbour(dir) {
  if (modalWeek) return modalWeek.step?.(dir) ?? null;
  const i = modalAct ? modalList.indexOf(modalAct.id) : -1;
  return i >= 0 ? modalList[i + dir] ?? null : null;
}

// Show that one instead; the back button still closes the activity (or goes back to the week) in one step
export function stepActivity(dir) {
  const to = neighbour(dir);
  if (to != null) {
    if (modalWeek) openWeek(to); else openActivity(to);
  }
  return to != null;
}

// Wide screens: the arrow keys move along the list
modal.addEventListener("keydown", (e) => {
  if ((e.key === "ArrowLeft" || e.key === "ArrowRight") && !e.target.closest("input, textarea, select, .leaflet-container")) {
    if (stepActivity(e.key === "ArrowLeft" ? -1 : 1)) e.preventDefault();
  }
});

// The week shown in the popup (sports.weekOf), and the one an activity opened from it goes back to
let modalWeek = null, backTo = null;

function showModal() {
  if (!modal.open) {
    modal.showModal();
    document.body.classList.add("modal-open");
  }
  modal.querySelector(".modal-box").scrollTop = 0;
}

// A week's activities from a weekly chart's bar: its totals and the list, each opening the activity
export function openWeek(week) {
  modalWeek = week;
  backTo = modalAct = modalDetail = null;
  modalMap.stop();
  const { key, title, range, partial, rows } = week;
  const list = rows.slice().sort((a, b) => (a.start || a.date).localeCompare(b.start || b.date));
  const { byKm, of, small } = measureFor(list);
  const stat = (label, v) => `<div><dt>${label}</dt><dd>${v.replace(/\s(\S*[a-z]\S*)$/i, "<span>$1</span>")}</dd></div>`;
  $("modalBack").hidden = true;
  $("modalWhen").textContent = [sportLabel(key), range, partial ? "so far" : ""].filter(Boolean).join(" · ");
  $("modalName").textContent = title;
  $("modalIcon").innerHTML = sportIcon(key);
  $("modalEffect").hidden = true;
  showReviewButton(null);
  $("modalStats").innerHTML = [
    byKm ? stat("Distance", small(of(list))) : "",
    stat("Time", fmtHours(sum(list, "duration_s"))),
    stat(list.length === 1 ? "Activity" : "Activities", String(list.length)),
    sum(list, "load") ? stat("Load", String(Math.round(sum(list, "load")))) : "",
  ].join("");
  const t = tableParts(list, key);
  $("modalDetails").innerHTML = `<section class="dgroup wide act-list"><ul class="acts">${actRows(list)}</ul>
    <div class="scroll"><table class="act-table"><thead>${t.head}</thead><tbody>${t.body}</tbody></table></div></section>`;
  $("modalMap").hidden = true;
  showModalStatus("");
  showModal();
}

// Back to the week's list: a step back in history, as the phone's back button does (see nav.js)
$("modalBack").addEventListener("click", () => {
  if (history.state?.sub) history.back(); else if (backTo) openWeek(backTo);
});

addEventListener("popstate", () => {
  if (modal.open && backTo && history.state?.sheet === "actModal" && !history.state.sub) openWeek(backTo);
});

// list: the ids of the list it was opened from, if any (see modalList)
export async function openActivity(id, list = null) {
  const a = data.activities.find((x) => x.id === id);
  if (!a) return;
  if (list?.includes(id)) modalList = list;
  else if (!modalList.includes(id)) modalList = newestFirst();
  // Opened from a week's list: a link back to it, and a step in history for the back button to undo
  if (modalWeek) {
    backTo = modalWeek;
    if (modal.open) sheetStep();
  }
  modalWeek = null;
  $("modalBack").hidden = !backTo;
  if (backTo) $("modalBack").textContent = `← ${backTo.title}`;
  modalAct = a;
  modalDetail = null;
  $("modalWhen").textContent = [COLUMNS.date[2](a) + (a.start ? `, ${a.start.slice(11, 16)}` : ""), a.location].filter(Boolean).join(" · ");
  $("modalName").textContent = a.name || a.type.replace(/_/g, " ");
  $("modalIcon").innerHTML = sportIcon(a.sport);
  showReviewButton(a);
  $("modalEffect").innerHTML = effectCell(a);
  $("modalEffect").hidden = !$("modalEffect").innerHTML;
  $("modalStats").innerHTML = headlineStats(a);
  $("modalDetails").innerHTML = "";
  $("modalMap").hidden = true;
  showModalStatus("Loading details…");
  showModal();
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

// The coach's review of a run or ride: a button, and the review under it once pressed (Claude is asked only then)
function showReviewButton(a) {
  const noun = a && REVIEW_NOUN[a.sport], btn = $("modalReviewBtn");
  $("modalReviewWrap").hidden = !noun;
  $("modalReview").hidden = true;
  $("modalReview").innerHTML = "";
  btn.setAttribute("aria-expanded", "false");
  if (noun) btn.innerHTML = reviewLabel(noun);
}

$("modalReviewBtn").addEventListener("click", () => {
  const btn = $("modalReviewBtn"), a = modalAct, open = btn.getAttribute("aria-expanded") === "true";
  if (!a) return;
  if (open) return showReviewButton(a);
  btn.textContent = "Hide review";
  btn.setAttribute("aria-expanded", "true");
  loadReview($("modalReview"), a.id, () => modalAct === a && btn.getAttribute("aria-expanded") === "true");
});

export function showModalStatus(text) {
  $("modalStatus").textContent = text || "";
  $("modalStatus").hidden = !text;
}

export function closeModal() {
  modal.close();
}

modal.addEventListener("close", () => {
  modalMap.stop();
  modalAct = modalDetail = modalWeek = backTo = null;
  modalList = [];
  document.body.classList.remove("modal-open");
});

$("modalClose").addEventListener("click", closeModal);

// The dialog itself only receives clicks on its backdrop, as .modal-box covers everything inside it.
// The press has to start there too, so selecting text and letting go outside doesn't close it.
let pressedOutside = false;

modal.addEventListener("pointerdown", (e) => { pressedOutside = e.target === modal; });

modal.addEventListener("click", (e) => { if (e.target === modal && pressedOutside) closeModal(); });

// Garmin's training effect messages ("IMPROVING_AEROBIC_BASE_8") as words
export const teMessage = (m) => (m ? statusLabel(m.replace(/_\d+$/, "")) : "");

export const num = (v, digits = 0, unit = "") => (v == null ? null : `${Number(v).toFixed(digits)}${unit ? ` ${unit}` : ""}`);

export const signed = (v, unit = "") => (v == null ? null : `${v > 0 ? "+" : ""}${Math.round(v)}${unit ? ` ${unit}` : ""}`);

// Garmin's zone colors, grey to red
export const ZONE_COLORS = ["--z1", "--z2", "--z3", "--z4", "--z5"];

export function zoneBars(zones, label) {
  const total = zones.reduce((t, s) => t + (s || 0), 0);
  const top = Math.max(...zones) || 1;
  return `<div class="zones" role="img" aria-label="${label}: ${zones.map((s, i) => `zone ${i + 1} ${fmtDuration(s) || "0:00"}`).join(", ")}">` +
    zones.map((s, i) => `<div class="zrow"><span>Zone ${i + 1}</span>
      <div class="zbar"><i style="width:${((s || 0) / top) * 100}%;background:var(${ZONE_COLORS[i]})"></i></div>
      <span class="zval">${fmtDuration(s) || "0:00"}<small>${Math.round(((s || 0) / total) * 100)}%</small></span></div>`).join("") +
    "</div>";
}

// Garmin splits a resort ski day into a lap per run, so winter sports call them runs
export const lapName = (d) => (d.sport === "winter" ? "Run" : "Lap");

// Splits worked out for a run or ride recorded without laps (per km, per 5 km on a ride): each by the km it ends at,
// a short last one by its own distance, as Strava shows them
const splitName = (l, i, d) => {
  const every = d.sport === "bike" ? 5 : 1;
  return Math.abs(l.km - every) < 0.01 ? (i + 1) * every : l.km.toFixed(2);
};

// Lap table columns: [header, cell], headers taking the activity and whether the rows are splits; columns that are empty
// for every row are left out
export const LAP_COLUMNS = [
  [(d, split) => (split ? "Km" : lapName(d)), (l, i, d, split) => (split ? splitName(l, i, d) : i + 1)],
  [() => "Distance", (l, i, d, split) => (l.km && !split ? `${l.km.toFixed(2)} km` : "")],
  [() => "Time", (l) => fmtDuration(l.duration_s)],
  [(d) => (KMH_SPORTS.includes(d.sport) ? "Speed" : "Pace"), (l, i, d) => fmtSpeed({ sport: d.sport, speed: l.speed })],
  [(d) => (KMH_SPORTS.includes(d.sport) ? "Max speed" : "Best pace"), (l, i, d) => fmtSpeed({ sport: d.sport, speed: l.max_speed })],
  [() => "Avg HR", (l) => (l.avg_hr ? Math.round(l.avg_hr) : "")],
  [() => "Max HR", (l) => (l.max_hr ? Math.round(l.max_hr) : "")],
  [() => "Ascent", (l) => (l.elev_gain ? `${Math.round(l.elev_gain)} m` : "")],
  [() => "Descent", (l) => (l.elev_loss ? `${Math.round(l.elev_loss)} m` : "")],
  [() => "Climb", (l) => (l.elev != null ? `${l.elev > 0 ? "+" : ""}${l.elev} m` : "")],
  [() => "Cadence", (l) => (l.cadence ? Math.round(l.cadence) : "")],
  [() => "Power", (l) => (l.power ? `${Math.round(l.power)} W` : "")],
];

export function lapTable(d, rows = d.laps, split = false) {
  const cols = LAP_COLUMNS.filter(([, cell]) => rows.some((l, i) => cell(l, i, d, split) !== ""));
  return `<div class="scroll"><table class="laps"><thead><tr>${cols.map(([h], i) => `<th${i ? ' class="num"' : ""}>${h(d, split)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((l, li) => `<tr>${cols.map(([, cell], i) => `<td${i ? ' class="num"' : ""}>${cell(l, li, d, split)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

export function renderModalDetail() {
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
    (d.laps.length > 1 ? `<section class="dgroup wide"><h3>${lapName(d)}s</h3>${lapTable(d)}</section>` :
      d.splits?.length ? `<section class="dgroup wide"><h3>Splits</h3>${lapTable(d, d.splits, true)}</section>` : "");
}
