// Finger gestures on phones: swipe sideways to the next or previous tab (and right to go back from a sport's page),
// or in an activity to the next or previous one in the list it was opened from (right closes a week's list), pull down
// at the top of a page to sync with Garmin, and drag a sheet or an activity down to close it.
// Each follows the finger, and acts only once past a point or on a quick flick; otherwise it springs back.

import { $ } from "./util.js";
import { showingActivity, neighbour, stepActivity } from "./modal.js";

export const TABS = ["home", "train", "activities", "progress", "health"];

const phone = matchMedia("(max-width: 899px)");

const EDGE = 24;  // Android's back gesture starts at the screen's edges: leave those to it

const SLOP = 10;  // how far a finger moves before it's a drag rather than a tap

const PULL = 64;  // how far the sync button comes down before letting go syncs

const SPRING = "cubic-bezier(0.2, 0.9, 0.3, 1)";

// Things a finger works itself: fields, charts (dragging along one reads its values) and maps that can be dragged
const OWN = "input, textarea, select, canvas, .leaflet-container:not(.still)";

// Whether `el` sits in something that scrolls sideways (a table, the sport chips, the plan's days)
function inSideScroller(el, stop) {
  for (; el && el !== stop && el !== document.body; el = el.parentElement) {
    if (el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX)) return true;
  }
  return false;
}

// ... or in a box scrolled down from its top (the coach's chat, a sheet), where pulling down scrolls it back up
function inScrolledBox(el, stop) {
  for (; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
    if (el === stop) break;
  }
  return false;
}

// Speed in px/ms over the last 100 ms of the drag, for telling a flick from a slow drag
function speed(g, axis) {
  const s = g.samples, last = s[s.length - 1], first = s.find((p) => last.t - p.t <= 100) || last;
  return last.t > first.t ? (last[axis] - first[axis]) / (last.t - first.t) : 0;
}

// Put an element back where it belongs, sliding there unless `instant`
function settle(el, instant = false) {
  if (instant) return el.removeAttribute("style");
  el.style.transition = `transform 0.28s ${SPRING}, opacity 0.28s`;
  el.style.transform = el.style.opacity = "";
  el.addEventListener("transitionend", () => el.removeAttribute("style"), { once: true });
  setTimeout(() => el.removeAttribute("style"), 320);  // in case the transition never ran (reduced motion)
}

// Slide an element out (transform), then do something
function slideOut(el, transform, then, ms = 170) {
  el.style.transition = `transform ${ms}ms cubic-bezier(0.4, 0, 1, 1), opacity ${ms}ms`;
  el.style.transform = transform;
  setTimeout(then, ms);
}

// route() is the page shown ({ page, id }), navigate(hash) goes to a tab, back() steps back, sync() syncs with Garmin
export function initGestures({ route, navigate, back, sync }) {
  const main = $("main"), ptr = $("ptr");
  let g = null;  // the gesture under way

  // What a drag that has just set off is for, or "" when it's the browser's (scrolling) or a part of the page's own
  function decide() {
    const ax = Math.abs(g.dx), ay = Math.abs(g.dy);
    const sideways = ax > ay * 1.3, down = g.dy > 0 && ay > ax;
    const edge = g.x < EDGE || g.x > innerWidth - EDGE;
    const dlg = g.dialog;
    if (dlg) {
      // A form keeps its fields safe from a stray drag: only its top edge drags it down
      const grip = !dlg.classList.contains("form-sheet") || g.y < dlg.getBoundingClientRect().top + 64;
      if (down && grip && !inScrolledBox(g.target, dlg)) return "dismiss";
      if (!sideways || edge || dlg.id !== "actModal" || inSideScroller(g.target, dlg)) return "";
      return showingActivity() ? "browse" : g.dx > 0 ? "back" : "";
    }
    if (sideways && !edge && !main.hidden && !inSideScroller(g.target)) return "tabs";
    if (down && scrollY <= 0 && !inScrolledBox(g.target)) return "pull";
    return "";
  }

  function begin() {
    if (g.kind === "tabs") {
      const r = route(), i = TABS.indexOf(r.page);
      // A sport's page is under Progress: right goes back, left has nowhere to go
      g.prev = r.page === "sport" ? "back" : TABS[i - 1];
      g.next = r.page === "sport" ? null : TABS[i + 1];
      g.el = main;
    } else if (g.kind === "browse") {
      g.prev = neighbour(-1);
      g.next = neighbour(1);
      g.el = g.dialog.querySelector(".modal-box");
    } else if (g.kind === "pull") g.el = ptr;
    else g.el = g.dialog;
    g.el.style.transition = "none";
  }

  function move() {
    const { kind, el, dx, dy } = g;
    if (kind === "tabs" || kind === "browse") {
      const to = dx > 0 ? g.prev : g.next, x = to != null ? dx : dx * 0.2;  // a little give where there's nothing more
      el.style.transform = `translateX(${x}px)`;
      el.style.opacity = 1 - Math.min(Math.abs(x) / innerWidth, 1) * 0.5;
    } else if (kind === "pull") {
      const p = Math.min(Math.max(dy, 0) * 0.5, PULL * 1.6), ready = p >= PULL;
      el.style.transform = `translateY(${p}px) rotate(${p * 4}deg)`;
      el.style.opacity = Math.min(p / PULL, 1);
      if (ready && !g.ready && navigator.vibrate) navigator.vibrate(8);
      el.classList.toggle("ready", ready);
      g.ready = ready;
    } else if (kind === "dismiss") el.style.transform = `translateY(${Math.max(dy, 0)}px)`;
    else el.style.transform = `translateX(${Math.max(dx, 0)}px)`;
  }

  function end() {
    const { kind, el, dx, dy } = g;
    if (kind === "tabs") {
      const to = dx > 0 ? g.prev : g.next, vx = speed(g, "x");
      if (to && (Math.abs(dx) > innerWidth * 0.3 || (Math.abs(dx) > 40 && vx * dx > 0 && Math.abs(vx) > 0.35))) {
        el.style.opacity = "0";
        slideOut(el, `translateX(${Math.sign(dx) * innerWidth * 0.4}px)`, () => {
          const before = location.href;
          if (to === "back") back(); else navigate(`#${to}`);
          // The new page slides in by itself; a step back draws it once the browser has gone back
          const done = () => { removeEventListener("popstate", done); settle(el, true); };
          if (location.href !== before) done();
          else {
            addEventListener("popstate", done);
            setTimeout(done, 400);
          }
        });
      } else settle(el);
    } else if (kind === "browse") {
      // The activity slides out, and the next one in from the other side
      const dir = dx > 0 ? -1 : 1, to = dx > 0 ? g.prev : g.next, vx = speed(g, "x");
      if (to != null && (Math.abs(dx) > innerWidth * 0.3 || (Math.abs(dx) > 40 && vx * dx > 0 && Math.abs(vx) > 0.35))) {
        el.style.opacity = "0";
        slideOut(el, `translateX(${Math.sign(dx) * innerWidth * 0.4}px)`, () => {
          stepActivity(dir);
          el.style.transition = "none";
          el.style.transform = `translateX(${-Math.sign(dx) * 30}%)`;
          void el.offsetWidth;
          settle(el);
        }, 150);
      } else settle(el);
    } else if (kind === "pull") {
      if (g.ready) {
        el.classList.add("go");
        el.style.transition = `transform 0.2s ${SPRING}`;
        el.style.transform = `translateY(${PULL * 0.8}px)`;
        sync();
        setTimeout(() => { el.classList.remove("go", "ready"); settle(el); }, 900);
      } else {
        el.classList.remove("ready");
        settle(el);
      }
    } else if (kind === "dismiss") {
      if (dy > 110 || (dy > 30 && speed(g, "y") > 0.5)) {
        slideOut(el, "translateY(100%)", () => { el.close(); el.removeAttribute("style"); }, 200);
      } else settle(el);
    } else if (dx > innerWidth * 0.3 || (dx > 40 && speed(g, "x") > 0.35)) {  // a week's list: closes
      slideOut(el, "translateX(100%)", () => { el.close(); el.removeAttribute("style"); }, 200);
    } else settle(el);
  }

  addEventListener("touchstart", (e) => {
    g = null;
    if (!phone.matches || e.touches.length !== 1 || e.target.closest(OWN)) return;
    const t = e.touches[0], dialog = document.querySelector("dialog[open]");
    g = { x: t.clientX, y: t.clientY, dx: 0, dy: 0, kind: "", target: e.target, dialog,
      samples: [{ x: t.clientX, y: t.clientY, t: e.timeStamp }] };
  }, { passive: true });

  addEventListener("touchmove", (e) => {
    if (!g) return;
    if (e.touches.length !== 1) {  // a second finger: pinch-zooming, not a swipe
      if (g.kind) settle(g.el);
      g = null;
      return;
    }
    const t = e.touches[0];
    g.dx = t.clientX - g.x;
    g.dy = t.clientY - g.y;
    g.samples.push({ x: t.clientX, y: t.clientY, t: e.timeStamp });
    if (g.samples.length > 12) g.samples.shift();
    if (!g.kind) {
      if (Math.abs(g.dx) < SLOP && Math.abs(g.dy) < SLOP) return;
      g.kind = decide();
      if (!g.kind) { g = null; return; }
      begin();
    }
    if (e.cancelable) e.preventDefault();  // the page mustn't scroll under the finger meanwhile
    move();
  }, { passive: false });

  const finish = () => {
    if (g?.kind) end();
    g = null;
  };
  addEventListener("touchend", finish);
  addEventListener("touchcancel", () => {
    if (g?.kind) {
      if (g.kind === "pull") g.el.classList.remove("ready");
      settle(g.el);
    }
    g = null;
  });
}
