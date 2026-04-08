"use client";

import { useState, useEffect } from "react";
import { Music, Play, Pause, Search, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import EduLogoIcon from "@/components/player/EduLogoIcon";

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

interface MusicLibraryProps {
  currentSong?: Song | null;
  isPlaying: boolean;
  onPlay: (song: Song) => void;
  onPause: () => void;
  onQueueChange?: (songs: Song[], currentIndex: number, playlistId: string) => void;
}

const CoverImage = ({ url }: { url: string | null }) => {
  if (!url) {
    return (
      <div className="w-10 h-10 rounded-md overflow-hidden bg-primary/20 flex items-center justify-center shrink-0">
        <EduLogoIcon size={24} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt="Capa"
      className="w-10 h-10 rounded-md object-cover shrink-0"
      onError={(e) => {
        (e.target as HTMLImageElement).style.display = "none";
      }}
    />
  );
};

const MusicLibrary = ({ currentSong, isPlaying, onPlay, onPause, onQueueChange }: MusicLibraryProps) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchSongs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/songs");
      const data = await res.json();
      setSongs(data.songs ?? []);
    } catch {
      toast.error("Erro ao carregar músicas.");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchSongs();

    const handler = () => fetchSongs();
    window.addEventListener("songs-changed", handler);
    return () => window.removeEventListener("songs-changed", handler);
  }, []);

  const filtered = songs.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.artist?.toLowerCase().includes(q) ?? false) ||
      (s.genre?.toLowerCase().includes(q) ?? false)
    );
  });

  const handleDelete = async (song: Song) => {
    try {
      await fetch("/api/songs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: song.id }),
      });
      toast.success(`"${song.title}" removida.`);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
    } catch {
      toast.error("Erro ao excluir música.");
    }
  };

  const isCurrentSong = (song: Song) => currentSong?.id === song.id;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por título, artista ou gênero..."
          className="pl-9 bg-secondary/50 border-border"
        />
      </div>

      {loading ? (
        <div className="text-center py-12 text-muted-foreground text-sm">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12">
          <Music className="h-12 w-12 text-muted-foreground mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">
            {search ? "Nenhuma música encontrada." : "Nenhuma música na biblioteca. Envie sua primeira música!"}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((song) => (
            <div
              key={song.id}
              className={`flex items-center gap-3 p-3 rounded-lg transition-colors group ${
                isCurrentSong(song) ? "bg-primary/15" : "hover:bg-secondary/50"
              }`}
            >
              <CoverImage url={song.cover_url} />

              <button
                onClick={() => {
                  if (isCurrentSong(song) && isPlaying) { onPause(); return; }
                  const idx = filtered.indexOf(song);
                  onQueueChange?.(filtered, idx >= 0 ? idx : 0, "biblioteca");
                  onPlay(song);
                }}
                className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${
                  isCurrentSong(song)
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:bg-primary hover:text-primary-foreground"
                } transition-colors`}
              >
                {isCurrentSong(song) && isPlaying ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 ml-0.5" />
                )}
              </button>

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${isCurrentSong(song) ? "text-primary" : ""}`}>
                  {song.title}
                </p>
                <p className="text-xs text-muted-foreground truncate">
                  {[song.artist, song.genre].filter(Boolean).join(" · ") || "Sem informações"}
                </p>
              </div>

              <button
                onClick={() => handleDelete(song)}
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default MusicLibrary;
