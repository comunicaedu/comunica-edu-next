"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Music, Pencil, Trash2, Check, X, Loader2, Search, Image, ListMusic, Plus, Play, Pause, Volume2, FolderInput, Tag, Upload } from "lucide-react";
import MusicUpload from "@/components/player/MusicUpload";
import AdminMiniTransport from "./AdminMiniTransport";
import { authedFetch } from "@/lib/authedFetch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover, PopoverContent, PopoverTrigger,
} from "@/components/ui/popover";

interface PlaylistWithCount {
  id: string;
  name: string;
  cover_url: string | null;
  created_at: string;
  song_count: number;
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


const PlaylistManagement = () => {
  const [playlists, setPlaylists] = useState<PlaylistWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCoverId, setUploadingCoverId] = useState<string | null>(null);

  // Add playlist via MusicUpload modal
  const [showMusicUpload, setShowMusicUpload] = useState(false);

  // Song detail dialog
  const [selectedPlaylist, setSelectedPlaylist] = useState<PlaylistWithCount | null>(null);
  const [playlistSongs, setPlaylistSongs] = useState<SongInPlaylist[]>([]);
  const [songsLoading, setSongsLoading] = useState(false);
  const [songSearch, setSongSearch] = useState("");

  // Play state
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const ytContainerRef = useRef<HTMLDivElement | null>(null);
  const ytPlayerRef = useRef<any>(null);
  const [playingSongId, setPlayingSongId] = useState<string | null>(null);
  const [audioLoading, setAudioLoading] = useState<string | null>(null);
  const [playMode, setPlayMode] = useState<"local" | "yt" | null>(null);

  // Edit song
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [editSongName, setEditSongName] = useState("");

  // Move song
  const [movingSongId, setMovingSongId] = useState<string | null>(null);
  const [moveSearch, setMoveSearch] = useState("");
  const [allGenres, setAllGenres] = useState<{ name: string; count: number }[]>([]);
  const [allPlaylistsForMove, setAllPlaylistsForMove] = useState<{ id: string; name: string; count: number }[]>([]);
  const [deletingSongId, setDeletingSongId] = useState<string | null>(null);

  // YouTube setup
  useEffect(() => {
    if (!ytContainerRef.current) {
      const div = document.createElement("div");
      div.id = "admin-pl-yt-player";
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
    if ((window as any).YT?.Player) return Promise.resolve();
    return new Promise((resolve) => {
      if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
        const check = setInterval(() => { if ((window as any).YT?.Player) { clearInterval(check); resolve(); } }, 100);
        return;
      }
      const tag = document.createElement("script");
      tag.src = "https://www.youtube.com/iframe_api";
      document.head.appendChild(tag);
      (window as any).onYouTubeIframeAPIReady = () => resolve();
    });
  }, []);

  const stopAudio = useCallback(() => {
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ""; }
    try { ytPlayerRef.current?.stopVideo(); } catch {}
    setPlayingSongId(null);
    setAudioLoading(null);
    setPlayMode(null);
  }, []);

  const tryPlayLocal = async (url: string, songId: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!audioRef.current) { audioRef.current = new Audio(); audioRef.current.volume = 0.5; }
      audioRef.current.src = url;
      audioRef.current.onended = () => { setPlayingSongId(null); setPlayMode(null); };
      audioRef.current.onerror = () => resolve(false);
      audioRef.current.oncanplaythrough = () => {
        audioRef.current!.play().then(() => {
          setPlayingSongId(songId); setPlayMode("local"); setAudioLoading(null); resolve(true);
        }).catch(() => resolve(false));
      };
      setTimeout(() => resolve(false), 5000);
    });
  };

  const playViaYouTube = useCallback(async (videoId: string, songId: string) => {
    await loadYTApi();
    try { ytPlayerRef.current?.destroy(); } catch {}
    const inner = document.createElement("div");
    inner.id = "admin-pl-yt-inner";
    ytContainerRef.current!.innerHTML = "";
    ytContainerRef.current!.appendChild(inner);
    ytPlayerRef.current = new (window as any).YT.Player("admin-pl-yt-inner", {
      videoId,
      playerVars: { autoplay: 1, controls: 0 },
      events: {
        onReady: (e: any) => { e.target.setVolume(50); e.target.playVideo(); setPlayingSongId(songId); setPlayMode("yt"); setAudioLoading(null); },
        onStateChange: (e: any) => { if (e.data === (window as any).YT.PlayerState.ENDED) { setPlayingSongId(null); setPlayMode(null); } },
        onError: () => { toast.error("Erro ao reproduzir via YouTube."); setPlayingSongId(null); setAudioLoading(null); setPlayMode(null); },
      },
    });
  }, [loadYTApi]);

  // Listen for main player starting — stop admin audio
  useEffect(() => {
    const handler = () => stopAudio();
    window.addEventListener("main-playback-start", handler);
    return () => window.removeEventListener("main-playback-start", handler);
  }, [stopAudio]);

  const handlePlaySong = async (song: SongInPlaylist) => {
    if (playingSongId === song.id) { stopAudio(); return; }
    stopAudio();
    setAudioLoading(song.id);
    // Pause the main player
    window.dispatchEvent(new Event("admin-playback-start"));
    try {
      const fp = song.file_path || "";
      const isYtPath = fp.startsWith("youtube:");
      const isImported = fp.startsWith("imported/");
      const isDirect = fp.startsWith("direct:");

      if (isDirect) {
        const url = fp.replace("direct:", "");
        if (await tryPlayLocal(url, song.id)) return;
      } else if (!isYtPath && !isImported && fp.length > 0) {
        if (await tryPlayLocal(fp, song.id)) return;
      }

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
    } catch {
      toast.error("Erro ao reproduzir."); setAudioLoading(null);
    }
  };

  // Fetch playlists
  const fetchPlaylists = async () => {
    setLoading(true);
    try {
      const [plRes, psRes] = await Promise.all([
        authedFetch("/api/playlists").then((r) => r.json()),
        authedFetch("/api/playlist-songs").then((r) => r.json()),
      ]);
      const playlistsData = plRes.playlists ?? [];
      const joins: { playlist_id: string }[] = psRes.joins ?? [];
      const countMap: Record<string, number> = {};
      joins.forEach((j) => { countMap[j.playlist_id] = (countMap[j.playlist_id] || 0) + 1; });
      setPlaylists(playlistsData.map((p: any) => ({ ...p, song_count: countMap[p.id] || 0 })));
    } catch { toast.error("Erro ao carregar playlists."); }
    setLoading(false);
  };

  const selectedPlaylistRef = useRef<PlaylistWithCount | null>(null);
  useEffect(() => { selectedPlaylistRef.current = selectedPlaylist; }, [selectedPlaylist]);

  useEffect(() => {
    fetchPlaylists();
    const handler = () => {
      fetchPlaylists();
      if (selectedPlaylistRef.current) openPlaylistDetail(selectedPlaylistRef.current);
    };
    window.addEventListener("songs-changed", handler);
    return () => window.removeEventListener("songs-changed", handler);
  }, []);

  const filtered = playlists.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  // Open playlist detail
  const openPlaylistDetail = async (playlist: PlaylistWithCount) => {
    stopAudio();
    setSelectedPlaylist(playlist);
    setSongSearch("");
    setSongsLoading(true);
    setEditingSongId(null);
    fetchMoveTargets();
    try {
      const res = await authedFetch(`/api/playlist-songs?playlist_id=${playlist.id}`);
      const data = await res.json();
      setPlaylistSongs(data.songs ?? []);
    } catch {
      toast.error("Erro ao carregar músicas.");
      setPlaylistSongs([]);
    } finally {
      setSongsLoading(false);
    }
  };

  const fetchMoveTargets = useCallback(async () => {
    try {
      const [songsRes, plRes, psRes] = await Promise.all([
        authedFetch("/api/songs").then((r) => r.json()),
        authedFetch("/api/playlists").then((r) => r.json()),
        authedFetch("/api/playlist-songs").then((r) => r.json()),
      ]);
      const gMap: Record<string, number> = {};
      (songsRes.songs ?? []).forEach((s: { genre: string | null }) => {
        const g = s.genre || "Sem Gênero"; gMap[g] = (gMap[g] || 0) + 1;
      });
      setAllGenres(Object.entries(gMap).map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name)));
      const cMap: Record<string, number> = {};
      (psRes.joins ?? []).forEach((j: { playlist_id: string }) => { cMap[j.playlist_id] = (cMap[j.playlist_id] || 0) + 1; });
      setAllPlaylistsForMove((plRes.playlists ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name, count: cMap[p.id] || 0 })));
    } catch {}
  }, []);

  const handleCloseDialog = () => { stopAudio(); setSelectedPlaylist(null); };

  // Rename song
  const handleRenameSong = async (song: SongInPlaylist) => {
    if (!editSongName.trim() || editSongName.trim() === song.title) { setEditingSongId(null); return; }
    const newTitle = editSongName.trim();
    const res = await authedFetch("/api/songs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: song.id, title: newTitle }) });
    if (!res.ok) toast.error("Erro ao renomear.");
    else {
      setPlaylistSongs(prev => prev.map(s => s.id === song.id ? { ...s, title: newTitle } : s));
      toast.success(`Renomeada para "${newTitle}".`);
    }
    setEditingSongId(null);
  };

  // Move to genre
  const handleMoveToGenre = async (song: SongInPlaylist, targetGenre: string) => {
    const newGenre = targetGenre === "Sem Gênero" ? null : targetGenre;
    const res = await authedFetch("/api/songs", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: song.id, genre: newGenre }) });
    if (!res.ok) { toast.error("Erro ao mover."); return; }
    toast.success(`"${song.title}" gênero alterado para ${targetGenre}.`);
    setMovingSongId(null);
  };

  // Move to another playlist
  const handleMoveToPlaylist = async (song: SongInPlaylist, targetPlaylistId: string, targetName: string) => {
    if (selectedPlaylist && targetPlaylistId === selectedPlaylist.id) { setMovingSongId(null); return; }
    try {
      await authedFetch("/api/playlist-songs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlist_id: targetPlaylistId, song_ids: [song.id] }) });
      await authedFetch("/api/playlist-songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: song.playlist_song_id }) });
      setPlaylistSongs(prev => prev.filter(s => s.playlist_song_id !== song.playlist_song_id));
      if (selectedPlaylist) {
        setPlaylists(prev => prev.map(p => {
          if (p.id === selectedPlaylist.id) return { ...p, song_count: Math.max(0, p.song_count - 1) };
          if (p.id === targetPlaylistId) return { ...p, song_count: p.song_count + 1 };
          return p;
        }));
      }
      toast.success(`"${song.title}" movida para "${targetName}".`);
      setMovingSongId(null);
    } catch { toast.error("Erro ao mover."); }
  };

  // Hard delete song
  const handleHardDelete = async (song: SongInPlaylist) => {
    if (!confirm(`Excluir PERMANENTEMENTE "${song.title}"?`)) return;
    setDeletingSongId(song.id);
    try {
      await authedFetch("/api/playlist-songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ song_id: song.id }) });
      await authedFetch("/api/songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: song.id }) });
      if (playingSongId === song.id) stopAudio();
      setPlaylistSongs(prev => prev.filter(s => s.id !== song.id));
      if (selectedPlaylist) {
        setPlaylists(prev => prev.map(p => p.id === selectedPlaylist.id ? { ...p, song_count: Math.max(0, p.song_count - 1) } : p));
      }
      window.dispatchEvent(new Event("songs-changed"));
      toast.success(`"${song.title}" excluída permanentemente.`);
    } catch { toast.error("Erro ao excluir."); }
    finally { setDeletingSongId(null); }
  };

  // Playlist CRUD
  const handleSaveName = async (id: string) => {
    if (!editName.trim()) return;
    setSaving(true);
    const res = await authedFetch("/api/playlists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, name: editName.trim() }) });
    if (!res.ok) toast.error("Erro ao renomear.");
    else {
      toast.success("Nome atualizado!");
      setPlaylists(prev => prev.map(p => p.id === id ? { ...p, name: editName.trim() } : p));
    }
    setSaving(false); setEditingId(null);
  };

  const handleDeletePlaylist = async (id: string) => {
    if (!confirm("Excluir esta playlist e todas as associações?")) return;
    setDeletingId(id);
    await authedFetch("/api/playlist-songs", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ playlist_id: id }) });
    const res = await authedFetch("/api/playlists", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!res.ok) toast.error("Erro ao excluir playlist.");
    else { toast.success("Playlist excluída!"); setPlaylists(prev => prev.filter(p => p.id !== id)); }
    setDeletingId(null);
  };

  const handleCoverUpload = async (id: string, file: File) => {
    setUploadingCoverId(id);
    // Convert cover to base64 and store in playlist record
    const reader = new FileReader();
    reader.onload = async () => {
      const coverUrl = reader.result as string;
      const res = await authedFetch("/api/playlists", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, cover_url: coverUrl }) });
      if (!res.ok) toast.error("Erro ao salvar capa.");
      else { toast.success("Capa atualizada!"); setPlaylists(prev => prev.map(p => p.id === id ? { ...p, cover_url: coverUrl } : p)); }
      setUploadingCoverId(null);
    };
    reader.onerror = () => { toast.error("Erro ao ler imagem."); setUploadingCoverId(null); };
    reader.readAsDataURL(file);
  };

  const handleUploadComplete = () => {
    setShowMusicUpload(false);
    fetchPlaylists();
  };

  const filteredSongs = playlistSongs.filter(s => {
    if (!songSearch.trim()) return true;
    const q = songSearch.toLowerCase();
    return s.title.toLowerCase().includes(q) || (s.artist?.toLowerCase().includes(q) ?? false);
  });

  const moveGenres = allGenres;
  const movePlaylists = allPlaylistsForMove.filter(p => p.id !== selectedPlaylist?.id);

  const filteredMoveTargets = (() => {
    const q = moveSearch.toLowerCase();
    const playlistItems = movePlaylists.map((p) => ({ type: "playlist" as const, id: p.id, label: p.name, count: p.count }));
    const genreItems = moveGenres.map((g) => ({ type: "genre" as const, id: null as string | null, label: g.name, count: g.count }));
    const all = [...playlistItems, ...genreItems];
    if (!q) return all;
    return all.filter((t) => t.label.toLowerCase().includes(q));
  })();

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 mb-1">
        <ListMusic className="h-5 w-5 text-primary" />
        <h3 className="text-lg font-semibold">Todas as Playlists</h3>
        <span className="text-xs text-muted-foreground ml-auto">{playlists.length} playlists</span>
      </div>

      {/* Add playlist via MusicUpload modal */}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowMusicUpload(true)} className="h-8 text-xs gap-1">
          <Plus className="h-3.5 w-3.5" /> Adicionar Playlist
        </Button>
      </div>

      {/* MusicUpload Dialog */}
      <Dialog open={showMusicUpload} onOpenChange={setShowMusicUpload}>
        <DialogContent hideCloseButton className="sm:max-w-md max-h-[90dvh] overflow-y-auto scrollbar-none">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white">
              <Upload className="h-5 w-5 text-primary" /> Enviar Música
            </DialogTitle>
          </DialogHeader>
          <MusicUpload onUploadComplete={handleUploadComplete} />
        </DialogContent>
      </Dialog>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar playlist..." className="pl-9 bg-secondary/50 border-border text-sm h-9" />
      </div>

      <input ref={coverInputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const file = e.target.files?.[0]; const id = coverInputRef.current?.dataset.playlistId; if (file && id) handleCoverUpload(id, file); e.target.value = ""; }}
      />

      <div className="bg-card rounded-xl overflow-hidden max-h-[60vh] overflow-y-auto scrollbar-none">
        {loading ? (
          <div className="text-center py-12 text-muted-foreground text-sm"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Carregando...</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">Nenhuma playlist encontrada.</div>
        ) : filtered.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 hover:bg-secondary/30 transition-colors group cursor-pointer"
            onClick={() => openPlaylistDetail(p)}>
            {/* Cover */}
            <button onClick={(e) => { e.stopPropagation(); if (coverInputRef.current) { coverInputRef.current.dataset.playlistId = p.id; coverInputRef.current.click(); } }}
              className="relative shrink-0 w-10 h-10 rounded-lg overflow-hidden bg-primary/20 flex items-center justify-center group/cover" title="Alterar capa">
              {uploadingCoverId === p.id ? <Loader2 className="h-4 w-4 animate-spin text-primary" /> : p.cover_url ? (
                <><img src={p.cover_url} alt="" className="w-full h-full object-cover" />
                  <div className="absolute inset-0 bg-black/50 opacity-0 group-hover/cover:opacity-100 transition-opacity flex items-center justify-center"><Image className="h-4 w-4 text-white" /></div></>
              ) : <Music className="h-4 w-4 text-primary" />}
            </button>

            {/* Name / Edit */}
            <div className="flex-1 min-w-0">
              {editingId === p.id ? (
                <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                  <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-7 text-sm bg-secondary/50" autoFocus onKeyDown={(e) => e.key === "Enter" && handleSaveName(p.id)} />
                  <Button size="sm" variant="ghost" onClick={() => handleSaveName(p.id)} disabled={saving} className="h-7 w-7 p-0 text-green-500">
                    {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 w-7 p-0 text-muted-foreground"><X className="h-3.5 w-3.5" /></Button>
                </div>
              ) : (
                <><p className="text-sm font-medium truncate">{p.name}</p>
                  <p className="text-[11px] text-muted-foreground">{p.song_count} música{p.song_count !== 1 ? "s" : ""}</p></>
              )}
            </div>

            {/* Actions */}
            {editingId !== p.id && (
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={(e) => e.stopPropagation()}>
                <button onClick={() => { setEditingId(p.id); setEditName(p.name); }} className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors" title="Renomear">
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button onClick={() => handleDeletePlaylist(p.id)} disabled={deletingId === p.id} className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors" title="Excluir">
                  {deletingId === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Song detail dialog */}
      <Dialog open={!!selectedPlaylist} onOpenChange={(o) => !o && handleCloseDialog()}>
        <DialogContent hideCloseButton className="sm:max-w-[500px] w-[calc(100vw-2rem)] max-w-[500px] h-[80dvh] max-h-[80dvh] overflow-hidden flex flex-col p-0">
          <DialogHeader className="px-5 pt-5 pb-3 shrink-0">
            <DialogTitle className="flex items-center gap-2 text-white">
              <ListMusic className="h-5 w-5 text-primary" />
              {selectedPlaylist?.name} ({filteredSongs.length})
            </DialogTitle>
          </DialogHeader>

          <div className="px-5 pb-2 shrink-0">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input value={songSearch} onChange={(e) => setSongSearch(e.target.value)} placeholder="Buscar música..." className="pl-9 bg-secondary/50 border-muted text-sm" />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto scrollbar-none px-2">
            {songsLoading ? (
              <div className="text-center py-8 text-muted-foreground text-sm"><Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />Carregando...</div>
            ) : filteredSongs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Nenhuma música.</div>
            ) : filteredSongs.map((song) => (
              <div key={song.playlist_song_id}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg mb-0.5 transition-colors group cursor-pointer ${playingSongId === song.id ? "bg-primary/15" : "hover:bg-secondary/40"}`}
                onClick={() => handlePlaySong(song)}>
                {/* Cover / Play */}
                <div className="relative w-10 h-10 rounded-lg overflow-hidden shrink-0">
                  {song.cover_url ? <img src={song.cover_url} alt="" className="w-full h-full object-cover" /> : (
                    <div className="w-full h-full bg-primary/20 flex items-center justify-center"><Music className="h-4 w-4 text-primary" /></div>
                  )}
                  <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${playingSongId === song.id || audioLoading === song.id ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}>
                    {audioLoading === song.id ? <Loader2 className="h-4 w-4 text-white animate-spin" /> : playingSongId === song.id ? <Pause className="h-4 w-4 text-white" /> : <Play className="h-4 w-4 text-white" />}
                  </div>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  {editingSongId === song.id ? (
                    <Input value={editSongName} onChange={(e) => setEditSongName(e.target.value)}
                      onBlur={() => handleRenameSong(song)} onKeyDown={(e) => e.key === "Enter" && handleRenameSong(song)}
                      onClick={(e) => e.stopPropagation()} className="h-7 text-sm bg-secondary/50 border-muted" autoFocus />
                  ) : <p className="text-sm font-medium truncate">{song.title}</p>}
                  <p className="text-[11px] text-muted-foreground truncate">{song.artist || "Artista desconhecido"}</p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                  <button onClick={() => { setEditingSongId(song.id); setEditSongName(song.title); }}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors opacity-0 group-hover:opacity-100" title="Editar nome">
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
                                onClick={() => handleMoveToGenre(song, t.label)}
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

                  <button onClick={() => handleHardDelete(song)} disabled={deletingSongId === song.id}
                    className="p-1.5 rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100" title="Excluir">
                    {deletingSongId === song.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>

          {playingSongId && (
            <AdminMiniTransport
              songTitle={playlistSongs.find(s => s.id === playingSongId)?.title || ""}
              isPlaying={!!playingSongId}
              playMode={playMode}
              audioRef={audioRef}
              ytPlayerRef={ytPlayerRef}
              onPrev={() => {
                const list = filteredSongs;
                const idx = list.findIndex(s => s.id === playingSongId);
                if (idx > 0) handlePlaySong(list[idx - 1]);
                else if (list.length > 0) handlePlaySong(list[list.length - 1]);
              }}
              onNext={() => {
                const list = filteredSongs;
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

export default PlaylistManagement;