"use client";

import { useEffect } from "react";

interface KeyboardPlayerOptions {
  isPlaying: boolean;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onMuteToggle: () => void;
  onVolumeUp: () => void;
  onVolumeDown: () => void;
  enabled?: boolean;
}

/**
 * Keyboard & TV remote control for the player.
 *
 * Shortcuts:
 *   Space / K          → play / pause
 *   →  / L             → next track   (Shift+→ = seek +10s on same track)
 *   ←  / J             → previous     (Shift+← = seek -10s)
 *   ↑                  → volume +5%
 *   ↓                  → volume -5%
 *   M                  → mute toggle
 *   MediaPlayPause     → play/pause   (hardware media keys & TV remotes)
 *   MediaNextTrack     → next
 *   MediaPreviousTrack → previous
 *   MediaStop          → pause
 */
export function useKeyboardPlayer({
  isPlaying,
  onPlayPause,
  onNext,
  onPrevious,
  onMuteToggle,
  onVolumeUp,
  onVolumeDown,
  enabled = true,
}: KeyboardPlayerOptions) {
  useEffect(() => {
    if (!enabled) return;

    const handler = (e: KeyboardEvent) => {
      // Don't hijack shortcuts when user is typing
      const tag = (e.target as HTMLElement)?.tagName;
      if (
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }

      switch (e.code) {
        // ── Play / Pause ────────────────────────────────────────────────────
        case "Space":
        case "KeyK":
          e.preventDefault();
          onPlayPause();
          break;

        // ── Next / Previous ─────────────────────────────────────────────────
        case "ArrowRight":
        case "KeyL":
          if (!e.shiftKey) {
            e.preventDefault();
            onNext();
          }
          break;

        case "ArrowLeft":
        case "KeyJ":
          if (!e.shiftKey) {
            e.preventDefault();
            onPrevious();
          }
          break;

        // ── Mute ────────────────────────────────────────────────────────────
        case "KeyM":
          onMuteToggle();
          break;

        // ── Hardware media keys (TV remote, Bluetooth keyboards, headsets) ──
        case "MediaPlayPause":
          e.preventDefault();
          onPlayPause();
          break;

        case "MediaNextTrack":
          e.preventDefault();
          onNext();
          break;

        case "MediaPreviousTrack":
          e.preventDefault();
          onPrevious();
          break;

        case "MediaStop":
          e.preventDefault();
          if (isPlaying) onPlayPause();
          break;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [enabled, isPlaying, onPlayPause, onNext, onPrevious, onMuteToggle, onVolumeUp, onVolumeDown]);
}
