"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: (() => void) | undefined;
  }
}

interface YouTubeState {
  isLoading: boolean;
  isPlaying: boolean;
  videoId: string | null;
  progress: number;
  duration: number;
  currentTime: number;
  endedTick: number;
  errorTick: number;
}

let ytApiLoaded = false;
let ytApiLoading = false;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const clampNormalizationGain = (value: number) => Math.max(0.35, Math.min(1.5, value));

function loadYouTubeAPI(): Promise<void> {
  if (ytApiLoaded) return Promise.resolve();
  if (ytApiLoading) {
    return new Promise((resolve) => {
      const check = setInterval(() => {
        if (ytApiLoaded) { clearInterval(check); resolve(); }
      }, 100);
    });
  }

  ytApiLoading = true;
  return new Promise((resolve) => {
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
    window.onYouTubeIframeAPIReady = () => {
      ytApiLoaded = true;
      ytApiLoading = false;
      resolve();
    };
  });
}

export const useYouTubePlayer = () => {
  const playerRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const intervalRef = useRef<number | null>(null);
  const desiredVolumeRef = useRef(1);
  const normalizationGainRef = useRef(1);
  const [state, setState] = useState<YouTubeState>({
    errorTick: 0,
    isLoading: false,
    isPlaying: false,
    videoId: null,
    progress: 0,
    duration: 0,
    currentTime: 0,
    endedTick: 0,
  });

  useEffect(() => {
    const div = document.createElement("div");
    div.id = "yt-player-hidden";
    div.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
    document.body.appendChild(div);
    containerRef.current = div;

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
      playerRef.current?.destroy();
      div.remove();
    };
  }, []);

  const startProgressTracking = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = window.setInterval(() => {
      const player = playerRef.current;
      if (player?.getCurrentTime && player?.getDuration) {
        const ct = player.getCurrentTime();
        const dur = player.getDuration();
        if (dur > 0) {
          setState((s) => ({
            ...s,
            currentTime: ct,
            duration: dur,
            progress: (ct / dur) * 100,
          }));
        }
      }
    }, 500);
  }, []);

  const applyVolumeToPlayer = useCallback((vol: number): boolean => {
    const player = playerRef.current;
    if (!player || typeof player.setVolume !== "function") return false;

    try {
      const iframe = typeof player.getIframe === "function" ? player.getIframe() : null;
      if (!iframe) return false;

      // Keep UI slider (master volume) aligned with perceived output even when
      // normalization gain is active.
      const targetOutput = clamp01(vol);
      const normalizedGain = clampNormalizationGain(normalizationGainRef.current);
      const compensatedInput = clamp01(targetOutput / normalizedGain);
      player.setVolume(Math.round(compensatedInput * 100));
      return true;
    } catch {
      return false;
    }
  }, []);

  const playByVideoId = useCallback(async (videoId: string, initialVolume?: number) => {
    if (typeof initialVolume === "number") {
      desiredVolumeRef.current = clamp01(initialVolume);
    }

    setState((s) => ({ ...s, isLoading: true }));

    try {
      await loadYouTubeAPI();

      if (playerRef.current) {
        playerRef.current.destroy();
        playerRef.current = null;
      }

      const innerDiv = document.createElement("div");
      innerDiv.id = "yt-player-instance";
      containerRef.current!.innerHTML = "";
      containerRef.current!.appendChild(innerDiv);

      playerRef.current = new window.YT.Player("yt-player-instance", {
        videoId,
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          fs: 0,
          modestbranding: 1,
          rel: 0,
        },
        events: {
          onReady: (event: any) => {
            applyVolumeToPlayer(desiredVolumeRef.current);
            event.target.playVideo();
            setState((s) => ({ ...s, isLoading: false, isPlaying: true, videoId, endedTick: 0 }));
            startProgressTracking();
          },
          onStateChange: (event: any) => {
            if (event.data === window.YT.PlayerState.ENDED) {
              setState((s) => ({
                ...s,
                isPlaying: false,
                progress: 0,
                currentTime: 0,
                endedTick: Date.now(),
              }));
              if (intervalRef.current) clearInterval(intervalRef.current);
            } else if (event.data === window.YT.PlayerState.PLAYING) {
              applyVolumeToPlayer(desiredVolumeRef.current);
              setState((s) => ({ ...s, isPlaying: true, isLoading: false, endedTick: 0 }));
            } else if (event.data === window.YT.PlayerState.PAUSED) {
              setState((s) => ({ ...s, isPlaying: false }));
            }
          },
          onError: (event: any) => {
            console.warn("YouTube player error code:", event.data);
            // Dispara errorTick para que o player pule automaticamente para a próxima música
            setState((s) => ({ ...s, isLoading: false, isPlaying: false, errorTick: Date.now() }));
          },
        },
      });
    } catch (err: any) {
      console.error("YouTube play error:", err);
      toast.error(err.message || "Erro ao carregar vídeo do YouTube.");
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [applyVolumeToPlayer, startProgressTracking]);

  const searchAndPlay = useCallback(async (title: string, artist: string | null, songId?: string): Promise<string> => {
    setState((s) => ({ ...s, isLoading: true }));

    try {
      const { data, error } = await supabase.functions.invoke("youtube-search", {
        body: { title, artist, songId },
      });

      if (error) throw error;
      if (!data?.videoId) throw new Error("Nenhum resultado encontrado.");

      await playByVideoId(data.videoId);
      return data.videoId as string;
    } catch (err: any) {
      console.error("YouTube play error:", err);
      setState((s) => ({ ...s, isLoading: false }));
      throw err;
    }
  }, [playByVideoId]);

  const play = useCallback(() => {
    playerRef.current?.playVideo();
    setState((s) => ({ ...s, isPlaying: true }));
    startProgressTracking();
  }, [startProgressTracking]);

  const pause = useCallback(() => {
    playerRef.current?.pauseVideo();
    setState((s) => ({ ...s, isPlaying: false }));
  }, []);

  const setVolume = useCallback((vol: number): boolean => {
    const normalized = clamp01(vol);
    desiredVolumeRef.current = normalized;
    return applyVolumeToPlayer(normalized);
  }, [applyVolumeToPlayer]);

  const setNormalizationGain = useCallback((gain: number): boolean => {
    normalizationGainRef.current = clampNormalizationGain(gain);
    return applyVolumeToPlayer(desiredVolumeRef.current);
  }, [applyVolumeToPlayer]);

  const seek = useCallback((pct: number) => {
    const player = playerRef.current;
    if (player?.getDuration) {
      player.seekTo(pct * player.getDuration(), true);
    }
  }, []);

  const stop = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    playerRef.current?.stopVideo();
    setState({
      isLoading: false,
      isPlaying: false,
      videoId: null,
      progress: 0,
      duration: 0,
      currentTime: 0,
      endedTick: 0,
      errorTick: 0,
    });
  }, []);

  return {
    ...state,
    playByVideoId,
    searchAndPlay,
    play,
    pause,
    stop,
    setVolume,
    setNormalizationGain,
    seek,
  };
};
