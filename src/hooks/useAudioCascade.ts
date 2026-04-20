"use client";

import { useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { isYouTubeQuotaExhausted, markYouTubeQuotaExhausted, isQuotaError } from "@/lib/youtubeQuota";
import { authedFetch } from "@/lib/authedFetch";

/**
 * AudioCascade — resolves the best audio source for a song.
 *
 * Priority:
 *   1. Supabase Storage (uploaded MP3/WAV)  ← sempre primeiro
 *   2. Offline cache (YouTube pré-baixado)  ← local, sem internet
 *   3. YouTube IFrame com ID conhecido      ← sem custo de cota
 *   4. YouTube Search API                   ← só se cota disponível
 *
 * Also enriches metadata (cover/title) from existing DB data.
 */

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

export type AudioSource =
  | { type: "local"; url: string }
  | { type: "youtube"; videoId: string }
  | { type: "none" };

export const useAudioCascade = () => {
  const checkingRef = useRef<Set<string>>(new Set());

  /**
   * Build the public Supabase Storage URL for a file path without any network
   * request. Failures are handled by the audio element's onerror event instead
   * of a HEAD pre-check, saving one round-trip per song play.
   */
  const getStorageUrl = useCallback((filePath: string): string | null => {
    if (!filePath || filePath.startsWith("youtube:") || filePath.startsWith("imported/")) {
      return null;
    }
    if (filePath.startsWith("direct:")) {
      return filePath.replace("direct:", "");
    }
    if (filePath.startsWith("/uploads/") || filePath.startsWith("http")) {
      return filePath;
    }
    try {
      const { data } = supabase.storage.from("audio").getPublicUrl(filePath);
      return data.publicUrl || null;
    } catch {
      return null;
    }
  }, []);

  // Keep isStorageAvailable for external callers that genuinely need a reachability check
  const isStorageAvailable = useCallback(async (filePath: string): Promise<string | null> => {
    const url = getStorageUrl(filePath);
    if (!url) return null;
    try {
      const res = await fetch(url, { method: "HEAD" });
      return res.ok ? url : null;
    } catch {
      return null;
    }
  }, [getStorageUrl]);

  /**
   * Resolve the best audio source for a song using the cascade.
   * Local files are returned immediately (no HEAD check) — the audio element's
   * onerror handler deals with load failures so we don't add network latency.
   */
  const resolve = useCallback(async (song: Song): Promise<AudioSource> => {
    // Check for a cached YouTube video ID first
    const rawId = song.file_path?.startsWith("youtube:")
      ? song.file_path.replace("youtube:", "")
      : null;
    const cachedVideoId = (rawId && rawId !== "pending" && rawId.length >= 5)
      ? rawId
      : (song.youtube_video_id && song.youtube_video_id !== "pending" && song.youtube_video_id.length >= 5)
        ? song.youtube_video_id
        : null;

    // Level 1: Local Supabase Storage — ALWAYS first priority (uploaded MP3/WAV)
    const localUrl = getStorageUrl(song.file_path);
    if (localUrl) {
      return { type: "local", url: localUrl };
    }

    // Level 2a: YouTube audio downloaded locally (offline cache) — only if no MP3 in storage
    if (cachedVideoId) {
      try {
        const res = await authedFetch(`/api/cache-audio?videoId=${cachedVideoId}`);
        const data = await res.json();
        if (data.cached && data.file_path) {
          return { type: "local", url: data.file_path };
        }
      } catch {
        // offline check failed — continue to next level
      }
    }

    // Level 2b: Cached YouTube video ID — valida duração e título antes de usar
    // Impede que vídeos longos, anúncios e compilações já salvos no banco entrem na fila
    if (cachedVideoId) {
      try {
        const vRes = await authedFetch(`/api/validate-youtube?videoId=${cachedVideoId}`);
        const vData = await vRes.json();
        if (vData.valid) {
          return { type: "youtube", videoId: cachedVideoId };
        }
        // Inválido (longo, anúncio, etc.) → limpa do banco e busca substituto
        supabase
          .from("songs")
          .update({ youtube_video_id: null })
          .eq("youtube_video_id", cachedVideoId)
          .then(() => {});
      } catch {
        // Falha na validação → usa o ID sem bloquear (melhor tocar do que silêncio)
        return { type: "youtube", videoId: cachedVideoId };
      }
    }

    // Spots nunca vão para o YouTube — se chegou até aqui é um erro, retorna none
    if (song.genre === "spot") return { type: "none" };

    // Level 3: Search YouTube — skipped when quota is exhausted (search API only)
    if (!isYouTubeQuotaExhausted()) {
      try {
        const params = new URLSearchParams({ title: song.title });
        if (song.artist) params.set("artist", song.artist);
        if (song.genre)  params.set("genre",  song.genre);
        const res = await authedFetch(`/api/youtube-search?${params.toString()}`);
        if (res.ok) {
          const data = await res.json();
          if (data?.quotaExceeded || isQuotaError(String(data?.error ?? ""))) {
            markYouTubeQuotaExhausted();
          } else if (data?.videoId) {
            return { type: "youtube", videoId: data.videoId };
          }
        } else if (res.status === 429) {
          markYouTubeQuotaExhausted();
        }
      } catch {
        // YouTube search failed — fallback to Supabase function
        if (!isYouTubeQuotaExhausted()) {
          try {
            const { data, error } = await supabase.functions.invoke("youtube-search", {
              body: { title: song.title, artist: song.artist, songId: song.id },
            });
            if (error && isQuotaError(String(error?.message ?? error))) {
              markYouTubeQuotaExhausted();
            } else if (!error && data?.videoId) {
              return { type: "youtube", videoId: data.videoId };
            }
          } catch {
            // both failed
          }
        }
      }
    }

    return { type: "none" };
  }, [getStorageUrl]);

  /**
   * Pre-resolve a song in background (for next-in-queue optimization).
   * Updates the song's youtube_video_id in DB if resolved.
   */
  const preResolve = useCallback(async (song: Song): Promise<string | null> => {
    if (checkingRef.current.has(song.id)) return null;

    // Skip if already has a known source
    const hasLocal = song.file_path && !song.file_path.startsWith("youtube:") && !song.file_path.startsWith("imported/");
    const hasVideoId = song.youtube_video_id && song.youtube_video_id !== "pending" && song.youtube_video_id.length >= 5;
    const hasYtPath = song.file_path?.startsWith("youtube:") && !song.file_path.includes("pending");

    if (hasLocal || hasVideoId || hasYtPath) return null;

    checkingRef.current.add(song.id);
    try {
      // Skip YouTube search entirely when quota is exhausted
      if (isYouTubeQuotaExhausted()) return null;

      const params = new URLSearchParams({ title: song.title });
      if (song.artist) params.set("artist", song.artist);
      const res = await authedFetch(`/api/youtube-search?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        if (data?.quotaExceeded || isQuotaError(String(data?.error ?? ""))) {
          markYouTubeQuotaExhausted(); return null;
        }
        if (data?.videoId) return data.videoId as string;
      } else if (res.status === 429) {
        markYouTubeQuotaExhausted(); return null;
      }
      // Fallback to Supabase function
      if (!isYouTubeQuotaExhausted()) {
        const { data, error } = await supabase.functions.invoke("youtube-search", {
          body: { title: song.title, artist: song.artist, songId: song.id },
        });
        if (error && isQuotaError(String(error?.message ?? error))) {
          markYouTubeQuotaExhausted(); return null;
        }
        if (!error && data?.videoId) return data.videoId as string;
      }
    } catch {
      // no-op
    } finally {
      checkingRef.current.delete(song.id);
    }
    return null;
  }, []);

  return { resolve, preResolve, isStorageAvailable, getStorageUrl };
};
