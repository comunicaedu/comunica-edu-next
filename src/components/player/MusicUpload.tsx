"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Upload, Music, Loader2, Link as LinkIcon, CheckCircle2, X, Clock, ImagePlus, Plus, Trash2, Heart, ChevronDown } from "lucide-react";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { useActivityTracker } from "@/hooks/useActivityTracker";
import { useIsAdmin } from "@/hooks/useIsAdmin";
import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import PlaylistScheduleDialog from "./PlaylistScheduleDialog";
import { authedFetch } from "@/lib/authedFetch";

interface MusicUploadProps {
  onUploadComplete?: () => void;
}

interface PlaylistRecord {
  id: string;
  name: string;
  description: string | null;
  cover_url: string | null;
  is_public: boolean;
  created_by: string | null;
  created_at: string;
}

interface GenreRecord {
  id: string;
  name: string;
  display_name: string;
}

const cleanSongTitle = (title: string): string => {
  return title
    .replace(/^\d+[\s.\-_)]+/g, "")
    .replace(/^\(\d+\)\s*/g, "")
    .replace(/^\[\d+\]\s*/g, "")
    .replace(/^track\s*\d+[\s.\-_]*/gi, "")
    .replace(/[-_]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const MAX_FILES = 400;
const BATCH_SIZE = 5;
const MIN_DURATION_SECONDS = 120;

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const parseTitleAndArtistFromFilename = (filename: string) => {
  const base = cleanSongTitle(filename.replace(/\.[^.]+$/, ""));
  const parts = base.split(/\s[-–—]\s/);
  if (parts.length >= 2) {
    const artist = parts[0]?.trim() || null;
    const title = parts.slice(1).join(" - ").trim() || base;
    return { title, artist };
  }
  return { title: base, artist: null as string | null };
};

const MusicUpload = ({ onUploadComplete }: MusicUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [directUrl, setDirectUrl] = useState("");
  const [tab, setTab] = useState<string>("upload");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState({ done: 0, total: 0, skipped: 0, errors: 0 });
  const fileRef = useRef<HTMLInputElement>(null);
  const { features, consumeFeature, isFeatureLocked } = useClientFeatures();
  const { trackUpload } = useActivityTracker();
  const { isAdmin } = useIsAdmin();
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const offlineEnabled = features["modo_offline"] === true;
  const abortRef = useRef(false);

  const [playlistName, setPlaylistName] = useState("");
  const [selectedGenre, setSelectedGenre] = useState("");
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const coverRef = useRef<HTMLInputElement>(null);
  const [isFavorite, setIsFavorite] = useState(false);

  const [genres, setGenres] = useState<GenreRecord[]>([]);
  const [showAddGenre, setShowAddGenre] = useState(false);
  const [newGenreName, setNewGenreName] = useState("");
  const [addingGenre, setAddingGenre] = useState(false);
  const [favoriteGenres, setFavoriteGenres] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem("edu_fav_genres");
      return saved ? new Set(JSON.parse(saved)) : new Set<string>();
    } catch { return new Set<string>(); }
  });

  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [createdPlaylistId, setCreatedPlaylistId] = useState<string | null>(null);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [playlists, setPlaylists] = useState<PlaylistRecord[]>([]);
  const [playlistSearch, setPlaylistSearch] = useState("");
  const [playlistPopoverOpen, setPlaylistPopoverOpen] = useState(false);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  useEffect(() => {
    loadGenres();
    loadPlaylists();
    const storeUser = useSessionStore.getState().user;
    if (storeUser?.id) setCurrentUserId(storeUser.id);
  }, []);

  const loadGenres = async () => {
    try {
      const res = await authedFetch("/api/genres");
      const data = await res.json();
      setGenres(data.genres ?? []);
    } catch {}
  };

  const loadPlaylists = async () => {
    try {
      const res = await authedFetch("/api/playlists");
      const data = await res.json();
      setPlaylists(data.playlists ?? []);
    } catch {}
  };

  const handleAddGenre = async () => {
    const name = newGenreName.trim();
    if (!name) return;
    setAddingGenre(true);

    const existing = genres.find(
      (g) => g.name === name.toLowerCase() || g.display_name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      toast.info(`Este gênero já está cadastrado: "${existing.display_name}".`);
      setSelectedGenre(existing.name);
      setNewGenreName("");
      setShowAddGenre(false);
      setAddingGenre(false);
      return;
    }

    try {
      const res = await authedFetch("/api/genres", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.toLowerCase().replace(/\s+/g, "_"), display_name: name }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error || "Erro ao adicionar gênero.");
      } else {
        toast.success(`Gênero "${name}" adicionado!`);
        setNewGenreName("");
        setShowAddGenre(false);
        await loadGenres();
        setSelectedGenre(data.genre.name);
      }
    } catch {
      toast.error("Erro ao adicionar gênero.");
    }
    setAddingGenre(false);
  };

  const handleDeleteGenre = async (id: string, genreName: string) => {
    try {
      await authedFetch("/api/genres", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      toast.success(`Gênero "${genreName}" removido.`);
      if (selectedGenre === genreName) setSelectedGenre("");
      await loadGenres();
    } catch {
      toast.error("Erro ao remover gênero.");
    }
  };

  const toggleFavoriteGenre = (genreId: string) => {
    setFavoriteGenres((prev) => {
      const next = new Set(prev);
      if (next.has(genreId)) next.delete(genreId);
      else next.add(genreId);
      localStorage.setItem("edu_fav_genres", JSON.stringify([...next]));
      return next;
    });
  };

  const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Selecione uma imagem válida."); return; }
    setCoverFile(file);
    setCoverPreview(URL.createObjectURL(file));
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    addAudioFiles(Array.from(e.target.files || []));
  };

  const addAudioFiles = (files: File[]) => {
    const audioFiles = files.filter((f) => f.type.startsWith("audio/") || f.type.startsWith("video/"));
    if (audioFiles.length === 0) { toast.error("Nenhum arquivo de áudio selecionado."); return; }
    const combined = [...selectedFiles, ...audioFiles];
    const maxFiles = isAdmin ? MAX_FILES : 50;
    if (combined.length > maxFiles) { toast.error(`Máximo de ${maxFiles} arquivos por playlist.`); return; }
    setSelectedFiles(combined);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); dragCounter.current = 0;
    addAudioFiles(Array.from(e.dataTransfer.files));
  }, [selectedFiles]);

  const getAudioDuration = (file: File): Promise<number> =>
    new Promise((resolve) => {
      const audio = new Audio();
      const url = URL.createObjectURL(file);
      audio.src = url;
      audio.onloadedmetadata = () => { resolve(audio.duration || 0); URL.revokeObjectURL(url); };
      // Arquivo corrompido ou inválido → retorna -1 para ser bloqueado no upload
      audio.onerror = () => { URL.revokeObjectURL(url); resolve(-1); };
    });

  // Extrai áudio de arquivo de vídeo → retorna File WAV ou null se falhar
  const extractAudioFromVideo = async (file: File): Promise<File | null> => {
    try {
      const arrayBuffer = await file.arrayBuffer();
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return null;
      const ctx = new AudioCtx();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      await ctx.close();

      const numChannels = Math.min(audioBuffer.numberOfChannels, 2);
      const sampleRate = audioBuffer.sampleRate;
      const length = audioBuffer.length;
      const dataLength = length * numChannels * 2;
      const wavBuffer = new ArrayBuffer(44 + dataLength);
      const view = new DataView(wavBuffer);
      const ws = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
      ws(0, "RIFF"); view.setUint32(4, 36 + dataLength, true); ws(8, "WAVE");
      ws(12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * numChannels * 2, true);
      view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true);
      ws(36, "data"); view.setUint32(40, dataLength, true);
      let offset = 44;
      for (let i = 0; i < length; i++) {
        for (let ch = 0; ch < numChannels; ch++) {
          const s = Math.max(-1, Math.min(1, audioBuffer.getChannelData(ch)[i]));
          view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
          offset += 2;
        }
      }
      const baseName = file.name.replace(/\.[^.]+$/, "");
      return new File([wavBuffer], `${baseName}.wav`, { type: "audio/wav" });
    } catch {
      return null;
    }
  };

  // Convert cover image to base64 data URL for local storage
  const getCoverDataUrl = (): Promise<string | null> =>
    new Promise((resolve) => {
      if (!coverFile) return resolve(null);
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(coverFile);
    });

  const ensurePlaylist = async (): Promise<PlaylistRecord | null> => {
    const name = playlistName.trim() || `Upload ${new Date().toLocaleDateString("pt-BR")}`;

    // Check if playlist with same name exists
    const listRes = await authedFetch("/api/playlists");
    const listData = await listRes.json();
    const playlists: PlaylistRecord[] = listData.playlists ?? [];
    const existing = playlists.find((p) => p.name === name);

    if (existing) {
      // Update cover if provided
      if (coverFile) {
        const coverUrl = await getCoverDataUrl();
        if (coverUrl && coverUrl !== existing.cover_url) {
          await authedFetch("/api/playlists", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: existing.id, cover_url: coverUrl }),
          });
          return { ...existing, cover_url: coverUrl };
        }
      }
      return existing;
    }

    const coverUrl = await getCoverDataUrl();
    const createRes = await authedFetch("/api/playlists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, is_public: true }),
    });
    const createData = await createRes.json();
    if (!createRes.ok || !createData.playlist) {
      toast.error(`Erro ao criar playlist: ${createData.error || "desconhecido"}`);
      return null;
    }

    const created: PlaylistRecord = createData.playlist;
    if (coverUrl) {
      await authedFetch("/api/playlists", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: created.id, cover_url: coverUrl }),
      });
      return { ...created, cover_url: coverUrl };
    }

    return created;
  };

  const appendSongsToPlaylist = async (playlistId: string, songIds: string[]) => {
    await authedFetch("/api/playlist-songs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playlist_id: playlistId, song_ids: songIds }),
    });
  };

  const uploadSingleFile = async (
    file: File,
    genre: string | null
  ): Promise<{ status: "ok" | "skipped" | "error"; songId?: string }> => {
    try {
      // Se for vídeo, extrai apenas o áudio antes de qualquer validação
      if (file.type.startsWith("video/")) {
        const extracted = await extractAudioFromVideo(file);
        if (!extracted) return { status: "skipped" };
        file = extracted;
      }
      const parsed = parseTitleAndArtistFromFilename(file.name);
      const duration = await getAudioDuration(file);
      // -1 = corrompido/ilegível, bloqueia o upload
      if (duration === -1) return { status: "skipped" };
      // Bloqueia arquivos abaixo de 2min (spots/ruídos) ou acima de 5min (videoclipes/falas)
      if (duration > 0 && duration < MIN_DURATION_SECONDS) return { status: "skipped" };
      if (duration > 270) return { status: "skipped" };

      const formData = new FormData();
      formData.append("file", file);
      formData.append("title", parsed.title);
      if (parsed.artist) formData.append("artist", parsed.artist);
      if (genre) formData.append("genre", genre);
      formData.append("duration", String(Math.round(duration)));

      const res = await authedFetch("/api/songs", { method: "POST", body: formData });
      const data = await res.json();

      if (!res.ok) return { status: "error" };

      trackUpload({ id: data.song.id, genre, artist: parsed.artist });
      return { status: "ok", songId: data.song.id };
    } catch {
      return { status: "error" };
    }
  };

  const isNewPlaylistValid = !!coverFile && !!playlistName.trim() && !!selectedGenre;
  const isPlaylistValid = isNewPlaylistValid || !!selectedPlaylistId;

  const handleBatchUpload = async () => {
    if (selectedFiles.length === 0) return;
    if (!isPlaylistValid) { toast.error("Selecione uma playlist ou preencha capa, nome e gênero."); return; }

    // Verifica se recurso está liberado (não-admin)
    if (!isAdmin && isFeatureLocked("enviar_musicas")) {
      toast.error("Recurso bloqueado. Atualize seu plano.");
      return;
    }

    setUploading(true);
    abortRef.current = false;
    const total = selectedFiles.length;
    setUploadProgress({ done: 0, total, skipped: 0, errors: 0 });

    const genre = selectedGenre || null;

    let playlist: PlaylistRecord | null = null;
    if (selectedPlaylistId) {
      playlist = playlists.find(p => p.id === selectedPlaylistId) || null;
    } else {
      playlist = await ensurePlaylist();
    }
    if (!playlist) { setUploading(false); return; }

    // Limite de 50 músicas por playlist para usuário (admin sem limite)
    if (!isAdmin) {
      try {
        const countRes = await authedFetch(`/api/playlist-songs?playlist_id=${playlist.id}`);
        const countData = await countRes.json();
        const currentCount = countData.songs?.length ?? 0;
        if (currentCount + total > 50) {
          toast.error(`Limite de 50 músicas por playlist. Esta playlist já tem ${currentCount} música(s). Você pode adicionar no máximo ${50 - currentCount}.`);
          setUploading(false);
          return;
        }
      } catch {}
    }

    setCreatedPlaylistId(playlist.id);

    let done = 0, skipped = 0, errors = 0;
    const linkedSongIds: string[] = [];

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (abortRef.current) break;
      const batch = selectedFiles.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(batch.map((f) => uploadSingleFile(f, genre)));

      const batchIds: string[] = [];
      for (const r of results) {
        done++;
        if (r.status === "skipped") skipped++;
        else if (r.status === "error") errors++;
        else if (r.songId) batchIds.push(r.songId);
      }

      if (batchIds.length > 0) {
        await appendSongsToPlaylist(playlist.id, batchIds).catch(() => { errors += batchIds.length; });
        linkedSongIds.push(...batchIds);
      }

      setUploadProgress({ done, total, skipped, errors });
    }

    if (linkedSongIds.length > 0) {
      window.dispatchEvent(new CustomEvent("playlist-created", { detail: { playlist } }));
      window.dispatchEvent(new Event("songs-changed"));
      if (isFavorite) {
        try {
          const favKey = "edu_fav_playlists";
          const saved = JSON.parse(localStorage.getItem(favKey) || "[]");
          if (!saved.includes(playlist.id)) { saved.push(playlist.id); localStorage.setItem(favKey, JSON.stringify(saved)); }
        } catch {}
      }
    }

    const uploaded = linkedSongIds.length;
    if (uploaded > 0) toast.success(`🎵 ${uploaded} música(s) enviada(s) com sucesso!`);
    if (skipped > 0) toast.info(`⏭️ ${skipped} duplicata(s) ignorada(s).`);
    if (errors > 0) toast.error(`❌ ${errors} erro(s) no envio.`);

    if (uploaded > 0) {
      setSelectedFiles([]);
      setUploadProgress({ done: 0, total: 0, skipped: 0, errors: 0 });
      if (fileRef.current) fileRef.current.value = "";
    }

    setUploading(false);
    if (uploaded > 0) onUploadComplete?.();
  };

  const handleUrlUpload = async () => {
    if (!directUrl.trim()) return;

    try {
      new URL(directUrl.trim());
    } catch {
      toast.error("URL inválida.");
      return;
    }

    if (!isPlaylistValid) { toast.error("Selecione uma playlist ou preencha capa, nome e gênero."); return; }

    setUploading(true);
    try {
      let playlist: PlaylistRecord | null = null;
      if (selectedPlaylistId) {
        playlist = playlists.find(p => p.id === selectedPlaylistId) || null;
      } else {
        playlist = await ensurePlaylist();
      }
      if (!playlist) { setUploading(false); return; }

      const segments = new URL(directUrl.trim()).pathname.split("/");
      const filename = decodeURIComponent(segments[segments.length - 1] || "audio");
      const parsed = parseTitleAndArtistFromFilename(filename);

      const res = await authedFetch("/api/songs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: parsed.title,
          artist: parsed.artist,
          genre: selectedGenre || null,
          file_path: directUrl.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      await appendSongsToPlaylist(playlist.id, [data.song.id]);
      trackUpload({ id: data.song.id, genre: selectedGenre || null, artist: parsed.artist });

      setCreatedPlaylistId(playlist.id);
      window.dispatchEvent(new CustomEvent("playlist-created", { detail: { playlist } }));
      window.dispatchEvent(new Event("songs-changed"));

      toast.success(`🎵 "${parsed.title}" enviada com sucesso!`);
      setDirectUrl("");
      onUploadComplete?.();
    } catch (err: any) {
      toast.error(err.message || "Erro ao enviar música.");
    } finally {
      setUploading(false);
    }
  };

  const resetState = () => {
    setSelectedFiles([]);
    setDirectUrl("");
    abortRef.current = true;
    if (fileRef.current) fileRef.current.value = "";
  };

  const progressPercent = uploadProgress.total > 0 ? (uploadProgress.done / uploadProgress.total) * 100 : 0;

  // Admin vê todas. Usuário vê só as que criou/importou.
  const userPlaylists = isAdmin
    ? playlists
    : playlists.filter(p => p.created_by === currentUserId);

  const filteredPlaylists = userPlaylists.filter(p =>
    !playlistSearch || p.name.toLowerCase().includes(playlistSearch.toLowerCase())
  );

  const sortedGenres = [...genres].sort((a, b) => {
    const aFav = favoriteGenres.has(a.id);
    const bFav = favoriteGenres.has(b.id);
    if (aFav && !bFav) return -1;
    if (!aFav && bFav) return 1;
    return a.display_name.localeCompare(b.display_name);
  });

  const selectedPlaylistName = selectedPlaylistId ? playlists.find(p => p.id === selectedPlaylistId)?.name : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto scrollbar-none space-y-3 pr-1">

        {/* Dropzone — altura fixa, NUNCA muda */}
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={`upload-dropzone border-2 rounded-lg transition-colors duration-300 h-24 flex flex-col items-center justify-center ${isDragging || selectedFiles.length > 0 ? "dragging" : ""}`}
        >
          {tab === "link" ? (
            <div className="w-full px-3 space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground">
                <LinkIcon className="h-4 w-4 shrink-0" />
                <span className="text-xs font-medium">Cole a URL direta do áudio</span>
              </div>
              <Input value={directUrl} onChange={(e) => setDirectUrl(e.target.value)} placeholder="https://exemplo.com/musica.mp3"
                className="bg-secondary/50 border-muted text-sm h-9" onKeyDown={(e) => e.key === "Enter" && handleUrlUpload()} />
            </div>
          ) : uploading && uploadProgress.total > 0 ? (
            <div className="w-full px-3 space-y-1">
              <Progress value={progressPercent} className="h-2 w-full" />
              <div className="flex items-center justify-between w-full text-xs text-muted-foreground">
                <span>{uploadProgress.done}/{uploadProgress.total} processados</span>
                <div className="flex gap-2">
                  {uploadProgress.skipped > 0 && <span className="text-primary">{uploadProgress.skipped} dup</span>}
                  {uploadProgress.errors > 0 && <span className="text-destructive">{uploadProgress.errors} erros</span>}
                </div>
              </div>
            </div>
          ) : selectedFiles.length > 0 ? (
            <div className="flex items-center gap-2 cursor-pointer" onClick={() => fileRef.current?.click()}>
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <span className="text-sm font-medium text-primary-foreground">{selectedFiles.length} arquivo(s) prontos</span>
              <button type="button" title="Limpar" onClick={(e) => { e.stopPropagation(); resetState(); }} className="text-muted-foreground hover:text-destructive ml-1"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div className="flex flex-col items-center cursor-pointer" onClick={() => fileRef.current?.click()}>
              <Music className="h-8 w-8 text-muted-foreground mb-1" />
              <p className="text-sm text-muted-foreground">{isDragging ? "Solte aqui..." : "Add arquivos ou link"}</p>
            </div>
          )}
          <input ref={fileRef} type="file" accept="audio/*" multiple onChange={handleFileChange} className="hidden" title="Selecionar arquivos" />
          <button type="button" title={tab === "upload" ? "Usar link direto" : "Enviar arquivos"} onClick={() => { setTab(tab === "upload" ? "link" : "upload"); resetState(); }}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-primary px-2 py-0.5 rounded bg-secondary/30 hover:bg-secondary/50 mt-1">
            {tab === "upload" ? (<><LinkIcon className="h-3 w-3" /> Usar link direto</>) : (<><Music className="h-3 w-3" /> Enviar arquivos</>)}
          </button>
        </div>

        {/* Capa + Nome + Heart + Clock */}
        <div className="grid grid-cols-[auto_1fr] gap-3 items-end">
          <div className="flex flex-col items-center gap-1">
            <Label className="text-xs text-muted-foreground">Capa</Label>
            <button type="button" title="Selecionar capa" onClick={() => coverRef.current?.click()}
              className="w-14 h-14 rounded-lg border-2 border-dashed border-muted-foreground/40 hover:border-primary/70 transition-colors flex items-center justify-center overflow-hidden bg-secondary/30">
              {coverPreview ? <img src={coverPreview} alt="Capa" className="w-full h-full object-cover" /> : <ImagePlus className="h-5 w-5 text-muted-foreground" />}
            </button>
            <input ref={coverRef} type="file" accept="image/*" onChange={handleCoverChange} className="hidden" title="Selecionar capa" />
          </div>
          <div className="flex flex-col gap-1 min-w-0">
            <Label className="text-xs text-muted-foreground">Nome da Playlist</Label>
            <div className="flex items-center gap-1.5">
              <Input value={playlistName} onChange={(e) => { setPlaylistName(e.target.value); setSelectedPlaylistId(null); }} placeholder="Ex: Jazz Noturno"
                className="bg-secondary/50 border-muted text-sm h-9 min-w-0 flex-1 focus:ring-0 focus:ring-offset-0" />
              <button type="button" onClick={() => setIsFavorite(!isFavorite)} title="Favoritar" className="shrink-0">
                <Heart className={`h-5 w-5 ${isFavorite ? "fill-primary text-primary" : "text-muted-foreground hover:text-primary"}`} />
              </button>
              <button type="button" onClick={() => { if (createdPlaylistId) setScheduleOpen(true); else toast.info("Envie as músicas primeiro."); }} title="Agendar" className="shrink-0">
                <Clock className="h-5 w-5 text-muted-foreground hover:text-primary" />
              </button>
            </div>
          </div>
        </div>

        {/* Gênero — dropdown abre como portal */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Gênero</Label>
          <Select value={selectedGenre} onValueChange={setSelectedGenre}>
            <SelectTrigger className="bg-secondary/50 border-muted text-sm h-9 focus:ring-0 focus:ring-offset-0">
              <SelectValue placeholder="Selecione o gênero" />
            </SelectTrigger>
            <SelectContent className="max-h-60" position="popper" side="top" sideOffset={4} data-upload-keep-open="true">
              {sortedGenres.map((g) => (
                <div key={g.id} className="flex items-center group">
                  <SelectItem value={g.name} className="flex-1 pr-1">
                    <span className="flex items-center gap-1.5">
                      {favoriteGenres.has(g.id) && <Heart className="h-3 w-3 fill-primary text-primary shrink-0" />}
                      {g.display_name}
                    </span>
                  </SelectItem>
                  <div className="flex items-center gap-0.5 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button type="button" onPointerDown={(e) => { e.stopPropagation(); toggleFavoriteGenre(g.id); }} className="p-0.5 rounded hover:bg-primary/20" title="Favoritar gênero">
                      <Heart className={`h-3.5 w-3.5 ${favoriteGenres.has(g.id) ? "fill-primary text-primary" : "text-muted-foreground"}`} />
                    </button>
                    <button type="button" onPointerDown={(e) => { e.stopPropagation(); handleDeleteGenre(g.id, g.display_name); }} className="p-0.5 rounded hover:bg-destructive/20" title="Excluir gênero">
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                    </button>
                  </div>
                </div>
              ))}
              <div className="border-t border-muted/30 mt-1 pt-1 px-2 pb-1">
                {showAddGenre ? (
                  <div className="flex items-center gap-1">
                    <Input value={newGenreName} onChange={(e) => setNewGenreName(e.target.value)} placeholder="Novo gênero..." className="h-7 text-xs bg-secondary/50 border-muted"
                      onKeyDown={(e) => { e.stopPropagation(); if (e.key === "Enter") handleAddGenre(); }}
                      onKeyUp={(e) => e.stopPropagation()} autoFocus />
                    <button type="button" onPointerDown={(e) => { e.stopPropagation(); handleAddGenre(); }} disabled={addingGenre} className="p-1 rounded bg-primary/20 hover:bg-primary/40" title="Confirmar">
                      {addingGenre ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> : <Plus className="h-3.5 w-3.5 text-primary" />}
                    </button>
                    <button type="button" onPointerDown={(e) => { e.stopPropagation(); setShowAddGenre(false); setNewGenreName(""); }} className="p-1 rounded hover:bg-destructive/20" title="Cancelar">
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ) : (
                  <button type="button" onPointerDown={(e) => { e.stopPropagation(); setShowAddGenre(true); }} className="flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 w-full py-1" title="Adicionar gênero">
                    <Plus className="h-3.5 w-3.5" /> Adicionar gênero
                  </button>
                )}
              </div>
            </SelectContent>
          </Select>
        </div>

        {/* Enviar para Playlist — Popover (portal, nunca vaza) */}
        <div className="flex flex-col gap-1">
          <Label className="text-xs text-muted-foreground">Enviar para Playlist</Label>
          <Popover open={playlistPopoverOpen} onOpenChange={(open) => {
            setPlaylistPopoverOpen(open);
            if (open) { loadPlaylists(); setPlaylistSearch(""); }
          }}>
            <PopoverTrigger asChild>
              <button type="button" title="Selecionar playlist"
                className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-secondary/50 px-3 text-sm hover:border-primary/50 transition-colors">
                <span className={selectedPlaylistName ? "text-foreground truncate" : "text-muted-foreground"}>
                  {selectedPlaylistName || "Selecionar playlist..."}
                </span>
                <ChevronDown className="h-4 w-4 opacity-50 shrink-0 ml-2" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)]" align="start" side="top" sideOffset={4}>
              <div className="p-2 border-b border-muted/30">
                <Input
                  value={playlistSearch}
                  onChange={(e) => setPlaylistSearch(e.target.value)}
                  placeholder="Buscar playlist..."
                  className="h-8 text-sm bg-secondary/50 border-muted"
                  autoFocus
                />
              </div>
              <div className="max-h-[180px] overflow-y-auto scrollbar-none">
                {filteredPlaylists.length > 0 ? filteredPlaylists.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => {
                      setSelectedPlaylistId(p.id);
                      setPlaylistName(p.name);
                      if (p.cover_url) setCoverPreview(p.cover_url);
                      setPlaylistPopoverOpen(false);
                    }}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-accent transition-colors truncate ${selectedPlaylistId === p.id ? "bg-accent font-medium" : ""}`}
                  >
                    {p.name}
                  </button>
                )) : (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    {isAdmin ? "Nenhuma playlist encontrada" : "Você só pode enviar músicas para playlists que criou ou importou"}
                  </p>
                )}
              </div>
            </PopoverContent>
          </Popover>
        </div>

        {!isPlaylistValid && (
          <p className="text-xs text-muted-foreground/60 text-center">Selecione uma playlist ou preencha capa, nome e gênero</p>
        )}
      </div>

      {/* Botão fixo no fundo */}
      <div className="shrink-0 pt-3">
        <Button
          type="button"
          onClick={tab === "upload" ? handleBatchUpload : handleUrlUpload}
          disabled={uploading || !isPlaylistValid || (tab === "upload" ? selectedFiles.length === 0 : !directUrl.trim())}
          className="w-full font-semibold bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all h-10"
        >
          {uploading ? (
            <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Enviando {uploadProgress.done}/{uploadProgress.total}...</>
          ) : (
            <><Upload className="h-4 w-4 mr-2" /> Enviar {tab === "upload" && selectedFiles.length > 1 ? `${selectedFiles.length} Músicas` : "Música"}</>
          )}
        </Button>
      </div>

      {createdPlaylistId && (
        <PlaylistScheduleDialog
          playlistId={createdPlaylistId}
          playlistName={playlistName || "Upload"}
          open={scheduleOpen}
          onOpenChange={setScheduleOpen}
        />
      )}
    </div>
  );
};

export default MusicUpload;
