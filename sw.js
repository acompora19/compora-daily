// Compora Daily service worker: caches the app so the wall tablet keeps working if the Wi-Fi hiccups.
// Bump VERSION on every release so phones and the tablet pick up the new files.
const VERSION = "cd-v7";
const SHELL = ["./", "index.html", "daily-core.js", "vendor/ical.min.js", "logo.png", "icon-64.png", "icon-180.png", "icon-512.png", "manifest.json",
  "gear-extreme.webp", "gear-fall.webp", "gear-hot.webp", "gear-rainy.webp", "gear-snowy.webp", "gear-spring.webp", "gear-sunny.webp", "gear-windy.webp",
  "holiday-christmas.webp", "holiday-easter.webp", "holiday-halloween.webp", "holiday-july4.webp", "holiday-newyear.webp", "holiday-stpatrick.webp", "holiday-thanksgiving.webp", "holiday-valentine.webp"];
self.addEventListener("install", (e) => { e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })))).then(() => self.skipWaiting())); });
self.addEventListener("activate", (e) => { e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  // Weather, calendars and Firestore always go to the network; the page keeps its own copies.
  const cacheable = url.origin === location.origin || url.hostname.startsWith("fonts.");
  if (!cacheable) return;
  // Our own page and code: network first so updates show on the next open; fall back to the cache offline.
  const own = url.origin === location.origin && /(\/|\.html|\.js|\.json)$/.test(url.pathname);
  e.respondWith(own
    ? fetch(e.request, { cache: "no-cache" }).then((r) => { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); return r; }).catch(() => caches.match(e.request).then((r) => r || caches.match("index.html")))
    : caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => { if (r.ok || r.type === "opaque") { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); } return r; })));
});
