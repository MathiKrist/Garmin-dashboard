// Route maps: a glowing route on Esri tiles, replayed once from start to finish

import { $, css } from "./util.js";

// Esri's muted grey basemaps (no API key needed), so the route is what stands out; light or dark to match the page
export const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/{service}/MapServer/tile/{z}/{y}/{x}";

export const TILES = ESRI.replace("{service}", "Canvas/World_{style}_Gray_Base");

// Terrain shading laid over the grey map (blended in styles.css); "" or "_Dark" to match the page
export const HILLSHADE = ESRI.replace("{service}", "Elevation/World_Hillshade{shade}");

export const SATELLITE = ESRI.replace("{service}", "World_Imagery");

// Sports with their own route color (a CSS variable), pale core and map; everything else is orange on the grey map
export const ROUTE_STYLES = {
  winter: { color: "--route-winter", core: "#EAFBFF", map: "hillshade" },  // shading shows the slopes
  swim: { color: "--route-swim", core: "#E2FCFF", map: "satellite" },  // the water and shoreline
  disc_golf: { color: "--route-disc", core: "#FFE0F4", map: "satellite" },  // fairways and tree lines
};

export const DEFAULT_ROUTE = { color: "--route", core: "#FFE0B0", map: "grey" };

// A glowing route map in `el`; show(track, name, sport) draws a route (hiding the map when there's no GPS) and replays it once
export function routeMap(el) {
  let map = null, layers = null, route = null, stopReplay = null;
  const fitRoute = () => {
    map.invalidateSize();
    map.fitBounds(route.getBounds(), { padding: [24, 24], animate: false });
  };
  // The sport's map: grey, grey with hillshade, or satellite, in the page's light or dark style
  function setBase(kind, dark) {
    const { grey, hillshade, satellite } = layers;
    const wanted = kind === "satellite" ? [satellite] : kind === "hillshade" ? [grey, hillshade] : [grey];
    [grey, hillshade, satellite].forEach((l) => { if (!wanted.includes(l)) l.remove(); });
    const style = dark ? "Dark" : "Light", shade = dark ? "_Dark" : "";
    if (grey.options.style !== style) { grey.options.style = style; grey.redraw(); }
    if (hillshade.options.shade !== shade) { hillshade.options.shade = shade; hillshade.redraw(); }
    wanted.forEach((l) => { if (!map.hasLayer(l)) l.addTo(map); });
  }
  function show(track, name, sport) {
    el.hidden = !(track?.length > 1 && window.L);  // no GPS, or Leaflet didn't load
    if (el.hidden) return;
    const look = ROUTE_STYLES[sport] || DEFAULT_ROUTE;
    if (!map) {
      map = L.map(el, { scrollWheelZoom: false, attributionControl: false });
      // The panel settles its size after the map is made (fonts load, the map stretches to the status column,
      // the popup opens), so refit the whole route whenever the map's size changes
      new ResizeObserver(() => { if (route && el.offsetHeight) fitRoute(); }).observe(el);
      L.control.attribution({ prefix: false }).addTo(map);
      layers = {
        grey: L.tileLayer(TILES, {
          style: "", maxZoom: 16,  // Esri's grey canvas stops at zoom 16
          attribution: "Esri, HERE, Garmin, &copy; OpenStreetMap contributors",
        }),
        hillshade: L.tileLayer(HILLSHADE, { shade: null, maxZoom: 16, className: "tiles-hillshade", attribution: "Esri, USGS" }),
        satellite: L.tileLayer(SATELLITE, { maxZoom: 18, className: "tiles-satellite", attribution: "Esri, Maxar, Earthstar Geographics" }),
      };
    }
    setBase(look.map, matchMedia("(prefers-color-scheme: dark)").matches);
    stopReplay?.();
    route?.remove();
    const line = css(look.color), paper = css("--paper");
    el.style.setProperty("--route", line);  // the glow filter in styles.css follows the route's color
    const dot = (p, color, extra) => L.circleMarker(p, { radius: 5.5, color: paper, weight: 2.5, fillColor: color, fillOpacity: 1, ...extra });
    const stroke = (weight, opacity, extra) => L.polyline(track, { color: line, weight, opacity, lineJoin: "round", lineCap: "round", interactive: false, ...extra });
    const lines = [
      stroke(14, 0.12),  // glow: two wide faint halos fading out from the line
      stroke(8, 0.25),
      stroke(3.5, 1, { className: "route-glow" }),
      stroke(1.2, 0.9, { color: look.core }),  // hot pale centre, like a lit filament
    ];
    // Distance covered at each GPS point, so the replay's runner moves at an even speed
    const along = [0];
    for (let i = 1; i < track.length; i++) along.push(along[i - 1] + metres(track[i - 1], track[i]));
    const finish = dot(track[track.length - 1], css("--fatigue"));
    route = L.featureGroup([...lines, finish, dot(track[0], css("--easy"))]).addTo(map);
    if (el.offsetHeight) fitRoute();  // a map in a closed popup is fitted by the ResizeObserver when it opens
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const runner = dot(track[0], "#FFFFFF", { radius: 6, color: line, className: "route-glow" });
      stopReplay = replayRoute({ map, track, along, lines, finish, runner });
    }
    el.setAttribute("aria-label", `Map of the route: ${name}`);
  }
  return { show, stop: () => stopReplay?.() };
}

// Metres between two [lat, lon] points (flat-earth approximation, plenty for points a few metres apart)
export function metres([lat1, lon1], [lat2, lon2]) {
  const rad = Math.PI / 180;
  return Math.hypot((lon2 - lon1) * rad * Math.cos((lat1 + lat2) / 2 * rad), (lat2 - lat1) * rad) * 6371e3;
}

// The [lat, lon] reached after `m` metres along the track; `along` holds the distance at each point
export function pointAt(track, along, m, from = 0) {
  let i = from;
  while (i < track.length - 2 && along[i + 1] < m) i++;
  const f = (m - along[i]) / (along[i + 1] - along[i] || 1);
  return [track[i][0] + (track[i + 1][0] - track[i][0]) * f, track[i][1] + (track[i + 1][1] - track[i][1]) * f];
}

// Draws the route from start to finish once, with a glowing dot running at its head; returns a function that stops it and shows the whole route
export const REPLAY_MS = 3500;

export function replayRoute({ map, track, along, lines, finish, runner }) {
  const total = along[along.length - 1], paths = lines.map((l) => l.getElement());
  runner.addTo(map);
  finish.getElement().style.opacity = 0;
  let frame, i = 0, len = 0;
  // Measuring a long path is slow, so it's done once and again only after a zoom or pan redraws it at a new size.
  // The four lines share one shape, so the first one's length does for all of them.
  const remeasure = () => { len = 0; };
  map.on("zoomend viewreset moveend", remeasure);
  const t0 = performance.now();
  const step = (now) => {
    const f = Math.min(1, (now - t0) / REPLAY_MS), d = f * total;
    if (!len) {
      len = paths[0].getTotalLength();
      paths.forEach((p) => { p.style.strokeDasharray = len; });
    }
    paths.forEach((p) => { p.style.strokeDashoffset = len * (1 - f); });
    while (i < track.length - 2 && along[i + 1] < d) i++;
    runner.setLatLng(pointAt(track, along, d, i));
    if (f < 1) frame = requestAnimationFrame(step); else stop();
  };
  const stop = () => {
    cancelAnimationFrame(frame);
    map.off("zoomend viewreset moveend", remeasure);
    runner.remove();
    paths.forEach((p) => { p.style.strokeDasharray = p.style.strokeDashoffset = ""; });
    finish.getElement().style.opacity = "";
  };
  frame = requestAnimationFrame(step);
  return stop;
}
