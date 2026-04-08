"use client";

import { useCallback, useRef } from "react";
import { supabase } from "@/lib/supabase/client";

/**
 * Tracks user activity (search, play, upload) for personalized recommendations.
 * Debounces search tracking to avoid flooding the DB.
 */
export const useActivityTracker = () => {
  const lastSearch = useRef<string>("");
  const searchTimer = useRef<number | null>(null);

  const trackActivity = useCallback(async (
    type: "search" | "play" | "upload",
    data: { songId?: string; genre?: string; artist?: string; searchQuery?: string }
  ) => {
    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id;
      if (!userId) return;

      await supabase.from("user_activity").insert({
        user_id: userId,
        activity_type: type,
        song_id: data.songId || null,
        genre: data.genre || null,
        artist: data.artist || null,
        search_query: data.searchQuery || null,
      });
    } catch {
      // Silent fail — tracking should never break the app
    }
  }, []);

  const trackSearch = useCallback((query: string) => {
    if (!query || query.length < 3 || query === lastSearch.current) return;

    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = window.setTimeout(() => {
      lastSearch.current = query;
      trackActivity("search", { searchQuery: query });
    }, 2000); // Debounce 2s
  }, [trackActivity]);

  const trackPlay = useCallback((song: { id: string; genre?: string | null; artist?: string | null }) => {
    trackActivity("play", {
      songId: song.id,
      genre: song.genre || undefined,
      artist: song.artist || undefined,
    });
  }, [trackActivity]);

  const trackUpload = useCallback((song: { id: string; genre?: string | null; artist?: string | null }) => {
    trackActivity("upload", {
      songId: song.id,
      genre: song.genre || undefined,
      artist: song.artist || undefined,
    });
  }, [trackActivity]);

  return { trackSearch, trackPlay, trackUpload };
};
