// Makes the dashboard installable as an app on phones. Pages and data always come from the server, so nothing is
// cached: the app shows the same numbers as the browser
self.addEventListener("fetch", (e) => {
  if (e.request.mode === "navigate") e.respondWith(fetch(e.request));
});
