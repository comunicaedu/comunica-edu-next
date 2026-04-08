"use client";

import { useState, useRef, useEffect } from "react";
import { Smile, Frown, Heart, TrendingUp, Coffee, Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { buildSmartQueue, markSongPlayed } from "@/hooks/useSmartShuffle";

interface Song {
  id: string;
  title: string;
  artist: string | null;
  genre: string | null;
  file_path: string;
  cover_url: string | null;
  created_at: string;
}

export interface MoodInfo {
  key: string;
  label: string;
  icon: React.ComponentType<any>;
  color: string;
}

interface MoodFlowProps {
  onPlay: (song: Song) => void;
  onPlayImported?: (song: Song) => void;
  onQueueChange?: (songs: Song[], currentIndex: number, playlistId?: string) => void;
  onMoodActive?: (mood: MoodInfo | null) => void;
}

const MOODS = [
  { key: "alegre", label: "Alegre", icon: Smile, color: "bg-yellow-500 border-yellow-500 text-white", loadingColor: "bg-yellow-600 border-yellow-600 text-white" },
  { key: "triste", label: "Triste", icon: Frown, color: "bg-blue-500 border-blue-500 text-white", loadingColor: "bg-blue-600 border-blue-600 text-white" },
  { key: "crente", label: "Crente", icon: Heart, color: "bg-purple-500 border-purple-500 text-white", loadingColor: "bg-purple-600 border-purple-600 text-white" },
  { key: "vendas", label: "Querendo Vender Muito", icon: TrendingUp, color: "bg-green-500 border-green-500 text-white", loadingColor: "bg-green-600 border-green-600 text-white" },
  { key: "relaxado", label: "Relaxado", icon: Coffee, color: "bg-cyan-500 border-cyan-500 text-white", loadingColor: "bg-cyan-600 border-cyan-600 text-white" },
];

const MoodFlow = ({ onPlay, onPlayImported, onQueueChange, onMoodActive }: MoodFlowProps) => {
  const [loading, setLoading] = useState<string | null>(null);
  const [activeMood, setActiveMood] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const handleMoodSelect = async (moodKey: string) => {
    if (loading) return;
    setLoading(moodKey);
    setActiveMood(moodKey);
    setIsOpen(false);

    try {
      const mood = MOODS.find(m => m.key === moodKey)!;

      const { data: allSongs, error } = await supabase
        .from("songs")
        .select("id, title, artist, genre, file_path, cover_url, created_at")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Erro ao buscar músicas:", error);
        setLoading(null);
        return;
      }

      const { data: aiData, error: aiError } = await supabase.functions.invoke("mood-mix", {
        body: {
          mood: moodKey,
          moodLabel: mood.label,
          songs: (allSongs || []).map(s => ({ id: s.id, title: s.title, artist: s.artist, genre: s.genre })),
        },
      });

      if (aiError) {
        console.error("Mood mix error:", aiError);
        setLoading(null);
        return;
      }

      const localIds = new Set((aiData?.songIds || []) as string[]);
      const localMatches = (allSongs || []).filter(s => localIds.has(s.id));
      
      const externalTracks: Song[] = ((aiData?.externalTracks || []) as any[]).map((t: any, i: number) => ({
        id: `ext-${t.videoId}-${i}`,
        title: t.title || "YouTube Track",
        artist: t.artist || null,
        genre: null,
        file_path: `youtube:${t.videoId}`,
        cover_url: t.cover_url || null,
        created_at: new Date().toISOString(),
      }));

      const combined = [...localMatches, ...externalTracks];

      if (combined.length === 0) {
        console.warn("Nenhuma música encontrada para esse humor.");
        setLoading(null);
        return;
      }

      const shuffled = buildSmartQueue(`mood-${moodKey}`, combined);
      if (shuffled.length > 0) {
        const firstSong = shuffled[0];
        const isImported = firstSong.file_path?.startsWith("imported/") || firstSong.file_path?.startsWith("youtube:");
        onQueueChange?.(shuffled, 0, `mood-${moodKey}`);
        markSongPlayed(`mood-${moodKey}`, firstSong.id);

        onMoodActive?.({ key: moodKey, label: mood.label, icon: mood.icon, color: mood.color });

        if (isImported && onPlayImported) {
          onPlayImported(firstSong);
        } else {
          onPlay(firstSong);
        }
      }
    } catch (err) {
      console.error("Mood flow error:", err);
    } finally {
      setLoading(null);
    }
  };

  const activeMoodData = activeMood ? MOODS.find(m => m.key === activeMood) : null;

  return (
    <div className="relative" ref={popoverRef}>
      {/* Trigger Button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={`
          w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl
          border-2 transition-all duration-300 font-semibold text-sm
          ${activeMoodData
            ? `${activeMoodData.color} shadow-lg`
            : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 hover:border-primary/60"
          }
          ${loading ? "opacity-70 cursor-wait" : "hover:scale-[1.02] active:scale-[0.98]"}
        `}
        disabled={!!loading}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : activeMoodData ? (
          <activeMoodData.icon className="h-4 w-4" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        <span>
          {loading
            ? "Carregando..."
            : activeMoodData
              ? `Flow ${activeMoodData.label}`
              : "🎵 Como está seu humor?"}
        </span>
      </button>

      {/* Popover dropdown */}
      {isOpen && (
        <div className="absolute z-50 top-full left-0 right-0 mt-2 bg-card border border-border rounded-xl shadow-xl p-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <p className="text-xs text-muted-foreground text-center mb-2.5 font-medium">
            Escolha seu humor
          </p>
          <div className="grid grid-cols-5 gap-2">
            {MOODS.map((mood) => {
              const Icon = mood.icon;
              const isActive = activeMood === mood.key;
              const isLoading = loading === mood.key;
              return (
                <button
                  key={mood.key}
                  onClick={() => handleMoodSelect(mood.key)}
                  disabled={!!loading}
                  className={`flex flex-col items-center gap-1.5 p-2.5 rounded-xl border-2 transition-all duration-200 ${
                    isLoading
                      ? `${mood.loadingColor} shadow-lg scale-95 opacity-80`
                      : isActive
                        ? `${mood.color} shadow-lg scale-105 ring-2 ring-white/40`
                        : `${mood.color} hover:scale-105 hover:shadow-md opacity-85 hover:opacity-100`
                  }`}
                >
                  {isLoading ? (
                    <Loader2 className="h-6 w-6 animate-spin" />
                  ) : (
                    <Icon className="h-6 w-6" />
                  )}
                  <span className="text-[9px] sm:text-[10px] font-semibold leading-tight text-center">
                    {mood.label}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MoodFlow;