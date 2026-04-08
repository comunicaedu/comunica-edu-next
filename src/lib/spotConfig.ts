/**
 * spotConfig — Per-spot configuration stored in localStorage.
 *
 * Priority (1–5):
 *   1 = equal weight (no preference)
 *   2–5 = appears that many times per cycle relative to priority-1 spots
 *
 * Example: Spot A priority 3, Spot B priority 1
 *   Cycle: [A, A, A, B] → 4 slots total, repeats
 *
 * Scheduled spots (HH:MM) override the priority rotation at the configured time.
 * A scheduled spot ALWAYS wins over any favorited spot at that slot.
 */

export interface SpotConfig {
  priority: number;           // 1–5, default 1
  enabled: boolean;           // default true
  scheduledAt: string | null; // kept for compatibility
  scheduleStart: string | null; // "YYYY-MM-DDTHH:MM" — quando começa a tocar
  scheduleEnd: string | null;   // "YYYY-MM-DDTHH:MM" — quando para de tocar
  interval: number | null;    // 1–5 songs between plays; null = use global
}

const STORAGE_KEY = "edu-spot-configs-v2";

export type SpotConfigMap = Record<string, SpotConfig>;

export const DEFAULT_SPOT_CONFIG: SpotConfig = {
  priority: 1,
  enabled: true,
  scheduledAt: null,
  scheduleStart: null,
  scheduleEnd: null,
  interval: null,
};

// ── Load / Save ───────────────────────────────────────────────────────────────

export function loadSpotConfigs(): SpotConfigMap {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as SpotConfigMap;
  } catch {
    return {};
  }
}

export function saveSpotConfigs(map: SpotConfigMap): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  window.dispatchEvent(new Event("spot-configs-changed"));
}

export function getSpotConfig(id: string): SpotConfig {
  const map = loadSpotConfigs();
  return map[id] ?? { ...DEFAULT_SPOT_CONFIG };
}

export function updateSpotConfig(id: string, patch: Partial<SpotConfig>): void {
  const map = loadSpotConfigs();
  map[id] = { ...(map[id] ?? DEFAULT_SPOT_CONFIG), ...patch };
  saveSpotConfigs(map);
}

/** Remove config for deleted spots */
export function removeSpotConfig(id: string): void {
  const map = loadSpotConfigs();
  delete map[id];
  saveSpotConfigs(map);
}

// ── Weighted rotation builder ─────────────────────────────────────────────────

/**
 * Builds the flat weighted rotation array.
 *
 * Each spot appears `priority` times in the cycle.
 * Disabled spots are excluded.
 * Spots without a scheduledAt participate in the rotation;
 * spots WITH a scheduledAt only fire at their scheduled time (not in rotation).
 */
export function buildWeightedRotation<T extends { id: string }>(
  spots: T[],
  configs: SpotConfigMap
): T[] {
  const rotation: T[] = [];

  for (const spot of spots) {
    const cfg = configs[spot.id] ?? DEFAULT_SPOT_CONFIG;
    if (!cfg.enabled) continue;
    if (cfg.scheduledAt) continue; // scheduled-only spots are NOT in the rotation

    const priority = Math.max(1, Math.min(5, cfg.priority));
    for (let i = 0; i < priority; i++) {
      rotation.push(spot);
    }
  }

  return rotation;
}

/**
 * Returns scheduled spots that should fire within `windowMinutes` minutes
 * of the given target time (default ±1 min).
 */
export function getScheduledSpotsForTime<T extends { id: string }>(
  spots: T[],
  configs: SpotConfigMap,
  targetTime: Date,
  windowMinutes = 1
): T[] {
  const hh = targetTime.getHours();
  const mm = targetTime.getMinutes();

  return spots.filter((spot) => {
    const cfg = configs[spot.id] ?? DEFAULT_SPOT_CONFIG;
    if (!cfg.enabled || !cfg.scheduledAt) return false;

    const [sh, sm] = cfg.scheduledAt.split(":").map(Number);
    const diffMin = Math.abs((hh * 60 + mm) - (sh * 60 + sm));
    return diffMin <= windowMinutes;
  });
}
