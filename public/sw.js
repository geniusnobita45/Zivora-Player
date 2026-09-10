const CACHE = "zivora-shell-v1";
const SHELL = ["/", "/manifest.webmanifest"];
const MEDIA_EXTENSION = /\.(?:m3u8|mpd|m4s|mp4|webm|aac|m4a|vtt)(?:$|\?)/i;

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  const media =
    url.origin !== self.location.origin ||
    MEDIA_EXTENSION.test(url.pathname) ||
    ["video", "audio", "track"].includes(request.destination) ||
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/watch/");
  if (media) return;

  const shellNavigation = request.mode === "navigate" && SHELL.includes(url.pathname);
  const staticAsset =
    url.pathname.startsWith("/_next/static/") &&
    ["script", "style", "font", "image"].includes(request.destination);
  if (!shellNavigation && !staticAsset) return;

  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ??
        fetch(request).then((response) => {
          if (response.ok && response.type === "basic") {
            const copy = response.clone();
            void caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        }),
    ),
  );
});
