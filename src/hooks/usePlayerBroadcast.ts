"use client";

/**
 * usePlayerBroadcast
 *
 * Manages a Supabase Realtime Broadcast channel so the main player can be
 * controlled from any other device on the same Supabase account.
 *
 * Channel name: `player:{userId}`
 *
 * Events sent by the PLAYER (broadcaster):
 *   type: "state"  → full snapshot of playback state
 *
 * Events sent by the OPERATOR (remote):
 *   type: "cmd"    → { action: "play"|"pause"|"next"|"prev"|"mute"|"volume", value?: number }
 */

import { useEffect, useRef, useCallback } from "react";
import { supabase } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";

// ── Public types ──────────────────────────────────────────────────────────────

export interface PlayerState {
  isPlaying: boolean;
  isMuted: boolean;
  volume: number;        // 0-1
  progress: number;      // 0-1
  song: {
    id: string;
    title: string;
    artist: string | null;
    cover_url: string | null;
    genre: string | null;
  } | null;
  queueLength: number;
  queueIndex: number;
  playlistName: string | null;
  ts: number;            // Date.now() — lets receiver detect stale packets
}

export type RemoteCommand =
  | { action: "play" }
  | { action: "pause" }
  | { action: "next" }
  | { action: "prev" }
  | { action: "mute" }
  | { action: "unmute" }
  | { action: "volume"; value: number };

// ── Hook used by the MAIN PLAYER ─────────────────────────────────────────────

interface UseBroadcasterOptions {
  userId: string | null;
  state: PlayerState;
  onCommand: (cmd: RemoteCommand) => void;
  /** How often to push state (ms). Default: 2000 */
  intervalMs?: number;
}

export function usePlayerBroadcaster({
  userId,
  state,
  onCommand,
  intervalMs = 2000,
}: UseBroadcasterOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);
  const stateRef   = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (!userId) return;

    const ch = supabase.channel(`player:${userId}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    ch.on("broadcast", { event: "cmd" }, ({ payload }) => {
      onCommand(payload as RemoteCommand);
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        // Push current state immediately on connect
        ch.send({ type: "broadcast", event: "state", payload: { ...stateRef.current, ts: Date.now() } });
      }
    });

    channelRef.current = ch;

    // Periodic state push
    const timer = setInterval(() => {
      if (channelRef.current) {
        channelRef.current.send({
          type: "broadcast",
          event: "state",
          payload: { ...stateRef.current, ts: Date.now() },
        });
      }
    }, intervalMs);

    return () => {
      clearInterval(timer);
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, intervalMs]);

  // Allow manual push (e.g., right after a play/pause action so remote updates instantly)
  const pushNow = useCallback(() => {
    channelRef.current?.send({
      type: "broadcast",
      event: "state",
      payload: { ...stateRef.current, ts: Date.now() },
    });
  }, []);

  return { pushNow };
}

// ── Hook used by the REMOTE pages (Operador / Ouvinte) ───────────────────────

interface UseReceiverOptions {
  userId: string | null;
  onState: (s: PlayerState) => void;
}

export function usePlayerReceiver({ userId, onState }: UseReceiverOptions) {
  const channelRef = useRef<RealtimeChannel | null>(null);

  // Send a command to the main player
  const sendCommand = useCallback((cmd: RemoteCommand) => {
    channelRef.current?.send({ type: "broadcast", event: "cmd", payload: cmd });
  }, []);

  useEffect(() => {
    if (!userId) return;

    const ch = supabase.channel(`player:${userId}`, {
      config: { broadcast: { self: false, ack: false } },
    });

    ch.on("broadcast", { event: "state" }, ({ payload }) => {
      onState(payload as PlayerState);
    });

    ch.subscribe();
    channelRef.current = ch;

    return () => {
      supabase.removeChannel(ch);
      channelRef.current = null;
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return { sendCommand };
}
