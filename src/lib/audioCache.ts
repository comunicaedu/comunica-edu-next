const CACHE_NAME = "comunicaedu-audio-v1";

/**
 * Cache an audio URL in the browser Cache API for offline playback.
 */
export async function cacheAudioUrl(url: string): Promise<void> {
  if (!("caches" in window)) return;
  try {
    const cache = await caches.open(CACHE_NAME);
    const existing = await cache.match(url);
    if (existing) return; // already cached
    await cache.add(url);
  } catch (err) {
    console.warn("[AudioCache] Failed to cache:", url, err);
  }
}

/**
 * Try to get an audio URL from cache. Returns the cached URL (blob) or null.
 */
export async function getCachedAudioUrl(url: string): Promise<string | null> {
  if (!("caches" in window)) return null;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    if (!response) return null;
    const blob = await response.blob();
    return URL.createObjectURL(blob);
  } catch {
    return null;
  }
}

/**
 * Check if a URL is cached.
 */
export async function isAudioCached(url: string): Promise<boolean> {
  if (!("caches" in window)) return false;
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    return !!response;
  } catch {
    return false;
  }
}
