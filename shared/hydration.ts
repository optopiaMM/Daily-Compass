// Water tracking: the day's total against the target. Pure, so the server, the
// day view's optimistic updates and the tests all add up the same way.
import { addDaysISO } from "./weekly-review";

export const DEFAULT_WATER_TARGET_ML = 2000;

// The "+" buttons on the day view.
export const WATER_PRESETS_ML = [250, 500] as const;

export interface WaterLogLike {
  id: number;
  date: string;
  amountMl: number;
  createdAt: Date | string;
}

// What the day view shows and the API returns for one date.
export interface HydrationDay {
  date: string;
  totalMl: number;
  targetMl: number;
  reached: boolean;
  logCount: number;
  lastLogMl: number | null; // what undo would take off
}

export const totalForDate = (logs: WaterLogLike[], date: string) =>
  logs.reduce((sum, l) => (l.date === date ? sum + l.amountMl : sum), 0);

export const targetOrDefault = (settings: { targetMl: number } | undefined | null) =>
  settings?.targetMl ?? DEFAULT_WATER_TARGET_ML;

export const isReached = (totalMl: number, targetMl: number) => targetMl > 0 && totalMl >= targetMl;

// 0–100 for the bar; past the target it stays full.
export const progressPct = (totalMl: number, targetMl: number) =>
  targetMl <= 0 ? 0 : Math.min(100, Math.round((totalMl / targetMl) * 100));

// The most recent log on that date: newest created_at, then highest id.
export function lastLogOf<T extends WaterLogLike>(logs: T[], date: string): T | undefined {
  let last: T | undefined;
  for (const l of logs) {
    if (l.date !== date) continue;
    if (!last) { last = l; continue; }
    const diff = new Date(l.createdAt).getTime() - new Date(last.createdAt).getTime();
    if (diff > 0 || (diff === 0 && l.id > last.id)) last = l;
  }
  return last;
}

export function hydrationDay(logs: WaterLogLike[], date: string, targetMl: number): HydrationDay {
  const totalMl = totalForDate(logs, date);
  return {
    date,
    totalMl,
    targetMl,
    reached: isReached(totalMl, targetMl),
    logCount: logs.filter((l) => l.date === date).length,
    lastLogMl: lastLogOf(logs, date)?.amountMl ?? null,
  };
}

/* ================= weekly summary ================= */

export const DAYS_IN_WEEK = 7;

export interface HydrationWeekSummary {
  daysHit: number; // days whose total reached the target, out of 7
  averageMl: number; // whole ml a day across all 7 days
}

// What the day view's glance and the weekly review both show for one week.
export interface HydrationWeek extends HydrationWeekSummary {
  weekStart: string;
  targetMl: number;
  days: { date: string; totalMl: number; hit: boolean }[]; // Mon–Sun
}

// Mon–Sun totals in, days hit and average out. A day with no logs is a 0: never
// hit, and still one of the 7 in the average. Missing days count as 0 too.
export function weeklySummary(dailyTotals: number[], targetMl: number): HydrationWeekSummary {
  const week = dailyTotals.slice(0, DAYS_IN_WEEK);
  return {
    daysHit: week.filter((t) => isReached(t, targetMl)).length,
    averageMl: Math.round(week.reduce((sum, t) => sum + t, 0) / DAYS_IN_WEEK),
  };
}

export const weekDates = (weekStart: string) => Array.from({ length: DAYS_IN_WEEK }, (_, i) => addDaysISO(weekStart, i));

// The week starting on weekStart (a Monday), from logs that may span other days.
export function hydrationWeek(logs: WaterLogLike[], weekStart: string, targetMl: number): HydrationWeek {
  const days = weekDates(weekStart).map((date) => {
    const totalMl = totalForDate(logs, date);
    return { date, totalMl, hit: isReached(totalMl, targetMl) };
  });
  return { weekStart, targetMl, days, ...weeklySummary(days.map((d) => d.totalMl), targetMl) };
}
