// Light or dark, set on <html data-theme> before the page draws (a plain script in <head>, so it doesn't flash).
// Auto is dark from 20:00 to 07:00 and the system's choice otherwise; the menu's switch can fix it to light or dark,
// remembered per device. Fires a "themechange" event on window when it changes, so charts and maps redraw.
(() => {
  const NIGHT_FROM = 20, NIGHT_TO = 7;
  const system = matchMedia("(prefers-color-scheme: dark)");

  const choice = () => {
    try { return localStorage.getItem("theme") || "auto"; } catch { return "auto"; }
  };

  function apply() {
    const c = choice(), hour = new Date().getHours();
    const theme = c !== "auto" ? c : hour >= NIGHT_FROM || hour < NIGHT_TO || system.matches ? "dark" : "light";
    if (document.documentElement.dataset.theme === theme) return;
    document.documentElement.dataset.theme = theme;
    dispatchEvent(new Event("themechange"));
  }

  window.theme = {
    choice,
    set(c) {
      try { localStorage.setItem("theme", c); } catch {}
      apply();
    },
  };

  apply();
  system.addEventListener("change", apply);
  setInterval(apply, 60 * 1000);  // night starts and ends while the page is open
  document.addEventListener("visibilitychange", apply);
})();
