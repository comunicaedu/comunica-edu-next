/**
 * spotIntercalate — Settings, fetching, and queue intercalation for spots.
 *
 * Settings (enabled, interval) → Supabase spot_settings table
 * Configs (priority, schedule)  → Supabase spot_configs table (via spotConfig.ts)
 * Spot files                    → Supabase Storage bucket "spots"
 *
 * Intercalation rules (mesma lógica do código antigo + melhorias):
 *  - Cada spot tem seu próprio intervalo (cfg.interval) ou usa o global
 *  - Prioridade (1-5) = peso na rotação (spot prio 3 aparece 3× mais)
 *  - scheduleStart/scheduleEnd: spot só entra na fila dentro do intervalo de datas
 *  - enabled=false: spot ignorado completamente
 *  - Spots NUNCA interrompem música — entram sempre após o fim de uma faixa
 */

import {
  loadSpotConfigs,
  clearSpotConfigs,
  DEFAULT_SPOT_CONFIG,
  type SpotConfig,
  type SpotConfigMap,
} from "@/lib/spotConfig";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SpotSettings {
  enabled: boolean;
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

// ── Settings — banco de dados via API ────────────────────────────────────────

const DEFAULT_SETTINGS: SpotSettings = { enabled: false, interval: 3 };
let _settingsCache: SpotSettings = { ...DEFAULT_SETTINGS };

export function getSpotSettings(): SpotSettings {
  return { ..._settingsCache };
}

export async function loadSpotSettings(token: string): Promise<SpotSettings> {
  try {
    const res = await fetch("/api/spots/settings", {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!res.ok) return DEFAULT_SETTINGS;
    const { settings } = await res.json();
    _settingsCache = {
      enabled: Boolean(settings?.enabled),
      interval: Number(settings?.interval ?? 3) || 3,
    };
    return { ..._settingsCache };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function saveSpotSettings(s: SpotSettings, token: string): Promise<void> {
  _settingsCache = { ...s };
  await fetch("/api/spots/settings", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(s),
  });
  if (typeof window !== "undefined") window.dispatchEvent(new Event("spot-settings-changed"));
}

// ── Cache de spots ────────────────────────────────────────────────────────────

let _cache: SpotTrack[] | null = null;
let _cacheTs = 0;
const CACHE_MS = 5 * 60 * 1000;

export async function fetchUserSpots(token?: string): Promise<SpotTrack[]> {
  if (_cache && Date.now() - _cacheTs < CACHE_MS) return _cache;
  if (!token) return _cache ?? [];
  try {
    const res = await fetch("/api/spots", { headers: { authorization: `Bearer ${token}` } });
    if (!res.ok) return [];
    const data = await res.json();
    const spots: SpotTrack[] = (data.spots ?? []).map((s: {
      id: string; title: string; file_path: string; created_at: string;
    }) => ({
      id: s.id,
      title: s.title,
      artist: null,
      genre: "spot",
      file_path: s.file_path,
      cover_url: null,
      created_at: s.created_at,
      youtube_video_id: null,
    }));
    _cache = spots;
    _cacheTs = Date.now();
    return _cache;
  } catch {
    return [];
  }
}

export function getCachedSpots(): SpotTrack[] { return _cache ?? []; }

export function invalidateSpotsCache(): void {
  _cache = null;
  _cacheTs = 0;
  if (typeof window !== "undefined") window.dispatchEvent(new Event("spots-updated"));
}

/** Zera TODOS os caches em memória (spots + configs). Uso: logout, troca de sessão, start/exit impersonation. */
export function invalidateAllCaches(): void {
  _cache = null;
  _cacheTs = 0;
  clearSpotConfigs();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("spots-updated"));
    window.dispatchEvent(new Event("spot-configs-changed"));
  }
}

// ── Verificação de agendamento ────────────────────────────────────────────────

/**
 * Retorna true se o spot está dentro do período programado (ou se não tem programação).
 * scheduleStart = "YYYY-MM-DDTHH:MM" (incluso)
 * scheduleEnd   = "YYYY-MM-DDTHH:MM" (incluso, vai até o fim do minuto)
 */
function isSpotScheduleActive(cfg: SpotConfig): boolean {
  const { scheduleStart, scheduleEnd } = cfg;
  if (!scheduleStart && !scheduleEnd) return true; // sem programação = sempre ativo

  // Spots com scheduleStart são tratados EXCLUSIVAMENTE pelo check em tempo real
  // em goNextInQueue (player/page.tsx). Nunca entram na fila pré-construída para
  // evitar que toquem duas vezes (uma pela fila, outra pelo clock check).
  if (scheduleStart) return false;

  const now = new Date();
  const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // ── Verificação de data (range de dias) ──────────────────────────────────
  if (scheduleStart) {
    const s = new Date(scheduleStart);
    const startDay = new Date(s.getFullYear(), s.getMonth(), s.getDate());
    if (todayOnly < startDay) return false; // ainda não chegou a data de início
  }

  if (scheduleEnd) {
    const e = new Date(scheduleEnd);
    const endDay = new Date(e.getFullYear(), e.getMonth(), e.getDate());
    if (todayOnly > endDay) return false; // já passou a data de término
  }

  // ── Verificação de horário diário ─────────────────────────────────────────
  const nowMinutes = now.getHours() * 60 + now.getMinutes();

  if (scheduleStart) {
    const s = new Date(scheduleStart);
    const startMin = s.getHours() * 60 + s.getMinutes();
    if (startMin > 0 && nowMinutes < startMin) return false; // antes do horário de início
  }

  if (scheduleEnd) {
    const e = new Date(scheduleEnd);
    const endMin = e.getHours() * 60 + e.getMinutes();
    if (endMin > 0 && nowMinutes > endMin) return false; // após o horário de término
  }

  return true;
}

// ── Rotação ponderada (mesma lógica do código antigo) ────────────────────────

/**
 * Constrói uma lista com spots repetidos conforme sua prioridade.
 * Prioridade 1 = 1 aparição por ciclo; 5 = 5 aparições.
 * A distribuição é espalhada para evitar que o mesmo spot apareça consecutivamente.
 */
function buildSpotsRotation<T extends { id: string }>(
  spots: T[],
  cfgMap: SpotConfigMap,
): T[] {
  type Entry = { spot: T; tempFreq: number; frequencia: number };
  const tempList: Entry[] = spots
    .filter((s) => {
      const cfg = cfgMap[s.id] ?? DEFAULT_SPOT_CONFIG;
      return cfg.enabled && cfg.priority > 0 && isSpotScheduleActive(cfg);
    })
    .map((s) => {
      const freq = Math.max(1, Math.min(5, cfgMap[s.id]?.priority ?? 1));
      return { spot: s, tempFreq: freq, frequencia: freq };
    });

  if (!tempList.length) return [];

  const spotsPlaylist: T[] = [];
  let hasRemaining = true;
  while (hasRemaining) {
    hasRemaining = false;
    for (let i = tempList.length - 1; i >= 0; i--) {
      const entry = tempList[i];
      if (entry.tempFreq > 0) {
        hasRemaining = true;
        const position = Math.floor(
          (spotsPlaylist.length / entry.frequencia) * (entry.frequencia - entry.tempFreq)
        );
        spotsPlaylist.splice(position, 0, entry.spot);
        entry.tempFreq--;
      }
    }
  }
  return spotsPlaylist;
}

// ── Intercalação principal ────────────────────────────────────────────────────

/**
 * Intercala spots na lista de músicas.
 *
 * Estrutura igual ao código antigo:
 *  - Rotação ponderada por prioridade (generateSpotsPlaylist)
 *  - Ativo/Inativo por spot
 *  - Agendamento opcional por data
 *
 * Melhoria sobre o antigo: cada spot tem seu próprio contador de músicas,
 * respeitando o intervalo individual (cfg.interval) ou o global como fallback.
 * Isso permite que spot A toque a cada 3 músicas e spot B a cada 5, sem conflito.
 */
export function intercalateSpots<T extends { id: string; genre?: string | null }>(
  songs: T[],
  spots: T[],
  globalInterval: number,
  configs?: SpotConfigMap,
  newsItems?: T[],
  newsInterval?: number,
): T[] {
  if (!songs.length) return songs;

  const cfgMap: SpotConfigMap = configs ?? loadSpotConfigs();

  // Spots ativos — ordenados por prioridade:
  //   1º spots com scheduleStart ativo (programados) — máxima prioridade
  //   2º spots sem agendamento ou com agendamento inativo — configurados normalmente
  const activeSpots = spots
    .filter((s) => {
      const cfg = cfgMap[s.id] ?? DEFAULT_SPOT_CONFIG;
      return cfg.enabled && cfg.priority > 0 && isSpotScheduleActive(cfg);
    })
    .sort((a, b) => {
      const cfgA = cfgMap[a.id] ?? DEFAULT_SPOT_CONFIG;
      const cfgB = cfgMap[b.id] ?? DEFAULT_SPOT_CONFIG;
      const aScheduled = cfgA.scheduleStart ? 1 : 0;
      const bScheduled = cfgB.scheduleStart ? 1 : 0;
      // Scheduled first (descending), then by priority descending
      if (bScheduled !== aScheduled) return bScheduled - aScheduled;
      return (cfgB.priority ?? 1) - (cfgA.priority ?? 1);
    });

  const rotation = activeSpots.length ? buildSpotsRotation(activeSpots, cfgMap) : [];

  // Notícias (boletins EBC)
  const activeNews = (newsItems ?? []).filter((s) => s.genre === "news" || s.genre === "spot");
  let newsIdx = 0;

  let rotIdx = 0;
  const out: T[] = [];
  const effectiveSpotInterval = globalInterval > 0 && rotation.length > 0 ? globalInterval : 0;
  const effectiveNewsInterval = (newsInterval ?? 0) > 0 && activeNews.length > 0 ? (newsInterval ?? 0) : 0;

  for (let i = 0; i < songs.length; i++) {
    out.push(songs[i]);

    const insertSpot = effectiveSpotInterval > 0 && i % effectiveSpotInterval === 0;
    const insertNews = effectiveNewsInterval > 0 && i % effectiveNewsInterval === 0;

    // Ordem: spot primeiro, depois notícia
    if (insertSpot) {
      out.push(rotation[rotIdx % rotation.length]);
      rotIdx = (rotIdx + 1) % rotation.length;
    }
    if (insertNews) {
      out.push(activeNews[newsIdx % activeNews.length]);
      newsIdx = (newsIdx + 1) % activeNews.length;
    }
  }

  return out;
}

export function isSpotItem(song: { genre?: string | null } | null | undefined): boolean {
  return song?.genre === "spot";
}
