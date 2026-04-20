"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Music, Pencil, Trash2, Loader2, Tag, Search, ListMusic, FolderInput, Play, Pause, Plus, Check, X, Users } from "lucide-react";
import AdminMiniTransport from "./AdminMiniTransport";
import PlaylistManagement from "./PlaylistManagement";
import UserPlaylistsCuration from "./UserPlaylistsCuration";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";
import { authedFetch } from "@/lib/authedFetch";


interface GenreWithCount {
  name: string;
  count: number;
}

interface SongInGenre {
  id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  file_path: string;
  genre: string | null;
}


const GenreManagement = () => {
  const [deletingGenreName, setDeletingGenreName] = useState<string | null>(null);
  const [genres, setGenres] = useState<GenreWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"playlists" | "generos" | "user_playlists">("generos");

  const [selectedGenre, setSelectedGenre] = useState<string | null>(null);
  const [genreSongs, setGenreSongs] = useState<SongInGenre[]>([]);
  const [genreSongsLoading, setGenreSongsLoading] = useState(false);
  const [genreSearch, setGenreSearch] = useState("");
  const [genreListSearch, setGenreListSearch] = useState("");
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);

  const [editingGenre, setEditingGenre] = useState<string | null>(null);
  const [editName, setEditName] = useState("");

  // Play state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<"local" | "yt" | null>(null);

  // Move state
  const [movingSongId, setMovingSongId] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [allPlaylists, setAllPlaylists] = useState<{ id: string; name: string; count: number }[]>([]);

  // Edit song name state
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [editSongName, setEditSongName] = useState("");

  // YouTube API loader
  useEffect(() => {
    if (!ytContainerRef.current) {
      const div = document.createElement("div");
      div.id = "admin-yt-player";
      div.style.cssText = "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;";
      document.body.appendChild(div);
      ytContainerRef.current = div;
    }
    return () => {
      if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
      ytPlayerRef.current?.destroy();
      ytContainerRef.current?.remove();
    };
  }, []);

  const loadYTApi = useCallback((): Promise<void> => {
    if (window.YT?.Player) return Promise.resolve();
    return new Promise((resolve) => {
      if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const check = setInterval(() => { if (window.YT?.Player) { clearInterval(check); resolve(); } }, 100);
        return;
      }
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      window.onYouTubeIframeAPIReady = () => resolve();
    });
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    try { ytPlayerRef.current?.stopVideo(); } catch {}
    setPlayingSongId(null);
    setAudioLoading(null);
    setPlayMode(null);
  }, []);

  const fetchGenres = useCallback(async () => {
    setLoading(true);
    try {
      const [genresRes, songsRes] = await Promise.all([
        authedFetch("/api/genres").then((r) => r.json()),
        authedFetch("/api/songs").then((r) => r.json()),
      ]);

      const standards: { id: string; name: string; display_name: string }[] = genresRes.genres ?? [];
      const songs: { genre: string | null }[] = songsRes.songs ?? [];

      const countMapLower: Record<string, number> = {};
      songs.forEach((s) => {
        const g = (s.genre || "Sem Gênero").toLowerCase();
        countMapLower[g] = (countMapLower[g] || 0) + 1;
      });

      const standardNamesLower = new Set(standards.map((g) => g.display_name.toLowerCase()));

      const composed: GenreWithCount[] = standards.map((g) => ({
        name: g.display_name,
        count: countMapLower[g.display_name.toLowerCase()] || 0,
      }));

      for (const [lowerName, count] of Object.entries(countMapLower)) {
        if (lowerName === "sem gênero") continue;
        if (!standardNamesLower.has(lowerName)) {
          const originalName = songs.find((s) => (s.genre || "").toLowerCase() === lowerName)?.genre || lowerName;
          composed.push({ name: originalName, count });
        }
      }

      if ((countMapLower["sem gênero"] || 0) > 0) {
        composed.push({ name: "Sem Gênero", count: countMapLower["sem gênero"] || 0 });
      }

      composed.sort((a, b) => a.name.localeCompare(b.name));
      setGenres(composed);
    } catch (err) {
      console.error("fetchGenres error:", err);
      toast.error("Erro ao carregar gêneros.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Keep a ref to selectedGenre for realtime callbacks
  const selectedGenreRef = useRef<string | null>(null);
  useEffect(() => { selectedGenreRef.current = selectedGenre; }, [selectedGenre]);

  useEffect(() => {
    fetchGenres();
    const handler = () => {
      fetchGenres();
      if (selectedGenreRef.current) openGenreDetail(selectedGenreRef.current);
    };
    window.addEventListener("songs-changed", handler);
    return () => window.removeEventListener("songs-changed", handler);
  }, [fetchGenres]);

  const fetchAllPlaylists = useCallback(async () => {
    try {
      const [plRes, psRes] = await Promise.all([
        authedFetch("/api/playlists").then((r) => r.json()),
        authedFetch("/api/playlist-songs").then((r) => r.json()),
      ]);
      const playlists: { id: string; name: string }[] = plRes.playlists ?? [];
      const joins: { playlist_id: string }[] = psRes.joins ?? [];
      const countMap: Record<string, number> = {};
      joins.forEach((j) => { countMap[j.playlist_id] = (countMap[j.playlist_id] || 0) + 1; });
      setAllPlaylists(playlists.map((p) => ({ id: p.id, name: p.name, count: countMap[p.id] || 0 })));
    } catch (err) {
      console.error("fetchAllPlaylists error:", err);
    }
  }, []);

  const openGenreDetail = async (genreName: string) => {
    stopAudio();
    setSelectedGenre(genreName);
    setGenreSearch("");
    setGenreSongsLoading(true);
    setEditingSongId(null);
    fetchAllPlaylists();
    try {
      const res = await authedFetch(`/api/songs${genreName !== "Sem Gênero" ? `?genre=${encodeURIComponent(genreName)}` : ""}`);
      const data = await res.json();
      let songs: SongInGenre[] = data.songs ?? [];
      if (genreName === "Sem Gênero") songs = songs.filter((s) => !s.genre);
      songs.sort((a, b) => a.title.localeCompare(b.title));
      setGenreSongs(songs);
    } catch {
      toast.error("Erro ao carregar músicas do gênero.");
      setGenreSongs([]);
    } finally {
      setGenreSongsLoading(false);
    }
  };

  const handleCloseDialog = () => {
    stopAudio();
    setSelectedGenre(null);
  };

  // ─── PLAY ───
  const playViaYouTube = useCallback(async (videoId: string, songId: string) => {
    await loadYTApi();
    try { ytPlayerRef.current?.destroy(); } catch {}

    const inner = document.createElement("div");
    inner.id = "admin-yt-inner";
    ytContainerRef.current!.innerHTML = "";
    ytContainerRef.current!.appendChild(inner);

    ytPlayerRef.current = new window.YT.Player("admin-yt-inner", {
      videoId,
      playerVars: { autoplay: 1, controls: 0 },
      events: {
        onReady: (e: any) => {
          e.target.setVolume(50);
          e.target.playVideo();
          setPlayingSongId(songId);
          setPlayMode("yt");
          setAudioLoading(null);
        },
        onStateChange: (e: any) => {
          if (e.data === window.YT.PlayerState.ENDED) {
            setPlayingSongId(null);
            setPlayMode(null);
          }
        },
        onError: () => {
          toast.error("Erro ao reproduzir via YouTube.");
          setPlayingSongId(null);
          setAudioLoading(null);
          setPlayMode(null);
        },
      },
    });
  }, [loadYTApi]);

  // Listen for main player starting — stop admin audio
  useEffect(() => {
    const handler = () => stopAudio();
    window.addEventListener("main-playback-start", handler);
    return () => window.removeEventListener("main-playback-start", handler);
  }, [stopAudio]);

  const handlePlaySong = async (song: SongInGenre) => {
    if (playingSongId === song.id) { stopAudio(); return; }
    stopAudio();
    setAudioLoading(song.id);
    // Pause the main player
    window.dispatchEvent(new Event("admin-playback-start"));

    try {
      // 1) Try local/direct audio (skip youtube: and imported: prefixes)
      const fp = song.file_path || "";
      const isYtPath = fp.startsWith("youtube:");
      const isImported = fp.startsWith("imported/");
      const isDirect = fp.startsWith("direct:");

      if (isDirect) {
        const url = fp.replace("direct:", "");
        if (await tryPlayLocal(url, song.id)) return;
      } else if (!isYtPath && !isImported && fp.length > 0) {
        // Local file (e.g. /uploads/songs/...)
        if (await tryPlayLocal(fp, song.id)) return;
      }

      // YouTube fallback
      let videoId: string | null = null;
      if (isYtPath) {
        const raw = fp.replace("youtube:", "");
        if (raw.length >= 5 && raw !== "pending") videoId = raw;
      }

      if (!videoId) {
        toast.error("Não foi possível reproduzir esta música.");
        setAudioLoading(null);
        return;
      }

      await playViaYouTube(videoId!, song.id);
    } catch (err) {
      console.error("Admin play error:", err);
      toast.error("Erro ao reproduzir.");
      setAudioLoading(null);
    }
  };

  const tryPlayLocal = async (url: string, songId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!audioRef.current) { audioRef.current = new Audio(); audioRef.current.volume = 0.5; }
      audioRef.current.src = url;
      audioRef.current.onended = () => { setPlayingSongId(null); setPlayMode(null); };
      audioRef.current.onerror = () => resolve(false);
      audioRef.current.oncanplaythrough = () => {
        audioRef.current!.play().then(() => {
          setPlayingSongId(songId);
          setPlayMode("local");
          setAudioLoading(null);
          resolve(true);
        }).catch(() => resolve(false));
      };
      // Timeout fallback
      setTimeout(() => resolve(false), 5000);
    });
  };

  // ─── MOVE ───
  // ─── RENAME SONG ───
  const handleRenameSong = async (song: SongInGenre) => {
    if (!editSongName.trim() || editSongName.trim() === song.title) { setEditingSongId(null); return; }
    const newTitle = editSongName.trim();
    const res = await authedFetch("/api/songs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: song.id, title: newTitle }),
    });
    if (!res.ok) { toast.error("Erro ao renomear música."); }
    else {
      setGenreSongs((prev) => prev.map((s) => s.id === song.id ? { ...s, title: newTitle } : s));
      toast.success(`Renomeada para "${newTitle}".`);
    }
    setEditingSongId(null);
  };

  // ─── MOVE TO PLAYLIST ───
  const handleMoveToPlaylist = async (song: SongInGenre, playlistId: string, playlistName: string) => {
    try {
      await authedFetch("/api/playlist-songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playlist_id: playlistId, song_ids: [song.id] }),
      });
      toast.success(`"${song.title}" adicionada à playlist "${playlistName}".`);
      setMovingSongId(null);
    } catch {
      toast.error("Erro ao mover para playlist.");
    }
  };

  const handleMoveSong = async (song: SongInGenre, targetGenre: string) => {
    const newGenre = targetGenre === "Sem Gênero" ? null : targetGenre;
    const res = await authedFetch("/api/songs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: song.id, genre: newGenre }),
    });
    if (!res.ok) { toast.error("Erro ao mover música."); return; }

    setGenreSongs((prev) => prev.filter((s) => s.id !== song.id));
    setGenres((prev) =>
      prev.map((g) => {
        if (g.name === selectedGenre) return { ...g, count: Math.max(0, g.count - 1) };
        if (g.name === targetGenre) return { ...g, count: g.count + 1 };
        return g;
      })
    );
    setMovingSongId(null);
    toast.success(`"${song.title}" movida para ${targetGenre}.`);
  };

  // ─── HARD DELETE ───
  const handleHardDelete = async (song: SongInGenre) => {
    if (!confirm(`Excluir PERMANENTEMENTE "${song.title}"? Esta ação não pode ser desfeita.`)) return;
    setDeletingSongId(song.id);
    try {
      // Remove from playlist associations
      await authedFetch("/api/playlist-songs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ song_id: song.id }),
      });
      // Delete song file + record
      await authedFetch("/api/songs", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: song.id }),
      });

      if (playingSongId === song.id) stopAudio();
      setGenreSongs((prev) => prev.filter((s) => s.id !== song.id));
      setGenres((prev) =>
        prev.map((g) => g.name === selectedGenre ? { ...g, count: Math.max(0, g.count - 1) } : g)
      );
      window.dispatchEvent(new Event("songs-changed"));
      toast.success(`"${song.title}" excluída permanentemente.`);
    } catch {
      toast.error("Erro ao excluir música.");
    } finally {
      setDeletingSongId(null);
    }
  };

  const handleDeleteGenre = async (genre: GenreWithCount) => {
    if (!confirm(`Excluir o gênero "${genre.name}" e todas as ${genre.count} músicas associadas? Esta ação não pode ser desfeita.`)) return;
    setDeletingGenreName(genre.name);
    try {
      // 1. Fetch all songs of this genre
      const songsRes = await authedFetch("/api/songs").then((r) => r.json());
      const allSongs: { id: string; genre: string | null }[] = songsRes.songs ?? [];
      const genreSongsToDelete = genre.name === "Sem Gênero"
        ? allSongs.filter((s) => !s.genre)
        : allSongs.filter((s) => (s.genre ?? "").toLowerCase() === genre.name.toLowerCase());

      // 2. Delete each song (removes file + playlist associations via API)
      for (const s of genreSongsToDelete) {
        await authedFetch("/api/playlist-songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ song_id: s.id }) });
        await authedFetch("/api/songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id }) });
      }

      // 3. Remove genre from genres list
      if (genre.name !== "Sem Gênero") {
        const genresRes = await authedFetch("/api/genres").then((r) => r.json());
        const genreRecord = (genresRes.genres ?? []).find(
          (g: { name: string; display_name: string; id: string }) =>
            g.display_name.toLowerCase() === genre.name.toLowerCase()
        );
        if (genreRecord) {
          await authedFetch("/api/genres", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: genreRecord.id }) });
        }
      }

      window.dispatchEvent(new CustomEvent("admin-genre-deleted", { detail: { genreName: genre.name } }));
      window.dispatchEvent(new Event("songs-changed"));
      toast.success(`Gênero "${genre.name}" excluído com ${genreSongsToDelete.length} músicas.`);
      fetchGenres();
    } catch (err) {
      console.error("Erro ao excluir gênero:", err);
      toast.error("Erro ao excluir gênero.");
    } finally {
      setDeletingGenreName(null);
    }
  };

  const handleRenameGenre = async (oldName: string) => {
    if (!editName.trim() || editName.trim() === oldName) { setEditingGenre(null); return; }
    const newName = editName.trim();
    // Update all songs with that genre
    const songsRes = await authedFetch("/api/songs").then((r) => r.json());
    const toUpdate = (songsRes.songs ?? []).filter((s: { genre: string | null }) =>
      oldName === "Sem Gênero" ? !s.genre : (s.genre ?? "").toLowerCase() === oldName.toLowerCase()
    );
    await Promise.all(toUpdate.map((s: { id: string }) =>
      authedFetch("/api/songs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: s.id, genre: newName }) })
    ));
    toast.success(`Gênero renomeado para "${newName}".`);
    fetchGenres();
    setEditingGenre(null);
  };

  const filteredGenreSongs = genreSongs.filter((s) => {
    if (!genreSearch.trim()) return true;
    const q = genreSearch.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.artist?.toLowerCase().includes(q) ?? false);
  });

  const availableGenresForMove = genres.filter((g) => g.name !== selectedGenre);

  const filteredMoveTargets = (() => {
    const q = moveSearch.toLowerCase();
    const playlistItems = allPlaylists.map((p) => ({ type: "playlist" as const, id: p.id, label: p.name, count: p.count }));
    const genreItems = availableGenresForMove.map((g) => ({ type: "genre" as const, id: null, label: g.name, count: g.count }));
    const all = [...playlistItems, ...genreItems];
    if (!q) return all;
    return all.filter((t) => t.label.toLowerCase().includes(q));
  })();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Tag className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Gestão de Gêneros</h3>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-card rounded-xl">
        <button
          onClick={() => setTab("generos")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === "generos" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
        >
          <Tag className="h-4 w-4 inline mr-2" />Gêneros
        </button>
        <button
          onClick={() => setTab("playlists")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === "playlists" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
        >
          <ListMusic className="h-4 w-4 inline mr-2" />Playlists
        </button>
        <button
          onClick={() => setTab("user_playlists")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
            tab === "user_playlists" ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
          }`}
        >
          <Users className="h-4 w-4 inline mr-2" />Playlists de Usuários
        </button>
      </div>

      {tab === "playlists" && <PlaylistManagement />}
      {tab === "user_playlists" && <UserPlaylistsCuration />}

      {tab === "generos" && (
        <div className="space-y-3">
          {/* Add genre + Search */}
          <div className="flex items-center gap-2">
            {editingGenre === "__new__" ? (
              <div className="flex items-center gap-2 flex-1">
                <Input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Nome do novo gênero..."
                  className="h-8 text-sm bg-secondary/50 border-border flex-1"
                  autoFocus
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && editName.trim()) {
                      const name = editName.trim();
                      const res = await authedFetch("/api/genres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.toLowerCase().replace(/\s+/g, "_"), display_name: name }) });
                      if (!res.ok) { toast.error("Erro ao adicionar gênero."); }
                      else { toast.success(`Gênero "${name}" adicionado!`); fetchGenres(); }
                      setEditingGenre(null); setEditName("");
                    }
                  }}
                />
                <button type="button" onClick={async () => {
                  if (editName.trim()) {
                    const name = editName.trim();
                    const res = await authedFetch("/api/genres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: name.toLowerCase().replace(/\s+/g, "_"), display_name: name }) });
                    if (!res.ok) { toast.error("Erro ao adicionar gênero."); }
                    else { toast.success(`Gênero "${name}" adicionado!`); fetchGenres(); }
                  }
                  setEditingGenre(null); setEditName("");
                }} className="p-1.5 rounded-md text-green-500 hover:bg-green-500/10"><Check className="h-4 w-4" /></button>
                <button onClick={() => { setEditingGenre(null); setEditName(""); }} className="p-1.5 rounded-md text-muted-foreground hover:bg-secondary"><X className="h-4 w-4" /></button>
              </div>
            ) : (
              <button onClick={() => { setEditingGenre("__new__"); setEditName(""); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-secondary/50 transition-colors">
                <Plus className="h-3.5 w-3.5" /> Adicionar Gênero
              </button>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={genreListSearch}
              onChange={(e) => setGenreListSearch(e.target.value)}
              placeholder="Buscar gênero..."
              className="pl-9 bg-secondary/50 border-border text-sm h-9"
            />
          </div>

          <div className="bg-card rounded-xl overflow-hidden">
          {loading ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Carregando gêneros...
            </div>
          ) : genres.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground text-sm">
              <Music className="h-8 w-8 mx-auto mb-2 opacity-50" />
              Nenhum gênero encontrado.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Título</TableHead>
                  <TableHead>Total de Músicas</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {genres.filter(g => !genreListSearch.trim() || g.name.toLowerCase().includes(genreListSearch.toLowerCase())).map((g) => (
                  <TableRow key={g.name} className="cursor-pointer hover:bg-secondary/30" onClick={() => openGenreDetail(g.name)}>
                    <TableCell>
                      <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center">
                        <Music className="h-5 w-5 text-muted-foreground" />
                      </div>
                    </TableCell>
                    <TableCell>
                      {editingGenre === g.name ? (
                        <Input
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          onBlur={() => handleRenameGenre(g.name)}
                          onKeyDown={(e) => e.key === "Enter" && handleRenameGenre(g.name)}
                          onClick={(e) => e.stopPropagation()}
                          className="h-8 w-48 text-sm bg-secondary/50"
                          autoFocus
                        />
                      ) : (
                        <span className="font-medium">{g.name}</span>
                      )}
                    </TableCell>
                    <TableCell>{g.count}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={(e) => { e.stopPropagation(); setEditingGenre(g.name); setEditName(g.name); }}
                          className="p-2 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors">
                          <Pencil className="h-4 w-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleDeleteGenre(g); }}
                          disabled={deletingGenreName === g.name}
                          className="p-2 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors">
                          {deletingGenreName === g.name ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          </div>
        </div>
      )}

      {/* Genre detail dialog — FIXED SIZE */}
      <Dialog open={!!selectedGenre} onOpenChange={(o) => !o && handleCloseDialog()}>
        <DialogContent
          hideCloseButton
          className="sm:max-w-[500px] w-[calc(100vw-2rem)] max-w-[500px] h-[80dvh] max-h-[80dvh] overflow-hidden flex flex-col p-0"
        >
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-white">
              <Music className="h-5 w-5 text-primary" />
              {selectedGenre} ({filteredGenreSongs.length})
            </DialogTitle>
          </DialogHeader>

          <div className="px-5 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={genreSearch}
                onChange={(e) => setGenreSearch(e.target.value)}
                placeholder="Buscar música..."
                className="pl-9 bg-secondary/50 border-muted text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-none px-2">
            {genreSongsLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm">
                <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Carregando...
              </div>
            ) : filteredGenreSongs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma música.</div>
            ) : (
              filteredGenreSongs.map((song) => (
                <div
                  key={song.id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-colors group cursor-pointer ${
                    playingSongId === song.id ? "bg-primary/15" : "hover:bg-secondary/40"
                  }`}
                  onClick={() => handlePlaySong(song)}
                >
                  {/* Cover / Play icon */}
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0">
                    {song.cover_url ? (
                      <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-primary/20 flex items-center justify-center">
                        <Music className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                      playingSongId === song.id || audioLoading === song.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}>
                      {audioLoading === song.id ? (
                        <Loader2 className="h-4 w-4 text-white animate-spin" />
                      ) : playingSongId === song.id ? (
                        <Pause className="h-4 w-4 text-white" />
                      ) : (
                        <Play className="h-4 w-4 text-white" />
                      )}
                    </div>
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    {editingSongId === song.id ? (
                      <Input
                        value={editSongName}
                        onChange={(e) => setEditSongName(e.target.value)}
                        onBlur={() => handleRenameSong(song)}
                        onKeyDown={(e) => e.key === "Enter" && handleRenameSong(song)}
                        onClick={(e) => e.stopPropagation()}
                        className="h-7 text-sm bg-secondary/50 border-muted"
                        autoFocus
                      />
                    ) : (
                      <p className="text-sm font-medium truncate">{song.title}</p>
                    )}
                    <p className="text-[11px] text-muted-foreground truncate">{song.artist || "Artista desconhecido"}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {/* Edit name */}
                    <button
                      onClick={() => { setEditingSongId(song.id); setEditSongName(song.title); }}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Editar nome"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>

                    {/* Move */}
                    <Popover
                      open={movingSongId === song.id}
                      onOpenChange={(o) => {
                        setMovingSongId(o ? song.id : null);
                        if (o) { setMoveSearch(""); fetchAllPlaylists(); }
                      }}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100"
                          title="Mover para gênero ou playlist"
                        >
                          <FolderInput className="h-4 w-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0" align="end" side="left" sideOffset={4} portalled={false}>
                        <div className="p-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <input
                              type="text"
                              placeholder="Buscar destino..."
                              value={moveSearch}
                              onChange={(e) => setMoveSearch(e.target.value)}
                              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-secondary/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary"
                              autoFocus
                            />
                          </div>
                        </div>
                        <div
                          className="max-h-72 overflow-y-auto overscroll-contain touch-pan-y scrollbar-none py-1"
                          style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
                          onWheelCapture={(e) => e.stopPropagation()}
                          onTouchMove={(e) => e.stopPropagation()}
                        >
                          {filteredMoveTargets.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Nenhum destino encontrado.</div>
                          ) : (
                            <>
                              {filteredMoveTargets.some(t => t.type === "playlist") && (
                                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Playlists</div>
                              )}
                              {filteredMoveTargets.filter(t => t.type === "playlist").map((t) => (
                                <button
                                  key={`p-${t.id}`}
                                  onClick={() => handleMoveToPlaylist(song, t.id!, t.label)}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/60 transition-colors flex items-center justify-between"
                                >
                                  <span className="truncate flex items-center gap-1.5">
                                    <ListMusic className="h-3 w-3 text-muted-foreground shrink-0" />
                                    {t.label}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground ml-2">{t.count}</span>
                                </button>
                              ))}
                              {filteredMoveTargets.some(t => t.type === "genre") && (
                                <div className="px-3 py-1 mt-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider pt-2">Gêneros</div>
                              )}
                              {filteredMoveTargets.filter(t => t.type === "genre").map((t) => (
                                <button
                                  key={`g-${t.label}`}
                                  onClick={() => handleMoveSong(song, t.label)}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/60 transition-colors flex items-center justify-between"
                                >
                                  <span className="truncate flex items-center gap-1.5">
                                    <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                                    {t.label}
                                  </span>
                                  <span className="text-[10px] text-muted-foreground ml-2">{t.count}</span>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>

                    {/* Delete */}
                    <button
                      onClick={() => handleHardDelete(song)}
                      disabled={deletingSongId === song.id}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100"
                      title="Excluir permanentemente"
                    >
                      {deletingSongId === song.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {playingSongId && (
            <AdminMiniTransport
              songTitle={genreSongs.find(s => s.id === playingSongId)?.title || ""}
              isPlaying={!!playingSongId}
              playMode={playMode}
              audioRef={audioRef}
              ytPlayerRef={ytPlayerRef}
              onPrev={() => {
                const list = filteredGenreSongs;
                const idx = list.findIndex(s => s.id === playingSongId);
                if (idx > 0) handlePlaySong(list[idx - 1]);
                else if (list.length > 0) handlePlaySong(list[list.length - 1]);
              }}
              onNext={() => {
                const list = filteredGenreSongs;
                const idx = list.findIndex(s => s.id === playingSongId);
                if (idx < list.length - 1) handlePlaySong(list[idx + 1]);
                else if (list.length > 0) handlePlaySong(list[0]);
              }}
              onPlayPause={() => {
                if (playMode === "local" && audioRef.current) {
                  audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause();
                } else if (playMode === "yt" && ytPlayerRef.current) {
                  try {
                    const state = ytPlayerRef.current.getPlayerState?.();
                    state === 1 ? ytPlayerRef.current.pauseVideo() : ytPlayerRef.current.playVideo();
                  } catch {}
                }
              }}
              onStop={stopAudio}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GenreManagement;