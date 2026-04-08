"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX } from "lucide-react";
import { Slider } from "@/components/ui/slider";

interface AdminMiniTransportProps {
  songTitle: string;
  isPlaying: boolean;
  playMode: "local" | "yt" | null;
  audioRef: React.MutableRefObject<HTMLAudioElement | null>;
  ytPlayerRef: React.MutableRefObject<any>;
  onPrev: () => void;
  onNext: () => void;
  onPlayPause: () => void;
  onStop: () => void;
}

const fmt = (s: number) => {
  if (!s || !isFinite(s)) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
};

const AdminMiniTransport = ({
  songTitle, isPlaying, playMode, audioRef, ytPlayerRef,
  onPrev, onNext, onPlayPause, onStop,
}: AdminMiniTransportProps) => {
  const [progress, setProgress] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const intervalRef = useRef<number | null>(null);

  // Poll progress
  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (!isPlaying) return;

    intervalRef.current = window.setInterval(() => {
      if (playMode === "local" && audioRef.current) {
        const d = audioRef.current.duration || 0;
        const c = audioRef.current.currentTime || 0;
        setDuration(d);
        setCurrentTime(c);
        setProgress(d > 0 ? (c / d) * 100 : 0);
      } else if (playMode === "yt" && ytPlayerRef.current) {
        try {
          const d = ytPlayerRef.current.getDuration?.() || 0;
          const c = ytPlayerRef.current.getCurrentTime?.() || 0;
          setDuration(d);
          setCurrentTime(c);
          setProgress(d > 0 ? (c / d) * 100 : 0);
        } catch {}
      }
    }, 250);

    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [isPlaying, playMode, audioRef, ytPlayerRef]);

  // Reset on stop
  useEffect(() => {
    if (!isPlaying) { setProgress(0); setCurrentTime(0); setDuration(0); }
  }, [isPlaying]);

  const handleSeek = useCallback((val: number[]) => {
    const pct = val[0];
    if (playMode === "local" && audioRef.current && audioRef.current.duration) {
      audioRef.current.currentTime = (pct / 100) * audioRef.current.duration;
    } else if (playMode === "yt" && ytPlayerRef.current) {
      try {
        const d = ytPlayerRef.current.getDuration?.() || 0;
        ytPlayerRef.current.seekTo?.((pct / 100) * d, true);
      } catch {}
    }
    setProgress(pct);
  }, [playMode, audioRef, ytPlayerRef]);

  const handleVolume = useCallback((val: number[]) => {
    const v = val[0];
    setVolume(v);
    setMuted(v === 0);
    if (playMode === "local" && audioRef.current) {
      audioRef.current.volume = v / 100;
      audioRef.current.muted = v === 0;
    } else if (playMode === "yt" && ytPlayerRef.current) {
      try { ytPlayerRef.current.setVolume?.(v); } catch {}
    }
  }, [playMode, audioRef, ytPlayerRef]);

  const toggleMute = useCallback(() => {
    const next = !muted;
    setMuted(next);
    if (playMode === "local" && audioRef.current) {
      audioRef.current.muted = next;
    } else if (playMode === "yt" && ytPlayerRef.current) {
      try { next ? ytPlayerRef.current.mute?.() : ytPlayerRef.current.unMute?.(); } catch {}
    }
  }, [muted, playMode, audioRef, ytPlayerRef]);

  return (
    <div className="shrink-0 bg-secondary/30 px-3 py-2 space-y-1">
      {/* Song title */}
      <p className="text-[10px] text-muted-foreground truncate text-center">
        {songTitle}
      </p>

      {/* Seek bar */}
      <div className="flex items-center gap-2">
        <span className="text-[9px] text-muted-foreground w-7 text-right tabular-nums">{fmt(currentTime)}</span>
        <Slider
          value={[progress]}
          max={100}
          step={0.1}
          onValueChange={handleSeek}
          className="flex-1 h-1 cursor-pointer"
        />
        <span className="text-[9px] text-muted-foreground w-7 tabular-nums">{fmt(duration)}</span>
      </div>

      {/* Controls row */}
      <div className="flex items-center justify-center gap-1">
        <button onClick={onPrev} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
          <SkipBack className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onPlayPause}
          className={`p-1.5 rounded-full transition-all ${
            isPlaying
              ? "bg-primary text-primary-foreground shadow-[0_0_10px_hsl(var(--primary)/0.5)] ring-2 ring-primary/40"
              : "bg-secondary text-muted-foreground hover:bg-primary hover:text-primary-foreground"
          }`}
        >
          {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5 ml-0.5" />}
        </button>
        <button onClick={onNext} className="p-1 rounded hover:bg-secondary text-muted-foreground hover:text-foreground transition-colors">
          <SkipForward className="h-3.5 w-3.5" />
        </button>

        <div className="ml-3 flex items-center gap-1">
          <button onClick={toggleMute} className="p-1 rounded hover:bg-secondary text-muted-foreground">
            {muted || volume === 0 ? <VolumeX className="h-3 w-3" /> : <Volume2 className="h-3 w-3" />}
          </button>
          <Slider
            value={[muted ? 0 : volume]}
            max={100}
            step={1}
            onValueChange={handleVolume}
            className="w-16 h-1 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};

export default AdminMiniTransport;