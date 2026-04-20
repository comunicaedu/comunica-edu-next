"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { Music, Play, Pause, Search, ArrowLeft, Link2, Loader2, Trash2, Check, X, Plus, Camera, Pencil, Move, Clock, Heart, Repeat, Shuffle, Lock } from "lucide-react";
import PlaylistScheduleDialog from "@/components/player/PlaylistScheduleDialog";
const Youtube = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
  </svg>
);
import SpeakerIcon from "./SpeakerIcon";
import MoodFlow from "./MoodFlow";
import { buildSmartQueue, markSongPlayed } from "@/hooks/useSmartShuffle";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { toast } from "sonner";
import { authedFetch } from "@/lib/authedFetch";
interface Song {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
}
interface Playlist {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
}
interface PlaylistSong extends Song {
  position: number;
  isImported?: boolean;
}
interface PlaylistSectionProps {
  currentSong?: Song | null;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onPlayImported?: (song: Song) => void;
  isYouTubeLoading?: boolean;
  onQueueChange?: (songs: Song[], currentIndex: number, playlistId?: string) => void | Promise<void>;
  activePlaylistId?: string | null;
  onMoodActive?: (mood: any) => void;
  repeatPlaylistId?: string | null;
  onToggleRepeatPlaylist?: (playlistId: string) => void;
}
const EduAutoCover = ({ className }: { seed?: string; className?: string }) => {
  // Fundo laranja (marca ComunicaEDU) + ondas brancas
  const radii = [11.5, 20.3, 29.1];
  const cx = 50, cy = 50;
  const sw = 3.6;
  const upperArcs = radii.map((r) => {
    const sx = cx - 0.866 * r, sy = cy - 0.5 * r;
    const ex = cx + 0.866 * r, ey = sy;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  });
  const lowerArcs = radii.map((r) => {
    const sx = cx + 0.866 * r, sy = cy + 0.5 * r;
    const ex = cx - 0.866 * r, ey = sy;
    return `M ${sx.toFixed(2)} ${sy.toFixed(2)} A ${r} ${r} 0 0 1 ${ex.toFixed(2)} ${ey.toFixed(2)}`;
  });
  return (
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" className={className} style={{ background: "#f59e0b" }}>
      {[...upperArcs, ...lowerArcs].map((d, i) => (
        <path key={i} d={d} fill="none" stroke="white" strokeWidth={sw} strokeLinecap="round" opacity="0.9" />
      ))}
      <circle cx={cx} cy={cy} r="2" fill="white" opacity="0.9" />
    </svg>
  );
};

const CoverImage = ({ url, size = "md", playlistId }: { url: string | null; size?: "sm" | "md" | "lg"; playlistId?: string }) => {
  const sizeClasses = {
    sm: "w-10 h-10",
    md: "w-14 h-14",
    lg: "w-full aspect-square",
  };
  if (!url) {
    return (
      <div className={`${sizeClasses[size]} rounded-lg overflow-hidden shrink-0`}>
        <EduAutoCover seed={playlistId} className="w-full h-full" />
      </div>
    );
  }
  return (
    <div className={`${sizeClasses[size]} rounded-lg overflow-hidden shrink-0 relative bg-secondary/30`}>
      {/* Previous image stays visible underneath while new one loads */}
      <img
        key={url}
        src={url}
        alt="Capa"
        data-cover-id={playlistId}
        className="w-full h-full object-cover scale-110 absolute inset-0 cover-fade-in"
        onError={(e) => { (e.target as HTMLImageElement).style.opacity = "0"; }}
      />
    </div>
  );
};
interface PreviewData {
  playlist_name: string;
  description: string | null;
  cover_url: string | null;
  tracks_count: number;
  source: string;
  tracks: { title: string; artist: string; cover_url: string | null; youtube_video_id: string | null }[];
}
interface YTSearchResult {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  channel: string | null;
}

interface PlaylistCreatedEventDetail {
  playlist: Playlist;
}

// Clean metadata from titles/descriptions
const cleanMetadata = (text: string | null): string | null => {
  if (!text) return null;
  return text
    .replace(/\s*[\(\[](official\s*(video|audio|music\s*video|lyric\s*video)?|video\s*oficial|clipe\s*oficial|lyric\s*video|lyrics?|hd|4k|full\s*hd|audio\s*oficial|importado\s*de\s*[^\)\]]*|via\s*(youtube|deezer|spotify)[^\)\]]*)\s*[\)\]]/gi, "")
    .replace(/\s*-\s*(official\s*(video|audio|music\s*video)?|video\s*oficial|clipe\s*oficial|lyric\s*video|hd|4k)\s*$/gi, "")
    .replace(/\s*(official|video|clipe|oficial|importado|youtube|deezer|spotify)\s*$/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
};
const cleanPlaylistName = (name: string): string => {
  return (cleanMetadata(name) || name)
    .replace(/^(mix\s*-?\s*|playlist\s*-?\s*)/i, "")
    .trim() || name;
};

const sortPlaylistsByNewest = (items: Playlist[]) => {
  return [...items].sort((a, b) => {
    const aTime = new Date(a.created_at).getTime();
    const bTime = new Date(b.created_at).getTime();
    return bTime - aTime;
  });
};

const PLAYLISTS_CACHE_KEY = "edu_playlists_cache";

const loadCachedPlaylists = (): Playlist[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(PLAYLISTS_CACHE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Playlist[];
  } catch { return []; }
};

const PlaylistSection = ({ currentSong, isPlaying, onPlay, onPause, onPlayImported, isYouTubeLoading, onQueueChange, activePlaylistId, onMoodActive, repeatPlaylistId, onToggleRepeatPlaylist }: PlaylistSectionProps) => {
  const cached = loadCachedPlaylists();
  const [playlists, setPlaylists] = useState<Playlist[]>(cached);
  const [selectedPlaylist, setSelectedPlaylist] = useState<Playlist | null>(null);
  const [playlistSongs, setPlaylistSongs] = useState<PlaylistSong[]>([]);
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [songSearch, setSongSearch] = useState("");
  const { trackSearch } = useActivityTracker();
  const { isFeatureLocked, consumeFeature } = useClientFeatures();
  const { isAdmin } = useIsAdmin();
  const { prefs, loaded: prefsLoaded, updatePref } = useUserPreferences();
  const canDelete    = !isFeatureLocked("excluir_playlists");
  const canFavPlaylist = !isFeatureLocked("favoritar_playlists");
  const canFavSong     = !isFeatureLocked("curtir_musicas");
  const canSchedule  = !isFeatureLocked("programar_playlists");
  const canEditCover = !isFeatureLocked("alterar_capa");
  const canEdit      = !isFeatureLocked("editar_playlist");
  const canImport    = !isFeatureLocked("importar_playlists");

  const [lockedCardId, setLockedCardId] = useState<string | null>(null);
  const lockedBadgeTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFeatureLocked = (e: React.MouseEvent, cardId: string) => {
    e.stopPropagation();
    e.preventDefault();
    setLockedCardId(cardId);
    if (lockedBadgeTimer.current) clearTimeout(lockedBadgeTimer.current);
    lockedBadgeTimer.current = setTimeout(() => setLockedCardId(null), 5000);
  };
  const [hidePlaybackIndicatorsOnScroll, setHidePlaybackIndicatorsOnScroll] = useState(false);
  const randomCardRef = useRef<HTMLDivElement>(null);
  const [loading, setLoading] = useState(cached.length === 0);
  const [loadingSongs, setLoadingSongs] = useState(false);
  const [loadingAllSongs, setLoadingAllSongs] = useState(false);
  const [randomPanelOpen, setRandomPanelOpen] = useState(false);
  const [randomPanelSearch, setRandomPanelSearch] = useState("");
  const [randomSelectedIds, setRandomSelectedIds] = useState<string[]>([]);
  const randomClickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toggleRandomSelected = useCallback((id: string) => {
    setRandomSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      updatePref("random_playlists", next);
      return next;
    });
  }, [updatePref]);
  const [favoritePlaylists, setFavoritePlaylists] = useState<string[]>([]);
  const togglePlaylistFavorite = useCallback((id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setFavoritePlaylists((prev) => {
      const next = prev.includes(id) ? prev.filter((f) => f !== id) : [id, ...prev];
      updatePref("fav_playlists", next);
      return next;
    });
  }, [updatePref]);
  


  
  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  
  // Image upload & repositioning
  const [repositionId, setRepositionId] = useState<string | null>(null);
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null);
  const [imageOffset, setImageOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [tempOffset, setTempOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [imageZoom, setImageZoom] = useState(1.1);
  const [savedCoverStyles, setSavedCoverStyles] = useState<Record<string, { zoom: number; x: number; y: number }>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTargetId, setUploadTargetId] = useState<string | null>(null);
  const saveCoverStyle = useCallback((playlistId: string, zoom: number, x: number, y: number) => {
    setSavedCoverStyles((prev) => {
      const next = { ...prev, [playlistId]: { zoom, x, y } };
      updatePref("playlist_cover_styles", next);
      return next;
    });
  }, [updatePref]);
  const [importOpen, setImportOpen] = useState(false);
  const [isFeaturedImport, setIsFeaturedImport] = useState(false);
  const [scheduleOpenImport, setScheduleOpenImport] = useState(false);
  const [importedPlaylistId, setImportedPlaylistId] = useState<string | null>(null);
  const [pendingScheduleOpen, setPendingScheduleOpen] = useState(false);
  const [pendingScheduleData, setPendingScheduleData] = useState<any | null>(null);
  const [importUrl, setImportUrl] = useState("");
  const [importing, setImporting] = useState(false);
  const [importPreview, setImportPreview] = useState<PreviewData | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<YTSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [schedulePlaylist, setSchedulePlaylist] = useState<Playlist | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [userFavorites, setUserFavorites] = useState<Set<string>>(new Set());
  const [hiddenPlaylistIds, setHiddenPlaylistIds] = useState<string[]>([]);
  const hiddenPlaylistIdsRef = useRef<string[]>([]);

  // Popula o ID do usuário logado
  useEffect(() => {
    import("@/lib/supabase/client").then(({ supabase }) => {
      supabase.auth.getUser().then(({ data }) => {
        if (data.user) setCurrentUserId(data.user.id);
      });
    });
  }, []);

  // Sync prefs into local state when loaded
  useEffect(() => {
    if (!prefsLoaded) return;
    setUserFavorites(new Set(prefs.fav_songs ?? []));
    setFavoritePlaylists(prefs.fav_playlists ?? []);
    setRandomSelectedIds(prefs.random_playlists ?? []);
    setSavedCoverStyles(prefs.playlist_cover_styles ?? {});
    const hidden = prefs.hidden_playlists ?? [];
    setHiddenPlaylistIds(hidden);
    hiddenPlaylistIdsRef.current = hidden;
    // Re-filter playlists now that hidden IDs are known
    fetchPlaylists();
  }, [prefsLoaded]);

  const toggleFavorite = async (songId: string, _playlistId?: string) => {
    const isAdding = !userFavorites.has(songId);
    if (isAdding) {
      const ok = await consumeFeature("curtir_musicas");
      if (!ok) return;
    }
    setUserFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(songId)) {
        next.delete(songId);
      } else {
        next.add(songId);
      }
      updatePref("fav_songs", [...next]);
      return next;
    });
  };

  // Click detection: single = play, double = open panel
  // Uses e.detail (browser click count) — much more reliable than manual timing
  const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchPlaylists = async () => {
    setLoading((prev) => prev || playlists.length === 0);
    try {
      const res = await authedFetch("/api/playlists");
      const data = await res.json();
      const playlists = data.playlists ?? [];
      const uniqueById = Array.from(new Map(playlists.map((p: any) => [p.id, p])).values()) as any[];
      const sorted = sortPlaylistsByNewest(uniqueById);
      // Filtra playlists ocultas pelo cliente (via prefs)
      const hiddenIds = hiddenPlaylistIdsRef.current;
      const visible = hiddenIds.length > 0 ? sorted.filter((p: any) => !hiddenIds.includes(p.id)) : sorted;
      setPlaylists(visible);
      try { localStorage.setItem(PLAYLISTS_CACHE_KEY, JSON.stringify(sorted)); } catch {}
    } catch {
      toast.error("Erro ao carregar playlists.");
    }
    setLoading(false);
  };

  const fetchPlaylistSongs = async (playlistId: string) => {
    setLoadingSongs(true);
    try {
      const res = await authedFetch(`/api/playlist-songs?playlist_id=${playlistId}`);
      const data = await res.json();
      const songs: PlaylistSong[] = (data.songs ?? []).map((s: any) => ({
        ...s,
        title: s.title?.replace(/^\d+[\s.\-_)]+/g, "").replace(/^\(\d+\)\s*/g, "").replace(/^\[\d+\]\s*/g, "").trim() || s.title,
        isImported: s.file_path?.startsWith("imported/") || s.file_path?.startsWith("youtube:"),
      }));
      setPlaylistSongs(songs);
    } catch {
      toast.error("Erro ao carregar músicas da playlist.");
      setPlaylistSongs([]);
    }
    setLoadingSongs(false);
  };



  useEffect(() => {
    fetchPlaylists();
  }, []);

  useEffect(() => {
    const handler = () => {
      fetchPlaylists();
      if (selectedPlaylist) fetchPlaylistSongs(selectedPlaylist.id);
    };
    window.addEventListener("songs-changed", handler);
    window.addEventListener("playlist-created", handler);
    return () => {
      window.removeEventListener("songs-changed", handler);
      window.removeEventListener("playlist-created", handler);
    };
  }, [selectedPlaylist]);

  useEffect(() => {
    const handlePlaylistCreated = (event: Event) => {
      const customEvent = event as CustomEvent<PlaylistCreatedEventDetail>;
      const incoming = customEvent.detail?.playlist;
      if (!incoming?.id) return;

      setPlaylists((prev) => {
        const withoutDup = prev.filter((playlist) => playlist.id !== incoming.id);
        return sortPlaylistsByNewest([incoming, ...withoutDup]);
      });

      setPlaylistSearch("");
    };

    window.addEventListener("playlist-created", handlePlaylistCreated as EventListener);
    return () => window.removeEventListener("playlist-created", handlePlaylistCreated as EventListener);
  }, []);

  // A→Z flow: when a playlist ends (no repeat), load the next playlist alphabetically by name
  useEffect(() => {
    const handlePlaylistEnded = async (event: Event) => {
      const finishedId = (event as CustomEvent<{ playlistId: string | null }>).detail?.playlistId;
      if (!finishedId || playlists.length === 0) return;

      // Sort alphabetically (same order as user sees them)
      const sorted = [...playlists].sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
      const currentIdx = sorted.findIndex((p) => p.id === finishedId);
      // Pick next; wrap around to first if at end
      const nextPlaylist = sorted[(currentIdx + 1) % sorted.length];
      if (!nextPlaylist || nextPlaylist.id === finishedId) return;

      const res = await authedFetch(`/api/playlist-songs?playlist_id=${nextPlaylist.id}`);
      const psData = await res.json();
      if (!psData.songs?.length) return;

      const allSongs: PlaylistSong[] = psData.songs.map((s: any) => ({
        ...s,
        isImported: s.file_path?.startsWith("imported/") || s.file_path?.startsWith("youtube:"),
      }));

      const seen2 = new Set<string>();
      const shuffled = allSongs
        .filter(s => { if (seen2.has(s.id)) return false; seen2.add(s.id); return true; })
        .sort(() => Math.random() - 0.5);
      if (shuffled.length === 0) return;

      const firstSong = shuffled[0] as PlaylistSong;
      onQueueChange?.(shuffled, 0, nextPlaylist.id);
      markSongPlayed(nextPlaylist.id, firstSong.id);

      if (firstSong.isImported && onPlayImported) {
        onPlayImported(firstSong);
      } else {
        onPlay(firstSong);
      }
    };

    window.addEventListener("playlist-ended", handlePlaylistEnded as EventListener);
    return () => window.removeEventListener("playlist-ended", handlePlaylistEnded as EventListener);
  }, [playlists, onQueueChange, onPlay, onPlayImported]);

  // Close reposition/editing mode when clicking outside — auto-save
  useEffect(() => {
    if (!repositionId && !editingId) return;
    const currentRepoId = repositionId;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (currentRepoId && !target.closest(`[data-playlist-id="${currentRepoId}"]`)) {
        saveCoverStyle(currentRepoId, imageZoom, tempOffset.x, tempOffset.y);
        setRepositionId(null);
        toast.success("Edição salva!", { id: "edicao-salva" });
      }
      if (editingId && !target.closest(`[data-playlist-id="${editingId}"]`)) {
        saveEditing();
        toast.success("Edição salva!", { id: "edicao-salva" });
      }
    };
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [repositionId, editingId, imageZoom, tempOffset, saveCoverStyle]);
  useEffect(() => {
    if (selectedPlaylist) fetchPlaylistSongs(selectedPlaylist.id);
  }, [selectedPlaylist]);
  // ── Import dialog handlers ──
  const handleFetchPreview = async () => {
    if (!importUrl.trim()) return;
    setImporting(true);
    try {
      const res = await authedFetch(`/api/import-playlist?action=preview&url=${encodeURIComponent(importUrl.trim())}`);
      const data = await res.json();
      if (!res.ok || !data.preview) {
        toast.error(data.error ?? "Playlist não encontrada. Verifique o link.");
      } else {
        setImportPreview(data.preview);
      }
    } catch {
      toast.error("Erro ao buscar playlist. Tente novamente.");
    }
    setImporting(false);
  };

  const handleConfirmImport = async () => {
    if (!importPreview) return;
    setImporting(true);
    try {
      const res = await authedFetch("/api/import-playlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          playlist_name: importPreview.playlist_name,
          description: importPreview.description,
          cover_url: importPreview.cover_url,
          tracks: importPreview.tracks,
          user_id: currentUserId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao importar playlist.");
      } else {
        if (isFeaturedImport) {
          {
            const current = prefs.fav_playlists ?? [];
            if (!current.includes(data.playlist_id)) {
              updatePref("fav_playlists", [...current, data.playlist_id]);
            }
          }
          await authedFetch("/api/playlists", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: data.playlist_id, is_featured: true }),
          }).catch(() => {});
        }
        setImportedPlaylistId(data.playlist_id);

        // Aplicar agendamento pendente se definido antes da importação
        if (pendingScheduleData) {
          try {
            const { data: userData } = await (await import("@/lib/supabase/client")).supabase.auth.getUser();
            const userId = userData.user?.id ?? "00000000-0000-0000-0000-000000000000";
            const { format } = await import("date-fns");
            const schedulePayload: Record<string, any> = {
              playlist_id: data.playlist_id,
              user_id: userId,
              start_time: pendingScheduleData.start_time,
              end_time: pendingScheduleData.end_time,
              days_of_week: [0,1,2,3,4,5,6],
              is_active: pendingScheduleData.is_active ?? true,
              start_date: pendingScheduleData.start_date ? format(new Date(pendingScheduleData.start_date), "yyyy-MM-dd") : null,
              end_date: pendingScheduleData.end_date ? format(new Date(pendingScheduleData.end_date), "yyyy-MM-dd") : null,
              updated_at: new Date().toISOString(),
            };
            if (pendingScheduleData.scheduled_volume != null) {
              schedulePayload.scheduled_volume = pendingScheduleData.scheduled_volume;
            }
            const { error: schedErr } = await (await import("@/lib/supabase/client")).supabase
              .from("playlist_schedules")
              .insert([schedulePayload]);
            if (schedErr) {
              toast.success(`Playlist importada com ${data.songs_count} músicas!`);
              toast.error(`Agendamento não salvo: ${schedErr.message}`);
            } else {
              toast.success(`Playlist importada e agendada!`);
            }
          } catch (err: any) {
            toast.success(`Playlist importada com ${data.songs_count} músicas!`);
            toast.error(`Erro ao salvar agendamento.`);
          }
        } else {
          toast.success(`Playlist importada com ${data.songs_count} músicas!`);
        }

        await consumeFeature("importar_playlists");
        setImportOpen(false);
        setPendingScheduleData(null);
        resetImportState();

        // ❤️ ativo = reproduzir imediatamente após importar
        if (isFeaturedImport) {
          try {
            const psRes = await authedFetch(`/api/playlist-songs?playlist_id=${data.playlist_id}`);
            const psData = await psRes.json();
            if (psData.songs?.length > 0) {
              const songs: PlaylistSong[] = psData.songs.map((s: any) => ({
                ...s,
                isImported: s.file_path?.startsWith("youtube:"),
              }));
              onQueueChange?.(songs, 0, data.playlist_id);
              const first = songs[0] as PlaylistSong;
              if (first.isImported && onPlayImported) onPlayImported(first);
              else onPlay(first);
            }
          } catch {}
        }
        setIsFeaturedImport(false);
        window.dispatchEvent(new CustomEvent("playlist-created"));
      }
    } catch {
      toast.error("Erro ao importar. Tente novamente.");
    }
    setImporting(false);
  };

  const handleSearchPlaylists = async () => {
    if (!searchQuery.trim()) return;
    setSearching(true);
    try {
      const res = await authedFetch(`/api/import-playlist?action=search&q=${encodeURIComponent(searchQuery.trim())}`);
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? "Erro ao buscar playlists.");
      } else {
        setSearchResults(data.results ?? []);
        if (!data.results?.length) {
          toast.info(data.error ?? "Nenhuma playlist musical encontrada. Tente buscar por gênero ou artista.");
        }
      }
    } catch {
      toast.error("Erro ao buscar. Tente novamente.");
    }
    setSearching(false);
  };

  const handleSelectSearchResult = async (result: YTSearchResult) => {
    setImporting(true);
    setSearchResults([]);
    try {
      const res = await authedFetch(`/api/import-playlist?action=playlist_by_id&id=${result.id}`);
      const data = await res.json();
      if (!res.ok || !data.preview) {
        toast.error(data.error ?? "Erro ao carregar playlist.");
      } else {
        setImportPreview(data.preview);
      }
    } catch {
      toast.error("Erro ao carregar playlist.");
    }
    setImporting(false);
  };
  const resetImportState = () => {
    setImportUrl("");
    setImportPreview(null);
    setSearchQuery("");
    setSearchResults([]);
  };
  const handleDeletePlaylist = async (playlist: Playlist, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (!isAdmin) {
      // Verifica créditos antes
      if (!canDelete) { toast.error("Recurso bloqueado. Atualize seu plano."); return; }
      const ok = await consumeFeature("excluir_playlists");
      if (!ok) return;
      // Clientes apenas ocultam da biblioteca — nunca deletam do banco
      const newHidden = hiddenPlaylistIds.includes(playlist.id)
        ? hiddenPlaylistIds
        : [...hiddenPlaylistIds, playlist.id];
      setHiddenPlaylistIds(newHidden);
      hiddenPlaylistIdsRef.current = newHidden;
      updatePref("hidden_playlists", newHidden);
      setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
      // Sem toast — música/playlist some silenciosamente da lista do cliente
      if (selectedPlaylist?.id === playlist.id) setSelectedPlaylist(null);
      return;
    }

    // Admin: delete real do banco
    await authedFetch("/api/playlist-songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlist_id: playlist.id }) });
    const res = await authedFetch("/api/playlists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: playlist.id }) });
    if (!res.ok) {
      toast.error("Erro ao excluir playlist.");
    } else {
      setPlaylists((prev) => prev.filter((p) => p.id !== playlist.id));
      toast.success(`"${playlist.name}" removida.`);
      if (selectedPlaylist?.id === playlist.id) setSelectedPlaylist(null);
      window.dispatchEvent(new CustomEvent("playlist-force-delete", { detail: { playlistId: playlist.id } }));
    }
  };
  // Inline title editing
  const startEditing = (playlist: Playlist, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEdit) return;
    setEditingId(playlist.id);
    setEditingName(playlist.name);
    setTimeout(() => editInputRef.current?.focus(), 50);
  };
  const saveEditing = async () => {
    if (!editingId || !editingName.trim()) { setEditingId(null); return; }
    if (!canEdit) { setEditingId(null); toast.warning("Atualize seu plano para editar playlists."); return; }
    const cleaned = cleanPlaylistName(editingName);
    const res = await authedFetch("/api/playlists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId, name: cleaned }) });
    if (!res.ok) {
      toast.error("Erro ao renomear.");
    } else {
      setPlaylists((prev) => prev.map((p) => p.id === editingId ? { ...p, name: cleaned } : p));
      await consumeFeature("editar_playlist");
    }
    setEditingId(null);
  };
  // Image upload
  const triggerImageUpload = (playlistId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (!canEditCover) { showFeatureLocked(e, playlistId); return; }
    setUploadTargetId(playlistId);
    fileInputRef.current?.click();
  };
  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ""; // reset so same file can be reselected
    if (!file || !uploadTargetId) return;
    if (!canEditCover) { toast.error("Recurso bloqueado. Atualize seu plano."); return; }
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem."); return; }
    if (file.size > 5 * 1024 * 1024) { toast.error("Imagem deve ter no máximo 5MB."); return; }

    const reader = new FileReader();
    const targetId = uploadTargetId;
    reader.onload = async () => {
      const coverUrl = reader.result as string;
      const res = await authedFetch("/api/playlists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: targetId, cover_url: coverUrl }) });
      if (!res.ok) {
        toast.error("Erro ao atualizar capa.");
      } else {
        setPlaylists((prev) => prev.map((p) => p.id === targetId ? { ...p, cover_url: coverUrl } : p));
        await consumeFeature("alterar_capa");
        toast.success("Capa atualizada!");
      }
    };
    reader.onerror = () => toast.error("Erro ao ler imagem.");
    reader.readAsDataURL(file);
  };
  // Image repositioning via drag
  const startReposition = (playlistId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    if (repositionId === playlistId) {
      saveCoverStyle(playlistId, imageZoom, tempOffset.x, tempOffset.y);
      setRepositionId(null);
      // Also save name if editing
      if (editingId === playlistId) saveEditing();
      toast.success("Edição salva!", { id: "edicao-salva" });
      return;
    }
    const saved = savedCoverStyles[playlistId];
    setRepositionId(playlistId);
    setImageOffset(saved ? { x: saved.x, y: saved.y } : { x: 0, y: 0 });
    setTempOffset(saved ? { x: saved.x, y: saved.y } : { x: 0, y: 0 });
    setImageZoom(saved ? saved.zoom : 1.1);
    // Also enable name editing
    const playlist = playlists.find((p) => p.id === playlistId);
    if (playlist) {
      setEditingId(playlistId);
      setEditingName(playlist.name);
      setTimeout(() => editInputRef.current?.focus(), 100);
    }
  };
  const handleDragStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragStart({ x: e.clientX, y: e.clientY });
  };
  const handleDragMove = (e: React.MouseEvent) => {
    if (!dragStart) return;
    e.stopPropagation();
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    setTempOffset({ x: imageOffset.x + dx, y: imageOffset.y + dy });
  };
  const handleDragEnd = () => {
    if (dragStart) {
      setImageOffset(tempOffset);
      setDragStart(null);
    }
  };
  const isCurrentSong = (song: Song) => currentSong?.id === song.id;

  const handlePlayAllRandom = useCallback(async () => {
    if (loadingAllSongs || playlists.length === 0) return;
    setLoadingAllSongs(true);
    try {
      const activePlaylists = randomSelectedIds.length > 0
        ? playlists.filter((p) => randomSelectedIds.includes(p.id))
        : playlists;
      const allResults = await Promise.all(
        activePlaylists.map(async (p) => {
          const res = await authedFetch(`/api/playlist-songs?playlist_id=${p.id}`);
          const data = await res.json();
          return (data.songs ?? []).map((s: any) => ({
            ...s,
            isImported: s.file_path?.startsWith("imported/") || s.file_path?.startsWith("youtube:"),
          })) as PlaylistSong[];
        })
      );
      const allSongs = allResults.flat();
      if (allSongs.length === 0) { toast.error("Nenhuma música encontrada."); return; }

      // Deduplicate by song ID
      const seen = new Set<string>();
      const unique = allSongs.filter((s) => { if (seen.has(s.id)) return false; seen.add(s.id); return true; });

      // Group by genre (null/empty → "Outros")
      const genreMap = new Map<string, PlaylistSong[]>();
      for (const s of unique) {
        const key = s.genre?.trim() || "Outros";
        if (!genreMap.has(key)) genreMap.set(key, []);
        genreMap.get(key)!.push(s);
      }

      // Shuffle each genre bucket
      const fisher = <T,>(arr: T[]): T[] => {
        const a = [...arr];
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      };
      const groups = Array.from(genreMap.values()).map(fisher);

      // Round-robin interleave by genre: sertanejo → pop → forró → sertanejo → ...
      const queue: PlaylistSong[] = [];
      const indices = new Array(groups.length).fill(0);
      while (true) {
        let added = false;
        for (let g = 0; g < groups.length; g++) {
          if (indices[g] < groups[g].length) {
            queue.push(groups[g][indices[g]++]);
            added = true;
          }
        }
        if (!added) break;
      }
      const firstSong = queue[0];
      onQueueChange?.(queue, 0, "all-random");
      markSongPlayed("all-random", firstSong.id);
      const isImported = firstSong.file_path?.startsWith("imported/") || firstSong.file_path?.startsWith("youtube:");
      if (isImported && onPlayImported) {
        onPlayImported(firstSong);
      } else {
        onPlay(firstSong);
      }
    } catch {
      toast.error("Erro ao carregar músicas.");
    } finally {
      setLoadingAllSongs(false);
    }
  }, [loadingAllSongs, playlists, randomSelectedIds, onQueueChange, onPlay, onPlayImported]);

  const filteredPlaylists = playlists.filter((p) =>
    p.name.toLowerCase().includes(playlistSearch.toLowerCase())
  );
  const favSet = new Set(favoritePlaylists);
  const sortedFilteredPlaylists = [...filteredPlaylists].sort((a, b) => {
    const af = favSet.has(a.id) ? 0 : 1;
    const bf = favSet.has(b.id) ? 0 : 1;
    return af - bf;
  });
  const filteredSongs = playlistSongs.filter((s) => {
    const q = songSearch.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.artist?.toLowerCase().includes(q) ?? false) ||
      (s.genre?.toLowerCase().includes(q) ?? false)
    );
  });
  // Close expanded panel on outside click
  const expandedPanelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!selectedPlaylist) return;
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (expandedPanelRef.current && !expandedPanelRef.current.contains(target) && !target.closest(`[data-playlist-id="${selectedPlaylist.id}"]`)) {
        setSelectedPlaylist(null);
        setSongSearch("");
      }
    };
    const timer = setTimeout(() => document.addEventListener("mousedown", handleOutsideClick), 100);
    return () => { clearTimeout(timer); document.removeEventListener("mousedown", handleOutsideClick); };
  }, [selectedPlaylist]);
  useEffect(() => {
    if (!selectedPlaylist) setHidePlaybackIndicatorsOnScroll(false);
  }, [selectedPlaylist]);
  useEffect(() => {
    if (!randomPanelOpen) return;
    const handle = (e: MouseEvent) => {
      if (randomCardRef.current && !randomCardRef.current.contains(e.target as Node)) {
        setRandomPanelOpen(false);
        setRandomPanelSearch("");
      }
    };
    const t = setTimeout(() => document.addEventListener("mousedown", handle), 100);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", handle); };
  }, [randomPanelOpen]);
  // Helper to render expanded track panel (overlay on top of card)
  const renderExpandedPanel = () => {
    if (!selectedPlaylist) return null;
    return (
      <div
        ref={expandedPanelRef}
        className="absolute inset-0 z-30 overflow-hidden"
        style={{ background: "#272d38" }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-2 p-2 sm:p-3 shrink-0">
          <CoverImage url={selectedPlaylist.cover_url} size="sm" />
          <div className="min-w-0 flex-1 overflow-hidden">
            <h3 className="text-xs sm:text-sm font-semibold truncate text-white">{cleanPlaylistName(selectedPlaylist.name)}</h3>
            <p className="text-[10px] sm:text-xs text-white/60 truncate">{cleanPlaylistName(selectedPlaylist.name)}</p>
          </div>
        </div>
        {/* Search bar */}
        <div className="px-2 sm:px-3 py-1.5">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/40" />
            <input
              type="text"
              value={songSearch}
              onChange={(e) => setSongSearch(e.target.value)}
              placeholder="Digite o nome da sua música..."
              className="w-full pl-7 pr-2 py-1.5 text-[10px] sm:text-xs rounded-md border border-border/50 text-white placeholder:text-white/40 focus:outline-none focus:border-primary/50"
              style={{ background: "#272d38" }}
            />
          </div>
        </div>
        {/* Track list */}
        <div
          className="max-h-60 sm:max-h-72 overflow-y-auto scrollbar-none"
          onScroll={(e) => {
            const el = e.currentTarget;
            const hasScrolledDown = el.scrollTop > 8;
            if (hasScrolledDown !== hidePlaybackIndicatorsOnScroll) {
              setHidePlaybackIndicatorsOnScroll(hasScrolledDown);
            }
            // Loop infinito: ao chegar no fim volta ao topo silenciosamente
            if (el.scrollTop + el.clientHeight >= el.scrollHeight - 2) {
              el.scrollTop = 0;
            }
          }}
        >
          {loadingSongs ? (
            <div className="text-center py-6 text-muted-foreground text-xs">Carregando...</div>
          ) : playlistSongs.length === 0 ? (
            <div className="text-center py-6">
              <Music className="h-6 w-6 text-muted-foreground mx-auto mb-1" />
              <p className="text-muted-foreground text-[10px]">Playlist vazia.</p>
            </div>
          ) : (
            (() => {
              const filtered = playlistSongs.filter((s) => {
                if (!songSearch.trim()) return true;
                const q = songSearch.toLowerCase();
                return (s.title?.toLowerCase().includes(q) || s.artist?.toLowerCase().includes(q) || s.genre?.toLowerCase().includes(q));
              });
              return filtered.map((song) => {
                const isSongCurrent = !hidePlaybackIndicatorsOnScroll && isCurrentSong(song);
                return (
                  <div
                    key={song.id}
                    className={`flex items-center gap-1.5 sm:gap-2 px-2 py-1 sm:px-3 sm:py-1.5 transition-colors group/song ${
                      isSongCurrent ? "bg-primary/15" : "hover:bg-secondary/50"
                    }`}
                  >
                    <button
                      onClick={() => {
                        if (!hidePlaybackIndicatorsOnScroll && isCurrentSong(song) && isPlaying) {
                          onPause();
                        } else if (song.isImported && onPlayImported) {
                          const realIndex = playlistSongs.findIndex(s => s.id === song.id);
                          onQueueChange?.(playlistSongs, realIndex >= 0 ? realIndex : 0, selectedPlaylist?.id);
                          onPlayImported(song);
                        } else if (!song.isImported) {
                          const realIndex = playlistSongs.findIndex(s => s.id === song.id);
                          onQueueChange?.(playlistSongs, realIndex >= 0 ? realIndex : 0, selectedPlaylist?.id);
                          onPlay(song);
                        }
                      }}
                      disabled={song.isImported && isYouTubeLoading}
                      className={`w-6 h-6 sm:w-7 sm:h-7 rounded-full flex items-center justify-center shrink-0 transition-all ${
                        !hidePlaybackIndicatorsOnScroll && isYouTubeLoading && isCurrentSong(song)
                          ? "animate-pulse text-white"
                          : isSongCurrent
                            ? "text-white shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                            : "text-white/80 hover:text-white hover:shadow-[0_0_8px_rgba(245,158,11,0.4)]"
                      }`}
                      style={{ background: "#f59e0b" }}
                    >
                      {!hidePlaybackIndicatorsOnScroll && isYouTubeLoading && isCurrentSong(song) ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : isSongCurrent && isPlaying ? (
                        <Pause className="h-3 w-3" />
                      ) : (
                        <Play className="h-3 w-3 ml-0.5" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className={`text-[8px] sm:text-[10px] font-medium truncate ${isSongCurrent ? "text-primary" : "text-white"}`}>
                        {cleanMetadata(song.title) || song.title}
                      </p>
                    </div>
                    <button
                      onClick={(e) => { e.stopPropagation(); canFavSong ? toggleFavorite(song.id, selectedPlaylist?.id) : showFeatureLocked(e, selectedPlaylist?.id ?? "selected"); }}
                      title={userFavorites.has(song.id) ? "Remover dos favoritos" : "Favoritar"}
                      className={`w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shrink-0 transition-all ${
                        userFavorites.has(song.id)
                          ? "text-red-500 hover:text-red-400"
                          : "text-muted-foreground hover:text-red-400 opacity-0 group-hover/song:opacity-100"
                      }`}
                    >
                      <Heart className={`h-2.5 w-2.5 ${userFavorites.has(song.id) ? "fill-current" : ""}`} />
                    </button>
                    <button
                      onClick={async () => {
                        if (!isAdmin && isFeatureLocked("excluir_musicas")) { toast.error("Recurso bloqueado. Atualize seu plano."); return; }
                        if (!isAdmin) { const ok = await consumeFeature("excluir_musicas"); if (!ok) return; }
                        // Hide song via playlist_song_favs (hidden_songs sub-key)
                        if (selectedPlaylist?.id) {
                          const allFavs = { ...(prefs.playlist_song_favs ?? {}) };
                          const hiddenKey = `hidden_${selectedPlaylist.id}`;
                          const hidden: string[] = allFavs[hiddenKey] ?? [];
                          if (!hidden.includes(song.id)) {
                            allFavs[hiddenKey] = [...hidden, song.id];
                            updatePref("playlist_song_favs", allFavs);
                          }
                        }
                        setPlaylistSongs((prev) => prev.filter((s) => s.id !== song.id));
                      }}
                      className="w-5 h-5 sm:w-6 sm:h-6 rounded-full flex items-center justify-center shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 opacity-0 group-hover/song:opacity-100 transition-all"
                      title="Remover da playlist"
                    >
                      <Trash2 className="h-2.5 w-2.5" />
                    </button>
                  </div>
                );
              });
            })()
          )}
        </div>
      </div>
    );
  };



  // ── Playlist grid view ──
  return (
    <div className="space-y-4">
      <div className="bg-background pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6">
        <div className="flex items-center gap-2 min-h-[2.5rem]">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={playlistSearch}
            onChange={(e) => { setPlaylistSearch(e.target.value); trackSearch(e.target.value); }}
            placeholder="Buscar playlist..."
            className="pl-9 bg-secondary/50 border-border"
          />
        </div>


        
          <Dialog open={importOpen} onOpenChange={(open) => { setImportOpen(open); if (!open) resetImportState(); }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5 shrink-0 bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all w-36">
                <Plus className="h-4 w-4" /> Importar
              </Button>
            </DialogTrigger>
            <DialogContent hideCloseButton className="sm:max-w-md h-[460px] overflow-y-hidden flex flex-col">
              <DialogHeader className="shrink-0">
                <DialogTitle className="flex items-center justify-between text-white w-full">
                  <span className="flex items-center gap-2">
                    <Link2 className="h-5 w-5" /> Importar Playlist
                  </span>
                  <span className="flex items-center gap-2">
                    <button type="button" onClick={() => setIsFeaturedImport(!isFeaturedImport)} title="Destacar playlist para todos" className="shrink-0 transition-colors">
                      <Heart className={`h-5 w-5 transition-colors ${isFeaturedImport ? "fill-primary text-primary" : "text-muted-foreground hover:text-primary"}`} />
                    </button>
                    <button type="button" onClick={() => setPendingScheduleOpen(true)} title="Agendar playlist" className="shrink-0 transition-colors">
                      <Clock className={`h-5 w-5 transition-colors ${pendingScheduleData ? "text-primary" : "text-muted-foreground hover:text-primary"}`} />
                    </button>
                  </span>
                </DialogTitle>
              </DialogHeader>
              <div className="flex-1 overflow-y-auto scrollbar-none space-y-3 pt-2">
                {pendingScheduleData && (
                  <div className="bg-primary/10 border border-primary/30 rounded-lg px-3 py-2 flex items-center gap-2 text-xs text-primary">
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>Agendado: {pendingScheduleData.start_date ? new Date(pendingScheduleData.start_date).toLocaleDateString("pt-BR") : ""} {pendingScheduleData.start_time} – {pendingScheduleData.end_time}</span>
                    <button type="button" onClick={() => setPendingScheduleData(null)} className="ml-auto text-primary/60 hover:text-destructive transition-colors">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                )}
                <Input
                  value={importUrl}
                  onChange={(e) => { setImportUrl(e.target.value); setImportPreview(null); }}
                  placeholder="Cole o link aqui..."
                  className="bg-secondary/50 border-border focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-foreground/30"
                />
                <Button
                  onClick={handleFetchPreview}
                  disabled={importing || !importUrl.trim()}
                  className="w-full gap-2"
                >
                  {importing && !importPreview ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                  Buscar Playlist
                </Button>

                {importPreview ? (
                  <div className="bg-secondary/50 rounded-xl p-4 space-y-3 overflow-hidden">
                    <div className="flex items-center gap-3">
                      {importPreview.cover_url && (
                        <img src={importPreview.cover_url} alt="" className="w-14 h-14 rounded-lg object-cover shrink-0" />
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-sm truncate">{importPreview.playlist_name}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {importPreview.tracks_count} faixas • via {importPreview.source === "youtube" ? "YouTube" : importPreview.source === "deezer" ? "Deezer" : "Spotify"}
                        </p>
                      </div>
                    </div>
                    {importPreview.tracks.length > 0 && (
                      <div className="text-xs text-muted-foreground space-y-0.5 pt-2 max-h-32 overflow-hidden">
                        {importPreview.tracks.slice(0, 8).map((t, i) => (
                          <p key={i} className="truncate">
                            <span className="text-muted-foreground/60">{i + 1}.</span>{" "}
                            <span className="text-foreground/80">{t.title}</span> — {t.artist}
                          </p>
                        ))}
                        {importPreview.tracks_count > 8 && (
                          <p className="text-muted-foreground/60 pt-1">...e mais {importPreview.tracks_count - 8} faixas</p>
                        )}
                      </div>
                    )}
                    <Button onClick={canImport ? handleConfirmImport : () => toast.warning("Atualize seu plano para importar playlists.")} disabled={importing} className="w-full gap-2" size="sm">
                      {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                      {importing ? "Importando..." : "Confirmar Importação"}
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-border" />
                      <span className="text-xs text-muted-foreground">ou pesquise por nome</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>
                    <div className="flex gap-2">
                      <Input
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && handleSearchPlaylists()}
                        placeholder="Digite o nome da playlist..."
                        className="bg-secondary/50 border-border flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 placeholder:text-foreground/30"
                      />
                      <Button onClick={handleSearchPlaylists} disabled={searching || !searchQuery.trim()} size="icon" variant="outline">
                        {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
                      </Button>
                    </div>
                    {searchResults.length > 0 && (
                      <div className="space-y-2 max-h-48 overflow-y-auto scrollbar-none">
                        {searchResults.map((r) => (
                          <button
                            type="button"
                            key={r.id}
                            onClick={() => handleSelectSearchResult(r)}
                            className="flex items-center gap-3 w-full text-left p-2 rounded-lg hover:bg-secondary/50 transition-colors"
                          >
                            {r.cover_url && <img src={r.cover_url} alt="" className="w-10 h-10 rounded object-cover shrink-0" />}
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium truncate">{r.name}</p>
                              {r.channel && <p className="text-xs text-muted-foreground truncate">{r.channel}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        
        </div>
      </div>
      {/* Mood Flow - desativado */}
      {/* Hidden file input for cover upload */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleImageUpload}
      />
      
      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando...</div>
      ) : sortedFilteredPlaylists.length === 0 ? (
        <div className="text-center py-12">
          <Music className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {playlistSearch ? "Nenhuma playlist encontrada." : "Nenhuma playlist ainda. Clique em Importar!"}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-2 sm:gap-4">
          {/* Card Aleatório — só aparece quando não há filtro de busca e tem 2+ playlists */}
          {!playlistSearch && playlists.length >= 2 && (
            <div
              ref={randomCardRef}
              onClick={(e) => {
                if (randomPanelOpen) return;
                if (e.detail >= 2) {
                  if (randomClickTimerRef.current) { clearTimeout(randomClickTimerRef.current); randomClickTimerRef.current = null; }
                  setRandomPanelOpen(true);
                  return;
                }
                if (randomClickTimerRef.current) { clearTimeout(randomClickTimerRef.current); randomClickTimerRef.current = null; }
                randomClickTimerRef.current = setTimeout(() => { randomClickTimerRef.current = null; handlePlayAllRandom(); }, 280);
              }}
              className="group text-left rounded-lg sm:rounded-xl border border-primary/30 transition-colors relative cursor-pointer min-w-0 overflow-hidden"
              style={{ background: "#f59e0b" }}
            >
              {/* Mosaico crescente — uma célula por playlist, até 100 */}
              <div className="relative aspect-[4/3] sm:aspect-square overflow-hidden">
                {(() => {
                  const tiles = playlists.slice(0, 100);
                  const cols = Math.ceil(Math.sqrt(tiles.length));
                  return (
                    <div
                      className="w-full h-full"
                      style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)` }}
                    >
                      {tiles.map((p) => (
                        <div key={p.id} className="relative overflow-hidden">
                          <EduAutoCover className="w-full h-full" />
                          {p.cover_url && (
                            <img
                              src={p.cover_url}
                              alt=""
                              className="absolute inset-0 w-full h-full object-cover"
                              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}

                {/* Botões do card Aleatório */}
                <div className="absolute top-2 right-2 flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); canSchedule ? setSchedulePlaylist({ id: "all-random", name: "Aleatório", description: null, cover_url: null, is_public: false, created_by: null, created_at: "" } as any) : showFeatureLocked(e, "all-random"); }}
                    title="Programar horário"
                    className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                  >
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleRepeatPlaylist?.("all-random"); }}
                    title={repeatPlaylistId === "all-random" ? "Repetição ativada" : "Repetir playlist"}
                    className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                      repeatPlaylistId === "all-random" ? "bg-primary text-primary-foreground" : "bg-background/80 text-muted-foreground hover:text-primary hover:bg-background"
                    }`}
                  >
                    <Repeat className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {/* Título */}
              <div className="p-2 sm:p-3">
                <div className="flex items-center gap-1.5">
                  <p className="text-xs sm:text-sm font-semibold text-white drop-shadow-sm flex-1 truncate">Aleatório</p>
                  {activePlaylistId === "all-random" && isPlaying && (
                    <div className="shrink-0 animate-pulse">
                      <SpeakerIcon size={20} className="text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
                    </div>
                  )}
                </div>
              </div>
              {/* Painel de seleção de playlists (duplo clique) */}
              {randomPanelOpen && (
                <div
                  className="absolute inset-0 z-30 overflow-hidden flex flex-col"
                  style={{ background: "#272d38" }}
                  onClick={(e) => e.stopPropagation()}
                  onDoubleClick={(e) => e.stopPropagation()}
                >
                  {/* Header */}
                  <div className="flex items-center gap-1.5 p-2 shrink-0">
                    <span className="text-xs font-semibold text-white flex-1 truncate">Selecionar playlists</span>
                  </div>
                  {/* Search */}
                  <div className="px-2 pb-1 shrink-0">
                    <div className="relative">
                      <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-white/40" />
                      <input
                        type="text"
                        value={randomPanelSearch}
                        onChange={(e) => setRandomPanelSearch(e.target.value)}
                        placeholder="Buscar playlist..."
                        className="w-full pl-7 pr-2 py-1 text-[10px] rounded-md border border-border/50 text-white placeholder:text-white/40 focus:outline-none focus:border-primary/50"
                        style={{ background: "#272d38" }}
                      />
                    </div>
                  </div>
                  {/* List */}
                  <div className="flex-1 overflow-y-auto scrollbar-none">
                    {playlists
                      .filter((p) => p.name.toLowerCase().includes(randomPanelSearch.toLowerCase()))
                      .map((p) => {
                        const sel = randomSelectedIds.includes(p.id);
                        return (
                          <div
                            key={p.id}
                            onClick={() => toggleRandomSelected(p.id)}
                            className="flex items-center gap-2 px-2 py-1.5 cursor-pointer hover:bg-white/10 transition-colors"
                          >
                            <Heart className="h-3 w-3 shrink-0" fill={sel ? "currentColor" : "none"} style={{ color: sel ? "#ef4444" : "rgba(255,255,255,0.4)" }} />
                            <span className="text-[10px] text-white truncate flex-1">{cleanPlaylistName(p.name)}</span>
                          </div>
                        );
                      })}
                  </div>
                  {randomSelectedIds.length > 0 && (
                    <div className="px-2 pb-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => { setRandomSelectedIds([]); updatePref("random_playlists", []); }}
                        className="text-[10px] text-white/50 hover:text-white/80 underline"
                      >
                        Limpar seleção
                      </button>
                    </div>
                  )}
                </div>
              )}
              {loadingAllSongs && (
                <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-lg sm:rounded-xl">
                  <Loader2 className="h-6 w-6 text-white animate-spin" />
                </div>
              )}
              {/* Badge de recurso bloqueado — dentro do card */}
              <div className={`absolute inset-0 flex items-center justify-center z-50 pointer-events-none transition-all duration-300 ${lockedCardId === "all-random" ? "opacity-100" : "opacity-0"}`}>
                <div className="flex items-center gap-1 bg-background/95 backdrop-blur-sm border border-border/50 rounded-full px-2 py-1 shadow-md mx-2">
                  <Lock className="h-2.5 w-2.5 text-primary shrink-0" />
                  <p className="text-[10px] font-medium text-foreground leading-tight text-center">Atualize seu plano para usar esse recurso.</p>
                </div>
              </div>
            </div>
          )}
          {sortedFilteredPlaylists.map((playlist) => {
            const isRepositioning = repositionId === playlist.id;
            const displayName = cleanPlaylistName(playlist.name);
            const isExpanded = selectedPlaylist?.id === playlist.id;
            return (
              <React.Fragment key={playlist.id}>
                <div
                  data-playlist-id={playlist.id}
                  onClick={(e) => {
                    if (editingId || isRepositioning) return;

                    // Cancela timer anterior (pode ser de outra playlist)
                    if (clickTimerRef.current) { clearTimeout(clickTimerRef.current); clickTimerRef.current = null; }

                    if (e.detail >= 2) {
                      // Duplo clique detectado pelo browser → abre/fecha painel
                      if (isExpanded) {
                        setSelectedPlaylist(null);
                      } else {
                        setSelectedPlaylist(playlist);
                        setHidePlaybackIndicatorsOnScroll(false);
                        setSongSearch("");
                      }
                      return;
                    }

                    // Clique único → aguarda 280ms para ver se vem duplo clique
                    clickTimerRef.current = setTimeout(async () => {
                      clickTimerRef.current = null;

                      // Monta fila local (músicas da playlist)
                      let finalQueue: PlaylistSong[] = [];
                      const psRes = await authedFetch(`/api/playlist-songs?playlist_id=${playlist.id}`);
                      const psData = await psRes.json();
                      if (psData.songs?.length > 0) {
                        const allSongs: PlaylistSong[] = psData.songs.map((s: any) => ({
                          ...s,
                          isImported: s.file_path?.startsWith("imported/") || s.file_path?.startsWith("youtube:"),
                        }));
                        // Mesma lógica do código antigo: shuffle aleatório simples (evita repetição por ordem)
                        const seen = new Set<string>();
                        finalQueue = allSongs
                          .filter(s => { if (seen.has(s.id)) return false; seen.add(s.id); return true; })
                          .sort(() => Math.random() - 0.5) as PlaylistSong[];
                      }

                      if (finalQueue.length > 0) {
                        const firstSong = finalQueue[0];
                        const isImported = firstSong.file_path?.startsWith("imported/") || firstSong.file_path?.startsWith("youtube:");
                        onQueueChange?.(finalQueue, 0, playlist.id);
                        markSongPlayed(playlist.id, firstSong.id);
                        if (isImported && onPlayImported) {
                          onPlayImported(firstSong);
                        } else {
                          onPlay(firstSong);
                        }
                      }
                    }, 280);
                  }}
                  className={`group text-left rounded-lg sm:rounded-xl border transition-colors relative cursor-pointer min-w-0 overflow-hidden ${
                    isExpanded ? "border-primary/50 ring-1 ring-primary/30" : "border-primary/30"
                  }`}
                  style={{ background: "#f59e0b" }}
                >
                  {/* Cover image area */}
                  <div
                    className="relative aspect-[4/3] sm:aspect-square overflow-hidden"
                    onMouseMove={isRepositioning ? handleDragMove : undefined}
                    onMouseUp={isRepositioning ? handleDragEnd : undefined}
                    onMouseLeave={isRepositioning ? handleDragEnd : undefined}
                  >
                    {/* EduAutoCover sempre como base; imagem cobre quando carrega */}
                    <EduAutoCover className="w-full h-full" />
                    {playlist.cover_url && (
                      <img
                        src={playlist.cover_url}
                        alt=""
                        className="absolute inset-0 w-full h-full object-cover select-none"
                        style={{
                          transform: isRepositioning
                            ? `scale(${imageZoom}) translate(${tempOffset.x}px, ${tempOffset.y}px)`
                            : savedCoverStyles[playlist.id]
                              ? `scale(${savedCoverStyles[playlist.id].zoom}) translate(${savedCoverStyles[playlist.id].x}px, ${savedCoverStyles[playlist.id].y}px)`
                              : "scale(1.1)",
                          cursor: isRepositioning ? "grab" : undefined,
                          transition: isRepositioning ? "none" : "transform 0.3s ease",
                        }}
                        draggable={false}
                        onMouseDown={isRepositioning ? handleDragStart : undefined}
                        onError={(e) => {
                          (e.target as HTMLImageElement).style.display = "none";
                        }}
                      />
                    )}
                    {/* Repositioning controls */}
                    {isRepositioning && (
                      <div className="absolute inset-0 border-2 border-primary/50 rounded-none pointer-events-none">
                        <div className="absolute bottom-2 left-2 right-2 pointer-events-auto" onClick={(e) => e.stopPropagation()}>
                          <div className="bg-background/90 backdrop-blur-sm rounded-lg px-3 py-2 flex items-center gap-2 w-full">
                            <Move className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-[10px] text-muted-foreground shrink-0">Zoom</span>
                            <input
                              type="range"
                              min="1"
                              max="2"
                              step="0.05"
                              value={imageZoom}
                              onChange={(e) => setImageZoom(parseFloat(e.target.value))}
                              className="flex-1 h-1 accent-primary cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Hover overlay with action icons at top */}
                    {!isRepositioning && (
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all duration-200 opacity-0 group-hover:opacity-100">
                        <div className="absolute top-2 right-2 flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={(e) => canFavPlaylist ? togglePlaylistFavorite(playlist.id, e) : showFeatureLocked(e, playlist.id)}
                            title={favSet.has(playlist.id) ? "Remover dos favoritos" : "Favoritar"}
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                              favSet.has(playlist.id)
                                ? "bg-red-500 text-white"
                                : "bg-background/80 text-muted-foreground hover:text-red-400 hover:bg-background"
                            }`}
                          >
                            <Heart className="h-3.5 w-3.5" fill={favSet.has(playlist.id) ? "currentColor" : "none"} />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => canDelete ? handleDeletePlaylist(playlist, e) : showFeatureLocked(e, playlist.id)}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-background transition-colors"
                            title="Excluir"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); canSchedule ? setSchedulePlaylist(playlist) : showFeatureLocked(e, playlist.id); }}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                            title="Programar horário"
                          >
                            <Clock className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={(e) => canEditCover ? triggerImageUpload(playlist.id, e) : showFeatureLocked(e, playlist.id)}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                            title="Trocar capa"
                          >
                            <Camera className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => (canEdit || canEditCover) ? (() => { if (canEdit) startEditing(playlist, e); startReposition(playlist.id, e); })() : showFeatureLocked(e, playlist.id)}
                            className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                            title="Editar playlist"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); e.preventDefault(); onToggleRepeatPlaylist?.(playlist.id); }}
                            title={repeatPlaylistId === playlist.id ? "Repetição ativada" : "Repetir playlist"}
                            className={`w-7 h-7 sm:w-8 sm:h-8 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
                              repeatPlaylistId === playlist.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-background/80 text-muted-foreground hover:text-primary hover:bg-background"
                            }`}
                          >
                            <Repeat className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  {/* Title area */}
                  <div className="p-2 sm:p-3 min-w-0 overflow-hidden">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 min-w-0">
                        {editingId === playlist.id ? (
                          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
                            <input
                              ref={editInputRef}
                              title="Nome da playlist"
                              aria-label="Nome da playlist"
                              value={editingName}
                              onChange={(e) => setEditingName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { saveEditing(); if (repositionId) toast.success("Nome salvo!"); }
                                if (e.key === "Escape") setEditingId(null);
                              }}
                              onBlur={() => saveEditing()}
                              className="bg-secondary/50 border border-border rounded px-2 py-1 text-sm w-full outline-none focus:border-primary truncate"
                            />
                          </div>
                        ) : (
                          <p
                            className="text-xs sm:text-sm font-semibold line-clamp-2 break-words cursor-text overflow-hidden text-white drop-shadow-sm"
                            onDoubleClick={(e) => { e.stopPropagation(); e.preventDefault(); startEditing(playlist, e); }}
                            title="Duplo clique para editar"
                          >
                            {displayName}
                          </p>
                        )}
                      </div>
                      {activePlaylistId === playlist.id && isPlaying && (
                        <div className="shrink-0 animate-pulse">
                          <SpeakerIcon size={20} className="text-white drop-shadow-[0_0_6px_rgba(255,255,255,0.7)]" />
                        </div>
                      )}
                    </div>
                  </div>
                {isExpanded && renderExpandedPanel()}
                {/* Badge de recurso bloqueado — dentro do card */}
                <div className={`absolute inset-0 flex items-center justify-center z-50 pointer-events-none transition-all duration-300 ${lockedCardId === playlist.id ? "opacity-100" : "opacity-0"}`}>
                  <div className="flex items-center gap-1 bg-background/95 backdrop-blur-sm border border-border/50 rounded-full px-2 py-1 shadow-md mx-2">
                    <Lock className="h-2.5 w-2.5 text-primary shrink-0" />
                    <p className="text-[10px] font-medium text-foreground leading-tight text-center">Atualize seu plano para usar esse recurso.</p>
                  </div>
                </div>
              </div>
              </React.Fragment>
            );
          })}
        </div>
      )}
      {/* Schedule dialog */}
      {schedulePlaylist && (
        <PlaylistScheduleDialog
          playlistId={schedulePlaylist.id}
          playlistName={cleanPlaylistName(schedulePlaylist.name)}
          open={!!schedulePlaylist}
          onOpenChange={(open) => { if (!open) setSchedulePlaylist(null); }}
        />
      )}
      {importedPlaylistId && (
        <PlaylistScheduleDialog
          playlistId={importedPlaylistId}
          playlistName="Playlist Importada"
          open={scheduleOpenImport}
          onOpenChange={setScheduleOpenImport}
        />
      )}
      <PlaylistScheduleDialog
        playlistId="pending"
        playlistName="Playlist a importar"
        open={pendingScheduleOpen}
        onOpenChange={setPendingScheduleOpen}
        pendingMode
        onPendingSave={(data) => { setPendingScheduleData(data); setPendingScheduleOpen(false); }}
      />
    </div>
  );
};
export default PlaylistSection;