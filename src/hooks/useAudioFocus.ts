"use client";

import { useEffect, useRef } from "react";

/**
 * Uses the Media Session API to claim audio focus.
 * On mobile devices this will pause other audio apps (Spotify, YouTube, etc.)
 * when our platform is playing audio.
 */
export const useAudioFocus = () => {
  const silentAudioRef = useRef<HTMLAudioElement | null>(null);

  const claimAudioFocus = () => {
    // Create a silent audio element to claim the audio session
    if (!silentAudioRef.current) {
      const audio = new Audio();
      // Tiny silent WAV (base64)
      audio.src = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGFs";
      audio.loop = true;
      audio.volume = 0.01;
      silentAudioRef.current = audio;
    }

    silentAudioRef.current.play().catch(() => {});

    // Set Media Session metadata to claim the session
    if ("mediaSession" in navigator) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: "ComunicaEDU",
        artist: "ComunicaEDU Player",
        album: "Rádio Interna",
      });

      navigator.mediaSession.playbackState = "playing";

      // Handle play/pause from system media controls
      navigator.mediaSession.setActionHandler("play", () => {
        navigator.mediaSession.playbackState = "playing";
      });
      navigator.mediaSession.setActionHandler("pause", () => {
        navigator.mediaSession.playbackState = "paused";
      });
    }
  };

  const releaseAudioFocus = () => {
    if (silentAudioRef.current) {
      silentAudioRef.current.pause();
      silentAudioRef.current = null;
    }
    if ("mediaSession" in navigator) {
      navigator.mediaSession.playbackState = "none";
    }
  };

  useEffect(() => {
    return () => releaseAudioFocus();
  }, []);

  return { claimAudioFocus, releaseAudioFocus };
};
