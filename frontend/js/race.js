// Race goal: target, Garmin's prediction and how far apart they are; the result after race day

import { data } from "./state.js";
import { $, css, fmtDayYear, fmtShort, fmtDuration, fmtPace, statItems } from "./util.js";
import { baseOptions, draw } from "./charts.js";

export const isRaceDistance = (m) => data.race_distances.includes(m);

export const raceDistance = (m) => (isRaceDistance(m) ? data.distances[m] : `${+(m / 1000).toFixed(2)} km`);

// "50:00" or "1:45:00" -> seconds
export function parseTime(text) {
  const parts = text.trim().split(":");
  if (parts.length < 2 || parts.length > 3 || parts.some((p) => !/^\d+$/.test(p))) return null;
  return parts.map(Number).reduce((t, v) => t * 60 + v, 0) || null;
}

export function renderRace() {
  const r = data.race;
  $("race").hidden = !r;
  $("raceAdd").hidden = !!r;
  if (!r) return;
  const pace = (sec) => fmtPace(sec / r.metres * 1000);
  const d = r.days_to_go;
  $("raceWhen").textContent = [fmtDayYear(r.date), raceDistance(r.metres),
    d > 1 ? `${d} days to go` : d === 1 ? "Tomorrow" : d === 0 ? "Today" : null].filter(Boolean).join(" · ");
  $("raceName").textContent = r.name;
  const items = [["Target", fmtDuration(r.target_s), pace(r.target_s)]];
  if (r.result) {
    // After race day: the time, over or under the target
    const gap = r.result.s - r.target_s;
    items.push(["Result", fmtDuration(r.result.s),
      `<span class="${gap > 0 ? "over" : "under"}">${gap > 0 ? "+" : "−"}${fmtDuration(Math.abs(gap)) || "0:00"}</span> vs target`]);
  } else if (r.predicted_s) {
    const gap = r.predicted_s - r.target_s;
    items.push(["Garmin predicts", fmtDuration(r.predicted_s), pace(r.predicted_s)],
      ["Gap", gap > 0 ? fmtDuration(gap) : "On target", gap > 0 ? "to find" : ""]);
  }
  $("raceStats").innerHTML = statItems(items);

  const h = r.history;
  $("raceTrend").hidden = h.length < 2;
  if (h.length < 2) return;
  const fit = css("--fitness"), ink = css("--ink");
  const o = baseOptions({
    // Faster is higher, so the prediction climbs toward the target as you get fitter
    y: { reverse: true, grid: { color: css("--rule") }, ticks: { color: css("--muted"), callback: (v) => fmtDuration(v) }, border: { display: false },
      suggestedMin: Math.min(r.target_s, ...h.map((x) => x.s)) - 30, suggestedMax: Math.max(r.target_s, ...h.map((x) => x.s)) + 30 },
  });
  o.plugins.tooltip.callbacks = { label: (c) => ` ${c.dataset.label}: ${fmtDuration(c.parsed.y)}` };
  draw("raceChart", {
    type: "line",
    data: {
      labels: h.map((x) => fmtShort(x.date)),
      datasets: [
        { label: "Garmin predicts", data: h.map((x) => x.s), borderColor: fit, backgroundColor: fit, borderWidth: 2, tension: 0.3,
          pointRadius: h.map((_, i) => (i === h.length - 1 ? 4 : 0)) },
        { label: "Target", data: h.map(() => r.target_s), borderColor: ink, borderWidth: 1.5, borderDash: [6, 4], pointRadius: 0 },
      ],
    },
    options: o,
  });
}

const raceDialog = $("raceDialog");

export function openRaceForm() {
  const r = data.race;
  $("raceInName").value = r?.name || "";
  $("raceInDate").value = r?.date || "";
  $("raceInDist").innerHTML = data.race_distances.map((m) => `<option value="${m}">${data.distances[m]}</option>`).join("") +
    '<option value="custom">Other</option>';
  const preset = r && isRaceDistance(r.metres) ? String(r.metres) : r ? "custom" : "10000";
  $("raceInDist").value = preset;
  $("raceInKm").value = preset === "custom" ? +(r.metres / 1000).toFixed(2) : "";
  $("raceInKmWrap").hidden = preset !== "custom";
  $("raceInTime").value = r ? fmtDuration(r.target_s) : "";
  $("raceRemove").hidden = !r;
  $("raceError").hidden = true;
  raceDialog.showModal();
}

export async function raceRequest(method, body) {
  const res = await fetch("/api/race", { method, headers: { "Content-Type": "application/json" }, body: body && JSON.stringify(body) });
  if (res.status === 404 || res.status === 405) throw new Error("The dashboard server is older than this page. Restart it, then try again.");
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Couldn't save the race goal.");
  raceDialog.close();
  dispatchEvent(new Event("reload"));  // main.js reloads and redraws, even though only the goal changed
}

export const raceFail = (e) => { $("raceError").textContent = e.message; $("raceError").hidden = false; };

$("raceAdd").addEventListener("click", openRaceForm);

$("raceEdit").addEventListener("click", openRaceForm);

$("raceCancel").addEventListener("click", () => raceDialog.close());

$("raceInDist").addEventListener("change", () => { $("raceInKmWrap").hidden = $("raceInDist").value !== "custom"; });

$("raceRemove").addEventListener("click", () => raceRequest("DELETE").catch(raceFail));

$("raceForm").addEventListener("submit", (e) => {
  e.preventDefault();
  const dist = $("raceInDist").value, metres = dist === "custom" ? Number($("raceInKm").value) * 1000 : Number(dist);
  const target = parseTime($("raceInTime").value);
  if (!metres) return raceFail(new Error("Enter the distance in kilometres."));
  if (!target) return raceFail(new Error("Enter the target time as minutes:seconds or hours:minutes:seconds."));
  raceRequest("POST", { name: $("raceInName").value, date: $("raceInDate").value, metres, target_s: target }).catch(raceFail);
});
