"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { motion, AnimatePresence } from "framer-motion";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  Music, Radio, Mic, Bot, LogOut, Play, Pause, SkipForward, SkipBack,
  Volume2, VolumeX, Clock, ChevronRight, Menu, X, ShieldCheck, RotateCcw, Loader2,
  Smile, Frown, Heart, TrendingUp, Coffee, Repeat1, ExternalLink, Users, Wifi, WifiOff,
  SlidersHorizontal, Lock
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
import CompactLocutorVirtual from "@/components/player/CompactLocutorVirtual";
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
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { cacheAudioUrl, getCachedAudioUrl } from "@/lib/audioCache";
import { markSongPlayed, buildSmartQueue, initShuffleHistory } from "@/hooks/useSmartShuffle";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { usePlayerHistory } from "@/contexts/PlayerHistoryContext";
import {
  getSpotSettings,
  loadSpotSettings,
  fetchUserSpots,
  getCachedSpots,
  intercalateSpots,
  isSpotItem,
} from "@/lib/spotIntercalate";
import { loadSpotConfigs, fetchSpotConfigs, setCachedSpotConfigs } from "@/lib/spotConfig";
import VoiceRecorderModal, { type InsertMode } from "@/components/player/VoiceRecorderModal";
import { useKeyboardPlayer } from "@/hooks/useKeyboardPlayer";
import { usePlayerBroadcaster, type RemoteCommand } from "@/hooks/usePlayerBroadcast";
import { authedFetch } from "@/lib/authedFetch";
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
  if (section === "admin") return "dashboard";
  if (section === "programacao") return "extras";
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

// ── News helpers (module-level — sem acesso ao estado do componente) ──────────

function getNewsSettings(prefsCategories?: string[], prefsInterval?: number): { categories: string[]; interval: number } {
  return {
    categories: prefsCategories ?? [],
    interval: prefsInterval ?? 3,
  };
}

async function fetchNewsItems(categories: string[]): Promise<{ id: string; title: string; artist: string | null; genre: string | null; file_path: string; cover_url: string | null; created_at: string; youtube_video_id?: string | null }[]> {
  if (!categories.length) return [];
  try {
    const res = await authedFetch(`/api/news?categories=${categories.join(",")}`);
    if (!res.ok) return [];
    const { items } = await res.json();
    return items ?? [];
  } catch {
    return [];
  }
}

function PlayerPageContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { prefs, loaded: prefsLoaded, updatePref, updatePrefs } = useUserPreferences();

  // Impede flash de conteúdo SSR — player é 100% client-side
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    // Sincroniza logo do localStorage → avatar_url no perfil (signup público)
    // NÃO executa durante impersonação — evita gravar o logo do admin no perfil do cliente
    const pendingLogo = localStorage.getItem("user-logo");
    const isImpersonating = !!localStorage.getItem("edu-admin-return-session");
    if (pendingLogo && !isImpersonating) {
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (!user) return;
        supabase.from("profiles").select("avatar_url").eq("user_id", user.id).single().then(({ data: profile }) => {
          if (!profile?.avatar_url) {
            supabase.from("profiles").upsert({ user_id: user.id, avatar_url: pendingLogo }, { onConflict: "user_id" }).then(() => {
              // Limpa localStorage após sincronizar com o banco
              localStorage.removeItem("user-logo");
            });
          } else {
            // Já tem avatar no banco — limpa o pendente do localStorage
            localStorage.removeItem("user-logo");
          }
        });
      });
    }
    // Carrega spot settings + configs + lista de spots ao montar
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session?.access_token) return;
      const token = session.access_token;
      const [, configs] = await Promise.all([
        loadSpotSettings(token),
        fetchSpotConfigs(token),
        fetchUserSpots(token),
      ]);
      if (configs) setCachedSpotConfigs(configs);

      // Baixa notícias EBC silenciosamente em background se há categorias selecionadas
      const cats = prefs.boletins_categories ?? [];
      if (cats.length > 0) {
        fetch("/api/boletins", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ categories: cats }),
        }).catch(() => {});
      }
    });

    // Sincroniza playlists do YouTube e curadoria Gemini 1× por semana
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const lastSync = parseInt(localStorage.getItem("yt-playlist-sync-ts") ?? "0", 10);
    if (Date.now() - lastSync > WEEK_MS) {
      localStorage.setItem("yt-playlist-sync-ts", String(Date.now()));
      authedFetch("/api/admin/sync-playlists", { method: "POST" }).catch(() => {});
      authedFetch("/api/admin/gemini-curator", { method: "POST" }).catch(() => {});
    }
  }, []);

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
  const [musicVolume, setMusicVolume] = useState(0.7);
  const [previousVolume, setPreviousVolume] = useState(0.7);
  const [isMuted, setIsMuted] = useState(false);
  const [spotVolume, setSpotVolume] = useState(1.0);
  const [showMiniPlayer] = useState(true);
  const [micOpen, setMicOpen] = useState(false);
  const [locutorBarOpen, setLocutorBarOpen] = useState(false);
  const [playerBarLockedBadge, setPlayerBarLockedBadge] = useState(false);
  const playerBarLockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showPlayerBarLocked = () => {
    setPlayerBarLockedBadge(true);
    if (playerBarLockedTimer.current) clearTimeout(playerBarLockedTimer.current);
    playerBarLockedTimer.current = setTimeout(() => setPlayerBarLockedBadge(false), 3000);
  };
  const [isModoOff, setIsModoOff] = useState(false);
  const toggleModoOff = useCallback(() => {
    setIsModoOff((prev) => {
      const next = !prev;
      updatePref("offline_mode", next);
      return next;
    });
  }, []);
  const [broadcastUserId, setBroadcastUserId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [clockTime, setClockTime] = useState("");
  const [sidebarLockedHint, setSidebarLockedHint] = useState<{ x: number; y: number } | null>(null);
  const sidebarLockedHintTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setClockTime(now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  // userLogo só é relevante para o admin (logo do sistema criado no cadastro)
  // Nunca deve aparecer no perfil do cliente — cada um tem seu avatar via profiles.avatar_url
  const [userLogo] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    // Se está em impersonação ou logado como cliente, não carrega o logo do localStorage
    if (localStorage.getItem("edu-admin-return-session")) return null;
    return localStorage.getItem("user-logo");
  });

  // ── Impersonação: admin entrando no perfil de um cliente ──────────────
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [impersonatedUsername, setImpersonatedUsername] = useState<string | null>(null);

  useEffect(() => {
    const returnSession = localStorage.getItem("edu-admin-return-session");
    const username = localStorage.getItem("edu-impersonated-username");
    if (returnSession) {
      setIsImpersonating(true);
      setImpersonatedUsername(username);
    }
  }, []);

  const exitProfile = async () => {
    const raw = localStorage.getItem("edu-admin-return-session");
    if (!raw) return;
    try {
      const { access_token, refresh_token } = JSON.parse(raw);
      const { data, error } = await supabase.auth.setSession({ access_token, refresh_token });
      if (error || !data.session) {
        throw new Error(error?.message || "Falha ao restaurar sessão do admin");
      }
      localStorage.removeItem("edu-admin-return-session");
      localStorage.removeItem("edu-impersonated-username");
      window.location.href = "/player?section=admin&tab=clientes";
    } catch {
      // Fallback: desloga completamente e vai para o login
      await supabase.auth.signOut();
      localStorage.removeItem("edu-admin-return-session");
      localStorage.removeItem("edu-impersonated-username");
      window.location.href = "/login";
    }
  };
  // ─────────────────────────────────────────────────────────────────────
  // Avatar: inicia null (sem hydration mismatch), carrega do localStorage antes do primeiro paint
  const [userAvatar, setUserAvatar] = useState<string | null>(null);
  const [userAvatarStyle, setUserAvatarStyle] = useState<AvatarCoverStyle | null>(null);

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
  const { isSectionLocked, isSectionVisible, features, isFeatureLocked } = useClientFeatures();
  const { isAdmin, loading: isAdminLoading } = useIsAdmin();
  const { isLoading: userLoading } = useCurrentUser();
  const audioRef = useRef<HTMLAudioElement>(null);
  const lastGoNextTimeRef = useRef<number>(0);
  const queueRef = useRef<{ queue: Song[]; queueIndex: number; activePlaylistId: string | null }>({ queue: [], queueIndex: 0, activePlaylistId: null });
  const { claimAudioFocus, releaseAudioFocus } = useAudioFocus();
  const ytPlayer = useYouTubePlayer();
  const {
    playByVideoId: playYouTubeByVideoId,
    loadNext: loadYouTubeNext,
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
  const prefetchedBlobsRef = useRef<Map<string, string>>(new Map());
  const prefetchingSetRef  = useRef<Set<string>>(new Set());
  const nextSongUrlRef     = useRef<string | null>(null);
  const onEndedSwappedRef  = useRef(false);
  // Ref compartilhada para o Web Worker (keepalive + timer preciso de fim de música)
  const audioWorkerRef     = useRef<Worker | null>(null);
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
  // Scheduled spots: tracks which spot+scheduleStart combos have already been inserted
  // so they don't repeat within the same session.
  const scheduledSpotPlayedRef = useRef<Set<string>>(new Set());
  // Pending locutor virtual audios scheduled by clock time
  const pendingLocutorRef = useRef<Array<{ filePath: string; title: string; targetTime: number }>>([]);

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

  // ── Sync preferences from Supabase → local state (runs once when prefs load) ──
  const prefsSyncedRef = useRef(false);
  useEffect(() => {
    if (!prefsLoaded || prefsSyncedRef.current) return;
    prefsSyncedRef.current = true;

    // Aplica valores do Supabase nos states locais
    const pc = prefs.player_controls as Record<string, unknown> ?? {};
    if (typeof pc.musicVolume === "number") setMusicVolume(pc.musicVolume);
    if (typeof pc.previousVolume === "number") setPreviousVolume(pc.previousVolume);
    if (typeof pc.isMuted === "boolean") setIsMuted(pc.isMuted);
    if (typeof pc.spotVolume === "number") setSpotVolume(pc.spotVolume);

    if (prefs.offline_mode !== undefined) setIsModoOff(prefs.offline_mode);

    // Initialize smart shuffle with prefs-backed history
    initShuffleHistory(prefs.shuffle_history ?? [], (history) => {
      updatePref("shuffle_history", history);
    });

    // Avatar styles
    if (prefs.avatar_styles && Object.keys(prefs.avatar_styles).length) {
      // Aplica via state do componente
      const userId = prefs.user_id;
      if (userId && prefs.avatar_styles[userId]) {
        setUserAvatarStyle(prefs.avatar_styles[userId] as unknown as AvatarCoverStyle);
      }
    }
  }, [prefsLoaded, prefs]);

  // ── Persist active section → Supabase ──
  useEffect(() => {
    updatePrefs({ last_section: activeSection, last_section_ts: Date.now() });
  }, [activeSection, updatePrefs]);


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
    authedFetch("/api/playlists")
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

  const BLOCKED_AVATAR_DOMAINS = ["lovable.dev", "gptengineer", "lovable.app", "gpteng.co", "ytimg.com", "yt3.ggpht.com", "youtube.com/"];

  const applyFreshAvatar = useCallback((avatarUrl: string, userId?: string | null, persist = true) => {
    // Never apply avatar URLs from Lovable/GPT-Engineer
    if (BLOCKED_AVATAR_DOMAINS.some((d) => avatarUrl.includes(d))) {
      setUserAvatar(null);
      return;
    }

    const baseUrl = avatarUrl.split("?")[0];
    if (!baseUrl) return;

    // URL direta sem timestamp — mesma lógica do código antigo (sem cache-bust complexo)
    setUserAvatar(baseUrl);

    // Atualiza cache do servidor apenas quando NÃO está em impersonação
    // (o cache serve para a tela do ouvinte sem login — deve refletir o avatar do admin)
    if (!persist) return;
    const isImpersonating = !!localStorage.getItem("edu-admin-return-session");
    if (!isImpersonating) {
      authedFetch("/api/owner-avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: baseUrl }),
      }).catch(() => {});
    }
  }, []);

  const syncAvatarToCloud = useCallback((avatarUrl: string, userId?: string | null) => {
    const baseUrl = avatarUrl.split("?")[0];
    if (baseUrl.startsWith("data:")) return;
    void supabase.functions.invoke("admin-clients?action=avatar-set", {
      body: { avatar_url: baseUrl, user_id: userId || null },
    });
  }, []);

  // ── Load user avatar — lógica simples: busca direto do banco pelo ID do usuário logado ──
  const loadAvatar = useCallback(async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      // Sem sessão (tela do ouvinte): busca avatar via cache do servidor
      try {
        const res = await authedFetch("/api/owner-avatar");
        const json = await res.json();
        if (json?.avatar_url && !BLOCKED_AVATAR_DOMAINS.some((d) => json.avatar_url.includes(d))) {
          setUserAvatar(json.avatar_url);
        }
      } catch { /* silencioso */ }
      return;
    }

    setBroadcastUserId(user.id);

    // Carrega estilo do avatar — será aplicado pelo useEffect de sync de prefs
    if (prefs.avatar_styles?.[user.id]) {
      setUserAvatarStyle(prefs.avatar_styles[user.id] as unknown as AvatarCoverStyle);
    }

    // Busca avatar direto do banco pelo ID do usuário logado
    // Funciona corretamente durante impersonação: se o admin virou o cliente,
    // user.id é o ID do cliente e o avatar do cliente é carregado automaticamente.
    const { data: profile } = await supabase
      .from("profiles")
      .select("avatar_url")
      .eq("user_id", user.id)
      .single();

    if (profile?.avatar_url && !BLOCKED_AVATAR_DOMAINS.some((d) => profile.avatar_url.includes(d))) {
      // Valida que o avatar pertence a ESTE usuário:
      // - Se é URL do storage (/avatars/), deve conter o user.id deste usuário
      // - Se é data:, pode ser contaminação do localStorage — rejeita para clientes não-admin
      const url = profile.avatar_url;
      const isStorageUrl = url.includes("/avatars/");
      const belongsToUser = !isStorageUrl || url.includes(user.id);
      const isDataUrl = url.startsWith("data:");

      // Verifica se é admin para decidir se data: URLs são válidas
      const { data: roleRow } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "admin")
        .maybeSingle();
      const userIsAdmin = !!roleRow;

      if (isDataUrl && !userIsAdmin) {
        // Data URL no perfil de cliente = contaminação do localStorage do admin → limpa
        setUserAvatar(null);
        supabase.from("profiles").update({ avatar_url: null }).eq("user_id", user.id);
      } else if (isStorageUrl && !belongsToUser) {
        // URL de storage de outro usuário = contaminação → limpa
        setUserAvatar(null);
        supabase.from("profiles").update({ avatar_url: null }).eq("user_id", user.id);
      } else {
        setUserAvatar(url);
      }
    } else {
      // Usuário logado sem avatar no banco — mostra null (sem avatar)
      setUserAvatar(null);
    }
  }, []);

  // Atualiza last_seen quando o player abre
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from("profiles").update({ last_seen: new Date().toISOString() }).eq("user_id", user.id);
      }
    });
  }, []);

  useEffect(() => {
    loadAvatar();

    const onAvatarUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<{ avatarUrl?: string; userId?: string; avatarStyle?: AvatarCoverStyle | null }>;
      const avatarUrl = customEvent.detail?.avatarUrl;
      const avatarStyle = customEvent.detail?.avatarStyle;
      const userId = customEvent.detail?.userId;

      if (avatarUrl) {
        applyFreshAvatar(avatarUrl, userId);
        // Nunca sincroniza com o banco durante impersonação — preserva avatar do admin
        if (!localStorage.getItem("edu-admin-return-session")) {
          syncAvatarToCloud(avatarUrl, userId);
        }
      }

      if (avatarStyle) {
        setUserAvatarStyle(avatarStyle);
        // Salva no Supabase
        if (userId) {
          updatePref("avatar_styles", { ...prefs.avatar_styles, [userId]: avatarStyle });
        }
      } else if (userId && prefs.avatar_styles?.[userId]) {
        setUserAvatarStyle(prefs.avatar_styles[userId] as unknown as AvatarCoverStyle);
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

  // Reload avatar when auth state changes (login/logout/user switch)
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        loadAvatar();
      } else if (event === "SIGNED_OUT") {
        setUserAvatar(null);
        setUserAvatarStyle(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [loadAvatar]);

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
      // Tenta do Supabase (prefs.player_state), senão do localStorage (migração)
      const state = (prefs.player_state && Object.keys(prefs.player_state).length)
        ? prefs.player_state
        : JSON.parse(localStorage.getItem(PLAYER_STATE_KEY) || "null");
      if (!state) return;

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
      updatePref("player_state", {});
    }
  }, [cascade, claimAudioFocus, forceLocalNormalizerSync, getPersistedMusicVolume, playYouTubeByVideoId]);

  // ── Save player state continuously (debounced every 5s) → Supabase ──
  useEffect(() => {
    if (!currentSong) return;

    const interval = setInterval(() => {
      const position = audioRef.current?.currentTime ?? 0;
      updatePref("player_state", {
        queue: queueRef.current.queue.slice(0, 200),
        queueIndex: queueRef.current.queueIndex,
        playlistId: queueRef.current.activePlaylistId,
        currentSong,
        position,
        timestamp: Date.now(),
      });
    }, 5000);

    return () => clearInterval(interval);
  }, [currentSong, updatePref]);

  // ── Save audio controls (volume, mute, spotVolume) → Supabase ──
  useEffect(() => {
    const timer = setTimeout(() => {
      updatePref("player_controls", { musicVolume, previousVolume, isMuted, spotVolume });
    }, 500);
    return () => clearTimeout(timer);
  }, [musicVolume, previousVolume, isMuted, spotVolume, updatePref]);

  // ── Save player state on page unload ──
  useEffect(() => {
    const saveOnUnload = () => {
      if (!currentSongRef.current) return;
      const position = audioRef.current?.currentTime ?? 0;
      updatePref("player_state", {
        queue: queueRef.current.queue.slice(0, 200),
        queueIndex: queueRef.current.queueIndex,
        playlistId: queueRef.current.activePlaylistId,
        currentSong: currentSongRef.current,
        position,
        timestamp: Date.now(),
      });
    };
    window.addEventListener("beforeunload", saveOnUnload);
    return () => window.removeEventListener("beforeunload", saveOnUnload);
  }, [updatePref]);

  // ── Persist session state (for internal use during active session only) ──
  const saveSession = useCallback((songs: Song[], idx: number, plId: string | null) => {
    updatePref("player_state", {
      queue: songs.slice(0, 200),
      queueIndex: idx,
      playlistId: plId,
      timestamp: Date.now(),
    });
  }, [updatePref]);

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
   * Cria um novo HTMLAudioElement para cada música — mesma lógica do código antigo
  /**
   * Unified cascade play — generation-safe async.
   * NOT wrapped in useCallback intentionally: making it a useCallback creates
   * a circular dependency chain (handlePlayCascade → skipToNextAvailable →
   * handlePlayCascade) that causes infinite re-render loops. The generation
   * counter is what prevents stale async operations, not React memoization.
   */
  const handlePlayCascade = async (song: Song, navDirection?: "back" | "forward" | "skip") => {
    const generation = ++playGenerationRef.current;
    manuallyPausedRef.current = false;
    nextSongUrlRef.current = null;

    const alreadyPlaying = onEndedSwappedRef.current;
    onEndedSwappedRef.current = false;

    intentionalSrcChangeRef.current = true;
    if (!alreadyPlaying && audioRef.current) audioRef.current.pause();
    if (isYouTubeModeRef.current) ytPlayer.stop();

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

        if (alreadyPlaying) {
          intentionalSrcChangeRef.current = false;
          forceLocalNormalizerSync();
        } else {
          intentionalSrcChangeRef.current = true;
          audio.src = finalUrl;
          audio.load();
          intentionalSrcChangeRef.current = false;
          if (generation !== playGenerationRef.current) return;
          audio.play().catch(() => {});
          forceLocalNormalizerSync();
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
        // loadYouTubeNext reutiliza o IFrame existente (loadVideoById) em vez de destruir e recriar.
        // Funciona em background porque é apenas um postMessage ao IFrame já ativo.
        await loadYouTubeNext(vid, scheduledVolumeLockRef.current ? clampVolume(musicVolumeRef.current) : getPersistedMusicVolume());
        if (generation !== playGenerationRef.current) return;
        ytQuotaExhausted.current = false;
        consecutiveYtErrorsRef.current = 0;
        consecutiveSkipsRef.current = 0;
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

    // ── Scheduled spots: insert at nearest song boundary ──────────────────────
    // At each song transition, check if any spot has a scheduleStart whose target
    // time falls within [T - 6min, T + 5min] of now. If so, insert it next in
    // the queue (before the upcoming regular song) and mark it as played.
    {
      const now          = Date.now();
      const LOOKAHEAD_MS = 60 * 1000; // up to 1 min before scheduled time
      const GRACE_MS     = 60 * 1000; // up to 1 min after scheduled time
      const configs   = loadSpotConfigs();
      const allSpots  = getCachedSpots();

      for (const track of allSpots) {
        const cfg = configs[track.id];
        if (!cfg?.scheduleStart || !cfg.enabled) continue;

        const target     = new Date(cfg.scheduleStart).getTime();
        const windowStart = target - LOOKAHEAD_MS;
        const windowEnd   = target + GRACE_MS;
        if (now < windowStart || now > windowEnd) continue;

        const key = `${track.id}_${cfg.scheduleStart}`;
        if (scheduledSpotPlayedRef.current.has(key)) continue;

        scheduledSpotPlayedRef.current.add(key);

        const spotSong: Song = {
          id: `scheduled-${track.id}-${Date.now()}`,
          title: track.title,
          artist: null,
          genre: "spot",
          file_path: track.file_path,
          cover_url: track.cover_url ?? null,
          created_at: track.created_at,
        };
        const insertIdx = qi + 1;
        const newQueue = [
          ...currentQueue.slice(0, insertIdx),
          spotSong,
          ...currentQueue.slice(insertIdx),
        ];
        setQueue(newQueue);
        queueRef.current = { ...queueRef.current, queue: newQueue };
        break; // one spot per transition
      }

      // ── Pending Locutor Virtual audios ────────────────────────────────────
      if (pendingLocutorRef.current.length > 0) {
        const idx = pendingLocutorRef.current.findIndex(
          (p) => now >= p.targetTime - LOOKAHEAD_MS && now <= p.targetTime + GRACE_MS
        );
        if (idx !== -1) {
          const pending = pendingLocutorRef.current.splice(idx, 1)[0];
          const locutorSong: Song = {
            id: `locutor-sched-${Date.now()}`,
            title: pending.title,
            artist: null,
            genre: "recording",
            file_path: pending.filePath,
            cover_url: null,
            created_at: new Date().toISOString(),
          };
          const insertIdx2 = qi + 1;
          const newQueue2 = [
            ...currentQueue.slice(0, insertIdx2),
            locutorSong,
            ...currentQueue.slice(insertIdx2),
          ];
          setQueue(newQueue2);
          queueRef.current = { ...queueRef.current, queue: newQueue2 };
        }
      }
    }
    // ─────────────────────────────────────────────────────────────────────────

    // Re-read from ref so that a spot inserted above is picked up immediately
    let queueToUse = queueRef.current.queue;
    let nextIdx = qi + 1;

    if (nextIdx >= queueToUse.length) {
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
  // setQueue is stable (useState setter) — safe to add.
  }, [releaseAudioFocus, reshuffleCurrentQueue, saveSession, setQueue]);

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
    const rebuild = async (e?: Event) => {
      const { queue: currentQueue, queueIndex: qi, activePlaylistId: pid } = queueRef.current;
      if (!currentQueue.length || !pid) return;
      // Strip existing spots AND news from queue, then re-intercalate with new settings
      const songsOnly = currentQueue.filter((s) => s.genre !== "spot" && s.genre !== "news");
      const spotCfg = getSpotSettings();
      // Usa categorias do evento se disponível (evita ler prefs desatualizado)
      const eventCategories = (e as CustomEvent)?.detail?.newsCategories;
      const cats = eventCategories ?? prefs.boletins_categories ?? [];
      const newsCfg = getNewsSettings(cats, prefs.news_interval);
      const newsItems = await fetchNewsItems(newsCfg.categories);

      let rebuilt: Song[];
      if (spotCfg.enabled && spotCfg.interval > 0) {
        const spotTracks = await fetchUserSpots();
        rebuilt = intercalateSpots(
          songsOnly, spotTracks as Song[], spotCfg.interval, loadSpotConfigs(),
          newsItems as Song[], newsCfg.interval,
        );
      } else if (newsItems.length > 0 && newsCfg.interval > 0) {
        rebuilt = intercalateSpots(songsOnly, [] as Song[], 0, {}, newsItems as Song[], newsCfg.interval);
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
    window.addEventListener("spot-configs-changed", rebuild);
    return () => {
      window.removeEventListener("spot-settings-changed", rebuild);
      window.removeEventListener("spots-updated", rebuild);
      window.removeEventListener("spot-configs-changed", rebuild);
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
            updatePref("player_state", {});
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
        const plRes = await authedFetch("/api/playlists");
        const plData = await plRes.json();
        const allPlaylists = (plData.playlists ?? []).filter((p: any) => p.id !== deletedPlaylistId);

        if (allPlaylists.length > 0) {
          const nextPlaylistId = allPlaylists[0].id;
          const psRes = await authedFetch(`/api/playlist-songs?playlist_id=${nextPlaylistId}`);
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
      releaseAudioFocus(); updatePref("player_state", {});
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
      if (isYouTubeModeRef.current) return;
      let nextUrl = nextSongUrlRef.current;
      // Fallback: resolve URL sincronamente se não foi pre-carregada
      if (!nextUrl && !repeatSongRef.current) {
        const { queue: q, queueIndex: qi } = queueRef.current;
        const ns = q[qi + 1];
        if (ns?.file_path && !ns.file_path.startsWith("youtube:") && !ns.file_path.startsWith("imported/")) {
          const fp = ns.file_path;
          nextUrl = fp.startsWith("/uploads/") || fp.startsWith("http") ? fp : cascade.getStorageUrl(fp);
        }
      }
      if (nextUrl && !repeatSongRef.current) {
        intentionalSrcChangeRef.current = true;
        audio.src = nextUrl;
        // Se os dados já estão em cache (via link rel=preload ou SW), load() é instantâneo.
        // Mantemos load() para garantir que o browser inicie o fetch caso cache falhe.
        audio.load();
        intentionalSrcChangeRef.current = false;
        audio.play().catch((err) => {
          // Log para diagnóstico de erro de play em background
          console.warn("[onEnded] play() rejeitado:", err?.name, err?.message);
        });
        onEndedSwappedRef.current = true;
      }
      lastGoNextTimeRef.current = Date.now();
      goNextInQueueRef.current?.();
    };

    const nextPreloadedRef = { songId: "" };
    const onTimeUpdate = () => {
      if (audio.duration <= 0 || isYouTubeModeRef.current) return;
      const remaining = audio.duration - audio.currentTime;
      // Começa preload 30s antes do fim (em foreground) para garantir buffer completo
      // antes do tab ir para background. Antes era 2s — insuficiente para rede lenta.
      if (remaining > 30) return;
      const { queue: q, queueIndex: qi } = queueRef.current;
      const nextSong = q[qi + 1];
      if (!nextSong || nextSong.id === nextPreloadedRef.songId) return;
      nextPreloadedRef.songId = nextSong.id;
      const fp = nextSong.file_path;
      if (!fp || fp.startsWith("youtube:") || fp.startsWith("imported/")) return;
      // Resolve URL para QUALQUER tipo de path local, incluindo chaves do Supabase Storage
      const url = fp.startsWith("/uploads/") || fp.startsWith("http")
        ? fp
        : cascade.getStorageUrl(fp);
      if (!url) return;
      nextSongUrlRef.current = url;
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

    const onPlay = () => {
      setIsPlaying(true);
      applyPersistedVolume();
      forceLocalNormalizerSync();

      // Pre-carrega a próxima música ASSIM QUE a atual começa, enquanto ainda em foreground.
      // Usa <link rel="preload"> — alta prioridade e compartilha cache HTTP com <audio>.
      // Quando onEnded chamar audio.src = nextUrl, o browser usa o cache → toca imediatamente
      // mesmo em background (sem precisar de rede = sem de-priorização do Chrome).
      if (!isYouTubeModeRef.current) {
        const { queue: q, queueIndex: qi } = queueRef.current;
        const ns = q[qi + 1];
        if (ns?.file_path && !ns.file_path.startsWith("youtube:") && !ns.file_path.startsWith("imported/")) {
          const fp = ns.file_path;
          const url = fp.startsWith("/uploads/") || fp.startsWith("http")
            ? fp
            : cascade.getStorageUrl(fp);
          if (url && url !== nextSongUrlRef.current) {
            nextSongUrlRef.current = url;
            // Preload via link element (mais confiável que new Audio() para cache compartilhado)
            const existing = document.querySelector(`link[data-preload-audio]`);
            if (existing) existing.remove();
            const link = document.createElement("link");
            link.rel = "preload";
            link.as = "audio";
            link.href = url;
            link.setAttribute("data-preload-audio", "1");
            document.head.appendChild(link);
          }
        }
      }
    };

    const onPause = () => {
      if (!isTransitioningRef.current) {
        if (manuallyPausedRef.current || intentionalSrcChangeRef.current) {
          if (manuallyPausedRef.current) setIsPlaying(false);
        } else {
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

    let errorHandled = false;
    const onError = () => {
      if (errorHandled) return;
      if (isTransitioningRef.current) return;
      if (intentionalSrcChangeRef.current) return;
      if (!audio.src || audio.src === window.location.href) return;
      errorHandled = true;
      window.setTimeout(() => {
        if (intentionalSrcChangeRef.current) return;
        if (!audio.src || audio.src === window.location.href) return;
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
  }, [clampVolume, forceLocalNormalizerSync, getPersistedMusicVolume, setNormalizerVolume, setYouTubeVolume]);

  // Keepalive: garante que o áudio nunca pare enquanto o usuário não pausou manualmente.
  // Usa Web Worker (audio-worker.js) em vez de window.setInterval porque o Chrome
  // throttle timers da aba principal para ≥1s em background — timers de Web Worker
  // NUNCA são throttled, garantindo keepalive confiável com aba minimizada.
  const isPlayingLiveRef = useRef(false);
  useEffect(() => { isPlayingLiveRef.current = isPlaying; }, [isPlaying]);

  // Refs estáveis para o callback do worker (evita recriar o worker a cada render)
  const forceLocalNormalizerSyncRef = useRef(forceLocalNormalizerSync);
  useEffect(() => { forceLocalNormalizerSyncRef.current = forceLocalNormalizerSync; }, [forceLocalNormalizerSync]);
  const ytPlayerRef = useRef(ytPlayer);
  useEffect(() => { ytPlayerRef.current = ytPlayer; }, [ytPlayer]);

  useEffect(() => {
    const runKeepalive = () => {
      if (manuallyPausedRef.current || !currentSongRef.current) return;

      if (isYouTubeModeRef.current) {
        ytPlayerRef.current.play();
      } else {
        const audio = audioRef.current;
        if (audio && audio.src) {
          // Polling de fim de música — onEnded pode não disparar em abas minimizadas
          if (audio.ended) {
            if (Date.now() - lastGoNextTimeRef.current > 5000) {
              lastGoNextTimeRef.current = Date.now();
              goNextInQueueRef.current?.();
            }
            return;
          }
          // Reinicia se pausou sem ser intencional
          // intentionalSrcChangeRef = true quando cascade está resolvendo → não interferir
          if (audio.paused && !audio.ended && !intentionalSrcChangeRef.current) {
            audio.play().catch(() => undefined);
            forceLocalNormalizerSyncRef.current();
          }
        }
      }

      if ("mediaSession" in navigator) {
        navigator.mediaSession.playbackState = "playing";
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
    };

    // Web Worker: timers nunca throttled pelo Chrome em background
    let worker: Worker | null = null;
    let intervalId: number | null = null;

    try {
      worker = new Worker("/audio-worker.js");
      audioWorkerRef.current = worker;
      worker.onmessage = (e) => {
        if (e.data?.type === "tick") runKeepalive();
      };
      worker.onerror = () => {
        worker = null;
        audioWorkerRef.current = null;
        intervalId = window.setInterval(runKeepalive, 2000);
      };
      worker.postMessage({ type: "start", interval: 2000 });
    } catch {
      intervalId = window.setInterval(runKeepalive, 2000);
    }

    return () => {
      if (worker) {
        worker.postMessage({ type: "stop" });
        worker.terminate();
        audioWorkerRef.current = null;
      }
      if (intervalId !== null) clearInterval(intervalId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

      // Erro 100 = vídeo não existe | 101/150 = bloqueado pelo dono
      // → deleta do banco silenciosamente
      const fatalCodes = [100, 101, 150];
      if (fatalCodes.includes(ytPlayer.errorCode ?? -1)) {
        const song = queueRef.current.queue[queueRef.current.queueIndex];
        if (song?.id) {
          authedFetch("/api/songs", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: song.id }),
          }).catch(() => {});
        }
        consecutiveYtErrorsRef.current = 0;
      }

      if (consecutiveYtErrorsRef.current > 5) {
        consecutiveYtErrorsRef.current = 0;
        console.warn("[YT] Muitas falhas consecutivas — avançando para próxima playlist.");
        window.dispatchEvent(new CustomEvent("playlist-ended"));
        return;
      }

      skipToNextAvailableRef.current?.(queueRef.current.queueIndex);
    }
  }, [isYouTubeMode, ytPlayer.errorTick, ytPlayer.errorCode]);

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
    // Reseta o contador de skips para não carregar falhas da playlist anterior
    consecutiveSkipsRef.current = 0;

    // Remove spots, duplicatas e músicas sem file_path ou com marcador "pending" explícito.
    const seen = new Set<string>();
    const baseSongs = songs.filter(s => {
      if (s.genre === "spot") return false;
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      const fp = s.file_path ?? "";
      if (!fp || fp === "pending" || fp === "youtube:pending") return false;
      return true;
    });

    // Intercala spots e notícias — aguarda o fetch se o cache estiver vazio
    const spotCfg = getSpotSettings();
    const newsCfg = getNewsSettings(prefs.boletins_categories, prefs.news_interval);
    const newsItems = await fetchNewsItems(newsCfg.categories);
    let deduped: Song[];
    if (spotCfg.enabled && spotCfg.interval > 0) {
      let spotTracks = getCachedSpots();
      if (!spotTracks.length) spotTracks = await fetchUserSpots();
      deduped = spotTracks.length > 0
        ? intercalateSpots(baseSongs, spotTracks as Song[], spotCfg.interval, loadSpotConfigs(), newsItems, newsCfg.interval)
        : intercalateSpots(baseSongs, [] as Song[], 0, {}, newsItems as Song[], newsCfg.interval);
    } else if (newsItems.length > 0 && newsCfg.interval > 0) {
      deduped = intercalateSpots(baseSongs, [] as Song[], 0, {}, newsItems as Song[], newsCfg.interval);
    } else {
      deduped = baseSongs;
    }

    const adjustedIndex = Math.min(currentIndex, deduped.length - 1);

    setQueue(deduped);
    setQueueIndex(adjustedIndex);
    const plId = playlistId || activePlaylistId;
    if (playlistId) setActivePlaylistId(playlistId);
    if (playlistId && !playlistId.startsWith("mood-")) {
      setActiveMoodInfo(null);
    }
    playerHistory.clearForward();
    queueRef.current = { queue: deduped, queueIndex: adjustedIndex, activePlaylistId: plId };
    saveSession(deduped, adjustedIndex, plId);
    preAnalyzeNext(deduped, adjustedIndex - 1);
    preAnalyzeNext(deduped, adjustedIndex);
  }, [activePlaylistId, preAnalyzeNext, saveSession, playerHistory]);

  /** Insert a voice recording or TTS audio into the player queue */
  const insertAudioIntoQueue = useCallback((directFilePath: string, mode: InsertMode, title: string, scheduledTime?: string) => {
    // Time-scheduled: store for clock-based insertion in goNextInQueue
    if (mode === "scheduled" && scheduledTime) {
      const targetTime = new Date(scheduledTime).getTime();
      if (!isNaN(targetTime)) {
        pendingLocutorRef.current.push({ filePath: directFilePath, title, targetTime });
      }
      return;
    }
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
      // "scheduled" — same boundary logic as spots: insert right after current song
      // so it plays at the next song transition, never mid-music.
      const newQueue = [...q.slice(0, qi + 1), newSong, ...q.slice(qi + 1)];
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
    { id: "spots", icon: <Mic className="h-4 w-4" />, label: "Spots" },
    { id: "programacao", icon: <Clock className="h-4 w-4" />, label: "Programação" },
    { id: "admin", icon: <ShieldCheck className="h-4 w-4" />, label: "Administração" },
  ];

  // Administração só visível para admins reais (não clientes, não impersonação)
  // Enquanto isAdminLoading=true, mantém o item para não piscar/sumir antes de confirmar
  const sidebarItems = allSidebarItems.filter((item) => {
    if (item.id === "admin") return !isImpersonating && (isAdminLoading || isAdmin);
    return true;
  });
  const sectionTitles: Record<string, string> = {
    musicas: "Biblioteca Musical",
    locutor: "Locutor Virtual",
    spots: "Spots",
    programacao: "Programação",
    admin: "Painel de Administração",
  };

  useEffect(() => {
    const s = searchParams.get("section");
    if (s && PLAYER_SECTIONS.has(s)) {
      // Bloqueia acesso à seção admin para não-admins
      if (s === "admin" && !isAdminLoading && !isAdmin) {
        setActiveSection("musicas");
        window.history.replaceState(null, "", "/player?section=musicas");
        return;
      }
      setActiveSection((prev) => prev === s ? prev : s);
    }
  }, [searchParams, isAdmin, isAdminLoading, features]);

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
            {userLogo && isAdmin && !isImpersonating ? (
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
              onMouseEnter={item.id === "admin" ? () => { import("@/components/admin/AdminPanel"); } : undefined}
            />
          ))}
        </nav>


        <div className="p-3 space-y-2">
          {isImpersonating && (
            <div className="rounded-lg bg-yellow-500/15 border border-yellow-500/30 px-3 py-2 text-xs text-yellow-400 text-center">
              Perfil de <span className="font-bold">{impersonatedUsername}</span>
            </div>
          )}
          <Button
            className={`w-full justify-start active:scale-95 transition-all ${isImpersonating ? "bg-yellow-500 text-black hover:bg-yellow-400" : "bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)]"}`}
            onClick={async () => {
              if (isImpersonating) {
                await exitProfile();
              } else {
                await supabase.auth.signOut();
                router.replace("/login");
              }
            }}
          >
            <LogOut className="h-4 w-4 mr-2" />
            {isImpersonating ? "Sair do Perfil" : "Sair"}
          </Button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="shrink-0 h-24 flex items-center px-4 sm:px-6 justify-between gap-2 bg-background">
          <div className="flex items-center gap-3">
            <button type="button" aria-label="Abrir menu" title="Abrir menu" className="lg:hidden text-muted-foreground p-2 -m-2" onClick={() => setMobileMenuOpen(true)}>
              <Menu className="h-6 w-6" />
            </button>
            <h2 className="text-xl sm:text-2xl font-bold truncate text-white">
              {sectionTitles[activeSection] || ""}
            </h2>
          </div>
          <div className="flex items-center gap-3 h-full py-2">
            {userLogo && isAdmin && !isImpersonating && (
              <div className="flex items-center gap-2 h-full">
                <img src={userLogo} alt="Logo do cliente" className="h-full w-24 object-contain bg-white rounded-md" />
                <button onClick={resetTheme} title="Restaurar tema original" className="text-muted-foreground hover:text-foreground transition-colors">
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>
            )}
            {userLoading ? null : userAvatar ? (
              <div className="w-20 h-20 rounded-full overflow-hidden shrink-0 -translate-x-[15%] translate-y-[10%]">
                <img
                  src={userAvatar}
                  alt="Logo da empresa"
                  className="w-full h-full object-cover select-none"
                  style={{
                    transform: userAvatarStyle
                      ? `translate(${userAvatarStyle.x}px, ${userAvatarStyle.y}px) scale(${userAvatarStyle.zoom})`
                      : "scale(1.1)",
                    transition: "transform 0.3s ease",
                  }}
                />
              </div>
            ) : (!isAdmin && !isAdminLoading && (
              <span className="text-xs text-primary bg-primary/10 px-3 py-1 rounded-full font-medium whitespace-nowrap">
                🎁 Acesso Grátis
              </span>
            ))}
          </div>
        </header>

        <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none">
        <div className="p-4 pb-28 sm:p-6 sm:pb-6">
          <div>
          {activeSection === "admin" && isAdmin && !isImpersonating && (
            <AdminPanel />
          )}

          {activeSection === "musicas" && (
            <MusicHub
              currentSong={currentSong} isPlaying={isPlaying}
              isCreateLocked={isFeatureLocked("criar_playlists")}
              isImportLocked={isFeatureLocked("importar_playlists") || isFeatureLocked("enviar_musicas")}
              onPlay={handlePlayWithNotify} onPause={handlePause}
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
            <ProgramacaoPanel />
          )}

          {activeSection === "locutor" && (
            <LocutorVirtualPanel onInsert={insertAudioIntoQueue} onPreviewStart={handlePause} isLocked={isSectionLocked("locutor")} isAdmin={isAdmin && !isImpersonating} />
          )}

          {activeSection === "spots" && (
            <SpotsPanel
              userId={broadcastUserId}
              isAdmin={isAdmin && !isImpersonating}
              isLocked={isSectionLocked("spots")}
              isUploadLocked={isFeatureLocked("enviar_spots")}
              onPlaySpot={(s) => {
                if (s.id === "__stop__") { handlePause(); return; }
                handlePlay({ ...s, artist: null, cover_url: null, created_at: new Date().toISOString() });
              }}
            />
          )}

          </div>
        </div>
        </div>

        {/* Player bar */}
        <div className="shrink-0 bg-card flex flex-col sm:flex-row items-center px-4 sm:px-6 py-1.5 sm:py-3 gap-1.5 sm:gap-4 safe-area-bottom relative">
          {/* Badge elegante de recurso bloqueado — player bar */}
          <div className={`absolute -top-8 left-1/2 -translate-x-1/2 z-50 pointer-events-none transition-all duration-300 ${playerBarLockedBadge ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`}>
            <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
              <Lock className="h-3 w-3 text-primary shrink-0" />
              <p className="text-xs font-medium text-foreground">Atualize seu plano para usar esse recurso.</p>
            </div>
          </div>
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
                {currentSong?.genre === "news" ? (
                  <p className="text-[10px] sm:text-xs text-primary/80 truncate font-medium">▶ Notícia</p>
                ) : activePlaylistName ? (
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
            <div className="flex items-center gap-2 sm:gap-3">
              {/* 🕐 relógio — ligar/desligar por hora/dia */}
              <button type="button" title="Programar horário de ligar/desligar"
                onClick={() => isFeatureLocked("programar_play") && showPlayerBarLocked()}
                className="hidden sm:flex w-7 h-7 items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/15 rounded-full transition-colors">
                <Clock className="h-3.5 w-3.5" />
              </button>

              {/* ⊟ nivelar spots/música */}
              <button type="button" title="Nivelar Spots / Música"
                onClick={() => isFeatureLocked("spots_profissionais") && showPlayerBarLocked()}
                className="hidden sm:flex w-7 h-7 items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/15 rounded-full transition-colors">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>

              {/* ── Esquerda do transport ── */}
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

              {/* ── Transport ── */}
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

              {/* ── Direita do transport ── */}
              <button
                type="button"
                onClick={() => isFeatureLocked("locutor_ao_vivo") ? showPlayerBarLocked() : setMicOpen(true)}
                title="Gravar voz"
                className="w-7 h-7 rounded-full flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-primary/15 transition-colors"
              >
                <Mic className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => isFeatureLocked("modo_offline") ? showPlayerBarLocked() : toggleModoOff()}
                title={isModoOff ? "Modo Offline ativado" : "Ativar Modo Offline"}
                className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                  isModoOff
                    ? "text-primary bg-primary/15 hover:bg-primary/25"
                    : "text-muted-foreground hover:text-primary hover:bg-primary/15"
                }`}
              >
                {isModoOff ? <WifiOff className="h-4 w-4" /> : <Wifi className="h-4 w-4" />}
              </button>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setLocutorBarOpen((v) => !v)}
                  title="Locutor Virtual"
                  className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${
                    locutorBarOpen
                      ? "text-primary bg-primary/15 hover:bg-primary/25"
                      : "text-muted-foreground hover:text-primary hover:bg-primary/15"
                  }`}
                >
                  <Radio className="h-4 w-4" />
                </button>
                <CompactLocutorVirtual
                  open={locutorBarOpen}
                  onClose={() => setLocutorBarOpen(false)}
                  onInsert={insertAudioIntoQueue}
                  onPreviewStart={handlePause}
                  isLocked={isSectionLocked("locutor")}
                />
              </div>
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
              playlistName={activePlaylistName}
              nextSong={nextSongInQueue?.title ?? null}
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

/**
 * FeatureLockedOverlay — envolve o conteúdo real da seção.
 * O conteúdo fica visível (levemente desfocado) e quando o usuário
 * clica em qualquer lugar aparece a mensagem com transição suave.
 */
const FeatureLockedOverlay = ({
  children,
  outOfCredits = false,
}: {
  children: React.ReactNode;
  outOfCredits?: boolean;
}) => {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showMessage = () => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 3000);
  };

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  const message = outOfCredits
    ? "Seus créditos acabaram, atualize o seu plano ou compre mais."
    : "Atualize seu plano para usar esse recurso.";

  return (
    <div className="relative w-full h-full" onClick={showMessage}>
      {/* Conteúdo real — completamente visível, sem blur nem opacity */}
      <div className="pointer-events-none select-none">
        {children}
      </div>

      {/* Overlay transparente que captura cliques */}
      <div className="absolute inset-0 z-10 cursor-pointer" />

      {/* Badge pequeno e sutil no topo — aparece ao clicar */}
      <div
        className={`absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-none transition-all duration-300 ${
          visible ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"
        }`}
      >
        <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
          <Lock className="h-3 w-3 text-primary shrink-0" />
          <p className="text-xs font-medium text-foreground">{message}</p>
        </div>
      </div>
    </div>
  );
};

const SidebarItem = ({
  icon, label, active, onClick, onMouseEnter,
}: {
  icon: React.ReactNode; label: string; active?: boolean; locked?: boolean; onClick?: () => void; onLockedClick?: (e: React.MouseEvent) => void; onMouseEnter?: () => void;
}) => (
  <button
    type="button"
    onClick={onClick}
    onMouseEnter={onMouseEnter}
    aria-label={label}
    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
      active ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground hover:bg-primary/20 hover:text-primary"
    }`}
  >
    <span className="relative shrink-0">{icon}</span>
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
