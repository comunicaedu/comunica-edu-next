"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Mic, Upload, Play, Trash2, Search, Loader2,
  Pencil, Power, Star, Key,
  BanIcon, Newspaper, Lock,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import { toast } from "sonner";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import {
  getSpotSettings,
  loadSpotSettings,
  saveSpotSettings,
  invalidateSpotsCache,
  type SpotSettings,
} from "@/lib/spotIntercalate";
import {
  loadSpotConfigs,
  fetchSpotConfigs,
  saveSpotConfig,
  setCachedSpotConfigs,
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
  owner_name?: string;   // preenchido só para admin
  owner_id?: string;     // preenchido só para admin
}

interface Client {
  id: string;
  name: string;
}

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
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${n <= value ? "text-primary" : "text-muted-foreground/25"} hover:text-primary hover:bg-primary/10`}
        >
          <Star className="h-4 w-4" fill={n <= value ? "currentColor" : "none"} />
        </button>
      ))}
    </div>
  );
}

// ── Spot row ──────────────────────────────────────────────────────────────────

interface SpotRowProps {
  spot: Spot;
  cfg: SpotConfig;
  isSelected: boolean;
  isPreviewing: boolean;
  showOwner?: boolean;
  onToggleSelect: () => void;
  onPlaySpot: () => void;
  onDelete: () => void;
  onConfigChange: (patch: Partial<SpotConfig>) => void;
  onRename: (t: string) => void;
}

function SpotRow({
  spot, cfg,
  isSelected, isPreviewing, showOwner,
  onToggleSelect,
  onPlaySpot, onDelete, onConfigChange, onRename,
}: SpotRowProps) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(spot.title);

  // Padrão getDerivedStateFromProps: mantém estado local sincronizado com cfg
  // sem depender de useEffect (que pode não disparar quando cfg muda durante render)
  const [schedDate, setSchedDate] = useState(cfg.scheduleStart?.split("T")[0] ?? "");
  const [schedEndDate, setSchedEndDate] = useState(cfg.scheduleEnd?.split("T")[0] ?? "");
  const [schedTime, setSchedTime] = useState(cfg.scheduleStart?.split("T")[1]?.slice(0, 5) ?? "");
  const [schedEndTime, setSchedEndTime] = useState(cfg.scheduleEnd?.split("T")[1]?.slice(0, 5) ?? "");
  const [prevCfgStart, setPrevCfgStart] = useState(cfg.scheduleStart);
  const [prevCfgEnd, setPrevCfgEnd] = useState(cfg.scheduleEnd);
  const [prevTitle, setPrevTitle] = useState(spot.title);

  // Sync durante o render — garante que inputs refletem o cfg IMEDIATAMENTE
  if (cfg.scheduleStart !== prevCfgStart) {
    setPrevCfgStart(cfg.scheduleStart);
    setSchedDate(cfg.scheduleStart?.split("T")[0] ?? "");
    setSchedTime(cfg.scheduleStart?.split("T")[1]?.slice(0, 5) ?? "");
  }
  if (cfg.scheduleEnd !== prevCfgEnd) {
    setPrevCfgEnd(cfg.scheduleEnd);
    setSchedEndDate(cfg.scheduleEnd?.split("T")[0] ?? "");
    setSchedEndTime(cfg.scheduleEnd?.split("T")[1]?.slice(0, 5) ?? "");
  }
  if (spot.title !== prevTitle && !editing) {
    setPrevTitle(spot.title);
    setEditTitle(spot.title);
  }

  const commitRename = () => {
    const t = editTitle.trim();
    if (t && t !== spot.title) onRename(t);
    setEditing(false);
  };

  // Spot está salvo com schedule no banco?
  const isScheduledSaved = !!cfg.scheduleStart;

  const handleSaveOrCancel = () => {
    if (isScheduledSaved) {
      // Clicar novamente = cancelar agendamento
      setSchedDate(""); setSchedEndDate(""); setSchedTime(""); setSchedEndTime("");
      onConfigChange({ scheduleStart: null, scheduleEnd: null });
    } else {
      // Só salva se a data de início for hoje ou no futuro
      const today = new Date().toISOString().split("T")[0];
      if (!schedDate || schedDate < today) return;
      const start = `${schedDate}T${schedTime || "00:00"}`;
      const end = schedEndDate ? `${schedEndDate}T${schedEndTime || "23:59"}` : null;
      const patch: Partial<SpotConfig> = { scheduleStart: start, scheduleEnd: end };
      patch.enabled = true; // ativa automaticamente ao programar
      onConfigChange(patch);
    }
  };

  return (
    <div className={`rounded-xl border transition-colors ${cfg.enabled ? "bg-secondary/30 border-border/40" : "bg-secondary/10 border-border/20 opacity-60"}`}>

      {/* ── Linha 1: Checkbox | Play | Nome + data | Renomear | Excluir ── */}
      <div className="flex items-center gap-3 px-3 pt-3 pb-2">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={onToggleSelect}
          title="Selecionar para configuração em lote"
          className="w-4 h-4 accent-primary cursor-pointer shrink-0"
        />
        <button
          type="button"
          aria-label={isPreviewing ? "Pausar spot" : "Tocar spot no player"}
          onClick={onPlaySpot}
          className={`w-9 h-9 rounded-full flex items-center justify-center transition-colors shrink-0 ${isPreviewing ? "bg-primary text-primary-foreground hover:bg-primary/80" : "bg-primary/20 text-primary hover:bg-primary/30"}`}
        >
          {isPreviewing
            ? <span className="w-3.5 h-3.5 flex gap-[3px]"><span className="w-1 h-full bg-current rounded-sm"/><span className="w-1 h-full bg-current rounded-sm"/></span>
            : <Play className="h-4 w-4 ml-0.5" />}
        </button>

        <div className="flex-1 min-w-0">
          {editing ? (
            <Input autoFocus value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") commitRename(); if (e.key === "Escape") { setEditing(false); setEditTitle(spot.title); } }}
              className="h-[1.375rem] text-sm py-0 px-2 bg-secondary w-full" />
          ) : (
            <p className="text-sm font-semibold truncate leading-[1.375rem]">{spot.title}</p>
          )}
          <div className="flex items-center gap-1.5 mt-0.5">
            <span className="text-xs text-muted-foreground">{new Date(spot.created_at).toLocaleDateString("pt-BR")}</span>
            {spot.owner_name && <span className="text-[10px] rounded px-1.5 py-0.5 bg-primary/15 text-primary">{spot.owner_name}</span>}
            <span className={`text-[10px] rounded px-1.5 py-0.5 transition-opacity ${cfg.scheduleStart ? "bg-blue-500/20 text-blue-400 opacity-100" : "opacity-0 pointer-events-none select-none"}`}>agendado</span>
          </div>
        </div>

        <button type="button" title="Renomear"
          onClick={() => { setEditTitle(spot.title); setEditing(true); }}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-primary transition-colors shrink-0">
          <Pencil className="h-3.5 w-3.5" />
        </button>

        <button type="button" title="Excluir" onClick={onDelete}
          className="p-1.5 rounded-lg text-muted-foreground hover:text-destructive transition-colors shrink-0">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* ── Linha 2: Dono | Prioridade | Agendamento + Toggle ── */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-border/20">

        {/* Espaçador — badge do dono já aparece na linha 1 */}
        <div className="shrink-0 min-w-[72px]" />

        <div className="w-px h-4 bg-border/30 shrink-0" />

        {/* quantas vezes a mais do que os outros? [★★★★★] */}
        <div className="flex items-center gap-1 shrink-0">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">Quantas vezes a mais do que os outros?</span>
          <PrioritySelector value={cfg.priority} onChange={(v) => {
            onConfigChange({ priority: v });
            toast.success(v === 1 ? "Frequência igual aos demais." : `Toca ${v}× mais que os outros.`);
          }} />
        </div>

        <div className="w-px h-4 bg-border/30 shrink-0" />

        {/* Programe do dia [data] até [data] [Salvar] [Ativo] */}
        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">Programe do dia</span>
          <input
            type="date"
            title="Data de início"
            value={schedDate}
            min={new Date().toISOString().split("T")[0]}
            onChange={(e) => setSchedDate(e.target.value)}
            className="h-6 w-[100px] shrink-0 text-[10px] px-1 rounded-md bg-secondary/70 border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:[filter:invert(55%)_sepia(90%)_saturate(400%)_hue-rotate(5deg)_brightness(105%)]"
          />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">até</span>
          <input
            type="date"
            title="Data de término"
            value={schedEndDate}
            min={schedDate || new Date().toISOString().split("T")[0]}
            onChange={(e) => setSchedEndDate(e.target.value)}
            className="h-6 w-[100px] shrink-0 text-[10px] px-1 rounded-md bg-secondary/70 border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:[filter:invert(55%)_sepia(90%)_saturate(400%)_hue-rotate(5deg)_brightness(105%)]"
          />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">das</span>
          <input
            type="time"
            title="Horário de início diário"
            value={schedTime}
            onChange={(e) => setSchedTime(e.target.value)}
            className="h-6 w-[68px] shrink-0 text-[10px] px-1 rounded-md bg-secondary/70 border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:[filter:invert(55%)_sepia(90%)_saturate(400%)_hue-rotate(5deg)_brightness(105%)]"
          />
          <span className="text-[10px] text-muted-foreground whitespace-nowrap">às</span>
          <input
            type="time"
            title="Horário de término diário"
            value={schedEndTime}
            onChange={(e) => setSchedEndTime(e.target.value)}
            className="h-6 w-[68px] shrink-0 text-[10px] px-1 rounded-md bg-secondary/70 border border-border/50 text-foreground focus:outline-none focus:ring-1 focus:ring-primary [&::-webkit-calendar-picker-indicator]:cursor-pointer [&::-webkit-calendar-picker-indicator]:opacity-80 [&::-webkit-calendar-picker-indicator]:[filter:invert(55%)_sepia(90%)_saturate(400%)_hue-rotate(5deg)_brightness(105%)]"
          />
          <button type="button" onClick={handleSaveOrCancel}
            className="h-6 px-2.5 rounded-md font-semibold text-[10px] transition-colors shrink-0 bg-primary/80 text-primary-foreground hover:bg-primary">
            Salvar
          </button>
          <button type="button" onClick={() => onConfigChange({ enabled: !cfg.enabled })}
            className={`flex items-center gap-1 text-[10px] px-2.5 h-6 rounded-md border transition-colors font-medium shrink-0 ${cfg.enabled ? "border-green-500/40 text-green-400 bg-green-500/10 hover:bg-green-500/20" : "border-orange-500/40 text-orange-400/80 bg-orange-500/10 hover:bg-orange-500/20"}`}>
            <Power className="h-3 w-3" />
            {cfg.enabled ? "Ativo" : "Inativo"}
          </button>
        </div>
      </div>

    </div>
  );
}

// ── Dropdown card: selecionar clientes para distribuição ─────────────────────

interface DistribuirCardProps {
  clients: Client[];
  loadingClients: boolean;
  selectedClients: Set<string>;
  onChange: (next: Set<string>) => void;
  onClose: () => void;
}

function DistribuirCard({ clients, loadingClients, selectedClients, onChange, onClose }: DistribuirCardProps) {
  const [clientSearch, setClientSearch] = useState("");
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = clients.filter((c) => c.name.toLowerCase().includes(clientSearch.toLowerCase()));
  const allSelected = filtered.length > 0 && filtered.every((c) => selectedClients.has(c.id));

  const toggle = (id: string) => {
    const n = new Set(selectedClients);
    n.has(id) ? n.delete(id) : n.add(id);
    onChange(n);
  };

  const toggleAll = () => {
    const n = new Set(selectedClients);
    if (allSelected) filtered.forEach((c) => n.delete(c.id));
    else filtered.forEach((c) => n.add(c.id));
    onChange(n);
  };

  return (
    <div ref={cardRef}
      className="absolute right-0 top-full mt-2 z-50 w-60 h-[280px] bg-card border border-border/50 rounded-xl shadow-2xl flex flex-col overflow-hidden">

      {/* Header — shrink-0, uma linha, não cresce */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-secondary/30 border-b border-border/30 shrink-0">
        <span className="text-xs font-semibold flex-1 truncate">Selecionar destinatários</span>
        {selectedClients.size > 0 && (
          <span className="text-[10px] text-primary font-bold shrink-0">{selectedClients.size}</span>
        )}
      </div>

      {/* Busca + "Todos" — shrink-0 */}
      <div className="px-2 pt-2 pb-1 shrink-0 space-y-1.5">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
          <input value={clientSearch} onChange={(e) => setClientSearch(e.target.value)}
            placeholder="Buscar cliente…"
            className="w-full h-6 pl-6 pr-2 text-[10px] rounded-md bg-secondary/60 border border-border/40 text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50" />
        </div>
        <div className="flex items-center justify-between px-1">
          <span className="text-[10px] text-muted-foreground/60">Clientes ({filtered.length})</span>
          <label className="flex items-center gap-1 cursor-pointer text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
            <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-3 h-3 accent-primary" />
            Todos
          </label>
        </div>
      </div>

      {/* Lista — flex-1 overflow-y-auto, não cresce o card */}
      <div className="flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {loadingClients ? (
          <div className="flex items-center justify-center h-full gap-1.5 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            <span className="text-[10px]">Carregando…</span>
          </div>
        ) : (
          <>
            {filtered.map((c) => (
              <div key={c.id}
                onClick={() => toggle(c.id)}
                className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-white/5 transition-colors">
                <input type="checkbox" title={`Selecionar ${c.name}`} checked={selectedClients.has(c.id)} onChange={() => toggle(c.id)}
                  className="w-3 h-3 accent-primary shrink-0" onClick={(e) => e.stopPropagation()} />
                <span className={`text-[10px] truncate flex-1 ${selectedClients.has(c.id) ? "text-foreground" : "text-muted-foreground"}`}>
                  {c.name}
                </span>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Boletins EBC ─────────────────────────────────────────────────────────────

const EBC_CATEGORIES = [
  { id: "saude", label: "Saúde" },
  { id: "esportes", label: "Esportes" },
  { id: "cultura", label: "Cultura & Lazer" },
  { id: "educacao", label: "Educação" },
  { id: "economia", label: "Economia" },
  { id: "meio-ambiente", label: "Meio Ambiente" },
  { id: "inovacao", label: "Inovação" },
  { id: "direitos-humanos", label: "Direitos Humanos" },
];

interface NoticiasCardProps {
  selectedCategories: Set<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onClose: () => void;
  loading?: boolean;
}

function NoticiasCard({ selectedCategories, onToggle, onToggleAll, onClose, loading }: NoticiasCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const allSelected = EBC_CATEGORIES.every((c) => selectedCategories.has(c.id));

  return (
    <div ref={cardRef}
      className="absolute left-0 top-full mt-2 z-50 w-52 bg-card border border-blue-500/30 rounded-xl shadow-2xl flex flex-col overflow-hidden">

      {/* Header fixo */}
      <div className="flex items-center gap-1.5 px-3 py-2 bg-blue-500/10 border-b border-blue-500/20 shrink-0">
        <Newspaper className="h-3.5 w-3.5 text-blue-400 shrink-0" />
        <span className="text-xs font-semibold flex-1 truncate text-blue-300">Notícias do Dia</span>
        {loading && <Loader2 className="h-3 w-3 text-blue-400 animate-spin shrink-0" />}
        {!loading && selectedCategories.size > 0 && (
          <span className="text-[10px] text-blue-400 font-bold shrink-0">{selectedCategories.size}</span>
        )}
      </div>

      {/* "Todas" — altura fixa */}
      <div className="px-3 py-1.5 shrink-0">
        <label className="flex items-center gap-1.5 cursor-pointer text-[10px] text-muted-foreground/60 hover:text-foreground transition-colors">
          <input type="checkbox" checked={allSelected} onChange={onToggleAll} className="w-3 h-3 accent-blue-500" />
          Todas as categorias
        </label>
      </div>

      {/* Lista fixa — altura máxima fixa, scroll interno */}
      <div className="overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden h-[168px]">
        {EBC_CATEGORIES.map((cat) => (
          <div key={cat.id} onClick={() => onToggle(cat.id)}
            className="flex items-center gap-2 px-3 py-1.5 cursor-pointer hover:bg-blue-500/5 transition-colors">
            <input type="checkbox" title={cat.label} checked={selectedCategories.has(cat.id)} onChange={() => onToggle(cat.id)}
              className="w-3 h-3 accent-blue-500 shrink-0" onClick={(e) => e.stopPropagation()} />
            <span className={`text-[10px] flex-1 ${selectedCategories.has(cat.id) ? "text-blue-300 font-medium" : "text-muted-foreground"}`}>
              {cat.label}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface SpotsPanelProps {
  userId?: string | null;
  isAdmin?: boolean;
  isLocked?: boolean;
  isUploadLocked?: boolean;
  onPlaySpot?: (spot: { id: string; title: string; file_path: string; genre: string }) => void;
}

const SpotsPanel = ({ userId: propUserId, isAdmin = false, isLocked = false, isUploadLocked = false, onPlaySpot }: SpotsPanelProps) => {
  const { consumeFeature, isFeatureLocked } = useClientFeatures();
  const { prefs, loaded: prefsLoaded, updatePref } = useUserPreferences();
  // Badge de upgrade — aparece ao tentar salvar com plano bloqueado
  const [lockedBadge, setLockedBadge] = useState(false);
  const lockedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showLockedBadge = () => {
    setLockedBadge(true);
    if (lockedTimerRef.current) clearTimeout(lockedTimerRef.current);
    lockedTimerRef.current = setTimeout(() => setLockedBadge(false), 3000);
  };
  // Guard: intercepta qualquer ação de save quando isLocked
  const guardSave = (fn: () => void) => () => {
    if (isLocked) { showLockedBadge(); return; }
    fn();
  };

  const [settings, setSettings] = useState<SpotSettings>(() => getSpotSettings());
  const [spots, setSpots] = useState<Spot[]>([]);
  const [configs, setConfigs] = useState<SpotConfigMap>({});
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
  const [search, setSearch] = useState("");

  // notícias EBC
  const [showNoticias, setShowNoticias] = useState(false);
  const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
  const [newsInterval, setNewsInterval] = useState<number>(3);
  const [fetchingNoticias, setFetchingNoticias] = useState(false);

  // spot sendo pré-visualizado no player (preview toggle)
  const [previewingId, setPreviewingId] = useState<string | null>(null);

  // seleção em lote de spots (checkboxes nos rows)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // distribuição para clientes
  const [broadcasting, setBroadcasting] = useState(false);
  const [showDistribuir, setShowDistribuir] = useState(false);
  const [clients, setClients] = useState<Client[]>([]);
  const [loadingClients, setLoadingClients] = useState(false);
  const [distributionClients, setDistributionClients] = useState<Set<string>>(new Set());

  const tokenRef = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(propUserId ?? null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const newsIntervalRowRef = useRef<HTMLDivElement>(null);

  // Hydrate boletins/news prefs from Supabase when loaded
  useEffect(() => {
    if (!prefsLoaded) return;
    const cats = prefs.boletins_categories ?? [];
    setSelectedCategories(new Set(cats));
    setNewsInterval(prefs.news_interval ?? 3);
  }, [prefsLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Dialog de confirmação personalizado
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    message: string;
    onConfirm: () => void;
  }>({ open: false, message: "", onConfirm: () => {} });

  const showConfirm = (message: string, onConfirm: () => void) => {
    setConfirmDialog({ open: true, message, onConfirm });
  };

  // ── Init — carrega token, spots, configs e settings do banco ──────────────

  useEffect(() => {
    const storeToken = useSessionStore.getState().token;
    const storeUser = useSessionStore.getState().user;
    const token = storeToken ?? null;
    const uid = storeUser?.id ?? null;
    tokenRef.current = token;
    if (uid) userIdRef.current = uid;

    if (!token) { setLoading(false); return; }

    // Carrega tudo em paralelo do banco
    Promise.all([
      loadSpotSettings(token),
      fetchSpotConfigs(token),
    ]).then(([fetchedSettings, fetchedConfigs]) => {
      setSettings(fetchedSettings);
      setConfigs(fetchedConfigs);
      return loadSpots(token);
    });

    const onCfgChange = () => setConfigs({ ...loadSpotConfigs() });
    const onSpotsChanged = () => { if (tokenRef.current) loadSpots(tokenRef.current); };
    window.addEventListener("spot-configs-changed", onCfgChange);
    window.addEventListener("spots-changed", onSpotsChanged);
    return () => {
      window.removeEventListener("spot-configs-changed", onCfgChange);
      window.removeEventListener("spots-changed", onSpotsChanged);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync userId se o pai resolver depois
  useEffect(() => {
    if (!propUserId || propUserId === userIdRef.current) return;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(propUserId)) return;
    userIdRef.current = propUserId;
    if (tokenRef.current) loadSpots(tokenRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propUserId]);

  const loadSpots = async (token: string) => {
    try {
      const res = await fetch("/api/spots", {
        headers: { authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      setSpots(json.spots ?? []);
    } catch (err: any) {
      toast.error(`Erro ao carregar spots: ${err?.message}`);
    } finally {
      setLoading(false);
    }
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;

    if (isUploadLocked) { showLockedBadge(); if (fileInputRef.current) fileInputRef.current.value = ""; return; }

    const token = tokenRef.current;
    if (!token) { toast.error("Sessão expirada. Recarregue a página."); return; }

    const isValid = (f: File) => /\.(mp3|wav|ogg|m4a|aac|flac|opus)$/i.test(f.name) || f.type.startsWith("audio/");
    const invalid = files.filter((f) => !isValid(f));
    if (invalid.length) toast.error(`${invalid.length} arquivo(s) inválido(s).`);
    const valid = files.filter(isValid);
    if (!valid.length) return;

    // Se há clientes selecionados para distribuição → envia para eles via broadcast
    if (isAdmin && distributionClients.size > 0) {
      setBroadcasting(true);
      setUploading(true);
      setUploadProgress({ done: 0, total: valid.length });
      let ok = 0, fail = 0;
      for (let i = 0; i < valid.length; i++) {
        const file = valid[i];
        try {
          const form = new FormData();
          form.append("file", file);
          form.append("title", file.name.replace(/\.[^.]+$/, ""));
          form.append("targetUserIds", JSON.stringify(Array.from(distributionClients)));
          const res = await fetch("/api/admin/broadcast-spot", {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            body: form,
          });
          const json = await res.json();
          if (!res.ok) throw new Error(json.error ?? "Erro");
          ok += json.ok ?? 1;
          fail += json.fail ?? 0;
        } catch (err: any) {
          fail++;
          toast.error(`Erro: ${err?.message}`);
        }
        setUploadProgress({ done: i + 1, total: valid.length });
      }
      if (ok > 0) toast.success(`${valid.length} spot${valid.length !== 1 ? "s" : ""} enviado${valid.length !== 1 ? "s" : ""} para ${distributionClients.size} cliente${distributionClients.size !== 1 ? "s" : ""}.`);
      if (fail > 0) toast.error(`${fail} envio${fail !== 1 ? "s" : ""} falharam.`);
      setBroadcasting(false);
      setUploading(false);
      setUploadProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    // Upload normal para a própria biblioteca
    setUploading(true);
    setUploadProgress({ done: 0, total: valid.length });
    let ok = 0, fail = 0;

    const readDuration = async (f: File): Promise<number> => new Promise((resolve) => {
      const url = URL.createObjectURL(f);
      const a = new Audio(url);
      const cleanup = () => { try { URL.revokeObjectURL(url); } catch {} };
      a.addEventListener("loadedmetadata", () => {
        const d = a.duration;
        cleanup();
        resolve(Number.isFinite(d) && d > 0 ? Math.round(d) : 0);
      }, { once: true });
      a.addEventListener("error", () => { cleanup(); resolve(0); }, { once: true });
      setTimeout(() => { cleanup(); resolve(0); }, 5000);
    });

    for (let i = 0; i < valid.length; i++) {
      const file = valid[i];
      try {
        const title = file.name.replace(/\.[^.]+$/, "");
        const duration = await readDuration(file);
        const form = new FormData();
        form.append("file", file);
        form.append("title", title);
        if (duration > 0) form.append("duration", String(duration));
        const res = await fetch("/api/spots", {
          method: "POST",
          headers: { authorization: `Bearer ${token}` },
          body: form,
        });
        if (!res.ok) throw new Error((await res.json()).error ?? "Erro no servidor");
        ok++;
      } catch (err: any) {
        fail++;
        toast.error(`Erro no upload: ${err?.message}`);
      }
      setUploadProgress({ done: i + 1, total: valid.length });
    }

    invalidateSpotsCache();
    if (ok > 0) {
      toast.success(`${ok} spot${ok !== 1 ? "s" : ""} enviado${ok !== 1 ? "s" : ""}.`);
    }
    if (fail > 0) toast.error(`${fail} falhou no envio.`);

    setUploading(false);
    setUploadProgress(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    await loadSpots(token);
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  const deleteSpots = (ids: string[]) => {
    const token = tokenRef.current;
    if (!token) return;
    const label = ids.length === 1 ? "este anúncio" : `${ids.length} anúncios`;
    showConfirm(`Excluir ${label}? Esta ação não pode ser desfeita.`, async () => {
      for (const id of ids) {
        try {
          await fetch("/api/spots", {
            method: "DELETE",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({ id }),
          });
          removeSpotConfig(id);
        } catch { toast.error("Erro ao excluir."); }
      }
      invalidateSpotsCache();
      setSpots((prev) => prev.filter((s) => !ids.includes(s.id)));
      setSelectedIds((prev) => { const next = new Set(prev); ids.forEach((id) => next.delete(id)); return next; });
      toast.success(`${ids.length === 1 ? "Anúncio excluído." : `${ids.length} anúncios excluídos.`}`);
    });
  };

  // ── Rename ────────────────────────────────────────────────────────────────

  const handleRename = async (spot: Spot, newTitle: string) => {
    const token = tokenRef.current;
    if (!token) return;
    const targets = selectedIds.has(spot.id) && selectedIds.size > 1
      ? Array.from(selectedIds)
      : [spot.id];
    try {
      await Promise.all(targets.map((id) =>
        fetch("/api/spots", {
          method: "PATCH",
          headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
          body: JSON.stringify({ id, title: newTitle }),
        })
      ));
      setSpots((prev) => prev.map((s) => targets.includes(s.id) ? { ...s, title: newTitle } : s));
      invalidateSpotsCache();
      toast.success(targets.length > 1 ? `${targets.length} spots renomeados.` : "Renomeado.");
    } catch { toast.error("Erro ao renomear."); }
  };

  // ── Config change — salva no banco ────────────────────────────────────────

  const handleConfigChange = async (id: string, patch: Partial<SpotConfig>) => {
    if (isLocked) { showLockedBadge(); return; }
    // Verifica crédito de programar_spots quando agenda
    if (patch.scheduleStart && !isAdmin) {
      if (isFeatureLocked("programar_spots")) { toast.error("Recurso bloqueado. Atualize seu plano."); return; }
      const ok = await consumeFeature("programar_spots");
      if (!ok) return;
    }
    const token = tokenRef.current;
    if (!token) return;

    // Se este spot está selecionado junto com outros → aplica em todos os selecionados
    const targets = selectedIds.has(id) && selectedIds.size > 1
      ? Array.from(selectedIds)
      : [id];

    setConfigs((prev) => {
      const updated = { ...prev };
      targets.forEach((tid) => {
        updated[tid] = { ...(updated[tid] ?? DEFAULT_SPOT_CONFIG), ...patch };
      });
      setCachedSpotConfigs(updated);
      return updated;
    });

    // NÃO invalida o cache de spots aqui — só configs mudaram, os arquivos são os mesmos
    await Promise.all(targets.map((tid) => saveSpotConfig(tid, patch, token)));

    if (patch.enabled === true && !settings.enabled) {
      const next: SpotSettings = { ...settings, enabled: true };
      setSettings(next);
      await saveSpotSettings(next, token);
    }

    if (targets.length > 1) {
      toast.success(`Configuração aplicada em ${targets.length} spots.`);
    } else if (patch.scheduleStart !== undefined) {
      if (patch.scheduleStart) {
        toast.success("Programado — será ativado automaticamente na data definida.");
      } else {
        toast.success("Programação removida — spot toca sempre que estiver ativo.");
      }
    } else if (patch.enabled === true) {
      toast.success("Spot ativado.");
    } else if (patch.enabled === false) {
      toast.success("Spot pausado.");
    }
  };

  // ── Distribuir: carrega lista de clientes ────────────────────────────────

  const openDistribuir = async () => {
    setShowDistribuir((v) => !v);
    if (clients.length > 0) return; // já carregou
    const token = tokenRef.current;
    if (!token) return;
    setLoadingClients(true);
    try {
      const res = await fetch("/api/admin/list-clients", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({}),
      });
      const json = await res.json();
      const adminIds = new Set(
        (json.roles ?? []).filter((r: any) => r.role === "admin").map((r: any) => r.user_id)
      );
      const list: Client[] = (json.clients ?? [])
        .filter((c: any) => !adminIds.has(c.id))
        .map((c: any) => ({ id: c.id, name: c.nome || c.username || c.email?.split("@")[0] || c.id.slice(0, 8) }));
      setClients(list);
    } catch {
      toast.error("Erro ao carregar clientes.");
    } finally {
      setLoadingClients(false);
    }
  };

  // ── Settings ──────────────────────────────────────────────────────────────

  const handleToggleEnabled = useCallback(async () => {
    const token = tokenRef.current;
    if (!token) return;
    const next: SpotSettings = { ...settings, enabled: !settings.enabled };
    setSettings(next);
    await saveSpotSettings(next, token);
    toast.success(next.enabled ? "Spots ativados." : "Spots desativados.");
  }, [settings]);

  const handleIntervalChange = async (n: number) => {
    if (isLocked) { showLockedBadge(); return; }
    const token = tokenRef.current;
    if (!token) return;
    // Ativar spots automaticamente ao definir intervalo
    const next: SpotSettings = { enabled: true, interval: n };
    setSettings(next);
    await saveSpotSettings(next, token);
  };

  // ── Notícias EBC — fetch automático ao selecionar categoria ─────────────

  const handleToggleCategory = async (id: string) => {
    const token = tokenRef.current;
    const isAdding = !selectedCategories.has(id);

    // Atualiza estado local imediatamente
    const next = new Set(selectedCategories);
    isAdding ? next.add(id) : next.delete(id);
    setSelectedCategories(next);
    updatePref("boletins_categories", Array.from(next));

    // Dispara evento para o player recarregar a fila com/sem notícias
    window.dispatchEvent(new CustomEvent("spot-settings-changed", { detail: { newsCategories: Array.from(next) } }));

    // Só busca quando está ativando uma categoria (silencioso — sem toasts)
    if (!isAdding || !token) return;

    setFetchingNoticias(true);
    try {
      await fetch("/api/boletins", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ categories: [id] }),
      });
      // Dispara novamente após o fetch para que o player pegue as notícias novas
      window.dispatchEvent(new CustomEvent("spot-settings-changed", { detail: { newsCategories: Array.from(next) } }));
    } catch {
      // silencioso
    } finally {
      setFetchingNoticias(false);
    }
  };

  const handleToggleAll = async () => {
    const token = tokenRef.current;
    const allSelected = EBC_CATEGORIES.every((c) => selectedCategories.has(c.id));

    if (allSelected) {
      // Desmarca todas
      setSelectedCategories(new Set());
      updatePref("boletins_categories", []);
      window.dispatchEvent(new Event("spot-settings-changed"));
      return;
    }

    // Marca todas e faz um único fetch com todas as categorias de uma vez
    const allIds = EBC_CATEGORIES.map((c) => c.id);
    setSelectedCategories(new Set(allIds));
    updatePref("boletins_categories", allIds);
    window.dispatchEvent(new Event("spot-settings-changed"));

    if (!token) return;
    setFetchingNoticias(true);
    try {
      await fetch("/api/boletins", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ categories: allIds }),
      });
      window.dispatchEvent(new Event("spot-settings-changed"));
    } catch {
      // silencioso
    } finally {
      setFetchingNoticias(false);
    }
  };

  const handleNewsIntervalChange = (n: number) => {
    setNewsInterval(n);
    updatePref("news_interval", n);
    window.dispatchEvent(new Event("spot-settings-changed"));
  };

  // Drag no traço azul → muda intervalo da notícia
  const handleNewsDragStart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const updateFromX = (clientX: number) => {
      const row = newsIntervalRowRef.current;
      if (!row) return;
      const rect = row.getBoundingClientRect();
      const relX = Math.max(0, Math.min(clientX - rect.left, rect.width - 1));
      const idx = Math.min(4, Math.floor((relX / rect.width) * 5));
      handleNewsIntervalChange(idx + 1);
    };
    updateFromX(e.clientX);
    const onMove = (ev: MouseEvent) => updateFromX(ev.clientX);
    const onUp = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };

  // ── Só Músicas ────────────────────────────────────────────────────────────

  const handleSoMusicas = async () => {
    if (isLocked) { showLockedBadge(); return; }
    const token = tokenRef.current;
    if (!token) return;
    const newConfigs = { ...configs };
    for (const spot of spots) {
      newConfigs[spot.id] = { ...(newConfigs[spot.id] ?? DEFAULT_SPOT_CONFIG), enabled: false };
      await saveSpotConfig(spot.id, { enabled: false }, token);
    }
    setConfigs(newConfigs);
    setCachedSpotConfigs(newConfigs);
    const next = { ...settings, enabled: false };
    setSettings(next);
    await saveSpotSettings(next, token);
    invalidateSpotsCache();
    toast.success("Só músicas ativado.");
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  const searchLower = search.toLowerCase();
  const filtered = spots.filter((s) =>
    s.title.toLowerCase().includes(searchLower) ||
    (s.owner_name?.toLowerCase().includes(searchLower) ?? false)
  );
  const enabledSpots = spots.filter((s) => (configs[s.id] ?? DEFAULT_SPOT_CONFIG).enabled);
  const scheduledCount = enabledSpots.filter((s) => configs[s.id]?.scheduleStart).length;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="w-full space-y-3 relative">

      {/* Badge de upgrade — aparece ao tentar salvar com plano bloqueado */}
      <div className={`absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none transition-all duration-300 ${lockedBadge ? "opacity-100 translate-y-0" : "opacity-0 -translate-y-1"}`}>
        <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
          <Lock className="h-3 w-3 text-primary shrink-0" />
          <p className="text-xs font-medium text-foreground">Atualize seu plano para usar esse recurso.</p>
        </div>
      </div>

      {/* ── Header ── */}
      <div className="flex items-center">
        {/* Esquerda: título */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Mic className="h-5 w-5 text-primary shrink-0" />
          <h2 className="text-base font-semibold whitespace-nowrap">Seus Anúncios</h2>
          {spots.length > 0 && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs bg-primary/20 text-primary rounded-full px-2 py-0.5">{spots.length}</span>
              <span className="text-xs bg-green-500/20 text-green-400 rounded-full px-2 py-0.5">{enabledSpots.length} ativos</span>
              {scheduledCount > 0 && <span className="text-xs bg-blue-500/20 text-blue-400 rounded-full px-2 py-0.5">{scheduledCount} agendados</span>}
            </div>
          )}
        </div>

        {/* Centro: botões de controle */}
        <div className="flex items-center gap-2 shrink-0 relative">

          {/* Botão Notícias — visível para todos */}
          <div className="relative shrink-0">
            <button type="button" onClick={() => setShowNoticias((v) => !v)}
              title="Notícias do Dia"
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors min-w-[88px] justify-center ${selectedCategories.size > 0 ? "border-blue-500/60 text-blue-300 bg-blue-500/10 hover:bg-blue-500/20" : "border-border/50 text-muted-foreground hover:text-foreground hover:border-border"}`}>
              {fetchingNoticias ? <Loader2 className="h-3 w-3 animate-spin" /> : <Newspaper className="h-3 w-3" />}
              Notícias
              <span className={`rounded-full text-[9px] font-bold w-4 h-4 flex items-center justify-center leading-none shrink-0 transition-opacity ${selectedCategories.size > 0 ? "bg-blue-500 text-white opacity-100" : "opacity-0 pointer-events-none"}`}>
                {selectedCategories.size || ""}
              </span>
            </button>
            {showNoticias && (
              <NoticiasCard
                selectedCategories={selectedCategories}
                onToggle={handleToggleCategory}
                onToggleAll={handleToggleAll}
                onClose={() => setShowNoticias(false)}
                loading={fetchingNoticias}
              />
            )}
          </div>

          {/* Intervalo: clique = spot (laranja) · arrasta traço azul = notícia */}
          <div className="flex items-center gap-1 shrink-0 bg-secondary/40 border border-border/30 rounded-lg px-2.5 py-1.5">
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">Spots a cada</span>
            <div ref={newsIntervalRowRef} className="flex gap-0.5 pb-1">
              {[1, 2, 3, 4, 5].map((n) => {
                const isSpot = Number(settings.interval) === n;
                const isNews = selectedCategories.size > 0 && newsInterval === n;
                return (
                  <div key={n} className="relative flex flex-col items-center h-6">
                    <button type="button"
                      title={`Spot a cada ${n} música${n !== 1 ? "s" : ""}`}
                      className={`w-5 h-5 rounded text-[10px] font-bold transition-colors ${isSpot ? "bg-primary text-primary-foreground" : "bg-secondary/60 text-muted-foreground hover:bg-secondary"}`}
                      onClick={() => handleIntervalChange(n)}
                    >{n}</button>
                    <span
                      className={`absolute bottom-0 left-0 right-0 h-[2px] rounded-full bg-blue-400 cursor-grab active:cursor-grabbing transition-opacity ${isNews ? "opacity-100" : "opacity-0 pointer-events-none"}`}
                      title={`Notícia a cada ${n} música${n !== 1 ? "s" : ""} — arraste para mudar`}
                      onMouseDown={isNews ? handleNewsDragStart : undefined}
                    />
                  </div>
                );
              })}
            </div>
            <span className="text-[10px] text-muted-foreground whitespace-nowrap">músicas</span>
          </div>

          {isAdmin && (
            <div className="relative shrink-0">
              <button type="button" onClick={openDistribuir} disabled={broadcasting}
                title="Selecionar destinatários para distribuição"
                className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors disabled:opacity-50 min-w-[96px] justify-center ${distributionClients.size > 0 ? "border-primary/60 text-primary bg-primary/10" : "border-yellow-500/40 text-yellow-400 hover:bg-yellow-500/10"}`}>
                {broadcasting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Key className="h-3 w-3" />}
                Distribuir
                <span className={`rounded-full text-[9px] font-bold w-4 h-4 flex items-center justify-center leading-none shrink-0 transition-opacity ${distributionClients.size > 0 ? "bg-primary text-primary-foreground opacity-100" : "opacity-0 pointer-events-none"}`}>
                  {distributionClients.size || ""}
                </span>
              </button>
              {showDistribuir && (
                <DistribuirCard
                  clients={clients}
                  loadingClients={loadingClients}
                  selectedClients={distributionClients}
                  onChange={setDistributionClients}
                  onClose={() => setShowDistribuir(false)}
                />
              )}
            </div>
          )}
          {spots.length > 0 && (
            <button type="button" onClick={handleSoMusicas}
              className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-border/60 text-muted-foreground hover:text-destructive hover:border-destructive/40 transition-colors shrink-0">
              <BanIcon className="h-3 w-3" /> Só Músicas
            </button>
          )}
        </div>

        {/* Direita: espaçador espelhado para centralizar os botões */}
        <div className="flex-1" />
      </div>

      {/* ── Biblioteca de Spots ── */}
      <div className="bg-card rounded-xl border border-border/50 overflow-hidden">
        <div className="px-4 py-2.5 bg-secondary/20 border-b border-border/30 flex items-center gap-1.5">
          <Mic className="h-3.5 w-3.5 text-primary" />
          <span className="text-xs font-semibold">Biblioteca de Anúncios</span>
          {spots.length > 0 && <span className="text-xs text-muted-foreground">({filtered.length})</span>}
          {filtered.length > 1 && (
            <label className="flex items-center gap-1 ml-auto cursor-pointer select-none text-[10px] text-muted-foreground">
              <input type="checkbox"
                checked={selectedIds.size === filtered.length}
                onChange={() => {
                  if (selectedIds.size === filtered.length) {
                    setSelectedIds(new Set());
                  } else {
                    setSelectedIds(new Set(filtered.map((s) => s.id)));
                  }
                }}
                className="w-3.5 h-3.5 accent-primary cursor-pointer" />
              Selecionar todos
            </label>
          )}
        </div>

        <div className="p-3 space-y-3">
          <input ref={fileInputRef} type="file" multiple className="hidden" aria-label="Selecionar spots"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.opus" onChange={handleUpload} />

          {/* Área de upload — visível para todos; bloqueada para cliente sem recurso */}
          {uploading ? (
            <div className="w-full border border-dashed border-primary/40 rounded-lg py-3 flex flex-col items-center justify-center gap-2">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-primary animate-spin" />
                <span className="text-sm text-primary">{uploadProgress ? `Enviando ${uploadProgress.done}/${uploadProgress.total}…` : "Enviando…"}</span>
              </div>
              {uploadProgress && uploadProgress.total > 1 && (
                <div className="w-full h-1 bg-secondary rounded-full overflow-hidden px-4">
                  <div className="h-full bg-primary rounded-full transition-all"
                    ref={(el) => { if (el) el.style.width = `${(uploadProgress.done / uploadProgress.total) * 100}%`; }} />
                </div>
              )}
            </div>
          ) : !isAdmin && isUploadLocked ? (
            <div className="w-full border border-dashed border-border/30 rounded-lg py-4 flex flex-col items-center justify-center gap-1.5 opacity-50 cursor-not-allowed">
              <Lock className="h-5 w-5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Atualize seu plano para enviar spots</span>
            </div>
          ) : (
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className={`w-full border border-dashed rounded-lg py-4 flex flex-col items-center justify-center gap-1.5 transition-colors group ${isAdmin && distributionClients.size > 0 ? "border-primary/50 bg-primary/5 hover:bg-primary/10" : "border-border/40 hover:border-primary/50"}`}>
              <Upload className={`h-5 w-5 transition-colors ${isAdmin && distributionClients.size > 0 ? "text-primary" : "text-muted-foreground group-hover:text-primary"}`} />
              <span className={`text-xs transition-colors ${isAdmin && distributionClients.size > 0 ? "text-primary font-medium" : "text-muted-foreground group-hover:text-primary"}`}>
                {isAdmin && distributionClients.size > 0
                  ? `Enviar para ${distributionClients.size} cliente${distributionClients.size !== 1 ? "s" : ""}`
                  : "Clique para adicionar spots"}
              </span>
            </button>
          )}

          {spots.length > 0 && (
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar"
                className="pl-8 h-8 text-sm bg-secondary/50" />
            </div>
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
            <div className="space-y-3 max-h-[700px] overflow-y-auto pr-0.5">
              {filtered.map((spot) => (
                <SpotRow key={spot.id} spot={spot}
                  cfg={configs[spot.id] ?? DEFAULT_SPOT_CONFIG}
                  isSelected={selectedIds.has(spot.id)}
                  showOwner
                  onToggleSelect={() => setSelectedIds((prev) => {
                    const next = new Set(prev);
                    if (next.has(spot.id)) next.delete(spot.id); else next.add(spot.id);
                    return next;
                  })}
                  isPreviewing={previewingId === spot.id}
                  onPlaySpot={() => {
                    if (previewingId === spot.id) {
                      setPreviewingId(null);
                      onPlaySpot?.({ id: "__stop__", title: "", file_path: "", genre: "stop" });
                    } else {
                      setPreviewingId(spot.id);
                      onPlaySpot?.({ id: spot.id, title: spot.title, file_path: spot.file_path, genre: "spot" });
                    }
                  }}
                  onDelete={() => deleteSpots(selectedIds.has(spot.id) && selectedIds.size > 1 ? Array.from(selectedIds) : [spot.id])}
                  onConfigChange={(patch) => handleConfigChange(spot.id, patch)}
                  onRename={(t) => handleRename(spot, t)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Dialog de confirmação ── */}
      <Dialog
        open={confirmDialog.open}
        onOpenChange={(open) => !open && setConfirmDialog((d) => ({ ...d, open: false }))}
      >
        <DialogContent className="max-w-sm bg-card border border-destructive/30 shadow-2xl rounded-2xl p-0 overflow-hidden">
          <div className="px-6 pt-6 pb-2">
            <DialogHeader>
              <div className="flex items-center gap-3 mb-1">
                <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center shrink-0">
                  <Trash2 className="h-4 w-4 text-destructive" />
                </div>
                <DialogTitle className="text-base font-semibold">Confirmar exclusão</DialogTitle>
              </div>
              <DialogDescription className="text-sm text-muted-foreground leading-relaxed pl-12">
                {confirmDialog.message}
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="flex gap-2 px-6 pb-5 pt-3">
            <button
              type="button"
              onClick={() => setConfirmDialog((d) => ({ ...d, open: false }))}
              className="flex-1 h-9 rounded-lg border border-border/60 text-sm text-muted-foreground hover:text-foreground hover:border-border transition-colors"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmDialog((d) => ({ ...d, open: false }));
                confirmDialog.onConfirm();
              }}
              className="flex-1 h-9 rounded-lg bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 transition-colors"
            >
              Excluir
            </button>
          </div>
        </DialogContent>
      </Dialog>

    </div>
  );
};

export default SpotsPanel;
