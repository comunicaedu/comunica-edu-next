"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, Search, UserPlus, ShieldAlert, ShieldCheck,
  ChevronDown, ChevronRight, Link2, Copy, Check,
  Loader2, Lock, Unlock, Settings2, Crown, Pencil, Save, X, Camera, KeyRound, Move,
  Mail, Phone, Clock, User, Building2, Activity, UsersRound, Upload,
  UserPlus2, Eye, EyeOff, ImagePlus,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { useServicePlans } from "@/hooks/useServicePlans";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/lib/supabase/client";
import ManualClientForm from "./ManualClientForm";
import {
  Table, TableHeader, TableBody, TableHead, TableRow, TableCell,
} from "@/components/ui/table";

interface ClientProfile {
  id: string;
  user_id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  status: string;
  blocked_at: string | null;
  created_at: string;
  avatar_url: string | null;
}

interface FeatureRecord {
  user_id: string;
  feature_key: string;
  enabled: boolean;
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

/* Toggles shown per client */
const CLIENT_TOGGLES = [
  { key: "ia_comercial", label: "IA de Geração Comercial" },
  { key: "locutor_virtual", label: "Locutor Virtual (TTS)" },
  { key: "upload_vinhetas", label: "Módulo de Spots Próprios" },
  { key: "playlist_crente", label: "Playlist 'Crente' (Mood)" },
  { key: "biblioteca_trilhas", label: "Biblioteca de Trilhas" },
  { key: "programacao_playlists", label: "Programação de Playlists e Spots" },
  { key: "download_audios", label: "Download de Áudios/Spots" },
  { key: "modo_offline", label: "Modo Offline da Plataforma" },
  { key: "mixagem_volume", label: "Mixagem de Volume Independente" },
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

const ClientManagement = () => {
  const [clients, setClients] = useState<ClientProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [showNewClient, setShowNewClient] = useState(false);
  const [blockingId, setBlockingId] = useState<string | null>(null);
  const [copiedLink, setCopiedLink] = useState<string | null>(null);
  const [featureMap, setFeatureMap] = useState<Record<string, Record<string, boolean>>>({});
  const [togglingFeature, setTogglingFeature] = useState<string | null>(null);
  const [adminUserIds, setAdminUserIds] = useState<Set<string>>(new Set());
  const [editingProfile, setEditingProfile] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<{ nome: string; email: string; telefone: string }>({ nome: "", email: "", telefone: "" });
  const [savingProfile, setSavingProfile] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState<string | null>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [editingOwnerName, setEditingOwnerName] = useState(false);
  const [ownerNameDraft, setOwnerNameDraft] = useState("");
  const [ownerAvatarUrl, setOwnerAvatarUrl] = useState<string | null>(() => typeof window !== 'undefined' ? localStorage.getItem("owner-avatar-url") : null);
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
  const [savedAvatarStyles, setSavedAvatarStyles] = useState<Record<string, { zoom: number; x: number; y: number }>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const saved = localStorage.getItem("avatar-cover-styles");
      return saved ? JSON.parse(saved) : {};
    } catch { return {}; }
  });
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
    supabase.auth.getUser().then(({ data }) => {
      if (data?.user) {
        setCurrentUserId(data.user.id);
        setCurrentUserEmail(data.user.email ?? null);
      }
    });
  }, []);

  const fetchClients = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-clients", {
        body: { action: "list" },
      });
      if (error || data?.error) {
        console.warn("admin-clients error:", error || data?.error);
        setLoading(false);
        return;
      }
      if (data?.clients) setClients(data.clients);
      if (data?.features) {
        const map: Record<string, Record<string, boolean>> = {};
        (data.features as FeatureRecord[]).forEach((f) => {
          if (!map[f.user_id]) map[f.user_id] = {};
          map[f.user_id][f.feature_key] = f.enabled;
        });
        setFeatureMap(map);
      }
      if (data?.roles) {
        const admins = new Set<string>();
        (data.roles as RoleRecord[]).forEach((r) => {
          if (r.role === "admin") admins.add(r.user_id);
        });
        setAdminUserIds(admins);
      }
    } catch (err) {
      console.error("Error fetching clients:", err);
      toast({ title: "Erro ao carregar clientes", variant: "destructive" });
    }
    setLoading(false);
  }, [toast]);

  useEffect(() => { fetchClients(); }, [fetchClients]);

  const isFeatureEnabled = (userId: string, featureKey: string): boolean => {
    return featureMap[userId]?.[featureKey] !== false;
  };

  const handleToggleFeature = async (userId: string, featureKey: string, enabled: boolean) => {
    const toggleId = `${userId}-${featureKey}`;
    setTogglingFeature(toggleId);
    try {
      await supabase.functions.invoke("admin-clients?action=toggle-feature", {
        method: "POST",
        body: { user_id: userId, feature_key: featureKey, enabled },
      });
      setFeatureMap((prev) => ({
        ...prev,
        [userId]: { ...prev[userId], [featureKey]: enabled },
      }));
      toast({ title: enabled ? "Função ativada" : "Função desativada" });
    } catch {
      toast({ title: "Erro ao atualizar função", variant: "destructive" });
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
    setEditForm({ nome: client.nome || "", email: client.email || "", telefone: client.telefone || "" });
  };

  const saveProfile = async (userId: string) => {
    setSavingProfile(true);
    try {
      await supabase.functions.invoke("admin-clients?action=update", {
        method: "POST",
        body: { user_id: userId, updates: { nome: editForm.nome || null, email: editForm.email || null, telefone: editForm.telefone || null } },
      });
      setClients((prev) =>
        prev.map((c) =>
          c.user_id === userId ? { ...c, nome: editForm.nome || null, email: editForm.email || null, telefone: editForm.telefone || null } : c
        )
      );
      setEditingProfile(null);
      toast({ title: "Perfil atualizado com sucesso!" });
    } catch {
      toast({ title: "Erro ao salvar perfil", variant: "destructive" });
    }
    setSavingProfile(false);
  };

  /* ─── Direct avatar upload (click to change, auto-save like music covers) ─── */
  const handleDirectAvatarUpload = async (
    userId: string,
    file: File,
    options?: { syncTopIcon?: boolean }
  ) => {
    const shouldSyncTopIcon = options?.syncTopIcon === true;
    const persistedOwnerId = localStorage.getItem("owner-avatar-user-id");
    const fallbackAvatarKey = (userId || "").trim() || persistedOwnerId || OWNER_LOCAL_AVATAR_ID;

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
      const { data: sessionData } = await supabase.auth.getSession();
      const sessionId = sessionData?.session?.user?.id;
      if (isValidUuid(sessionId)) {
        resolvedId = sessionId;
        setCurrentUserId(sessionId);
      }
    }

    if (!isValidUuid(resolvedId)) {
      const { data: authData } = await supabase.auth.getUser();
      const freshId = authData?.user?.id;
      if (isValidUuid(freshId)) {
        resolvedId = freshId;
        setCurrentUserId(freshId);
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
      const ext = file.name.split(".").pop() || "png";
      const path = `${fallbackAvatarKey}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });

      let avatarUrl: string;
      if (!uploadErr) {
        const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
        avatarUrl = urlData.publicUrl + "?t=" + Date.now();
      } else {
        const reader = new FileReader();
        const fileDataUrl = await new Promise<string>((resolve) => {
          reader.onload = () => resolve(reader.result as string);
          reader.readAsDataURL(file);
        });

        const { data: fallbackUploadData, error: fallbackUploadError } = await supabase.functions.invoke("admin-clients?action=avatar-upload", {
          body: {
            file_base64: fileDataUrl,
            file_ext: ext,
            user_id: isValidUuid(resolvedId) ? resolvedId : fallbackAvatarKey,
          },
        });

        if (!fallbackUploadError && fallbackUploadData?.avatar_url) {
          avatarUrl = `${String(fallbackUploadData.avatar_url).split("?")[0]}?t=${Date.now()}`;
        } else {
          avatarUrl = fileDataUrl;
        }
      }

      if (isValidUuid(resolvedId)) {
        const { data, error } = await supabase.functions.invoke("admin-clients?action=update", {
          body: { user_id: resolvedId, updates: { avatar_url: avatarUrl } },
        });
        if (error) throw error;
        if (data?.error) throw new Error(data.error);

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
              telefone: null,
              status: "ativo",
              blocked_at: null,
              created_at: new Date().toISOString(),
              avatar_url: avatarUrl,
            },
            ...prev,
          ];
        });
      }

      if (shouldSyncTopIcon) {
        const syncUserId = isValidUuid(resolvedId) ? resolvedId : null;
        setOwnerAvatarUrl(avatarUrl);
        localStorage.setItem("owner-avatar-url", avatarUrl);
        if (syncUserId) localStorage.setItem("owner-avatar-user-id", syncUserId);
        window.dispatchEvent(new CustomEvent("owner-avatar-updated", {
          detail: {
            userId: syncUserId,
            avatarUrl,
            avatarStyle: syncUserId ? (savedAvatarStyles[syncUserId] ?? null) : null,
          },
        }));
      }

      // Sync avatar to cloud for public access
      const baseAvatarUrl = avatarUrl.split("?")[0];
      if (!baseAvatarUrl.startsWith("data:")) {
        void supabase.functions.invoke("admin-clients?action=avatar-set", {
          body: { avatar_url: baseAvatarUrl, user_id: isValidUuid(resolvedId) ? resolvedId : null },
        });
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
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setChangingPassword(false);
      setShowPassword(false);
      toast({ title: "Senha alterada com sucesso!" });
    } catch (err: any) {
      if (isSessionError(err)) {
        setNewPassword("");
        setChangingPassword(false);
        setShowPassword(false);
        toast({ title: "No preview sem login, a senha não é salva." });
        return;
      }

      toast({ title: "Erro ao alterar senha" });
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
      const { data, error } = await supabase.functions.invoke("admin-clients?action=update", {
        method: "POST",
        body: { user_id: ownerCardProfile.user_id, updates: { nome: ownerNameDraft || null } },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setClients((prev) => prev.map((c) => c.user_id === ownerCardProfile.user_id ? { ...c, nome: ownerNameDraft || null } : c));
      setEditingOwnerName(false);
      toast({ title: "Nome atualizado!" });
    } catch {
      toast({ title: "Erro ao salvar nome" });
    }
    setSavingProfile(false);
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

  useEffect(() => {
    if (!ownerProfile?.avatar_url) return;
    setOwnerAvatarUrl(ownerProfile.avatar_url);
    // NOTE: do NOT write ownerProfile.avatar_url to localStorage here —
    // that would overwrite the avatar the user explicitly uploaded via the panel.
  }, [ownerProfile?.avatar_url]);

  const fallbackOwnerId = currentUserId || localStorage.getItem("owner-avatar-user-id") || OWNER_LOCAL_AVATAR_ID;

  const ownerCardProfile: ClientProfile | null = ownerProfile ?? {
    id: fallbackOwnerId,
    user_id: fallbackOwnerId,
    nome: "Proprietário",
    email: currentUserEmail,
    telefone: null,
    status: "ativo",
    blocked_at: null,
    created_at: new Date().toISOString(),
    avatar_url: ownerAvatarUrl,
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

  /* ─── Avatar style save/load (same as playlist covers) ─── */
  const saveAvatarStyle = useCallback((userId: string, zoom: number, x: number, y: number, syncTopIcon = false) => {
    const style = { zoom: normalizeZoom(zoom), x, y };
    setSavedAvatarStyles((prev) => {
      const next = { ...prev, [userId]: style };
      localStorage.setItem("avatar-cover-styles", JSON.stringify(next));
      return next;
    });

    if (syncTopIcon) {
      localStorage.setItem("owner-avatar-user-id", userId);
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

  const handleAvatarDragStart = (e: React.PointerEvent<HTMLImageElement>) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    setAvatarDragStart({ x: e.clientX - avatarTempOffset.x, y: e.clientY - avatarTempOffset.y });
  };
  const handleAvatarDragMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!avatarDragStart) return;
    setAvatarTempOffset({ x: e.clientX - avatarDragStart.x, y: e.clientY - avatarDragStart.y });
  };
  const handleAvatarDragEnd = () => setAvatarDragStart(null);

  /* ─── Avatar Drop Zone with same interaction style as playlist covers ─── */
  const AvatarDropZone = ({ client, large = false, disabled = false }: { client: ClientProfile; large?: boolean; disabled?: boolean }) => {
    const fileRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const px = large ? "h-24 w-24" : "h-10 w-10";
    const avatarId = (client.user_id || "").trim() || OWNER_LOCAL_AVATAR_ID;
    const isOwnerAvatar = avatarId === ownerCardProfile?.user_id;
    const isRepositioning = avatarRepositioning === avatarId;

    const handleFile = (file: File) => {
      if (disabled) return;
      if (file && file.type.startsWith("image/")) {
        handleDirectAvatarUpload(avatarId, file, { syncTopIcon: isOwnerAvatar });
      }
    };

    const onDrop = (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      const file = e.dataTransfer.files?.[0];
      if (file) handleFile(file);
    };

    const startReposition = (e: React.MouseEvent) => {
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

    const savedStyle = savedAvatarStyles[avatarId];
    const adjustZoom = (delta: number) => {
      setAvatarZoom((prev) => normalizeZoom(prev + delta));
    };

    return (
      <div
        data-avatar-id={avatarId}
        className={`relative group shrink-0 pointer-events-auto ${disabled ? "cursor-not-allowed opacity-70" : "cursor-pointer"} ${isDragOver ? "ring-2 ring-primary ring-offset-2 ring-offset-background rounded-full" : ""}`}
        onMouseDown={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={() => {
          if (disabled || isRepositioning || uploadingAvatar === avatarId) return;
          fileRef.current?.click();
        }}
        onDragOver={(e) => { if (disabled) return; e.preventDefault(); setIsDragOver(true); }}
        onDragLeave={() => !disabled && setIsDragOver(false)}
        onDrop={onDrop}
      >
        <div
          className={`${px} rounded-full overflow-hidden border-2 ${isRepositioning ? "border-primary" : "border-primary/60"} shadow-lg bg-muted`}
          onPointerMove={isRepositioning ? handleAvatarDragMove : undefined}
          onPointerUp={isRepositioning ? handleAvatarDragEnd : undefined}
          onPointerCancel={isRepositioning ? handleAvatarDragEnd : undefined}
          onPointerLeave={isRepositioning ? handleAvatarDragEnd : undefined}
        >
          {client.avatar_url ? (
            <img
              src={client.avatar_url}
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
              onPointerDown={isRepositioning ? handleAvatarDragStart : undefined}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Camera className={`${large ? "h-8 w-8" : "h-4 w-4"} text-muted-foreground`} />
            </div>
          )}
        </div>

        {/* Hover overlay with actions — centered */}
        {!isRepositioning && (
          <div className="absolute inset-0 rounded-full bg-black/0 group-hover:bg-black/30 transition-all duration-200 opacity-0 group-hover:opacity-100">
            <div className="absolute top-1 left-1/2 -translate-x-1/2 flex items-center gap-1.5">
              {uploadingAvatar === avatarId ? (
                <div className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center">
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <>
                  <button
                    className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                    onClick={(e) => { e.stopPropagation(); e.preventDefault(); fileRef.current?.click(); }}
                    title="Trocar foto (galeria ou câmera)"
                  >
                    <Camera className="h-3 w-3" />
                  </button>
                  {client.avatar_url && large && (
                    <button
                      className="w-6 h-6 rounded-full bg-background/80 backdrop-blur-sm flex items-center justify-center text-muted-foreground hover:text-primary hover:bg-background transition-colors"
                      onClick={startReposition}
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

        {/* Smooth and precise zoom controls */}
        {isRepositioning && large && (
          <div className="absolute inset-0 border-2 border-primary/50 rounded-full overflow-hidden pointer-events-none">
            <div
              className="absolute bottom-1 left-1.5 right-1.5 pointer-events-auto"
              onClick={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div className="bg-background/90 backdrop-blur-sm rounded-full px-1.5 py-1 flex items-center gap-1">
                <button
                  type="button"
                  className="h-5 w-5 rounded-full bg-muted text-foreground text-xs leading-none hover:bg-muted/80 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    adjustZoom(-0.02);
                  }}
                  aria-label="Diminuir zoom"
                  title="Diminuir zoom"
                >
                  −
                </button>
                <Slider
                  min={AVATAR_ZOOM_MIN}
                  max={AVATAR_ZOOM_MAX}
                  step={0.005}
                  value={[avatarZoom]}
                  onValueChange={(v) => setAvatarZoom(normalizeZoom(v[0]))}
                  className="flex-1 touch-none [&_[role=slider]]:h-3.5 [&_[role=slider]]:w-3.5 [&_[role=slider]]:border-primary [&_.relative]:h-1.5"
                />
                <button
                  type="button"
                  className="h-5 w-5 rounded-full bg-muted text-foreground text-xs leading-none hover:bg-muted/80 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    adjustZoom(0.02);
                  }}
                  aria-label="Aumentar zoom"
                  title="Aumentar zoom"
                >
                  +
                </button>
              </div>
            </div>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = "";
          }}
        />
      </div>
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
      if (newPassword && newPassword.length >= 6) {
        handleChangePassword();
      } else if (!newPassword) {
        setChangingPassword(false);
        setShowPassword(false);
      }
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
              <AvatarDropZone client={ownerCardProfile} large />
              {avatarRepositioning === ownerCardProfile.user_id && (
                <span className="text-[10px] text-muted-foreground">Arraste para reposicionar</span>
              )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
              {/* Usuário */}
              <div className="mb-3">
                <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-widest mb-1">Usuário</p>
                {editingOwnerName ? (
                  <Input
                    value={ownerNameDraft}
                    onChange={(e) => setOwnerNameDraft(e.target.value)}
                    className="h-8 text-sm max-w-[200px]"
                    placeholder="Seu nome de usuário"
                    autoFocus
                    onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
                    onBlur={handleOwnerNameBlur}
                  />
                ) : (
                  <div className="flex items-center gap-2 cursor-pointer" onClick={() => { setEditingOwnerName(true); setOwnerNameDraft(ownerCardProfile.nome || ""); }}>
                    <p className="text-sm font-bold text-foreground">{ownerCardProfile.nome || "Proprietário"}</p>
                    <ShieldCheck className="h-4 w-4 text-green-500" />
                  </div>
                )}
              </div>

              {/* Senha + Add ADM Funcionário lado a lado */}
              <div className="flex items-start gap-4 flex-wrap">
                <div>
                  <p className="text-[10px] text-yellow-600 font-bold uppercase tracking-widest mb-1">Senha</p>
                  {changingPassword ? (
                    <div className="relative">
                      <Input
                        type={showPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Nova senha (min. 6)"
                        className="h-8 text-xs w-44 pr-8"
                        autoFocus
                        onKeyDown={(e) => e.key === "Enter" && (e.currentTarget.blur())}
                        onBlur={handlePasswordBlur}
                      />
                      <button
                        type="button"
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground z-10"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 cursor-pointer" onClick={() => setChangingPassword(true)}>
                      <p className="text-sm text-muted-foreground">••••••••</p>
                      <button
                        type="button"
                        className="text-muted-foreground hover:text-foreground transition-colors"
                        onClick={(e) => { e.stopPropagation(); setShowPassword((p) => !p); }}
                      >
                        <KeyRound className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )}
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
              <input ref={secondaryAdminFileRef} type="file" accept="image/*" className="hidden" onChange={handleSADMAvatarFile} />
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

  /* ═══════════════════════════════════════════ */
  /* ─────────── MAIN RENDER ─────────── */
  /* ═══════════════════════════════════════════ */
  return (
    <div className="space-y-4">
      {/* Dialogs */}
      <SecondaryAdminDialog />

      <div className="space-y-4 pb-2 bg-background">
        {/* Owner Panel - always visible at top */}
        {!loading && ownerCardProfile && <OwnerPanel />}

        {/* Clients header + search */}
        <div className="bg-card rounded-xl p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            Empresas / Clientes
          </h3>
          <Button
            size="sm"
            onClick={() => setShowNewClient(!showNewClient)}
            className="text-xs bg-primary text-primary-foreground hover:bg-primary hover:text-white hover:[text-shadow:0_0_8px_rgba(255,255,255,0.9)] active:bg-primary focus:bg-primary transition-all"
          >
            <UserPlus className="h-3.5 w-3.5 mr-1" />
            {showNewClient ? "Fechar Cadastro" : "Novo Cliente"}
          </Button>
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar por nome ou e-mail..."
            className="pl-9"
          />
        </div>
        </div>
      </div>

      {showNewClient && (
        <div className="animate-in fade-in duration-[600ms]">
          <ManualClientForm />
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : regularClients.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground text-sm">
          {searchTerm ? "Nenhum cliente encontrado." : "Nenhum cliente cadastrado ainda."}
        </div>
      ) : (
        /* ─── Client list (table-like) ─── */
        <div className="bg-card rounded-xl overflow-hidden">
          {/* Table header */}
          <div className="grid grid-cols-[auto_1fr_1fr_100px_80px] gap-4 px-5 py-3 bg-secondary/30 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            <span className="w-10" />
            <span>Nome</span>
            <span className="hidden sm:block">E-mail</span>
            <span>Situação</span>
            <span className="text-right">Ações</span>
          </div>

          {regularClients.map((client) => {
            const isExpanded = expandedClient === client.user_id;
            const isBlocked = client.status === "bloqueado";
            const isBlocking = blockingId === client.user_id;
            const isEditing = editingProfile === client.user_id;

            return (
              <div key={client.id} className={`transition-colors ${isBlocked ? "bg-destructive/5" : "hover:bg-secondary/20"}`}>
                {/* Row */}
                <button
                  onClick={() => {
                    const next = isExpanded ? null : client.user_id;
                    setExpandedClient(next);
                    if (next) fetchClientActivity(client.user_id);
                  }}
                  className="w-full grid grid-cols-[auto_1fr_1fr_100px_80px] gap-4 px-5 py-3.5 items-center text-left"
                >
                  <div className="w-10 flex justify-center">
                    <AvatarDropZone client={client} />
                  </div>
                  <p className="text-sm font-semibold text-foreground truncate">{client.nome || "Sem nome"}</p>
                  <p className="text-sm text-muted-foreground truncate hidden sm:block">{client.email || "—"}</p>
                  <Badge variant={isBlocked ? "destructive" : "secondary"} className="text-[10px] w-fit">
                    {isBlocked ? <><ShieldAlert className="h-3 w-3 mr-1" /> Bloqueado</> : <><ShieldCheck className="h-3 w-3 mr-1" /> Ativo</>}
                  </Badge>
                  <div className="flex items-center justify-end gap-1">
                    {isExpanded ? <ChevronDown className="h-4 w-4 text-primary" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  </div>
                </button>

                {/* ─── Expanded Panel ─── */}
                {isExpanded && (
                  <div className="px-5 pb-5 space-y-5 animate-in fade-in duration-[400ms] pt-4 bg-secondary/10">

                    {/* Profile Info */}
                    <div className="flex items-start gap-4">
                      <AvatarDropZone client={client} large />
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Nome</label>
                              <Input value={editForm.nome} onChange={(e) => setEditForm((f) => ({ ...f, nome: e.target.value }))} className="h-9 text-sm" onClick={(e) => e.stopPropagation()} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">E-mail</label>
                              <Input value={editForm.email} onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))} className="h-9 text-sm" onClick={(e) => e.stopPropagation()} />
                            </div>
                            <div>
                              <label className="text-xs text-muted-foreground mb-1 block">Telefone</label>
                              <Input value={editForm.telefone} onChange={(e) => setEditForm((f) => ({ ...f, telefone: e.target.value }))} className="h-9 text-sm" onClick={(e) => e.stopPropagation()} />
                            </div>
                            <div className="flex items-end gap-2">
                              <Button size="sm" className="text-xs bg-primary text-primary-foreground" disabled={savingProfile} onClick={(e) => { e.stopPropagation(); saveProfile(client.user_id); }}>
                                {savingProfile ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Save className="h-3.5 w-3.5 mr-1" />} Salvar
                              </Button>
                              <Button size="sm" variant="ghost" className="text-xs" onClick={(e) => { e.stopPropagation(); setEditingProfile(null); }}>Cancelar</Button>
                            </div>
                          </div>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-3">
                              <div>
                                <p className="text-[10px] text-primary font-bold uppercase tracking-widest">Responsável</p>
                                <p className="text-sm font-semibold text-foreground mt-0.5">{client.nome || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-primary font-bold uppercase tracking-widest">E-mail</p>
                                <p className="text-sm text-foreground mt-0.5 truncate">{client.email || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-primary font-bold uppercase tracking-widest">Contato</p>
                                <p className="text-sm text-foreground mt-0.5">{client.telefone || "—"}</p>
                              </div>
                              <div>
                                <p className="text-[10px] text-primary font-bold uppercase tracking-widest">Cadastro</p>
                                <p className="text-sm text-foreground mt-0.5">{formatDate(client.created_at)}</p>
                              </div>
                            </div>
                            <Button size="sm" variant="outline" className="text-xs text-primary" onClick={(e) => { e.stopPropagation(); startEditProfile(client); }}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Editar Perfil
                            </Button>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Block control */}
                    <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30">
                      <div className="flex items-center gap-2">
                        {isBlocked ? <Lock className="h-4 w-4 text-destructive" /> : <Unlock className="h-4 w-4 text-primary" />}
                        <div>
                          <p className="text-sm font-medium text-foreground">Bloqueio Geral</p>
                          <p className="text-[10px] text-muted-foreground">{isBlocked ? "Serviços suspensos" : "Acesso ativo"}</p>
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant={isBlocked ? "outline" : "destructive"}
                        disabled={isBlocking}
                        onClick={(e) => { e.stopPropagation(); handleBlock(client.user_id, !isBlocked); }}
                      >
                        {isBlocking ? <Loader2 className="h-4 w-4 animate-spin" /> : isBlocked ? <><Unlock className="h-3.5 w-3.5 mr-1" /> Desbloquear</> : <><Lock className="h-3.5 w-3.5 mr-1" /> Bloquear</>}
                      </Button>
                    </div>

                    {/* Services & Links */}
                    {services.length > 0 && (
                      <div>
                        <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <Link2 className="h-3.5 w-3.5" /> Serviços & Links
                        </h4>
                        <div className="grid gap-1.5">
                          {services.map((service) => {
                            const linkKey = `${client.user_id}-${service}`;
                            const isCopied = copiedLink === linkKey;
                            return (
                              <div key={service} className="flex items-center justify-between p-2.5 rounded-lg bg-card">
                                <span className="text-sm text-foreground font-medium">{service}</span>
                                <Button size="sm" variant="ghost" className="text-xs text-primary" onClick={(e) => { e.stopPropagation(); copyLink(client.user_id, service); }}>
                                  {isCopied ? <><Check className="h-3.5 w-3.5 mr-1" /> Copiado</> : <><Copy className="h-3.5 w-3.5 mr-1" /> Copiar</>}
                                </Button>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* ─── Permission Toggles ─── */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Settings2 className="h-3.5 w-3.5" /> Controle de Permissões
                      </h4>
                      <div className="grid gap-1.5 sm:grid-cols-2">
                        {CLIENT_TOGGLES.map((feat) => {
                          const enabled = isFeatureEnabled(client.user_id, feat.key);
                          const toggleId = `${client.user_id}-${feat.key}`;
                          const isToggling = togglingFeature === toggleId;
                          return (
                            <div key={feat.key} className="flex items-center justify-between p-2.5 rounded-lg bg-card">
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-foreground">{feat.label}</span>
                                {isToggling && <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />}
                              </div>
                              <Switch
                                checked={enabled}
                                disabled={isToggling}
                                onCheckedChange={(checked) => handleToggleFeature(client.user_id, feat.key, checked)}
                              />
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* ─── Activity Feed ─── */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <Activity className="h-3.5 w-3.5" /> Atividade Recente
                      </h4>
                      {loadingActivity === client.user_id ? (
                        <div className="flex items-center gap-2 py-3 text-xs text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Carregando...
                        </div>
                      ) : (clientActivity[client.user_id] || []).length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2">Nenhuma atividade registrada.</p>
                      ) : (
                        <div className="max-h-48 overflow-y-auto rounded-lg">
                          <Table>
                            <TableHeader>
                              <TableRow className="text-[10px]">
                                <TableHead className="h-8 text-xs">Ação</TableHead>
                                <TableHead className="h-8 text-xs">Detalhes</TableHead>
                                <TableHead className="h-8 text-xs text-right">Quando</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {(clientActivity[client.user_id] || []).map((act) => (
                                <TableRow key={act.id} className="text-xs">
                                  <TableCell className="py-1.5 text-xs">{formatActivityType(act.activity_type)}</TableCell>
                                  <TableCell className="py-1.5 text-xs text-muted-foreground truncate max-w-[200px]">
                                    {act.artist || act.search_query || act.genre || "—"}
                                  </TableCell>
                                  <TableCell className="py-1.5 text-xs text-right text-muted-foreground">{formatDate(act.created_at)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      )}
                    </div>

                    {/* ─── Sub-Users placeholder ─── */}
                    <div>
                      <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
                        <UsersRound className="h-3.5 w-3.5" /> Sub-Usuários (Funcionários)
                      </h4>
                      <p className="text-xs text-muted-foreground py-2 italic">Módulo de sub-usuários será habilitado em breve.</p>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ClientManagement;