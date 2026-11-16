// Line icons, drawn on a 24 px grid: the tabs, the buttons and one per sport

const PATHS = {
  // Tabs
  home: '<path d="M3.5 10.5 12 3.5l8.5 7V19a1.5 1.5 0 0 1-1.5 1.5h-4.5v-6h-5v6H5A1.5 1.5 0 0 1 3.5 19z"/>',
  train: '<circle cx="12" cy="13.5" r="7.5"/><path d="M12 9.5v4l2.5 2M9.5 2.5h5"/>',
  activities: '<path d="M8.5 6h12M8.5 12h12M8.5 18h12"/><path d="M4 6h.01M4 12h.01M4 18h.01" stroke-width="2.6"/>',
  progress: '<path d="m3 17 6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  health: '<path d="M12 20.5S3.5 15.6 3.5 9.3A4.6 4.6 0 0 1 12 6.8a4.6 4.6 0 0 1 8.5 2.5c0 6.3-8.5 11.2-8.5 11.2z"/>',
  // Buttons
  sync: '<path d="M20.5 12a8.5 8.5 0 0 1-14.8 5.7L3.5 15.5"/><path d="M3.5 12a8.5 8.5 0 0 1 14.8-5.7l2.2 2.2"/><path d="M20.5 3.5v5h-5M3.5 20.5v-5h5"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  chevron: '<path d="m9 5.5 6.5 6.5L9 18.5"/>',
  back: '<path d="M20 12H4.5M11 5l-7 7 7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m20 20-4.2-4.2"/>',
  watch: '<rect x="6.5" y="6.5" width="11" height="11" rx="3.5"/><path d="m9 6.5.8-4h4.4l.8 4M9 17.5l.8 4h4.4l.8-4M12 10v2.2l1.4 1"/>',
  coach: '<path d="M20.5 11.5a8 8 0 0 1-11.7 7.1L3.5 20.5l1.9-5.3a8 8 0 1 1 15.1-3.7z"/>',
  send: '<path d="M20.5 3.5 10 14M20.5 3.5l-6.5 17-4-6.5-6.5-4z"/>',
  flag: '<path d="M5 21V4M5 4h11l-2 4 2 4H5"/>',
  // Sports
  run: '<circle cx="15" cy="4.6" r="1.9"/><path d="M13.6 8.2 11 13.4l3.4 2.6-.6 5M13.6 8.2l3.2 2.6 2.9-.9M13.6 8.2l-4 .4-2 3M11 13.4l-2.3 3.8-4.2.4"/>',
  walk: '<circle cx="12.6" cy="4.4" r="1.9"/><path d="M12 8v5.6l2.4 3.4.8 4M12 13.6l-1.4 3.6L8.4 21M12 8.2l-3 2.2-.6 2.8M12 8.2l3 2.4 1.8 1.8"/>',
  hike: '<path d="m8.5 4 4 8 4.5-4.5L21.5 20h-19z"/>',
  bike: '<circle cx="5.5" cy="16.5" r="3.6"/><circle cx="18.5" cy="16.5" r="3.6"/><circle cx="15" cy="4.6" r="1.4"/><path d="M12 16.5V13l-3-2.8 4-3.2 2 3.2h2.5"/>',
  swim: '<path d="M2.5 7c.9.6 1.6 1 2.9 1C7.9 8 7.9 6 10.4 6s2.5 2 5 2 2.5-2 5-2c.5 0 .8.1 1.1.2M2.5 12.5c.9.6 1.6 1 2.9 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c.5 0 .8.1 1.1.2M2.5 18c.9.6 1.6 1 2.9 1 2.5 0 2.5-2 5-2s2.5 2 5 2 2.5-2 5-2c.5 0 .8.1 1.1.2"/>',
  strength: '<path d="M7 6.5v11M17 6.5v11M3.5 9.5v5M20.5 9.5v5M7 12h10"/>',
  cardio: '<path d="M21.5 12H18l-3 8L9 4l-3 8H2.5"/>',
  yoga: '<circle cx="12" cy="4.8" r="1.9"/><path d="M12 8.2v5.3M5 11.5c2.8 0 4.8.7 7 2 2.2-1.3 4.2-2 7-2M5.5 20c1.4-3 3.9-4.4 6.5-4.4s5.1 1.4 6.5 4.4"/>',
  winter: '<path d="M12 2.5v19M3.8 7.2l16.4 9.6M20.2 7.2 3.8 16.8M9.5 4.5 12 7l2.5-2.5M9.5 19.5 12 17l2.5 2.5"/>',
  disc_golf: '<ellipse cx="12" cy="12" rx="9.5" ry="4.6" transform="rotate(-18 12 12)"/><ellipse cx="12" cy="12" rx="4.6" ry="2" transform="rotate(-18 12 12)"/>',
  other: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
};

// An icon as inline SVG; it takes the text colour and the size its container gives it
export const icon = (name, cls = "") => `<svg class="ico${cls ? ` ${cls}` : ""}" viewBox="0 0 24 24" aria-hidden="true" fill="none" ` +
  `stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${PATHS[name] || PATHS.other}</svg>`;

// A sport's icon on a tile tinted with the sport's colour
export const sportIcon = (sport, cls = "") => `<span class="sport-ico${cls ? ` ${cls}` : ""}" style="--c:var(--sp-${sport}, var(--nohr))">${icon(PATHS[sport] ? sport : "other")}</span>`;

// The page's own markup names its icons: <i data-icon="home"></i>
export function fillIcons(root = document) {
  root.querySelectorAll("[data-icon]").forEach((el) => { el.innerHTML = icon(el.dataset.icon); });
}
