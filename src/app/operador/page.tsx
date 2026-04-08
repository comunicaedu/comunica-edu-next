"use client";

/**
 * /operador — Remote control for the ComunicaEDU player.
 *
 * Any device logged in with the same Supabase account can control the main
 * player from here. No audio is streamed — just controls + now-playing info.
 *
 * Usage: open https://yourdomain.com/operador on your phone while the player
 * runs on another device.
 */

import { useEffect, useState, useCallback, Suspense } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack, Volume2, VolumeX,
  Radio, Wifi, WifiOff, Music,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { usePlayerReceiver, type PlayerState } from "@/hooks/usePlayerBroadcast";
import ComunicaEduLogo from "@/components/ComunicaEduLogo";
import { Slider } from "@/components/ui/slider";
import Image from "next/image";

// ── Main page ─────────────────────────────────────────────────────────────────

function OperadorContent() {
  const [userId, setUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);
  const [localVolume, setLocalVolume] = useState<number>(0.7);
  const [volumeDebounce, setVolumeDebounce] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, []);

  const handleState = useCallback((s: PlayerState) => {
    setPlayerState(s);
    setLocalVolume(s.volume);
    setLastSeen(Date.now());
    setConnected(true);
  }, []);

  const { sendCommand } = usePlayerReceiver({ userId, onState: handleState });

  // Mark as disconnected if no state for 6 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSeen && Date.now() - lastSeen > 6000) {
        setConnected(false);
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [lastSeen]);

  // Volume slider with debounce to avoid flooding
  const handleVolumeChange = useCallback((val: number[]) => {
    const v = val[0];
    setLocalVolume(v);
    if (volumeDebounce) clearTimeout(volumeDebounce);
    setVolumeDebounce(
      setTimeout(() => sendCommand({ action: "volume", value: v }), 120)
    );
  }, [sendCommand, volumeDebounce]);

  const song = playerState?.song ?? null;

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground gap-4">
        <Radio className="h-12 w-12 text-primary animate-pulse" />
        <p className="text-muted-foreground">Verificando sessão…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <ComunicaEduLogo size="sm" />
        <div className="flex items-center gap-2 text-xs">
          {connected
            ? <><Wifi className="h-4 w-4 text-green-400" /><span className="text-green-400">Conectado</span></>
            : <><WifiOff className="h-4 w-4 text-red-400" /><span className="text-red-400">Aguardando player…</span></>
          }
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-6 gap-6 max-w-sm mx-auto w-full">

        {/* Cover art */}
        <AnimatePresence mode="wait">
          <motion.div
            key={song?.id ?? "empty"}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.3 }}
            className="w-52 h-52 rounded-2xl overflow-hidden shadow-2xl bg-secondary flex items-center justify-center shrink-0 relative"
          >
            {song?.cover_url
              ? <Image src={song.cover_url} alt={song.title} fill className="object-cover" unoptimized />
              : <Music className="h-20 w-20 text-muted-foreground" />
            }
          </motion.div>
        </AnimatePresence>

        {/* Song info */}
        <div className="text-center w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={song?.id ?? "none"}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
            >
              <p className="font-semibold text-base leading-tight truncate">
                {song?.title ?? (connected ? "Parado" : "Sem sinal")}
              </p>
              {song?.artist && (
                <p className="text-sm text-muted-foreground truncate mt-0.5">{song.artist}</p>
              )}
              {playerState?.playlistName && (
                <p className="text-xs text-primary/70 mt-1 truncate">{playerState.playlistName}</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress bar (read-only) */}
        {playerState && (
          <div className="w-full h-1 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              animate={{ width: `${(playerState.progress ?? 0) * 100}%` }}
              transition={{ duration: 0.5, ease: "linear" }}
            />
          </div>
        )}

        {/* Queue info */}
        {playerState && (
          <p className="text-xs text-muted-foreground -mt-2">
            {playerState.queueIndex + 1} / {playerState.queueLength} na fila
          </p>
        )}

        {/* Transport controls */}
        <div className="flex items-center gap-6">
          <button
            type="button"
            aria-label="Música anterior"
            onClick={() => sendCommand({ action: "prev" })}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary/60 active:scale-90 transition-transform"
          >
            <SkipBack className="h-6 w-6" />
          </button>

          <button
            type="button"
            aria-label={playerState?.isPlaying ? "Pausar" : "Reproduzir"}
            onClick={() => sendCommand({ action: playerState?.isPlaying ? "pause" : "play" })}
            className="w-16 h-16 flex items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg active:scale-90 transition-transform"
          >
            {playerState?.isPlaying
              ? <Pause className="h-8 w-8" />
              : <Play className="h-8 w-8 ml-0.5" />
            }
          </button>

          <button
            type="button"
            aria-label="Próxima música"
            onClick={() => sendCommand({ action: "next" })}
            className="w-12 h-12 flex items-center justify-center rounded-full bg-secondary/60 active:scale-90 transition-transform"
          >
            <SkipForward className="h-6 w-6" />
          </button>
        </div>

        {/* Volume */}
        <div className="w-full flex items-center gap-3">
          <button
            type="button"
            aria-label={playerState?.isMuted ? "Desmutar" : "Mutar"}
            onClick={() => sendCommand({ action: playerState?.isMuted ? "unmute" : "mute" })}
            className="shrink-0 active:scale-90 transition-transform"
          >
            {playerState?.isMuted
              ? <VolumeX className="h-5 w-5 text-muted-foreground" />
              : <Volume2 className="h-5 w-5 text-primary" />
            }
          </button>
          <Slider
            value={[localVolume]}
            onValueChange={handleVolumeChange}
            min={0} max={1} step={0.01}
            className="flex-1"
          />
          <span className="text-xs text-muted-foreground w-8 text-right">
            {Math.round(localVolume * 100)}%
          </span>
        </div>

        {/* Info footer */}
        <p className="text-[11px] text-muted-foreground text-center leading-relaxed">
          Controle remoto — o áudio toca no dispositivo principal.
          <br />
          Mantenha o player aberto na outra aba/dispositivo.
        </p>
      </main>
    </div>
  );
}

export default function OperadorPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Radio className="h-10 w-10 text-primary animate-pulse" />
      </div>
    }>
      <OperadorContent />
    </Suspense>
  );
}
