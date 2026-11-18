// The browser's history, run like an app's, so a phone's back button (or back gesture) steps out the way it does in one:
// back closes an open sheet or activity (or goes from an activity back to the week it was opened from), takes a sport's
// page back to where it was opened, and takes any other tab back to Home; back on Home leaves the app.
// Switching tabs doesn't pile up entries: the tabs take turns in one entry above Home's.
//
// Every entry the app makes carries `d`, how many of the app's entries lie below it (Home's is 0), and `y`, how far
// the page was scrolled when it was left. While a sheet is open its entry also has `sheet` (the dialog's id) and `s`,
// how many entries the sheet has made (an activity opened from a week's list makes a second one).

let onChange = () => {};
let shownHash = location.hash;
let shownDepth = 0;
let pending = null;  // the tab to put in the entry above Home, once history.go() has landed there

const state = () => history.state || {};

const depth = () => state().d ?? 0;

// fn({ y, back }): the address changed; y is where to scroll the page to, back whether it was a step back
export function onRoute(fn) { onChange = fn; }

function changed(y = 0, back = false) {
  shownHash = location.hash;
  shownDepth = depth();
  onChange({ y, back });
}

// Where the page was scrolled, for coming back to it
function keepScroll() { history.replaceState({ ...state(), y: scrollY }, ""); }

export function goTab(name) {
  const d = depth(), hash = `#${name}`;
  keepScroll();
  if (name === "home") {
    if (d > 0) return history.go(-d);
    history.replaceState({ d: 0 }, "", hash);
  } else if (d === 0) history.pushState({ d: 1 }, "", hash);
  else if (d === 1) history.replaceState({ d: 1 }, "", hash);
  else { pending = hash; return history.go(-(d - 1)); }  // from a sport's page: step back to the tab's entry first
  changed();
}

// A page under a tab (a sport's), which back returns from
export function openSub(hash) {
  keepScroll();
  history.pushState({ d: depth() + 1 }, "", hash);
  changed();
}

export function goBack() {
  if (depth() > 0) history.back(); else goTab("home");
}

// One more step inside the open sheet (an activity opened from a week's list), which back undoes
export function sheetStep() {
  const st = state();
  history.pushState({ ...st, d: depth() + 1, s: (st.s || 1) + 1, sub: true }, "");
}

// history.go() lands a moment later (half a second, stepping back two); a sheet opened meanwhile waits for it
let stepping = false, afterStep = [];

function stepBack(n) {
  stepping = true;
  history.go(-n);
  setTimeout(() => { if (stepping) { stepping = false; afterStep.splice(0).forEach((fn) => fn()); } }, 1500);
}

function onPop() {
  stepping = false;
  popped();
  afterStep.splice(0).forEach((fn) => fn());
}

function popped() {
  if (pending) {
    const hash = pending, same = location.hash === hash, y = same ? state().y || 0 : 0;
    pending = null;
    history.replaceState({ d: 1, y }, "", hash);
    return changed(y, true);
  }
  // An entry the app didn't make: the address was edited by hand
  if (history.state?.d == null) history.replaceState({ d: shownDepth + 1 }, "");
  const st = state();
  // Back past an open sheet closes it
  document.querySelectorAll("dialog[open]").forEach((dlg) => { if (st.sheet !== dlg.id) dlg.close(); });
  // Forward into a sheet that has since closed: step back out of it
  if (st.sheet && !document.getElementById(st.sheet)?.open) return history.go(-(st.s || 1));
  if (location.hash !== shownHash) changed(st.y || 0, depth() < shownDepth);
  shownDepth = depth();
}

addEventListener("popstate", onPop);

// Older browsers fire only this for an edited address; the check in onPop() keeps it from drawing twice
addEventListener("hashchange", () => { if (location.hash !== shownHash) onPop(); });

// Sheets: an entry of their own while open, so back closes them
document.querySelectorAll("dialog").forEach((dlg) => {
  const push = () => {
    if (dlg.open && state().sheet !== dlg.id) history.pushState({ d: depth() + 1, sheet: dlg.id, s: 1 }, "");
  };
  new MutationObserver(() => { if (stepping) afterStep.push(push); else push(); })
    .observe(dlg, { attributes: true, attributeFilter: ["open"] });
  // Closed by its own button, a save or a press beside it: take its entries away again
  dlg.addEventListener("close", () => { if (state().sheet === dlg.id) stepBack(state().s || 1); });
  // Esc, and Android's back where the browser hands it to the dialog: one step back, which may be to a week's list
  dlg.addEventListener("cancel", (e) => {
    if (state().sheet === dlg.id) { e.preventDefault(); history.back(); }
  });
});

// The first visit: Home at the bottom, so back from a page opened by its address goes to Home before leaving the app.
// A reload keeps the entries; one made by a sheet steps back out of it, as the sheet is gone.
history.scrollRestoration = "manual";
if (history.state?.d == null) {
  const hash = location.hash;
  if (/^#?(home|overview)?$/.test(hash)) history.replaceState({ d: 0 }, "");
  else {
    history.replaceState({ d: 0 }, "", "#home");
    history.pushState({ d: 1 }, "", hash);
  }
} else if (history.state.sheet) history.go(-(history.state.s || 1));
shownHash = location.hash;
shownDepth = depth();
