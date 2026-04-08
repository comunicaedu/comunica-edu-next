/**
 * spotIntercalate — Settings, fetching, and queue intercalation for spots.
 *
 * Priority-weighted rotation:
 *   Each spot has a priority (1–5). It appears `priority` times per cycle.
 *   Example: Spot A (3), Spot B (1) → cycle [A,A,A,B] → repeats forever.
 *
 * Scheduled spots override:
 *   A spot with scheduledAt="HH:MM" fires at that clock time instead of the
 *   rotation — it replaces whatever slot would have played (even a priority-5 spot).
 *
 * Spots NEVER interrupt music — they always enter after a song ends.
 */

import {
  buildWeightedRotation,
  getScheduledSpotsForTime,
  loadSpotConfigs,
  type SpotConfigMap,
} from "@/lib/spotConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpotSettings {
  enabled: boolean;
  /** Songs between each spot slot. Min 1. */
  interval: number;
}

export interface SpotTrack {
  id: string;
  title: string;
  artist: string | null;
  genre: string;
  file_path: string;
  cover_url: string | null;
  created_at: string;
  youtube_video_id?: string | null;
}

// ── Settings persistence ─────────────────────────────────────────────────────

const SETTINGS_KEY = "edu-spot-settings";
const DEFAULT_SETTINGS: SpotSettings = { enabled: false, interval: 5 };

export function getSpotSettings(): SpotSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const p = JSON.parse(raw) as Partial<SpotSettings>;
    return {
      enabled: p.enabled === true,
      interval: Number.isFinite(p.interval) && p.interval! >= 1 ? p.interval! : 5,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSpotSettings(s: SpotSettings): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  window.dispatchEvent(new Event("spot-settings-changed"));
}

// ── Cache ─────────────────────────────────────────────────────────────────────

let _cache: SpotTrack[] | null = null;
let _cacheTs = 0;
const CACHE_MS = 5 * 60 * 1000;

export async function fetchUserSpots(): Promise<SpotTrack[]> {
  if (_cache && Date.now() - _cacheTs < CACHE_MS) return _cache;
  try {
    const res = await fetch("/api/songs");
    if (!res.ok) return [];
    const data = await res.json();
    const spots = (data.songs ?? []).filter((s: SpotTrack) => s.genre === "spot");
    _cache = spots as SpotTrack[];
    _cacheTs = Date.now();
    return _cache;
  } catch {
    return [];
  }
}

export function invalidateSpotsCache(): void {
  _cache = null;
  _cacheTs = 0;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("spots-updated"));
}

// ── Intercalation ─────────────────────────────────────────────────────────────

const AVG_SONG_DURATION_MS = 3.5 * 60 * 1000; // 3.5 min estimate when no metadata

/**
 * Inserts spots into a song array using priority-weighted rotation.
 *
 * @param songs        Regular songs queue
 * @param spots        All available spot tracks
 * @param interval     Songs between each spot (≥ 1)
 * @param configs      Per-spot config map (priority, enabled, scheduledAt)
 * @param startTime    Estimated playback start time for schedule calculation
 * @param songDurations Map of song id → duration in ms (optional, for schedule accuracy)
 */
export function intercalateSpots<T extends { id: string }>(
  songs: T[],
  spots: T[],
  interval: number,
  configs?: SpotConfigMap,
  startTime?: Date,
  songDurations?: Record<string, number>
): T[] {
  if (!spots.length || interval <= 0 || !songs.length) return songs;

  const cfgMap: SpotConfigMap = configs ?? loadSpotConfigs();

  // Build the weighted rotation (excludes disabled & scheduled-only spots)
  const rotation = buildWeightedRotation(spots, cfgMap);
  if (rotation.length === 0 && !spots.some((s) => cfgMap[s.id]?.scheduledAt)) {
    return songs; // nothing to intercalate
  }

  let rotIdx = 0;
  const out: T[] = [];
  let songCount = 0;
  let elapsedMs = 0;
  const now = startTime ?? new Date();

  for (const song of songs) {
    out.push(song);
    songCount++;

    // Accumulate estimated time to this point
    const dur = songDurations?.[(song as { id: string }).id] ?? AVG_SONG_DURATION_MS;
    elapsedMs += dur;

    if (songCount >= interval) {
      // Determine which spot to insert at this slot
      const slotTime = new Date(now.getTime() + elapsedMs);
      const scheduledSpots = getScheduledSpotsForTime(spots, cfgMap, slotTime, 2);

      let spotToInsert: T | null = null;

      if (scheduledSpots.length > 0) {
        // Scheduled spot wins — pick the first matching one
        spotToInsert = scheduledSpots[0];
      } else if (rotation.length > 0) {
        // Use weighted rotation
        spotToInsert = rotation[rotIdx % rotation.length];
        rotIdx++;
      }

      if (spotToInsert) out.push(spotToInsert);
      songCount = 0;
    }
  }

  return out;
}

/** Returns true if a song object represents a spot. */
export function isSpotItem(song: { genre?: string | null } | null | undefined): boolean {
  return song?.genre === "spot";
}
