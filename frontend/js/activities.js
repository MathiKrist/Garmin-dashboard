// Activities: everything, filterable by sport

import { data } from "./state.js";
import { $ } from "./util.js";
import { sportCounts, sportsByCount, sportLabel, PAGE, tableParts, renderVolume } from "./sports.js";

let sport = "all";

try { sport = localStorage.getItem("sport") || "all"; } catch {}

let shown = PAGE;

export function setSport(s) {
  sport = s;
  shown = PAGE;
  try { localStorage.setItem("sport", s); } catch {}
  renderActivities();
}

export function renderActivities() {
  const acts = data.activities, counts = sportCounts();
  if (sport !== "all" && !counts[sport]) sport = "all";
  const options = [["all", "All"], ...sportsByCount(counts)];
  $("sportFilter").innerHTML = options.map(([key, label]) =>
    `<button type="button" data-sport="${key}" aria-pressed="${key === sport}">${label}<span>${key === "all" ? acts.length : counts[key]}</span></button>`).join("");

  const list = sport === "all" ? acts : acts.filter((a) => a.sport === sport);
  const t = tableParts(list.slice(0, shown), sport);
  $("actHead").innerHTML = t.head;
  $("actBody").innerHTML = t.body;
  $("actMore").hidden = list.length <= shown;
  $("actMore").textContent = `Show more (${list.length - shown} left)`;

  renderVolume($("actVolume"), list, sport === "all" ? "All activities" : sportLabel(sport), sport === "all" ? null : sport);
}

$("sportFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sport]");
  if (b) setSport(b.dataset.sport);
});

$("actMore").addEventListener("click", () => { shown += PAGE; renderActivities(); });
