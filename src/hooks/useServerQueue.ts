"use client";

/**
 * useServerQueue — Pede ao servidor para montar a fila completa.
 *
 * O servidor intercala músicas + spots e retorna o array pronto.
 * O cliente só toca em sequência — sem lógica de shuffle aqui.
 */

import { useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

interface Song {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
  youtube_video_id?: string | null;
  item_type?: "song" | "spot";
}

interface BuildQueueOptions {
  playlistId: string;
  spotsInterval?: number; // quantas músicas entre cada spot (0 = sem spots)
}

export const useServerQueue = () => {
  const buildingRef = useRef(false);

  const buildQueue = useCallback(async (options: BuildQueueOptions): Promise<Song[]> => {
    // Evita chamadas concorrentes
    if (buildingRef.current) return [];
    buildingRef.current = true;

    try {
      const { data, error } = await supabase.functions.invoke("build-queue", {
        body: {
          playlist_id: options.playlistId,
          spots_interval: options.spotsInterval ?? 0,
        },
      });

      if (error) {
        console.error("build-queue error:", error);
        return [];
      }

      return (data?.queue ?? []) as Song[];
    } catch (err) {
      console.error("build-queue exception:", err);
      return [];
    } finally {
      buildingRef.current = false;
    }
  }, []);

  return { buildQueue };
};
