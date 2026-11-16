// Chart.js setup shared by every chart

import { $, css, alpha } from "./util.js";

export const charts = {};

export function stackedBarOptions(tooltip) {
  const o = baseOptions();
  o.scales.x.stacked = o.scales.y.stacked = true;
  o.plugins.tooltip.callbacks = tooltip;
  return o;
}

// Bars rounded at the top, with a thin line of the card's color between stacked segments
export const barStyle = () => ({ borderRadius: 4, borderSkipped: "bottom", borderWidth: { top: 2 }, borderColor: css("--panel"), maxBarThickness: 34 });

// A bar for a period that isn't over yet (this week, this month, today) is drawn paler, so it doesn't read as a drop
export const PARTIAL_ALPHA = 0.45;

export const partialColors = (color, isPartial) => isPartial.map((p) => (p ? alpha(color, PARTIAL_ALPHA) : color));

// Phones get fewer, smaller axis labels
const narrow = () => innerWidth < 600;

export function baseOptions(extra = {}) {
  const muted = css("--muted"), rule = css("--rule");
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const size = narrow() ? 10.5 : 11.5;
  Chart.defaults.font.family = css("--body");
  Chart.defaults.font.size = size;
  return {
    responsive: true, maintainAspectRatio: false, animation: reduce ? false : { duration: 450, easing: "easeOutQuart" },
    interaction: { mode: "index", intersect: false },
    layout: { padding: { top: 4 } },
    plugins: { legend: { display: false }, tooltip: {
      backgroundColor: css("--ink"), titleColor: css("--paper"), bodyColor: css("--paper"), footerColor: css("--paper"),
      padding: 10, cornerRadius: 10, boxPadding: 4, titleFont: { weight: 600 }, footerFont: { weight: 400 }, caretSize: 5,
    } },
    scales: {
      x: { grid: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkipPadding: narrow() ? 14 : 20 }, border: { color: rule } },
      y: { grid: { color: rule }, ticks: { color: muted, maxTicksLimit: narrow() ? 5 : 7, padding: 4 }, border: { display: false } },
      ...extra,
    },
    font: { family: css("--body") },
  };
}

// Which of the label positions `at` fit along a chart as wide as canvas `id`'s, each label needing `px`: all of
// them, or every 2nd or 3rd counted back from the newest
export function monthTicks(id, at, px = 34) {
  const room = Math.max(2, Math.floor(($(id).parentElement.clientWidth - 36) / px));
  const step = Math.ceil(at.length / room);
  return new Set(at.filter((_, i) => (at.length - 1 - i) % step === 0));
}

export function draw(id, config) {
  charts[id]?.destroy();
  charts[id] = new Chart($(id), config);
}
