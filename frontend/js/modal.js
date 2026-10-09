// Activity popup: the list's summary straight away, then every stat, the route and the laps once they've loaded

import { data } from "./state.js";
import { $, fmtDuration, fmtPace, statusLabel } from "./util.js";
import { routeMap } from "./map.js";
import { headlineStats, KMH_SPORTS, fmtSpeed, effectCell, COLUMNS } from "./sports.js";

export const modalMap = routeMap($("modalMap"));

// Any activity row, or a personal best, opens the activity
document.addEventListener("click", (e) => {
  const el = e.target.closest(".act-table tbody tr[data-id], [data-act]");
  if (el) openActivity(Number(el.dataset.id || el.dataset.act));
});

const modal = $("actModal");

let modalAct = null, modalDetail = null;

export async function openActivity(id) {
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

export function showModalStatus(text) {
  $("modalStatus").textContent = text || "";
  $("modalStatus").hidden = !text;
}

// After a theme change: redraw the open popup's map in the new colors
export function redrawModalMap() {
  if (modalDetail) modalMap.show(modalDetail.track, modalDetail.name || "activity", modalDetail.sport);
}

export function closeModal() {
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

// Lap table columns: [header, cell], headers taking the activity; columns that are empty for every lap are left out
export const LAP_COLUMNS = [
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

export function lapTable(d) {
  const cols = LAP_COLUMNS.filter(([, cell]) => d.laps.some((l, i) => cell(l, i, d) !== ""));
  return `<div class="scroll"><table class="laps"><thead><tr>${cols.map(([h], i) => `<th${i ? ' class="num"' : ""}>${h(d)}</th>`).join("")}</tr></thead>
    <tbody>${d.laps.map((l, li) => `<tr>${cols.map(([, cell], i) => `<td${i ? ' class="num"' : ""}>${cell(l, li, d)}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
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
    (d.laps.length > 1 ? `<section class="dgroup wide"><h3>${lapName(d)}s</h3>${lapTable(d)}</section>` : "");
}
