"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic, Upload, Play, Pause, Trash2, Search, Loader2,
  Pencil, Check, X, Clock, Power, Star, Square, CheckSquare,
  Volume2, Send, ListMusic, BarChart2, CalendarClock, BanIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import {
  getSpotSettings,
  saveSpotSettings,
  invalidateSpotsCache,
  type SpotSettings,
} from "@/lib/spotIntercalate";
import {
  loadSpotConfigs,
  updateSpotConfig,
  removeSpotConfig,
  type SpotConfigMap,
  type SpotConfig,
  DEFAULT_SPOT_CONFIG,
} from "@/lib/spotConfig";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Spot {
  id: string;
  title: string;
  file_path: string;
  created_at: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

// ── Priority stars ────────────────────────────────────────────────────────────

function PrioritySelector({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-0.5" title="Repetições por ciclo (1 = igual aos demais, 5 = 5× mais)">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          aria-label={`Prioridade ${n}`}
          onClick={() => onChange(n)}
          className={`transition-colors ${n <= value ? "text-primary" : "text-muted-foreground/25"} hover:text-primary`}
        >
          <Star className="h-4 w-4" fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

// ── Spot row ──────────────────────────────────────────────────────────────────

const INTERVAL_PRESETS = [1, 2, 3, 4, 5];

interface SpotRowProps {
  spot: Spot;
  cfg: SpotConfig;
  selected: boolean;
  isPlaying: boolean;
  previewProgress: number;
  previewVolume: number;
  onSelect: () => void;
  onPlayPause: () => void;
  onVolumeChange: (v: number) => void;
  onDelete: () => void;
  onConfigChange: (patch: Partial<SpotConfig>) => void;
  onRename: (t: string) => void;
  onSendToClient?: () => void;
}

function SpotRow({
  spot, cfg, selected, isPlaying, previewProgress, previewVolume,
  onSelect, onPlayPause, onVolumeChange, onDelete, onConfigChange, onRename, onSendToClient,
}: SpotRowProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(spot.title);
  const [schedStart, setSchedStart] = useState(cfg.scheduleStart ?? "");
  const [schedEnd, setSchedEnd] = useState(cfg.scheduleEnd ?? "");

  const commitRename = () => {
    const t = editTitle.trim();
    if (t && t !== spot.title) onRename(t);
    setEditing(false);
  };


  return (
    <div className={`rounded-xl border transition-all ${cfg.enabled ? "bg-secondary/30 border-border/40" : "bg-secondary/10 border-border/20 opacity-60"} ${selected ? "ring-1 ring-primary/50" : ""}`}>

      {/* ── Row 1: identity + actions ── */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">

        {/* Checkbox */}
        <button type="button" onClick={onSelect} aria-label="Selecionar" className="shrink-0 text-muted-foreground hover:text-primary transition-colors">
          {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
        </button>

        {/* Play / Pause */}
        <button
          type="button"
          aria-label={isPlaying ? "Pausar" : "Ouvir spot"}
          onClick={onPlayPause}
          className="w-9 h-9 rounded-full bg-primary/20 text-primary flex items-center justify-center hover:bg-primary/30 transition-colors shrink-0"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        {/* Title */}
        <div className="flex-1 min-w-0">
          {editing ? (
            <div className="flex items-center gap-1">
              <Input autoFocus value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") setEditing(false); }}
                className="h-7 text-sm py-0 px-2 bg-secondary" />
              <button type="button" title="Confirmar" aria-label="Confirmar renomeação" onClick={commitRename} className="text-green-400 p-1"><Check className="h-4 w-4" /></button>
              <button type="button" title="Cancelar" aria-label="Cancelar renomeação" onClick={() => setEditing(false)} className="text-muted-foreground p-1"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <p className="text-sm font-medium truncate">{spot.title}</p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] text-muted-foreground">{new Date(spot.created_at).toLocaleDateString("pt-BR")}</span>
            {!cfg.enabled && <span className="text-[10px] bg-red-500/20 text-red-400 rounded px-1.5 py-0.5">inativo</span>}
            {cfg.interval && <span className="text-[10px] bg-blue-500/20 text-blue-400 rounded px-1.5 py-0.5">a cada {cfg.interval}</span>}
            {cfg.scheduleStart && <span className="text-[10px] bg-primary/20 text-primary rounded px-1.5 py-0.5 font-medium">agendado</span>}
            {cfg.priority > 1 && <span className="text-[10px] bg-amber-500/20 text-amber-400 rounded px-1.5 py-0.5">×{cfg.priority}</span>}
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" title="Renomear" onClick={() => { setEditTitle(spot.title); setEditing(true); }}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-primary transition-colors">
            <Pencil className="h-4 w-4" />
          </button>
          <button type="button" title={cfg.enabled ? "Desativar" : "Ativar"} onClick={() => onConfigChange({ enabled: !cfg.enabled })}
            className={`p-1.5 rounded-lg transition-colors ${cfg.enabled ? "text-green-400 hover:text-green-300" : "text-muted-foreground/40 hover:text-muted-foreground"}`}>
            <Power className="h-4 w-4" />
          </button>
          {onSendToClient && (
            <button type="button" title="Enviar para outro cliente" onClick={onSendToClient}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-primary transition-colors">
              <Send className="h-4 w-4" />
            </button>
          )}
          <button type="button" title="Excluir" onClick={onDelete}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Preview progress bar */}
      {isPlaying && (
        <div className="mx-3 mb-1 h-1 bg-secondary rounded-full overflow-hidden">
          <div className="h-full bg-primary rounded-full transition-all duration-500"
            ref={(el) => { if (el) el.style.width = `${previewProgress * 100}%`; }} />
        </div>
      )}

      {/* ── Row 2: controls always visible ── */}
      <div className="px-3 pb-3 pt-1 grid grid-cols-1 sm:grid-cols-3 gap-3 border-t border-border/20 mt-1">

        {/* Intervalo por spot */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <ListMusic className="h-3 w-3" /> A cada X músicas
          </p>
          <div className="flex gap-1">
            {INTERVAL_PRESETS.map((n) => (
              <button key={n} type="button"
                onClick={() => onConfigChange({ interval: n })}
                className={`text-[11px] w-8 h-7 rounded-lg transition-colors font-medium ${cfg.interval === n ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary"}`}>
                {n}
              </button>
            ))}
          </div>
        </div>

        {/* Prioridade */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <BarChart2 className="h-3 w-3" /> Prioridade (máx 5×)
          </p>
          <PrioritySelector value={cfg.priority} onChange={(v) => {
            onConfigChange({ priority: v });
            toast.success(v === 1 ? "Prioridade igual aos demais." : `Toca ${v}× mais por ciclo.`);
          }} />
        </div>

        {/* Programação */}
        <div className="space-y-1.5">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1">
            <CalendarClock className="h-3 w-3" /> Programação
          </p>
          <div className="space-y-1">
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground w-7">Início</span>
              <Input type="datetime-local" value={schedStart}
                onChange={(e) => setSchedStart(e.target.value)}
                className="h-7 text-[11px] bg-secondary px-1.5 flex-1" />
            </div>
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground w-7">Fim</span>
              <Input type="datetime-local" value={schedEnd}
                onChange={(e) => setSchedEnd(e.target.value)}
                className="h-7 text-[11px] bg-secondary px-1.5 flex-1" />
            </div>
            <div className="flex gap-1">
              <button type="button" onClick={() => {
                onConfigChange({ scheduleStart: schedStart || null, scheduleEnd: schedEnd || null });
                toast.success(schedStart ? "Programação salva." : "Programação removida.");
              }} className="h-6 px-2 rounded bg-primary/20 text-primary text-[11px] hover:bg-primary/30 transition-colors">
                Salvar
              </button>
              {(cfg.scheduleStart || cfg.scheduleEnd) && (
                <button type="button" onClick={() => {
                  setSchedStart(""); setSchedEnd("");
                  onConfigChange({ scheduleStart: null, scheduleEnd: null });
                  toast.success("Programação removida.");
                }} className="h-6 px-2 rounded bg-destructive/20 text-destructive text-[11px] hover:bg-destructive/30 transition-colors">
                  Limpar
                </button>
              )}
            </div>
          </div>
        </div>

      </div>

      {/* Preview volume (só quando tocando) */}
      {isPlaying && (
        <div className="px-3 pb-3 flex items-center gap-3">
          <Volume2 className="h-4 w-4 text-primary shrink-0" />
          <Slider value={[previewVolume]} onValueChange={(v) => onVolumeChange(v[0])} min={0} max={1} step={0.01} className="flex-1 max-w-[200px]" />
          <span className="text-xs text-muted-foreground w-8">{Math.round(previewVolume * 100)}%</span>
        </div>
      )}

    </div>
  );
}

// ── Bulk action bar ───────────────────────────────────────────────────────────

function BulkBar({
  count,
  onEnable,
  onDisable,
  onDelete,
  onPriority,
  onSchedule,
  onClear,
}: {
  count: number;
  onEnable: () => void;
  onDisable: () => void;
  onDelete: () => void;
  onPriority: (p: number) => void;
  onSchedule: (t: string | null) => void;
  onClear: () => void;
}) {
  const [scheduleVal, setScheduleVal] = useState("");
  const [showSched, setShowSched] = useState(false);

  return (
    <div className="bg-primary/10 border border-primary/20 rounded-xl p-3 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <span className="text-sm font-semibold text-primary">{count} spot{count !== 1 ? "s" : ""} selecionado{count !== 1 ? "s" : ""}</span>
        <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
          <X className="h-3.5 w-3.5" /> Limpar seleção
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" onClick={onEnable} className="h-7 text-xs bg-green-600/80 hover:bg-green-600 text-white"><Power className="h-3.5 w-3.5 mr-1" />Ativar</Button>
        <Button type="button" size="sm" onClick={onDisable} className="h-7 text-xs bg-secondary hover:bg-secondary/80 text-muted-foreground"><Power className="h-3.5 w-3.5 mr-1" />Desativar</Button>
        <Button type="button" size="sm" onClick={onDelete} className="h-7 text-xs bg-destructive/80 hover:bg-destructive text-white"><Trash2 className="h-3.5 w-3.5 mr-1" />Excluir</Button>
        <Button type="button" size="sm" onClick={() => setShowSched(!showSched)} className="h-7 text-xs bg-secondary hover:bg-secondary/80 text-foreground"><Clock className="h-3.5 w-3.5 mr-1" />Horário</Button>
      </div>

      {/* Bulk priority */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted-foreground">Prioridade em lote:</span>
        <div className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" onClick={() => onPriority(n)}
              className="w-7 h-7 rounded-lg text-xs font-bold bg-secondary/60 hover:bg-primary hover:text-primary-foreground transition-colors">
              {n}×
            </button>
          ))}
        </div>
      </div>

      {/* Bulk schedule */}
      {showSched && (
        <div className="flex items-center gap-2 flex-wrap">
          <Input type="time" value={scheduleVal} onChange={(e) => setScheduleVal(e.target.value)} className="h-8 w-32 text-sm bg-secondary" />
          <Button type="button" size="sm" onClick={() => { if (/^\d{2}:\d{2}$/.test(scheduleVal)) { onSchedule(scheduleVal); setShowSched(false); } else toast.error("Use HH:MM"); }}
            className="h-8 bg-primary text-primary-foreground px-3 text-xs">Aplicar</Button>
          <button type="button" onClick={() => { onSchedule(null); setShowSched(false); }} className="text-xs text-destructive hover:underline">Remover horários</button>
        </div>
      )}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SpotsPanelProps {
  userId?: string | null;
  onPreviewStart?: () => void;
  onPreviewEnd?: () => void;
}

const SpotsPanel = ({ userId: propUserId, onPreviewStart, onPreviewEnd }: SpotsPanelProps) => {
  const [settings, setSettings] = useState<SpotSettings>(() =>
    typeof window !== "undefined" ? getSpotSettings() : { enabled: false, interval: 5 }
  );

  const [spots, setSpots] = useState<Spot[]>([]);
  const [configs, setConfigs] = useState<SpotConfigMap>(() =>
    typeof window !== "undefined" ? loadSpotConfigs() : {}
  );
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Preview audio — independent of main player
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [previewProgress, setPreviewProgress] = useState(0);
  const [previewVolume, setPreviewVolume] = useState(0.8);

  const userIdRef = useRef<string | null>(propUserId ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const progressIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);


  useEffect(() => {
    // Clean corrupted owner-avatar-user-id from localStorage
    const storedOwner = localStorage.getItem("owner-avatar-user-id");
    if (storedOwner && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(storedOwner)) {
      localStorage.removeItem("owner-avatar-user-id");
    }

    // Load spots immediately (local API, no auth needed)
    loadSpots();
    // Resolve auth in background for operations that need userId
    supabase.auth.getSession().then(({ data: { session } }) => {
      const uid = session?.user?.id ?? null;
      if (uid) userIdRef.current = uid;
    });

    const onCfgChange = () => setConfigs(loadSpotConfigs());
    window.addEventListener("spot-configs-changed", onCfgChange);
    return () => {
      window.removeEventListener("spot-configs-changed", onCfgChange);
      previewAudioRef.current?.pause();
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync if parent resolves a different userId later
  useEffect(() => {
    if (!propUserId || propUserId === userIdRef.current) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propUserId)) return;
    userIdRef.current = propUserId;
    loadSpots();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propUserId]);

  const loadSpots = async () => {
    try {
      const res = await fetch("/api/spots");
      const json = await res.json();
      setSpots(json.spots || []);
    } catch (err: any) {
      toast.error(`Erro ao carregar spots: ${err?.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Preview ────────────────────────────────────────────────────────────────

  const stopPreview = () => {
    previewAudioRef.current?.pause();
    if (progressIntervalRef.current) { clearInterval(progressIntervalRef.current); progressIntervalRef.current = null; }
    setPlayingId(null);
    setPreviewProgress(0);
    onPreviewEnd?.();
  };

  const handlePlayPause = async (spot: Spot) => {
    if (playingId === spot.id) { stopPreview(); return; }
    stopPreview();

    try {
      const audio = new Audio(spot.file_path);
      audio.volume = previewVolume;
      previewAudioRef.current = audio;

      audio.onended = () => stopPreview();
      audio.onerror = () => { toast.error("Erro ao reproduzir spot."); stopPreview(); };

      onPreviewStart?.();
      await audio.play();
      setPlayingId(spot.id);

      progressIntervalRef.current = setInterval(() => {
        if (!previewAudioRef.current) return;
        const { currentTime, duration } = previewAudioRef.current;
        setPreviewProgress(duration > 0 ? currentTime / duration : 0);
      }, 500);
    } catch { toast.error("Erro ao reproduzir spot."); }
  };

  const handlePreviewVolume = (v: number) => {
    setPreviewVolume(v);
    if (previewAudioRef.current) previewAudioRef.current.volume = v;
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    const isValid = (f: File) => /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(f.name) ||
      f.type.startsWith("audio/");

    const invalid = files.filter((f) => !isValid(f));
    if (invalid.length) { toast.error(`${invalid.length} arquivo(s) inválido(s).`); }

    const valid = files.filter(isValid);
    if (!valid.length) return;

    setUploading(true);
    setUploadProgress({ done: 0, total: valid.length });

    let ok = 0, fail = 0;

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      try {
        const title = file.name.replace(/\.[^.]+$/, "");
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        const res = await fetch("/api/spots", { method: "POST", body: form });
        if (!res.ok) throw new Error((await res.json()).error ?? "Erro no servidor");
        ok++;
      } catch (err: any) {
        fail++;
        toast.error(`Erro no upload: ${err?.message}`);
      }
      setUploadProgress({ done: i + 1, total: valid.length });
    }

    invalidateSpotsCache();
    if (ok > 0) toast.success(`${ok} spot${ok !== 1 ? "s" : ""} enviado${ok !== 1 ? "s" : ""}.`);
    if (fail > 0) toast.error(`${fail} falhou no envio.`);

    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadSpots();
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteSpots = async (ids: string[]) => {
    if (!confirm(`Excluir ${ids.length} spot${ids.length !== 1 ? "s" : ""}?`)) return;
    for (const id of ids) {
      try {
        await fetch("/api/spots", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
        removeSpotConfig(id);
        if (playingId === id) stopPreview();
      } catch { toast.error("Erro ao excluir spot."); }
    }
    invalidateSpotsCache();
    setSpots((prev) => prev.filter((s) => !ids.includes(s.id)));
    setSelected(new Set());
    toast.success(`${ids.length} spot${ids.length !== 1 ? "s" : ""} excluído${ids.length !== 1 ? "s" : ""}.`);
  };

  const handleRename = async (spot: Spot, newTitle: string) => {
    try {
      await fetch("/api/spots", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: spot.id, title: newTitle }) });
      setSpots((prev) => prev.map((s) => s.id === spot.id ? { ...s, title: newTitle } : s));
      invalidateSpotsCache();
      toast.success("Renomeado.");
    } catch { toast.error("Erro ao renomear."); }
  };

  const handleConfigChange = (id: string, patch: Partial<SpotConfig>) => {
    updateSpotConfig(id, patch);
    setConfigs(loadSpotConfigs());
    invalidateSpotsCache();
  };

  // ── Selection ─────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    setSelected((prev) => prev.size === filtered.length ? new Set() : new Set(filtered.map((s) => s.id)));
  };

  // ── Bulk ops ──────────────────────────────────────────────────────────────

  const bulkConfigChange = (ids: string[], patch: Partial<SpotConfig>) => {
    ids.forEach((id) => updateSpotConfig(id, patch));
    setConfigs(loadSpotConfigs());
    invalidateSpotsCache();
    toast.success(`Atualizado ${ids.length} spot${ids.length !== 1 ? "s" : ""}.`);
  };

  // ── Interval ──────────────────────────────────────────────────────────────

  const handleToggleEnabled = useCallback(() => {
    const next: SpotSettings = { ...settings, enabled: !settings.enabled };
    setSettings(next);
    saveSpotSettings(next);
    toast.success(next.enabled ? "Spots ativados." : "Spots desativados.");
  }, [settings]);


  // ── Derived ───────────────────────────────────────────────────────────────

  const filtered = spots.filter((s) => s.title.toLowerCase().includes(search.toLowerCase()));
  const selectedIds = Array.from(selected);
  const enabledSpots = spots.filter((s) => (configs[s.id] ?? DEFAULT_SPOT_CONFIG).enabled);
  const scheduledCount = enabledSpots.filter((s) => configs[s.id]?.scheduleStart).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-2xl mx-auto space-y-3">

      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="h-5 w-5 text-primary" />
          <h2 className="text-base font-semibold">Spots de Áudio</h2>
          {spots.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-primary/20 text-primary rounded-full px-2 py-0.5">{spots.length}</span>
              <span className="text-xs bg-green-500/20 text-green-400 rounded-full px-2 py-0.5">{enabledSpots.length} ativos</span>
              {scheduledCount > 0 && <span className="text-xs bg-blue-500/20 text-blue-400 rounded-full px-2 py-0.5">{scheduledCount} agendados</span>}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {spots.length > 0 && (
            <button type="button" onClick={() => {
              spots.forEach((s) => updateSpotConfig(s.id, { enabled: false }));
              setConfigs(loadSpotConfigs()); invalidateSpotsCache();
              const next = { ...settings, enabled: false };
              setSettings(next); saveSpotSettings(next);
              toast.success("Só músicas ativado.");
            }} className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-lg border border-border/60 text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors">
              <BanIcon className="h-3 w-3" /> Só Músicas
            </button>
          )}
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{settings.enabled ? "Spots on" : "Spots off"}</span>
            <button type="button" onClick={handleToggleEnabled} aria-label="Alternar spots"
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${settings.enabled ? "bg-primary" : "bg-muted"}`}>
              <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${settings.enabled ? "translate-x-4.5" : "translate-x-0.5"}`} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Biblioteca de Spots ── */}
      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <div className="px-4 py-2.5 bg-secondary/20 border-b border-border/30 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <Mic className="h-3.5 w-3.5 text-primary" />
            <span className="text-xs font-semibold">Biblioteca de Spots</span>
            {spots.length > 0 && <span className="text-xs text-muted-foreground">({filtered.length})</span>}
          </div>
          {filtered.length > 0 && (
            <button type="button" onClick={toggleSelectAll} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
              {selected.size === filtered.length ? "Desmarcar todos" : "Selecionar todos"}
            </button>
          )}
        </div>

        <div className="p-3 space-y-3">
          <input ref={fileInputRef} type="file" multiple className="hidden" aria-label="Selecionar spots"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus" onChange={handleUpload} />

          {/* Upload button compacto */}
          <button type="button" onClick={() => fileInputRef.current?.click()} disabled={uploading}
            className="w-full border border-dashed border-primary/40 rounded-lg py-3 flex items-center justify-center gap-2 hover:border-primary/70 hover:bg-primary/5 transition-all disabled:opacity-50 disabled:pointer-events-none">
            {uploading ? (
              <>
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                <span className="text-sm text-primary">{uploadProgress ? `Enviando ${uploadProgress.done}/${uploadProgress.total}…` : "Enviando…"}</span>
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Enviar Spot</span>
                <span className="text-xs text-muted-foreground">MP3, WAV, OGG, M4A — vários de uma vez</span>
              </>
            )}
          </button>

          {uploading && uploadProgress && uploadProgress.total > 1 && (
            <div className="h-1 bg-secondary rounded-full overflow-hidden">
              <div className="h-full bg-primary rounded-full transition-all"
                ref={(el) => { if (el) el.style.width = `${(uploadProgress.done / uploadProgress.total) * 100}%`; }} />
            </div>
          )}

          {spots.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar spot…" className="pl-8 h-8 text-sm bg-secondary/50" />
            </div>
          )}

          {selected.size > 0 && (
            <BulkBar count={selected.size}
              onEnable={() => bulkConfigChange(selectedIds, { enabled: true })}
              onDisable={() => bulkConfigChange(selectedIds, { enabled: false })}
              onDelete={() => deleteSpots(selectedIds)}
              onPriority={(p) => bulkConfigChange(selectedIds, { priority: p })}
              onSchedule={(t) => bulkConfigChange(selectedIds, { scheduledAt: t })}
              onClear={() => setSelected(new Set())} />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 gap-2 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
              <span className="text-sm">Carregando…</span>
            </div>
          ) : spots.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Mic className="h-8 w-8 mx-auto mb-2 opacity-20" />
              <p className="text-sm">Nenhum spot ainda — envie seu primeiro arquivo acima</p>
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">Nenhum spot encontrado para "{search}"</p>
          ) : (
            <div className="space-y-2 max-h-[600px] overflow-y-auto pr-0.5">
              {filtered.map((spot) => (
                <SpotRow key={spot.id} spot={spot}
                  cfg={configs[spot.id] ?? DEFAULT_SPOT_CONFIG}
                  selected={selected.has(spot.id)}
                  isPlaying={playingId === spot.id}
                  previewProgress={playingId === spot.id ? previewProgress : 0}
                  previewVolume={previewVolume}
                  onSelect={() => toggleSelect(spot.id)}
                  onPlayPause={() => handlePlayPause(spot)}
                  onVolumeChange={handlePreviewVolume}
                  onDelete={() => deleteSpots([spot.id])}
                  onConfigChange={(patch) => handleConfigChange(spot.id, patch)}
                  onRename={(t) => handleRename(spot, t)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpotsPanel;
