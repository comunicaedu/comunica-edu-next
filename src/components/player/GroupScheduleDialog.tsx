"use client";

import { useState, useMemo, useEffect } from "react";
import { CalendarIcon, Clock, Loader2, AlertTriangle, Layers, ArrowRight, Volume2 } from "lucide-react";
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
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/lib/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface PlaylistItem {
  id: string;
  name: string;
  cover_url: string | null;
}

interface GroupEntry {
  playlist: PlaylistItem;
  start_time: string;
  end_time: string;
  start_date: Date | null;
  end_date: Date | null;
  selected: boolean;
  scheduled_volume: number | null;
}

interface Props {
  playlists: PlaylistItem[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

interface TimeConflict {
  indexA: number;
  indexB: number;
  message: string;
}

const DAY_LABELS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const ANONYMOUS_SCHEDULE_USER_ID = "00000000-0000-0000-0000-000000000000";
const SLOT_DURATION_MIN = 120;
const MAX_GROUP_PLAYLISTS = 50;

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
    "text-center text-[0.6rem] font-semibold text-primary-foreground/80 py-1 truncate",
  row: "grid grid-cols-7 mt-0.5",
  cell:
    "text-center text-xs p-0 relative [&:has([aria-selected])]:bg-transparent first:[&:has([aria-selected])]:rounded-l-md last:[&:has([aria-selected])]:rounded-r-md",
  day:
    "h-7 w-7 mx-auto p-0 text-xs font-medium text-primary-foreground bg-transparent hover:bg-primary/30 hover:text-primary-foreground rounded-md transition-colors",
  day_selected:
    "!bg-primary !text-primary-foreground hover:!bg-primary hover:!text-primary-foreground",
  day_today: "ring-1 ring-primary text-primary-foreground",
  day_outside: "text-primary-foreground/40 opacity-50",
  day_disabled: "text-primary-foreground/40 opacity-50",
};

const parseTimeMinutes = (t: string): number => {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
};

const minutesToTime = (minutes: number): string => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};

const toDateOnly = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const formatDateTimeLabel = (date: Date | null, time: string): string => {
  if (!date) return `--/-- ${time}`;
  return `${format(date, "dd/MM")} ${time}`;
};

const getEntryDateRange = (entry: GroupEntry) => {
  if (!entry.start_date || !entry.end_date) return null;

  const startDate = toDateOnly(entry.start_date);
  const rawEndDate = toDateOnly(entry.end_date);

  if (rawEndDate.getTime() < startDate.getTime()) return null;

  const [startHour = 0, startMinute = 0] = entry.start_time.split(":").map(Number);
  const [endHour = 0, endMinute = 0] = entry.end_time.split(":").map(Number);

  const startDateTime = new Date(startDate);
  startDateTime.setHours(startHour, startMinute, 0, 0);

  const endDateTime = new Date(rawEndDate);
  endDateTime.setHours(endHour, endMinute, 0, 0);

  if (endDateTime.getTime() <= startDateTime.getTime()) {
    endDateTime.setDate(endDateTime.getDate() + 1);
  }

  const normalizedEndDate = new Date(endDateTime);
  normalizedEndDate.setHours(0, 0, 0, 0);

  return {
    startDate,
    endDate: normalizedEndDate,
    startDateTime,
    endDateTime,
  };
};

const toTimeRanges = (start: number, end: number): Array<[number, number]> => {
  if (start === end) return [[0, 1440]];
  if (start < end) return [[start, end]];
  return [
    [start, 1440],
    [0, end],
  ];
};

const rangesOverlap = (rangesA: Array<[number, number]>, rangesB: Array<[number, number]>) => {
  return rangesA.some(([aStart, aEnd]) =>
    rangesB.some(([bStart, bEnd]) => aStart < bEnd && bStart < aEnd)
  );
};

const detectConflicts = (entries: GroupEntry[]): TimeConflict[] => {
  const selected = entries
    .map((e, i) => ({ ...e, originalIndex: i }))
    .filter((e) => e.selected);

  const conflicts: TimeConflict[] = [];

  for (let i = 0; i < selected.length; i++) {
    for (let j = i + 1; j < selected.length; j++) {
      const a = selected[i];
      const b = selected[j];

      const aRange = getEntryDateRange(a);
      const bRange = getEntryDateRange(b);
      if (!aRange || !bRange) continue;

      const overlaps =
        aRange.startDateTime.getTime() < bRange.endDateTime.getTime() &&
        bRange.startDateTime.getTime() < aRange.endDateTime.getTime();

      if (overlaps) {
        conflicts.push({
          indexA: a.originalIndex,
          indexB: b.originalIndex,
          message: `"${a.playlist.name}" e "${b.playlist.name}" possuem horários conflitantes.`,
        });
      }
    }
  }

  return conflicts;
};

const GroupScheduleDialog = ({ playlists, open, onOpenChange, onSaved }: Props) => {
  const [saving, setSaving] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [entries, setEntries] = useState<GroupEntry[]>([]);

  useEffect(() => {
    if (!open) return;

    const cappedPlaylists = playlists.slice(0, MAX_GROUP_PLAYLISTS);
    const today = toDateOnly(new Date());
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    const baseStartMinutes = nowMinutes + 10;

    setEntries(
      cappedPlaylists.map((p, i) => ({
        playlist: p,
        start_time: minutesToTime(baseStartMinutes + i * SLOT_DURATION_MIN),
        end_time: minutesToTime(baseStartMinutes + (i + 1) * SLOT_DURATION_MIN),
        start_date: new Date(today),
        end_date: new Date(today),
        selected: true,
        scheduled_volume: null,
      }))
    );
  }, [open, playlists]);

  const updateEntry = (index: number, patch: Partial<GroupEntry>) => {
    setEntries((prev) =>
      prev.map((entry, i) => {
        if (i !== index) return entry;

        const next = { ...entry, ...patch };

        if (patch.start_date !== undefined) {
          next.start_date = patch.start_date ? new Date(toDateOnly(patch.start_date)) : null;
        }

        if (patch.end_date !== undefined) {
          next.end_date = patch.end_date ? new Date(toDateOnly(patch.end_date)) : null;
        }

        return next;
      })
    );
  };

  const selectedEntries = useMemo(() => entries.filter((entry) => entry.selected), [entries]);
  const allSelected = entries.length > 0 && entries.every((entry) => entry.selected);

  const toggleSelectAll = () => {
    const newValue = !allSelected;
    setEntries((prev) => prev.map((entry) => ({ ...entry, selected: newValue })));
  };

  const conflicts = useMemo(() => detectConflicts(entries), [entries]);

  const conflictIndices = useMemo(() => {
    const set = new Set<number>();
    conflicts.forEach((conflict) => {
      set.add(conflict.indexA);
      set.add(conflict.indexB);
    });
    return set;
  }, [conflicts]);

  const handleSave = async () => {
    if (selectedEntries.length < 2) {
      toast.error("Selecione ao menos 2 playlists para programar em grupo.");
      return;
    }

    if (selectedEntries.length > MAX_GROUP_PLAYLISTS) {
      toast.error(`O limite da programação em grupo é ${MAX_GROUP_PLAYLISTS} playlists.`);
      return;
    }

    const normalizedRanges = new Map<
      string,
      { startDate: Date; endDate: Date; startDateTime: Date; endDateTime: Date }
    >();

    for (const entry of selectedEntries) {
      if (!entry.start_date || !entry.end_date) {
        toast.error(`Defina as datas para "${entry.playlist.name}".`);
        return;
      }

      if (toDateOnly(entry.end_date).getTime() < toDateOnly(entry.start_date).getTime()) {
        toast.error(`Data de término inválida para "${entry.playlist.name}".`);
        return;
      }

      if (!entry.start_time || !entry.end_time || entry.start_time === entry.end_time) {
        toast.error(`Defina horários válidos para "${entry.playlist.name}".`);
        return;
      }

      const range = getEntryDateRange(entry);
      if (!range) {
        toast.error(`Data de término inválida para "${entry.playlist.name}".`);
        return;
      }

      if (range.endDateTime <= range.startDateTime) {
        toast.error(`A data/horário de término deve ser após o início em "${entry.playlist.name}".`);
        return;
      }

      normalizedRanges.set(entry.playlist.id, range);
    }

    if (conflicts.length > 0) {
      toast.error("Resolva os conflitos de horário antes de salvar.");
      return;
    }

    setSaving(true);

    try {
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id ?? ANONYMOUS_SCHEDULE_USER_ID;
      const allDays = [0, 1, 2, 3, 4, 5, 6];

      const playlistIds = selectedEntries.map((entry) => entry.playlist.id);
      const { data: existingRows, error: existingError } = await supabase
        .from("playlist_schedules")
        .select("id, playlist_id")
        .in("playlist_id", playlistIds)
        .order("updated_at", { ascending: false });

      if (existingError) {
        toast.error("Erro ao validar programações existentes do grupo.");
        return;
      }

      const existingByPlaylist = new Map<string, string>();
      (existingRows || []).forEach((row) => {
        if (!existingByPlaylist.has(row.playlist_id)) {
          existingByPlaylist.set(row.playlist_id, row.id);
        }
      });

      const results = await Promise.all(
        selectedEntries.map(async (entry) => {
          const range = normalizedRanges.get(entry.playlist.id);
          if (!range) {
            return { playlistName: entry.playlist.name, error: new Error("Range não encontrado") };
          }

          const payload = {
            playlist_id: entry.playlist.id,
            start_time: entry.start_time,
            end_time: entry.end_time,
            days_of_week: allDays,
            is_active: isActive,
            updated_at: new Date().toISOString(),
            start_date: format(range.startDate, "yyyy-MM-dd"),
            end_date: format(range.endDate, "yyyy-MM-dd"),
            scheduled_volume: entry.scheduled_volume,
          };

          const existingId = existingByPlaylist.get(entry.playlist.id);
          let error: unknown = null;

          if (existingId) {
            ({ error } = await supabase
              .from("playlist_schedules")
              .update(payload)
              .eq("id", existingId));
          } else {
            ({ error } = await supabase
              .from("playlist_schedules")
              .insert([{ ...payload, user_id: userId }] as any));
          }

          return { playlistName: entry.playlist.name, error };
        })
      );

      const failed = results.filter((result) => result.error);
      failed.forEach((result) => {
        const errorMessage =
          result.error && typeof result.error === "object" && "message" in result.error
            ? String((result.error as { message?: string }).message || "")
            : "";
        toast.error(`Erro ao salvar "${result.playlistName}"${errorMessage ? `: ${errorMessage}` : "."}`);
      });

      if (failed.length === 0) {
        toast.success(`${selectedEntries.length} playlists programadas em grupo!`);
        onSaved?.();
        onOpenChange(false);
      }
    } catch (error) {
      console.error("Erro ao salvar programação em grupo:", error);
      toast.error("Erro ao salvar a programação em grupo.");
    } finally {
      setSaving(false);
    }
  };

  if (entries.length === 0 && open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby="group-schedule-description"
        className="w-[92vw] max-w-[460px] gap-3 p-4 sm:max-w-[460px] [&>button]:hidden overflow-hidden border-2 border-primary z-[60]"
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
            <Layers className="h-5 w-5 text-primary shrink-0" />
            <span className="truncate">Programação em Grupo</span>
          </DialogTitle>
          <DialogDescription id="group-schedule-description" className="sr-only">
            Defina horários sequenciais para múltiplas playlists.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 min-w-0">
          <p className="text-[11px] text-primary-foreground/80">
            Programe de <span className="text-primary font-semibold">2 a {MAX_GROUP_PLAYLISTS}</span> playlists com horários totalmente manuais (início e fim só mudam quando você editar).
          </p>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-primary-foreground">Ativar automaticamente</span>
            <Switch checked={isActive} onCheckedChange={setIsActive} />
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Checkbox
                checked={allSelected}
                onCheckedChange={toggleSelectAll}
                className="border-primary/50 bg-primary/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary"
              />
              <span className="text-xs font-medium text-primary-foreground">
                {allSelected ? "Desmarcar tudo" : "Selecionar tudo"}
              </span>
            </div>
            <span className="text-xs text-muted-foreground">
              {selectedEntries.length} de {entries.length}
            </span>
          </div>

          {conflicts.length > 0 && (
            <div className="space-y-1">
              {conflicts.map((conflict, i) => (
                <div key={i} className="flex items-center gap-2 bg-destructive/10 border border-destructive/30 rounded-lg px-3 py-1.5">
                  <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <p className="text-[11px] text-destructive">{conflict.message}</p>
                </div>
              ))}
            </div>
          )}

          <div className="space-y-3 max-h-[55vh] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {entries.map((entry, index) => (
              <div
                key={entry.playlist.id}
                className={cn(
                  "rounded-xl border-2 p-3 space-y-3 transition-all",
                  !entry.selected && "opacity-40 border-border/30",
                  entry.selected && !conflictIndices.has(index) && "border-primary/60 bg-secondary/10",
                  conflictIndices.has(index) && "border-destructive/40 bg-destructive/5"
                )}
              >
                <div className="flex items-center gap-2">
                  <Checkbox
                    checked={entry.selected}
                    onCheckedChange={(checked) => updateEntry(index, { selected: checked === true })}
                    className="border-primary/50 bg-primary/20 data-[state=checked]:bg-primary data-[state=checked]:border-primary shrink-0"
                  />
                  <div className="h-8 w-8 rounded-md bg-secondary/40 shrink-0 overflow-hidden">
                    {entry.playlist.cover_url ? (
                      <img src={entry.playlist.cover_url} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <div className="h-full w-full flex items-center justify-center bg-secondary/60">
                        <span className="text-[10px] text-muted-foreground">{index + 1}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-sm font-medium truncate text-primary-foreground flex-1 min-w-0">
                    {entry.playlist.name}
                  </p>
                  {entry.selected && (
                    <span className="text-[10px] text-primary font-medium shrink-0 flex items-center gap-1">
                      {formatDateTimeLabel(entry.start_date, entry.start_time)} <ArrowRight className="h-3 w-3" /> {formatDateTimeLabel(entry.end_date, entry.end_time)}
                    </span>
                  )}
                </div>

                {entry.selected && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-primary-foreground font-medium">Início</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left text-sm font-normal bg-primary/20 border-primary text-primary-foreground transition-colors",
                                entry.start_date && "!bg-primary !text-primary-foreground hover:!bg-primary/90 !border-primary"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                              {entry.start_date ? format(entry.start_date, "dd/MM/yyyy") : "Selecionar"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="z-[70] w-auto p-0 !bg-background border-border text-foreground"
                            align="start"
                            portalled={false}
                            onOpenAutoFocus={(e) => e.preventDefault()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Calendar
                              mode="single"
                              selected={entry.start_date ?? undefined}
                              onSelect={(date) => updateEntry(index, { start_date: date ?? null })}
                              disabled={(date) => date < toDateOnly(new Date())}
                              locale={ptBR}
                              formatters={{
                                formatCaption: (date) => format(date, "MMMM yyyy", { locale: ptBR }),
                                formatWeekdayName: (date) => DAY_LABELS[date.getDay()],
                              }}
                              className="p-2 pointer-events-auto"
                              classNames={calendarClassNames}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>

                      <div className="space-y-1.5">
                        <label className="text-xs text-primary-foreground font-medium">Término</label>
                        <Popover>
                          <PopoverTrigger asChild>
                            <Button
                              variant="outline"
                              className={cn(
                                "w-full justify-start text-left text-sm font-normal bg-primary/20 border-primary text-primary-foreground transition-colors",
                                entry.end_date && "!bg-primary !text-primary-foreground hover:!bg-primary/90 !border-primary"
                              )}
                            >
                              <CalendarIcon className="mr-2 h-4 w-4 shrink-0 text-primary" />
                              {entry.end_date ? format(entry.end_date, "dd/MM/yyyy") : "Selecionar"}
                            </Button>
                          </PopoverTrigger>
                          <PopoverContent
                            className="z-[70] w-auto p-0 !bg-background border-border text-foreground"
                            align="start"
                            portalled={false}
                            onOpenAutoFocus={(e) => e.preventDefault()}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Calendar
                              mode="single"
                              selected={entry.end_date ?? undefined}
                              onSelect={(date) => updateEntry(index, { end_date: date ?? null })}
                              disabled={(date) => {
                                const today = toDateOnly(new Date());
                                if (date < today) return true;
                                if (entry.start_date && date < toDateOnly(entry.start_date)) return true;
                                return false;
                              }}
                              locale={ptBR}
                              formatters={{
                                formatCaption: (date) => format(date, "MMMM yyyy", { locale: ptBR }),
                                formatWeekdayName: (date) => DAY_LABELS[date.getDay()],
                              }}
                              className="p-2 pointer-events-auto"
                              classNames={calendarClassNames}
                            />
                          </PopoverContent>
                        </Popover>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="text-xs text-primary-foreground font-medium flex items-center gap-1.5">
                          <Clock className="h-3.5 w-3.5 text-primary" />
                          Horário Início
                        </label>
                        <input
                          type="time"
                          value={entry.start_time}
                          onChange={(e) => updateEntry(index, { start_time: e.target.value })}
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
                          value={entry.end_time}
                          onChange={(e) => updateEntry(index, { end_time: e.target.value })}
                          className="w-full bg-secondary/50 border border-border rounded-lg px-3 py-2.5 text-sm text-primary-foreground outline-none focus:border-primary"
                        />
                      </div>
                    </div>

                    {/* Volume slider */}
                    <div className="space-y-1">
                      <label className="text-xs text-primary-foreground font-medium flex items-center gap-1.5">
                        <Volume2 className="h-3.5 w-3.5 text-primary" />
                        Volume
                        <span className="text-primary font-semibold ml-auto">
                          {entry.scheduled_volume != null ? `${entry.scheduled_volume}%` : "Padrão"}
                        </span>
                      </label>
                      <div className="flex items-center gap-2">
                        <Slider
                          min={10}
                          max={100}
                          step={5}
                          value={[entry.scheduled_volume ?? 70]}
                          onValueChange={([v]) => updateEntry(index, { scheduled_volume: v })}
                          className="flex-1"
                        />
                        <button
                          type="button"
                          className="text-[10px] text-muted-foreground hover:text-primary-foreground px-1"
                          onClick={() => updateEntry(index, { scheduled_volume: null })}
                        >
                          Reset
                        </button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              onClick={handleSave}
              disabled={saving || conflicts.length > 0 || selectedEntries.length < 2 || selectedEntries.length > MAX_GROUP_PLAYLISTS}
              className="flex-1 gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Salvar ({selectedEntries.length})
            </Button>
            <Button variant="outline" onClick={() => onOpenChange(false)} className="text-primary-foreground border-border hover:bg-secondary/30">
              Cancelar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default GroupScheduleDialog;