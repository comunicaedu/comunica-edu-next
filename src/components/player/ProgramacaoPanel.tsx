"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { motion } from "framer-motion";
import {
  CalendarClock,
  Loader2,
  Clock3,
  Settings2,
  ListMusic,
  Play,
  Pause,
  CheckCircle2,
  Search,
  Check,
  Link2,
  Volume2,
  User,
} from "lucide-react";
import { supabase } from "@/lib/supabase/client";
import { useSessionStore } from "@/stores/sessionStore";
import { Switch } from "@/components/ui/switch";
import { ALL_CLIENT_FEATURES } from "@/hooks/useClientFeatures";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Checkbox } from "@/components/ui/checkbox";
import PlaylistScheduleDialog from "@/components/player/PlaylistScheduleDialog";
import GroupScheduleDialog from "@/components/player/GroupScheduleDialog";
import {
  formatScheduleRange,
  isScheduleActiveAt,
  ScheduleWindow,
} from "@/lib/scheduleUtils";
import { toast } from "sonner";
import { format } from "date-fns";

interface PlaylistItem {
  id: string;
  name: string;
  created_by: string | null;
  cover_url: string | null;
  songCount?: number;
}

interface ScheduledSpotItem {
  spotId: string;
  spotTitle: string;
  userId: string;
  scheduleStart: string | null;
  scheduleEnd: string | null;
}

const getSpotStatus = (item: ScheduledSpotItem, now: Date): ScheduleStatus => {
  const today = now.toISOString().slice(0, 10);
  // scheduleStart/End are datetimes ("2026-04-12T18:51") — extract date-only for comparison
  const start = item.scheduleStart ? item.scheduleStart.slice(0, 10) : null;
  const end   = item.scheduleEnd   ? item.scheduleEnd.slice(0, 10)   : null;
  if (end && today > end) return "concluida";
  if (start && today < start) return "agendada";
  if ((!start || today >= start) && (!end || today <= end)) return "executando";
  return "agendada";
};

type ScheduleStatus = "agendada" | "executando" | "concluida" | "desativada";

const getScheduleStatus = (schedule: ScheduleWindow, now: Date): ScheduleStatus => {
  if (!(schedule.is_active ?? schedule.active ?? true)) return "desativada";

  // Use the same logic as the automation hook so panel and playback always agree
  if (isScheduleActiveAt(schedule, now)) return "executando";

  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const endDate = schedule.end_date || null;

  // If end_date is in the past → Concluída
  if (endDate && todayStr > endDate) return "concluida";

  // Check if today has already passed the time window (and today is a scheduled day)
  const today = now.getDay();
  if (schedule.days_of_week?.includes(today)) {
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const [endH, endM] = schedule.end_time.split(":").map(Number);
    const [startH, startM] = schedule.start_time.split(":").map(Number);
    const endMinutes = endH * 60 + endM;
    const startMinutes = startH * 60 + startM;
    if (startMinutes < endMinutes && nowMinutes >= endMinutes) return "concluida";
  }

  return "agendada";
};

const StatusBadge = ({ status }: { status: ScheduleStatus }) => {
  switch (status) {
    case "executando":
      return (
        <Badge className="bg-green-500/15 text-green-400 border-green-500/30 text-[10px] px-1.5 py-0 gap-1 pointer-events-none">
          <Play className="h-2.5 w-2.5 fill-current" /> Executando
        </Badge>
      );
    case "concluida":
      return (
        <Badge className="bg-muted/50 text-muted-foreground border-border text-[10px] px-1.5 py-0 gap-1 pointer-events-none">
          <CheckCircle2 className="h-2.5 w-2.5" /> Concluída
        </Badge>
      );
    case "desativada":
      return (
        <Badge className="bg-muted/30 text-muted-foreground/60 border-border/50 text-[10px] px-1.5 py-0 gap-1 pointer-events-none">
          <Pause className="h-2.5 w-2.5" /> Desativada
        </Badge>
      );
    case "agendada":
    default:
      return (
        <Badge className="bg-primary/15 text-primary border-primary/30 text-[10px] px-1.5 py-0 gap-1 pointer-events-none">
          <Clock3 className="h-2.5 w-2.5" /> Agendada
        </Badge>
      );
  }
};

const PROG_TABS = new Set(["active", "schedule", "extras"]);
const MAX_GROUP_SELECTION = 50;

const STATUS_ORDER: Record<ScheduleStatus, number> = {
  executando: 0,
  agendada: 1,
  desativada: 2,
  concluida: 3,
};

const getProgramacaoTabFromSearch = (searchParams: URLSearchParams): string | null => {
  const tab = searchParams.get("tab");
  return tab && PROG_TABS.has(tab) ? tab : null;
};

const ProgramacaoPanel = () => {
  const searchParams = useSearchParams();
  const urlTab = getProgramacaoTabFromSearch(searchParams);
  const activeTab = urlTab ?? "extras";

  const handleTabChange = (value: string) => {
    if (!PROG_TABS.has(value)) return;
    const next = new URLSearchParams(window.location.search);
    next.set("tab", value);
    window.history.replaceState(null, "", `${window.location.pathname}?${next.toString()}`);
  };

  // ── Configurações: features do cliente ────────────────────────────────────
  const [clientFeatures, setClientFeatures] = useState<Record<string, { enabled: boolean; limit_value: number | null }>>({});
  const [clientUserId, setClientUserId] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  useEffect(() => {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    const user = useSessionStore.getState().user;
    if (!user?.id) return;
    setClientUserId(user.id);

    const loadFeatures = () => {
      if (cancelled) return;
      supabase.from("client_features").select("feature_key, enabled, limit_value").eq("user_id", user.id)
        .then(({ data }) => {
          if (cancelled) return;
          const map: Record<string, { enabled: boolean; limit_value: number | null }> = {};
          ALL_CLIENT_FEATURES.forEach(f => { map[f.key] = { enabled: false, limit_value: 0 }; });
          if (data) {
            data.forEach((f: any) => { map[f.feature_key] = { enabled: f.enabled, limit_value: f.limit_value ?? 0 }; });
          }
          setClientFeatures(map);
        });
    };

    loadFeatures();

    // Nome único por instância evita reutilização interna do Supabase (problema no StrictMode)
    channel = supabase.channel(`client_features:${user.id}:${Math.random()}`)
      .on("postgres_changes", {
        event: "*",
        schema: "public",
        table: "client_features",
        filter: `user_id=eq.${user.id}`,
      }, () => { loadFeatures(); })
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) { supabase.removeChannel(channel); channel = null; }
    };
  }, []);

  const handleFeatureToggle = async (key: string, current: boolean) => {
    if (!clientUserId) return;
    setClientFeatures(prev => ({ ...prev, [key]: { ...prev[key], enabled: !current } }));
    await supabase.from("client_features").update({ enabled: !current }).eq("user_id", clientUserId).eq("feature_key", key);
  };
  // ──────────────────────────────────────────────────────────────────────────

  const [initialLoading, setInitialLoading] = useState(true);
  const [playlists, setPlaylists] = useState<PlaylistItem[]>([]);
  const [schedulesByPlaylist, setSchedulesByPlaylist] = useState<Record<string, ScheduleWindow>>({});
  const [schedulePlaylist, setSchedulePlaylist] = useState<PlaylistItem | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [groupScheduleOpen, setGroupScheduleOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [scheduledSpots, setScheduledSpots] = useState<ScheduledSpotItem[]>([]);
  const [clientNames, setClientNames] = useState<Record<string, string>>({});
  const [now, setNow] = useState(new Date());

  // Real-time clock: 10s is enough since schedule status changes at minute boundaries.
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(interval);
  }, []);

  const fetchData = useCallback(async () => {
    const storeUser = useSessionStore.getState().user;
    const uid = storeUser?.id ?? null;
    setCurrentUserId(uid);

    // Verifica se é admin
    let callerIsAdmin = false;
    if (uid) {
      const { data: roleRow } = await supabase
        .from("user_roles").select("role").eq("user_id", uid).eq("role", "admin").maybeSingle();
      callerIsAdmin = !!roleRow;
      setIsAdmin(callerIsAdmin);
    }

    // Queries paralelas
    let schedulesQuery = supabase.from("playlist_schedules").select("*");
    let spotConfigsQuery = supabase.from("spot_configs")
      .select("spot_id, user_id, schedule_start, schedule_end")
      .not("schedule_start", "is", null);

    // Cliente só vê as suas próprias programações
    if (!callerIsAdmin && uid) {
      schedulesQuery = schedulesQuery.eq("user_id", uid);
      spotConfigsQuery = spotConfigsQuery.eq("user_id", uid);
    }

    const [playlistsResponse, schedulesResponse, spotsResponse, spotConfigsResponse] = await Promise.all([
      supabase.from("playlists").select("id, name, created_by, cover_url, playlist_songs(count)").order("name", { ascending: true }),
      schedulesQuery,
      supabase.from("spots").select("id, title, user_id"),
      spotConfigsQuery,
    ]);

    if (playlistsResponse.error) {
      toast.error("Erro ao carregar playlists.");
      setInitialLoading(false);
      return;
    }

    const enriched = (playlistsResponse.data || []).map((p: any) => ({
      id: p.id,
      name: p.name,
      created_by: p.created_by,
      cover_url: p.cover_url,
      songCount: (p.playlist_songs as Array<{ count: number }> | null)?.[0]?.count ?? 0,
    }));
    setPlaylists(enriched);

    const deduped = new Map<string, ScheduleWindow>();
    (schedulesResponse.data || []).forEach((schedule: any) => {
      if (!deduped.has(schedule.playlist_id)) {
        deduped.set(schedule.playlist_id, {
          ...schedule,
          start_date: schedule.start_date || null,
          end_date: schedule.end_date || null,
        } as ScheduleWindow);
      }
    });
    setSchedulesByPlaylist(Object.fromEntries(deduped.entries()));

    // Monta lista de spots agendados
    const spotMap: Record<string, { title: string; user_id: string }> = {};
    (spotsResponse.data || []).forEach((s: any) => { spotMap[s.id] = { title: s.title, user_id: s.user_id }; });

    const spots: ScheduledSpotItem[] = (spotConfigsResponse.data || [])
      .filter((c: any) => spotMap[c.spot_id])
      .map((c: any) => ({
        spotId: c.spot_id,
        spotTitle: spotMap[c.spot_id]?.title ?? c.spot_id,
        userId: c.user_id,
        scheduleStart: c.schedule_start,
        scheduleEnd: c.schedule_end,
      }));
    setScheduledSpots(spots);

    // Para admin: busca nomes dos clientes
    if (callerIsAdmin) {
      const allUserIds = [
        ...new Set([
          ...(schedulesResponse.data || []).map((s: any) => s.user_id).filter(Boolean),
          ...spots.map((s) => s.userId).filter(Boolean),
        ]),
      ];
      if (allUserIds.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles").select("user_id, display_name, username").in("user_id", allUserIds);
        const names: Record<string, string> = {};
        (profiles || []).forEach((p: any) => {
          names[p.user_id] = p.display_name || p.username || p.user_id.slice(0, 8);
        });
        setClientNames(names);
      }
    }

    setInitialLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    // Debounce realtime events so rapid saves don't trigger multiple fetches
    let debounceTimer: number | null = null;
    const debouncedFetch = () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      debounceTimer = window.setTimeout(() => fetchData(), 400);
    };
    const channel = supabase
      .channel("programacao-schedules")
      .on("postgres_changes", { event: "*", schema: "public", table: "playlist_schedules" }, debouncedFetch)
      .subscribe();
    // Atualiza imediatamente quando qualquer dialog salva um agendamento (mesmo em outra seção)
    window.addEventListener("schedule-saved", debouncedFetch);
    window.addEventListener("spot-configs-changed", debouncedFetch);
    return () => {
      if (debounceTimer !== null) clearTimeout(debounceTimer);
      supabase.removeChannel(channel);
      window.removeEventListener("schedule-saved", debouncedFetch);
      window.removeEventListener("spot-configs-changed", debouncedFetch);
    };
  }, [fetchData]);

  // Order is computed only when data changes (not every second) to prevent the
  // list from visually jumping on every clock tick. Status badges still update
  // every second because they read `now` during render.
  const scheduledPlaylists = useMemo(() => {
    const filtered = playlists.filter((p) => schedulesByPlaylist[p.id]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    const snapshot = new Date();
    return [...filtered].sort((a, b) => {
      const sa = getScheduleStatus(schedulesByPlaylist[a.id], snapshot);
      const sb = getScheduleStatus(schedulesByPlaylist[b.id], snapshot);
      return STATUS_ORDER[sa] - STATUS_ORDER[sb];
    });
  }, [playlists, schedulesByPlaylist]);

  const filteredPlaylists = useMemo(() => {
    if (!searchTerm.trim()) return playlists;
    const term = searchTerm.toLowerCase();
    return playlists.filter((p) => p.name.toLowerCase().includes(term));
  }, [playlists, searchTerm]);

  const selectedGroupPlaylists = useMemo(
    () => playlists.filter((p) => selectedIds.has(p.id)).slice(0, MAX_GROUP_SELECTION),
    [playlists, selectedIds]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      if (!prev.has(id) && prev.size >= MAX_GROUP_SELECTION) {
        toast.error(`Você pode selecionar no máximo ${MAX_GROUP_SELECTION} playlists por grupo.`);
        return prev;
      }

      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    const selectableIds = filteredPlaylists.slice(0, MAX_GROUP_SELECTION).map((p) => p.id);
    const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selectedIds.has(id));

    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableIds));
      if (filteredPlaylists.length > MAX_GROUP_SELECTION) {
        toast.info(`Foram selecionadas as primeiras ${MAX_GROUP_SELECTION} playlists.`);
      }
    }
  };

  const getOwnerLabel = (createdBy: string | null) => {
    if (!createdBy) return "Plataforma";
    if (createdBy === currentUserId) return "Minha";
    return "Compartilhada";
  };

  const formatDateRange = (schedule: ScheduleWindow) => {
    const parts: string[] = [];
    parts.push(formatScheduleRange(schedule.start_time, schedule.end_time));
    if (schedule.start_date && schedule.end_date) {
      const sd = schedule.start_date.replace(/-/g, "/");
      const ed = schedule.end_date.replace(/-/g, "/");
      // Show short dates dd/MM
      const startParts = sd.split("/");
      const endParts = ed.split("/");
      if (startParts.length >= 3 && endParts.length >= 3) {
        parts.push(`${schedule.start_date.slice(8)}/${schedule.start_date.slice(5, 7)} → ${schedule.end_date.slice(8)}/${schedule.end_date.slice(5, 7)}`);
      }
    }
    return parts.join(" • ");
  };

  const formatStartEndLabel = (schedule: ScheduleWindow) => {
    const startDateLabel = schedule.start_date
      ? `${schedule.start_date.slice(8, 10)}/${schedule.start_date.slice(5, 7)}`
      : format(now, "dd/MM");

    const endDateLabel = schedule.end_date
      ? `${schedule.end_date.slice(8, 10)}/${schedule.end_date.slice(5, 7)}`
      : startDateLabel;

    return `${startDateLabel} ${schedule.start_time} → ${endDateLabel} ${schedule.end_time}`;
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="bg-background pb-2 -mx-4 px-4 sm:-mx-6 sm:px-6 pt-1">
          <TabsList className="bg-muted w-full grid grid-cols-3">
            <TabsTrigger value="extras" className="text-xs gap-1.5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-all data-[state=active]:text-primary data-[state=active]:bg-background">
              <Settings2 className="h-3.5 w-3.5" />
              Configurações
            </TabsTrigger>
            <TabsTrigger value="schedule" className="text-xs gap-1.5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-all data-[state=active]:text-primary data-[state=active]:bg-background">
              <ListMusic className="h-3.5 w-3.5" />
              Programar Playlists
            </TabsTrigger>
            <TabsTrigger value="active" className="text-xs gap-1.5 text-white/60 hover:text-white/90 hover:bg-white/10 transition-all data-[state=active]:text-primary data-[state=active]:bg-background">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Programações Ativas
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ─── TAB: Programações Ativas ─── */}
        <TabsContent value="active">
          <motion.div className="mt-4 space-y-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
          {scheduledPlaylists.length === 0 && scheduledSpots.length === 0 ? (
            <div className="text-center py-10 space-y-2">
              <CalendarClock className="h-10 w-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-white/70">Nenhuma programação ativa ainda.</p>
              <p className="text-xs text-white/50">Use a aba "Programar" para agendar suas playlists.</p>
            </div>
          ) : (
            <>
              {/* ── Playlists programadas ── */}
              {scheduledPlaylists.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider px-1">Playlists</p>
                  {scheduledPlaylists.map((playlist) => {
                    const schedule = schedulesByPlaylist[playlist.id];
                    const status = getScheduleStatus(schedule, now);
                    const clientName = isAdmin && schedule.user_id ? (clientNames[schedule.user_id] ?? schedule.user_id?.slice(0, 8)) : null;

                    return (
                      <div
                        key={playlist.id}
                        className={`group relative flex items-center gap-3 rounded-xl p-3 transition-all ${status === "executando" ? "bg-green-500/5" : "bg-secondary/20"}`}
                      >
                        <div className="h-12 w-12 rounded-lg bg-secondary/50 flex-shrink-0 overflow-hidden">
                          {playlist.cover_url ? (
                            <img src={playlist.cover_url} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center">
                              <ListMusic className="h-5 w-5 text-white/40" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate text-white">{playlist.name}</p>
                            {clientName && (
                              <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 text-[10px] px-1.5 py-0 gap-1 pointer-events-none flex-shrink-0">
                                <User className="h-2.5 w-2.5" />{clientName}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-xs text-white/60">{formatDateRange(schedule)}</p>
                            <StatusBadge status={status} />
                          </div>
                          <p className="text-[11px] text-primary/90">Início/Fim: {formatStartEndLabel(schedule)}</p>
                        </div>
                        <Button size="sm" className="h-8 text-xs px-3 flex-shrink-0 bg-primary text-primary-foreground hover:bg-primary/90 border-none transition-all" onClick={() => setSchedulePlaylist(playlist)}>
                          Editar
                        </Button>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ── Spots programados ── */}
              {scheduledSpots.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wider px-1">Spots</p>
                  {scheduledSpots.map((spot) => {
                    const status = getSpotStatus(spot, now);
                    const clientName = isAdmin && spot.userId ? (clientNames[spot.userId] ?? spot.userId?.slice(0, 8)) : null;
                    return (
                      <div
                        key={spot.spotId}
                        className={`flex items-center gap-3 rounded-xl p-3 transition-all ${status === "executando" ? "bg-green-500/5" : "bg-secondary/20"}`}
                      >
                        <div className="h-12 w-12 rounded-lg bg-secondary/50 flex-shrink-0 flex items-center justify-center">
                          <Volume2 className="h-5 w-5 text-white/40" />
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium truncate text-white">{spot.spotTitle}</p>
                            {clientName && (
                              <Badge className="bg-blue-500/15 text-blue-300 border-blue-500/30 text-[10px] px-1.5 py-0 gap-1 pointer-events-none flex-shrink-0">
                                <User className="h-2.5 w-2.5" />{clientName}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-2 flex-wrap">
                            {spot.scheduleStart && (
                              <p className="text-xs text-white/60">
                                {spot.scheduleStart} {spot.scheduleEnd ? `→ ${spot.scheduleEnd}` : ""}
                              </p>
                            )}
                            <StatusBadge status={status} />
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
          </motion.div>
        </TabsContent>

        {/* ─── TAB: Programar ─── */}
        <TabsContent value="schedule">
          <motion.div className="mt-4 space-y-3" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
          <div className="flex items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-white/50" />
              <Input
                placeholder="Buscar playlist..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9 bg-muted border-border h-9 text-sm text-white placeholder:text-white/40"
              />
            </div>
          </div>

          {/* Selecionar + Programar em grupo */}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={toggleSelectAll}
              className="text-xs h-9 whitespace-nowrap bg-primary/20 border-primary text-primary-foreground transition-all"
            >
              {filteredPlaylists.length > 0 &&
              filteredPlaylists.slice(0, MAX_GROUP_SELECTION).every((p) => selectedIds.has(p.id))
                ? "Desmarcar"
                : "Selecionar"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={selectedIds.size < 2 || selectedIds.size > MAX_GROUP_SELECTION}
              onClick={() => setGroupScheduleOpen(true)}
              className="text-xs h-9 whitespace-nowrap bg-primary/20 border-primary text-primary-foreground transition-all disabled:opacity-40"
            >
              Programar em grupo
            </Button>
            {selectedIds.size > 0 && (
              <span className="text-xs text-primary font-medium ml-auto">
                {selectedIds.size} selecionada{selectedIds.size > 1 ? "s" : ""} (máx. {MAX_GROUP_SELECTION})
              </span>
            )}
          </div>

          {filteredPlaylists.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-sm text-white/60">
                {searchTerm ? "Nenhuma playlist encontrada." : "Nenhuma playlist disponível."}
              </p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredPlaylists.map((playlist) => {
                const schedule = schedulesByPlaylist[playlist.id];
                const hasSchedule = Boolean(schedule);
                const isSelected = selectedIds.has(playlist.id);
                const ownerLabel = getOwnerLabel(playlist.created_by);
                const status = hasSchedule ? getScheduleStatus(schedule, now) : null;

                return (
                  <div
                    key={playlist.id}
                    className={`flex items-center gap-3 rounded-lg p-2.5 transition-all ${
                      isSelected
                        ? "bg-primary/5"
                        : "bg-secondary/10 hover:bg-secondary/20"
                    }`}
                  >
                    <Checkbox
                      checked={isSelected}
                      onCheckedChange={() => toggleSelect(playlist.id)}
                      className="border-primary/50 bg-primary/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
                    />

                    <div className="h-10 w-10 rounded-md bg-secondary/40 flex-shrink-0 overflow-hidden">
                      {playlist.cover_url ? (
                        <img src={playlist.cover_url} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full flex items-center justify-center">
                          <ListMusic className="h-4 w-4 text-muted-foreground/30" />
                        </div>
                      )}
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium truncate text-white">{playlist.name}</p>
                        {status && <StatusBadge status={status} />}
                      </div>
                      <div className="flex items-center gap-2 text-[11px] text-white/60">
                        <span>{playlist.songCount} faixas</span>
                        <span>•</span>
                        <span>{ownerLabel}</span>
                        {hasSchedule && (
                          <>
                            <span>•</span>
                            <span className="text-primary/80">
                              {formatStartEndLabel(schedule)}
                            </span>
                          </>
                        )}
                      </div>
                    </div>

                    <Button
                      size="sm"
                      variant={hasSchedule ? "outline" : "default"}
                      disabled={selectedIds.size >= 2}
                      className={`h-8 text-xs px-3 flex-shrink-0 transition-all text-white ${
                        hasSchedule
                          ? "hover:bg-primary hover:text-white"
                          : "hover:bg-primary hover:text-white"
                      } disabled:opacity-30`}
                      onClick={() => setSchedulePlaylist(playlist)}
                    >
                      {hasSchedule ? "Editar" : "Programar"}
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
          </motion.div>
        </TabsContent>

        {/* ─── TAB: Configurações ─── */}
        <TabsContent value="extras">
          <motion.div className="mt-4 space-y-2" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: "easeOut" }}>
            {ALL_CLIENT_FEATURES.map(feat => {
              const f = clientFeatures[feat.key];
              const isEspelho      = feat.key === "player_espelho";
              const isIndependente = feat.key === "player_independente";
              const isPlayer       = isEspelho || isIndependente;
              const mode           = isEspelho ? "mirror" : "independent";
              const link           = clientUserId ? `${window.location.origin}/player/embed?client=${clientUserId}&mode=${mode}` : "";

              return (
                <div key={feat.key} className="rounded-xl bg-secondary/10 border border-white/10 px-4 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{feat.label}</p>
                    </div>
                    <Switch
                      checked={f?.enabled ?? false}
                      disabled
                      className="pointer-events-none"
                    />
                  </div>
                  {isPlayer && link && (
                    <div className="pt-1">
                      <button
                        type="button"
                        disabled={!f?.enabled}
                        className={`w-1/2 flex items-center justify-center gap-2 h-6 rounded-md text-xs font-semibold transition-all border ${
                          !f?.enabled
                            ? "border-primary/20 bg-primary/10 text-primary/30 cursor-not-allowed"
                            : copiedKey === feat.key
                              ? "border-green-500/50 bg-green-500/15 text-green-400"
                              : "border-primary/40 bg-primary/15 text-primary hover:bg-primary/25"
                        }`}
                        onClick={() => {
                          if (!f?.enabled) return;
                          navigator.clipboard.writeText(link);
                          setCopiedKey(feat.key);
                          setTimeout(() => setCopiedKey(null), 2000);
                        }}
                      >
                        {copiedKey === feat.key
                          ? <><Check className="h-3 w-3" /> Link copiado!</>
                          : <><Link2 className="h-3 w-3" /> Gerar link do player flutuante</>
                        }
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </motion.div>
        </TabsContent>
      </Tabs>

      {schedulePlaylist && (
        <PlaylistScheduleDialog
          playlistId={schedulePlaylist.id}
          playlistName={schedulePlaylist.name}
          open={Boolean(schedulePlaylist)}
          onOpenChange={(open) => {
            if (!open) setSchedulePlaylist(null);
            // Realtime subscription handles data refresh automatically
          }}
          onSaved={() => {}}
        />
      )}

      {groupScheduleOpen && selectedGroupPlaylists.length >= 2 && selectedGroupPlaylists.length <= MAX_GROUP_SELECTION && (
        <GroupScheduleDialog
          playlists={selectedGroupPlaylists}
          open={groupScheduleOpen}
          onOpenChange={(open) => {
            setGroupScheduleOpen(open);
            if (!open) setSelectedIds(new Set());
            // Realtime subscription handles data refresh automatically
          }}
          onSaved={() => {}}
        />
      )}
    </div>
  );
};

export default ProgramacaoPanel;
