"use client";

import { useState, useEffect, useRef } from "react";
import { Music, Search, Trash2, Pencil, Check, X, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
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
}

interface AllSongsManagerProps {
  onClose: () => void;
}

const AllSongsManager = ({ onClose }: AllSongsManagerProps) => {
  const [songs, setSongs] = useState<Song[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editArtist, setEditArtist] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);

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

  useEffect(() => {
    if (editingId && editRef.current) {
      editRef.current.focus();
      editRef.current.select();
    }
  }, [editingId]);

  // Sort: server uploads first, then YouTube/imported as secondary
  const sortedSongs = [...songs].sort((a, b) => {
    const aIsServer = !a.file_path.startsWith("youtube:") && !a.file_path.startsWith("imported/") && !a.file_path.startsWith("direct:");
    const bIsServer = !b.file_path.startsWith("youtube:") && !b.file_path.startsWith("imported/") && !b.file_path.startsWith("direct:");
    if (aIsServer && !bIsServer) return -1;
    if (!aIsServer && bIsServer) return 1;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const filtered = sortedSongs.filter((s) => {
    const q = search.toLowerCase();
    return (
      s.title.toLowerCase().includes(q) ||
      (s.artist?.toLowerCase().includes(q) ?? false) ||
      (s.genre?.toLowerCase().includes(q) ?? false)
    );
  });

  const startEditing = (song: Song) => {
    setEditingId(song.id);
    setEditTitle(song.title);
    setEditArtist(song.artist || "");
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditTitle("");
    setEditArtist("");
  };

  const saveEdit = async () => {
    if (!editingId || !editTitle.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/songs", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: editingId, title: editTitle.trim(), artist: editArtist.trim() || null }),
      });
      if (!res.ok) throw new Error();
      toast.success("Música atualizada!");
      setSongs((prev) =>
        prev.map((s) =>
          s.id === editingId ? { ...s, title: editTitle.trim(), artist: editArtist.trim() || null } : s
        )
      );
      window.dispatchEvent(new Event("songs-changed"));
    } catch {
      toast.error("Erro ao salvar.");
    }
    setSaving(false);
    setEditingId(null);
  };

  const handleDelete = async (song: Song) => {
    setDeleting(song.id);
    try {
      // Remove from playlist_songs first
      await fetch("/api/playlist-songs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song_id: song.id }),
      });
      // Remove song (API handles file deletion)
      const res = await fetch("/api/songs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: song.id }),
      });
      if (!res.ok) throw new Error();
      toast.success(`"${song.title}" removida.`);
      setSongs((prev) => prev.filter((s) => s.id !== song.id));
      window.dispatchEvent(new Event("songs-changed"));
    } catch {
      toast.error("Erro ao excluir música.");
    }
    setDeleting(null);
  };

  return (
    <div className="bg-card rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between p-4 bg-secondary/30">
        <div className="flex items-center gap-2">
          <Music className="h-5 w-5 text-primary" />
          <h3 className="text-sm font-semibold">Todas as Músicas</h3>
          <span className="text-xs text-muted-foreground">({songs.length})</span>
        </div>
        <Button size="sm" variant="ghost" onClick={onClose} className="h-7 w-7 p-0">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Search */}
      <div className="p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por título, artista ou gênero..."
            className="pl-9 bg-secondary/50 border-border text-sm h-9"
          />
        </div>
      </div>

      {/* Song list */}
      <div className="max-h-[60vh] overflow-y-auto">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
            Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12">
            <Music className="h-10 w-10 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground text-sm">
              {search ? "Nenhuma música encontrada." : "Nenhuma música na biblioteca."}
            </p>
          </div>
        ) : (
          <div>
            {filtered.map((song) => (
              <div
                key={song.id}
                className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors group"
              >
                {/* Cover */}
                {song.cover_url ? (
                  <img
                    src={song.cover_url}
                    alt=""
                    className="w-9 h-9 rounded object-cover shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                  />
                ) : (
                  <div className="w-9 h-9 rounded bg-primary/20 flex items-center justify-center shrink-0">
                    <EduLogoIcon size={20} />
                  </div>
                )}

                {/* Content */}
                {editingId === song.id ? (
                  <div className="flex-1 min-w-0 flex items-center gap-2">
                    <div className="flex-1 space-y-1">
                      <Input
                        ref={editRef}
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        placeholder="Título"
                        className="h-7 text-xs bg-secondary/50"
                        onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                      />
                      <Input
                        value={editArtist}
                        onChange={(e) => setEditArtist(e.target.value)}
                        placeholder="Artista"
                        className="h-7 text-xs bg-secondary/50"
                        onKeyDown={(e) => e.key === "Enter" && saveEdit()}
                      />
                    </div>
                    <Button size="sm" variant="ghost" onClick={saveEdit} disabled={saving} className="h-7 w-7 p-0 text-green-500 hover:text-green-600">
                      {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={cancelEditing} className="h-7 w-7 p-0 text-muted-foreground">
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{song.title}</p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {[song.artist, song.genre].filter(Boolean).join(" · ") || "Sem informações"}
                      </p>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => startEditing(song)}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                        title="Editar"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => handleDelete(song)}
                        disabled={deleting === song.id}
                        className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        title="Excluir"
                      >
                        {deleting === song.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default AllSongsManager;