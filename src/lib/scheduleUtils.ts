export interface ScheduleWindow {
  id: string;
  playlist_id: string;
  start_time: string;
  end_time: string;
  days_of_week: number[];
  is_active: boolean;
  updated_at?: string;
  start_date?: string | null;
  end_date?: string | null;
}

export const DAY_LABELS_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const MINUTES_IN_DAY = 24 * 60;

export const parseTimeToMinutes = (timeValue: string): number | null => {
  const [hourText, minuteText] = timeValue.split(":");
  const hours = Number(hourText);
  const minutes = Number(minuteText);

  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;

  return hours * 60 + minutes;
};

export const formatScheduleDays = (daysOfWeek: number[]): string => {
  if (!daysOfWeek.length) return "Sem dias selecionados";

  const uniqueDays = [...new Set(daysOfWeek)]
    .filter((day) => day >= 0 && day <= 6)
    .sort((a, b) => a - b);

  if (uniqueDays.length === 7) return "Todos os dias";

  return uniqueDays.map((day) => DAY_LABELS_SHORT[day]).join(", ");
};

export const formatScheduleRange = (startTime: string, endTime: string): string => {
  return `${startTime.slice(0, 5)} → ${endTime.slice(0, 5)}`;
};

export const isScheduleActiveAt = (schedule: ScheduleWindow, now: Date): boolean => {
  if (!schedule.is_active || !schedule.days_of_week?.length) return false;

  // Check date range if start_date/end_date are set
  if (schedule.start_date || schedule.end_date) {
    const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    if (schedule.start_date && todayStr < schedule.start_date) return false;
    if (schedule.end_date && todayStr > schedule.end_date) return false;
  }

  const startMinutes = parseTimeToMinutes(schedule.start_time);
  const endMinutes = parseTimeToMinutes(schedule.end_time);

  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();

  if (startMinutes < endMinutes) {
    return schedule.days_of_week.includes(today) && currentMinutes >= startMinutes && currentMinutes < endMinutes;
  }

  const yesterday = (today + 6) % 7;
  const inLateWindow = schedule.days_of_week.includes(today) && currentMinutes >= startMinutes;
  const inAfterMidnightWindow = schedule.days_of_week.includes(yesterday) && currentMinutes < endMinutes;

  return inLateWindow || inAfterMidnightWindow;
};

const getStartAnchor = (schedule: ScheduleWindow, now: Date): number => {
  const startMinutes = parseTimeToMinutes(schedule.start_time);
  const endMinutes = parseTimeToMinutes(schedule.end_time);

  if (startMinutes === null || endMinutes === null) return -Infinity;

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  const yesterday = (today + 6) % 7;

  if (startMinutes < endMinutes) {
    return startMinutes;
  }

  if (currentMinutes >= startMinutes && schedule.days_of_week.includes(today)) {
    return startMinutes;
  }

  if (currentMinutes < endMinutes && schedule.days_of_week.includes(yesterday)) {
    return startMinutes - MINUTES_IN_DAY;
  }

  return startMinutes;
};

export const getCurrentActiveSchedule = (
  schedules: ScheduleWindow[],
  now: Date
): ScheduleWindow | null => {
  const activeSchedules = schedules.filter((schedule) => isScheduleActiveAt(schedule, now));

  if (!activeSchedules.length) return null;

  return activeSchedules.sort((a, b) => getStartAnchor(b, now) - getStartAnchor(a, now))[0];
};
