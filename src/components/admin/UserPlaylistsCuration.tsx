"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Music, Pencil, Trash2, Loader2, Search, FolderInput, Play, Pause, ListMusic, Tag, Globe, Lock } from "lucide-react";
import AdminMiniTransport from "./AdminMiniTransport";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase/client";
import { authedFetch } from "@/lib/authedFetch";
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

interface UserPlaylist {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  created_by: string;
  is_public: boolean;
  created_at: string;
  song_count: number;
  genre: string | null;
  owner_name: string | null;
  owner_email: string | null;
}

interface SongInPlaylist {
  id: string;
  title: string;
  artist: string | null;
  cover_url: string | null;
  file_path: string;
  genre: string | null;
  playlist_song_id: string;
}

const PAGE_SIZE = 1000;

async function fetchPaginated<T>(
  queryFn: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await queryFn(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const chunk = data ?? [];
    all.push(...chunk);
    if (chunk.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return all;
}

const UserPlaylistsCuration = () => {
  const [playlists, setPlaylists] = useState<UserPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  // Detail dialog
  const [selectedPlaylist, setSelectedPlaylist] = useState<UserPlaylist | null>(null);
  const [playlistSongs, setPlaylistSongs] = useState<SongInPlaylist[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songSearch, setSongSearch] = useState("");
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);

  // Edit song name
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [editSongName, setEditSongName] = useState("");

  // Move state
  const [movingSongId, setMovingSongId] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [allMoveTargets, setAllMoveTargets] = useState<{ type: "playlist" | "genre"; id: string | null; label: string; count: number }[]>([]);

  // Play state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<"local" | "yt" | null>(null);

  useEffect(() => {
    if (!ytContainerRef.current) {
      const div = document.createElement("div");
      div.id = "admin-user-yt-player";
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

  useEffect(() => {
    const handler = () => stopAudio();
    window.addEventListener("main-playback-start", handler);
    return () => window.removeEventListener("main-playback-start", handler);
  }, [stopAudio]);

  const fetchPlaylists = useCallback(async () => {
    setLoading(true);
    try {
      // Get user-created playlists (created_by IS NOT NULL)
      const { data: raw, error } = await supabase
        .from("playlists")
        .select("id, name, description, cover_url, created_by, is_public, created_at")
        .not("created_by", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;

      const items = raw ?? [];
      if (items.length === 0) { setPlaylists([]); setLoading(false); return; }

      // Get song counts
      const psRows = await fetchPaginated<{ playlist_id: string; song_id: string }>((from, to) =>
        supabase.from("playlist_songs").select("playlist_id, song_id").range(from, to)
      );
      const countMap: Record<string, number> = {};
      const genreMap: Record<string, string[]> = {};
      psRows.forEach((r) => { countMap[r.playlist_id] = (countMap[r.playlist_id] || 0) + 1; });

      // Get song genres for each playlist
      const songIds = [...new Set(psRows.map(r => r.song_id))];
      const songGenres: Record<string, string | null> = {};
      if (songIds.length > 0) {
        for (let i = 0; i < songIds.length; i += 500) {
          const chunk = songIds.slice(i, i + 500);
          const { data: songs } = await supabase.from("songs").select("id, genre").in("id", chunk);
          (songs ?? []).forEach(s => { songGenres[s.id] = s.genre; });
        }
      }

      // Build genre per playlist (most common genre)
      psRows.forEach(r => {
        if (!genreMap[r.playlist_id]) genreMap[r.playlist_id] = [];
        const g = songGenres[r.song_id];
        if (g) genreMap[r.playlist_id].push(g);
      });

      // Get owner profiles via list-clients API (uses service_role, bypasses RLS)
      const ownerIds = [...new Set(items.map(p => p.created_by!))];
      const profileMap: Record<string, { nome: string | null; email: string | null }> = {};
      if (ownerIds.length > 0) {
        try {
          const res = await authedFetch("/api/admin/list-clients", { method: "POST", headers: { "Content-Type": "application/json" } });
          const data = await res.json();
          const clients: { user_id: string; nome: string | null; email: string | null; username: string | null }[] = data.clients ?? [];
          const adminRoles: { user_id: string }[] = (data.roles ?? []).filter((r: any) => r.role === "admin");
          const adminIds = new Set(adminRoles.map(r => r.user_id));
          clients.forEach(c => {
            if (ownerIds.includes(c.user_id)) {
              profileMap[c.user_id] = {
                nome: c.nome || c.username || (adminIds.has(c.user_id) ? "Administrador" : null),
                email: c.email,
              };
            }
          });
        } catch {}
        // Garante que TODOS os ownerIds tenham entrada
        ownerIds.forEach(id => {
          if (!profileMap[id]) {
            profileMap[id] = { nome: null, email: null };
          }
        });
      }

      const result: UserPlaylist[] = items.map(p => {
        const genres = genreMap[p.id] || [];
        const genreCounts: Record<string, number> = {};
        genres.forEach(g => { genreCounts[g] = (genreCounts[g] || 0) + 1; });
        const topGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        return {
          id: p.id,
          name: p.name,
          description: p.description,
          cover_url: p.cover_url,
          created_by: p.created_by!,
          is_public: p.is_public,
          created_at: p.created_at,
          song_count: countMap[p.id] || 0,
          genre: topGenre,
          owner_name: profileMap[p.created_by!]?.nome || null,
          owner_email: profileMap[p.created_by!]?.email || null,
        };
      });

      setPlaylists(result);
    } catch (err) {
      console.error("fetchUserPlaylists error:", err);
      toast.error("Erro ao carregar playlists de usuários.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPlaylists();
    const channel = supabase
      .channel("admin-user-playlists-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlists" }, () => fetchPlaylists())
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_songs" }, () => fetchPlaylists())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [fetchPlaylists]);

  // ─── ACTIONS ───
  const handleMakePublic = async (playlist: UserPlaylist) => {
    setActionLoading(playlist.id);
    const { error } = await supabase.from("playlists").update({ is_public: true }).eq("id", playlist.id);
    if (error) toast.error("Erro ao tornar pública.");
    else { toast.success(`"${playlist.name}" agora é pública!`); fetchPlaylists(); }
    setActionLoading(null);
  };

  const handleMakePrivate = async (playlist: UserPlaylist) => {
    setActionLoading(playlist.id);
    const { error } = await supabase.from("playlists").update({ is_public: false }).eq("id", playlist.id);
    if (error) toast.error("Erro ao tornar privada.");
    else { toast.success(`"${playlist.name}" agora é privada.`); fetchPlaylists(); }
    setActionLoading(null);
  };

  const handleDeletePlaylist = async (playlist: UserPlaylist) => {
    if (!confirm(`Excluir PERMANENTEMENTE a playlist "${playlist.name}"? Todas as músicas serão desvinculadas.`)) return;
    setActionLoading(playlist.id);
    try {
      await supabase.from("playlist_songs").delete().eq("playlist_id", playlist.id);
      await supabase.from("playlist_schedules").delete().eq("playlist_id", playlist.id);
      const { error } = await supabase.from("playlists").delete().eq("id", playlist.id);
      if (error) throw error;
      // Notify player to handle deletion
      window.dispatchEvent(new CustomEvent("admin-playlist-deleted", { detail: { playlistId: playlist.id } }));
      toast.success(`"${playlist.name}" excluída permanentemente.`);
      if (selectedPlaylist?.id === playlist.id) { stopAudio(); setSelectedPlaylist(null); }
      fetchPlaylists();
    } catch {
      toast.error("Erro ao excluir playlist.");
    } finally {
      setActionLoading(null);
    }
  };

  // ─── DETAIL ───
  const openDetail = async (playlist: UserPlaylist) => {
    stopAudio();
    setSelectedPlaylist(playlist);
    setSongSearch("");
    setEditingSongId(null);
    setSongsLoading(true);
    fetchMoveTargets();
    try {
      const songs = await fetchPaginated<any>((from, to) =>
        supabase.from("playlist_songs")
          .select("id, position, song_id, songs(id, title, artist, cover_url, file_path, genre)")
          .eq("playlist_id", playlist.id)
          .order("position")
          .range(from, to)
      );
      setPlaylistSongs(songs.filter((s: any) => s.songs).map((s: any) => ({
        id: s.songs.id,
        title: s.songs.title,
        artist: s.songs.artist,
        cover_url: s.songs.cover_url,
        file_path: s.songs.file_path,
        genre: s.songs.genre,
        playlist_song_id: s.id,
      })));
    } catch {
      toast.error("Erro ao carregar músicas.");
      setPlaylistSongs([]);
    } finally {
      setSongsLoading(false);
    }
  };

  const fetchMoveTargets = async () => {
    try {
      const [{ data: pls }, { data: genres }] = await Promise.all([
        supabase.from("playlists").select("id, name").order("name"),
        supabase.from("genre_standards").select("display_name").eq("is_active", true).order("display_name"),
      ]);
      const psRows = await fetchPaginated<{ playlist_id: string }>((from, to) =>
        supabase.from("playlist_songs").select("playlist_id").range(from, to)
      );
      const countMap: Record<string, number> = {};
      psRows.forEach((r) => { countMap[r.playlist_id] = (countMap[r.playlist_id] || 0) + 1; });

      const targets: typeof allMoveTargets = [];
      (pls ?? []).forEach(p => targets.push({ type: "playlist", id: p.id, label: p.name, count: countMap[p.id] || 0 }));
      (genres ?? []).forEach(g => targets.push({ type: "genre", id: null, label: g.display_name, count: 0 }));
      setAllMoveTargets(targets);
    } catch {}
  };

  // ─── SONG ACTIONS ───
  const handleRenameSong = async (song: SongInPlaylist) => {
    if (!editSongName.trim() || editSongName.trim() === song.title) { setEditingSongId(null); return; }
    const newTitle = editSongName.trim();
    const { error } = await supabase.from("songs").update({ title: newTitle }).eq("id", song.id);
    if (error) toast.error("Erro ao renomear.");
    else {
      setPlaylistSongs(prev => prev.map(s => s.id === song.id ? { ...s, title: newTitle } : s));
      toast.success(`Renomeada para "${newTitle}".`);
    }
    setEditingSongId(null);
  };

  const handleMoveToPlaylist = async (song: SongInPlaylist, playlistId: string, playlistName: string) => {
    try {
      const { data: maxPos } = await supabase
        .from("playlist_songs").select("position").eq("playlist_id", playlistId)
        .order("position", { ascending: false }).limit(1).maybeSingle();
      await supabase.from("playlist_songs").insert({
        playlist_id: playlistId,
        song_id: song.id,
        position: (maxPos?.position || 0) + 1,
      });
      // Remove from current playlist
      await supabase.from("playlist_songs").delete().eq("id", song.playlist_song_id);
      setPlaylistSongs(prev => prev.filter(s => s.playlist_song_id !== song.playlist_song_id));
      toast.success(`"${song.title}" movida para "${playlistName}".`);
      setMovingSongId(null);
    } catch {
      toast.error("Erro ao mover.");
    }
  };

  const handleMoveToGenre = async (song: SongInPlaylist, targetGenre: string) => {
    const newGenre = targetGenre === "Sem Gênero" ? null : targetGenre;
    const { error } = await supabase.from("songs").update({ genre: newGenre }).eq("id", song.id);
    if (error) { toast.error("Erro ao mover."); return; }
    // Remove from current playlist
    await supabase.from("playlist_songs").delete().eq("id", song.playlist_song_id);
    setPlaylistSongs(prev => prev.filter(s => s.playlist_song_id !== song.playlist_song_id));
    toast.success(`"${song.title}" movida para gênero "${targetGenre}".`);
    setMovingSongId(null);
  };

  const handleHardDelete = async (song: SongInPlaylist) => {
    if (!confirm(`Excluir PERMANENTEMENTE "${song.title}"?`)) return;
    setDeletingSongId(song.id);
    try {
      await supabase.from("playlist_songs").delete().eq("song_id", song.id);
      if (song.file_path && !song.file_path.startsWith("youtube:") && !song.file_path.startsWith("direct:")) {
        await supabase.storage.from("audio").remove([song.file_path]);
      }
      await supabase.from("songs").delete().eq("id", song.id);
      if (playingSongId === song.id) stopAudio();
      setPlaylistSongs(prev => prev.filter(s => s.id !== song.id));
      toast.success(`"${song.title}" excluída.`);
    } catch {
      toast.error("Erro ao excluir.");
    } finally {
      setDeletingSongId(null);
    }
  };

  // ─── PLAY ───
  const playViaYouTube = useCallback(async (videoId: string, songId: string) => {
    await loadYTApi();
    try { ytPlayerRef.current?.destroy(); } catch {}
    const inner = document.createElement("div");
    inner.id = "admin-user-yt-inner";
    ytContainerRef.current!.innerHTML = "";
    ytContainerRef.current!.appendChild(inner);
    ytPlayerRef.current = new window.YT.Player("admin-user-yt-inner", {
      videoId,
      playerVars: { autoplay: 1, controls: 0 },
      events: {
        onReady: (e: any) => { e.target.setVolume(50); e.target.playVideo(); setPlayingSongId(songId); setPlayMode("yt"); setAudioLoading(null); },
        onStateChange: (e: any) => { if (e.data === window.YT.PlayerState.ENDED) { setPlayingSongId(null); setPlayMode(null); } },
        onError: () => { toast.error("Erro YouTube."); setPlayingSongId(null); setAudioLoading(null); setPlayMode(null); },
      },
    });
  }, [loadYTApi]);

  const tryPlayLocal = async (url: string, songId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!audioRef.current) { audioRef.current = new Audio(); audioRef.current.volume = 0.5; }
      audioRef.current.src = url;
      audioRef.current.onended = () => { setPlayingSongId(null); setPlayMode(null); };
      audioRef.current.onerror = () => resolve(false);
      audioRef.current.oncanplaythrough = () => {
        audioRef.current!.play().then(() => { setPlayingSongId(songId); setPlayMode("local"); setAudioLoading(null); resolve(true); }).catch(() => resolve(false));
      };
      setTimeout(() => resolve(false), 5000);
    });
  };

  const handlePlaySong = async (song: SongInPlaylist) => {
    if (playingSongId === song.id) { stopAudio(); return; }
    stopAudio();
    setAudioLoading(song.id);
    window.dispatchEvent(new Event("admin-playback-start"));
    try {
      const fp = song.file_path || "";
      if (fp.startsWith("direct:")) {
        if (await tryPlayLocal(fp.replace("direct:", ""), song.id)) return;
      } else if (!fp.startsWith("youtube:") && !fp.startsWith("imported/") && fp.length > 0) {
        const { data } = supabase.storage.from("audio").getPublicUrl(fp);
        if (data?.publicUrl) {
          try { const head = await fetch(data.publicUrl, { method: "HEAD" }); if (head.ok && await tryPlayLocal(data.publicUrl, song.id)) return; } catch {}
        }
      }
      let videoId: string | null = null;
      if (fp.startsWith("youtube:")) { const raw = fp.replace("youtube:", ""); if (raw.length >= 5 && raw !== "pending") videoId = raw; }
      if (!videoId) {
        const { data, error } = await supabase.functions.invoke("youtube-search", { body: { title: song.title, artist: song.artist, songId: song.id } });
        if (error || !data?.videoId) { toast.error("Música não encontrada."); setAudioLoading(null); return; }
        videoId = data.videoId;
      }
      await playViaYouTube(videoId!, song.id);
    } catch { toast.error("Erro ao reproduzir."); setAudioLoading(null); }
  };

  const filteredPlaylists = playlists.filter(p => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return p.name.toLowerCase().includes(q) || (p.owner_name?.toLowerCase().includes(q) ?? false) || (p.owner_email?.toLowerCase().includes(q) ?? false) || (p.genre?.toLowerCase().includes(q) ?? false);
  });

  const filteredSongs = playlistSongs.filter(s => {
    if (!songSearch.trim()) return true;
    const q = songSearch.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.artist?.toLowerCase().includes(q) ?? false);
  });

  const filteredMoveTargets = (() => {
    const q = moveSearch.toLowerCase();
    const filtered = selectedPlaylist ? allMoveTargets.filter(t => !(t.type === "playlist" && t.id === selectedPlaylist.id)) : allMoveTargets;
    if (!q) return filtered;
    return filtered.filter(t => t.label.toLowerCase().includes(q));
  })();

  const amberBorder = { border: "2px solid rgb(245, 158, 11)" };

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar por nome, criador, gênero..."
          className="pl-9 bg-secondary/50 border-border text-sm h-9"
        />
      </div>

      <div className="bg-card rounded-xl overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Carregando...
          </div>
        ) : filteredPlaylists.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            <ListMusic className="h-8 w-8 mx-auto mb-2 opacity-50" />
            Nenhuma playlist de usuário encontrada.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12"></TableHead>
                <TableHead>Playlist</TableHead>
                <TableHead>Gênero</TableHead>
                <TableHead>Criador</TableHead>
                <TableHead>Músicas</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPlaylists.map((p) => (
                <TableRow key={p.id} className="cursor-pointer hover:bg-secondary/30" onClick={() => openDetail(p)}>
                  <TableCell>
                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-muted flex items-center justify-center">
                      {p.cover_url ? (
                        <img src={p.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <ListMusic className="h-5 w-5 text-muted-foreground" />
                      )}
                    </div>
                  </TableCell>
                  <TableCell><span className="font-medium">{p.name}</span></TableCell>
                  <TableCell><span className="text-xs text-muted-foreground">{p.genre || "—"}</span></TableCell>
                  <TableCell>
                    <span className="text-xs font-medium">{p.owner_name || "Sem nome"}</span>
                  </TableCell>
                  <TableCell>{p.song_count}</TableCell>
                  <TableCell>
                    {p.is_public ? (
                      <span className="inline-flex items-center gap-1 text-xs text-green-500"><Globe className="h-3 w-3" />Pública</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><Lock className="h-3 w-3" />Privada</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                      {p.is_public ? (
                        <button
                          onClick={() => handleMakePrivate(p)}
                          disabled={actionLoading === p.id}
                          className="p-1.5 rounded text-xs font-medium transition-colors hover:bg-secondary/60"
                          style={amberBorder}
                          title="Manter Privada"
                        >
                          {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleMakePublic(p)}
                          disabled={actionLoading === p.id}
                          className="p-1.5 rounded text-xs font-medium text-green-500 transition-colors hover:bg-green-500/10"
                          style={amberBorder}
                          title="Tornar Pública"
                        >
                          {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Globe className="h-4 w-4" />}
                        </button>
                      )}
                      <button
                        onClick={() => handleDeletePlaylist(p)}
                        disabled={actionLoading === p.id}
                        className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        style={amberBorder}
                        title="Excluir"
                      >
                        {actionLoading === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Song detail dialog */}
      <Dialog open={!!selectedPlaylist} onOpenChange={(o) => { if (!o) { stopAudio(); setSelectedPlaylist(null); } }}>
        <DialogContent
          hideCloseButton
          className="sm:max-w-[500px] w-[calc(100vw-2rem)] max-w-[500px] h-[80dvh] max-h-[80dvh] overflow-hidden flex flex-col p-0"
        >
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-white">
              <ListMusic className="h-5 w-5 text-primary" />
              {selectedPlaylist?.name} ({filteredSongs.length})
              {selectedPlaylist?.is_public ? (
                <span className="ml-2 text-xs text-green-500 flex items-center gap-1"><Globe className="h-3 w-3" />Pública</span>
              ) : (
                <span className="ml-2 text-xs text-muted-foreground flex items-center gap-1"><Lock className="h-3 w-3" />Privada</span>
              )}
            </DialogTitle>
            {selectedPlaylist && (
              <p className="text-xs text-muted-foreground mt-1">
                Criador: {selectedPlaylist.owner_name || "Sem nome"}
                {selectedPlaylist.genre && <> · Gênero: {selectedPlaylist.genre}</>}
              </p>
            )}
          </DialogHeader>

          <div className="px-5 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                value={songSearch}
                onChange={(e) => setSongSearch(e.target.value)}
                placeholder="Buscar música..."
                className="pl-9 bg-secondary/50 border-muted text-sm"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-none px-2">
            {songsLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Carregando...</div>
            ) : filteredSongs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma música.</div>
            ) : (
              filteredSongs.map((song) => (
                <div
                  key={song.playlist_song_id}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-colors group cursor-pointer ${
                    playingSongId === song.id ? "bg-primary/15" : "hover:bg-secondary/40"
                  }`}
                  onClick={() => handlePlaySong(song)}
                >
                  <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0">
                    {song.cover_url ? (
                      <img src={song.cover_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full bg-primary/20 flex items-center justify-center"><Music className="h-4 w-4 text-primary" /></div>
                    )}
                    <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${
                      playingSongId === song.id || audioLoading === song.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}>
                      {audioLoading === song.id ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : playingSongId === song.id ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
                    </div>
                  </div>

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

                  <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => { setEditingSongId(song.id); setEditSongName(song.title); }} className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100" title="Editar nome">
                      <Pencil className="h-4 w-4" />
                    </button>

                    <Popover open={movingSongId === song.id} onOpenChange={(o) => { setMovingSongId(o ? song.id : null); if (o) { setMoveSearch(""); fetchMoveTargets(); } }}>
                      <PopoverTrigger asChild>
                        <button className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100" title="Mover">
                          <FolderInput className="h-4 w-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72 p-0" align="end" side="left" sideOffset={4} portalled={false}>
                        <div className="p-2">
                          <div className="relative">
                            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
                            <input type="text" placeholder="Buscar destino..." value={moveSearch} onChange={(e) => setMoveSearch(e.target.value)}
                              className="w-full pl-7 pr-2 py-1.5 text-xs rounded-md bg-secondary/50 border border-border focus:outline-none focus:ring-1 focus:ring-primary" autoFocus />
                          </div>
                        </div>
                        <div className="max-h-72 overflow-y-auto overscroll-contain touch-pan-y scrollbar-none py-1"
                          style={{ scrollbarWidth: "none", msOverflowStyle: "none", WebkitOverflowScrolling: "touch" }}
                          onWheelCapture={(e) => e.stopPropagation()} onTouchMove={(e) => e.stopPropagation()}>
                          {filteredMoveTargets.length === 0 ? (
                            <div className="px-3 py-4 text-xs text-muted-foreground text-center">Nenhum destino encontrado.</div>
                          ) : (
                            <>
                              {filteredMoveTargets.some(t => t.type === "playlist") && (
                                <div className="px-3 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider">Playlists</div>
                              )}
                              {filteredMoveTargets.filter(t => t.type === "playlist").map(t => (
                                <button key={`p-${t.id}`} onClick={() => handleMoveToPlaylist(song, t.id!, t.label)}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/60 transition-colors flex items-center justify-between">
                                  <span className="truncate flex items-center gap-1.5"><ListMusic className="h-3 w-3 text-muted-foreground shrink-0" />{t.label}</span>
                                  <span className="text-[10px] text-muted-foreground ml-2">{t.count}</span>
                                </button>
                              ))}
                              {filteredMoveTargets.some(t => t.type === "genre") && (
                                <div className="px-3 py-1 mt-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider pt-2">Gêneros</div>
                              )}
                              {filteredMoveTargets.filter(t => t.type === "genre").map(t => (
                                <button key={`g-${t.label}`} onClick={() => handleMoveToGenre(song, t.label)}
                                  className="w-full text-left px-3 py-1.5 text-sm hover:bg-secondary/60 transition-colors flex items-center justify-between">
                                  <span className="truncate flex items-center gap-1.5"><Tag className="h-3 w-3 text-muted-foreground shrink-0" />{t.label}</span>
                                </button>
                              ))}
                            </>
                          )}
                        </div>
                      </PopoverContent>
                    </Popover>

                    <button onClick={() => handleHardDelete(song)} disabled={deletingSongId === song.id}
                      className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100" title="Excluir">
                      {deletingSongId === song.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {playingSongId && (
            <AdminMiniTransport
              songTitle={playlistSongs.find(s => s.id === playingSongId)?.title || ""}
              isPlaying={!!playingSongId}
              playMode={playMode}
              audioRef={audioRef}
              ytPlayerRef={ytPlayerRef}
              onPrev={() => {
                const idx = filteredSongs.findIndex(s => s.id === playingSongId);
                if (idx > 0) handlePlaySong(filteredSongs[idx - 1]);
                else if (filteredSongs.length > 0) handlePlaySong(filteredSongs[filteredSongs.length - 1]);
              }}
              onNext={() => {
                const idx = filteredSongs.findIndex(s => s.id === playingSongId);
                if (idx < filteredSongs.length - 1) handlePlaySong(filteredSongs[idx + 1]);
                else if (filteredSongs.length > 0) handlePlaySong(filteredSongs[0]);
              }}
              onPlayPause={() => {
                if (playMode === "local" && audioRef.current) {
                  audioRef.current.paused ? audioRef.current.play() : audioRef.current.pause();
                } else if (playMode === "yt" && ytPlayerRef.current) {
                  try { const state = ytPlayerRef.current.getPlayerState?.(); state === 1 ? ytPlayerRef.current.pauseVideo() : ytPlayerRef.current.playVideo(); } catch {}
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

export default UserPlaylistsCuration;