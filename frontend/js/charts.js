// Chart.js setup shared by every chart

import { $, css, alpha } from "./util.js";

export const charts = {};

export function stackedBarOptions(tooltip) {
  const o = baseOptions();
  o.scales.x.stacked = o.scales.y.stacked = true;
  o.plugins.tooltip.callbacks = tooltip;
  return o;
}

// Bars rounded at the top, with a thin line of page color between stacked segments
export const barStyle = () => ({ borderRadius: 2, borderSkipped: "bottom", borderWidth: { top: 2 }, borderColor: css("--paper"), maxBarThickness: 34 });

// A bar for a period that isn't over yet (this week, this month, today) is drawn paler, so it doesn't read as a drop
export const PARTIAL_ALPHA = 0.45;

export const partialColors = (color, isPartial) => isPartial.map((p) => (p ? alpha(color, PARTIAL_ALPHA) : color));

export function baseOptions(extra = {}) {
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

export function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}
