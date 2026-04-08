"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Play, Pause, SkipForward, SkipBack, Volume2,
  Mic, Clock, Minimize2, GripHorizontal
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { useIsMobile } from "@/hooks/use-mobile";
import EduLogoIcon from "./EduLogoIcon";

interface Song {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  created_at: string;
}

interface FloatingMiniPlayerProps {
  currentSong: Song | null;
  isPlaying: boolean;
  progress: number;
  duration: number;
  currentTime: number;
  musicVolume: number;
  spotVolume: number;
  onPlayPause: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onMusicVolumeChange: (v: number) => void;
  onSpotVolumeChange: (v: number) => void;
  onSeek: (pct: number) => void;
  onToggleExpand?: () => void;
  isExpanded?: boolean;
}

const IDLE_TIMEOUT = 8000; // ms before auto-collapse

const formatTime = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

const FloatingMiniPlayer = ({
  currentSong, isPlaying, progress, duration, currentTime,
  musicVolume, spotVolume,
  onPlayPause, onNext, onPrevious,
  onMusicVolumeChange, onSpotVolumeChange, onSeek,
}: FloatingMiniPlayerProps) => {
  const isMobile = useIsMobile();
  const [expanded, setExpanded] = useState(false);
  const [showVolumeMix, setShowVolumeMix] = useState(false);
  const [currentClock, setCurrentClock] = useState("");
  const [position, setPosition] = useState(() => {
    if (typeof window === "undefined") return { x: 0, y: 0 };
    return {
      x: Math.max(12, window.innerWidth - 80),
      y: Math.max(12, window.innerHeight - 90),
    };
  });
  const [dragging, setDragging] = useState(false);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startPosRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const movedRef = useRef(false);
  const { isSectionVisible } = useClientFeatures();

  // Initialize desktop position
  useEffect(() => {
    if (isMobile) {
      setPosition({ x: 0, y: 0 });
      return;
    }

    setPosition({
      x: Math.max(12, window.innerWidth - 80),
      y: Math.max(12, window.innerHeight - 90),
    });
  }, [isMobile]);

  // Clock
  useEffect(() => {
    const tick = () => {
      const now = new Date();
      setCurrentClock(now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }));
    };

    tick();
    const id = setInterval(tick, 30000);
    return () => clearInterval(id);
  }, []);

  // Auto-collapse after idle
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);

    if (expanded) {
      idleTimerRef.current = setTimeout(() => {
        setExpanded(false);
        setShowVolumeMix(false);
      }, IDLE_TIMEOUT);
    }
  }, [expanded]);

  useEffect(() => {
    resetIdleTimer();
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [expanded, resetIdleTimer]);

  // Drag logic (desktop only)
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    if (isMobile) return;

    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    startPosRef.current = { x: e.clientX, y: e.clientY };
    movedRef.current = false;
    offsetRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
    setDragging(true);
  }, [isMobile, position]);

  useEffect(() => {
    if (!dragging || isMobile) return;

    const handleMove = (e: PointerEvent) => {
      const dx = Math.abs(e.clientX - startPosRef.current.x);
      const dy = Math.abs(e.clientY - startPosRef.current.y);
      if (dx > 3 || dy > 3) movedRef.current = true;

      const maxY = Math.max(12, window.innerHeight - 70);
      const maxX = Math.max(12, window.innerWidth - 60);

      setPosition({
        x: Math.max(12, Math.min(maxX, e.clientX - offsetRef.current.x)),
        y: Math.max(12, Math.min(maxY, e.clientY - offsetRef.current.y)),
      });
    };

    const handleUp = () => setDragging(false);

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);

    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, [dragging, isMobile]);

  const handleClick = () => {
    if (movedRef.current) {
      movedRef.current = false;
      return;
    }

    if (!expanded) setExpanded(true);
  };

  const handleInteraction = () => {
    resetIdleTimer();
  };

  // Collapsed state: just the logo bubble
  if (!expanded) {
    return (
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.35 }}
        onPointerDown={isMobile ? undefined : handlePointerDown}
        onClick={handleClick}
        className={`floating-mini-player-bubble fixed z-[100] rounded-full bg-sidebar-background border-2 shadow-2xl flex items-center justify-center select-none overflow-hidden p-0 ${
          isMobile
            ? "h-9 w-9"
            : "w-12 h-12 cursor-grab active:cursor-grabbing"
        }`}
        style={{
          border: '2px solid hsl(var(--primary))',
          ...(isMobile
            ? {
                right: "0.75rem",
                bottom: "calc(var(--safe-area-bottom) + 5.5rem)",
              }
            : {
                left: position.x,
                top: position.y,
              }),
        }}
        title="Abrir Player"
      >
        <EduLogoIcon fillContainer />
        {isPlaying && (
          <span className="absolute -top-1 -right-1 w-3 h-3 rounded-full bg-primary animate-pulse" />
        )}
      </motion.div>
    );
  }

  const desktopExpandedLeft = Math.min(
    position.x,
    window.innerWidth - Math.min(window.innerWidth * 0.9, 500)
  );

  const desktopExpandedTop = Math.max(0, Math.min(position.y - 190, window.innerHeight - 300));

  // Expanded state: full mini player
  return (
    <AnimatePresence>
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.8, opacity: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="fixed z-[100] w-auto sm:w-[95vw] max-w-xl"
        style={
          isMobile
            ? {
                left: "0.5rem",
                right: "0.5rem",
                bottom: "calc(var(--safe-area-bottom) + 5.85rem)",
              }
            : {
                left: desktopExpandedLeft,
                top: desktopExpandedTop,
              }
        }
        onPointerMove={handleInteraction}
        onClick={handleInteraction}
      >
        <div className="bg-sidebar-background/95 backdrop-blur-xl border border-sidebar-border rounded-xl sm:rounded-2xl shadow-2xl overflow-hidden">
          {!isMobile && (
            <div
              className="flex items-center justify-center pt-1.5 pb-0.5 cursor-grab active:cursor-grabbing"
              onPointerDown={handlePointerDown}
            >
              <GripHorizontal className="h-4 w-4 text-muted-foreground/40" />
            </div>
          )}

          {/* Progress bar */}
          <div
            className="h-1 bg-sidebar-accent cursor-pointer mx-3 rounded-full"
            onClick={(e) => {
              e.stopPropagation();
              const rect = e.currentTarget.getBoundingClientRect();
              onSeek((e.clientX - rect.left) / rect.width);
            }}
          >
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Main controls row */}
          <div className="flex items-center gap-1.5 sm:gap-2 px-2.5 sm:px-3 py-2">
            {/* Song info with EDU logo */}
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-lg bg-primary/20 flex items-center justify-center shrink-0 overflow-hidden p-0">
                <EduLogoIcon fillContainer />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[11px] sm:text-xs font-semibold text-sidebar-foreground truncate">
                  {currentSong?.title || "Nenhuma música"}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {currentSong?.artist || "ComunicaEDU"}
                </p>
              </div>
            </div>

            {/* Transport controls */}
            <div className="flex items-center gap-0.5 sm:gap-1">
              <button onClick={(e) => { e.stopPropagation(); onPrevious(); }} className="p-1.5 text-sidebar-foreground/70 hover:text-primary transition-colors duration-300">
                <SkipBack className="h-4 w-4" />
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); onPlayPause(); }}
                className="w-8 h-8 sm:w-9 sm:h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-all duration-300 shadow-lg shadow-primary/30"
              >
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
              </button>
              <button onClick={(e) => { e.stopPropagation(); onNext(); }} className="p-1.5 text-sidebar-foreground/70 hover:text-primary transition-colors duration-300">
                <SkipForward className="h-4 w-4" />
              </button>
            </div>

            {/* Right controls */}
            <div className="flex items-center gap-0.5 sm:gap-1">
              {!isMobile && (
                <span className="text-[10px] font-mono text-primary px-1.5 py-0.5 bg-primary/10 rounded-md">
                  {currentClock}
                </span>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); setShowVolumeMix(!showVolumeMix); }}
                className={`p-1.5 rounded-md transition-colors duration-300 ${showVolumeMix ? "text-primary bg-primary/15" : "text-sidebar-foreground/60 hover:text-primary"}`}
                title="Mixagem de Volume"
              >
                <Volume2 className="h-4 w-4" />
              </button>

              {!isMobile && isSectionVisible("spots") && (
                <button
                  className="p-1.5 text-sidebar-foreground/60 hover:text-primary transition-colors duration-300"
                  title="Spots"
                >
                  <Mic className="h-3.5 w-3.5" />
                </button>
              )}

              {!isMobile && (
                <button className="p-1.5 text-sidebar-foreground/60" title="Relógio">
                  <Clock className="h-3.5 w-3.5" />
                </button>
              )}

              <button
                onClick={(e) => { e.stopPropagation(); setExpanded(false); setShowVolumeMix(false); }}
                className="p-1.5 text-sidebar-foreground/60 hover:text-primary transition-colors duration-300"
                title="Minimizar"
              >
                <Minimize2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          {/* Time display */}
          <div className="flex items-center justify-between px-3 sm:px-4 pb-1 text-[10px] text-muted-foreground">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>

          {/* Volume mix panel */}
          <AnimatePresence>
            {showVolumeMix && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="px-3 sm:px-4 pb-3 pt-1 space-y-2">
                  <div className="flex items-center gap-2">
                    <EduLogoIcon size={14} />
                    <span className="text-[10px] text-sidebar-foreground/70 w-14 shrink-0">Músicas</span>
                    <Slider
                      value={[musicVolume * 100]}
                      max={100}
                      step={1}
                      onValueChange={([v]) => onMusicVolumeChange(v / 100)}
                      onValueCommit={([v]) => onMusicVolumeChange(v / 100)}
                      className="flex-1"
                    />
                    <span className="text-[10px] text-primary font-mono w-8 text-right">{Math.round(musicVolume * 100)}%</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Mic className="h-3.5 w-3.5 text-accent shrink-0" />
                    <span className="text-[10px] text-sidebar-foreground/70 w-14 shrink-0">Spots</span>
                    <Slider
                      value={[spotVolume * 100]}
                      max={150}
                      step={1}
                      onValueChange={([v]) => onSpotVolumeChange(v / 100)}
                      onValueCommit={([v]) => onSpotVolumeChange(v / 100)}
                      className="flex-1"
                    />
                    <span className="text-[10px] text-accent font-mono w-8 text-right">{Math.round(spotVolume * 100)}%</span>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>
    </AnimatePresence>
  );
};

export default FloatingMiniPlayer;