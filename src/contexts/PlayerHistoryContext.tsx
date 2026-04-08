"use client";

import { createContext, useContext, useRef, useState, useCallback, type ReactNode } from "react";

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

interface PlayerHistoryContextValue {
  pushToHistory: (song: Song) => void;
  popFromHistory: () => Song | undefined;
  pushToForward: (song: Song) => void;
  popFromForward: () => Song | undefined;
  clearForward: () => void;
  clearAll: () => void;
  hasHistory: boolean;
  hasForward: boolean;
  historyLength: number;
  sync: () => void;
}

const PlayerHistoryContext = createContext<PlayerHistoryContextValue | null>(null);

const MAX_HISTORY = 500;

export function PlayerHistoryProvider({ children }: { children: ReactNode }) {
  const historyRef = useRef<Song[]>([]);
  const forwardRef = useRef<Song[]>([]);
  const [hasHistory, setHasHistory] = useState(false);
  const [hasForward, setHasForward] = useState(false);
  const [historyLength, setHistoryLength] = useState(0);

  const sync = useCallback(() => {
    setHasHistory(historyRef.current.length > 0);
    setHasForward(forwardRef.current.length > 0);
    setHistoryLength(historyRef.current.length);
  }, []);

  const pushToHistory = useCallback((song: Song) => {
    historyRef.current.push(song);
    if (historyRef.current.length > MAX_HISTORY) {
      historyRef.current = historyRef.current.slice(-MAX_HISTORY);
    }
    sync();
  }, [sync]);

  const popFromHistory = useCallback((): Song | undefined => {
    const song = historyRef.current.pop();
    sync();
    return song;
  }, [sync]);

  const pushToForward = useCallback((song: Song) => {
    forwardRef.current.push(song);
    sync();
  }, [sync]);

  const popFromForward = useCallback((): Song | undefined => {
    const song = forwardRef.current.pop();
    sync();
    return song;
  }, [sync]);

  const clearForward = useCallback(() => {
    forwardRef.current = [];
    sync();
  }, [sync]);

  const clearAll = useCallback(() => {
    historyRef.current = [];
    forwardRef.current = [];
    sync();
  }, [sync]);

  return (
    <PlayerHistoryContext.Provider value={{
      pushToHistory, popFromHistory,
      pushToForward, popFromForward,
      clearForward, clearAll,
      hasHistory, hasForward, historyLength, sync,
    }}>
      {children}
    </PlayerHistoryContext.Provider>
  );
}

export function usePlayerHistory() {
  const ctx = useContext(PlayerHistoryContext);
  if (!ctx) throw new Error("usePlayerHistory must be used within PlayerHistoryProvider");
  return ctx;
}
