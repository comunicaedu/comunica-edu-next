"use client";

import { useEffect, useRef } from "react";
import { supabase } from "@/lib/supabase/client";
import { getCurrentActiveSchedule, ScheduleWindow } from "@/lib/scheduleUtils";

interface PlaybackSong {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
  youtube_video_id?: string | null;
}

interface UsePlaylistScheduleAutomationParams {
  onPlay: (song: PlaybackSong) => void;
  onPause: () => void;
  onPlayImported?: (song: PlaybackSong) => void;
  onBeforePlayVolume?: (targetVolume: number) => void;
  onVolumeRestore?: (targetVolume: number, fadeDurationMs: number) => void;
  onQueueChange?: (songs: PlaybackSong[], currentIndex: number, playlistId: string) => void;
  onScheduleEnd?: () => void;
  /** Full crossfade handler: fades out current track while fading in the new one simultaneously */
  onScheduleTransition?: (song: PlaybackSong, targetVolume: number) => void;
  /** Returns true when the user has manually paused — automation must not restart playback */
  isManuallyPaused?: () => boolean;
}

export const usePlaylistScheduleAutomation = ({
  onPlay,
  onPause,
  onPlayImported,
  onBeforePlayVolume,
  onVolumeRestore,
  onQueueChange,
  onScheduleEnd,
  onScheduleTransition,
  isManuallyPaused,
}: UsePlaylistScheduleAutomationParams) => {
  const onPlayRef = useRef(onPlay);
  const onPauseRef = useRef(onPause);
  const onPlayImportedRef = useRef(onPlayImported);
  const onBeforePlayVolumeRef = useRef(onBeforePlayVolume);
  const onVolumeRestoreRef = useRef(onVolumeRestore);
  const onQueueChangeRef = useRef(onQueueChange);
  const onScheduleEndRef = useRef(onScheduleEnd);
  const onScheduleTransitionRef = useRef(onScheduleTransition);
  const isManuallyPausedRef = useRef(isManuallyPaused);

  const managedPlaylistIdRef = useRef<string | null>(null);
  const lastAppliedVolumeRef = useRef<number | null>(null);
  const runningRef = useRef(false);

  useEffect(() => { onPlayRef.current = onPlay; }, [onPlay]);
  useEffect(() => { onPauseRef.current = onPause; }, [onPause]);
  useEffect(() => { onPlayImportedRef.current = onPlayImported; }, [onPlayImported]);
  useEffect(() => { onBeforePlayVolumeRef.current = onBeforePlayVolume; }, [onBeforePlayVolume]);
  useEffect(() => { onVolumeRestoreRef.current = onVolumeRestore; }, [onVolumeRestore]);
  useEffect(() => { onQueueChangeRef.current = onQueueChange; }, [onQueueChange]);
  useEffect(() => { onScheduleEndRef.current = onScheduleEnd; }, [onScheduleEnd]);
  useEffect(() => { onScheduleTransitionRef.current = onScheduleTransition; }, [onScheduleTransition]);
  useEffect(() => { isManuallyPausedRef.current = isManuallyPaused; }, [isManuallyPaused]);

  useEffect(() => {
    let cancelled = false;
    // Holds the ID of the precise-fire setTimeout (for next start/end boundary)
    let preciseTimeoutId: number | null = null;
    // Holds the ID of the 10s safety interval
    let safetyIntervalId: number | null = null;

    // All schedule timing uses the client's local clock so that schedules fire
    // at exactly the time the user sees on their own screen, regardless of timezone
    // or any server/client clock difference.
    const getReferenceNow = () => new Date();

    const getTargetVolume = (
      scheduleByPlaylist: Map<string, ScheduleWindow & { scheduled_volume?: number | null }>,
      playlistId: string
    ) => {
      const scheduledEntry = scheduleByPlaylist.get(playlistId);
      const scheduledVolume = scheduledEntry?.scheduled_volume;
      if (scheduledVolume == null) return 0.7 * 0.7; // default ~49% perceptual
      // Apply same square curve as the UI slider so 50% feels like 50% loudness
      const pct = scheduledVolume / 100;
      return pct * pct;
    };

    const shouldReapplyVolume = (targetVolume: number) => {
      if (lastAppliedVolumeRef.current === null) return true;
      return Math.abs(lastAppliedVolumeRef.current - targetVolume) >= 0.005;
    };

    /**
     * Given the current time and a list of schedules, calculate how many
     * milliseconds until the next relevant minute boundary (start or end of any
     * active-capable schedule). Returns null if nothing is scheduled.
     */
    const msUntilNextBoundary = (
      schedules: Array<ScheduleWindow & { scheduled_volume?: number | null }>,
      now: Date
    ): number | null => {
      const nowMs = now.getTime();
      // Current position within the day in minutes (with fractional seconds)
      const todayStartMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      const msIntoDay = nowMs - todayStartMs;

      let closest: number | null = null;

      for (const s of schedules) {
        if (!(s.is_active ?? s.active ?? false) || !s.days_of_week?.length) continue;

        const today = now.getDay();
        if (!s.days_of_week.includes(today)) continue;

        const [startH, startM] = s.start_time.split(":").map(Number);
        const [endH, endM] = s.end_time.split(":").map(Number);

        const startMsInDay = (startH * 60 + startM) * 60_000;
        const endMsInDay = (endH * 60 + endM) * 60_000;

        for (const targetMs of [startMsInDay, endMsInDay]) {
          const diff = targetMs - msIntoDay;
          if (diff > 50) {
            // More than 50ms in the future (avoids re-scheduling for a boundary we just passed)
            if (closest === null || diff < closest) {
              closest = diff;
            }
          }
        }
      }

      return closest;
    };

    // Schedules are cached so we don't re-fetch every precise timeout fire
    let cachedSchedules: Array<ScheduleWindow & { scheduled_volume?: number | null }> = [];

    const scheduleNextPreciseFire = () => {
      if (cancelled) return;
      if (preciseTimeoutId !== null) {
        window.clearTimeout(preciseTimeoutId);
        preciseTimeoutId = null;
      }

      const msUntil = msUntilNextBoundary(cachedSchedules, getReferenceNow());
      if (msUntil === null) return;

      // Fire 150ms AFTER the boundary so isScheduleActiveAt returns true
      const delay = msUntil + 150;
      preciseTimeoutId = window.setTimeout(() => {
        preciseTimeoutId = null;
        runScheduleAutomation();
      }, delay);
    };

    const runScheduleAutomation = async () => {
      if (runningRef.current || cancelled) return;
      runningRef.current = true;

      try {
        const { data, error } = await supabase
          .from("playlist_schedules")
          .select("id, playlist_id, start_time, end_time, days_of_week, active, start_date, end_date, scheduled_volume")
          .eq("active", true);

        if (error) {
          console.error("Erro ao buscar agendamentos:", error.message);
          return;
        }

        const dedupedByPlaylist = new Map<string, ScheduleWindow & { scheduled_volume?: number | null }>();
        (data || []).forEach((schedule) => {
          if (!dedupedByPlaylist.has(schedule.playlist_id)) {
            dedupedByPlaylist.set(schedule.playlist_id, schedule as any);
          }
        });

        cachedSchedules = Array.from(dedupedByPlaylist.values());

        const activeSchedule = getCurrentActiveSchedule(cachedSchedules, getReferenceNow());

        if (!activeSchedule) {
          // Schedule ended — release management and notify Player to resume interrupted playback
          if (managedPlaylistIdRef.current) {
            managedPlaylistIdRef.current = null;
            lastAppliedVolumeRef.current = null;
            onScheduleEndRef.current?.();
          }
          // Schedule next precise fire for the next upcoming start
          scheduleNextPreciseFire();
          return;
        }

        if (managedPlaylistIdRef.current === activeSchedule.playlist_id) {
          const targetVolume = getTargetVolume(dedupedByPlaylist, activeSchedule.playlist_id);
          if (shouldReapplyVolume(targetVolume)) {
            onBeforePlayVolumeRef.current?.(targetVolume);
            lastAppliedVolumeRef.current = targetVolume;
          }
          // Schedule next precise fire for when this schedule ends
          scheduleNextPreciseFire();
          return;
        }

        const { data: allSongsData, error: songsError } = await supabase
          .from("playlist_songs")
          .select("position, songs(id, title, artist, genre, file_path, cover_url, created_at, youtube_video_id)")
          .eq("playlist_id", activeSchedule.playlist_id)
          .order("position", { ascending: true });

        if (songsError) {
          console.error("Erro ao carregar faixas da playlist agendada:", songsError.message);
          return;
        }

        const allSongs = ((allSongsData || []) as unknown as Array<{ songs?: PlaybackSong | null }>)
          .map((row) => row.songs ?? null)
          .filter((s): s is PlaybackSong => s !== null);

        const song = allSongs[0] ?? null;
        // Playlist has no songs — mark as managed but do NOT pause current playback
        if (!song) {
          managedPlaylistIdRef.current = activeSchedule.playlist_id;
          scheduleNextPreciseFire();
          return;
        }

        const isImported =
          song.file_path?.startsWith("imported/") ||
          song.file_path?.startsWith("youtube:");

        const targetVolume = getTargetVolume(dedupedByPlaylist, activeSchedule.playlist_id);

        // Update queue first so activePlaylistId is set and speaker icon appears
        onQueueChangeRef.current?.(allSongs, 0, activeSchedule.playlist_id);

        lastAppliedVolumeRef.current = targetVolume;

        // Mark as managed BEFORE triggering play so re-entrant checks work
        managedPlaylistIdRef.current = activeSchedule.playlist_id;

        // Do not start a transition if the user has manually paused playback
        if (isManuallyPausedRef.current?.()) {
          scheduleNextPreciseFire();
          return;
        }

        if (onScheduleTransitionRef.current) {
          // Crossfade: fades out current track while the new one fades in simultaneously
          onScheduleTransitionRef.current(song, targetVolume);
        } else {
          // Fallback: separate volume change + song switch
          onBeforePlayVolumeRef.current?.(targetVolume);
          if (isImported && onPlayImportedRef.current) {
            onPlayImportedRef.current(song);
          } else {
            onPlayRef.current(song);
          }
          const FADE_DURATION_MS = 2000;
          onVolumeRestoreRef.current?.(targetVolume, FADE_DURATION_MS);
        }

        // Schedule precise fire for when this schedule ends
        scheduleNextPreciseFire();
      } finally {
        runningRef.current = false;
      }
    };

    runScheduleAutomation();

    // Safety interval: re-checks every 60s — precise timeout handles exact boundaries,
    // this is just a fallback for clock drift or new schedules saved from another session.
    safetyIntervalId = window.setInterval(runScheduleAutomation, 60_000);

    return () => {
      cancelled = true;
      if (preciseTimeoutId !== null) window.clearTimeout(preciseTimeoutId);
      if (safetyIntervalId !== null) window.clearInterval(safetyIntervalId);
    };
  }, []);
};
