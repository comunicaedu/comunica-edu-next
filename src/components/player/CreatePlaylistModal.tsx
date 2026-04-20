"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Music, Search, ImagePlus, Loader2, Plus, Trash2, Heart, Play, Pause, Volume2, VolumeX, Clock, Lock } from "lucide-react";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { isYouTubeQuotaExhausted, markYouTubeQuotaExhausted, isQuotaError } from "@/lib/youtubeQuota";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PlaylistScheduleDialog from "@/components/player/PlaylistScheduleDialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { generateEduCover } from "@/lib/generateEduCover";
import { authedFetch } from "@/lib/authedFetch";

interface Song {
  id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  source?: "db" | "youtube";
  youtube_video_id?: string | null;
  file_path?: string;
  isFavorite?: boolean;
}

interface CreatePlaylistModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

const PREVIEW_DURATION_SECONDS = 40;
const PREVIEW_TARGET_LUFS = -14;
const PREVIEW_MIN_GAIN = 0.45;
const PREVIEW_MAX_GAIN = 1.35;
const YOUTUBE_NORMALIZATION_GAIN = 0.78;

let youtubeApiLoaded = false;
let youtubeApiLoading = false;


const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const loadYouTubeAPI = async (): Promise<void> => {
  if (youtubeApiLoaded) return;

  if (youtubeApiLoading) {
    await new Promise<void>((resolve) => {
      const poll = window.setInterval(() => {
        if (youtubeApiLoaded) {
          window.clearInterval(poll);
          resolve();
        }
      }, 100);
    });
    return;
  }

  youtubeApiLoading = true;

  await new Promise<void>((resolve) => {
    const existingScript = document.querySelector('script[src="https://www.youtube.com/iframe_api"]');
    if (!existingScript) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(script);
    }

    window.onYouTubeIframeAPIReady = () => {
      youtubeApiLoaded = true;
      youtubeApiLoading = false;
      resolve();
    };

    if (window.YT?.Player) {
      youtubeApiLoaded = true;
      youtubeApiLoading = false;
      resolve();
    }
  });
};

const CreatePlaylistModal = ({ open, onOpenChange }: CreatePlaylistModalProps) => {
  const { isFeatureLocked, consumeFeature } = useClientFeatures();
  const { prefs, updatePref } = useUserPreferences();
  const canCreate = !isFeatureLocked("criar_playlists");
  const [lockedBadge, setLockedBadge] = useState(false);
  const lockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBadge = () => {
    setLockedBadge(true);
    if (lockedTimer.current) clearTimeout(lockedTimer.current);
    lockedTimer.current = setTimeout(() => setLockedBadge(false), 3000);
  };
  const [name, setName] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [isFeatured, setIsFeatured] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<Song[]>([]);
  const [selectedSongs, setSelectedSongs] = useState<Song[]>([]);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const youtubePreviewRef = useRef<HTMLDivElement | null>(null);
  const youtubePlayerRef = useRef<any>(null);
  const previewStopTimeoutRef = useRef<number | null>(null);
  const previewNormalizerIntervalRef = useRef<number | null>(null);
  const previewAudioContextRef = useRef<AudioContext | null>(null);
  const previewAnalyserRef = useRef<AnalyserNode | null>(null);
  const previewGainRef = useRef<GainNode | null>(null);
  const previewBufferRef = useRef<Float32Array | null>(null);
  const previewSmoothedGainRef = useRef(1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [previewVolume, setPreviewVolume] = useState(0.7);
  const [previewMuted, setPreviewMuted] = useState(false);
  const previewVolumeRef = useRef(0.7);
  const previewMutedRef = useRef(false);

  useEffect(() => {
    if (open) {
      setName("");
      setCoverFile(null);
      setCoverPreview(null);
      setSelectedSongs([]);
      setSearch("");
      setResults([]);
      setPreviewId(null);
      stopPreview();
      // Sync preview volume with main player settings (from prefs)
      try {
        const controls = (prefs.player_controls ?? {}) as Record<string, unknown>;
        const muted = controls.isMuted === true || controls.musicVolume === 0;
        const vol = typeof controls.musicVolume === "number" ? controls.musicVolume : 0.7;
        setPreviewMuted(muted);
        setPreviewVolume(vol);
        previewMutedRef.current = muted;
        previewVolumeRef.current = vol;
      } catch {
        setPreviewMuted(false);
        setPreviewVolume(0.7);
        previewMutedRef.current = false;
        previewVolumeRef.current = 0.7;
      }
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      stopPreview();
    };
  }, [open]);

  const clearPreviewRuntime = useCallback(() => {
    if (previewStopTimeoutRef.current) {
      window.clearTimeout(previewStopTimeoutRef.current);
      previewStopTimeoutRef.current = null;
    }

    if (previewNormalizerIntervalRef.current) {
      window.clearInterval(previewNormalizerIntervalRef.current);
      previewNormalizerIntervalRef.current = null;
    }

    if (previewAudioContextRef.current) {
      previewAudioContextRef.current.close().catch(() => {});
      previewAudioContextRef.current = null;
    }

    previewAnalyserRef.current = null;
    previewGainRef.current = null;
    previewBufferRef.current = null;
    previewSmoothedGainRef.current = 1;
  }, []);

  const stopPreview = useCallback(() => {
    clearPreviewRuntime();

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
      audioRef.current = null;
    }

    if (youtubePlayerRef.current?.destroy) {
      youtubePlayerRef.current.destroy();
      youtubePlayerRef.current = null;
    }

    if (youtubePreviewRef.current) {
      youtubePreviewRef.current.remove();
      youtubePreviewRef.current = null;
    }

    setPreviewId(null);
  }, [clearPreviewRuntime]);

  const schedulePreviewStop = useCallback((milliseconds: number = PREVIEW_DURATION_SECONDS * 1000) => {
    if (previewStopTimeoutRef.current) {
      window.clearTimeout(previewStopTimeoutRef.current);
    }
    previewStopTimeoutRef.current = window.setTimeout(() => stopPreview(), milliseconds);
  }, [stopPreview]);

  const startPreviewNormalization = useCallback((audio: HTMLAudioElement) => {
    clearPreviewRuntime();

    const AudioContextClass = window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) {
      audio.volume = 0.78;
      return;
    }

    const context = new AudioContextClass();
    const source = context.createMediaElementSource(audio);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.75;

    const compressor = context.createDynamicsCompressor();
    compressor.threshold.value = -24;
    compressor.knee.value = 24;
    compressor.ratio.value = 4;
    compressor.attack.value = 0.003;
    compressor.release.value = 0.25;

    const gainNode = context.createGain();
    gainNode.gain.value = 1;

    source.connect(analyser);
    analyser.connect(compressor);
    compressor.connect(gainNode);
    gainNode.connect(context.destination);

    previewAudioContextRef.current = context;
    previewAnalyserRef.current = analyser;
    previewGainRef.current = gainNode;
    previewBufferRef.current = new Float32Array(analyser.fftSize);

    if (context.state === "suspended") {
      context.resume().catch(() => {});
    }

    previewNormalizerIntervalRef.current = window.setInterval(() => {
      const a = previewAnalyserRef.current;
      const g = previewGainRef.current;
      const b = previewBufferRef.current;

      if (!a || !g || !b || audio.paused || audio.ended) return;

      a.getFloatTimeDomainData(b as unknown as Float32Array<ArrayBuffer>);

      let sumSquares = 0;
      for (let i = 0; i < b.length; i += 1) {
        sumSquares += b[i] * b[i];
      }

      const rms = Math.sqrt(sumSquares / b.length);
      const dbfs = 20 * Math.log10(Math.max(rms, 1e-4));
      const estimatedLufs = dbfs + 23;
      const gainDeltaDb = PREVIEW_TARGET_LUFS - estimatedLufs;
      const targetGain = clamp(Math.pow(10, gainDeltaDb / 20), PREVIEW_MIN_GAIN, PREVIEW_MAX_GAIN);

      const previous = previewSmoothedGainRef.current;
      const smoothing = targetGain < previous ? 0.22 : 0.08;
      const next = previous + (targetGain - previous) * smoothing;

      previewSmoothedGainRef.current = next;
      g.gain.value = next;
    }, 220);
  }, [clearPreviewRuntime]);

  const resolveVideoId = useCallback((song: Song) => {
    return (
      song.youtube_video_id ||
      (song.file_path?.startsWith("youtube:") ? song.file_path.replace("youtube:", "") : null) ||
      (song.source === "youtube" ? song.id.replace("yt_", "") : null)
    );
  }, []);

  const playYouTubePreview = useCallback(async (videoId: string, songId: string) => {
    await loadYouTubeAPI();

    if (!window.YT?.Player) {
      throw new Error("Player externo indisponível.");
    }

    const startAt = 42; // first chorus in most pop songs lands ~42-52 s in
    const endAt = startAt + PREVIEW_DURATION_SECONDS;

    const host = document.createElement("div");
    const innerId = `yt-preview-${Date.now()}`;
    const innerDiv = document.createElement("div");
    innerDiv.id = innerId;
    host.appendChild(innerDiv);
    host.style.position = "fixed";
    host.style.width = "1px";
    host.style.height = "1px";
    host.style.opacity = "0";
    host.style.pointerEvents = "none";
    host.style.bottom = "0";
    host.style.left = "0";
    document.body.appendChild(host);
    youtubePreviewRef.current = host;

    youtubePlayerRef.current = new window.YT.Player(innerId, {
      videoId,
      playerVars: {
        autoplay: 1,
        controls: 0,
        disablekb: 1,
        fs: 0,
        modestbranding: 1,
        rel: 0,
        playsinline: 1,
        start: startAt,
        end: endAt,
      },
      events: {
        onReady: (event: any) => {
          const ytVolume = previewMutedRef.current
            ? 0
            : Math.round(previewVolumeRef.current * YOUTUBE_NORMALIZATION_GAIN * 100);
          event.target.setVolume(ytVolume);
          event.target.playVideo();
          setPreviewId(songId);
          schedulePreviewStop(PREVIEW_DURATION_SECONDS * 1000);
        },
        onStateChange: (event: any) => {
          if (event.data === window.YT.PlayerState.ENDED) {
            stopPreview();
          }
        },
        onError: () => {
          stopPreview();
          toast.error("Não foi possível reproduzir a prévia.");
        },
      },
    });
  }, [schedulePreviewStop, stopPreview]);

  const playLocalPreview = useCallback(async (song: Song) => {
    if (!song.file_path || song.file_path.startsWith("youtube:")) {
      return false;
    }

    const fp = song.file_path;
    const directUrl = fp.startsWith("direct:") ? fp.replace("direct:", "") : null;
    // If already a full URL (resolved by API) use it directly; otherwise resolve via storage
    const publicUrl = directUrl
      ? directUrl
      : fp.startsWith("http")
        ? fp
        : supabase.storage.from("audio").getPublicUrl(fp).data.publicUrl;

    const audio = new Audio(publicUrl);
    audio.crossOrigin = "anonymous";
    audio.preload = "metadata";
    audio.volume = previewMutedRef.current ? 0 : previewVolumeRef.current;

    await new Promise<void>((resolve, reject) => {
      const onLoaded = () => resolve();
      const onError = () => reject(new Error("metadata-error"));
      audio.addEventListener("loadedmetadata", onLoaded, { once: true });
      audio.addEventListener("error", onError, { once: true });

      if (audio.readyState >= 1) {
        resolve();
      }
    });

    const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
    const desiredWindow = Math.min(PREVIEW_DURATION_SECONDS, duration || PREVIEW_DURATION_SECONDS);
    // Pop choruses typically land between 30-52 s regardless of song length.
    // 28% of duration is a better estimate than 35% (which overshoots into verse 2).
    const startAt = duration > PREVIEW_DURATION_SECONDS + 20
      ? Math.max(30, Math.min(52, duration * 0.28))
      : 0;

    if (startAt > 0) {
      audio.currentTime = startAt;
    }

    startPreviewNormalization(audio);
    await audio.play();

    audioRef.current = audio;
    setPreviewId(song.id);
    audio.onended = () => stopPreview();

    const availableSeconds = duration > 0
      ? Math.max(3, Math.min(PREVIEW_DURATION_SECONDS, duration - startAt))
      : PREVIEW_DURATION_SECONDS;
    schedulePreviewStop(availableSeconds * 1000);

    return true;
  }, [schedulePreviewStop, startPreviewNormalization, stopPreview]);

  const searchPreviewFallback = useCallback(async (song: Song) => {
    if (isYouTubeQuotaExhausted()) return null;
    try {
      const { data, error } = await supabase.functions.invoke("youtube-search", {
        body: {
          query: `${song.title} ${song.artist ?? ""}`.trim(),
          title: song.title,
          artist: song.artist ?? "",
        },
      });

      if (error) {
        if (isQuotaError(String(error?.message ?? error))) markYouTubeQuotaExhausted();
        return null;
      }
      if (!data?.videoId) return null;
      if (data?.quotaExceeded || isQuotaError(String(data?.error ?? ""))) {
        markYouTubeQuotaExhausted();
        return null;
      }

      return data.videoId as string;
    } catch {
      return null;
    }
  }, []);

  const togglePreview = async (song: Song, e: React.MouseEvent) => {
    e.stopPropagation();

    if (previewId === song.id) {
      stopPreview();
      return;
    }

    // Pause the main player while previewing
    window.dispatchEvent(new CustomEvent("modal-preview-started"));
    stopPreview();

    // Try local file first
    let playedLocal = false;
    try {
      playedLocal = await playLocalPreview(song);
    } catch {
      playedLocal = false; // local failed, try YouTube below
    }
    if (playedLocal) return;

    // Try YouTube (known ID or search fallback)
    try {
      const knownVideoId = resolveVideoId(song);
      const videoId = knownVideoId || await searchPreviewFallback(song);
      if (videoId) {
        await playYouTubePreview(videoId, song.id);
        return;
      }
    } catch {
      // all methods failed
    }

    toast.error("Não foi possível reproduzir a prévia.");
  };

  const searchDB = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return; }
    setSearching(true);

    try {
      const res = await authedFetch(`/api/songs?search=${encodeURIComponent(q)}`);
      const data = await res.json();
      const songs: any[] = data.songs ?? data ?? [];

      const quotaOut = isYouTubeQuotaExhausted();
      const dbSongs: Song[] = songs
        .filter(s => {
          const fp = s.file_path ?? "";
          const hasLocal = fp && !fp.startsWith("youtube:") && !fp.startsWith("imported/");
          const hasYtPath = fp.startsWith("youtube:") && !fp.includes("pending");
          const hasVideoId = !!(s.youtube_video_id && s.youtube_video_id !== "pending" && s.youtube_video_id.length >= 5);
          // When quota is exhausted only show songs with a real local file
          if (quotaOut) return !!hasLocal;
          return !!(hasLocal || hasYtPath || hasVideoId);
        })
        .map(s => ({ ...s, source: "db" as const }));
      setResults(dbSongs);
      // Only append YouTube search result when quota is available
      if (!quotaOut) searchYouTube(q, dbSongs);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, []);

  const searchYouTube = async (q: string, existingResults: Song[]) => {
    if (isYouTubeQuotaExhausted()) return;
    try {
      const { data, error } = await supabase.functions.invoke("youtube-search", {
        body: { query: q, title: q, artist: "" },
      });

      if (error) {
        if (isQuotaError(String(error?.message ?? error))) markYouTubeQuotaExhausted();
        setResults(existingResults);
        return;
      }

      if (!data?.videoId) { setResults(existingResults); return; }

      // Detect quota signal inside data
      if (data?.quotaExceeded || isQuotaError(String(data?.error ?? ""))) {
        markYouTubeQuotaExhausted();
        setResults(existingResults);
        return;
      }

      const ytSong: Song = {
        id: `yt_${data.videoId}`,
        title: data.title || q,
        artist: data.artist || null,
        cover_url: data.thumbnail || `https://img.youtube.com/vi/${data.videoId}/mqdefault.jpg`,
        source: "youtube" as const,
        youtube_video_id: data.videoId,
      };

      setResults([...existingResults, ytSong]);
    } catch {
      setResults(existingResults);
    }
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => searchDB(value), 400);
  };

  const applyVolumeLive = (vol: number, muted: boolean) => {
    const effective = muted ? 0 : vol;
    if (audioRef.current) audioRef.current.volume = effective;
    if (youtubePlayerRef.current?.setVolume) {
      youtubePlayerRef.current.setVolume(Math.round(effective * YOUTUBE_NORMALIZATION_GAIN * 100));
    }
  };

  const handlePreviewVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = Number(e.target.value);
    previewVolumeRef.current = vol;
    setPreviewVolume(vol);
    if (previewMutedRef.current && vol > 0) {
      previewMutedRef.current = false;
      setPreviewMuted(false);
    }
    applyVolumeLive(vol, false);
  };

  const handlePreviewMuteToggle = () => {
    const next = !previewMutedRef.current;
    previewMutedRef.current = next;
    setPreviewMuted(next);
    applyVolumeLive(previewVolumeRef.current, next);
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so same file can be reselected after clearing
    e.target.value = "";
    if (!file || !file.type.startsWith("image/")) return;
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const addSong = (song: Song) => {
    if (selectedSongs.find(s => s.id === song.id)) return;
    setSelectedSongs(prev => [...prev, song]);
  };

  const removeSong = (id: string) => {
    setSelectedSongs(prev => prev.filter(s => s.id !== id));
  };

  const toggleFavorite = (id: string) => {
    setSelectedSongs(prev => prev.map(s => s.id === id ? { ...s, isFavorite: !s.isFavorite } : s));
  };

  // Generate auto-cover: dark background + EDU logo centered (no text, just the icon)
  const generateAutoCover = useCallback(
    (seed: string) => generateEduCover(seed),
    []
  );

  // Insert playlist — on duplicate name, appends invisible zero-width spaces
  // so the user always sees exactly the name they typed
  const insertPlaylist = useCallback(async (baseName: string, userId: string | null) => {
    let suffix = "";
    for (let attempt = 0; attempt < 20; attempt++) {
      const { data, error } = await supabase
        .from("playlists")
        .insert({ name: baseName + suffix, created_by: userId, is_public: true })
        .select("id, name, description, cover_url, is_public, created_by, created_at")
        .single();

      if (!error && data) return data;

      const isDuplicate =
        error?.code === "23505" ||
        error?.message?.includes("unique") ||
        error?.message?.includes("duplicate");

      if (!isDuplicate) {
        console.error("Playlist creation error:", error);
        throw new Error("Erro ao criar playlist. Verifique sua conexão.");
      }

      // Name taken → silently append an invisible zero-width space (user never sees it)
      suffix += "\u200b";
    }
    throw new Error("Erro ao criar playlist. Verifique sua conexão.");
  }, []);

  const handleCreate = async () => {
    if (!name.trim()) { toast.error("Digite o nome da playlist."); return; }

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || null;

      // Create playlist (auto-retries on duplicate name)
      const playlist = await insertPlaylist(name.trim(), userId);

      let createdPlaylist = playlist;

      // Upload user-chosen cover OR generate auto-cover
      const coverToUpload: Blob | File | null =
        coverFile ?? await generateAutoCover((userId ?? "") + playlist.id);

      if (coverToUpload) {
        const ext = coverFile ? (coverFile.name.split(".").pop() ?? "png") : "png";
        const path = `covers/${playlist.id}_${Date.now()}.${ext}`;
        await supabase.storage.from("audio").upload(path, coverToUpload, { upsert: true });
        const { data: urlData } = supabase.storage.from("audio").getPublicUrl(path);
        await supabase.from("playlists").update({ cover_url: urlData.publicUrl }).eq("id", playlist.id);
        createdPlaylist = { ...createdPlaylist, cover_url: urlData.publicUrl };
      }

      // Add selected songs — only exactly the songs the user selected
      if (selectedSongs.length > 0) {
        const songIdMap: Map<string, string> = new Map(); // original id -> real db id

        for (const song of selectedSongs) {
          // All songs from DB search already have real IDs — use them directly.
          // Only insert a new DB row for truly external YouTube results (source === "youtube"),
          // which no longer appear since we removed the YouTube search fallback.
          // This block is kept as a safety net but should never trigger.
          if (song.source === "youtube" && song.youtube_video_id && !song.id.match(/^[0-9a-f-]{36}$/i)) {
            // Check if already in DB first to avoid duplicates
            const { data: existing } = await supabase
              .from("songs")
              .select("id")
              .eq("youtube_video_id", song.youtube_video_id)
              .maybeSingle();

            if (existing) {
              songIdMap.set(song.id, existing.id);
            } else {
              const { data: newSong } = await supabase
                .from("songs")
                .insert({
                  title: song.title,
                  artist: song.artist,
                  cover_url: song.cover_url,
                  file_path: `youtube:${song.youtube_video_id}`,
                  youtube_video_id: song.youtube_video_id,
                  uploaded_by: userId,
                })
                .select("id")
                .single();
              if (newSong) songIdMap.set(song.id, newSong.id);
            }
          } else {
            songIdMap.set(song.id, song.id);
          }
        }

        // Clear any stale links first (safeguard against double-submit)
        await supabase.from("playlist_songs").delete().eq("playlist_id", playlist.id);

        const realIds = Array.from(songIdMap.values());
        if (realIds.length > 0) {
          const links = realIds.map((songId, idx) => ({
            playlist_id: playlist.id,
            song_id: songId,
            position: idx + 1,
          }));
          const { error: linksError } = await supabase.from("playlist_songs").insert(links);
          if (linksError) console.error("playlist_songs insert error:", linksError);
        }

        // Save favorites
        const favSongs = selectedSongs.filter(s => s.isFavorite);
        if (favSongs.length > 0 && userId) {
          const favInserts = favSongs
            .map(fav => {
              const realId = songIdMap.get(fav.id);
              return realId ? { user_id: userId, song_id: realId, playlist_id: playlist.id } : null;
            })
            .filter((f): f is NonNullable<typeof f> => f !== null);
          if (favInserts.length > 0) {
            await supabase.from("user_favorites").insert(favInserts);
          }
        }
      }

      // Marcar como destaque se o coração foi ativado
      if (isFeatured) {
        const current = prefs.fav_playlists ?? [];
        if (!current.includes(createdPlaylist.id)) {
          updatePref("fav_playlists", [...current, createdPlaylist.id]);
        }
        await authedFetch("/api/playlists", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: createdPlaylist.id, is_featured: true }),
        }).catch(() => {});
      }

      setCreatedPlaylistId(createdPlaylist.id);
      window.dispatchEvent(new CustomEvent("playlist-created", { detail: { playlist: createdPlaylist } }));

      await consumeFeature("criar_playlists");
      stopPreview();
      toast.success(`Playlist "${name.trim()}" criada!`);
      if (!isFeatured) onOpenChange(false);
    } catch (err: any) {
      console.error("Create playlist error:", err);
      toast.error(err.message || "Erro ao criar playlist.");
    } finally {
      setSaving(false);
    }
  };

  const isAlreadySelected = (id: string) => selectedSongs.some(s => s.id === id);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent hideCloseButton className="sm:max-w-md h-[460px] overflow-y-hidden flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="flex items-center gap-2 text-white">
            <Music className="h-5 w-5 text-primary" /> Criar Playlist
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col pt-2 flex-1 min-h-0 gap-3 overflow-hidden">

          {/* FIXED: capa + nome + barra de pesquisa — nunca rola */}
          <div className="shrink-0 space-y-3">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => coverRef.current?.click()}
                className="w-20 h-20 rounded-lg border-2 border-dashed border-muted-foreground/40 hover:border-primary/70 transition-colors flex items-center justify-center overflow-hidden bg-secondary/30 shrink-0"
              >
                {coverPreview ? (
                  <img src={coverPreview} alt="Capa" className="w-full h-full object-cover" />
                ) : (
                  <ImagePlus className="h-7 w-7 text-muted-foreground" />
                )}
              </button>
              <input ref={coverRef} type="file" accept="image/*" onChange={handleCoverChange} className="hidden" title="Capa da playlist" aria-label="Capa da playlist" />
              <div className="flex-1 space-y-2">
                <Label className="text-xs text-muted-foreground">Nome da Playlist</Label>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Ex: Minha Playlist"
                    className="bg-secondary/50 border-muted flex-1"
                  />
                  <button type="button" onClick={() => setIsFeatured(!isFeatured)} title="Destacar playlist para todos" className="shrink-0 transition-colors">
                    <Heart className={`h-5 w-5 transition-colors ${isFeatured ? "fill-primary text-primary" : "text-muted-foreground hover:text-primary"}`} />
                  </button>
                  <button type="button" onClick={() => { if (createdPlaylistId) setScheduleOpen(true); else toast.info("Crie a playlist primeiro para agendar."); }} title="Agendar playlist" className="shrink-0 transition-colors">
                    <Clock className="h-5 w-5 text-muted-foreground hover:text-primary transition-colors" />
                  </button>
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">
                Adicionar Músicas {selectedSongs.length > 0 && <span className="text-primary">({selectedSongs.length})</span>}
              </Label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Pesquisar por nome, artista ou gênero..."
                  className="pl-9 bg-secondary/50 border-muted text-sm focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary"
                />
              </div>
            </div>

            {/* Volume control — fixed height always reserved, only opacity changes (no layout shift) */}
            <div className="h-6 flex items-center">
              <div
                className={`flex items-center gap-2 px-1 w-full transition-opacity duration-150 ${
                  previewId ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
              >
                <button
                  type="button"
                  onClick={handlePreviewMuteToggle}
                  className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                  title={previewMuted ? "Desmutar prévia" : "Mutar prévia"}
                >
                  {previewMuted || previewVolume === 0
                    ? <VolumeX className="h-4 w-4" />
                    : <Volume2 className="h-4 w-4" />
                  }
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.01}
                  value={previewMuted ? 0 : previewVolume}
                  onChange={handlePreviewVolumeChange}
                  title="Volume da prévia"
                  className="flex-1 h-1 accent-primary cursor-pointer"
                />
                <span className="text-xs text-muted-foreground w-7 text-right shrink-0">
                  {previewMuted ? "0%" : `${Math.round(previewVolume * 100)}%`}
                </span>
              </div>
            </div>
          </div>

          {/* SCROLLABLE: resultados + selecionadas — rola sem mostrar scrollbar */}
          <div className="flex-1 min-h-0 overflow-y-auto scrollbar-none overflow-x-hidden space-y-3">
            {/* Search results */}
            <div className="space-y-0.5 rounded-lg">
              {searching ? (
                <div className="text-center py-6 text-muted-foreground text-sm">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" /> Buscando...
                </div>
              ) : !search.trim() ? (
                <p className="text-center py-4 text-muted-foreground text-xs">Digite para buscar músicas ou gênero.</p>
              ) : (
                <>
                  {results.map((song) => {
                    const selected = isAlreadySelected(song.id);
                    return (
                      <div
                        key={song.id}
                        className={`flex items-center gap-3 w-full p-2 rounded-lg transition-colors ${
                          selected ? "opacity-40" : "hover:bg-secondary/50"
                        }`}
                      >
                        {/* Preview play — local MP3 e YouTube */}
                        <button
                          type="button"
                          onClick={(e) => togglePreview(song, e)}
                          className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-primary text-primary-foreground hover:shadow-[0_0_8px_hsl(var(--primary)/0.5)] transition-all"
                          title="Ouvir prévia"
                        >
                          {previewId === song.id ? (
                            <Pause className="h-3 w-3" />
                          ) : (
                            <Play className="h-3 w-3 ml-0.5" />
                          )}
                        </button>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{song.title}</p>
                          {song.artist && <p className="text-xs text-muted-foreground truncate">{song.artist}</p>}
                        </div>
                        {!selected && (
                          <button
                            onClick={() => addSong(song)}
                            className="shrink-0 p-1 rounded-full hover:bg-primary/20 transition-colors"
                            title="Adicionar"
                          >
                            <Plus className="h-4 w-4 text-primary" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {results.length === 0 && (
                    <p className="text-center py-4 text-muted-foreground text-xs">Nenhum resultado encontrado.</p>
                  )}
                </>
              )}
            </div>

            {/* Selected songs */}
            {selectedSongs.length > 0 && (
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Selecionadas ({selectedSongs.length})</Label>
                <div className="space-y-0.5">
                  {selectedSongs.map(song => (
                    <div
                      key={song.id}
                      className="flex items-center gap-2 p-1.5 rounded-lg bg-secondary/30"
                    >
                      <button
                        onClick={(e) => togglePreview(song, e)}
                        className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-primary text-primary-foreground hover:shadow-[0_0_8px_hsl(var(--primary)/0.5)] transition-all"
                        title="Ouvir prévia"
                      >
                        {previewId === song.id ? (
                          <Pause className="h-3 w-3" />
                        ) : (
                          <Play className="h-3 w-3 ml-0.5" />
                        )}
                      </button>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium truncate">{song.title}</p>
                      </div>
                      <button
                        onClick={() => toggleFavorite(song.id)}
                        className="shrink-0 p-1 rounded-full hover:bg-primary/20 transition-colors"
                        title="Favoritar"
                      >
                        <Heart className={`h-3.5 w-3.5 ${song.isFavorite ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                      </button>
                      <button
                        onClick={() => removeSong(song.id)}
                        className="shrink-0 p-1 rounded-full hover:bg-destructive/20 transition-colors"
                        title="Remover"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Badge de upgrade */}
          <div className={`relative flex justify-center pointer-events-none transition-all duration-300 ${lockedBadge ? "opacity-100" : "opacity-0 -translate-y-1"}`}>
            <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
              <Lock className="h-3 w-3 text-primary shrink-0" />
              <p className="text-xs font-medium text-foreground">Atualize seu plano para usar esse recurso.</p>
            </div>
          </div>

          <Button
            onClick={canCreate ? handleCreate : showBadge}
            disabled={!canCreate ? false : (saving || !name.trim())}
            className="w-full shrink-0 font-semibold bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] transition-all"
          >
            {saving ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Criando...</>
            ) : (
              <><Music className="h-4 w-4 mr-2" /> Criar Playlist</>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>

    {createdPlaylistId && (
      <PlaylistScheduleDialog
        playlistId={createdPlaylistId}
        playlistName={name || "Playlist"}
        open={scheduleOpen}
        onOpenChange={setScheduleOpen}
      />
    )}
  </>
  );
};

export default CreatePlaylistModal;