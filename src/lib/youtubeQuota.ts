/**
 * youtubeQuota.ts
 *
 * Shared utility to detect and persist YouTube Data API quota exhaustion.
 * YouTube resets quota daily at midnight Pacific time — we use a 24h TTL.
 *
 * IMPORTANT: Only the *search* quota (Data API) is tracked here.
 * Playing a known video ID via IFrame never consumes search quota.
 */

const YT_QUOTA_KEY = "edu_yt_quota_exhausted";
const YT_QUOTA_TTL = 24 * 60 * 60 * 1000; // 24 h

export function isYouTubeQuotaExhausted(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = localStorage.getItem(YT_QUOTA_KEY);
    if (!raw) return false;
    const { ts } = JSON.parse(raw);
    if (Date.now() - ts > YT_QUOTA_TTL) {
      localStorage.removeItem(YT_QUOTA_KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function markYouTubeQuotaExhausted(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(YT_QUOTA_KEY, JSON.stringify({ ts: Date.now() }));
    // Dispatch event so any open component can react immediately
    window.dispatchEvent(new CustomEvent("yt-quota-exhausted"));
  } catch {}
}

export function clearYouTubeQuota(): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(YT_QUOTA_KEY); } catch {}
}

/** Returns true if the error string looks like a YouTube quota error. */
export function isQuotaError(msg: string): boolean {
  return /quota|429|exceeded|rateLimitExceeded/i.test(msg);
}
