// Aerobic efficiency (running page): pace on runs at a steady, easy heart rate, and its trend over the year

import { data } from "./state.js";
import { $, css, fmtShort, fmtDuration, fmtPace, alpha, addDays } from "./util.js";
import { baseOptions, draw } from "./charts.js";

// "12 s faster than 3 months ago (5:44)"
function versus(now, before, when) {
  if (before == null) return null;
  const diff = Math.round(before - now);
  if (Math.abs(diff) < 3) return `about the same as ${when}`;
  const gap = Math.abs(diff) < 60 ? `${Math.abs(diff)} s` : fmtDuration(Math.abs(diff));
  return `${gap} ${diff > 0 ? "faster" : "slower"} than ${when} (${fmtPace(before).replace(" /km", "")})`;
}

export function renderEfficiency(key) {
  const e = key === "run" ? data.efficiency : null;
  $("effSection").hidden = !e;
  if (!e) return;
  const [lo, hi] = e.band;
  const parts = [versus(e.now, e.ago_3m, "3 months ago"), versus(e.now, e.ago_12m, "a year ago")].filter(Boolean);
  $("effReading").textContent = e.now == null
    ? `Easy runs at ${lo}–${hi} bpm: too few in the last 6 weeks for a pace now.`
    : `Easy runs at ${lo}–${hi} bpm: ${fmtPace(e.now)} now (median of the last 6 weeks)${parts.length ? `, ${parts.join(", and ")}` : ""}.`;

  // Days since the start of the chart's year, on a linear axis (Chart.js has no date axis without an adapter)
  const start = addDays(data.generated, -364);
  const x = (iso) => Math.round((new Date(iso + "T12:00:00") - new Date(start + "T12:00:00")) / 864e5);
  const fit = css("--fitness"), muted = css("--muted");
  const o = baseOptions({
    y: { reverse: true, grid: { color: css("--rule") }, border: { display: false },  // faster is higher
      ticks: { color: muted, callback: (v) => fmtPace(v).replace(" /km", "") } },
  });
  o.interaction = { mode: "nearest", intersect: false };
  o.scales.x = { ...o.scales.x, type: "linear", min: 0, max: 364,
    ticks: { ...o.scales.x.ticks, stepSize: 1, autoSkip: false,
      // A tick on the 1st of each month
      callback: (v) => { const iso = addDays(start, v); return iso.endsWith("-01") ? fmtShort(iso).split(" ")[1] : null; } } };
  o.plugins.tooltip.callbacks = {
    title: (items) => fmtShort(addDays(start, items[0].parsed.x)),
    label: (c) => (c.datasetIndex === 0
      ? ` ${e.runs[c.dataIndex].hr} bpm, ${fmtPace(c.parsed.y)}`
      : ` 6-week median: ${fmtPace(c.parsed.y)}`),
  };
  $("effChart").setAttribute("aria-label", `Pace on easy runs at ${lo}–${hi} bpm over the last year, with its 6-week median`);
  draw("effChart", {
    type: "scatter",
    data: {
      datasets: [
        { label: "Run", data: e.runs.map((r) => ({ x: x(r.date), y: r.pace_s })), backgroundColor: alpha(css("--nohr"), 0.9),
          pointRadius: 3, pointHoverRadius: 5 },
        { label: "6-week median", data: e.trend.filter((t) => t.pace_s != null).map((t) => ({ x: x(t.date), y: t.pace_s })),
          showLine: true, borderColor: fit, backgroundColor: fit, borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, tension: 0.3 },
      ],
    },
    options: o,
  });
}
