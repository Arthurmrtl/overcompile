// overcompile service worker: lets the installed app (PWA) start without a connection.
// The game page is fetched from the network first, so players always get the latest
// version when online; the cached copy is only a fallback when offline.
const CACHE = "overcompile-v1";
const ASSETS = ["./", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png", "./icons/maskable-512.png", "./icons/apple-touch-icon.png"];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const req = event.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === "navigate") {
    // The game itself: network first, then the cached copy when offline
    event.respondWith(
      fetch(req)
        .then(res => {
          if (res.ok) {
            const copy = res.clone(); // clone now, before the page reads the body
            caches.open(CACHE).then(c => c.put("./", copy));
          }
          return res;
        })
        .catch(() => caches.match("./")),
    );
    return;
  }
  // Icons and manifest: cache first
  event.respondWith(caches.match(req).then(hit => hit || fetch(req)));
});
