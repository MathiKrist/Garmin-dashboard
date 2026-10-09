// Formatting and small helpers shared by every page

import { data } from "./state.js";

export const $ = (id) => document.getElementById(id);

export const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const fmtDay = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

export const fmtDayYear = (iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

export const fmtShort =(iso) => new Date(iso + "T12:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short" });

export const round = (v, d = 0) => (v == null ? null : Number(v).toFixed(d));

export function fmtDuration(s) {
  if (!s) return "";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function fmtPace(sPerKm) {
  if (!sPerKm) return "";
  const m = Math.floor(sPerKm / 60), s = Math.round(sPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export function fmtSleep(s) {
  if (!s) return null;
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return `${h}<span>h</span> ${m}<span>min</span>`;
}

export const plural = (n, [one, many]) => `${n.toLocaleString("en-GB")} ${n === 1 ? one : many}`;

export const sum = (as, f) => as.reduce((t, a) => t + (a[f] || 0), 0);

export const between = (list, from, to) => list.filter((a) => a.date >= from && a.date < to);

export const fmtKm = (v) => (v >= 100 ? Math.round(v).toLocaleString("en-GB") : v.toFixed(1));

export const listText = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0]);

export const mondayOf = (iso) => addDays(iso, -((new Date(iso + "T12:00:00").getDay() + 6) % 7));

export const statusLabel = (code) => code ? code.charAt(0) + code.slice(1).toLowerCase().replace(/_/g, " ") : "No data";

// "from Mon 5 Oct" for a daily value that isn't from today (the server keeps them up to a week)
export const fromDay = (iso) => (iso && iso !== data.generated ? `from ${fmtDay(iso)}` : "");

export const statItems = (items) => items
  .map(([label, val, note]) => `<div><dd>${val}</dd><dt>${label}${note ? `<span class="note">${note}</span>` : ""}</dt></div>`).join("");

export function alpha(hex, a) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export const isoDay = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };

export function fmtHours(s) {
  const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}
