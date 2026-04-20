"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack,
  Mic, Clock, GripHorizontal, Repeat1, Wifi, WifiOff, Radio, SlidersHorizontal
} from "lucide-react";
import EduLogoIcon from "./EduLogoIcon";
import { authedFetch } from "@/lib/authedFetch";

interface QueueItem {
  id: string;
  position: number;
  title: string;
  artist: string | null;
  file_path: string;
  cover_url: string | null;
  youtube_video_id: string | null;
  item_type: string;
  playlist_name?: string | null;
}

const formatTime = (s: number) => {
  if (!s || isNaN(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const IDLE_MS = 10_000;

export default function EmbedPlayerClient({ ownerId, mode = "mirror" }: { ownerId: string; mode?: "mirror" | "independent" }) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueIndex, setQueueIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(80);
  const [expanded, setExpanded] = useState(false);
  const [showVolumeMix, setShowVolumeMix] = useState(false);
  const [repeatSong, setRepeatSong] = useState(false);
  const [isModoOff, setIsModoOff] = useState(false);
  const [locutorOpen, setLocutorOpen] = useState(false);
  const [ytReady, setYtReady] = useState(false);
  const [ytPlayerCreated, setYtPlayerCreated] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ytContainerRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const movedRef = useRef(false);
  const offsetRef = useRef({ x: 0, y: 0 });
  const startPosRef = useRef({ x: 0, y: 0 });
  const isPlayingRef = useRef(false);
  const queueIndexRef = useRef(0);
  const repeatRef = useRef(false);
  const pausedByFocusRef = useRef(false);
  const [dragging, setDragging] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    setPosition({ x: Math.max(12, window.innerWidth - 80), y: Math.max(12, window.innerHeight - 90) });
    setMounted(true);
  }, []);

  const currentItem = queue[queueIndex] ?? null;
  const nextItem = queue[queueIndex + 1] ?? null;
  const isYouTube = !!currentItem?.youtube_video_id;

  // Mantém refs sincronizados
  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { queueIndexRef.current = queueIndex; }, [queueIndex]);
  useEffect(() => { repeatRef.current = repeatSong; }, [repeatSong]);

  // Idle timer
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      setExpanded(false);
      setShowVolumeMix(false);
    }, IDLE_MS);
  }, []);

  useEffect(() => {
    if (expanded) resetIdleTimer();
    return () => { if (idleTimerRef.current) clearTimeout(idleTimerRef.current); };
  }, [expanded, resetIdleTimer]);

  // Click fora → bolinha
  useEffect(() => {
    if (!expanded) return;
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) {
        setExpanded(false);
        setShowVolumeMix(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [expanded]);

  // PWA manifest + SW
  useEffect(() => {
    document.querySelectorAll('link[rel="manifest"]').forEach(el => el.remove());
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = `/player/embed/manifest.json?client=${ownerId}`;
    document.head.appendChild(link);
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    return () => { link.remove(); };
  }, [ownerId]);

  // Guarda o evento de instalação PWA (prompt só pode ser chamado por gesto do usuário)
  useEffect(() => {
    const handler = (e: Event) => { e.preventDefault(); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // MediaSession — metadata + ações
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentItem?.title ?? "ComunicaEDU",
      artist: currentItem?.artist ?? "Rádio",
      artwork: [{ src: "/icon-512.png", sizes: "512x512", type: "image/png" }],
    });
    navigator.mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [currentItem, isPlaying]);

  // Detecção de foco de áudio — pausa quando outra fonte (YouTube, Spotify...) assume
  useEffect(() => {
    if (!("mediaSession" in navigator)) return;

    const handleExternalPause = () => {
      // Só pausa se estava tocando e não foi pausado pelo próprio usuário
      if (isPlayingRef.current) {
        pausedByFocusRef.current = true;
        if (isYouTube) ytPlayerRef.current?.pauseVideo();
        else audioRef.current?.pause();
        setIsPlaying(false);
      }
    };

    const handleExternalPlay = () => {
      // Retoma se foi pausado por perda de foco
      if (pausedByFocusRef.current) {
        pausedByFocusRef.current = false;
        if (isYouTube) ytPlayerRef.current?.playVideo();
        else audioRef.current?.play().catch(() => {});
        setIsPlaying(true);
      }
    };

    navigator.mediaSession.setActionHandler("pause", handleExternalPause);
    navigator.mediaSession.setActionHandler("play", handleExternalPlay);
    navigator.mediaSession.setActionHandler("nexttrack", () => {
      setQueueIndex(i => Math.min(i + 1, queue.length - 1));
    });
    navigator.mediaSession.setActionHandler("previoustrack", () => {
      setQueueIndex(i => Math.max(i - 1, 0));
    });

    return () => {
      try {
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
      } catch {}
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isYouTube, queue.length]);

  // Carrega YouTube IFrame API
  useEffect(() => {
    if ((window as any).YT?.Player) { setYtReady(true); return; }
    (window as any).onYouTubeIframeAPIReady = () => setYtReady(true);
    if (!document.querySelector('script[src*="youtube.com/iframe_api"]')) {
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
    }
  }, []);

  // Cria o player do YouTube (oculto)
  useEffect(() => {
    if (!ytReady || !ytContainerRef.current || ytPlayerRef.current) return;
    ytPlayerRef.current = new (window as any).YT.Player(ytContainerRef.current, {
      height: "0",
      width: "0",
      playerVars: { autoplay: 0, controls: 0, playsinline: 1 },
      events: {
        onReady: () => { setYtPlayerCreated(true); },
        onStateChange: (e: any) => {
          const YT = (window as any).YT.PlayerState;
          if (e.data === YT.PLAYING) { setIsPlaying(true); pausedByFocusRef.current = false; }
          if (e.data === YT.PAUSED) setIsPlaying(false);
          if (e.data === YT.ENDED) {
            if (repeatRef.current) {
              ytPlayerRef.current?.seekTo(0);
              ytPlayerRef.current?.playVideo();
            } else {
              setQueueIndex(i => Math.min(i + 1, queue.length - 1));
            }
          }
        },
        onError: () => {
          setQueueIndex(i => Math.min(i + 1, queue.length - 1));
        },
      },
    });
  }, [ytReady, queue.length]);

  // Carrega música quando item muda
  useEffect(() => {
    if (!currentItem) return;

    if (currentItem.youtube_video_id) {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      if (isPlayingRef.current) {
        ytPlayerRef.current?.loadVideoById?.(currentItem.youtube_video_id);
      } else {
        ytPlayerRef.current?.cueVideoById?.(currentItem.youtube_video_id);
      }
    } else {
      ytPlayerRef.current?.pauseVideo();
      const fp = currentItem.file_path;
      if (!fp) return;
      let url = "";
      if (fp.startsWith("direct:")) url = fp.slice(7);
      else if (fp.startsWith("http")) url = fp;
      else url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/audio/${fp}`;
      if (!url || !audioRef.current) return;
      audioRef.current.src = url;
      audioRef.current.volume = volume / 100;
      if (isPlayingRef.current) audioRef.current.play().catch(() => {});
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentItem, ytPlayerCreated]);

  // ── MODO ESPELHO: lê localStorage do player principal ──────────────────────
  const loadFromStorage = useCallback(async () => {
    if (mode !== "mirror") return;
    try {
      const raw = localStorage.getItem("edu-player-state");
      if (!raw) return;
      const state = JSON.parse(raw);

      let playlistName: string | null = null;
      if (state.playlistId) {
        try {
          const res = await authedFetch("/api/playlists");
          if (res.ok) {
            const { playlists } = await res.json();
            const found = playlists?.find((p: any) => p.id === state.playlistId);
            if (found) playlistName = found.name;
          }
        } catch {}
      }

      const songs: QueueItem[] = (state.queue ?? []).map((s: any, i: number) => ({
        id: s.id,
        position: i,
        title: s.title,
        artist: s.artist ?? null,
        file_path: s.file_path ?? "",
        cover_url: s.cover_url ?? null,
        youtube_video_id: s.youtube_video_id ?? null,
        item_type: "song",
        playlist_name: playlistName,
      }));
      if (songs.length > 0) setQueue(songs);
      if (state.queueIndex != null) setQueueIndex(state.queueIndex);
    } catch {}
  }, [mode]);

  useEffect(() => {
    if (mode !== "mirror") return;
    loadFromStorage();
    const handler = (e: StorageEvent) => {
      if (e.key === "edu-player-state") loadFromStorage();
    };
    window.addEventListener("storage", handler);
    return () => window.removeEventListener("storage", handler);
  }, [mode, loadFromStorage]);

  // ── MODO INDEPENDENTE: busca playlists do cliente via API ───────────────────
  useEffect(() => {
    if (mode !== "independent") return;
    fetch(`/api/embed/playlists?owner_id=${ownerId}`)
      .then(r => r.json())
      .then(({ queue: q }) => {
        if (Array.isArray(q) && q.length > 0) setQueue(q as QueueItem[]);
      })
      .catch(() => {});
  }, [mode, ownerId]);

  // Atualiza volume no player ativo
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume / 100;
    if (ytPlayerRef.current?.setVolume) ytPlayerRef.current.setVolume(volume);
  }, [volume]);

  // Progresso do YouTube
  useEffect(() => {
    if (!isPlaying || !isYouTube) return;
    const interval = setInterval(() => {
      if (!ytPlayerRef.current?.getCurrentTime) return;
      const ct = ytPlayerRef.current.getCurrentTime();
      const dur = ytPlayerRef.current.getDuration() || 0;
      setCurrentTime(ct);
      setDuration(dur);
      setProgress(dur ? (ct / dur) * 100 : 0);
    }, 500);
    return () => clearInterval(interval);
  }, [isPlaying, isYouTube]);

  // Drag da bolinha
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    offsetRef.current = { x: e.clientX - position.x, y: e.clientY - position.y };
    setDragging(true);
  }, [position]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: PointerEvent) => {
      if (Math.abs(e.clientX - startPosRef.current.x) > 3 || Math.abs(e.clientY - startPosRef.current.y) > 3) movedRef.current = true;
      setPosition({
        x: Math.max(12, Math.min(window.innerWidth - 60, e.clientX - offsetRef.current.x)),
        y: Math.max(12, Math.min(window.innerHeight - 70, e.clientY - offsetRef.current.y)),
      });
    };
    const onUp = () => setDragging(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); };
  }, [dragging]);

  const handlePlayPause = useCallback(() => {
    pausedByFocusRef.current = false;
    if (isYouTube) {
      if (isPlaying) ytPlayerRef.current?.pauseVideo();
      else ytPlayerRef.current?.playVideo();
    } else {
      if (!audioRef.current) return;
      if (isPlaying) audioRef.current.pause();
      else audioRef.current.play().catch(() => {});
    }
  }, [isYouTube, isPlaying]);

  const handleNext = useCallback(() => {
    setQueueIndex(i => Math.min(i + 1, queue.length - 1));
  }, [queue.length]);

  const handlePrev = useCallback(() => {
    setQueueIndex(i => Math.max(i - 1, 0));
  }, []);

  const handleClick = () => {
    if (movedRef.current) { movedRef.current = false; return; }
    setExpanded(true);
  };

  const desktopLeft = mounted
    ? Math.min(position.x, window.innerWidth - Math.min(window.innerWidth * 0.9, 500))
    : position.x;
  const desktopTop = mounted
    ? Math.max(0, Math.min(position.y - 190, window.innerHeight - 300))
    : position.y;

  if (!mounted) return null;

  return (
    <>
      {/* Player de áudio */}
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          const a = audioRef.current;
          if (!a) return;
          setCurrentTime(a.currentTime);
          setDuration(a.duration || 0);
          setProgress(a.duration ? (a.currentTime / a.duration) * 100 : 0);
        }}
        onEnded={() => {
          if (repeatSong) { audioRef.current!.currentTime = 0; audioRef.current!.play().catch(() => {}); }
          else handleNext();
        }}
        onPlay={() => { setIsPlaying(true); pausedByFocusRef.current = false; }}
        onPause={() => setIsPlaying(false)}
      />

      {/* Container oculto do YouTube */}
      <div ref={ytContainerRef} style={{ position: "absolute", width: 0, height: 0, overflow: "hidden", pointerEvents: "none" }} />

      {/* Bolinha */}
      {!expanded && (
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.35 }}
          onPointerDown={handlePointerDown}
          onClick={handleClick}
          className="fixed z-[100] w-12 h-12 rounded-full bg-sidebar-background border-2 shadow-2xl flex items-center justify-center select-none overflow-hidden cursor-grab active:cursor-grabbing"
          style={{ border: "2px solid hsl(var(--primary))", left: position.x, top: position.y }}
          title="Abrir Player"
        >
          <EduLogoIcon fillContainer />
          {isPlaying && <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-pulse" />}
        </motion.div>
      )}

      {/* Card expandido */}
      {expanded && (
        <AnimatePresence>
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="fixed z-[100] w-auto sm:w-[95vw] max-w-xl"
            style={{ left: desktopLeft, top: desktopTop }}
            onPointerMove={resetIdleTimer}
            onClick={resetIdleTimer}
          >
            <div ref={cardRef} className="bg-sidebar-background/95 backdrop-blur-xl border border-sidebar-border rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden">
              <div className="flex items-center justify-center pt-1.5 pb-0.5 cursor-grab active:cursor-grabbing" onPointerDown={handlePointerDown}>
                <GripHorizontal className="h-4 w-4 text-muted-foreground/40" />
              </div>

              {/* Progresso */}
              <div className="h-1 bg-sidebar-accent cursor-pointer mx-3 rounded-full"
                onClick={(e) => {
                  e.stopPropagation();
                  const rect = e.currentTarget.getBoundingClientRect();
                  const pct = (e.clientX - rect.left) / rect.width;
                  if (isYouTube) ytPlayerRef.current?.seekTo(pct * (ytPlayerRef.current?.getDuration() || 0), true);
                  else if (audioRef.current) audioRef.current.currentTime = pct * (audioRef.current.duration || 0);
                }}>
                <div className="h-full bg-primary rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
              </div>

              {/* Info + controles */}
              <div className="flex items-center gap-4 px-3 py-2.5">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 overflow-hidden">
                    <EduLogoIcon fillContainer />
                  </div>
                  <div className="min-w-0">
                    <p className="text-[11px] font-semibold text-sidebar-foreground truncate">
                      {currentItem?.title || "Nenhuma música"}
                    </p>
                    {currentItem?.playlist_name ? (
                      <p className="text-[10px] text-primary/80 truncate font-medium">▶ {currentItem.playlist_name}</p>
                    ) : (
                      <p className="text-[10px] text-muted-foreground truncate">{currentItem?.artist || "ComunicaEDU"}</p>
                    )}
                    {nextItem && <p className="text-[9px] text-muted-foreground/70 truncate">A seguir: {nextItem.title}</p>}
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button type="button" title="Programar horário"
                    className="w-7 h-7 flex items-center justify-center text-sidebar-foreground/60 hover:text-primary transition-colors rounded-full">
                    <Clock className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title="Nivelar volume"
                    onClick={(e) => { e.stopPropagation(); setShowVolumeMix(v => !v); resetIdleTimer(); }}
                    className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors ${showVolumeMix ? "text-primary bg-primary/15" : "text-sidebar-foreground/60 hover:text-primary"}`}>
                    <SlidersHorizontal className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title={repeatSong ? "Repetir: ativado" : "Repetir música"}
                    onClick={(e) => { e.stopPropagation(); setRepeatSong(v => !v); resetIdleTimer(); }}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${repeatSong ? "text-primary bg-primary/15" : "text-sidebar-foreground/60 hover:text-primary"}`}>
                    <Repeat1 className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title="Anterior"
                    onClick={(e) => { e.stopPropagation(); handlePrev(); resetIdleTimer(); }}
                    className="w-7 h-7 flex items-center justify-center text-sidebar-foreground/70 hover:text-primary transition-colors">
                    <SkipBack className="h-4 w-4" />
                  </button>
                  <button type="button" title={isPlaying ? "Pausar" : "Reproduzir"}
                    onClick={(e) => { e.stopPropagation(); handlePlayPause(); resetIdleTimer(); }}
                    className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-all shadow-lg shadow-primary/30">
                    {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
                  </button>
                  <button type="button" title="Próxima"
                    onClick={(e) => { e.stopPropagation(); handleNext(); resetIdleTimer(); }}
                    className="w-7 h-7 flex items-center justify-center text-sidebar-foreground/70 hover:text-primary transition-colors">
                    <SkipForward className="h-4 w-4" />
                  </button>
                  <button type="button" title="Gravar voz"
                    className="w-7 h-7 flex items-center justify-center text-sidebar-foreground/60 hover:text-primary transition-colors rounded-full">
                    <Mic className="h-3.5 w-3.5" />
                  </button>
                  <button type="button" title={isModoOff ? "Modo Offline ativado" : "Modo Offline"}
                    onClick={(e) => { e.stopPropagation(); setIsModoOff(v => !v); resetIdleTimer(); }}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${isModoOff ? "text-primary bg-primary/15" : "text-sidebar-foreground/60 hover:text-primary"}`}>
                    {isModoOff ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
                  </button>
                  <button type="button" title="Locutor Virtual"
                    onClick={(e) => { e.stopPropagation(); setLocutorOpen(v => !v); resetIdleTimer(); }}
                    className={`w-7 h-7 rounded-full flex items-center justify-center transition-colors ${locutorOpen ? "text-primary bg-primary/15" : "text-sidebar-foreground/60 hover:text-primary"}`}>
                    <Radio className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {/* Tempo */}
              <div className="flex items-center justify-between px-3 sm:px-4 pb-1 text-[10px] text-muted-foreground">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>

              {/* Mixer volume */}
              <AnimatePresence>
                {showVolumeMix && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                    className="overflow-hidden"
                  >
                    <div className="px-3 sm:px-4 pb-3 pt-1">
                      <div className="flex items-center gap-2">
                        <EduLogoIcon size={14} />
                        <span className="text-[10px] text-sidebar-foreground/70 w-14 shrink-0">Volume</span>
                        <input type="range" min={0} max={100} value={volume} aria-label="Volume"
                          onChange={(e) => { setVolume(Number(e.target.value)); resetIdleTimer(); }}
                          className="flex-1 accent-primary" />
                        <span className="text-[10px] text-primary font-mono w-8 text-right">{volume}%</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </AnimatePresence>
      )}
    </>
  );
}
