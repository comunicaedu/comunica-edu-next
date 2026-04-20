"use client";

import { useState, useEffect, useCallback, useRef } from "react";

export interface UserPreferences {
  user_id?: string;
  fav_songs?: string[];
  fav_playlists?: string[];
  fav_genres?: string[];
  hidden_playlists?: string[];
  playlist_song_favs?: Record<string, string[]>;
  boletins_categories?: string[];
  news_interval?: number;
  avatar_styles?: Record<string, { zoom: number; x: number; y: number }>;
  playlist_cover_styles?: Record<string, { zoom: number; x: number; y: number }>;
  random_playlists?: string[];
  shuffle_history?: Array<{ playlistId: string; playedIds: string[]; timestamp: number }>;
  player_state?: Record<string, unknown>;
  player_controls?: Record<string, unknown>;
  last_section?: string;
  last_section_ts?: number;
  admin_tab?: string;
  admin_tab_ts?: number;
  offline_mode?: boolean;
}

const DEFAULTS: UserPreferences = {
  fav_songs: [],
  fav_playlists: [],
  fav_genres: [],
  hidden_playlists: [],
  playlist_song_favs: {},
  boletins_categories: [],
  news_interval: 30,
  avatar_styles: {},
  playlist_cover_styles: {},
  random_playlists: [],
  shuffle_history: [],
  player_state: {},
  player_controls: {},
  last_section: "musicas",
  last_section_ts: 0,
  admin_tab: "dashboard",
  admin_tab_ts: 0,
  offline_mode: false,
};

// Migra dados do localStorage para o Supabase (só roda 1 vez)
function migrateFromLocalStorage(): Partial<UserPreferences> | null {
  if (typeof window === "undefined") return null;
  // Verifica se já migrou
  if (localStorage.getItem("edu-prefs-migrated") === "1") return null;

  const migrated: Partial<UserPreferences> = {};
  let hasSomething = false;

  const tryParse = <T>(key: string, fallback: T): T => {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return fallback;
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  };

  const favSongs = tryParse<string[]>("edu_fav_songs", []);
  if (favSongs.length) { migrated.fav_songs = favSongs; hasSomething = true; }

  const favPlaylists = tryParse<string[]>("favorite-playlists", []);
  if (favPlaylists.length) { migrated.fav_playlists = favPlaylists; hasSomething = true; }

  const favGenres = tryParse<string[]>("edu_fav_genres", []);
  if (favGenres.length) { migrated.fav_genres = favGenres; hasSomething = true; }

  const hiddenPlaylists = tryParse<string[]>("edu-hidden-playlists", []);
  if (hiddenPlaylists.length) { migrated.hidden_playlists = hiddenPlaylists; hasSomething = true; }

  const boletins = tryParse<string[]>("edu-boletins-categories", []);
  if (boletins.length) { migrated.boletins_categories = boletins; hasSomething = true; }

  const newsInterval = localStorage.getItem("edu-news-interval");
  if (newsInterval) { migrated.news_interval = parseInt(newsInterval, 10) || 30; hasSomething = true; }

  const avatarStyles = tryParse<Record<string, { zoom: number; x: number; y: number }>>("avatar-cover-styles", {});
  if (Object.keys(avatarStyles).length) { migrated.avatar_styles = avatarStyles; hasSomething = true; }

  const playlistCoverStyles = tryParse<Record<string, { zoom: number; x: number; y: number }>>("playlist-cover-styles", {});
  if (Object.keys(playlistCoverStyles).length) { migrated.playlist_cover_styles = playlistCoverStyles; hasSomething = true; }

  const randomPlaylists = tryParse<string[]>("random-selected-playlists", []);
  if (randomPlaylists.length) { migrated.random_playlists = randomPlaylists; hasSomething = true; }

  const shuffleHistory = tryParse<Array<{ playlistId: string; playedIds: string[]; timestamp: number }>>("smart-shuffle-history", []);
  if (shuffleHistory.length) { migrated.shuffle_history = shuffleHistory; hasSomething = true; }

  const playerState = tryParse<Record<string, unknown>>("edu-player-state", {});
  if (Object.keys(playerState).length) { migrated.player_state = playerState; hasSomething = true; }

  const playerControls = tryParse<Record<string, unknown>>("edu-player-controls", {});
  if (Object.keys(playerControls).length) { migrated.player_controls = playerControls; hasSomething = true; }

  const lastSection = localStorage.getItem("edu-last-section");
  if (lastSection) { migrated.last_section = lastSection; hasSomething = true; }

  const lastSectionTs = localStorage.getItem("edu-last-section-ts");
  if (lastSectionTs) { migrated.last_section_ts = parseInt(lastSectionTs, 10) || 0; hasSomething = true; }

  const adminTab = localStorage.getItem("edu-admin-active-tab");
  if (adminTab) { migrated.admin_tab = adminTab; hasSomething = true; }

  const adminTabTs = localStorage.getItem("edu-admin-active-tab-ts");
  if (adminTabTs) { migrated.admin_tab_ts = parseInt(adminTabTs, 10) || 0; hasSomething = true; }

  const offlineMode = localStorage.getItem("edu-modo-off");
  if (offlineMode) { migrated.offline_mode = offlineMode === "1"; hasSomething = true; }

  // Migra favoritos por playlist
  const playlistSongFavs: Record<string, string[]> = {};
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith("-favorites") && key !== "favorite-playlists") {
      const playlistId = key.replace("-favorites", "");
      const songs = tryParse<string[]>(key, []);
      if (songs.length) {
        playlistSongFavs[playlistId] = songs;
        hasSomething = true;
      }
    }
  }
  if (Object.keys(playlistSongFavs).length) { migrated.playlist_song_favs = playlistSongFavs; }

  return hasSomething ? migrated : null;
}

// Limpa localStorage das chaves migradas
function cleanupLocalStorage() {
  const keysToRemove = [
    "edu_fav_songs", "favorite-playlists", "edu_fav_genres",
    "edu-hidden-playlists", "edu-boletins-categories", "edu-news-interval",
    "avatar-cover-styles", "playlist-cover-styles", "random-selected-playlists",
    "smart-shuffle-history", "edu-player-state", "edu-player-controls",
    "edu-last-section", "edu-last-section-ts", "edu-admin-active-tab",
    "edu-admin-active-tab-ts", "edu-modo-off", "avatar-position-config",
  ];
  keysToRemove.forEach(k => localStorage.removeItem(k));

  // Remove ${playlistId}-favorites
  const toRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key && key.endsWith("-favorites") && key !== "favorite-playlists") {
      toRemove.push(key);
    }
  }
  toRemove.forEach(k => localStorage.removeItem(k));

  localStorage.setItem("edu-prefs-migrated", "1");
}

export function useUserPreferences() {
  const [prefs, setPrefs] = useState<UserPreferences>(DEFAULTS);
  const [loaded, setLoaded] = useState(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tokenRef = useRef<string | null>(null);

  // Carrega preferências do Supabase ao montar
  useEffect(() => {
    (async () => {
      const { supabase } = await import("@/lib/supabase/client");
      let { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        const { data: refreshed } = await supabase.auth.refreshSession();
        session = refreshed.session;
      }
      if (!session?.access_token) { setLoaded(true); return; }

      tokenRef.current = session.access_token;

      // Carrega do Supabase
      const res = await fetch("/api/user-preferences", {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const { preferences } = await res.json();

      // Migra dados antigos do localStorage (só 1 vez)
      const migrated = migrateFromLocalStorage();
      if (migrated) {
        // Merge: localStorage tem prioridade se Supabase está vazio
        const merged = { ...DEFAULTS, ...preferences, ...migrated };
        setPrefs(merged);
        // Salva merge no Supabase
        await fetch("/api/user-preferences", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(migrated),
        });
        cleanupLocalStorage();
      } else {
        setPrefs({ ...DEFAULTS, ...preferences });
      }

      setLoaded(true);
    })();
  }, []);

  // Salva no Supabase com debounce de 500ms
  const saveToSupabase = useCallback((partial: Partial<UserPreferences>) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const token = tokenRef.current;
      if (!token) return;
      await fetch("/api/user-preferences", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(partial),
      }).catch(() => {});
    }, 500);
  }, []);

  // Atualiza uma preferência (local + Supabase)
  const updatePref = useCallback(<K extends keyof UserPreferences>(key: K, value: UserPreferences[K]) => {
    setPrefs(prev => ({ ...prev, [key]: value }));
    saveToSupabase({ [key]: value });
  }, [saveToSupabase]);

  // Atualiza múltiplas preferências de uma vez
  const updatePrefs = useCallback((partial: Partial<UserPreferences>) => {
    setPrefs(prev => ({ ...prev, ...partial }));
    saveToSupabase(partial);
  }, [saveToSupabase]);

  return { prefs, loaded, updatePref, updatePrefs };
}
