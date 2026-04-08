"use client";

/**
 * useRadioQueue — Lê e sincroniza a fila de reprodução montada pelo servidor.
 *
 * - Chama a Edge Function build-queue para montar a fila
 * - Assina realtime em radio_queue e radio_state para atualizações
 * - Expõe a fila atual, índice e funções de navegação
 * - Regra: transição SEMPRE após a música atual terminar
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";

export interface RadioQueueItem {
  id: string;
  position: number;
  item_type: "song" | "spot" | "live_recording" | "tts";
  song_id: string | null;
  title: string;
  artist: string | null;
  file_path: string;
  cover_url: string | null;
  youtube_video_id: string | null;
  volume_override: number | null;
  source_schedule_id: string | null;
}

interface RadioState {
  queue_index: number;
  is_playing: boolean;
  volume: number;
}

interface UseRadioQueueReturn {
  queue: RadioQueueItem[];
  currentItem: RadioQueueItem | null;
  nextItem: RadioQueueItem | null;
  currentIndex: number;
  isPlaying: boolean;
  volume: number;
  isBuilding: boolean;
  buildQueue: (playlistId?: string) => Promise<void>;
  advance: () => Promise<void>;
  goTo: (index: number) => Promise<void>;
  setPlaying: (playing: boolean) => Promise<void>;
  setVolume: (vol: number) => Promise<void>;
}

export const useRadioQueue = (): UseRadioQueueReturn => {
  const [queue, setQueue] = useState<RadioQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlayingState] = useState(false);
  const [volume, setVolumeState] = useState(70);
  const [isBuilding, setIsBuilding] = useState(false);
  const ownerIdRef = useRef<string | null>(null);

  // ── Carrega usuário ─────────────────────────────────────
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      ownerIdRef.current = user?.id ?? null;
      if (user) loadQueueFromDB(user.id);
    });
  }, []);

  // ── Lê fila salva do banco ──────────────────────────────
  const loadQueueFromDB = async (ownerId: string) => {
    const { data: queueData } = await supabase
      .from("radio_queue")
      .select("*")
      .eq("owner_id", ownerId)
      .order("position", { ascending: true });

    const { data: stateData } = await supabase
      .from("radio_state")
      .select("*")
      .eq("owner_id", ownerId)
      .maybeSingle();

    if (queueData && queueData.length > 0) {
      setQueue(queueData as RadioQueueItem[]);
    }
    if (stateData) {
      setCurrentIndex(stateData.queue_index ?? 0);
      setIsPlayingState(stateData.is_playing ?? false);
      setVolumeState(stateData.volume ?? 70);
    }
  };

  // ── Realtime: radio_queue ───────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("radio-queue-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "radio_queue" },
        () => {
          if (ownerIdRef.current) loadQueueFromDB(ownerIdRef.current);
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Realtime: radio_state ───────────────────────────────
  useEffect(() => {
    const channel = supabase
      .channel("radio-state-changes")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "radio_state" },
        (payload) => {
          const newState = payload.new as RadioState;
          if (newState) {
            setCurrentIndex(newState.queue_index ?? 0);
            setIsPlayingState(newState.is_playing ?? false);
            setVolumeState(newState.volume ?? 70);
          }
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // ── Salva estado no banco ───────────────────────────────
  const saveState = useCallback(async (patch: Partial<RadioState>) => {
    const ownerId = ownerIdRef.current;
    if (!ownerId) return;
    await supabase
      .from("radio_state")
      .upsert({ owner_id: ownerId, ...patch }, { onConflict: "owner_id" });
  }, []);

  // ── Monta fila pelo servidor ────────────────────────────
  const buildQueue = useCallback(async (playlistId?: string) => {
    setIsBuilding(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;

      await supabase.functions.invoke("build-queue", {
        body: playlistId ? { playlist_id: playlistId } : {},
      });

      if (ownerIdRef.current) await loadQueueFromDB(ownerIdRef.current);

      // Reseta índice para o início
      await saveState({ queue_index: 0, is_playing: false });
      setCurrentIndex(0);
    } finally {
      setIsBuilding(false);
    }
  }, [saveState]);

  // ── Avança para o próximo item (chamado quando música termina) ──
  const advance = useCallback(async () => {
    const nextIdx = currentIndex + 1;
    const hasNext = nextIdx < queue.length;

    if (!hasNext) {
      // Fila acabou — reconstrói automaticamente
      await buildQueue();
      return;
    }

    setCurrentIndex(nextIdx);
    await saveState({ queue_index: nextIdx });
  }, [currentIndex, queue.length, buildQueue, saveState]);

  // ── Vai para posição específica ─────────────────────────
  const goTo = useCallback(async (index: number) => {
    const safeIdx = Math.max(0, Math.min(index, queue.length - 1));
    setCurrentIndex(safeIdx);
    await saveState({ queue_index: safeIdx });
  }, [queue.length, saveState]);

  // ── Play/Pause ──────────────────────────────────────────
  const setPlaying = useCallback(async (playing: boolean) => {
    setIsPlayingState(playing);
    await saveState({ is_playing: playing });
  }, [saveState]);

  // ── Volume ──────────────────────────────────────────────
  const setVolume = useCallback(async (vol: number) => {
    const clamped = Math.max(0, Math.min(100, vol));
    setVolumeState(clamped);
    await saveState({ volume: clamped });
  }, [saveState]);

  const currentItem = queue[currentIndex] ?? null;
  const nextItem = queue[currentIndex + 1] ?? null;

  return {
    queue,
    currentItem,
    nextItem,
    currentIndex,
    isPlaying,
    volume,
    isBuilding,
    buildQueue,
    advance,
    goTo,
    setPlaying,
    setVolume,
  };
};
