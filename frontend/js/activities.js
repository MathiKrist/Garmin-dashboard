// Activities: everything, filterable by sport

import { data } from "./state.js";
import { $, escapeHtml } from "./util.js";
import { sportCounts, sportsByCount, sportLabel, PAGE, DEFAULT_SORT, sortRows, nextSort, tableParts, renderVolume } from "./sports.js";

let sport = "all";

try { sport = localStorage.getItem("sport") || "all"; } catch {}

let shown = PAGE;

let sort = DEFAULT_SORT;

let query = "";

// Activities whose name, place or type contains the search text
const matches = (a, q) => [a.name, a.location, a.type.replace(/_/g, " ")].some((t) => t && t.toLowerCase().includes(q));

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
  // The search and the sort order only change the table; the totals next to it follow the sport filter
  const q = query.trim().toLowerCase(), rows = sortRows(q ? list.filter((a) => matches(a, q)) : list, sort);
  const t = tableParts(rows.slice(0, shown), sport, sort);
  $("actHead").innerHTML = t.head;
  $("actBody").innerHTML = rows.length ? t.body : `<tr><td class="no-match" colspan="${t.width}">No activities match “${escapeHtml(query.trim())}”.</td></tr>`;
  $("actMore").hidden = rows.length <= shown;
  $("actMore").textContent = `Show more (${rows.length - shown} left)`;

  renderVolume($("actVolume"), list, sport === "all" ? "All activities" : sportLabel(sport), sport === "all" ? null : sport);
}

$("sportFilter").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sport]");
  if (b) setSport(b.dataset.sport);
});

$("actMore").addEventListener("click", () => { shown += PAGE; renderActivities(); });

$("actHead").addEventListener("click", (e) => {
  const b = e.target.closest("button[data-sort]");
  if (!b) return;
  sort = nextSort(sort, b.dataset.sort);
  renderActivities();
});

$("actSearch").addEventListener("input", (e) => {
  query = e.target.value;
  shown = PAGE;
  renderActivities();
});
