// Entry point: loads the data, keeps it fresh and shows the page picked in the menu
// (kept in the address: #overview, #health, #activities, #sport/run)

import { data, setData } from "./state.js";
import { $ } from "./util.js";
import { sportCounts, sportsByCount, sportLabel, hasPage, sportColor } from "./sports.js";
import { renderHealth } from "./health.js";
import { renderOverview, lastMap } from "./overview.js";
import { renderActivities } from "./activities.js";
import { renderSport } from "./sport.js";
import { redrawModalMap } from "./modal.js";

let pollTimer = null;

let lastJson = "";

// The race goal form asks for a reload after saving; redraw even if nothing else changed
addEventListener("reload", () => { lastJson = ""; load().catch(() => {}); });

async function load() {
  const res = await fetch("/api/dashboard");
  if (res.status === 401) {  // logged out (the password changed, or the cookie expired)
    location.href = "/login";
    return;
  }
  const text = await res.text();
  if (text !== lastJson) {  // skip redrawing the charts when nothing changed
    lastJson = text;
    setData(JSON.parse(text));
    render();
  }
  clearTimeout(pollTimer);
  if (data.syncing) pollTimer = setTimeout(load, 5000);
}

function render() {
  $("demo").hidden = !data.demo;
  $("logout").hidden = !data.login;
  const btn = $("syncBtn");
  btn.disabled = data.syncing || data.demo;
  btn.textContent = data.syncing ? "Syncing…" : "Sync now";
  $("synced").textContent = data.meta.last_sync_at
    ? "Synced " + new Date(data.meta.last_sync_at).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" })
    : "Not synced yet";

  const notice = $("notice");
  if (data.meta.last_error) {
    notice.className = "notice";
    notice.textContent = `Last sync failed: ${data.meta.last_error}`;
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  if (!data.has_data) {
    $("main").hidden = true;
    $("nav").hidden = true;
    $("empty").hidden = false;
    if (!data.syncing && !data.meta.last_sync_at) $("emptyText").textContent =
      "Nothing synced yet. Run python backend/login.py on the server machine if you haven't, then press Sync now.";
    return;
  }
  $("empty").hidden = true;
  $("main").hidden = false;
  $("nav").hidden = false;
  renderNav();
  showPage();
}

const PAGES = { overview: renderOverview, health: renderHealth, activities: renderActivities };

function route() {
  const [page, key] = location.hash.slice(1).split("/");
  if (page === "sport" && hasPage(key)) return { page: "sport", key, id: `sport/${key}` };
  return PAGES[page] ? { page, id: page } : { page: "overview", id: "overview" };
}

let shownPage = "";

export function showPage() {
  const r = route();
  // Show the page before drawing it, so its charts are drawn at their real size
  document.querySelectorAll(".page").forEach((el) => { el.hidden = el.id !== `page-${r.page}`; });
  document.querySelectorAll("#nav a").forEach((a) => {
    if (a.dataset.page === r.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  if (r.page !== "overview") lastMap.stop();
  if (r.page === "sport") renderSport(r.key); else PAGES[r.page]();
  const title = r.page === "sport" ? sportLabel(r.key) : $(`page-${r.page}`).dataset.title;
  document.title = r.page === "overview" ? "Training" : `${title} · Training`;
  if (r.id !== shownPage) {  // a new page starts at the top; a background refresh of the same page keeps its place
    if (shownPage) scrollTo(0, 0);
    shownPage = r.id;
  }
}

addEventListener("hashchange", () => { if (data?.has_data) showPage(); });

export function renderNav() {
  const counts = sportCounts(), sports = sportsByCount(counts).filter(([key]) => hasPage(key, counts));
  $("navActCount").textContent = data.activities.length;
  $("navSportsLabel").hidden = !sports.length;
  $("navSports").innerHTML = sports.map(([key, label]) => `<li><a href="#sport/${key}" data-page="sport/${key}">
    <span class="label"><i class="swatch" style="background:${sportColor(key)}"></i>${label}</span><span class="count">${counts[key]}</span></a></li>`).join("");
}

$("syncBtn").addEventListener("click", async () => {
  $("syncBtn").disabled = true;
  $("syncBtn").textContent = "Syncing…";
  await fetch("/api/sync", { method: "POST" });
  setTimeout(load, 1500);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (data?.has_data) { renderNav(); showPage(); }
  redrawModalMap();
});

// Pick up background syncs: check every 5 minutes, and right away when the tab comes back into view.
const refresh = () => { if (!document.hidden) load().catch(() => {}); };

setInterval(refresh, 5 * 60 * 1000);

document.addEventListener("visibilitychange", refresh);

load().catch((e) => {
  console.error(e);
  $("notice").className = "notice";
  $("notice").textContent = "Couldn't reach the dashboard server. Check that python backend/app.py is still running.";
  $("notice").hidden = false;
});
