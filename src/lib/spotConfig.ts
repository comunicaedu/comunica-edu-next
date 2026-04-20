/**
 * spotConfig — Per-spot configuration stored in Supabase (spot_configs table).
 *
 * Priority (1–5):
 *   1 = equal weight
 *   2–5 = appears that many times per cycle relative to priority-1 spots
 *
 * Scheduled spots (scheduleStart/scheduleEnd) override the priority rotation.
 */

export interface SpotConfig {
  priority: number;
  enabled: boolean;
  scheduledAt: string | null; // kept for compatibility
  scheduleStart: string | null;
  scheduleEnd: string | null;
  interval: number | null;
}

export type SpotConfigMap = Record<string, SpotConfig>;

export const DEFAULT_SPOT_CONFIG: SpotConfig = {
  priority: 1,
  enabled: true,
  scheduledAt: null,
  scheduleStart: null,
  scheduleEnd: null,
  interval: null,
};

// ── In-memory cache ────────────────────────────────────────────────────────────

let _configCache: SpotConfigMap | null = null;

export function getCachedSpotConfigs(): SpotConfigMap {
  return _configCache ?? {};
}

export function setCachedSpotConfigs(map: SpotConfigMap) {
  _configCache = map;
}

// ── Load from DB (via API) ─────────────────────────────────────────────────────

export async function fetchSpotConfigs(token: string): Promise<SpotConfigMap> {
  try {
    const res = await fetch("/api/spots/configs", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return {};
    const { configs } = await res.json();
    _configCache = configs ?? {};
    return _configCache!;
  } catch {
    return {};
  }
}

// ── Save to DB (via API) ───────────────────────────────────────────────────────

export async function saveSpotConfig(
  spotId: string,
  patch: Partial<SpotConfig>,
  token: string
): Promise<void> {
  // Atualiza cache local imediatamente
  const current = _configCache?.[spotId] ?? { ...DEFAULT_SPOT_CONFIG };
  const updated = { ...current, ...patch };
  if (_configCache) _configCache[spotId] = updated;

  await fetch("/api/spots/configs", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      spot_id: spotId,
      priority: updated.priority,
      enabled: updated.enabled,
      scheduleStart: updated.scheduleStart,
      scheduleEnd: updated.scheduleEnd,
      interval: updated.interval,
    }),
  });

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("spot-configs-changed"));
  }
}

// ── Compatibilidade — funções síncronas usam cache in-memory ──────────────────

export function loadSpotConfigs(): SpotConfigMap {
  return _configCache ?? {};
}

export function getSpotConfig(id: string): SpotConfig {
  return _configCache?.[id] ?? { ...DEFAULT_SPOT_CONFIG };
}

/** @deprecated Use saveSpotConfig(id, patch, token) */
export function updateSpotConfig(id: string, patch: Partial<SpotConfig>): void {
  if (!_configCache) _configCache = {};
  _configCache[id] = { ...(_configCache[id] ?? DEFAULT_SPOT_CONFIG), ...patch };
  if (typeof window !== "undefined") window.dispatchEvent(new Event("spot-configs-changed"));
}

export function removeSpotConfig(id: string): void {
  if (_configCache) delete _configCache[id];
  if (typeof window !== "undefined") window.dispatchEvent(new Event("spot-configs-changed"));
}

// ── Weighted rotation builder ─────────────────────────────────────────────────

/**
 * Constrói rotação ponderada com distribuição espalhada (mesmo algoritmo do
 * generateSpotsPlaylist.js antigo). Priority N = N aparições por ciclo,
 * distribuídas uniformemente pela lista.
 */
export function buildWeightedRotation<T extends { id: string }>(
  spots: T[],
  configs: SpotConfigMap
): T[] {
  type Entry = { spot: T; tempFreq: number; frequencia: number };
  const tempList: Entry[] = spots
    .filter((s) => {
      const cfg = configs[s.id] ?? DEFAULT_SPOT_CONFIG;
      return cfg.enabled && !cfg.scheduledAt;
    })
    .map((s) => {
      const freq = Math.max(1, Math.min(5, configs[s.id]?.priority ?? 1));
      return { spot: s, tempFreq: freq, frequencia: freq };
    });

  if (!tempList.length) return [];

  const rotation: T[] = [];
  let hasRemaining = true;
  while (hasRemaining) {
    hasRemaining = false;
    for (const entry of tempList) {
      if (entry.tempFreq > 0) {
        hasRemaining = true;
        rotation.push(entry.spot);
        entry.tempFreq--;
      }
    }
  }
  return rotation;
}

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
    const diffMin = Math.abs(hh * 60 + mm - (sh * 60 + sm));
    return diffMin <= windowMinutes;
  });
}
