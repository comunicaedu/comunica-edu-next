// ComunicaEDU Service Worker - v9
const CACHE_NAME = "comunica-edu-v9";
const AUDIO_CACHE = "comunicaedu-audio-v1"; // nunca apagado — áudio offline

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          // Apaga versões antigas do SW, mas PRESERVA o cache de áudio
          .filter((k) => k !== AUDIO_CACHE && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // Nunca intercepta: métodos não-GET, YouTube streaming (não cacheável por DRM)
  if (event.request.method !== "GET") return;
  if (url.hostname.includes("youtube.com") || url.hostname.includes("youtu.be")) return;
  if (url.hostname.includes("googlevideo.com")) return; // streams do YouTube

  // ── Áudio local e Supabase Storage → cache-first (offline support) ──
  const isAudio =
    url.pathname.startsWith("/uploads/songs") ||
    url.pathname.startsWith("/uploads/spots") ||
    (url.hostname.includes("supabase") && url.pathname.includes("/storage/"));

  if (isAudio) {
    event.respondWith(
      caches.open(AUDIO_CACHE).then(async (cache) => {
        const cached = await cache.match(event.request);
        if (cached) return cached;

        try {
          // Para range requests (seek de áudio), busca o arquivo completo e cacheia
          const fullReq = new Request(url.toString(), { headers: { "Range": "" } });
          const response = await fetch(event.request);
          if (response.ok || response.status === 206) {
            // Cacheia com a key sem range header para reuso
            cache.put(new Request(url.toString()), response.clone());
          }
          return response;
        } catch {
          return new Response("Offline - áudio não disponível", { status: 503 });
        }
      })
    );
    return;
  }

  // ── API routes → sempre network (nunca cacheia dados dinâmicos) ──
  if (url.pathname.startsWith("/api/")) return;

  // ── Navegação HTML → network-first ──
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request))
    );
    return;
  }

  // ── JS/CSS → network-first (código sempre fresco) ──
  const isJsOrCss = url.pathname.endsWith(".js") || url.pathname.endsWith(".css");
  if (isJsOrCss) {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  // ── Demais assets (imagens, fontes) → cache-first ──
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request)
          .then((response) => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    )
  );
});
