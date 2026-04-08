"use client";

import { useState, useRef, useEffect, useLayoutEffect, useCallback, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Music, Radio, Mic, Bot, LogOut, Play, Pause, SkipForward, SkipBack,
  Volume2, VolumeX, Clock, ChevronRight, Menu, X, ShieldCheck, RotateCcw, Loader2,
  Smile, Frown, Heart, TrendingUp, Coffee, Repeat1, ExternalLink, Users
} from "lucide-react";
import type { MoodInfo } from "@/components/player/MoodFlow";
import EduLogoIcon from "@/components/player/EduLogoIcon";
import FloatingMiniPlayer from "@/components/player/FloatingMiniPlayer";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import ComunicaEduLogo from "@/components/ComunicaEduLogo";
import AdminPanel from "@/components/admin/AdminPanel";
import MusicHub from "@/components/player/MusicHub";
import ProgramacaoPanel from "@/components/player/ProgramacaoPanel";
import LocutorVirtualPanel from "@/components/player/LocutorVirtualPanel";
import SpotsPanel from "@/components/player/SpotsPanel";
import { useAudioFocus } from "@/hooks/useAudioFocus";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { useYouTubePlayer } from "@/hooks/useYouTubePlayer";
import { usePlaylistScheduleAutomation } from "@/hooks/usePlaylistScheduleAutomation";
import { useAudioCascade } from "@/hooks/useAudioCascade";
import { useLocalAudioNormalizer } from "@/hooks/useLocalAudioNormalizer";
import { supabase } from "@/lib/supabase/client";
import { useTheme } from "@/contexts/ThemeContext";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { cacheAudioUrl, getCachedAudioUrl } from "@/lib/audioCache";
import { markSongPlayed, buildSmartQueue } from "@/hooks/useSmartShuffle";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { usePlayerHistory } from "@/contexts/PlayerHistoryContext";
import {
  getSpotSettings,
  fetchUserSpots,
  intercalateSpots,
  isSpotItem,
} from "@/lib/spotIntercalate";
import { loadSpotConfigs } from "@/lib/spotConfig";
import VoiceRecorderModal, { type InsertMode } from "@/components/player/VoiceRecorderModal";
import { useKeyboardPlayer } from "@/hooks/useKeyboardPlayer";
import { usePlayerBroadcaster, type RemoteCommand } from "@/hooks/usePlayerBroadcast";
// ThemePreviewPopover removed – avatar click now shows zoom effect

import { Slider } from "@/components/ui/slider";

const LAST_SESSION_KEY = "edu-last-session";
const PLAYER_STATE_KEY = "edu-player-state";
const PLAYER_CONTROLS_KEY = "edu-player-controls";
const SECTION_KEY = "edu-last-section";
const SECTION_TS_KEY = "edu-last-section-ts";

const SUBTAB_RESTORE_LIMIT_MS = 5 * 60 * 1000;
const ADMIN_TAB_KEY = "edu-admin-active-tab";
const ADMIN_TAB_TS_KEY = "edu-admin-active-tab-ts";
const PROGRAMACAO_TAB_KEY = "edu-programacao-active-tab";
const PROGRAMACAO_TAB_TS_KEY = "edu-programacao-active-tab-ts";
const OWNER_AVATAR_EDITOR_SIZE = 96;
const OWNER_AVATAR_TOP_SIZE = 36;
const OWNER_AVATAR_POSITION_RATIO = OWNER_AVATAR_TOP_SIZE / OWNER_AVATAR_EDITOR_SIZE;
const YOUTUBE_NORMALIZATION_GAIN = 0.78;


interface Song {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
  youtube_video_id?: string | null;
}

interface AvatarCoverStyle {
  zoom: number;
  x: number;
  y: number;
}


const PLAYER_SECTIONS = new Set([
  "musicas",
  "playlists",
  "upload",
  "locutor",
  "ia",
  "spots",
  "programacao",
  "admin",
]);

const ADMIN_PANEL_TABS = new Set(["dashboard", "clientes", "generos", "planos", "aparencia"]);
const PROGRAMACAO_PANEL_TABS = new Set(["active", "schedule", "extras"]);

const getSectionFromSearch = (search: string): string => {
  const params = new URLSearchParams(search);
  const section = params.get("section");
  return section && PLAYER_SECTIONS.has(section) ? section : "musicas";
};


const getRecentTabFromStorage = (
  tabKey: string,
  tsKey: string,
  validTabs: Set<string>
): string | null => {
  try {
    const tab = localStorage.getItem(tabKey);
    const ts = localStorage.getItem(tsKey);

    if (!tab || !ts || !validTabs.has(tab)) return null;

    const elapsed = Date.now() - Number(ts);
    if (elapsed > SUBTAB_RESTORE_LIMIT_MS) return null;

    return tab;
  } catch {
    return null;
  }
};

const getTabForSection = (section: string): string | null => {
  if (section === "admin") {
    return (
      getRecentTabFromStorage(ADMIN_TAB_KEY, ADMIN_TAB_TS_KEY, ADMIN_PANEL_TABS) ??
      "generos"
    );
  }

  if (section === "programacao") {
    return (
      getRecentTabFromStorage(
        PROGRAMACAO_TAB_KEY,
        PROGRAMACAO_TAB_TS_KEY,
        PROGRAMACAO_PANEL_TABS
      ) ?? "active"
    );
  }

  return null;
};

const shuffleFallback = <T,>(songs: T[]): T[] => {
  const shuffled = [...songs];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
};

function PlayerPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Impede flash de conteúdo SSR — player é 100% client-side
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentSong, setCurrentSong] = useState<Song | null>(null);
  const [activeSection, setActiveSection] = useState<string>(() => {
    // Read from window.location.search directly — searchParams may be empty
    // during initial hydration even when the URL has a ?section= param.
    // This component is inside <Suspense> so it never runs on the server.
    if (typeof window !== "undefined") {
      const s = new URLSearchParams(window.location.search).get("section");
      if (s && PLAYER_SECTIONS.has(s)) return s;
    }
    const s = searchParams.get("section");
    return s && PLAYER_SECTIONS.has(s) ? s : "musicas";
  });
  const [aiText, setAiText] = useState("");
  const [aiSuggestion, setAiSuggestion] = useState("");
  const [progress, setProgress] = useState(0);
  const [musicVolume, setMusicVolume] = useState(() => {
    if (typeof window === 'undefined') return 0.7;
    try {
      const c = JSON.parse(localStorage.getItem(PLAYER_CONTROLS_KEY) || "{}");
      return typeof c.musicVolume === "number" ? c.musicVolume : 0.7;
    } catch { return 0.7; }
  });
  const [previousVolume, setPreviousVolume] = useState(() => {
    if (typeof window === 'undefined') return 0.7;
    try {
      const c = JSON.parse(localStorage.getItem(PLAYER_CONTROLS_KEY) || "{}");
      return typeof c.previousVolume === "number" ? c.previousVolume : 0.7;
    } catch { return 0.7; }
  });
  const [isMuted, setIsMuted] = useState(() => {
    if (typeof window === 'undefined') return false;
    try {
      const c = JSON.parse(localStorage.getItem(PLAYER_CONTROLS_KEY) || "{}");
      return c.isMuted === true;
    } catch { return false; }
  });
  const [spotVolume, setSpotVolume] = useState(() => {
    if (typeof window === 'undefined') return 1.0;
    try {
      const c = JSON.parse(localStorage.getItem(PLAYER_CONTROLS_KEY) || "{}");
      return typeof c.spotVolume === "number" ? c.spotVolume : 1.0;
    } catch { return 1.0; }
  });
  const [showMiniPlayer] = useState(true);
  const [micOpen, setMicOpen] = useState(false);
  const [broadcastUserId, setBroadcastUserId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    const stored = localStorage.getItem("owner-avatar-user-id");
    if (stored && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stored)) {
      return stored;
    }
    // Remove invalid value (e.g. "owner") so it never reaches the database
    if (stored) localStorage.removeItem("owner-avatar-user-id");
    return null;
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [userLogo] = useState<string | null>(() => typeof window !== 'undefined' ? localStorage.getItem("user-logo") : null);
  // Avatar: inicia null (sem hydration mismatch), carrega do localStorage antes do primeiro paint
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [userAvatarStyle, setUserAvatarStyle] = useState<AvatarCoverStyle | null>(null);

  useLayoutEffect(() => {
    const BLOCKED = ["lovable.dev", "gptengineer", "lovable.app", "gpteng.co"];
    const localAvatar = localStorage.getItem("owner-avatar-url");
    if (localAvatar) {
      if (BLOCKED.some((d) => localAvatar.includes(d))) {
        localStorage.removeItem("owner-avatar-url");
      } else {
        setUserAvatar(localAvatar);
      }
    }
    const userId = localStorage.getItem("owner-avatar-user-id");
    if (userId) {
      try {
        const savedStyles = JSON.parse(localStorage.getItem("avatar-cover-styles") || "{}");
        setUserAvatarStyle(savedStyles?.[userId] ?? null);
      } catch { /* noop */ }
    }
  }, []);
  const [avatarZoomed, setAvatarZoomed] = useState(false);
  const [avatarEditMode, setAvatarEditMode] = useState(false);
  const [avatarConfig, setAvatarConfig] = useState<{ x: number; y: number; size: number }>(() => {
    if (typeof window === "undefined") return { x: 16, y: 16, size: 40 };
    try { return JSON.parse(localStorage.getItem("avatar-position-config") || "null") ?? { x: 16, y: 16, size: 40 }; } catch { return { x: 16, y: 16, size: 40 }; }
  });
  const avatarDragRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);
  const [queue, setQueue] = useState<Song[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [activePlaylistName, setActivePlaylistName] = useState<string | null>(null);
  const [activeMoodInfo, setActiveMoodInfo] = useState<MoodInfo | null>(null);
  const [repeatSong, setRepeatSong] = useState(false);
  const handleToggleRepeatSong = useCallback(() => {
    setRepeatSong((prev) => {
      repeatSongRef.current = !prev;
      return !prev;
    });
  }, []);

  const [repeatPlaylistId, setRepeatPlaylistId] = useState<string | null>(null);
  const repeatPlaylistIdRef = useRef<string | null>(null);
  const handleToggleRepeatPlaylist = useCallback((playlistId: string) => {
    setRepeatPlaylistId((prev) => {
      const next = prev === playlistId ? null : playlistId;
      repeatPlaylistIdRef.current = next;
      return next;
    });
  }, []);
  const playerHistory = usePlayerHistory();
  // Ref to always have the latest currentSong for history tracking
  const currentSongRef = useRef<Song | null>(null);
  const repeatSongRef = useRef(false);
  const { resetTheme } = useTheme();
  const { isSectionVisible, features } = useClientFeatures();
  useIsAdmin();
  const audioRef = useRef<HTMLAudioElement>(null);
  const queueRef = useRef<{ queue: Song[]; queueIndex: number; activePlaylistId: string | null }>({ queue: [], queueIndex: 0, activePlaylistId: null });
  const { claimAudioFocus, releaseAudioFocus } = useAudioFocus();
  const ytPlayer = useYouTubePlayer();
  const {
    playByVideoId: playYouTubeByVideoId,
    setVolume: setYouTubeVolume,
    setNormalizationGain: setYouTubeNormalizationGain,
    videoId: ytVideoId,
  } = ytPlayer;
  const cascade = useAudioCascade();
  const [isYouTubeMode, setIsYouTubeMode] = useState(false);
  const isYouTubeModeRef = useRef(false);
  const ytQuotaExhausted = useRef(false);
  const lastHandledYtEndRef = useRef(0);
  const clampVolume = useCallback((value: number) => Math.max(0, Math.min(1, value)), []);
  const musicVolumeRef = useRef(0.7);
  const spotVolumeRef = useRef(1.0);
  const scheduledVolumeFadeRef = useRef<number | null>(null);
  const scheduledVolumeLockRef = useRef(false);
  const scheduledVolumeTargetRef = useRef<number | null>(null);
  const preScheduleVolumeRef = useRef<number | null>(null);
  // Guards against concurrent transitions and against automation re-firing while paused
  const isTransitioningRef = useRef(false);
  const manuallyPausedRef = useRef(false);
  // Incremented on every play request — stale async resolves abort themselves
  const playGenerationRef = useRef(0);
  // Preload buffer para a próxima faixa local — elimina latência na troca
  const preloadAudioRef = useRef<HTMLAudioElement | null>(null);
  const preloadUrlRef = useRef<string | null>(null);
  // Quando true, suprime erros de áudio — estamos trocando src intencionalmente
  const intentionalSrcChangeRef = useRef(false);
  // Ref to skipToNextAvailable — breaks the circular dep with handlePlayCascade
  const skipToNextAvailableRef = useRef<((fromIdx: number) => void) | null>(null);
  // Conta pulos consecutivos sem tocar nenhuma música — evita loop infinito
  const consecutiveSkipsRef = useRef(0);
  // Ref to handlePlayCascade — used by goNextInQueue/skipToNextAvailable so those
  // callbacks don't have handlePlayCascade in their deps (which would cause the
  // audio useEffect to re-mount on every render → infinite render loop).
  const handlePlayCascadeRef = useRef<((song: Song, navDirection?: "back" | "forward" | "skip") => void) | null>(null);
  // Ref to goNextInQueue — used in the audio useEffect onEnded handler so the
  // effect is stable and doesn't re-mount (and cancel/restart the RAF) every render.
  const goNextInQueueRef = useRef<(() => void) | null>(null);
  const handlePreviousRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    musicVolumeRef.current = clampVolume(musicVolume);
  }, [clampVolume, musicVolume]);

  useEffect(() => {
    spotVolumeRef.current = clampVolume(spotVolume);
  }, [clampVolume, spotVolume]);

  useEffect(() => {
    isYouTubeModeRef.current = isYouTubeMode;
  }, [isYouTubeMode]);

  const getPersistedMusicVolume = useCallback(() => {
    return clampVolume(musicVolumeRef.current);
  }, [clampVolume]);

  const { forceSync: forceLocalNormalizerSync, setVolume: setNormalizerVolume } = useLocalAudioNormalizer(audioRef, !isYouTubeMode, {
    targetLufs: -14,
    minGain: 0.45,
    maxGain: 1.35,
  });

  const applyPlayerVolume = useCallback(
    (
      rawValue: number,
      options: {
        rememberAsPrevious?: boolean;
      } = {}
    ) => {
      const { rememberAsPrevious = true } = options;
      const nextVolume = clampVolume(rawValue);

      musicVolumeRef.current = nextVolume;
      setMusicVolume(nextVolume);
      setIsMuted(nextVolume === 0);
      if (rememberAsPrevious && nextVolume > 0) {
        setPreviousVolume(nextVolume);
      }

      setNormalizerVolume(nextVolume);
      setYouTubeVolume(nextVolume);
    },
    [clampVolume, setNormalizerVolume, setYouTubeVolume]
  );

  /**
   * Universal fade: linearly interpolates volume from `from` to `to` over
   * `durationMs` milliseconds. Calls onComplete when done.
   * Cancels any in-progress fade before starting a new one.
   * Updates audio nodes directly (no React state) to avoid re-renders.
   */
  const fadeVolume = useCallback(
    (from: number, to: number, durationMs: number, onComplete?: () => void) => {
      if (scheduledVolumeFadeRef.current !== null) {
        window.clearInterval(scheduledVolumeFadeRef.current);
        scheduledVolumeFadeRef.current = null;
      }
      const STEPS = Math.max(10, Math.round(durationMs / 50));
      const stepMs = durationMs / STEPS;
      const startVol = clampVolume(from);
      const endVol = clampVolume(to);
      const delta = (endVol - startVol) / STEPS;
      let step = 0;

      scheduledVolumeFadeRef.current = window.setInterval(() => {
        step++;
        const newVol = clampVolume(startVol + delta * step);
        musicVolumeRef.current = newVol;
        setNormalizerVolume(newVol);
        if (isYouTubeModeRef.current) setYouTubeVolume(newVol);

        if (step >= STEPS) {
          window.clearInterval(scheduledVolumeFadeRef.current!);
          scheduledVolumeFadeRef.current = null;
          musicVolumeRef.current = endVol;
          setNormalizerVolume(endVol);
          if (isYouTubeModeRef.current) setYouTubeVolume(endVol);
          onComplete?.();
        }
      }, stepMs);
    },
    [clampVolume, setNormalizerVolume, setYouTubeVolume]
  );

  useEffect(() => {
    return () => {
      if (scheduledVolumeFadeRef.current !== null) {
        window.clearInterval(scheduledVolumeFadeRef.current);
        scheduledVolumeFadeRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    setYouTubeNormalizationGain(YOUTUBE_NORMALIZATION_GAIN);
  }, [setYouTubeNormalizationGain]);

  // Navigation state is managed by PlayerHistoryContext

  // ── Persist active section ──
  useEffect(() => {
    // Clear invalid saved sections (e.g. old "vinhetas" that no longer exists)
    const saved = localStorage.getItem(SECTION_KEY);
    if (saved && !PLAYER_SECTIONS.has(saved)) localStorage.removeItem(SECTION_KEY);
    localStorage.setItem(SECTION_KEY, activeSection);
    localStorage.setItem(SECTION_TS_KEY, String(Date.now()));
  }, [activeSection]);


  usePWAInstall();
  const { trackPlay } = useActivityTracker();

  // Fetch playlist name whenever active playlist changes
  useEffect(() => {
    if (!activePlaylistId || activePlaylistId.startsWith("mood-")) {
      setActivePlaylistName(null);
      return;
    }
    // IDs especiais com nome fixo
    if (activePlaylistId === "biblioteca") {
      setActivePlaylistName("Músicas");
      return;
    }
    if (activePlaylistId.startsWith("smart-")) {
      setActivePlaylistName("Seleção para você");
      return;
    }
    if (activePlaylistId === "all-random") {
      setActivePlaylistName("Aleatório");
      return;
    }
    fetch("/api/playlists")
      .then((r) => r.json())
      .then(({ playlists: all }) => {
        const pl = (all ?? []).find((p: { id: string; name: string }) => p.id === activePlaylistId);
        const name = pl?.name?.replace(/\u200b/g, "").trim();
        setActivePlaylistName(name || "Playlist");
      })
      .catch(() => setActivePlaylistName("Playlist"));
  }, [activePlaylistId]);

  // getAudioUrl is now handled by useAudioCascade

  const offlineEnabled = features["modo_offline"] === true;

  const BLOCKED_AVATAR_DOMAINS = ["lovable.dev", "gptengineer", "lovable.app", "gpteng.co"];

  const applyFreshAvatar = useCallback((avatarUrl: string, userId?: string | null) => {
    // Never apply avatar URLs from Lovable/GPT-Engineer — wipe them if found
    if (BLOCKED_AVATAR_DOMAINS.some((d) => avatarUrl.includes(d))) {
      localStorage.removeItem("owner-avatar-url");
      setUserAvatar(null);
      return;
    }

    const [baseUrl, rawQuery] = avatarUrl.split("?");
    if (!baseUrl) return;

    const incomingUrlWithQuery = rawQuery ? `${baseUrl}?${rawQuery}` : null;

    setUserAvatar((prev) => {
      if (!prev) {
        return incomingUrlWithQuery ?? `${baseUrl}?t=${Date.now()}`;
      }

      const prevBase = prev.split("?")[0];

      if (prevBase !== baseUrl) {
        return incomingUrlWithQuery ?? `${baseUrl}?t=${Date.now()}`;
      }

      if (incomingUrlWithQuery && prev !== incomingUrlWithQuery) {
        return incomingUrlWithQuery;
      }

      return prev;
    });

    // Store base URL without timestamp to avoid stale busters
    localStorage.setItem("owner-avatar-url", baseUrl);
    if (userId) {
      localStorage.setItem("owner-avatar-user-id", userId);
    }

    // Update server cache so anonymous tabs can load the avatar without auth
    fetch("/api/owner-avatar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar_url: baseUrl }),
    }).catch(() => {});
  }, []);

  const syncAvatarToCloud = useCallback((avatarUrl: string, userId?: string | null) => {
    const baseUrl = avatarUrl.split("?")[0];
    if (baseUrl.startsWith("data:")) return;
    void supabase.functions.invoke("admin-clients?action=avatar-set", {
      body: { avatar_url: baseUrl, user_id: userId || null },
    });
  }, []);

  // ── Load user avatar + live sync from owner panel ──
  const loadAvatar = useCallback(async () => {
    // Read cached avatar AFTER auth to avoid flash of wrong avatar on init
    const { data: { user } } = await supabase.auth.getUser();

    const localAvatar = localStorage.getItem("owner-avatar-url");
    const localUserId = localStorage.getItem("owner-avatar-user-id");

    if (localUserId) {
      try {
        const savedStyles = JSON.parse(localStorage.getItem("avatar-cover-styles") || "{}");
        setUserAvatarStyle(savedStyles?.[localUserId] ?? null);
      } catch {
        setUserAvatarStyle(null);
      }
    }

    if (!user) {
      // Sem sessão (aba anônima): busca avatar via rota de API pública do servidor
      if (!localAvatar) {
        try {
          const res = await fetch("/api/owner-avatar");
          const json = await res.json();
          if (json?.avatar_url) applyFreshAvatar(json.avatar_url);
        } catch { /* silencioso */ }
      }
      return;
    }

    setBroadcastUserId(user.id);
    localStorage.setItem("owner-avatar-user-id", user.id);

    try {
      const savedStyles = JSON.parse(localStorage.getItem("avatar-cover-styles") || "{}");
      setUserAvatarStyle(savedStyles?.[user.id] ?? null);
    } catch {
      setUserAvatarStyle(null);
    }

    // Avatar only from localStorage — prevents Lovable avatar from Supabase
    if (localAvatar) {
      applyFreshAvatar(localAvatar, user.id);
    }
  }, [applyFreshAvatar]);

  useEffect(() => {
    loadAvatar();

    const onAvatarUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ avatarUrl?: string; userId?: string; avatarStyle?: AvatarCoverStyle | null }>;
      const avatarUrl = customEvent.detail?.avatarUrl;
      const avatarStyle = customEvent.detail?.avatarStyle;
      const userId = customEvent.detail?.userId;

      if (avatarUrl) {
        applyFreshAvatar(avatarUrl, userId);
        syncAvatarToCloud(avatarUrl, userId);
      }
      if (userId) localStorage.setItem("owner-avatar-user-id", userId);

      if (avatarStyle) {
        setUserAvatarStyle(avatarStyle);
      } else if (userId) {
        try {
          const savedStyles = JSON.parse(localStorage.getItem("avatar-cover-styles") || "{}");
          setUserAvatarStyle(savedStyles?.[userId] ?? null);
        } catch {
          setUserAvatarStyle(null);
        }
      }
    };

    // Reload avatar when returning to the tab
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        loadAvatar();
      }
    };

    window.addEventListener("owner-avatar-updated", onAvatarUpdated as EventListener);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("owner-avatar-updated", onAvatarUpdated as EventListener);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [applyFreshAvatar, loadAvatar]);

  // Click outside to dismiss avatar zoom
  useEffect(() => {
    if (!avatarZoomed) return;
    const dismiss = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-avatar-zoom]")) setAvatarZoomed(false);
    };
    document.addEventListener("mousedown", dismiss);
    return () => document.removeEventListener("mousedown", dismiss);
  }, [avatarZoomed]);

  // ── Restore player state (unlimited time) ──
  const hasRestoredPlayer = useRef(false);
  useEffect(() => {
    if (hasRestoredPlayer.current) return;
    hasRestoredPlayer.current = true;

    try {
      const raw = localStorage.getItem(PLAYER_STATE_KEY);
      if (!raw) return;
      const state = JSON.parse(raw);

      // Restore queue + song (no time limit)
      const savedQueue: Song[] = state.queue || [];
      const savedIndex: number = state.queueIndex ?? 0;
      const savedPlaylistId: string | null = state.playlistId ?? null;
      const savedSong: Song | null = state.currentSong ?? null;
      const savedPosition: number = state.position ?? 0;

      if (savedQueue.length > 0 && savedSong) {
        setQueue(savedQueue);
        setQueueIndex(savedIndex);
        if (savedPlaylistId) setActivePlaylistId(savedPlaylistId);
        queueRef.current = { queue: savedQueue, queueIndex: savedIndex, activePlaylistId: savedPlaylistId };
        setCurrentSong(savedSong);
        currentSongRef.current = savedSong;

        // Resume playback after a tick to let refs settle
        setTimeout(async () => {
          try {
            const source = await cascade.resolve(savedSong);
            if (source.type === "local") {
              if (audioRef.current) {
                const restoredVolume = getPersistedMusicVolume();
                const audio = audioRef.current;

                setNormalizerVolume(restoredVolume);
                audio.src = source.url;
                audio.currentTime = savedPosition;

                window.setTimeout(() => {
                  if (audioRef.current !== audio) return;
                  setNormalizerVolume(restoredVolume);
                  audio.play().catch(() => {});
                  forceLocalNormalizerSync();
                }, 60);
              }
              setIsPlaying(true);
              setIsYouTubeMode(false);
              claimAudioFocus();
            } else if (source.type === "youtube" && source.videoId) {
              setIsYouTubeMode(true);
              setIsPlaying(true);
              claimAudioFocus();
              playYouTubeByVideoId(source.videoId, getPersistedMusicVolume()).catch(() => {});
            }
          } catch {
            // Failed to restore — silently stay paused
          }
        }, 300);
      }
    } catch {
      localStorage.removeItem(PLAYER_STATE_KEY);
    }
  }, [cascade, claimAudioFocus, forceLocalNormalizerSync, getPersistedMusicVolume, playYouTubeByVideoId]);

  // ── Save player state continuously (debounced every 3s) ──
  useEffect(() => {
    if (!currentSong) return;

    const interval = setInterval(() => {
      try {
        const position = audioRef.current?.currentTime ?? 0;
        localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({
          queue: queueRef.current.queue.slice(0, 200),
          queueIndex: queueRef.current.queueIndex,
          playlistId: queueRef.current.activePlaylistId,
          currentSong,
          position,
          timestamp: Date.now(),
        }));
      } catch {}
    }, 3000);

    return () => clearInterval(interval);
  }, [currentSong]);

  // ── Save audio controls (volume, mute, spotVolume) with debounce ──
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(PLAYER_CONTROLS_KEY, JSON.stringify({
          musicVolume,
          previousVolume,
          isMuted,
          spotVolume,
        }));
      } catch {}
    }, 500);
    return () => clearTimeout(timer);
  }, [musicVolume, previousVolume, isMuted, spotVolume]);

  // ── Save player state on page unload ──
  useEffect(() => {
    const saveOnUnload = () => {
      if (!currentSongRef.current) return;
      try {
        const position = audioRef.current?.currentTime ?? 0;
        localStorage.setItem(PLAYER_STATE_KEY, JSON.stringify({
          queue: queueRef.current.queue.slice(0, 200),
          queueIndex: queueRef.current.queueIndex,
          playlistId: queueRef.current.activePlaylistId,
          currentSong: currentSongRef.current,
          position,
          timestamp: Date.now(),
        }));
      } catch {}
    };
    window.addEventListener("beforeunload", saveOnUnload);
    return () => window.removeEventListener("beforeunload", saveOnUnload);
  }, []);

  // ── Persist session state (for internal use during active session only) ──
  const saveSession = useCallback((songs: Song[], idx: number, plId: string | null) => {
    try {
      localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({
        queue: songs.slice(0, 200),
        queueIndex: idx,
        playlistId: plId,
        timestamp: Date.now(),
      }));
    } catch {}
  }, []);

  const patchSongWithVideoId = useCallback((songId: string, videoId: string) => {
    const applyPatch = (song: Song): Song =>
      song.id === songId
        ? { ...song, youtube_video_id: videoId, file_path: `youtube:${videoId}` }
        : song;

    setQueue((prev) => {
      if (!prev.some((song) => song.id === songId)) return prev;
      const updated = prev.map(applyPatch);
      queueRef.current.queue = updated;
      saveSession(updated, queueRef.current.queueIndex, queueRef.current.activePlaylistId);
      return updated;
    });

    setCurrentSong((prev) => (prev && prev.id === songId ? applyPatch(prev) : prev));
  }, [saveSession]);

  // resolveImportedSongInBackground is now handled by cascade.preResolve

  // ── Preload next track metadata via cascade ──
  const preAnalyzeNext = useCallback((songs: Song[], idx: number) => {
    const nextSong = songs[idx + 1];
    if (!nextSong) return;

    cascade.preResolve(nextSong).then((videoId) => {
      if (videoId) patchSongWithVideoId(nextSong.id, videoId);
    });

    // Pré-carrega o áudio local da próxima faixa para troca instantânea
    const fp = nextSong.file_path;
    if (fp && !fp.startsWith("youtube:") && !fp.startsWith("imported/")) {
      const url = fp.startsWith("/uploads/") || fp.startsWith("http")
        ? fp
        : (() => { try { const { data } = (cascade as any).getStorageUrl ? { data: { publicUrl: fp } } : { data: { publicUrl: fp } }; return data.publicUrl; } catch { return null; } })();
      if (url && url !== preloadUrlRef.current) {
        preloadUrlRef.current = url;
        if (!preloadAudioRef.current) preloadAudioRef.current = new Audio();
        preloadAudioRef.current.preload = "auto";
        preloadAudioRef.current.src = url;
        preloadAudioRef.current.load();
      }
    }
  }, [cascade, patchSongWithVideoId]);

  /**
   * Unified cascade play — generation-safe async.
   * NOT wrapped in useCallback intentionally: making it a useCallback creates
   * a circular dependency chain (handlePlayCascade → skipToNextAvailable →
   * handlePlayCascade) that causes infinite re-render loops. The generation
   * counter is what prevents stale async operations, not React memoization.
   */
  const handlePlayCascade = async (song: Song, navDirection?: "back" | "forward" | "skip") => {
    const generation = ++playGenerationRef.current;
    manuallyPausedRef.current = false; // nova música = intenção de tocar

    // Para o áudio atual IMEDIATAMENTE antes de qualquer operação async.
    // Isso evita que eventos do áudio antigo (error, ended) disparem
    // skipToNextAvailable enquanto estamos resolvendo a nova música.
    // IMPORTANTE: NÃO zeramos audio.src aqui — manter o src antigo preserva o
    // contexto de "reprodução iniciada por gesto do usuário" no iOS Safari,
    // permitindo que audio.play() seja chamado sem nova interação.
    intentionalSrcChangeRef.current = true;
    if (audioRef.current) {
      audioRef.current.pause();
    }
    if (isYouTubeModeRef.current) {
      ytPlayer.stop();
    }

    const prevSong = currentSongRef.current;
    if (!navDirection && prevSong) {
      playerHistory.pushToHistory(prevSong);
      playerHistory.clearForward();
    }

    currentSongRef.current = song;
    setCurrentSong(song);
    setIsPlaying(true);
    claimAudioFocus();
    trackPlay({ id: song.id, genre: song.genre, artist: song.artist });

    // Informa o browser/OS que é um player de música — essencial para iOS lock screen
    if ("mediaSession" in navigator) {
      const artwork = song.cover_url
        ? [{ src: song.cover_url, sizes: "512x512", type: "image/jpeg" }]
        : [];
      navigator.mediaSession.metadata = new MediaMetadata({
        title: song.title,
        artist: song.artist ?? "ComunicaEDU",
        album: "ComunicaEDU",
        artwork,
      });
      navigator.mediaSession.playbackState = "playing";
      navigator.mediaSession.setActionHandler("play", () => {
        audioRef.current?.play().catch(() => {});
        navigator.mediaSession.playbackState = "playing";
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        audioRef.current?.pause();
        navigator.mediaSession.playbackState = "paused";
      });
      navigator.mediaSession.setActionHandler("nexttrack", () => { goNextInQueueRef.current?.(); });
      navigator.mediaSession.setActionHandler("previoustrack", () => { handlePreviousRef.current?.(); });
      // iOS exige setPositionState para reconhecer o player como ativo em background
      if (audioRef.current?.duration && !isNaN(audioRef.current.duration)) {
        try {
          navigator.mediaSession.setPositionState({
            duration: audioRef.current.duration,
            playbackRate: 1,
            position: audioRef.current.currentTime,
          });
        } catch { /* ignore — API pode não estar disponível em todos os browsers */ }
      }
    }

    // ── Spot volume override ──
    // Spots use spotVolume; regular songs after a spot restore musicVolume.
    // We never touch the persisted musicVolume so it always remains correct.
    if (isSpotItem(song)) {
      const sv = spotVolumeRef.current;
      setNormalizerVolume(sv);
      setYouTubeVolume(sv);
    } else if (isSpotItem(prevSong)) {
      // Transitioning out of a spot → restore music volume
      const mv = clampVolume(musicVolumeRef.current);
      setNormalizerVolume(mv);
      setYouTubeVolume(mv);
    }

    const source = await cascade.resolve(song);

    // Abort if a newer play request superseded this one while we awaited
    if (generation !== playGenerationRef.current) {
      intentionalSrcChangeRef.current = false;
      return;
    }

    if (source.type === "local") {
      if (isYouTubeModeRef.current) {
        ytPlayer.stop();
        setIsYouTubeMode(false);
        isYouTubeModeRef.current = false;
      }

      if (audioRef.current) {
        const audio = audioRef.current;

        const shouldUseOfflineBlob = offlineEnabled && typeof navigator !== "undefined" && !navigator.onLine;
        let finalUrl = source.url;
        if (shouldUseOfflineBlob) {
          const offlineBlobUrl = await getCachedAudioUrl(source.url);
          if (generation !== playGenerationRef.current) return;
          if (offlineBlobUrl) finalUrl = offlineBlobUrl;
        }

        consecutiveSkipsRef.current = 0;
        intentionalSrcChangeRef.current = true;

        // Se o preload já carregou essa URL, troca instantânea
        const preloaded = preloadAudioRef.current;
        if (preloaded && preloadUrlRef.current === finalUrl && preloaded.readyState >= 3) {
          // Swap: usa o buffer precarregado diretamente
          audio.src = finalUrl;
          intentionalSrcChangeRef.current = false;
          if (generation !== playGenerationRef.current) return;
          audio.play().catch(() => {});
          forceLocalNormalizerSync();
          preloadUrlRef.current = null;
        } else {
          audio.src = finalUrl;
          audio.load();
          const playWhenReady = () => {
            intentionalSrcChangeRef.current = false;
            if (generation !== playGenerationRef.current) return;
            audio.play().catch(() => {});
            forceLocalNormalizerSync();
          };
          audio.addEventListener("canplay", playWhenReady, { once: true });
          // Fallback: se canplay demorar mais de 3s, tenta mesmo assim
          window.setTimeout(() => {
            if (generation !== playGenerationRef.current) return;
            intentionalSrcChangeRef.current = false;
            if (audio.readyState >= 2) return;
            audio.play().catch(() => {});
            forceLocalNormalizerSync();
          }, 3000);
        }

        if (offlineEnabled && !shouldUseOfflineBlob) {
          cacheAudioUrl(source.url).catch(() => {});
        }
      }
    } else if (source.type === "youtube") {
      const vid = source.videoId?.trim();
      if (!vid || vid.length < 5 || /[^a-zA-Z0-9_\-]/.test(vid)) {
        intentionalSrcChangeRef.current = false;
        skipToNextAvailableRef.current?.(queueRef.current.queueIndex);
        return;
      }

      setIsYouTubeMode(true);
      isYouTubeModeRef.current = true;
      intentionalSrcChangeRef.current = false;

      try {
        await playYouTubeByVideoId(vid, scheduledVolumeLockRef.current ? clampVolume(musicVolumeRef.current) : getPersistedMusicVolume());
        if (generation !== playGenerationRef.current) return;
        ytQuotaExhausted.current = false;
        consecutiveYtErrorsRef.current = 0;
        consecutiveSkipsRef.current = 0; // YouTube iniciou com sucesso — reseta contador de pulos
        patchSongWithVideoId(song.id, vid);
      } catch {
        if (generation !== playGenerationRef.current) return;
        skipToNextAvailableRef.current?.(queueRef.current.queueIndex);
        return;
      }
    } else {
      intentionalSrcChangeRef.current = false;
      skipToNextAvailableRef.current?.(queueRef.current.queueIndex);
      return;
    }

    const { queue: q, queueIndex: qi } = queueRef.current;
    preAnalyzeNext(q, qi);
  };

  // Keep ref current so goNextInQueue / skipToNextAvailable can call it without
  // listing handlePlayCascade in their deps (which would make the audio RAF
  // useEffect re-mount on every render, causing an infinite render loop).
  handlePlayCascadeRef.current = handlePlayCascade;

  // Keep legacy function names for backward compatibility with other components
  const handlePlay = (song: Song) => handlePlayCascade(song);
  const handlePlayImported = (song: Song) => handlePlayCascade(song);

  const reshuffleCurrentQueue = useCallback((): Song[] => {
    const { queue: currentQueue, activePlaylistId: pid } = queueRef.current;
    if (currentQueue.length === 0) return [];

    const reshuffled = pid
      ? buildSmartQueue(pid, currentQueue)
      : shuffleFallback(currentQueue);

    if (reshuffled.length === 0) return [];

    setQueue(reshuffled);
    setQueueIndex(0);
    queueRef.current.queue = reshuffled;
    queueRef.current.queueIndex = 0;

    saveSession(reshuffled, 0, pid);
    preAnalyzeNext(reshuffled, -1);
    preAnalyzeNext(reshuffled, 0);

    return reshuffled;
  }, [preAnalyzeNext, saveSession]);

  const goNextInQueue = useCallback(() => {
    setProgress(0);

    const { queue: currentQueue, queueIndex: qi, activePlaylistId: pid } = queueRef.current;

    // Repeat single song — restart from beginning
    if (repeatSongRef.current && currentQueue[qi]) {
      const song = currentQueue[qi];
      if (pid) markSongPlayed(pid, song.id);
      saveSession(currentQueue, qi, pid);
      handlePlayCascadeRef.current?.(song);
      return;
    }

    if (currentQueue.length === 0) {
      setIsPlaying(false);
      setIsYouTubeMode(false);
      releaseAudioFocus();
      return;
    }

    let queueToUse = currentQueue;
    let nextIdx = qi + 1;

    if (nextIdx >= currentQueue.length) {
      // If repeat is on for this playlist → reshuffle and loop it
      if (pid && repeatPlaylistIdRef.current === pid) {
        queueToUse = reshuffleCurrentQueue();
        if (queueToUse.length === 0) { setIsPlaying(false); setIsYouTubeMode(false); releaseAudioFocus(); return; }
        nextIdx = 0;
      } else {
        // A→Z flow: move to next playlist alphabetically; dispatch event for PlaylistSection to load it
        window.dispatchEvent(new CustomEvent("playlist-ended", { detail: { playlistId: pid } }));
        return; // PlaylistSection will call onQueueChange with the next playlist
      }
    }

    const nextSong = queueToUse[nextIdx];
    setQueueIndex(nextIdx);
    queueRef.current.queueIndex = nextIdx;

    if (pid) markSongPlayed(pid, nextSong.id);
    saveSession(queueToUse, nextIdx, pid);
    handlePlayCascadeRef.current?.(nextSong);
  // handlePlayCascade intentionally omitted from deps — called via handlePlayCascadeRef
  // to prevent goNextInQueue from being recreated on every render.
  }, [releaseAudioFocus, reshuffleCurrentQueue, saveSession]);

  const skipToNextAvailable = useCallback((fromIdx: number) => {
    consecutiveSkipsRef.current += 1;

    // Muitos pulos seguidos sem tocar nada → avança para a próxima playlist sem pausar
    if (consecutiveSkipsRef.current > 8) {
      consecutiveSkipsRef.current = 0;
      window.dispatchEvent(new CustomEvent("playlist-ended"));
      return;
    }

    const { queue: q, activePlaylistId: pid } = queueRef.current;

    for (let i = fromIdx + 1; i < q.length; i++) {
      const s = q[i];
      setQueueIndex(i);
      queueRef.current.queueIndex = i;
      if (pid) markSongPlayed(pid, s.id);
      saveSession(q, i, pid);
      handlePlayCascadeRef.current?.(s, "skip");
      return;
    }

    const reshuffled = reshuffleCurrentQueue();
    if (reshuffled.length > 0) {
      const nextSong = reshuffled[0];
      if (pid) markSongPlayed(pid, nextSong.id);
      saveSession(reshuffled, 0, pid);
      handlePlayCascadeRef.current?.(nextSong, "skip");
      return;
    }

    consecutiveSkipsRef.current = 0;
    setIsPlaying(false);
    setIsYouTubeMode(false);
    releaseAudioFocus();
  // handlePlayCascade intentionally omitted from deps — called via handlePlayCascadeRef.
  }, [releaseAudioFocus, reshuffleCurrentQueue, saveSession]);

  // Keep refs in sync after each render
  skipToNextAvailableRef.current = skipToNextAvailable;
  goNextInQueueRef.current = goNextInQueue;
  // handlePreviousRef sincronizado após handlePrevious ser definido (mais abaixo)

  const handlePause = useCallback(() => {
    // Always pause immediately — no fade, no delay.
    // Fades only happen during schedule transitions (handleScheduleTransition).
    manuallyPausedRef.current = true;
    if (scheduledVolumeFadeRef.current !== null) {
      window.clearInterval(scheduledVolumeFadeRef.current);
      scheduledVolumeFadeRef.current = null;
    }
    isTransitioningRef.current = false;
    if (isYouTubeModeRef.current) {
      ytPlayer.pause();
    } else {
      audioRef.current?.pause();
    }
    setIsPlaying(false);
    releaseAudioFocus();
  }, [releaseAudioFocus, ytPlayer]);

  const handlePlayPause = useCallback(() => {
    if (isPlaying) {
      handlePause();
    } else if (currentSong) {
      manuallyPausedRef.current = false;
      window.dispatchEvent(new Event("main-playback-start"));
      setIsPlaying(true);
      claimAudioFocus();
      const target = getPersistedMusicVolume();
      musicVolumeRef.current = target;
      setNormalizerVolume(target);
      if (isYouTubeMode) {
        setYouTubeVolume(target);
        ytPlayer.play();
      } else {
        forceLocalNormalizerSync();
        audioRef.current?.play().catch(() => {
          setIsPlaying(false);
          manuallyPausedRef.current = true;
        });
      }
    }
  }, [
    isPlaying, currentSong, isYouTubeMode,
    claimAudioFocus, fadeVolume, forceLocalNormalizerSync,
    getPersistedMusicVolume, handlePause,
    setNormalizerVolume, setYouTubeVolume, ytPlayer,
  ]);

  // Pause main player when admin panel starts playing
  useEffect(() => {
    const handler = () => {
      if (isPlaying) handlePause();
    };
    window.addEventListener("admin-playback-start", handler);
    return () => window.removeEventListener("admin-playback-start", handler);
  }, [isPlaying]);

  // Pause main player when modal preview starts
  useEffect(() => {
    const handler = () => {
      if (isPlaying) handlePause();
    };
    window.addEventListener("modal-preview-started", handler);
    return () => window.removeEventListener("modal-preview-started", handler);
  }, [isPlaying]);

  // Rebuild queue when spot settings or spot list changes
  useEffect(() => {
    const rebuild = async () => {
      const { queue: currentQueue, queueIndex: qi, activePlaylistId: pid } = queueRef.current;
      if (!currentQueue.length || !pid) return;
      // Strip existing spots from queue, then re-intercalate with new settings
      const songsOnly = currentQueue.filter((s) => !isSpotItem(s));
      const spotCfg = getSpotSettings();
      let rebuilt: Song[];
      if (spotCfg.enabled && spotCfg.interval > 0) {
        const spotTracks = await fetchUserSpots();
        rebuilt = intercalateSpots(songsOnly, spotTracks as Song[], spotCfg.interval, loadSpotConfigs());
      } else {
        rebuilt = songsOnly;
      }
      if (!rebuilt.length) return;
      // Keep current song position as close as possible
      const currentSong = currentQueue[qi];
      const newIdx = currentSong
        ? Math.max(0, rebuilt.findIndex((s) => s.id === currentSong.id))
        : 0;
      setQueue(rebuilt);
      setQueueIndex(newIdx);
      queueRef.current = { queue: rebuilt, queueIndex: newIdx, activePlaylistId: pid };
    };
    window.addEventListener("spot-settings-changed", rebuild);
    window.addEventListener("spots-updated", rebuild);
    return () => {
      window.removeEventListener("spot-settings-changed", rebuild);
      window.removeEventListener("spots-updated", rebuild);
    };
  }, []);

  // ── Realtime deletion handler: stop playback if current song/playlist is deleted ──
  useEffect(() => {
    const songChannel = supabase
      .channel("player-song-deletions")
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "songs" },
        (payload) => {
          const deletedId = payload.old?.id;
          if (!deletedId) return;

          // If the currently playing song was deleted, skip to next
          if (currentSongRef.current?.id === deletedId) {
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.src = "";
            }
            if (isYouTubeMode) ytPlayer.stop();

            // Remove from queue and skip
            const { queue: q, queueIndex: qi, activePlaylistId: pid } = queueRef.current;
            const filtered = q.filter((s) => s.id !== deletedId);
            if (filtered.length > 0) {
              const nextIdx = Math.min(qi, filtered.length - 1);
              setQueue(filtered);
              setQueueIndex(nextIdx);
              queueRef.current = { queue: filtered, queueIndex: nextIdx, activePlaylistId: pid };
              handlePlayCascadeRef.current?.(filtered[nextIdx], "skip");
            } else {
              setQueue([]);
              setQueueIndex(0);
              setCurrentSong(null);
              currentSongRef.current = null;
              setIsPlaying(false);
              setIsYouTubeMode(false);
              queueRef.current = { queue: [], queueIndex: 0, activePlaylistId: null };
              releaseAudioFocus();
            }
          } else {
            // Remove deleted song from queue silently
            setQueue((prev) => {
              const filtered = prev.filter((s) => s.id !== deletedId);
              if (filtered.length === prev.length) return prev;
              const currentIdx = queueRef.current.queueIndex;
              const currentSongInQueue = prev[currentIdx];
              const newIdx = currentSongInQueue
                ? filtered.findIndex((s) => s.id === currentSongInQueue.id)
                : 0;
              queueRef.current.queue = filtered;
              queueRef.current.queueIndex = Math.max(0, newIdx);
              setQueueIndex(Math.max(0, newIdx));
              return filtered;
            });
          }
        }
      )
      .subscribe();

    const playlistChannel = supabase
      .channel("player-playlist-deletions")
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "playlists" },
        async (payload) => {
          const deletedPlaylistId = payload.old?.id;
          if (!deletedPlaylistId) return;

          // If the currently active playlist was deleted, try to play the next available playlist
          if (queueRef.current.activePlaylistId === deletedPlaylistId) {
            if (audioRef.current) {
              audioRef.current.pause();
              audioRef.current.src = "";
            }
            if (isYouTubeMode) ytPlayer.stop();

            // Try to find the next available playlist and auto-play it
            try {
              const { data: nextPlaylists } = await supabase
                .from("playlists")
                .select("id")
                .neq("id", deletedPlaylistId)
                .order("created_at", { ascending: false })
                .limit(1);

              if (nextPlaylists && nextPlaylists.length > 0) {
                const nextPlaylistId = nextPlaylists[0].id;
                const { data: nextSongs } = await supabase
                  .from("playlist_songs")
                  .select("position, songs(id, title, artist, genre, file_path, cover_url, created_at, youtube_video_id)")
                  .eq("playlist_id", nextPlaylistId)
                  .order("position", { ascending: true });

                const songs = (nextSongs || [])
                  .map((ps: any) => ps.songs)
                  .filter(Boolean) as Song[];

                if (songs.length > 0) {
                  const shuffled = shuffleFallback([...songs]);
                  setQueue(shuffled);
                  setQueueIndex(0);
                  setActivePlaylistId(nextPlaylistId);
                  queueRef.current = { queue: shuffled, queueIndex: 0, activePlaylistId: nextPlaylistId };
                  saveSession(shuffled, 0, nextPlaylistId);
                  handlePlayCascadeRef.current?.(shuffled[0], "skip");
                  return;
                }
              }
            } catch (e) {
              console.error("Erro ao buscar próxima playlist:", e);
            }

            // Fallback: no other playlist available, clear everything
            setQueue([]);
            setQueueIndex(0);
            setCurrentSong(null);
            currentSongRef.current = null;
            setIsPlaying(false);
            setIsYouTubeMode(false);
            setActivePlaylistId(null);
            queueRef.current = { queue: [], queueIndex: 0, activePlaylistId: null };
            releaseAudioFocus();
            localStorage.removeItem(PLAYER_STATE_KEY);
          }
        }
      )
      .subscribe();

    // Evento imediato de deleção disparado por PlaylistSection (sem esperar Supabase realtime)
    const handleForceDelete = async (event: Event) => {
      const deletedPlaylistId = (event as CustomEvent<{ playlistId: string }>).detail?.playlistId;
      if (!deletedPlaylistId) return;
      if (queueRef.current.activePlaylistId !== deletedPlaylistId) return;

      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (isYouTubeMode) ytPlayer.stop();

      try {
        const plRes = await fetch("/api/playlists");
        const plData = await plRes.json();
        const allPlaylists = (plData.playlists ?? []).filter((p: any) => p.id !== deletedPlaylistId);

        if (allPlaylists.length > 0) {
          const nextPlaylistId = allPlaylists[0].id;
          const psRes = await fetch(`/api/playlist-songs?playlist_id=${nextPlaylistId}`);
          const psData = await psRes.json();
          const songs: Song[] = (psData.songs ?? []).filter(Boolean);
          if (songs.length > 0) {
            const shuffled = shuffleFallback([...songs]);
            setQueue(shuffled); setQueueIndex(0); setActivePlaylistId(nextPlaylistId);
            queueRef.current = { queue: shuffled, queueIndex: 0, activePlaylistId: nextPlaylistId };
            saveSession(shuffled, 0, nextPlaylistId);
            handlePlayCascadeRef.current?.(shuffled[0], "skip");
            return;
          }
        }
      } catch {}

      // Sem mais playlists — para limpamente
      setQueue([]); setQueueIndex(0); setCurrentSong(null);
      currentSongRef.current = null; setIsPlaying(false); setIsYouTubeMode(false);
      setActivePlaylistId(null);
      queueRef.current = { queue: [], queueIndex: 0, activePlaylistId: null };
      releaseAudioFocus(); localStorage.removeItem(PLAYER_STATE_KEY);
    };

    window.addEventListener("playlist-force-delete", handleForceDelete);

    return () => {
      supabase.removeChannel(songChannel);
      supabase.removeChannel(playlistChannel);
      window.removeEventListener("playlist-force-delete", handleForceDelete);
    };
  // handlePlayCascade omitted — called via handlePlayCascadeRef to keep this
  // effect stable (prevent Supabase channels from being torn down every render).
  }, [isYouTubeMode, releaseAudioFocus, saveSession]);

  // Notify admin panels when main player starts
  const handlePlayWithNotify = useCallback((song: Song) => {
    window.dispatchEvent(new Event("main-playback-start"));
    handlePlay(song);
  }, [handlePlay]);

  const handlePlayImportedWithNotify = useCallback((song: Song) => {
    window.dispatchEvent(new Event("main-playback-start"));
    handlePlayImported(song);
  }, [handlePlayImported]);

  /**
   * Schedule transition: fade out → stop → start new song at 0 → fade in.
   * Guards against concurrent calls and respects manual pause.
   */
  const handleScheduleTransition = useCallback((
    song: Song,
    targetVolume: number,
    releaseAfterFade = false,
  ) => {
    // Don't start a new transition if already transitioning or user paused manually
    if (isTransitioningRef.current) return;
    if (manuallyPausedRef.current) return;

    isTransitioningRef.current = true;

    if (!scheduledVolumeLockRef.current) {
      preScheduleVolumeRef.current = clampVolume(musicVolumeRef.current);
    }
    scheduledVolumeLockRef.current = true;
    scheduledVolumeTargetRef.current = targetVolume;

    const currentVol = musicVolumeRef.current;

    // Step 1: fade out current audio (1.5 s)
    fadeVolume(currentVol, 0, 1500, () => {
      // Aborted (e.g. user paused during fade)
      if (manuallyPausedRef.current) {
        isTransitioningRef.current = false;
        return;
      }

      // Step 2: stop current playback silently and start new song
      if (isYouTubeModeRef.current) {
        ytPlayer.stop();
      } else {
        audioRef.current?.pause();
      }

      musicVolumeRef.current = 0;
      setNormalizerVolume(0);
      if (isYouTubeModeRef.current) setYouTubeVolume(0);

      window.dispatchEvent(new Event("main-playback-start"));
      const isImported = song.file_path?.startsWith("imported/") || song.file_path?.startsWith("youtube:");
      if (isImported) {
        handlePlayImported(song);
      } else {
        handlePlayCascade(song);
      }

      // Step 3: fade in to target volume (2 s) after a brief buffer delay
      window.setTimeout(() => {
        if (manuallyPausedRef.current) {
          isTransitioningRef.current = false;
          return;
        }
        fadeVolume(0, targetVolume, 2000, () => {
          isTransitioningRef.current = false;
          applyPlayerVolume(targetVolume, { rememberAsPrevious: false });
          if (releaseAfterFade) {
            scheduledVolumeLockRef.current = false;
            scheduledVolumeTargetRef.current = null;
          }
        });
      }, 200);
    });
  }, [applyPlayerVolume, clampVolume, fadeVolume, handlePlayCascade, handlePlayImported, setNormalizerVolume, setYouTubeVolume, ytPlayer]);

  // Tracks playback state before a schedule interrupts, so we can resume after
  const interruptedStateRef = useRef<{
    song: Song | null;
    queue: Song[];
    queueIndex: number;
    playlistId: string | null;
  } | null>(null);

  const handleQueueChangeForSchedule = useCallback((songs: Song[], currentIndex: number, playlistId: string) => {
    // Save current state before the schedule takes over (only if not already interrupted)
    if (!interruptedStateRef.current) {
      interruptedStateRef.current = {
        song: currentSongRef.current,
        queue: queueRef.current.queue,
        queueIndex: queueRef.current.queueIndex,
        playlistId: queueRef.current.activePlaylistId,
      };
    }

    const seen = new Set<string>();
    const deduped = songs.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
    const adjustedIndex = Math.min(currentIndex, deduped.length - 1);
    setQueue(deduped);
    setQueueIndex(adjustedIndex);
    setActivePlaylistId(playlistId);
    if (!playlistId.startsWith("mood-")) setActiveMoodInfo(null);
    playerHistory.clearForward();
    queueRef.current = { queue: deduped, queueIndex: adjustedIndex, activePlaylistId: playlistId };
    saveSession(deduped, adjustedIndex, playlistId);
    preAnalyzeNext(deduped, adjustedIndex);
  }, [preAnalyzeNext, saveSession, playerHistory]);

  const handleScheduleEnd = useCallback(() => {
    const restoredVol = preScheduleVolumeRef.current ?? getPersistedMusicVolume();
    preScheduleVolumeRef.current = null;

    // Cancel any running fade
    if (scheduledVolumeFadeRef.current !== null) {
      window.clearInterval(scheduledVolumeFadeRef.current);
      scheduledVolumeFadeRef.current = null;
    }

    const interrupted = interruptedStateRef.current;
    interruptedStateRef.current = null;

    if (interrupted && interrupted.song && interrupted.queue.length > 0) {
      // Restore interrupted queue and transition back with fade
      setQueue(interrupted.queue);
      setQueueIndex(interrupted.queueIndex);
      if (interrupted.playlistId) setActivePlaylistId(interrupted.playlistId);
      queueRef.current = {
        queue: interrupted.queue,
        queueIndex: interrupted.queueIndex,
        activePlaylistId: interrupted.playlistId,
      };
      handleScheduleTransition(interrupted.song, restoredVol, true);
    } else {
      // No interrupted state — fade to restored volume then release lock
      scheduledVolumeLockRef.current = false;
      scheduledVolumeTargetRef.current = null;
      fadeVolume(musicVolumeRef.current, restoredVol, 2000, () => {
        applyPlayerVolume(restoredVol);
        window.dispatchEvent(new CustomEvent("playlist-ended", {
          detail: { playlistId: queueRef.current.activePlaylistId },
        }));
      });
    }
  }, [applyPlayerVolume, fadeVolume, getPersistedMusicVolume, handleScheduleTransition]);

  usePlaylistScheduleAutomation({
    onPlay: handlePlayWithNotify,
    onPause: handlePause,
    onPlayImported: handlePlayImportedWithNotify,
    onQueueChange: handleQueueChangeForSchedule,
    onScheduleEnd: handleScheduleEnd,
    onBeforePlayVolume: undefined,
    onScheduleTransition: handleScheduleTransition,
    isManuallyPaused: () => manuallyPausedRef.current,
  });

  // Progress tracking + auto-next on ended + force volume on every load
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    let rafId: number;

    const tick = () => {
      if (audio.duration && !isNaN(audio.duration)) {
        setProgress((audio.currentTime / audio.duration) * 100);
      }
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    const onEnded = () => {
      if (!isYouTubeModeRef.current) goNextInQueueRef.current?.();
    };

    // Pré-carrega a próxima faixa quando restar 2s — elimina gap entre músicas
    const nextPreloadedRef = { songId: "" };
    const onTimeUpdate = () => {
      if (audio.duration <= 0 || isYouTubeModeRef.current) return;
      const remaining = audio.duration - audio.currentTime;
      if (remaining > 2) return;
      const { queue: q, queueIndex: qi } = queueRef.current;
      const nextSong = q[qi + 1];
      if (!nextSong || nextSong.id === nextPreloadedRef.songId) return;
      nextPreloadedRef.songId = nextSong.id;
      const fp = nextSong.file_path;
      if (!fp || fp.startsWith("youtube:") || fp.startsWith("imported/")) return;
      const url = fp.startsWith("/uploads/") || fp.startsWith("http") ? fp : null;
      if (!url) return;
      if (!preloadAudioRef.current) preloadAudioRef.current = new Audio();
      preloadAudioRef.current.preload = "auto";
      preloadAudioRef.current.src = url;
      preloadAudioRef.current.load();
      preloadUrlRef.current = url;
    };

    const applyPersistedVolume = () => {
      const effectiveVolume = scheduledVolumeLockRef.current
        ? clampVolume(musicVolumeRef.current)
        : getPersistedMusicVolume();
      setNormalizerVolume(effectiveVolume);
      setYouTubeVolume(effectiveVolume);
    };

    // Sync React isPlaying state from actual audio events — this eliminates
    // the desync where the button shows "paused" but audio is still running.
    const onPlay = () => {
      setIsPlaying(true);
      applyPersistedVolume();
      forceLocalNormalizerSync();
    };

    const onPause = () => {
      // Only update if NOT in the middle of a controlled fade/transition
      // (fade out pauses the element, but isPlaying was already set to false)
      if (!isTransitioningRef.current) {
        if (manuallyPausedRef.current || intentionalSrcChangeRef.current) {
          // Pausa intencional do usuário ou troca de src — atualiza estado normalmente
          if (manuallyPausedRef.current) setIsPlaying(false);
        } else {
          // Pausa forçada pelo browser (background, focus loss, etc.) — reinicia imediatamente
          const audio = audioRef.current;
          if (audio && audio.src && !audio.ended) {
            audio.play().catch(() => undefined);
            forceLocalNormalizerSync();
          }
        }
      }
    };

    const onLoadedData = () => {
      applyPersistedVolume();
      forceLocalNormalizerSync();
    };

    // Só pula para próxima se for erro real — não durante troca intencional de src.
    // audio.error?.code não é confiável (pode ser null quando o evento dispara),
    // por isso usamos intentionalSrcChangeRef para marcar trocas intencionais.
    let errorHandled = false;
    const onError = () => {
      if (errorHandled) return;
      if (isTransitioningRef.current) return;
      if (intentionalSrcChangeRef.current) return;
      // Ignora erros quando não há src definido (troca de faixa em andamento)
      if (!audio.src || audio.src === window.location.href) return;
      errorHandled = true;
      // Aguarda 800ms antes de pular — dá tempo ao browser tentar carregar
      window.setTimeout(() => {
        if (intentionalSrcChangeRef.current) return;
        if (!audio.src || audio.src === window.location.href) return;
        // Só pula se realmente não carregou nada
        if (audio.readyState === 0) {
          const qi = queueRef.current.queueIndex;
          skipToNextAvailableRef.current?.(qi);
        }
      }, 800);
    };

    const onLoadStart = () => { errorHandled = false; };

    audio.addEventListener("ended", onEnded);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("loadeddata", onLoadedData);
    audio.addEventListener("loadstart", onLoadStart);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);
    return () => {
      cancelAnimationFrame(rafId);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("loadeddata", onLoadedData);
      audio.removeEventListener("loadstart", onLoadStart);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
  // goNextInQueue and skipToNextAvailable intentionally omitted — called via
  // goNextInQueueRef / skipToNextAvailableRef so this effect is stable and
  // doesn't re-mount (cancelling/restarting the RAF) on every render.
  }, [clampVolume, forceLocalNormalizerSync, getPersistedMusicVolume, setNormalizerVolume, setYouTubeVolume]);

  // Keepalive: garante que o áudio nunca pare enquanto o usuário não pausou manualmente,
  // para todos os browsers (Chrome, Firefox, Safari, mobile, tablet).
  // Usa manuallyPausedRef (intenção do usuário) em vez de isPlaying (estado React),
  // porque o browser pode forçar audio.pause() sem que o usuário tenha pedido pausa.
  const isPlayingLiveRef = useRef(false);
  useEffect(() => { isPlayingLiveRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => {
    const id = window.setInterval(() => {
      if (manuallyPausedRef.current || !currentSongRef.current) return;
      if (isYouTubeModeRef.current) {
        ytPlayer.play();
      } else {
        const audio = audioRef.current;
        if (audio && audio.paused && !audio.ended && audio.src) {
          audio.play().catch(() => undefined);
          forceLocalNormalizerSync();
        }
      }
      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
        // iOS Safari: setPositionState periódico mantém o player visível na lock screen
        // e impede que o iOS considere o player "morto" e suspenda o áudio
        const msAudio = audioRef.current;
        if (!isYouTubeModeRef.current && msAudio && msAudio.duration && !isNaN(msAudio.duration)) {
          try {
            navigator.mediaSession.setPositionState({
              duration: msAudio.duration,
              playbackRate: 1,
              position: Math.min(msAudio.currentTime, msAudio.duration),
            });
          } catch { /* ignore */ }
        }
      }
    }, 2000);
    return () => clearInterval(id);
  }, [forceLocalNormalizerSync, ytPlayer]);

  useEffect(() => {
    if (!isYouTubeMode) return;

    if (ytPlayer.endedTick > 0 && ytPlayer.endedTick !== lastHandledYtEndRef.current) {
      lastHandledYtEndRef.current = ytPlayer.endedTick;
      consecutiveYtErrorsRef.current = 0; // música tocou até o fim — reseta contador de erros
      goNextInQueueRef.current?.();
    }
  // goNextInQueue omitted — called via ref so this effect stays stable.
  }, [isYouTubeMode, ytPlayer.endedTick]);

  // YouTube error → pula para próxima música automaticamente (sem toast, sem diálogo)
  // consecutiveYtErrors evita loop infinito quando várias músicas falham em sequência
  const lastHandledYtErrorRef = useRef(0);
  const consecutiveYtErrorsRef = useRef(0);
  useEffect(() => {
    if (!isYouTubeMode) return;
    if (ytPlayer.errorTick > 0 && ytPlayer.errorTick !== lastHandledYtErrorRef.current) {
      lastHandledYtErrorRef.current = ytPlayer.errorTick;
      consecutiveYtErrorsRef.current += 1;

      if (consecutiveYtErrorsRef.current > 5) {
        // Muitas falhas consecutivas — para de tentar e avança para a próxima playlist
        consecutiveYtErrorsRef.current = 0;
        console.warn("[YT] Muitas falhas consecutivas — avançando para próxima playlist.");
        window.dispatchEvent(new CustomEvent("playlist-ended"));
        return;
      }

      skipToNextAvailableRef.current?.(queueRef.current.queueIndex);
    }
  }, [isYouTubeMode, ytPlayer.errorTick]);

  // YouTube: no smart trimming needed — audio-only versions (Topic channels)
  // don't have long intros/outros, so just let them play naturally.

  useEffect(() => {
    const persistedVolume = scheduledVolumeLockRef.current
      ? clampVolume(musicVolumeRef.current)
      : getPersistedMusicVolume();

    setNormalizerVolume(persistedVolume);

    if (!currentSong) return;

    if (!isYouTubeMode) {
      forceLocalNormalizerSync();
      return;
    }

    if (!ytVideoId) return;

    let cancelled = false;
    let retryTimer: number | null = null;
    const hardSyncTimers: number[] = [];

    setYouTubeNormalizationGain(YOUTUBE_NORMALIZATION_GAIN);

    const trySync = (attemptsLeft: number) => {
      if (cancelled) return;
      const synced = setYouTubeVolume(persistedVolume);
      if (!synced && attemptsLeft > 0) {
        retryTimer = window.setTimeout(() => trySync(attemptsLeft - 1), 90);
      }
    };

    trySync(8);
    hardSyncTimers.push(window.setTimeout(() => !cancelled && setYouTubeVolume(persistedVolume), 60));
    hardSyncTimers.push(window.setTimeout(() => !cancelled && setYouTubeVolume(persistedVolume), 140));

    return () => {
      cancelled = true;
      if (retryTimer) window.clearTimeout(retryTimer);
      hardSyncTimers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [
    currentSong,
    forceLocalNormalizerSync,
    getPersistedMusicVolume,
    isYouTubeMode,
    setYouTubeNormalizationGain,
    setYouTubeVolume,
    ytVideoId,
  ]);

  const handleQueueChange = useCallback(async (songs: Song[], currentIndex: number, playlistId?: string) => {
    // Deduplicate by song ID (same song can't appear twice in the queue)
    const seen = new Set<string>();
    const baseSongs = songs.filter(s => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });

    // Intercalate spots if enabled
    const spotCfg = getSpotSettings();
    let deduped: Song[];
    if (spotCfg.enabled && spotCfg.interval > 0) {
      const spotTracks = await fetchUserSpots();
      deduped = intercalateSpots(baseSongs, spotTracks as Song[], spotCfg.interval, loadSpotConfigs());
    } else {
      deduped = baseSongs;
    }

    const adjustedIndex = Math.min(currentIndex, deduped.length - 1);

    setQueue(deduped);
    setQueueIndex(adjustedIndex);
    const plId = playlistId || activePlaylistId;
    if (playlistId) setActivePlaylistId(playlistId);
    // Clear mood info when switching to a non-mood playlist
    if (playlistId && !playlistId.startsWith("mood-")) {
      setActiveMoodInfo(null);
    }
    // GLOBAL HISTORY: Do NOT reset history when switching playlists.
    // Only reset forward stack — history persists across all playlists.
    playerHistory.clearForward();
    queueRef.current = { queue: deduped, queueIndex: adjustedIndex, activePlaylistId: plId };
    saveSession(deduped, adjustedIndex, plId);
    preAnalyzeNext(deduped, adjustedIndex - 1);
    preAnalyzeNext(deduped, adjustedIndex);
  }, [activePlaylistId, preAnalyzeNext, saveSession, playerHistory]);

  /** Insert a voice recording or TTS audio into the player queue */
  const insertAudioIntoQueue = useCallback((directFilePath: string, mode: InsertMode, title: string) => {
    const newSong: Song = {
      id: `rec-${Date.now()}`,
      title,
      artist: null,
      genre: "recording",
      file_path: directFilePath,
      cover_url: null,
      created_at: new Date().toISOString(),
    };

    const { queue: q, queueIndex: qi } = queueRef.current;

    if (mode === "interrupt") {
      // Insert at current position → plays immediately, current song resumes after
      const newQueue = [...q.slice(0, qi), newSong, ...q.slice(qi)];
      setQueue(newQueue);
      queueRef.current = { ...queueRef.current, queue: newQueue };
      handlePlayCascadeRef.current?.(newSong);
    } else if (mode === "queue") {
      // Insert right after current song
      const newQueue = [...q.slice(0, qi + 1), newSong, ...q.slice(qi + 1)];
      setQueue(newQueue);
      queueRef.current = { ...queueRef.current, queue: newQueue };
    } else {
      // "scheduled" — insert at next spot-interval slot
      const spotCfg = getSpotSettings();
      const interval = spotCfg.enabled && spotCfg.interval > 0 ? spotCfg.interval : 5;
      const posInBlock = (qi + 1) % interval;
      const hop = posInBlock === 0 ? interval : interval - posInBlock;
      const insertIdx = Math.min(qi + hop, q.length);
      const newQueue = [...q.slice(0, insertIdx), newSong, ...q.slice(insertIdx)];
      setQueue(newQueue);
      queueRef.current = { ...queueRef.current, queue: newQueue };
    }
  }, []);

  const nextSongInQueue = queue.length > 1
    ? queue[(queueIndex + 1) % queue.length]
    : null;

  const handleNext = useCallback(() => {
    // If there are songs in the forward stack (user went back before), use them
    if (playerHistory.hasForward) {
      const nextSong = playerHistory.popFromForward();
      if (!nextSong) {
        goNextInQueue();
        return;
      }
      const cur = currentSongRef.current;
      if (cur) playerHistory.pushToHistory(cur);
      const idxInQueue = queueRef.current.queue.findIndex(s => s.id === nextSong.id);
      if (idxInQueue >= 0) {
        setQueueIndex(idxInQueue);
        queueRef.current.queueIndex = idxInQueue;
      }
      saveSession(queueRef.current.queue, queueRef.current.queueIndex, queueRef.current.activePlaylistId);
      if (queueRef.current.activePlaylistId) markSongPlayed(queueRef.current.activePlaylistId, nextSong.id);
      handlePlayCascade(nextSong, "forward");
      return;
    }
    // Otherwise advance normally in the queue (infinite — reshuffles when exhausted)
    if (queueRef.current.queue.length === 0) return;
    goNextInQueue();
  }, [goNextInQueue, handlePlayCascade, saveSession, playerHistory]);

  const handlePrevious = useCallback(() => {
    const { queue: q, queueIndex: qi, activePlaylistId: pid } = queueRef.current;

    const cur = currentSongRef.current;

    // 1. If there's history, always use it — infinite back
    if (playerHistory.hasHistory) {
      const prevSong = playerHistory.popFromHistory();
      if (!prevSong) return;
      if (cur) playerHistory.pushToForward(cur);

      const idxInQueue = q.findIndex((s) => s.id === prevSong.id);
      if (idxInQueue >= 0) {
        setQueueIndex(idxInQueue);
        queueRef.current.queueIndex = idxInQueue;
      }

      if (pid) markSongPlayed(pid, prevSong.id);
      saveSession(q, queueRef.current.queueIndex, pid);
      handlePlayCascade(prevSong, "back");
      return;
    }

    // 2. No history but queue exists — wrap around to end
    if (q.length > 0) {
      const wrappedIndex = qi > 0 ? qi - 1 : q.length - 1;
      const wrappedSong = q[wrappedIndex];

      if (cur) playerHistory.pushToForward(cur);
      setQueueIndex(wrappedIndex);
      queueRef.current.queueIndex = wrappedIndex;

      if (pid) markSongPlayed(pid, wrappedSong.id);
      saveSession(q, wrappedIndex, pid);
      handlePlayCascade(wrappedSong, "back");
    }
  }, [handlePlayCascade, saveSession, playerHistory]);
  handlePreviousRef.current = handlePrevious;

  const handleMusicVolumeInput = useCallback(
    (rawValue: number) => {
      scheduledVolumeLockRef.current = false;
      scheduledVolumeTargetRef.current = null;
      applyPlayerVolume(rawValue);

      if (isYouTubeMode) {
        const nextVolume = clampVolume(rawValue);
        window.setTimeout(() => setYouTubeVolume(nextVolume), 70);
      }
    },
    [applyPlayerVolume, clampVolume, isYouTubeMode, setYouTubeVolume]
  );

  const handleMuteToggle = useCallback(() => {
    scheduledVolumeLockRef.current = false;

    if (isMuted || musicVolume === 0) {
      handleMusicVolumeInput(previousVolume > 0 ? previousVolume : 0.7);
      return;
    }

    setPreviousVolume(musicVolume > 0 ? musicVolume : previousVolume);
    applyPlayerVolume(0, { rememberAsPrevious: false });
  }, [applyPlayerVolume, handleMusicVolumeInput, isMuted, musicVolume, previousVolume]);

  // ── Keyboard / TV-remote shortcuts ──────────────────────────────────────────
  useKeyboardPlayer({
    isPlaying,
    onPlayPause: handlePlayPause,
    onNext: handleNext,
    onPrevious: handlePrevious,
    onMuteToggle: handleMuteToggle,
    onVolumeUp: () => handleMusicVolumeInput(Math.min(1, musicVolume + 0.05)),
    onVolumeDown: () => handleMusicVolumeInput(Math.max(0, musicVolume - 0.05)),
  });

  // ── Acesso Remoto — broadcast player state & receive commands ────────────────
  const { pushNow: pushStatNow } = usePlayerBroadcaster({
    userId: broadcastUserId,
    state: {
      isPlaying,
      isMuted,
      volume: musicVolume,
      progress,
      song: currentSong
        ? {
            id: currentSong.id,
            title: currentSong.title,
            artist: currentSong.artist,
            cover_url: currentSong.cover_url,
            genre: currentSong.genre,
          }
        : null,
      queueLength: queue.length,
      queueIndex,
      playlistName: activePlaylistName,
      ts: Date.now(),
    },
    onCommand: (cmd: RemoteCommand) => {
      switch (cmd.action) {
        case "play":    if (!isPlaying) handlePlayPause(); break;
        case "pause":   if (isPlaying)  handlePlayPause(); break;
        case "next":    handleNext();     break;
        case "prev":    handlePrevious(); break;
        case "mute":    if (!isMuted) handleMuteToggle(); break;
        case "unmute":  if (isMuted)  handleMuteToggle(); break;
        case "volume":  handleMusicVolumeInput(cmd.value); break;
      }
    },
  });
  // Push state immediately after play/pause so remote reflects change instantly
  useEffect(() => { pushStatNow(); }, [isPlaying, isMuted, musicVolume, currentSong]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAISuggest = () => {
    const suggestions: Record<string, string> = {
      "promoção": "🔥 PROMOÇÃO IMPERDÍVEL! Só hoje, descontos de até 50% em todos os produtos! Corra e aproveite, é por tempo limitado!",
      "inauguração": "🎉 GRANDE INAUGURAÇÃO! Estamos de portas abertas para você! Venha conhecer nosso espaço e aproveite condições especiais!",
      "": "📢 Atenção ouvintes! Não perca as melhores ofertas da semana. Acompanhe nossa programação!",
    };
    const key = Object.keys(suggestions).find(k => k && aiText.toLowerCase().includes(k)) || "";
    setAiSuggestion(suggestions[key]);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  const handleSectionChange = (section: string) => {
    setMobileMenuOpen(false);
    if (!PLAYER_SECTIONS.has(section) || section === activeSection) return;
    setActiveSection(section);

    const params = new URLSearchParams();
    params.set("section", section);
    const tab = getTabForSection(section);
    if (tab) params.set("tab", tab);
    window.history.replaceState(null, "", `${pathname}?${params.toString()}`);
  };

  const allSidebarItems = [
    { id: "musicas", icon: <Music className="h-4 w-4" />, label: "Músicas" },
    { id: "locutor", icon: <Radio className="h-4 w-4" />, label: "Locutor Virtual" },
    { id: "ia", icon: <Bot className="h-4 w-4" />, label: "IA Comercial" },
    { id: "spots", icon: <Mic className="h-4 w-4" />, label: "Spots" },
    { id: "programacao", icon: <Clock className="h-4 w-4" />, label: "Programação" },
    { id: "admin", icon: <ShieldCheck className="h-4 w-4" />, label: "Administração" },
  ];

  // Filter sidebar items based on feature toggles set by admin
  const sidebarItems = allSidebarItems.filter((item) => isSectionVisible(item.id));
  const sectionTitles: Record<string, string> = {
    musicas: "Biblioteca Musical",
    ia: "IA Comercial - Gerador de Textos",
    locutor: "Locutor Virtual",
    spots: "Spots",
    programacao: "Programação",
    admin: "Painel de Administração",
  };

  useEffect(() => {
    const s = searchParams.get("section");
    if (s && PLAYER_SECTIONS.has(s)) {
      setActiveSection((prev) => prev === s ? prev : s);
    }
  }, [searchParams]);

  if (!mounted) {
    return <div className="h-screen-safe bg-background" />;
  }

  return (
    <div className="h-screen-safe flex bg-background overflow-hidden safe-area-top safe-area-x">
      <audio ref={audioRef} preload="auto" crossOrigin="anonymous" />

      {/* Mobile overlay */}
      {mobileMenuOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-40 lg:hidden"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-card flex flex-col shrink-0 safe-area-top safe-area-bottom
        transform transition-transform duration-300 ease-in-out
        lg:relative lg:translate-x-0
        ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}
      `}>
        <div className="p-4 flex items-center justify-between relative" style={{ minHeight: 80 }}>
          <div style={{ position: "absolute", left: "calc(50% + -6px)", top: "calc(50% + 7px)", transform: "translate(-50%, -50%) scale(1.25)", zIndex: 99 }}>
            {userLogo ? (
              <img src={userLogo} alt="Logo" className="rounded-lg object-contain bg-white border border-border" style={{ height: 56, width: 56 }} />
            ) : (
              <ComunicaEduLogo size="sm" />
            )}
          </div>
          <button type="button" aria-label="Fechar menu" title="Fechar menu" className="lg:hidden text-muted-foreground p-2 -m-2" onClick={() => setMobileMenuOpen(false)}>
            <X className="h-6 w-6" />
          </button>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {sidebarItems.map((item) => (
            <SidebarItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={activeSection === item.id}
              onClick={() => handleSectionChange(item.id)}
            />
          ))}
        </nav>

        {/* Acesso Remoto */}
        <div className="px-3 pb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground px-2 mb-1">
            Acesso Remoto
          </p>
          <a
            href="/operador"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
          >
            <Radio className="h-4 w-4 text-primary shrink-0" />
            <span className="flex-1">Operador</span>
            <ExternalLink className="h-3.5 w-3.5 opacity-50" />
          </a>
          <a
            href={broadcastUserId ? `/ouvinte?uid=${broadcastUserId}` : "/ouvinte"}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:bg-secondary/60 hover:text-foreground transition-colors"
          >
            <Users className="h-4 w-4 text-primary shrink-0" />
            <span className="flex-1">Ouvinte</span>
            <ExternalLink className="h-3.5 w-3.5 opacity-50" />
          </a>
        </div>

        <div className="p-3">
          <Button
            className="w-full justify-start bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary active:scale-95 transition-all"
            onClick={async () => {
              await supabase.auth.signOut();
              router.replace("/login");
            }}
          >
            <LogOut className="h-4 w-4 mr-2" /> Sair
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <div className="flex-1 overflow-y-auto scrollbar-none">
        <header className="shrink-0 h-16 flex items-center px-4 sm:px-6 justify-between gap-2 bg-background">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Abrir menu" title="Abrir menu" className="lg:hidden text-muted-foreground p-2 -m-2" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-6 w-6" />
            </button>
            <h2 className="text-base sm:text-lg font-semibold truncate text-white">
              {sectionTitles[activeSection] || ""}
            </h2>
          </div>
          <div className="flex items-center gap-3 mr-2 sm:mr-4">
            {userLogo && (
              <div className="flex items-center gap-2">
                <img src={userLogo} alt="Logo do cliente" className="h-12 w-12 rounded-lg object-contain bg-white border border-border shadow-sm" />
                <button onClick={resetTheme} title="Restaurar tema original" className="text-muted-foreground hover:text-foreground transition-colors">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            )}
            {userAvatar ? (
              <>
                <div
                  data-avatar-zoom
                  className={`rounded-full overflow-hidden border-2 border-primary shadow-md bg-muted shrink-0 flex items-center justify-center transition-transform duration-200 ${avatarEditMode ? "fixed z-[9999] cursor-grab active:cursor-grabbing ring-2 ring-yellow-400" : "cursor-pointer"}`}
                  style={avatarEditMode
                    ? { left: avatarConfig.x, top: avatarConfig.y, width: avatarConfig.size, height: avatarConfig.size }
                    : { width: avatarZoomed ? 64 : 40, height: avatarZoomed ? 64 : 40, transition: "width 0.4s cubic-bezier(0.4,0,0.2,1), height 0.4s cubic-bezier(0.4,0,0.2,1)" }
                  }
                  onMouseDown={avatarEditMode ? (e) => {
                    e.preventDefault();
                    avatarDragRef.current = { startX: e.clientX, startY: e.clientY, origX: avatarConfig.x, origY: avatarConfig.y };
                    const onMove = (ev: MouseEvent) => {
                      if (!avatarDragRef.current) return;
                      const nx = avatarDragRef.current.origX + ev.clientX - avatarDragRef.current.startX;
                      const ny = avatarDragRef.current.origY + ev.clientY - avatarDragRef.current.startY;
                      setAvatarConfig((c) => ({ ...c, x: Math.max(0, nx), y: Math.max(0, ny) }));
                    };
                    const onUp = () => { avatarDragRef.current = null; window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                    window.addEventListener("mousemove", onMove);
                    window.addEventListener("mouseup", onUp);
                  } : undefined}
                  onClick={avatarEditMode ? undefined : (e) => { if (e.detail >= 2) { setAvatarEditMode(true); } else { setAvatarZoomed((z) => !z); } }}
                >
                  <img src={userAvatar} alt="Perfil" className="h-full w-full object-cover select-none"
                    style={{ transform: userAvatarStyle ? `translate(${(userAvatarStyle.x * OWNER_AVATAR_POSITION_RATIO).toFixed(2)}px, ${(userAvatarStyle.y * OWNER_AVATAR_POSITION_RATIO).toFixed(2)}px) scale(${userAvatarStyle.zoom})` : "scale(1.1)" }}
                  />
                </div>
                {/* Card de posicionamento */}
                {avatarEditMode && (
                  <div className="fixed z-[9999] bg-background border border-border rounded-xl shadow-xl p-3 flex flex-col gap-2 text-xs"
                    style={{ left: Math.min(avatarConfig.x + avatarConfig.size + 8, window.innerWidth - 200), top: avatarConfig.y }}
                  >
                    <p className="font-semibold text-foreground">Posicionar avatar</p>
                    <label className="text-muted-foreground">Tamanho: <span className="text-foreground font-medium">{avatarConfig.size}px</span></label>
                    <input type="range" min={32} max={120} value={avatarConfig.size} title="Tamanho do avatar" onChange={(e) => setAvatarConfig((c) => ({ ...c, size: Number(e.target.value) }))} className="accent-primary" />
                    <p className="text-muted-foreground">X: {Math.round(avatarConfig.x)}  Y: {Math.round(avatarConfig.y)}</p>
                    <button type="button" className="mt-1 bg-primary text-primary-foreground rounded-lg px-3 py-1 font-medium"
                      onClick={() => { localStorage.setItem("avatar-position-config", JSON.stringify(avatarConfig)); setAvatarEditMode(false); }}
                    >OK — Salvar posição</button>
                    <button type="button" className="text-muted-foreground hover:text-foreground"
                      onClick={() => setAvatarEditMode(false)}
                    >Cancelar</button>
                  </div>
                )}
              </>
            ) : (
              <span className="text-xs text-primary bg-primary/10 px-3 py-1 rounded-full font-medium whitespace-nowrap">
                🎁 Acesso Grátis
              </span>
            )}
          </div>
        </header>

        <div className="p-4 pb-28 sm:p-6 sm:pb-6">
          {activeSection === "admin" && (
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
              <AdminPanel />
            </Suspense>
          )}

          {activeSection === "musicas" && (
            <MusicHub
              currentSong={currentSong}
              isPlaying={isPlaying}
              onPlay={handlePlayWithNotify}
              onPause={handlePause}
              onPlayImported={handlePlayImportedWithNotify}
              isYouTubeLoading={ytPlayer.isLoading}
              onQueueChange={handleQueueChange}
              activePlaylistId={activePlaylistId}
              onMoodActive={setActiveMoodInfo}
              repeatPlaylistId={repeatPlaylistId}
              onToggleRepeatPlaylist={handleToggleRepeatPlaylist}
            />
          )}

          {activeSection === "programacao" && (
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
              <ProgramacaoPanel />
            </Suspense>
          )}

          {activeSection === "locutor" && (
            <Suspense fallback={<div className="flex items-center justify-center p-8"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>}>
              <LocutorVirtualPanel
                onInsert={insertAudioIntoQueue}
                onPreviewStart={handlePause}
              />
            </Suspense>
          )}

          {activeSection === "spots" && <SpotsPanel userId={broadcastUserId} onPreviewStart={handlePause} />}

          {activeSection === "ia" && (
            <div className="max-w-2xl mx-auto space-y-6">
              <div className="bg-card rounded-xl p-4 sm:p-6">
                <div className="pb-2 pt-1">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2">
                    <Bot className="h-5 w-5 text-primary" />
                    Gerador de Texto Comercial com IA
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    Descreva o tipo de comercial que você precisa e a IA vai gerar sugestões profissionais.
                  </p>
                </div>
                <Textarea
                  value={aiText}
                  onChange={(e) => setAiText(e.target.value)}
                  placeholder="Ex: promoção de loja de roupas com 50% de desconto..."
                  className="bg-secondary/50 min-h-[100px]"
                />
                <Button onClick={handleAISuggest} className="mt-3 font-semibold">
                  <Bot className="h-4 w-4 mr-2" /> Gerar Sugestão
                </Button>

                {aiSuggestion && (
                  <div className="mt-4 p-4 bg-primary/10 rounded-lg border border-primary/20">
                    <p className="text-sm font-medium text-primary mb-1">Sugestão da IA:</p>
                    <p className="text-sm text-foreground">{aiSuggestion}</p>
                    <Button size="sm" variant="outline" className="mt-3 text-primary border-primary">
                      <Mic className="h-3 w-3 mr-1" /> Usar com Locutor Virtual
                    </Button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        </div>

        {/* Player bar */}
        <div className="shrink-0 bg-card flex flex-col sm:flex-row items-center px-4 sm:px-6 py-1.5 sm:py-3 gap-1.5 sm:gap-4 safe-area-bottom">
          <div className="flex items-center gap-2.5 sm:gap-3 w-full sm:w-64 min-w-0">
            <div className="w-8 h-8 sm:w-11 sm:h-11 rounded-full overflow-hidden shrink-0" style={{ transform: `translate(-11px, -2px) scale(1.85)` }}>
              <EduLogoIcon fillContainer />
            </div>
            {activeMoodInfo && activePlaylistId?.startsWith("mood-") ? (
              <>
                <div className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full shrink-0 flex items-center justify-center -ml-4 sm:-ml-5 mt-3 sm:mt-5 ring-2 ring-card ${
                  activeMoodInfo.key === "alegre" ? "bg-yellow-500" :
                  activeMoodInfo.key === "triste" ? "bg-blue-500" :
                  activeMoodInfo.key === "crente" ? "bg-purple-500" :
                  activeMoodInfo.key === "vendas" ? "bg-green-500" :
                  "bg-cyan-500"
                }`}>
                  {activeMoodInfo.key === "alegre" && <Smile className="h-3.5 w-3.5 text-white" />}
                  {activeMoodInfo.key === "triste" && <Frown className="h-3.5 w-3.5 text-white" />}
                  {activeMoodInfo.key === "crente" && <Heart className="h-3.5 w-3.5 text-white" />}
                  {activeMoodInfo.key === "vendas" && <TrendingUp className="h-3.5 w-3.5 text-white" />}
                  {activeMoodInfo.key === "relaxado" && <Coffee className="h-3.5 w-3.5 text-white" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs sm:text-sm font-medium truncate">Flow {activeMoodInfo.label}</p>
                </div>
              </>
            ) : (
              <div className="min-w-0 flex-1">
                <p className="text-xs sm:text-sm font-medium truncate">{currentSong?.title || "Selecione uma música"}</p>
                {activePlaylistName ? (
                  <p className="text-[10px] sm:text-xs text-primary/80 truncate font-medium">▶ {activePlaylistName}</p>
                ) : (
                  <p className="text-[10px] sm:text-xs text-muted-foreground truncate">{currentSong?.artist || "ComunicaEDU Player"}</p>
                )}
                {nextSongInQueue && (
                  <p className="text-[9px] sm:text-[10px] text-muted-foreground/70 truncate">
                    A seguir: {nextSongInQueue.title}
                  </p>
                )}
              </div>
            )}
          </div>

          <div className="flex-1 flex flex-col items-center gap-0.5 sm:gap-1 w-full sm:w-auto">
            <div className="flex items-center gap-2.5 sm:gap-4">
              <button
                type="button"
                aria-label="Música anterior"
                title="Anterior (← ou J)"
                onClick={handlePrevious}
                className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors"
              >
                <SkipBack className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
              <button
                type="button"
                aria-label={isPlaying ? "Pausar" : "Reproduzir"}
                title={isPlaying ? "Pausar (Espaço)" : "Reproduzir (Espaço)"}
                onClick={handlePlayPause}
                className="w-12 h-12 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform"
              >
                {isPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5 ml-0.5" />}
              </button>
              <button
                type="button"
                aria-label="Próxima música"
                title="Próxima (→ ou L)"
                onClick={handleNext}
                disabled={queue.length === 0}
                className="w-10 h-10 rounded-full flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              >
                <SkipForward className="h-4 w-4 sm:h-5 sm:w-5" />
              </button>
              <button
                type="button"
                onClick={handleToggleRepeatSong}
                title={repeatSong ? "Repetir música: ativado" : "Repetir música: desativado"}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  repeatSong
                    ? "text-primary bg-primary/15 hover:bg-primary/25"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/60"
                }`}
              >
                <Repeat1 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setMicOpen(true)}
                title="Gravar voz"
                className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/15 transition-colors"
              >
                <Mic className="h-4 w-4" />
              </button>
            </div>
            <div className="w-full max-w-sm sm:max-w-md flex items-center gap-2">
              {/* Hide time labels when mood is active — show only progress indicator */}
              {!(activeMoodInfo && activePlaylistId?.startsWith("mood-")) && (
                <span className="text-xs text-muted-foreground w-8 text-right">
                  {isYouTubeMode
                    ? formatTime(ytPlayer.currentTime)
                    : audioRef.current ? formatTime(audioRef.current.currentTime) : "0:00"}
                </span>
              )}
              {activeMoodInfo && activePlaylistId?.startsWith("mood-") ? (
                <div className="flex-1 h-1 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary rounded-full animate-pulse"
                    style={{ width: `${isYouTubeMode ? ytPlayer.progress : progress}%` }}
                  />
                </div>
              ) : (
                <div
                  className="flex-1 h-1 bg-secondary rounded-full cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pct = (e.clientX - rect.left) / rect.width;
                    if (isYouTubeMode) {
                      ytPlayer.seek(pct);
                    } else if (audioRef.current?.duration) {
                      audioRef.current.currentTime = pct * audioRef.current.duration;
                    }
                  }}
                >
                  <div className="h-full bg-primary rounded-full transition-all" style={{ width: `${isYouTubeMode ? ytPlayer.progress : progress}%` }} />
                </div>
              )}
              {!(activeMoodInfo && activePlaylistId?.startsWith("mood-")) && (
                <span className="text-xs text-muted-foreground w-8">
                  {isYouTubeMode
                    ? formatTime(ytPlayer.duration)
                    : audioRef.current?.duration ? formatTime(audioRef.current.duration) : "0:00"}
                </span>
              )}
            </div>
          </div>

          <div className="hidden sm:flex items-center gap-2 w-36">
            <button type="button" onClick={handleMuteToggle} aria-label="Mutar/Desmutar" title="Mutar/Desmutar (M)" className="text-muted-foreground hover:text-foreground transition-colors shrink-0" suppressHydrationWarning>
              {isMuted || musicVolume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <Slider
              value={[Math.round(Math.sqrt(musicVolume) * 100)]}
              max={100}
              step={1}
              className="flex-1 [&_[role=slider]]:h-3 [&_[role=slider]]:w-3"
              onValueChange={(val) => {
                const pct = (val[0] ?? 0) / 100;
                handleMusicVolumeInput(pct * pct);
              }}
              onValueCommit={(val) => {
                const pct = (val[0] ?? 0) / 100;
                handleMusicVolumeInput(pct * pct);
              }}
              onKeyDown={(e) => {
                // Impede que setas do teclado sejam capturadas pelo slider
                // (evita conflito com scroll da página ao usar ↑ ↓)
                if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "PageUp", "PageDown"].includes(e.key)) {
                  e.preventDefault();
                }
              }}
            />
          </div>
        </div>

        {/* Voice Recorder Modal */}
        <VoiceRecorderModal
          isOpen={micOpen}
          onClose={() => setMicOpen(false)}
          onInsert={insertAudioIntoQueue}
          onPreviewStart={handlePause}
          onPreviewEnd={() => {}}
        />

        {/* Floating Mini Player */}
        {showMiniPlayer && (
          <div className="hidden sm:block">
            <FloatingMiniPlayer
              currentSong={currentSong}
              isPlaying={isPlaying}
              progress={progress}
              duration={audioRef.current?.duration || 0}
              currentTime={audioRef.current?.currentTime || 0}
              musicVolume={musicVolume}
              spotVolume={spotVolume}
              onPlayPause={handlePlayPause}
              onNext={handleNext}
              onPrevious={handlePrevious}
              onMusicVolumeChange={handleMusicVolumeInput}
              onSpotVolumeChange={setSpotVolume}
              onSeek={(pct) => {
                if (audioRef.current?.duration) {
                  audioRef.current.currentTime = pct * audioRef.current.duration;
                }
              }}
            />
          </div>
        )}
      </main>
    </div>
  );
}

const SidebarItem = ({
  icon, label, active, onClick,
}: {
  icon: React.ReactNode; label: string; active?: boolean; onClick?: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-primary/20 hover:text-primary"
    }`}
  >
    {icon}
    {label}
    {active && <ChevronRight className="h-3 w-3 ml-auto" />}
  </button>
);

export default function PlayerPage() {
  return (
    <Suspense>
      <PlayerPageContent />
    </Suspense>
  );
}
