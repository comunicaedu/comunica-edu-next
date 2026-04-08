"use client";

/**
 * /ouvinte — "Now playing" screen for listeners.
 *
 * Shows what is currently playing on the main player in real-time via
 * Supabase Realtime Broadcast. No audio is streamed here — this is a
 * "what's on" display panel (like a store's song display or a digital signage).
 *
 * For actual audio streaming to remote listeners, see the roadmap item for
 * Rádio Web (WebRTC / HLS — requires server-side relay infrastructure).
 *
 * URL: /ouvinte?uid=<owner-user-id>
 * The `uid` query param lets you share the link without requiring login.
 */

import { useEffect, useState, useCallback, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Music, Radio, Users } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { usePlayerReceiver, type PlayerState } from "@/hooks/usePlayerBroadcast";
import ComunicaEduLogo from "@/components/ComunicaEduLogo";
import Image from "next/image";

// ── Helpers ───────────────────────────────────────────────────────────────────

function PulsingDot({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-2.5 w-2.5">
      {active && (
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      )}
      <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${active ? "bg-green-400" : "bg-red-500"}`} />
    </span>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

function OuvinteContent() {
  const searchParams = useSearchParams();
  const [userId, setUserId] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [lastSeen, setLastSeen] = useState<number | null>(null);
  const [playerState, setPlayerState] = useState<PlayerState | null>(null);

  // Resolve userId: from ?uid= param (public share) or own session
  useEffect(() => {
    const uid = searchParams.get("uid");
    if (uid) {
      setUserId(uid);
      return;
    }
    supabase.auth.getUser().then(({ data: { user } }) => {
      setUserId(user?.id ?? null);
    });
  }, [searchParams]);

  const handleState = useCallback((s: PlayerState) => {
    setPlayerState(s);
    setLastSeen(Date.now());
    setConnected(true);
  }, []);

  usePlayerReceiver({ userId, onState: handleState });

  // Detect disconnect
  useEffect(() => {
    const interval = setInterval(() => {
      if (lastSeen && Date.now() - lastSeen > 6000) setConnected(false);
    }, 2000);
    return () => clearInterval(interval);
  }, [lastSeen]);

  const song = playerState?.song ?? null;

  if (!userId) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-background text-foreground gap-4 px-6 text-center">
        <Radio className="h-12 w-12 text-primary" />
        <p className="font-semibold">Acesso não autenticado</p>
        <p className="text-sm text-muted-foreground">
          Abra este link com{" "}
          <code className="bg-secondary px-1 rounded text-xs">?uid=ID_DO_OPERADOR</code>
          {" "}ou faça login para ver o que está tocando.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/5">
        <ComunicaEduLogo size="sm" />
        <div className="flex items-center gap-2 text-xs">
          <PulsingDot active={connected} />
          <span className={connected ? "text-green-400" : "text-red-400"}>
            {connected ? "Ao vivo" : "Sem sinal"}
          </span>
        </div>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center px-4 py-8 gap-6 max-w-xs mx-auto w-full">

        {/* Cover */}
        <AnimatePresence mode="wait">
          <motion.div
            key={song?.id ?? "empty"}
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-64 h-64 rounded-3xl overflow-hidden shadow-2xl bg-secondary flex items-center justify-center relative"
          >
            {song?.cover_url
              ? <Image src={song.cover_url} alt={song.title} fill className="object-cover" unoptimized />
              : <Music className="h-24 w-24 text-muted-foreground/40" />
            }

            {/* Playing indicator overlay */}
            {playerState?.isPlaying && (
              <div className="absolute bottom-3 right-3 bg-black/60 rounded-full px-2 py-1 flex items-center gap-1">
                <span className="w-1 h-3 bg-primary rounded-full animate-bounce [animation-delay:0ms]" />
                <span className="w-1 h-3 bg-primary rounded-full animate-bounce [animation-delay:150ms]" />
                <span className="w-1 h-3 bg-primary rounded-full animate-bounce [animation-delay:300ms]" />
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Song info */}
        <div className="text-center w-full">
          <AnimatePresence mode="wait">
            <motion.div
              key={song?.id ?? "none"}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {song ? (
                <>
                  <p className="font-bold text-lg leading-tight truncate">{song.title}</p>
                  {song.artist && (
                    <p className="text-muted-foreground text-sm mt-1 truncate">{song.artist}</p>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {connected ? "Parado" : "Aguardando transmissão…"}
                </p>
              )}

              {playerState?.playlistName && (
                <p className="text-primary/70 text-xs mt-2 truncate">{playerState.playlistName}</p>
              )}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Progress bar */}
        {playerState && (
          <div className="w-full h-1.5 bg-secondary rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-primary rounded-full"
              animate={{ width: `${(playerState.progress ?? 0) * 100}%` }}
              transition={{ duration: 0.8, ease: "linear" }}
            />
          </div>
        )}

        {/* Info */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          <span>Ouvindo ao vivo · somente visualização</span>
        </div>

        {/* No-audio note */}
        <div className="bg-secondary/40 rounded-xl px-4 py-3 text-center">
          <p className="text-xs text-muted-foreground leading-relaxed">
            Esta tela mostra o que está tocando no player principal em tempo real.
            O áudio toca apenas no dispositivo do operador.
          </p>
        </div>
      </main>
    </div>
  );
}

export default function OuvintePage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Radio className="h-10 w-10 text-primary animate-pulse" />
      </div>
    }>
      <OuvinteContent />
    </Suspense>
  );
}
