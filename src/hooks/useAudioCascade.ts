"use client";

import { useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * AudioCascade — resolves the best audio source for a song.
 *
 * Priority:
 *   1. Supabase Storage (local MP3/WAV)
 *   2. YouTube IFrame (fallback)
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

    // Level 1: Local Supabase Storage — return URL immediately, no HEAD request
    const localUrl = getStorageUrl(song.file_path);
    if (localUrl) {
      return { type: "local", url: localUrl };
    }

    // Level 2: Cached YouTube video ID
    if (cachedVideoId) {
      return { type: "youtube", videoId: cachedVideoId };
    }

    // Level 3: Search YouTube (only when there is truly no local file)
    try {
      const { data, error } = await supabase.functions.invoke("youtube-search", {
        body: { title: song.title, artist: song.artist, songId: song.id },
      });

      if (!error && data?.videoId) {
        return { type: "youtube", videoId: data.videoId };
      }
    } catch {
      // YouTube search failed
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
      const { data, error } = await supabase.functions.invoke("youtube-search", {
        body: { title: song.title, artist: song.artist, songId: song.id },
      });

      if (!error && data?.videoId) {
        return data.videoId as string;
      }
    } catch {
      // no-op
    } finally {
      checkingRef.current.delete(song.id);
    }
    return null;
  }, []);

  return { resolve, preResolve, isStorageAvailable };
};
