// Weekly review loop (Yearwise spec §6.1, §6.2, §6.5): the recurring habit and
// review rows for any week, the fresh-start rule and the score trend. Pure, so the
// server writes exactly what the tests check.
import { z } from "zod";
import { type Answers, V, freqOption, habitWeeklyMins } from "./yearwise";
import { HABIT_PREFIX, REVIEW_PILLAR, REVIEW_TITLE } from "./yearwise-output";

/* ================= dates (ISO yyyy-mm-dd, timezone-free) ================= */

const toDate = (s: string) => new Date(s + "T00:00:00Z");
const toISO = (d: Date) => d.toISOString().slice(0, 10);

export function addDaysISO(s: string, n: number) {
  const d = toDate(s);
  d.setUTCDate(d.getUTCDate() + n);
  return toISO(d);
}

// The Monday of the week containing s.
export function mondayOf(s: string) {
  const day = toDate(s).getUTCDay();
  return addDaysISO(s, day === 0 ? -6 : 1 - day);
}

const weeksBetween = (from: string, to: string) => Math.round((toDate(to).getTime() - toDate(from).getTime()) / (7 * 86400000));

/* ================= recurring rows (§6.3, §4.6 steps 2–3) ================= */

export interface HabitLike {
  id: number;
  title: string;
  cue: string | null;
  freqKey: string;
  minsEach: number | null;
  pillar: string | null;
  parent90DayGoalId: number | null;
}

export interface RecurringRow {
  source: "habit" | "review";
  habitId: number | null;
  pillar: string;
  goalTitle: string;
  goalDescription: string | null;
  priority: number;
  timeEstimateMins: number | null;
  parent90DayGoal: string | null;
  ninetyDayGoalId: number | null;
  notes: string;
}

// The habit rows and review row for one week, worded as the Yearwise commit
// words them for weeks 1–2, so later weeks read the same.
export function recurringRows(habits: HabitLike[], a: Answers, goalTitles: Record<number, string> = {}): RecurringRow[] {
  const rows: RecurringRow[] = [];
  if (V(a, "addHabits") !== "no") {
    for (const h of habits) {
      const f = freqOption(h.freqKey);
      rows.push({
        source: "habit",
        habitId: h.id,
        pillar: h.pillar || V(a, "annual.pillar") || "Personal",
        goalTitle: HABIT_PREFIX + h.title,
        goalDescription: [h.cue, f ? f.short : ""].filter(Boolean).join(" · ") || null,
        priority: 2,
        timeEstimateMins: habitWeeklyMins(h.minsEach ?? 0, h.freqKey),
        parent90DayGoal: h.parent90DayGoalId != null ? goalTitles[h.parent90DayGoalId] ?? null : null,
        ninetyDayGoalId: h.parent90DayGoalId,
        notes: "Recurring habit" + (f ? ` (${f.short})` : ""),
      });
    }
  }
  if (V(a, "review.day")) {
    rows.push({
      source: "review",
      habitId: null,
      pillar: REVIEW_PILLAR,
      goalTitle: REVIEW_TITLE,
      goalDescription: `${V(a, "review.day")}${V(a, "review.time") ? " " + V(a, "review.time") : ""}: done / slipped / why; score each 90-day goal 1–10; set next week`,
      priority: 1,
      timeEstimateMins: Number(V(a, "review.mins")) || 20,
      parent90DayGoal: null,
      ninetyDayGoalId: null,
      notes: "Keeps the cascade honest",
    });
  }
  return rows;
}

/* ================= fresh start (§6.5) ================= */

// True on a Monday or the 1st of the month when two or more whole weeks have gone
// by without a review. Counted from the last reviewed week, or, if there has never
// been one, from the first week that had a review row.
export function isFreshStart(today: string, reviewedWeeks: string[], firstReviewWeek: string | null): boolean {
  const day = toDate(today);
  if (day.getUTCDay() !== 1 && day.getUTCDate() !== 1) return false;
  const thisWeek = mondayOf(today);
  const past = reviewedWeeks.filter((w) => w < thisWeek).sort();
  const last = past[past.length - 1];
  if (last) return weeksBetween(last, thisWeek) - 1 >= 2;
  if (!firstReviewWeek || firstReviewWeek >= thisWeek) return false;
  return weeksBetween(firstReviewWeek, thisWeek) >= 2;
}

/* ================= score trend (§6.2) ================= */

export interface ScorePoint { weekStartDate: string; score: number }

export function scoreTrend(points: ScorePoint[]) {
  const sorted = [...points].sort((x, y) => x.weekStartDate.localeCompare(y.weekStartDate));
  return { points: sorted, latest: sorted.length ? sorted[sorted.length - 1].score : null };
}

/* ================= saving a review (POST /api/weekly-review) ================= */

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

// Unknown keys are stripped, so a client still sending the old done / slipped /
// why notes has them ignored.
export const reviewBody = z.object({
  weekStartDate: isoDate,
  // The checklist: completed flags written back to these weekly_goals rows.
  goals: z.array(z.object({
    id: z.number().int(),
    completed: z.boolean(),
    note: z.string().max(2000).nullable().optional(),
  })).default([]),
  scores: z.array(z.object({ ninetyDayGoalId: z.number().int(), score: z.number().int().min(1).max(10) })).default([]),
  nextGoals: z.array(z.object({
    pillar: z.string().min(1),
    goalTitle: z.string().trim().min(1),
    priority: z.number().int().min(1).max(3).nullable().default(2),
    timeEstimateMins: z.number().int().min(0).nullable().default(null),
    ninetyDayGoalId: z.number().int().nullable().default(null),
  })).default([]),
});
