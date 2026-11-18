// Entry point: loads the data, keeps it fresh and shows the page picked in the tabs (phones) or the menu (wide screens),
// kept in the address: #home, #train, #activities, #progress, #health, #sport/run

import { onRoute, goTab, openSub, goBack } from "./nav.js";
import { initGestures, TABS } from "./gestures.js";
import { data, setData } from "./state.js";
import { $ } from "./util.js";
import { fillIcons } from "./icons.js";
import { sportCounts, sportsByCount, sportLabel, hasPage, sportColor } from "./sports.js";
import { renderHealth } from "./health.js";
import { renderHome, lastMap } from "./home.js";
import { renderProgress } from "./progress.js";
import { renderActivities } from "./activities.js";
import { renderSport } from "./sport.js";
import { renderWorkout, lastWorkoutMap } from "./workout.js";
import { renderPlan } from "./plan.js";
import "./chat.js";
import "./modal.js";

fillIcons();

let pollTimer = null;

let lastJson = "";

// The race goal and plan forms ask for a reload after saving; redraw even if nothing else changed
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

// "Fri 14:27" for a timestamp from the server
const fmtWhen = (iso) => new Date(iso).toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });

const all = (sel) => document.querySelectorAll(sel);

// The sync buttons (the menu's, and the one in the settings) and when it last synced
function renderSync(syncing = data.syncing) {
  const synced = data.meta.last_sync_at ? `Synced ${fmtWhen(data.meta.last_sync_at)}` : "Not synced yet";
  all(".js-synced").forEach((el) => { el.textContent = syncing ? "Syncing…" : synced; });
  all(".js-sync").forEach((b) => { b.disabled = syncing || data.demo; b.classList.toggle("syncing", syncing); });
  $("syncBtn").textContent = syncing ? "Syncing…" : "Sync now";
  $("settingsBtn").classList.toggle("syncing", syncing);
  $("settingsBtn").classList.toggle("has-error", !!data.meta.last_error);
}

function render() {
  $("loading").hidden = true;
  all(".demo-tag").forEach((el) => { el.hidden = !data.demo; });
  $("logout").hidden = !data.login;
  renderSync();

  const notice = $("notice");
  if (data.meta.last_error) {
    notice.className = "notice";
    const at = data.meta.last_error_at ? ` (${fmtWhen(data.meta.last_error_at)})` : "";
    notice.textContent = `Last sync failed${at}: ${data.meta.last_error}`;
    notice.hidden = false;
  } else {
    notice.hidden = true;
  }

  if (!data.has_data) {
    $("main").hidden = $("nav").hidden = $("tabbar").hidden = true;
    $("empty").hidden = false;
    if (!data.syncing && !data.meta.last_sync_at) $("emptyText").textContent =
      "Nothing synced yet. Run python backend/login.py on the server machine if you haven't, then press Sync now in the settings.";
    return;
  }
  $("empty").hidden = true;
  $("main").hidden = $("nav").hidden = $("tabbar").hidden = false;
  renderNav();
  showPage();
}

// The Train page also holds the training plan its sessions come from
const PAGES = { home: renderHome, train: () => { renderWorkout(); renderPlan(); }, activities: renderActivities,
  progress: renderProgress, health: renderHealth };
// Addresses from before the pages were rearranged
const OLD = { overview: "home", workout: "train", plan: "train" };

function route(hash = location.hash) {
  const [name, key] = hash.slice(1).split("/");
  if (name === "sport" && hasPage(key)) return { page: "sport", key, id: `sport/${key}` };
  const page = OLD[name] || name;
  return PAGES[page] ? { page, id: page } : { page: "home", id: "home" };
}

let shownPage = "";

// The side the next page slides in from: a tab further right, or a sport's page, from the right; going back from the left
let slideFrom = "";

// Go to a tab, or a sport's page (which back returns from)
function navigate(hash) {
  const from = route(), to = route(hash);
  if (to.id === from.id) return;
  slideFrom = to.page === "sport" ? "right" : from.page === "sport" ? "left"
    : TABS.indexOf(to.page) > TABS.indexOf(from.page) ? "right" : "left";
  if (to.page === "sport") openSub(hash); else goTab(to.id);
}

function back() {
  slideFrom = "left";
  goBack();
}

// y: how far down to scroll a page that's new on screen (back to where it was left, when going back)
export function showPage(y = 0) {
  const r = route();
  // Show the page before drawing it, so its charts are drawn at their real size
  all(".page").forEach((el) => {
    el.hidden = el.id !== `page-${r.page}`;
    el.classList.remove("from-left", "from-right");
    if (!el.hidden && slideFrom && r.id !== shownPage) el.classList.add(`from-${slideFrom}`);
  });
  slideFrom = "";
  // A sport's page belongs under Progress in the tabs, and has its own line in the menu
  const tab = r.page === "sport" ? "progress" : r.id;
  all("#nav a").forEach((a) => { if (a.dataset.page === r.id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  all("#tabbar a").forEach((a) => { if (a.dataset.page === tab) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
  if (r.page !== "home") lastMap.stop();
  if (r.page !== "train") lastWorkoutMap.stop();
  if (r.page === "sport") renderSport(r.key); else PAGES[r.page]();
  const title = r.page === "sport" ? sportLabel(r.key) : $(`page-${r.page}`).dataset.title;
  document.title = r.page === "home" ? "Training" : `${title} · Training`;
  $("topbarTitle").textContent = title;
  $("backBtn").hidden = r.page !== "sport";
  // A new page starts at the top (or where it was left, going back); a background refresh of the same page keeps its place
  if (r.id !== shownPage) {
    if (shownPage) scrollTo(0, y);
    shownPage = r.id;
  }
}

// Back and forward (the phone's back button), or an address edited by hand
onRoute(({ y, back: stepBack }) => {
  if (!data?.has_data) return;
  if (!slideFrom) slideFrom = stepBack ? "left" : "right";
  showPage(y);
});

// The app's own links go through navigate(), so they leave the history a back button expects
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#"]');
  if (!a || e.defaultPrevented || e.button || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  navigate(a.getAttribute("href"));
});

// Phones: back from a sport's page to where it was opened from (Home, when it was opened by its address)
$("backBtn").addEventListener("click", back);

// A tap on the tab already shown scrolls its page back to the top
$("tabbar").addEventListener("click", (e) => {
  const a = e.target.closest("a[aria-current]");
  if (a && route().page !== "sport") scrollTo({ top: 0, behavior: "smooth" });
});

export function renderNav() {
  const counts = sportCounts(), sports = sportsByCount(counts).filter(([key]) => hasPage(key, counts));
  $("navActCount").textContent = data.activities.length;
  $("navSportsLabel").hidden = !sports.length;
  $("navSports").innerHTML = sports.map(([key, label]) => `<li><a href="#sport/${key}" data-page="sport/${key}">
    <i class="swatch" style="background:${sportColor(key)}"></i><span class="label">${label}</span><span class="count">${counts[key]}</span></a></li>`).join("");
}

// ---- Settings: syncing and logging out

const settings = $("settings");

all(".js-settings").forEach((b) => b.addEventListener("click", () => settings.showModal()));
$("settingsClose").addEventListener("click", () => settings.close());
// A press beside the sheet closes it (the dialog itself only gets presses on its backdrop)
settings.addEventListener("click", (e) => { if (e.target === settings) settings.close(); });

// The sync buttons, and pulling down at the top of a page; the demo can't sync, so a pull only reloads its numbers
async function syncNow() {
  if (!data || data.demo || data.syncing) return load().catch(() => {});
  renderSync(true);
  await fetch("/api/sync", { method: "POST" }).catch(() => {});
  setTimeout(() => load().catch(() => {}), 1500);
}

all(".js-sync").forEach((b) => b.addEventListener("click", syncNow));

initGestures({ route, navigate, back, sync: syncNow });

// Pick up background syncs: check every 5 minutes, and right away when the tab comes back into view.
const refresh = () => { if (!document.hidden) load().catch(() => {}); };

setInterval(refresh, 5 * 60 * 1000);

document.addEventListener("visibilitychange", refresh);

load().catch((e) => {
  console.error(e);
  $("loading").hidden = true;
  $("notice").className = "notice";
  $("notice").textContent = "Couldn't reach the dashboard server. Check that python backend/app.py is still running.";
  $("notice").hidden = false;
});

// Lets phones install the dashboard as an app (only over https, which `tailscale serve` gives)
if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
