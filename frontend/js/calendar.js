// Training calendar: the last 53 weeks, a square per day shaded by its training load (like GitHub's contribution graph)

import { data } from "./state.js";
import { $, css, fmtDay, mondayOf, alpha, addDays, fmtHours, escapeHtml } from "./util.js";

const WEEKS = 53;
// Shades of the fitness color for the four load levels (quartiles of the days you trained)
const LEVEL_ALPHA = [0.25, 0.45, 0.7, 1];

// The [25th, 50th, 75th] percentile of the training days' loads, splitting them into four levels
function quartiles(loads) {
  const sorted = loads.slice().sort((a, b) => a - b);
  return [0.25, 0.5, 0.75].map((q) => sorted[Math.floor(q * (sorted.length - 1))]);
}

export function renderCalendar() {
  const today = data.generated, start = addDays(mondayOf(today), -7 * (WEEKS - 1));
  // Each day's activities, load and time
  const byDay = {};
  data.activities.forEach((a) => {
    if (a.date < start) return;
    const d = (byDay[a.date] ??= { acts: [], load: 0, time: 0 });
    d.acts.push(a);
    d.load += a.load || 0;
    d.time += a.duration_s || 0;
  });
  const trained = Object.values(byDay);
  $("calSection").hidden = !trained.length;
  if (!trained.length) return;

  const cuts = quartiles(trained.map((d) => d.load));
  const level = (d) => (d.load <= cuts[0] ? 0 : d.load <= cuts[1] ? 1 : d.load <= cuts[2] ? 2 : 3);
  const fit = css("--fitness"), colors = LEVEL_ALPHA.map((a) => alpha(fit, a));

  // The grid fills column by column: a column per week, Monday at the top
  const cells = [];
  for (let w = 0; w < WEEKS; w++) {
    const monday = addDays(start, 7 * w);
    // The month's name above the first week that starts in it
    const month = monday.slice(5, 7) !== addDays(monday, -7).slice(5, 7) || w === 0
      ? new Date(monday + "T12:00:00").toLocaleDateString("en-GB", { month: "short" }) : "";
    cells.push(`<span class="cal-month">${w === 0 && monday.slice(8) > "24" ? "" : month}</span>`);
    for (let i = 0; i < 7; i++) {
      const iso = addDays(monday, i), d = byDay[iso];
      if (iso > today) { cells.push('<i class="cal-day future"></i>'); continue; }
      if (!d) { cells.push(`<i class="cal-day" title="${fmtDay(iso)}: rest"></i>`); continue; }
      // The day's biggest activity opens when the square is clicked
      const top = d.acts.reduce((b, a) => ((a.load || 0) > (b.load || 0) ? a : b));
      const names = d.acts.map((a) => a.name || a.type.replace(/_/g, " ")).join(", ");
      const tip = `${fmtDay(iso)}: ${names} · ${fmtHours(d.time)}${d.load ? ` · load ${Math.round(d.load)}` : ""}`;
      cells.push(`<i class="cal-day on" data-act="${top.id}" style="background:${colors[level(d)]}" title="${escapeHtml(tip)}"></i>`);
    }
  }
  const labels = ["", "Mon", "", "Wed", "", "Fri", "", ""].map((l) => `<span class="cal-label">${l}</span>`).join("");
  $("cal").innerHTML = `<div class="cal-labels">${labels}</div><div class="cal-grid">${cells.join("")}</div>`;

  // Training days, the longest run of days in a row with training, and days a week
  const days = Object.keys(byDay).sort();
  let streak = 0, best = 0, prev = null;
  days.forEach((d) => { streak = prev && addDays(prev, 1) === d ? streak + 1 : 1; best = Math.max(best, streak); prev = d; });
  const span = Math.round((new Date(today + "T12:00:00") - new Date(start + "T12:00:00")) / 864e5) + 1;
  $("calReading").textContent = `${days.length} training days in the last ${WEEKS} weeks, ${(days.length / span * 7).toFixed(1)} a week. ` +
    `Longest streak: ${best} day${best === 1 ? "" : "s"}.`;
  $("cal").setAttribute("aria-label", `Training calendar, last ${WEEKS} weeks: ${days.length} training days`);
  $("calLegend").innerHTML = `<span>Less</span>${colors.map((c) => `<i style="background:${c}"></i>`).join("")}<span>More load</span>`;
  // Phones show the newest weeks first; the older ones are a scroll to the left
  const scroller = $("cal").parentElement;
  scroller.scrollLeft = scroller.scrollWidth;
}
