// ComunicaEDU Service Worker - v8
const CACHE_NAME = "comunica-edu-v8";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    // Delete ALL caches including any leftover from old Lovable app
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca cacheia: API, Supabase, YouTube, ou métodos não-GET
  if (
    url.pathname.startsWith("/api/") ||
    url.hostname.includes("supabase") ||
    url.hostname.includes("youtube") ||
    event.request.method !== "GET"
  ) {
    return;
  }

  // Navegação HTML → network-first (sempre pega código fresco)
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match(event.request)
      )
    );
    return;
  }

  // Assets JS/CSS → network-first (evita flash de versão antiga)
  // Imagens/fontes → cache-first
  const isJsOrCss = url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
  if (isJsOrCss) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
