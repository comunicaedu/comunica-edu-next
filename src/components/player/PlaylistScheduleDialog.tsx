"use client";

import { useState, useEffect, useRef } from "react";
import { Clock, Loader2, CalendarIcon, Volume2, Lock } from "lucide-react";
import { useClientFeatures } from "@/hooks/useClientFeatures";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Schedule {
  id?: string;
  playlist_id: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
  start_date: Date | null;
  end_date: Date | null;
  scheduled_volume: number | null;
}

const DAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

interface Props {
  playlistId: string;
  playlistName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  // Modo pendente: não salva no banco, chama o callback com os dados para aplicar depois
  pendingMode?: boolean;
  onPendingSave?: (scheduleData: Omit<Schedule, "id">) => void;
}

const ANONYMOUS_SCHEDULE_USER_ID = "00000000-0000-0000-0000-000000000000";
const FORM_CACHE_KEY = "edu-schedule-form-";
const FORM_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

const toDateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const normalizeLoadedDateRange = (startDate: Date | null, endDate: Date | null) => {
  if (!startDate || !endDate) {
    return { start_date: startDate, end_date: endDate };
  }

  const today = toDateOnly(new Date());
  let normalizedStart = toDateOnly(startDate);
  let normalizedEnd = toDateOnly(endDate);

  // Reprogramação de agenda concluída: evita estado quebrado no calendário
  if (normalizedEnd < today) {
    normalizedStart = today;
    normalizedEnd = today;
  }

  if (normalizedStart < today) {
    normalizedStart = today;
  }

  if (normalizedEnd < normalizedStart) {
    normalizedEnd = normalizedStart;
  }

  return { start_date: normalizedStart, end_date: normalizedEnd };
};

const calendarClassNames = {
  months: "flex flex-col w-full",
  month: "space-y-1 w-full",
  caption: "flex justify-center pt-1 pb-1 relative items-center px-9",
  caption_label: "text-xs font-semibold text-primary-foreground capitalize",
  nav: "flex items-center",
  nav_button:
    "h-6 w-6 bg-primary p-0 text-primary-foreground border-none rounded-md inline-flex items-center justify-center hover:bg-primary/90 opacity-100",
  nav_button_previous: "absolute left-0",
  nav_button_next: "absolute right-0",
  table: "w-full border-collapse",
  head_row: "grid grid-cols-7",
  head_cell:
    "text-center text-[0.65rem] font-semibold text-primary-foreground/80 py-1.5 w-8",
  row: "grid grid-cols-7 mt-0.5",
  cell:
    "text-center text-xs p-0 w-8 relative [&:has([aria-selected])]:bg-transparent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
  day:
    "h-7 w-8 mx-auto p-0 text-xs font-medium text-primary-foreground bg-transparent hover:bg-primary/30 hover:text-primary-foreground rounded-md transition-colors",
  day_selected:
    "!bg-primary !text-primary-foreground hover:!bg-primary hover:!text-primary-foreground",
  day_today: "ring-1 ring-primary text-primary-foreground",
  day_outside: "text-primary-foreground/40 opacity-50",
  day_disabled: "text-primary-foreground/40 opacity-50",
};

const PlaylistScheduleDialog = ({ playlistId, playlistName, open, onOpenChange, onSaved, pendingMode, onPendingSave }: Props) => {
  const { isFeatureLocked, consumeFeature } = useClientFeatures();
  const isSaveLocked = isFeatureLocked("programar_playlists");
  const [lockedBadge, setLockedBadge] = useState(false);
  const lockedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showBadge = () => {
    setLockedBadge(true);
    if (lockedTimer.current) clearTimeout(lockedTimer.current);
    lockedTimer.current = setTimeout(() => setLockedBadge(false), 3000);
  };
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [schedule, setSchedule] = useState<Schedule>({
    playlist_id: playlistId,
    start_time: "08:00",
    end_time: "18:00",
    is_active: true,
    start_date: null,
    end_date: null,
    scheduled_volume: null,
  });

  // ── Try restore form from sessionStorage ──
  const restoreFormCache = (): Schedule | null => {
    try {
      const raw = sessionStorage.getItem(FORM_CACHE_KEY + playlistId);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (Date.now() - cached._ts > FORM_CACHE_TTL_MS) {
        sessionStorage.removeItem(FORM_CACHE_KEY + playlistId);
        return null;
      }
      return {
        ...cached,
        start_date: cached.start_date ? new Date(cached.start_date) : null,
        end_date: cached.end_date ? new Date(cached.end_date) : null,
      };
    } catch { return null; }
  };

  // ── Save form to sessionStorage on changes ──
  useEffect(() => {
    if (loading || !open) return;
    try {
      sessionStorage.setItem(FORM_CACHE_KEY + playlistId, JSON.stringify({
        ...schedule,
        start_date: schedule.start_date?.toISOString() ?? null,
        end_date: schedule.end_date?.toISOString() ?? null,
        _ts: Date.now(),
      }));
    } catch {}
  }, [schedule, loading, open, playlistId]);

  useEffect(() => {
    if (!open) return;
    const fetchSchedule = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("playlist_schedules")
        .select("*")
        .eq("playlist_id", playlistId)
        .limit(1)
        .maybeSingle();

      if (error) {
        toast.error("Erro ao carregar programação da playlist.");
        setLoading(false);
        return;
      }

      if (data) {
        const d = data as any;
        const parsedStartDate = d.start_date ? new Date(`${d.start_date}T00:00:00`) : null;
        const parsedEndDate = d.end_date ? new Date(`${d.end_date}T00:00:00`) : null;
        const normalizedDates = normalizeLoadedDateRange(parsedStartDate, parsedEndDate);

        setSchedule({
          id: data.id,
          playlist_id: data.playlist_id,
          start_time: data.start_time.slice(0, 5),
          end_time: data.end_time.slice(0, 5),
          is_active: data.is_active,
          start_date: normalizedDates.start_date,
          end_date: normalizedDates.end_date,
          scheduled_volume: (d.scheduled_volume as number | null) ?? null,
        });
      } else {
        // Try restore from cache first
        const cached = restoreFormCache();
        if (cached) {
          setSchedule(cached);
        } else {
          const today = toDateOnly(new Date());
          setSchedule({
            playlist_id: playlistId,
            start_time: "08:00",
            end_time: "18:00",
            is_active: true,
            start_date: today,
            end_date: today,
            scheduled_volume: null,
          });
        }
      }
      setLoading(false);
    };
    fetchSchedule();
  }, [open, playlistId]);

  const handleSave = async () => {
    if (!schedule.start_date || !schedule.end_date) {
      toast.error("Defina a data de início e término.");
      return;
    }

    if (schedule.end_date < schedule.start_date) {
      toast.error("A data de término deve ser após a data de início.");
      return;
    }

    if (!schedule.start_time || !schedule.end_time) {
      toast.error("Defina horário de início e fim.");
      return;
    }

    if (schedule.start_time === schedule.end_time) {
      toast.error("Início e fim não podem ser iguais.");
      return;
    }

    const startDateStr = format(schedule.start_date, "yyyy-MM-dd");
    const endDateStr = format(schedule.end_date, "yyyy-MM-dd");
    const startDateTime = new Date(`${startDateStr}T${schedule.start_time}:00`);
    const endDateTime = new Date(`${endDateStr}T${schedule.end_time}:00`);

    if (endDateTime <= startDateTime) {
      toast.error("A data/horário de término deve ser após o início.");
      return;
    }

    // Modo pendente: captura os dados sem salvar no banco
    if (pendingMode && onPendingSave) {
      onPendingSave({ ...schedule });
      toast.success("Agendamento configurado! Será aplicado após a importação.");
      onOpenChange(false);
      return;
    }

    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();

    // Generate days_of_week covering all days (0-6) since scheduling is now date-range based
    const allDays = [0, 1, 2, 3, 4, 5, 6];

    const payload: Record<string, any> = {
      playlist_id: playlistId,
      start_time: schedule.start_time,
      end_time: schedule.end_time,
      days_of_week: allDays,
      start_date: format(schedule.start_date, "yyyy-MM-dd"),
      end_date: format(schedule.end_date, "yyyy-MM-dd"),
    };
    // Só inclui scheduled_volume se for um valor real (evita erro se coluna não existir)
    if (schedule.scheduled_volume != null) {
      payload.scheduled_volume = schedule.scheduled_volume;
    }

    let error;
    if (schedule.id) {
      ({ error } = await supabase
        .from("playlist_schedules")
        .update(payload)
        .eq("id", schedule.id));
    } else {
      const userId = userData.user?.id;
      ({ error } = await supabase
        .from("playlist_schedules")
        .insert([{
          ...payload,
          user_id: userId ?? ANONYMOUS_SCHEDULE_USER_ID,
        }] as any));
    }

    if (error) {
      toast.error(`Erro ao salvar programação: ${error.message}`);
    } else {
      await consumeFeature("programar_playlists");
      toast.success("Programação salva!");
      sessionStorage.removeItem(FORM_CACHE_KEY + playlistId);
      window.dispatchEvent(new CustomEvent("schedule-saved"));
      onSaved?.();
      onOpenChange(false);
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!schedule.id) return;
    setSaving(true);
    const { error } = await supabase
      .from("playlist_schedules")
      .delete()
      .eq("id", schedule.id);
    if (error) {
      toast.error("Erro ao remover programação.");
    } else {
      toast.success("Programação removida.");
      sessionStorage.removeItem(FORM_CACHE_KEY + playlistId);
      onSaved?.();
      onOpenChange(false);
    }
    setSaving(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="playlist-schedule-description"
        className="w-[92vw] max-w-[400px] gap-3 p-4 sm:max-w-[400px] [&>button]:hidden"
        onClick={(e) => e.stopPropagation()}
        onInteractOutside={(e) => {
          const target = e.target as HTMLElement;
          if (target?.closest?.("[data-radix-popper-content-wrapper]")) {
            e.preventDefault();
          }
        }}
      >
        <DialogHeader className="space-y-1 min-w-0">
          <DialogTitle className="flex items-center gap-2 text-base text-primary-foreground min-w-0">
            <Clock className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">Programar Playlist</span>
          </DialogTitle>
          <DialogDescription id="playlist-schedule-description" className="sr-only">
            Configure datas e horário para tocar esta playlist automaticamente.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4 min-w-0">
            <p className="truncate text-sm font-medium text-primary-foreground min-w-0">
              {playlistName}
            </p>

            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-primary-foreground">Ativar automaticamente</span>
              <Switch
                checked={schedule.is_active}
                onCheckedChange={(checked) => {
                  setSchedule((p) => ({ ...p, is_active: checked }));
                }}
              />
            </div>

            {/* Date range — calendário abre via portal para nunca ser cortado */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-primary-foreground font-medium">Data de Início</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left text-sm font-normal bg-primary/20 border-primary text-primary-foreground transition-colors",
                        schedule.start_date && "!bg-primary !text-primary-foreground hover:!bg-primary/90 !border-primary"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                      {schedule.start_date ? format(schedule.start_date, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[200] w-auto p-0 !bg-[#1f242e] border border-border text-foreground shadow-xl"
                    side="top"
                    align="start"
                    sideOffset={8}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <Calendar
                      mode="single"
                      selected={schedule.start_date ?? undefined}
                      onSelect={(date) => setSchedule((p) => ({ ...p, start_date: date ?? null }))}
                      disabled={(date) => toDateOnly(date) < toDateOnly(new Date())}
                      locale={ptBR}
                      formatters={{
                        formatCaption: (date) => format(date, "MMMM yyyy", { locale: ptBR }),
                        formatWeekdayName: (date) => DAY_LABELS[date.getDay()],
                      }}
                      className="p-3 pointer-events-auto"
                      classNames={calendarClassNames}
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-primary-foreground font-medium">Data de Término</label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "w-full justify-start text-left text-sm font-normal bg-primary/20 border-primary text-primary-foreground transition-colors",
                        schedule.end_date && "!bg-primary !text-primary-foreground hover:!bg-primary/90 !border-primary"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                      {schedule.end_date ? format(schedule.end_date, "dd/MM/yyyy") : "Selecionar"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    className="z-[200] w-auto p-0 !bg-[#1f242e] border border-border text-foreground shadow-xl"
                    side="top"
                    align="end"
                    sideOffset={8}
                    onOpenAutoFocus={(e) => e.preventDefault()}
                  >
                    <Calendar
                      mode="single"
                      selected={schedule.end_date ?? undefined}
                      onSelect={(date) => setSchedule((p) => ({ ...p, end_date: date ?? null }))}
                      disabled={(date) => {
                        const today = toDateOnly(new Date());
                        const dateOnly = toDateOnly(date);
                        if (schedule.start_date && dateOnly < toDateOnly(schedule.start_date)) return true;
                        if (dateOnly < today) return true;
                        return false;
                      }}
                      locale={ptBR}
                      formatters={{
                        formatCaption: (date) => format(date, "MMMM yyyy", { locale: ptBR }),
                        formatWeekdayName: (date) => DAY_LABELS[date.getDay()],
                      }}
                      className="p-3 pointer-events-auto"
                      classNames={calendarClassNames}
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Time pickers */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs text-primary-foreground font-medium flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  Horário Início
                </label>
                <input
                  type="time"
                  title="Horário de início"
                  value={schedule.start_time}
                  onChange={(e) => setSchedule((p) => ({ ...p, start_time: e.target.value }))}
                  className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2.5 text-sm text-primary-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-primary-foreground font-medium flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-primary" />
                  Horário Fim
                </label>
                <input
                  type="time"
                  title="Horário de fim"
                  value={schedule.end_time}
                  onChange={(e) => setSchedule((p) => ({ ...p, end_time: e.target.value }))}
                  className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2.5 text-sm text-primary-foreground outline-none focus:border-primary"
                />
              </div>
            </div>

            {/* Volume — padrão = slider cheio (100%), "Padrão" = não altera o volume do sistema */}
            <div className="space-y-1.5">
              <label className="text-xs text-primary-foreground font-medium flex items-center gap-1.5">
                <Volume2 className="h-3.5 w-3.5 text-primary" />
                Volume programado
                <span className="text-primary font-semibold ml-auto">
                  {schedule.scheduled_volume != null ? `${schedule.scheduled_volume}%` : "Padrão (100%)"}
                </span>
              </label>
              <div className="flex items-center gap-3">
                <Slider
                  min={10}
                  max={100}
                  step={5}
                  value={[schedule.scheduled_volume ?? 100]}
                  onValueChange={([v]) => setSchedule((p) => ({ ...p, scheduled_volume: v }))}
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-[10px] h-6 px-2 text-muted-foreground hover:text-primary-foreground shrink-0"
                  onClick={() => setSchedule((p) => ({ ...p, scheduled_volume: null }))}
                >
                  Padrão
                </Button>
              </div>
            </div>

            {lockedBadge && (
              <div className="flex justify-center pointer-events-none pb-1">
                <div className="flex items-center gap-1.5 bg-background/90 backdrop-blur-sm border border-border/50 rounded-full px-3 py-1.5 shadow-md whitespace-nowrap">
                  <Lock className="h-3 w-3 text-primary shrink-0" />
                  <p className="text-xs font-medium text-foreground">Atualize seu plano para usar esse recurso.</p>
                </div>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <Button onClick={isSaveLocked ? showBadge : handleSave} disabled={!isSaveLocked && saving} className="flex-1 gap-1.5">
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Salvar
              </Button>
              {schedule.id && (
                <Button
                  variant="outline"
                  onClick={handleDelete}
                  disabled={saving}
                  className="text-destructive border-destructive/30 hover:bg-destructive/10"
                >
                  Remover
                </Button>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

export default PlaylistScheduleDialog;