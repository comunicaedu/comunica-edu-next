"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  Users, Search, UserPlus, ShieldAlert, ShieldCheck,
  ChevronDown, ChevronRight, Link2, Copy, Check,
  Loader2, Lock, Unlock, Settings2, Crown, Pencil, Save, X, Camera, KeyRound, Move,
  Mail, Phone, Clock, User, Building2, Activity, UsersRound, Upload,
  UserPlus2, Eye, EyeOff, ImagePlus, ExternalLink, LogIn, Trash2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { useServicePlans } from "@/hooks/useServicePlans";
import { useToast } from "@/hooks/use-toast";
import { useUserPreferences } from "@/hooks/useUserPreferences";
import { supabase } from "@/lib/supabase/client";
import ManualClientForm from "./ManualClientForm";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";
import { authedFetch } from "@/lib/authedFetch";
import { useSessionStore } from "@/stores/sessionStore";
import { invalidateAllCaches } from "@/lib/spotIntercalate";

interface ClientProfile {
  id: string;
  user_id: string;
  nome: string | null;
  email: string | null;
  email_contato: string | null;
  telefone: string | null;
  status: string;
  blocked_at: string | null;
  created_at: string;
  avatar_url: string | null;
  cidade: string | null;
  username: string | null;
  last_seen: string | null;
}

interface FeatureRecord {
  user_id: string;
  feature_key: string;
  enabled: boolean;
  limit_value?: number | null;
}

interface RoleRecord {
  user_id: string;
  role: string;
}

interface ActivityRecord {
  id: string;
  activity_type: string;
  song_id: string | null;
  genre: string | null;
  artist: string | null;
  search_query: string | null;
  created_at: string;
}

import { ALL_CLIENT_FEATURES } from "@/hooks/useClientFeatures";

/* Recursos liberados por cliente — ON/OFF puro (Fase 1) */
const CLIENT_TOGGLES = [
  { key: "criar_playlists",     label: "Criar Playlists" },
  { key: "excluir_playlists",   label: "Excluir Playlists" },
  { key: "locutor_virtual",     label: "Locutor Virtual" },
  { key: "importar_playlists",  label: "Importar Playlists" },
  { key: "spots_profissionais", label: "Spots Profissionais" },
  { key: "enviar_spots",        label: "Enviar Spots" },
  { key: "enviar_musicas",      label: "Enviar Músicas" },
  { key: "locutor_ao_vivo",     label: "Locutor ao Vivo" },
  { key: "programar_playlists", label: "Programar Playlists" },
  { key: "programar_spots",     label: "Programar Spots" },
  { key: "modo_offline",        label: "Modo Offline" },
  { key: "programar_play",      label: "Programar o Play" },
  { key: "acesso_remoto",       label: "Acesso Remoto" },
  { key: "favoritar_playlists", label: "Favoritar Playlists" },
  { key: "curtir_musicas",      label: "Curtir Músicas" },
  { key: "excluir_musicas",     label: "Excluir Músicas" },
  { key: "programar_musica",    label: "Programar Música" },
  { key: "editar_playlist",     label: "Editar Playlist" },
  { key: "alterar_capa",        label: "Alterar Capa" },
  { key: "player_espelho",      label: "Players Espelho" },
  { key: "player_independente", label: "Players Independentes" },
];

const isValidUuid = (value: string | null | undefined): value is string => {
  if (!value) return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
};

const OWNER_LOCAL_AVATAR_ID = "owner-local";

const isSessionError = (err: unknown) => {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  const normalized = message.toLowerCase();
  return normalized.includes("auth session missing") || normalized.includes("unauthorized");
};

/* ─── Module-level avatar button — stable identity, never flickers ─── */
interface ClientAvatarButtonProps {
  avatarUrl: string | null;
  avatarId?: string;
  large?: boolean;
  disabled?: boolean;
  isUploading: boolean;
  isRepositioning: boolean;
  savedStyle?: { zoom: number; x: number; y: number };
  avatarZoom: number;
  avatarTempOffset: { x: number; y: number };
  onOpenFilePicker: () => void;
  onFileDrop: (file: File) => void;
  onStartReposition: (e: React.MouseEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: () => void;
  onDragStart: (e: React.PointerEvent) => void;
  onZoomChange: (value: number[]) => void;
  onZoomAdjust: (delta: number) => void;
  zoomMin: number;
  zoomMax: number;
}

const ClientAvatarButton = ({
  avatarUrl, avatarId, large = false, disabled = false,
  isUploading, isRepositioning,
  savedStyle, avatarZoom, avatarTempOffset,
  onOpenFilePicker, onFileDrop,
  onStartReposition, onDragMove, onDragEnd, onDragStart,
  onZoomChange, onZoomAdjust, zoomMin, zoomMax,
}: ClientAvatarButtonProps) => {
  const sz = large ? "h-24 w-24" : "h-10 w-10";

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file && file.type.startsWith("image/")) onFileDrop(file);
  };

  return (
    <div
      {...(avatarId ? { "data-avatar-id": avatarId } : {})}
      className={`relative group shrink-0 pointer-events-auto ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"}`}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={disabled || isRepositioning ? undefined : onOpenFilePicker}
      onDragOver={(e) => { if (!disabled) e.preventDefault(); }}
      onDrop={disabled ? undefined : handleDrop}
    >
      {/* Avatar circle */}
      <div
        className={`${sz} rounded-full overflow-hidden border-2 ${isRepositioning ? "border-primary" : "border-primary/60"} shadow-lg bg-muted`}
        onPointerMove={isRepositioning ? onDragMove : undefined}
        onPointerUp={isRepositioning ? onDragEnd : undefined}
        onPointerCancel={isRepositioning ? onDragEnd : undefined}
        onPointerLeave={isRepositioning ? onDragEnd : undefined}
      >
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="w-full h-full object-cover select-none"
            style={{
              transform: isRepositioning
                ? `translate(${avatarTempOffset.x}px, ${avatarTempOffset.y}px) scale(${avatarZoom})`
                : savedStyle
                  ? `translate(${savedStyle.x}px, ${savedStyle.y}px) scale(${savedStyle.zoom})`
                  : "scale(1.1)",
              cursor: isRepositioning ? "grab" : undefined,
              transition: isRepositioning ? "none" : "transform 0.3s ease",
            }}
            draggable={false}
            onPointerDown={isRepositioning ? onDragStart : undefined}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <Camera className={`${large ? "h-8 w-8" : "h-4 w-4"} text-muted-foreground`} />
          </div>
        )}
      </div>

      {/* Hover overlay with actions */}
      {!isRepositioning && (
        <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-all duration-200 opacity-0 group-hover:opacity-100">
          <div className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
            {isUploading ? (
              <div className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center">
                <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <>
                <button
                  type="button"
                  className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                  onClick={(e) => { e.stopPropagation(); e.preventDefault(); onOpenFilePicker(); }}
                  title="Trocar foto"
                >
                  <Camera className="h-3 w-3" />
                </button>
                {avatarUrl && large && (
                  <button
                    type="button"
                    className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                    onClick={(e) => { e.stopPropagation(); onStartReposition(e); }}
                    title="Mover e ajustar foto"
                  >
                    <Pencil className="h-3 w-3" />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Zoom controls when repositioning */}
      {isRepositioning && large && (
        <div className="absolute inset-0 border-2 border-primary/50 rounded-full overflow-hidden pointer-events-none">
          <div
            className="absolute bottom-1 left-1.5 right-1.5 pointer-events-auto"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <div className="bg-background/90 backdrop-blur-sm rounded-full px-1.5 py-1 flex items-center gap-1">
              <button type="button"
                className="h-5 w-5 rounded-full bg-muted text-foreground text-xs leading-none hover:bg-muted/80 transition-colors"
                onClick={(e) => { e.stopPropagation(); onZoomAdjust(-0.02); }}
                title="Diminuir zoom"
              >−</button>
              <Slider
                min={zoomMin} max={zoomMax} step={0.005}
                value={[avatarZoom]}
                onValueChange={onZoomChange}
                className="flex-1 touch-none [&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5 [&_[role=slider]]:border-primary [&_.relative]:h-1.5"
              />
              <button type="button"
                className="h-5 w-5 rounded-full bg-muted text-foreground text-xs leading-none hover:bg-muted/80 transition-colors"
                onClick={(e) => { e.stopPropagation(); onZoomAdjust(0.02); }}
                title="Aumentar zoom"
              >+</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const ClientManagement = () => {
  const router = useRouter();
  const { prefs, loaded: prefsLoaded, updatePref } = useUserPreferences();
  const [enteringProfile, setEnteringProfile] = useState<string | null>(null);
  const [editingClientField, setEditingClientField] = useState<{ userId: string; field: "username" | "password" } | null>(null);
  const [clientFieldDraft, setClientFieldDraft] = useState("");
  const [showClientField, setShowClientField] = useState(false);
  const [savingClientField, setSavingClientField] = useState(false);
  const [expandedFeature, setExpandedFeature] = useState<{ userId: string; featureKey: string } | null>(null);
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");

  const [showNewClient, setShowNewClient] = useState(false);
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [featureMap, setFeatureMap] = useState<Record<string, Record<string, boolean>>>({});
  const [limitMap, setLimitMap] = useState<Record<string, Record<string, number>>>({});
  const [togglingFeature, setTogglingFeature] = useState<string | null>(null);
  const [featureSearch, setFeatureSearch] = useState<Record<string, string>>({});
  const [unlockedAll, setUnlockedAll] = useState<Set<string>>(new Set());
  const preUnlockSnapshot = useRef<Record<string, { features: Record<string, boolean>; limits: Record<string, number> }>>({});
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set());
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ nome: string; email: string; email_contato: string; telefone: string; cidade: string }>({ nome: "", email: "", email_contato: "", telefone: "", cidade: "" });
  const [deletingClient, setDeletingClient] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState<string | null>(null);
  const sharedAvatarInputRef = useRef<HTMLInputElement>(null);
  const pendingAvatarIdRef = useRef<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showUsername, setShowUsername] = useState(false);
  const [editingOwnerName, setEditingOwnerName] = useState(false);
  const [ownerNameDraft, setOwnerNameDraft] = useState("");
  const [editingOwnerUsername, setEditingOwnerUsername] = useState(false);
  const [ownerUsernameDraft, setOwnerUsernameDraft] = useState("");
  const [ownerUsername, setOwnerUsername] = useState<string | null>(null);
  // Inicia null — o useEffect vai buscar o valor real do banco e evita mostrar cache corrompido
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [clientActivity, setClientActivity] = useState<Record<string, ActivityRecord[]>>({});
  const [loadingActivity, setLoadingActivity] = useState<string | null>(null);
  // Avatar reposition states (same logic as playlist covers)
  const AVATAR_ZOOM_MIN = 1;
  const AVATAR_ZOOM_MAX = 2;
  const [avatarRepositioning, setAvatarRepositioning] = useState<string | null>(null);
  const [avatarZoom, setAvatarZoom] = useState(1.1);
  const [avatarDragStart, setAvatarDragStart] = useState<{ x: number; y: number } | null>(null);
  const [avatarOffset, setAvatarOffset] = useState({ x: 0, y: 0 });
  const [avatarTempOffset, setAvatarTempOffset] = useState({ x: 0, y: 0 });
  const [savedAvatarStyles, setSavedAvatarStyles] = useState<Record<string, { zoom: number; x: number; y: number }>>(prefs.avatar_styles ?? {});
  useEffect(() => {
    if (prefsLoaded && prefs.avatar_styles) setSavedAvatarStyles(prefs.avatar_styles);
  }, [prefsLoaded, prefs.avatar_styles]);
  const normalizeZoom = useCallback((value: number) => Math.min(AVATAR_ZOOM_MAX, Math.max(AVATAR_ZOOM_MIN, value)), []);
  // Secondary admin
  const [showSecondaryAdminDialog, setShowSecondaryAdminDialog] = useState(false);
  const [secondaryAdminEmail, setSecondaryAdminEmail] = useState("");
  const [secondaryAdminUsername, setSecondaryAdminUsername] = useState("");
  const [secondaryAdminPassword, setSecondaryAdminPassword] = useState("");
  const [secondaryAdminName, setSecondaryAdminName] = useState("");
  const [secondaryAdminShowPwd, setSecondaryAdminShowPwd] = useState(false);
  const [secondaryAdminAvatarFile, setSecondaryAdminAvatarFile] = useState<File | null>(null);
  const [secondaryAdminAvatarPreview, setSecondaryAdminAvatarPreview] = useState<string | null>(null);
  const [creatingSADM, setCreatingSADM] = useState(false);
  const secondaryAdminFileRef = useRef<HTMLInputElement>(null);


  const { plans } = useServicePlans();
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      const storeState = useSessionStore.getState();
      if (!storeState.hydrated) storeState.hydrateFromSessionStorage();
      const storeUser = useSessionStore.getState().user;
      const token = useSessionStore.getState().token;
      if (!storeUser?.id || !token) return;
      // Durante impersonação não executa lógica de avatar — preserva identidade do admin
      if (sessionStorage.getItem("edu-admin-return-session")) return;

      const adminId = storeUser.id;
      setCurrentUserId(adminId);
      setCurrentUserEmail(storeUser.email ?? null);

      const STORAGE_PATH = "/storage/v1/object/public/avatars/";

      // Avatar: cache do servidor primeiro, depois banco como fallback
      let resolvedUrl: string | null = null;
      try {
        const cacheRes = await authedFetch("/api/owner-avatar");
        const cacheJson = await cacheRes.json();
        const cacheUrl: string | null = cacheJson?.avatar_url ?? null;
        if (cacheUrl && cacheUrl.includes(STORAGE_PATH)) {
          resolvedUrl = cacheUrl;
        }
      } catch { /* silencioso */ }
      if (!resolvedUrl) {
        const { data: avatarProfile } = await supabase
          .from("profiles")
          .select("avatar_url")
          .eq("user_id", adminId)
          .maybeSingle();
        const dbAvatar = avatarProfile?.avatar_url;
        if (dbAvatar && dbAvatar.includes(STORAGE_PATH)) {
          resolvedUrl = dbAvatar;
        }
      }

      if (resolvedUrl) {
        setOwnerAvatarUrl(resolvedUrl);
        supabase.from("profiles").update({ avatar_url: resolvedUrl }).eq("user_id", adminId);
      }

      // Username: localStorage + DB
      const localUsername = localStorage.getItem("edu-username");
      const { data: prof } = await supabase
        .from("profiles")
        .select("username")
        .eq("user_id", adminId)
        .maybeSingle();
      const usernameResult = prof?.username || localUsername || null;

      if (usernameResult) {
        setOwnerUsername(usernameResult);
        localStorage.setItem("edu-username", usernameResult);
      }

      // Garante que o auth email está no formato username@comunicaedu.app
      const expectedEmail = usernameResult ? `${usernameResult}@comunicaedu.app` : null;
      if (expectedEmail && storeUser.email !== expectedEmail) {
        authedFetch("/api/auth/link-username", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: usernameResult }),
        });
      }
    })();
  }, []);

  const fetchClients = useCallback(async (scrollToUserId?: string) => {
    const storeToken = useSessionStore.getState().token;
    const storeHydrated = useSessionStore.getState().hydrated;
    if (!storeHydrated || !storeToken) return;

    setLoading(true);
    try {
      const res = await authedFetch("/api/admin/list-clients", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();

      if (!res.ok || data?.error) {
        const errMsg = data?.error || `HTTP ${res.status}`;
        console.error("list-clients error:", errMsg);
        toast({ title: `Erro ao carregar clientes: ${errMsg}`, variant: "destructive" });
        setLoading(false);
        return;
      }

      if (data?.clients) {
        const adminId = useSessionStore.getState().user?.id;
        const STORAGE_PATH = "/storage/v1/object/public/avatars/";
        const clientsWithAvatars = (data.clients as ClientProfile[]).map((c) => {
          if (c.user_id === adminId) {
            // Admin: descarta URLs inválidas (YouTube, etc.) — usa só o que vem do banco
            const validAvatar = c.avatar_url?.includes(STORAGE_PATH) ? c.avatar_url : null;
            return { ...c, avatar_url: validAvatar };
          }
          // Lógica igual ao código antigo: banco é a fonte de verdade, sem cache localStorage
          const validAvatar = c.avatar_url?.includes(STORAGE_PATH) ? c.avatar_url : null;
          return { ...c, avatar_url: validAvatar };
        });
        setClients(clientsWithAvatars);
      }
      if (data?.features) {
        const map: Record<string, Record<string, boolean>> = {};
        const lmap: Record<string, Record<string, number>> = {};
        (data.features as FeatureRecord[]).forEach((f) => {
          if (!map[f.user_id]) map[f.user_id] = {};
          if (!lmap[f.user_id]) lmap[f.user_id] = {};
          map[f.user_id][f.feature_key] = f.enabled;
          if (f.limit_value != null) lmap[f.user_id][f.feature_key] = f.limit_value;
        });
        setFeatureMap(map);
        setLimitMap(lmap);
      }
      if (data?.roles) {
        const admins = new Set<string>();
        (data.roles as RoleRecord[]).forEach((r) => {
          if (r.role === "admin") admins.add(r.user_id);
        });
        setAdminUserIds(admins);
      }

      // Rola até o card do cliente recém-criado
      if (scrollToUserId) {
        setTimeout(() => {
          const el = document.getElementById(`client-card-${scrollToUserId}`);
          if (el) {
            el.scrollIntoView({ behavior: "smooth", block: "start" });
            // Destaca o card brevemente
            el.style.outline = "2px solid hsl(var(--primary))";
            setTimeout(() => { el.style.outline = ""; }, 2000);
          }
        }, 500);
      }
    } catch (err) {
      console.error("Error fetching clients:", err);
      toast({ title: "Erro ao carregar clientes", variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  const storeHydrated = useSessionStore(s => s.hydrated);
  const storeToken = useSessionStore(s => s.token);
  useEffect(() => { fetchClients(); }, [fetchClients, storeHydrated, storeToken]);


  const isFeatureEnabled = (userId: string, featureKey: string): boolean => {
    return featureMap[userId]?.[featureKey] === true;
  };

  const getFeatureLimit = (userId: string, featureKey: string, _defaultLimit: number): number => {
    return limitMap[userId]?.[featureKey] ?? 0;
  };

  /** Salva TODAS as features de um usuário via API (usa service_role, bypassa RLS) */
  const saveAllFeaturesViaApi = async (targetUserId: string, featFlags: Record<string, boolean>, limFlags: Record<string, number | null>) => {
    const features = CLIENT_TOGGLES.map(f => ({
      feature_key: f.key,
      enabled: featFlags[f.key] ?? false,
      limit_value: limFlags[f.key] ?? null,
    }));
    const res = await authedFetch("/api/admin/save-client-features", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: targetUserId, features }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Erro ao salvar");
  };

  const handleSaveLimit = async (userId: string, featureKey: string, limitValue: number) => {
    try {
      const newFeats = { ...(featureMap[userId] ?? {}) };
      CLIENT_TOGGLES.forEach(f => { if (newFeats[f.key] === undefined) newFeats[f.key] = false; });
      const newLimits: Record<string, number | null> = { ...(limitMap[userId] ?? {}), [featureKey]: limitValue };
      await saveAllFeaturesViaApi(userId, newFeats, newLimits);
      setLimitMap(prev => ({ ...prev, [userId]: { ...prev[userId], [featureKey]: limitValue } }));
      toast({ title: "Limite salvo com sucesso." });
    } catch (e: any) {
      toast({ title: e?.message || "Erro ao salvar limite", variant: "destructive" });
    }
  };

  const [savingFeatureFor, setSavingFeatureFor] = useState<string | null>(null);

  const handleUnlockAll = async (userId: string) => {
    const isUnlocked = unlockedAll.has(userId);
    setSavingFeatureFor(userId);

    if (isUnlocked) {
      // REVERTER: desliga TUDO
      try {
        const allDisabled: Record<string, boolean> = {};
        const allNull: Record<string, number | null> = {};
        CLIENT_TOGGLES.forEach(f => { allDisabled[f.key] = false; allNull[f.key] = null; });
        await saveAllFeaturesViaApi(userId, allDisabled, allNull);
        setFeatureMap(prev => ({ ...prev, [userId]: { ...allDisabled } }));
        setUnlockedAll(prev => { const s = new Set(prev); s.delete(userId); return s; });
        toast({ title: "Todos os recursos desativados." });
      } catch (e: any) {
        toast({ title: e?.message || "Erro ao reverter recursos", variant: "destructive" });
      }
    } else {
      // LIBERAR TUDO
      try {
        const allEnabled: Record<string, boolean> = {};
        const allNull: Record<string, number | null> = {};
        CLIENT_TOGGLES.forEach(f => { allEnabled[f.key] = true; allNull[f.key] = null; });
        await saveAllFeaturesViaApi(userId, allEnabled, allNull);
        setFeatureMap(prev => ({ ...prev, [userId]: { ...allEnabled } }));
        setUnlockedAll(prev => new Set([...prev, userId]));
        toast({ title: "Todos os recursos liberados!" });
      } catch (e: any) {
        toast({ title: e?.message || "Erro ao liberar recursos", variant: "destructive" });
      }
    }
    setSavingFeatureFor(null);
  };

  const handleToggleFeature = async (userId: string, featureKey: string, enabled: boolean) => {
    const toggleId = `${userId}-${featureKey}`;
    setTogglingFeature(toggleId);
    try {
      // Monta o mapa completo com todas as features atuais + a que mudou
      const currentFeats = { ...(featureMap[userId] ?? {}) };
      CLIENT_TOGGLES.forEach(f => { if (currentFeats[f.key] === undefined) currentFeats[f.key] = false; });
      currentFeats[featureKey] = enabled;

      const currentLimits: Record<string, number | null> = {};
      CLIENT_TOGGLES.forEach(f => { currentLimits[f.key] = limitMap[userId]?.[f.key] ?? null; });

      // Usa a API com service_role (mesma que handleUnlockAll)
      await saveAllFeaturesViaApi(userId, currentFeats, currentLimits);

      setFeatureMap(prev => ({
        ...prev,
        [userId]: { ...currentFeats },
      }));
      toast({ title: enabled ? `${featureKey.replace(/_/g, " ")} ativado` : `${featureKey.replace(/_/g, " ")} desativado` });
    } catch (e: any) {
      console.error("Toggle feature error:", e);
      toast({ title: e?.message || "Erro ao atualizar função", variant: "destructive" });
    }
    setTogglingFeature(null);
  };

  const handleBlock = async (userId: string, block: boolean) => {
    setBlockingId(userId);
    try {
      await supabase.functions.invoke("admin-clients?action=block", {
        method: "POST",
        body: { user_id: userId, blocked: block },
      });
      setClients((prev) =>
        prev.map((c) =>
          c.user_id === userId
            ? { ...c, status: block ? "bloqueado" : "ativo", blocked_at: block ? new Date().toISOString() : null }
            : c
        )
      );
      toast({ title: block ? "Cliente bloqueado" : "Cliente desbloqueado" });
    } catch {
      toast({ title: "Erro ao atualizar status", variant: "destructive" });
    }
    setBlockingId(null);
  };

  const startEditProfile = (client: ClientProfile) => {
    setEditingProfile(client.user_id);
    setEditForm({ nome: client.nome || "", email: client.email || "", email_contato: client.email_contato || "", telefone: client.telefone || "", cidade: client.cidade || "" });
  };

  const saveProfile = async (userId: string) => {
    setSavingProfile(true);
    try {
      const res = await authedFetch("/api/admin/update-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: userId,
          display_name: editForm.nome || null,
          email_contato: editForm.email_contato || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Erro ao salvar perfil");
      }

      setClients((prev) =>
        prev.map((c) =>
          c.user_id === userId ? { ...c, nome: editForm.nome || null, email_contato: editForm.email_contato || null, telefone: editForm.telefone || null, cidade: editForm.cidade || null } : c
        )
      );
      setEditingProfile(null);
      toast({ title: "Perfil atualizado com sucesso!" });
    } catch {
      toast({ title: "Erro ao salvar perfil", variant: "destructive" });
    }
    setSavingProfile(false);
  };

  const handleDeleteClient = async (userId: string) => {
    setConfirmDeleteId(userId);
  };

  const confirmDelete = async () => {
    const userId = confirmDeleteId;
    if (!userId) return;
    setConfirmDeleteId(null);
    setDeletingClient(userId);
    try {
      const res = await authedFetch("/api/admin/delete-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: userId }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) throw new Error(data?.error || "Erro ao excluir");
      setClients((prev) => prev.filter((c) => c.user_id !== userId));
      toast({ title: "Cliente excluído com sucesso." });
    } catch (e: any) {
      toast({ title: e.message || "Erro ao excluir cliente", variant: "destructive" });
    }
    setDeletingClient(null);
  };

  /* ─── Direct avatar upload (click to change, auto-save like music covers) ─── */
  const handleDirectAvatarUpload = async (
    userId: string,
    file: File,
    options?: { syncTopIcon?: boolean }
  ) => {
    const shouldSyncTopIcon = options?.syncTopIcon === true;
    const fallbackAvatarKey = (userId || "").trim() || OWNER_LOCAL_AVATAR_ID;

    // Resolve id robustly (owner profile/admin list/session)
    let resolvedId: string | null = null;

    if (isValidUuid(userId)) {
      resolvedId = userId;
    } else if (isValidUuid(currentUserId)) {
      resolvedId = currentUserId;
    } else {
      const adminFromList = clients.find((c) => adminUserIds.has(c.user_id) && isValidUuid(c.user_id))?.user_id;
      if (isValidUuid(adminFromList)) {
        resolvedId = adminFromList;
      }
    }

    if (!isValidUuid(resolvedId)) {
      const storeId = useSessionStore.getState().user?.id;
      if (storeId && isValidUuid(storeId)) {
        resolvedId = storeId;
        setCurrentUserId(storeId);
      }
    }

    if (!isValidUuid(resolvedId) && !shouldSyncTopIcon) {
      toast({ title: "Não foi possível identificar o usuário para salvar a foto.", variant: "destructive" });
      return;
    }

    if (!file.type.startsWith("image/")) { toast({ title: "Selecione uma imagem.", variant: "destructive" }); return; }
    if (file.size > 5 * 1024 * 1024) { toast({ title: "Imagem deve ter no máximo 5MB.", variant: "destructive" }); return; }

    setUploadingAvatar(fallbackAvatarKey);
    try {
      const targetId = isValidUuid(resolvedId) ? resolvedId : fallbackAvatarKey;

      // Upload via server route using FormData (binary — no base64 size issue)
      const form = new FormData();
      form.append("clientId", targetId);
      form.append("file", file);

      const storeToken = useSessionStore.getState().token;
      const uploadRes = await fetch("/api/admin/upload-client-avatar", {
        method: "POST",
        headers: storeToken ? { Authorization: `Bearer ${storeToken}` } : {},
        body: form,
      });

      const respData = await uploadRes.json();
      if (!uploadRes.ok || !respData.avatarUrl) {
        throw new Error(respData.error || "Falha ao enviar foto");
      }
      const avatarUrl: string = respData.avatarUrl;

      // Não salva em localStorage — banco é a fonte de verdade (igual código antigo)

      if (isValidUuid(resolvedId)) {
        setClients((prev) => {
          const exists = prev.some((c) => c.user_id === resolvedId);
          if (exists) {
            return prev.map((c) => (c.user_id === resolvedId ? { ...c, avatar_url: avatarUrl } : c));
          }
          return [
            {
              id: resolvedId,
              user_id: resolvedId,
              nome: ownerNameDraft || "Proprietário",
              email: currentUserEmail,
              email_contato: null,
              telefone: null,
              status: "ativo",
              blocked_at: null,
              created_at: new Date().toISOString(),
              avatar_url: avatarUrl,
              cidade: null,
              username: null,
              last_seen: null,
            },
            ...prev,
          ];
        });
      }

      if (shouldSyncTopIcon) {
        const syncUserId = isValidUuid(resolvedId) ? resolvedId : null;
        setOwnerAvatarUrl(avatarUrl);
        window.dispatchEvent(new CustomEvent("owner-avatar-updated", {
          detail: {
            userId: syncUserId,
            avatarUrl,
            avatarStyle: syncUserId ? (savedAvatarStyles[syncUserId] ?? null) : null,
          },
        }));
      }

      toast({ title: "Foto atualizada!" });
    } catch (err: any) {
      toast({ title: "Erro ao enviar foto", variant: "destructive" });
      console.error("Erro avatar:", err?.message || err);
    }
    setUploadingAvatar(null);
  };

  /* ─── Create secondary admin ─── */
  const handleCreateSecondaryAdmin = async () => {
    if (!secondaryAdminUsername || !secondaryAdminPassword || secondaryAdminPassword.length < 6) {
      toast({ title: "Preencha usuário e senha (min. 6 caracteres)", variant: "destructive" });
      return;
    }
    const generatedEmail = `${secondaryAdminUsername.toLowerCase().replace(/[^a-z0-9._-]/g, "")}@comunicaedu.app`;
    setCreatingSADM(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-clients?action=create-secondary-admin", {
        method: "POST",
        body: {
          email: generatedEmail,
          password: secondaryAdminPassword,
          nome: secondaryAdminName || "Admin Funcionário",
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Upload avatar if selected
      if (secondaryAdminAvatarFile && data?.user_id) {
        await handleDirectAvatarUpload(data.user_id, secondaryAdminAvatarFile);
      }

      toast({ title: "Admin secundário criado com sucesso!" });
      setShowSecondaryAdminDialog(false);
      setSecondaryAdminEmail("");
      setSecondaryAdminUsername("");
      setSecondaryAdminPassword("");
      setSecondaryAdminName("");
      setSecondaryAdminAvatarFile(null);
      setSecondaryAdminAvatarPreview(null);
      setSecondaryAdminShowPwd(false);
      fetchClients();
    } catch (err: any) {
      toast({ title: err?.message || "Erro ao criar admin secundário", variant: "destructive" });
    }
    setCreatingSADM(false);
  };

  const handleChangePassword = async () => {
    if (!newPassword || newPassword.length < 6) {
      toast({ title: "A senha deve ter pelo menos 6 caracteres" });
      return;
    }
    // Senha não é salva em localStorage (segurança)
    const pwdToSave = newPassword;
    setNewPassword("");
    setChangingPassword(false);
    setShowPassword(false);

    // Tenta atualizar no Supabase em background (silencioso)
    try {
      const { error } = await supabase.auth.updateUser({ password: pwdToSave });
      if (error) throw error;
    } catch (err: any) {
      if (isSessionError(err)) {
        return;
      }

    }
  };

  const handleSaveOwnerName = async () => {
    if (!ownerCardProfile) {
      return;
    }

    if (!currentUserId || !isValidUuid(ownerCardProfile.user_id)) {
      setClients((prev) => prev.map((c) => c.user_id === ownerCardProfile.user_id ? { ...c, nome: ownerNameDraft || null } : c));
      setEditingOwnerName(false);
      toast({ title: "Nome atualizado no preview." });
      return;
    }

    setSavingProfile(true);
    try {
      const { error } = await supabase.from("profiles").update({
        display_name: ownerNameDraft || null,
      }).eq("user_id", ownerCardProfile.user_id);
      if (error) throw error;

      setClients((prev) => prev.map((c) => c.user_id === ownerCardProfile.user_id ? { ...c, nome: ownerNameDraft || null } : c));
      setEditingOwnerName(false);
      toast({ title: "Nome atualizado!" });
    } catch {
      toast({ title: "Erro ao salvar nome" });
    }
    setSavingProfile(false);
  };

  const handleSaveOwnerUsername = async () => {
    const uname = ownerUsernameDraft.trim().toLowerCase();
    if (!uname) { setEditingOwnerUsername(false); return; }

    // Salva imediatamente no estado e localStorage
    setOwnerUsername(uname);
    localStorage.setItem("edu-username", uname);
    setEditingOwnerUsername(false);

    // Vincula o username ao auth via API admin
    authedFetch("/api/auth/link-username", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: uname }),
    });
  };

  const copyLink = (clientId: string, service: string) => {
    const baseUrl = window.location.origin;
    const link = `${baseUrl}/player?client=${clientId}&service=${encodeURIComponent(service)}`;
    navigator.clipboard.writeText(link);
    setCopiedLink(`${clientId}-${service}`);
    toast({ title: "Link copiado!" });
    setTimeout(() => setCopiedLink(null), 2000);
  };

  const fetchClientActivity = async (userId: string) => {
    if (clientActivity[userId]) return;
    setLoadingActivity(userId);
    try {
      const { data } = await supabase
        .from("user_activity")
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(20);
      setClientActivity((prev) => ({ ...prev, [userId]: (data || []) as ActivityRecord[] }));
    } catch {
      // silently fail
    }
    setLoadingActivity(null);
  };

  const sortedClients = [...clients].sort((a, b) => {
    const aAdmin = adminUserIds.has(a.user_id) ? 0 : 1;
    const bAdmin = adminUserIds.has(b.user_id) ? 0 : 1;
    if (aAdmin !== bAdmin) return aAdmin - bAdmin;
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  });

  const filtered = sortedClients.filter((c) => {
    const term = searchTerm.toLowerCase();
    return !term || (c.nome && c.nome.toLowerCase().includes(term)) || (c.email && c.email.toLowerCase().includes(term));
  });

  const activePlans = plans.filter((p) => p.is_active);
  const services = [...new Set(activePlans.map((p) => p.service_label))];

  const ownerProfile = clients.find((c) => adminUserIds.has(c.user_id));


  const fallbackOwnerId = currentUserId || OWNER_LOCAL_AVATAR_ID;

  const ownerCardProfile: ClientProfile | null = ownerProfile
    ? { ...ownerProfile, avatar_url: ownerAvatarUrl ?? ownerProfile.avatar_url }
    : {
    id: fallbackOwnerId,
    user_id: fallbackOwnerId,
    nome: "Proprietário",
    email: currentUserEmail,
    email_contato: null,
    telefone: null,
    status: "ativo",
    blocked_at: null,
    created_at: new Date().toISOString(),
    avatar_url: ownerAvatarUrl,
    cidade: null,
    username: null,
    last_seen: null,
  };
  const regularClients = filtered.filter((c) => !adminUserIds.has(c.user_id) && c.user_id !== ownerCardProfile?.user_id);

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  };

  const formatActivityType = (type: string) => {
    const map: Record<string, string> = {
      play: "▶ Reproduziu", search: "🔍 Pesquisou", favorite: "❤ Favoritou", skip: "⏭ Pulou",
    };
    return map[type] || type;
  };

  const isOnline = (lastSeen: string | null): boolean => {
    if (!lastSeen) return false;
    return Date.now() - new Date(lastSeen).getTime() < 5 * 60 * 1000;
  };

  /* ─── Avatar style save/load (same as playlist covers) ─── */
  const saveAvatarStyle = useCallback((userId: string, zoom: number, x: number, y: number, syncTopIcon = false) => {
    const style = { zoom: normalizeZoom(zoom), x, y };
    setSavedAvatarStyles((prev) => {
      const next = { ...prev, [userId]: style };
      updatePref("avatar_styles", next);
      return next;
    });

    if (syncTopIcon) {
      window.dispatchEvent(new CustomEvent("owner-avatar-updated", {
        detail: {
          userId,
          avatarUrl: ownerAvatarUrl,
          avatarStyle: style,
        },
      }));
    }
  }, [normalizeZoom, ownerAvatarUrl]);

  // Click outside to auto-save avatar reposition (same pattern as playlists)
  useEffect(() => {
    if (!avatarRepositioning) return;
    const repoId = avatarRepositioning;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(`[data-avatar-id="${repoId}"]`)) {
        saveAvatarStyle(repoId, avatarZoom, avatarTempOffset.x, avatarTempOffset.y, repoId === ownerCardProfile?.user_id);
        setAvatarRepositioning(null);
        toast({ title: "Edição salva!" });
      }
    };

    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [avatarRepositioning, avatarZoom, avatarTempOffset, ownerCardProfile?.user_id, saveAvatarStyle, toast]);

  const handleAvatarDragStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    (e.currentTarget as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    setAvatarDragStart({ x: e.clientX - avatarTempOffset.x, y: e.clientY - avatarTempOffset.y });
  };
  const handleAvatarDragMove = (e: React.PointerEvent) => {
    if (!avatarDragStart) return;
    setAvatarTempOffset({ x: e.clientX - avatarDragStart.x, y: e.clientY - avatarDragStart.y });
  };
  const handleAvatarDragEnd = () => {
    setAvatarDragStart(null);
    // Espelha imediatamente no avatar do header ao soltar o drag
    if (avatarRepositioning && avatarRepositioning === ownerCardProfile?.user_id && ownerAvatarUrl) {
      window.dispatchEvent(new CustomEvent("owner-avatar-updated", {
        detail: {
          userId: avatarRepositioning,
          avatarUrl: ownerAvatarUrl,
          avatarStyle: { zoom: avatarZoom, x: avatarTempOffset.x, y: avatarTempOffset.y },
        },
      }));
    }
  };

  /* ─── Avatar wrapper — thin adapter over module-level ClientAvatarButton ─── */
  const AvatarDropZone = ({ client, large = false, disabled = false }: { client: ClientProfile; large?: boolean; disabled?: boolean }) => {
    const avatarId = (client.user_id || "").trim() || OWNER_LOCAL_AVATAR_ID;
    const isOwnerAvatar = avatarId === ownerCardProfile?.user_id;
    const isRepositioning = avatarRepositioning === avatarId;
    const savedStyle = savedAvatarStyles[avatarId];

    const openFilePicker = () => {
      if (disabled || isRepositioning || uploadingAvatar === avatarId) return;
      pendingAvatarIdRef.current = avatarId;
      sharedAvatarInputRef.current?.click();
    };

    const handleStartReposition = (e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      if (isRepositioning) {
        saveAvatarStyle(avatarId, normalizeZoom(avatarZoom), avatarTempOffset.x, avatarTempOffset.y, isOwnerAvatar);
        setAvatarRepositioning(null);
        toast({ title: "Edição salva!" });
        return;
      }
      const saved = savedAvatarStyles[avatarId];
      setAvatarRepositioning(avatarId);
      setAvatarOffset(saved ? { x: saved.x, y: saved.y } : { x: 0, y: 0 });
      setAvatarTempOffset(saved ? { x: saved.x, y: saved.y } : { x: 0, y: 0 });
      setAvatarZoom(normalizeZoom(saved?.zoom ?? 1.1));
    };

    return (
      <ClientAvatarButton
        avatarUrl={client.avatar_url}
        avatarId={avatarId}
        large={large}
        disabled={disabled}
        isUploading={uploadingAvatar === avatarId}
        isRepositioning={isRepositioning}
        savedStyle={savedStyle}
        avatarZoom={avatarZoom}
        avatarTempOffset={avatarTempOffset}
        onOpenFilePicker={openFilePicker}
        onFileDrop={(file) => handleDirectAvatarUpload(avatarId, file, { syncTopIcon: isOwnerAvatar })}
        onStartReposition={handleStartReposition}
        onDragMove={handleAvatarDragMove}
        onDragEnd={handleAvatarDragEnd}
        onDragStart={handleAvatarDragStart}
        onZoomChange={(v) => setAvatarZoom(normalizeZoom(v[0]))}
        onZoomAdjust={(delta) => setAvatarZoom((prev) => normalizeZoom(prev + delta))}
        zoomMin={AVATAR_ZOOM_MIN}
        zoomMax={AVATAR_ZOOM_MAX}
      />
    );
  };

  /* ═══════════════════════════════════════════ */
  /* ─────────── OWNER PANEL (MASTER) ─────────── */
  /* ═══════════════════════════════════════════ */
  const OwnerPanel = () => {
    if (!ownerCardProfile) return null;

    const handleOwnerNameBlur = () => {
      if (ownerNameDraft.trim() && ownerNameDraft !== ownerCardProfile.nome) {
        handleSaveOwnerName();
      } else {
        setEditingOwnerName(false);
      }
    };

    const handlePasswordBlur = () => {
      if (!newPassword) {
        setChangingPassword(false);
        setShowPassword(false);
        return;
      }
      if (newPassword.length < 6) {
        toast({ title: "Senha muito curta (mínimo 6 caracteres)", variant: "destructive" });
        setNewPassword("");
        setChangingPassword(false);
        setShowPassword(false);
        return;
      }
      handleChangePassword();
    };

    return (
      <div className="bg-card rounded-xl border-2 border-yellow-500/50 overflow-hidden shadow-lg shadow-yellow-500/5">
        {/* Gold header bar */}
        <div className="bg-gradient-to-r from-yellow-500/20 via-yellow-600/10 to-yellow-500/20 border-b border-yellow-500/30 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Crown className="h-5 w-5 text-yellow-500" />
            <Badge className="text-xs font-bold bg-yellow-500/20 text-yellow-500 border-yellow-500/50 px-3 py-1 pointer-events-none">
              ADM PROPRIETÁRIO
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Clock className="h-3 w-3" />
            Desde {formatDate(ownerCardProfile.created_at)}
          </div>
        </div>

        <div className="p-6">
          <div className="flex gap-6 items-start">
            {/* Avatar — click to upload, hover to reposition (same as playlist covers) */}
            <div className="flex flex-col items-center gap-2 shrink-0 pb-4">
              {AvatarDropZone({ client: ownerCardProfile, large: true })}
              <span className={`text-[10px] text-muted-foreground transition-opacity duration-150 ${avatarRepositioning === ownerCardProfile.user_id ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                Arraste para reposicionar
              </span>
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              {/* Usuário de login — exibe "Proprietário" mascarando o username real */}
              <div className="mb-3">
                <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-widest mb-1">Usuário</p>
                <div className="h-8 flex items-center">
                  {editingOwnerUsername ? (
                    <div className="relative w-44">
                      <Input
                        value={ownerUsernameDraft}
                        onChange={(e) => setOwnerUsernameDraft(e.target.value.toLowerCase())}
                        type={showUsername ? "text" : "password"}
                        className="h-8 text-sm w-full pr-8"
                        placeholder=""
                        autoFocus
                        onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setEditingOwnerUsername(false); setShowUsername(false); } }}
                        onBlur={handleSaveOwnerUsername}
                      />
                      <button
                        type="button"
                        title="Mostrar/ocultar usuário"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowUsername((p) => !p)}
                      >
                        {showUsername ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <div
                      className="flex items-center gap-2 select-none cursor-pointer"
                      onClick={() => { setEditingOwnerUsername(true); setOwnerUsernameDraft(ownerUsername || localStorage.getItem("edu-username") || ""); setShowUsername(false); }}
                    >
                      <p className="text-sm font-bold text-foreground leading-none">Proprietário</p>
                      <ShieldCheck className="h-4 w-4 shrink-0 text-green-500 pointer-events-none" />
                    </div>
                  )}
                </div>
              </div>

              {/* Senha + Add ADM Funcionário lado a lado */}
              <div className="flex items-start gap-4 flex-wrap">
                <div className="w-44 shrink-0">
                  <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-widest mb-1">Senha</p>
                  <div className="h-8 flex items-center">
                    {changingPassword ? (
                      <div className="relative w-44">
                        <Input
                          type={showPassword ? "text" : "password"}
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          placeholder=""
                          className="h-8 text-xs w-full pr-8"
                          autoFocus
                          autoComplete="new-password"
                          name="owner-new-password"
                          onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
                          onBlur={handlePasswordBlur}
                        />
                        <button
                          type="button"
                          title="Mostrar/ocultar senha"
                          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => setShowPassword((p) => !p)}
                        >
                          {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    ) : (
                      <div
                        className="flex items-center gap-2 select-none cursor-pointer"
                        onClick={() => { setNewPassword(""); setChangingPassword(true); setShowPassword(false); }}
                      >
                        <p className="text-sm text-muted-foreground leading-none">••••••••</p>
                        <KeyRound className="h-3.5 w-3.5 shrink-0 text-muted-foreground pointer-events-none" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Add ADM Funcionário */}
                <div>
                  <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-widest mb-1">Equipe</p>
                  <Button
                    size="sm"
                    className="text-[11px] h-8 bg-background border border-yellow-500/40 text-yellow-600 hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] hover:bg-background transition-all"
                    onClick={() => setShowSecondaryAdminDialog(true)}
                  >
                    <UserPlus2 className="h-3.5 w-3.5 mr-1" />
                    Add ADM Funcionário
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  /* ─── Secondary Admin Dialog ─── */
  const SecondaryAdminDialog = () => {
    const handleSADMAvatarFile = (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (!file.type.startsWith("image/")) return;
      if (file.size > 5 * 1024 * 1024) { toast({ title: "Imagem deve ter no máximo 5MB.", variant: "destructive" }); return; }
      setSecondaryAdminAvatarFile(file);
      const reader = new FileReader();
      reader.onload = () => setSecondaryAdminAvatarPreview(reader.result as string);
      reader.readAsDataURL(file);
      e.target.value = "";
    };

    return (
      <Dialog open={showSecondaryAdminDialog} onOpenChange={(open) => {
        setShowSecondaryAdminDialog(open);
        if (!open) {
          setSecondaryAdminEmail(""); setSecondaryAdminUsername(""); setSecondaryAdminPassword(""); setSecondaryAdminName("");
          setSecondaryAdminAvatarFile(null); setSecondaryAdminAvatarPreview(null); setSecondaryAdminShowPwd(false);
        }
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-foreground">
              <UserPlus2 className="h-5 w-5 text-yellow-500" />
              <span className="text-white">Add ADM Funcionário</span>
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            {/* Avatar upload */}
            <div className="flex flex-col items-center gap-2">
              <div
                className="relative group h-20 w-20 rounded-full overflow-hidden border-2 border-primary/60 bg-muted cursor-pointer"
                onClick={() => secondaryAdminFileRef.current?.click()}
              >
                {secondaryAdminAvatarPreview ? (
                  <img src={secondaryAdminAvatarPreview} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    <Camera className="h-6 w-6 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-all duration-200 opacity-0 group-hover:opacity-100 flex items-center justify-center">
                  <Camera className="h-5 w-5 text-white" />
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground">
                {secondaryAdminAvatarPreview ? "Clique para trocar" : "Adicionar foto (opcional)"}
              </span>
              <input ref={secondaryAdminFileRef} type="file" accept="image/*" title="Selecionar foto" className="hidden" onChange={handleSADMAvatarFile} />
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Nome</label>
              <Input value={secondaryAdminName} onChange={(e) => setSecondaryAdminName(e.target.value)} placeholder="Nome do admin" className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Usuário</label>
              <Input value={secondaryAdminUsername} onChange={(e) => setSecondaryAdminUsername(e.target.value)} placeholder="nome.usuario" className="text-sm" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Senha</label>
              <div className="relative">
                <Input
                  value={secondaryAdminPassword}
                  onChange={(e) => setSecondaryAdminPassword(e.target.value)}
                  placeholder="Min. 6 caracteres"
                  className="text-sm pr-9"
                  type={secondaryAdminShowPwd ? "text" : "password"}
                />
                <button
                  type="button"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  onClick={() => setSecondaryAdminShowPwd(!secondaryAdminShowPwd)}
                >
                  {secondaryAdminShowPwd ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                </button>
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground">
              O admin funcionário poderá gerenciar clientes e permissões, mas com restrições.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowSecondaryAdminDialog(false)}>Cancelar</Button>
            <Button className="bg-primary text-primary-foreground" disabled={creatingSADM} onClick={handleCreateSecondaryAdmin}>
              {creatingSADM ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <UserPlus2 className="h-4 w-4 mr-2" />}
              Criar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  // ── Atualizar usuário/senha de um cliente ──────────────────────────────
  const saveClientField = async (userId: string) => {
    if (!editingClientField || editingClientField.userId !== userId) return;
    const { field } = editingClientField;
    const value = clientFieldDraft.trim();
    if (!value) { setEditingClientField(null); setShowClientField(false); return; }

    setSavingClientField(true);
    try {
      const res = await authedFetch("/api/admin/update-client", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          clientId: userId,
          ...(field === "password" ? { password: value } : { username: value }),
        }),
      });
      const data = await res.json();
      if (!res.ok) { toast({ title: data.error || "Erro ao salvar", variant: "destructive" }); return; }

      if (field === "username") {
        setClients((prev) => prev.map((c) => c.user_id === userId ? { ...c, username: value } : c));
      } else if (field === "password") {
        // Senha salva no Supabase Auth, não em localStorage
      }
    } catch {
      toast({ title: "Erro ao salvar", variant: "destructive" });
    } finally {
      setSavingClientField(false);
      setEditingClientField(null);
      setShowClientField(false);
    }
  };
  // ────────────────────────────────────────────────────────────────────────

  // ── Entrar no perfil do cliente (impersonação via JWT próprio) ──────────
  const enterProfile = async (clientId: string) => {
    setEnteringProfile(clientId);
    try {
      const adminToken = useSessionStore.getState().token;
      const adminUser = useSessionStore.getState().user;
      if (!adminToken || !adminUser?.id) {
        toast({ title: "Sessão do admin não encontrada. Faça login novamente.", variant: "destructive" });
        return;
      }

      // Guarda sessão do admin na aba atual (sessionStorage = isolado por aba)
      sessionStorage.setItem("edu-admin-return-session", JSON.stringify({
        token: adminToken,
        user: adminUser,
      }));

      const res = await authedFetch("/api/admin/impersonate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: clientId }),
      });

      if (!res.ok) {
        sessionStorage.removeItem("edu-admin-return-session");
        const err = await res.json().catch(() => ({}));
        toast({ title: "Erro ao acessar perfil", description: err?.error ?? "Falha", variant: "destructive" });
        return;
      }

      const { token, user } = await res.json();

      // Troca a sessão ativa pela do cliente
      useSessionStore.getState().setSession(token, user);

      // Marca visual de impersonation (isolada por aba)
      sessionStorage.setItem("edu-impersonated-username", user?.username ?? "");

      // P6-fix: limpa qualquer cache in-memory do admin antes de trocar de contexto
      invalidateAllCaches();

      // Hard navigation para reconstruir a UI limpa
      window.location.href = "/player";
    } catch (e) {
      sessionStorage.removeItem("edu-admin-return-session");
      console.error(e);
    }
    setEnteringProfile(null);
  };
  // ────────────────────────────────────────────────────────────────────────

  /* ═══════════════════════════════════════════ */
  /* ─────────── MAIN RENDER ─────────── */
  /* ═══════════════════════════════════════════ */
  return (
    <div className="space-y-4">
      {/* Shared avatar file input — stable across re-renders */}
      <input
        ref={sharedAvatarInputRef}
        type="file"
        accept="image/*"
        title="Selecionar foto"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          const targetId = pendingAvatarIdRef.current;
          if (file && targetId) {
            const isOwner = targetId === ownerCardProfile?.user_id;
            handleDirectAvatarUpload(targetId, file, { syncTopIcon: isOwner });
          }
          e.target.value = "";
          pendingAvatarIdRef.current = null;
        }}
      />

      {/* Dialogs */}
      <SecondaryAdminDialog />


      {/* Confirm Delete Dialog */}
      <Dialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <DialogContent className="max-w-[260px] bg-card border border-border/60 rounded-2xl shadow-2xl p-4 [&>button]:hidden">
          <DialogTitle className="sr-only">Confirmar exclusão</DialogTitle>
          <div className="flex flex-col items-center gap-3 text-center">
            <div className="w-9 h-9 rounded-full bg-destructive/15 flex items-center justify-center">
              <Trash2 className="h-4 w-4 text-destructive" />
            </div>
            <div className="space-y-0.5">
              <p className="text-sm font-semibold text-foreground">Excluir cliente?</p>
              <p className="text-[11px] text-muted-foreground">Ação permanente e irreversível.</p>
            </div>
            <div className="flex gap-2 w-full">
              <Button variant="outline" size="sm" className="flex-1 h-7 text-xs" onClick={() => setConfirmDeleteId(null)}>
                Cancelar
              </Button>
              <Button size="sm" className="flex-1 h-7 text-xs bg-destructive hover:bg-destructive/90 text-white" onClick={confirmDelete}>
                Excluir
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <div className="space-y-4 pb-2 bg-background">
        {/* Owner Panel - always visible at top */}
        {!loading && ownerCardProfile && OwnerPanel()}

        {/* Clients header + search */}
        <div className="bg-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Empresas / Clientes
          </h3>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={() => {
                const next = !showNewClient;
                setShowNewClient(next);
                if (next) {
                  setTimeout(() => {
                    document.getElementById("new-client-form")?.scrollIntoView({ behavior: "smooth", block: "start" });
                  }, 100);
                }
              }}
              className="text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all"
            >
              <UserPlus className="h-3.5 w-3.5 mr-1" />
              {showNewClient ? "Fechar Cadastro" : "Novo Cliente"}
            </Button>
          </div>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome..."
            className="pl-9 pr-8"
            autoComplete="off"
            name="search-clients"
          />
          {searchTerm && (
            <button
              type="button"
              title="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearchTerm("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      ) : regularClients.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {searchTerm ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}
        </div>
      ) : (
        /* ─── Client cards ─── */
        <div className="space-y-4">
          {regularClients.map((client) => {

            const isBlocked = client.status === "bloqueado";
            const isBlocking = blockingId === client.user_id;
            const isEditing = editingProfile === client.user_id;
            const online = isOnline(client.last_seen);
            const enabledFeatures = CLIENT_TOGGLES.filter((f) => isFeatureEnabled(client.user_id, f.key));

            return (
              <div key={client.id} id={`client-card-${client.user_id}`} className={`bg-card rounded-xl border overflow-hidden ${isBlocked ? "border-destructive/40" : "border-border/40"}`}>
                {/* ══ CARD EXTERNO — mesmo estilo do ADM PROPRIETÁRIO ══ */}

                {/* Barra de header */}
                <div className="bg-gradient-to-r from-secondary/40 via-secondary/20 to-secondary/40 border-b border-border/30 px-4 py-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${isBlocked ? "bg-destructive" : online ? "bg-green-500" : "bg-muted-foreground/40"}`} />
                    <span className="text-[11px] text-muted-foreground">
                      {isBlocked ? "Bloqueado" : online ? "Online agora" : client.last_seen ? `Visto: ${formatDate(client.last_seen)}` : "Nunca acessou"}
                    </span>
                  </div>
                  <Badge variant={isBlocked ? "destructive" : "secondary"} className="text-[9px] pointer-events-none">
                    {client.status || "ativo"}
                  </Badge>
                </div>

                {/* Corpo principal */}
                <div className="px-3 py-2 flex gap-3 items-start">

                  {/* Esquerda: avatar + usuário/senha abaixo + dados ao lado */}
                  <div className="shrink-0 flex gap-3 items-start">

                    {/* Avatar + usuário/senha abaixo */}
                    <div className="flex flex-col items-center gap-1.5">
                      {AvatarDropZone({ client, large: true })}
                      <div className="w-24 space-y-1">
                        <div>
                          <p className="text-[9px] text-primary font-bold uppercase tracking-widest mb-0.5">Usuário</p>
                          {editingClientField?.userId === client.user_id && editingClientField.field === "username" ? (
                            <div className="relative">
                              <input type={showClientField ? "text" : "password"} value={clientFieldDraft} ref={(el) => { if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }} autoComplete="off" title="Nome de usuário" placeholder="usuario"
                                onChange={(e) => setClientFieldDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setEditingClientField(null); setShowClientField(false); } }}
                                onBlur={() => saveClientField(client.user_id)} disabled={savingClientField}
                                className="w-full h-6 rounded border border-border bg-secondary/50 text-foreground text-xs px-1.5 pr-5 focus:outline-none focus:border-primary" />
                              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowClientField((p) => !p)} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground">
                                {showClientField ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 cursor-pointer select-none group" onClick={() => { setEditingClientField({ userId: client.user_id, field: "username" }); setClientFieldDraft(client.username || ""); setShowClientField(false); }}>
                              <span className="text-xs font-bold text-foreground truncate">{client.username || "—"}</span>
                              <Pencil className="h-2.5 w-2.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
                            </div>
                          )}
                        </div>
                        <div>
                          <p className="text-[9px] text-primary font-bold uppercase tracking-widest mb-0.5">Senha</p>
                          {editingClientField?.userId === client.user_id && editingClientField.field === "password" ? (
                            <div className="relative">
                              <input type="text" value={clientFieldDraft} ref={(el) => { if (el && document.activeElement !== el) el.focus({ preventScroll: true }); }} autoComplete="off" title="Senha" placeholder="••••"
                                onChange={(e) => setClientFieldDraft(e.target.value)}
                                onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); if (e.key === "Escape") { setEditingClientField(null); setShowClientField(false); } }}
                                onBlur={() => saveClientField(client.user_id)} disabled={savingClientField}
                                className={`w-full h-6 rounded border border-border bg-secondary/50 text-foreground text-xs px-1.5 pr-5 focus:outline-none focus:border-primary${showClientField ? "" : " input-masked"}`} />
                              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => setShowClientField((p) => !p)} className="absolute right-1 top-1/2 -translate-y-1/2 text-muted-foreground">
                                {showClientField ? <EyeOff className="h-2.5 w-2.5" /> : <Eye className="h-2.5 w-2.5" />}
                              </button>
                            </div>
                          ) : (
                            <div className="flex items-center gap-1 cursor-pointer select-none group" onClick={() => { setEditingClientField({ userId: client.user_id, field: "password" }); setClientFieldDraft(""); setShowClientField(false); }}>
                              <span className="text-xs text-muted-foreground tracking-widest">••••••</span>
                              <Pencil className="h-2.5 w-2.5 text-muted-foreground/40 group-hover:text-muted-foreground shrink-0" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Dados da empresa — campos sempre com fundo escuro, lápis ativa edição */}
                    <div className="w-44 space-y-1.5">
                      {/* Header com lápis */}
                      <div className="flex items-center justify-between mb-0.5">
                        <p className="text-[9px] text-primary font-bold uppercase tracking-widest">Dados</p>
                        <button type="button" title="Editar dados" onClick={() => isEditing ? setEditingProfile(null) : startEditProfile(client)}
                          className={`p-0.5 rounded transition-colors ${isEditing ? "text-primary" : "text-muted-foreground/50 hover:text-primary"}`}>
                          <Pencil className="h-3 w-3" />
                        </button>
                      </div>
                      {[
                        { key: "nome", label: "Nome" },
                        { key: "email_contato", label: "Email" },
                        { key: "telefone", label: "Telefone" },
                        { key: "cidade", label: "Cidade" },
                      ].map(({ key, label }) => {
                        const viewValue = (client as any)[key] || "";
                        return (
                          <div key={key}>
                            <p className="text-[9px] text-primary font-bold uppercase tracking-widest mb-0.5">{label}</p>
                            <input
                              title={label}
                              placeholder="—"
                              readOnly={!isEditing}
                              value={isEditing ? (editForm as any)[key] : viewValue}
                              onChange={(e) => setEditForm((f) => ({ ...f, [key]: e.target.value }))}
                              className={`w-full h-6 rounded text-xs px-2 bg-secondary/50 text-foreground transition-colors focus:outline-none
                                ${isEditing
                                  ? "border border-primary/50 focus:border-primary cursor-text"
                                  : "border border-transparent cursor-default"}`}
                            />
                          </div>
                        );
                      })}
                      {/* Salvar — sempre ocupa espaço, invisível quando não edita */}
                      <button type="button" onClick={() => saveProfile(client.user_id)} disabled={savingProfile || !isEditing}
                        className={`w-full h-6 rounded bg-primary text-primary-foreground text-xs flex items-center justify-center gap-1 hover:opacity-90 mt-0.5 transition-opacity ${isEditing ? "opacity-100" : "opacity-0 pointer-events-none"}`}>
                        {savingProfile ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Save className="h-2.5 w-2.5" />} Salvar
                      </button>
                    </div>
                  </div>

                  {/* Dois cards internos — Recursos menor, Ativos maior */}
                  <div className="flex-1 min-w-0 grid grid-cols-[4fr_5fr] gap-3">

                    {/* ── CARD INTERNO 1 — Recursos (toggles + limites) ── */}
                    <div className="bg-secondary/20 rounded-lg border border-border/30 overflow-hidden h-52 flex flex-col">
                      <div className="px-3 py-2 border-b border-border/30 flex items-center justify-between">
                        <p className="text-[10px] text-primary font-bold uppercase tracking-widest flex items-center gap-1.5">
                          <Settings2 className="h-3 w-3" /> Recursos
                        </p>
                        <button
                          type="button"
                          disabled={savingFeatureFor === client.user_id}
                          title={unlockedAll.has(client.user_id) ? "Desativar todos os recursos" : "Liberar todos os recursos com créditos ilimitados"}
                          onClick={() => handleUnlockAll(client.user_id)}
                          className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-bold transition-colors disabled:opacity-50 ${unlockedAll.has(client.user_id) ? "bg-destructive/80 text-white hover:bg-destructive" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}
                        >
                          {savingFeatureFor === client.user_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <KeyRound className="h-2.5 w-2.5" />}
                          {unlockedAll.has(client.user_id) ? "Reverter" : "Liberar tudo"}
                        </button>
                      </div>
                      <div className="px-2 py-1 border-b border-border/20">
                        <Input
                          value={featureSearch[client.user_id] ?? ""}
                          onChange={(e) => setFeatureSearch(prev => ({ ...prev, [client.user_id]: e.target.value }))}
                          placeholder="Buscar recurso..."
                          className="h-6 text-[10px] bg-secondary/30 border-muted px-2"
                        />
                      </div>
                      <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        {CLIENT_TOGGLES.filter(feat => {
                          const q = (featureSearch[client.user_id] ?? "").toLowerCase();
                          return !q || feat.label.toLowerCase().includes(q);
                        }).map((feat) => {
                          const enabled = isFeatureEnabled(client.user_id, feat.key);
                          const toggleId = `${client.user_id}-${feat.key}`;
                          const isToggling = togglingFeature === toggleId;
                          return (
                            <div key={feat.key} className={`px-3 py-1.5 border-b border-border/20 last:border-0 ${enabled ? "" : "opacity-50"}`}>
                              <div className="flex items-center justify-between gap-2">
                                <span className="text-xs text-foreground truncate flex-1">{feat.label}</span>
                                {isToggling ? <Loader2 className="h-3 w-3 animate-spin shrink-0" /> : (
                                  <Switch checked={enabled} onCheckedChange={(c) => handleToggleFeature(client.user_id, feat.key, c)} />
                                )}
                              </div>
                              {/* Compartilhar link do player */}
                              {feat.key === "player_espelho" && enabled && (
                                <button type="button" onClick={async () => {
                                  const url = `${window.location.origin}/player/embed?client=${client.user_id}&mode=mirror`;
                                  if (navigator.share) {
                                    await navigator.share({ title: "Player Espelho — ComunicaEDU", text: "Acesse o player pelo link:", url });
                                  } else {
                                    navigator.clipboard.writeText(url);
                                    setCopiedLink(`${client.user_id}-mirror`);
                                    setTimeout(() => setCopiedLink(null), 2000);
                                  }
                                }}
                                  className={`w-full h-5 mt-1 text-[9px] rounded flex items-center justify-center gap-1 font-medium transition-colors ${copiedLink === `${client.user_id}-mirror` ? "bg-green-600 text-white" : "bg-primary text-primary-foreground hover:opacity-90"}`}>
                                  {copiedLink === `${client.user_id}-mirror` ? <><Check className="h-2.5 w-2.5" /> Copiado!</> : <><ExternalLink className="h-2.5 w-2.5" /> Gerar link do player flutuante</>}
                                </button>
                              )}
                              {feat.key === "player_independente" && enabled && (
                                <button type="button" onClick={async () => {
                                  const url = `${window.location.origin}/player/embed?client=${client.user_id}&mode=independent`;
                                  if (navigator.share) {
                                    await navigator.share({ title: "Player Independente — ComunicaEDU", text: "Acesse o player pelo link:", url });
                                  } else {
                                    navigator.clipboard.writeText(url);
                                    setCopiedLink(`${client.user_id}-independent`);
                                    setTimeout(() => setCopiedLink(null), 2000);
                                  }
                                }}
                                  className={`w-full h-5 mt-1 text-[9px] rounded flex items-center justify-center gap-1 font-medium transition-colors ${copiedLink === `${client.user_id}-independent` ? "bg-green-600 text-white" : "bg-primary text-primary-foreground hover:opacity-90"}`}>
                                  {copiedLink === `${client.user_id}-independent` ? <><Check className="h-2.5 w-2.5" /> Copiado!</> : <><ExternalLink className="h-2.5 w-2.5" /> Gerar link do player flutuante</>}
                                </button>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ── CARD INTERNO 2 — Ativos no Perfil ── */}
                    <div className="bg-secondary/20 rounded-lg border border-border/30 overflow-hidden flex flex-col h-52">
                      <div className="px-3 py-2 border-b border-border/30">
                        <p className="text-[10px] text-primary font-bold uppercase tracking-widest flex items-center gap-1.5">
                          <ShieldCheck className="h-3 w-3" /> Ativos no Perfil
                        </p>
                      </div>
                      <div className="flex-1 overflow-hidden px-2 py-2 flex flex-col gap-2">

                        {/* Status badges */}
                        <div className="flex flex-wrap gap-1">
                          {online ? (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 border border-green-500/30 font-medium flex items-center gap-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block" /> Online
                            </span>
                          ) : (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-muted/30 text-muted-foreground border border-border/30 font-medium">
                              {client.last_seen ? `Visto: ${formatDate(client.last_seen)}` : "Nunca acessou"}
                            </span>
                          )}
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-secondary/60 text-muted-foreground border border-border/30 font-medium">
                            Desde {new Date(client.created_at).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" })}
                          </span>
                        </div>

                        {/* Recursos ativos (tags) */}
                        <div className="flex-1 flex flex-wrap gap-1 content-start overflow-hidden">
                          {enabledFeatures.length > 0
                            ? enabledFeatures.map((f) => (
                                <span key={f.key} className="text-[8px] px-1 py-0.5 rounded-full bg-primary/15 text-primary border border-primary/20 font-medium leading-tight">{f.label}</span>
                              ))
                            : <span className="text-[10px] text-muted-foreground italic">Nenhum recurso ativo</span>
                          }
                        </div>

                        {/* Botões de ação — fixos no fundo */}
                        <div className="flex flex-col gap-1 mt-auto w-3/4 mx-auto">
                          <button type="button" disabled={isBlocking} onClick={() => handleBlock(client.user_id, !isBlocked)}
                            className={`w-full h-5 rounded flex items-center justify-center gap-1 text-[10px] font-medium text-white hover:opacity-90 transition-opacity ${isBlocked ? "bg-zinc-600" : "bg-destructive"}`}>
                            {isBlocking ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : isBlocked ? <><Unlock className="h-2.5 w-2.5 shrink-0" /> Desbloquear</> : <><Lock className="h-2.5 w-2.5 shrink-0" /> Bloquear</>}
                          </button>
                          <button type="button" disabled={enteringProfile === client.user_id} onClick={() => enterProfile(client.user_id)}
                            className="w-full h-5 rounded bg-primary text-primary-foreground flex items-center justify-center gap-1 text-[10px] font-medium hover:opacity-90 transition-opacity">
                            {enteringProfile === client.user_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <LogIn className="h-2.5 w-2.5 shrink-0" />}
                            Entrar no Perfil
                          </button>
                          <button type="button" disabled={deletingClient === client.user_id} onClick={() => handleDeleteClient(client.user_id)}
                            className="w-full h-5 rounded bg-zinc-800 border border-destructive/40 text-destructive flex items-center justify-center gap-1 text-[10px] font-medium hover:opacity-90 transition-opacity">
                            {deletingClient === client.user_id ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <Trash2 className="h-2.5 w-2.5 shrink-0" />}
                            Excluir Cliente
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>
                </div>


              </div>
            );
          })}
        </div>
      )}

      {showNewClient && (
        <div id="new-client-form" className="animate-in fade-in duration-[600ms] mt-4">
          <ManualClientForm onSuccess={(userId) => { setShowNewClient(false); fetchClients(userId); }} />
        </div>
      )}
    </div>
  );
};

export default ClientManagement;