// Weekly review loop (Yearwise spec §6.1, §6.2, §6.5): saving a review, reading
// score trends, and generating each week's habit and review rows.
import { and, asc, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import {
  yearwiseSessions, ninetyDayGoals, ifThenPlans, habits, weeklyGoalTemplates, weeklyGoals,
  weeklyReviews, weeklyReviewScores,
  type IfThenPlan, type NinetyDayGoal, type WeeklyReview,
} from "@shared/schema";
import type { Answers } from "@shared/yearwise";
import { addDaysISO, isFreshStart, mondayOf, recurringRows, type ScorePoint } from "@shared/weekly-review";
import type { Db } from "./yearwise-commit";

export interface GoalWithTrend extends NinetyDayGoal {
  plans: IfThenPlan[];
  history: ScorePoint[];
}

export interface ReviewContext {
  weekStartDate: string;
  review: WeeklyReview | null;
  scores: Record<number, number>; // ninetyDayGoalId → score, for this week's review
  goals: GoalWithTrend[];
}

export interface NextWeekGoalInput {
  pillar: string;
  goalTitle: string;
  priority: number | null;
  timeEstimateMins: number | null;
  ninetyDayGoalId: number | null;
}

// One row of the review's checklist: a weekly goal from the reviewed week, its
// completed flag as left in the review, and an optional note.
export interface ReviewGoalInput {
  id: number;
  completed: boolean;
  note?: string | null;
}

export interface WeeklyReviewInput {
  weekStartDate: string;
  goals: ReviewGoalInput[];
  scores: { ninetyDayGoalId: number; score: number }[];
  nextGoals: NextWeekGoalInput[];
}

/* ---------- reading ---------- */

// Active 90-day goals whose window overlaps the week, with their if–then plans and
// every weekly score so far.
export async function goalsWithTrends(db: Db, weekStartDate: string): Promise<GoalWithTrend[]> {
  const weekEnd = addDaysISO(weekStartDate, 6);
  const goals = await db.select().from(ninetyDayGoals)
    .where(and(eq(ninetyDayGoals.active, true), lte(ninetyDayGoals.startDate, weekEnd), gte(ninetyDayGoals.endDate, weekStartDate)))
    .orderBy(sql`${ninetyDayGoals.yearwiseKey} asc nulls last`, asc(ninetyDayGoals.id));
  if (!goals.length) return [];
  const ids = goals.map((g) => g.id);
  const plans = await db.select().from(ifThenPlans).where(inArray(ifThenPlans.ninetyDayGoalId, ids)).orderBy(ifThenPlans.sort);
  const scores = await db.select({ goalId: weeklyReviewScores.ninetyDayGoalId, score: weeklyReviewScores.score, weekStartDate: weeklyReviews.weekStartDate })
    .from(weeklyReviewScores)
    .innerJoin(weeklyReviews, eq(weeklyReviews.id, weeklyReviewScores.reviewId))
    .where(inArray(weeklyReviewScores.ninetyDayGoalId, ids))
    .orderBy(weeklyReviews.weekStartDate);
  return goals.map((g) => ({
    ...g,
    plans: plans.filter((p) => p.ninetyDayGoalId === g.id),
    history: scores.filter((s) => s.goalId === g.id).map((s) => ({ weekStartDate: s.weekStartDate, score: s.score })),
  }));
}

export async function getReviewContext(db: Db, weekStartDate: string): Promise<ReviewContext> {
  const [review] = await db.select().from(weeklyReviews).where(eq(weeklyReviews.weekStartDate, weekStartDate));
  const scores: Record<number, number> = {};
  if (review) {
    for (const s of await db.select().from(weeklyReviewScores).where(eq(weeklyReviewScores.reviewId, review.id))) {
      scores[s.ninetyDayGoalId] = s.score;
    }
  }
  return { weekStartDate, review: review ?? null, scores, goals: await goalsWithTrends(db, weekStartDate) };
}

// Whether to show "New week, fresh start" today.
export async function freshStartFor(db: Db, today: string): Promise<boolean> {
  const reviewed = (await db.select({ w: weeklyReviews.weekStartDate }).from(weeklyReviews)).map((r) => r.w);
  const [first] = await db.select({ w: weeklyGoalTemplates.weekStartDate }).from(weeklyGoalTemplates)
    .where(eq(weeklyGoalTemplates.source, "review"))
    .orderBy(weeklyGoalTemplates.weekStartDate)
    .limit(1);
  return isFreshStart(today, reviewed, first?.w ?? null);
}

/* ---------- saving a review ---------- */

// One transaction: the checklist's completed flags written back to the week's
// weekly goals, the review (one per week, so re-saving updates it) with its
// per-goal notes, its scores, next week's goals (a plan row holding priority /
// mins / parent, plus the live weekly goal linked to it), and the week's review
// goal marked done.
export async function saveWeeklyReview(db: Db, input: WeeklyReviewInput) {
  const week = input.weekStartDate;
  const nextWeek = addDaysISO(week, 7);
  return db.transaction(async (tx) => {
    // Only this week's goals, and not the review goal itself (marked done below).
    // Rows are only ever updated here, never deleted or re-created, and only their
    // completed flag changes.
    const weekIds = new Set((await tx.select({ id: weeklyGoals.id, source: weeklyGoals.source }).from(weeklyGoals)
      .where(eq(weeklyGoals.weekStartDate, week)))
      .filter((g) => g.source !== "review").map((g) => g.id));
    const checklist = input.goals.filter((g) => weekIds.has(g.id));
    for (const completed of [true, false]) {
      const ids = checklist.filter((g) => g.completed === completed).map((g) => g.id);
      if (ids.length) await tx.update(weeklyGoals).set({ completed })
        .where(and(eq(weeklyGoals.weekStartDate, week), inArray(weeklyGoals.id, ids)));
    }

    const goalNotes: Record<string, string> = {};
    for (const g of checklist) {
      const note = g.note?.trim();
      if (note) goalNotes[String(g.id)] = note;
    }
    // done_notes / slipped_notes / why_notes are no longer written; an older
    // review's text is left as it was.
    const [review] = await tx.insert(weeklyReviews).values({ weekStartDate: week, goalNotes })
      .onConflictDoUpdate({ target: weeklyReviews.weekStartDate, set: { goalNotes } })
      .returning();

    for (const s of input.scores) {
      await tx.insert(weeklyReviewScores).values({ reviewId: review.id, ninetyDayGoalId: s.ninetyDayGoalId, score: s.score })
        .onConflictDoUpdate({ target: [weeklyReviewScores.reviewId, weeklyReviewScores.ninetyDayGoalId], set: { score: s.score } });
    }
    const keep = input.scores.map((s) => s.ninetyDayGoalId);
    await tx.delete(weeklyReviewScores).where(and(
      eq(weeklyReviewScores.reviewId, review.id),
      keep.length ? notInArray(weeklyReviewScores.ninetyDayGoalId, keep) : sql`true`,
    ));

    const created: number[] = [];
    if (input.nextGoals.length) {
      const goalIds = input.nextGoals.map((g) => g.ninetyDayGoalId).filter((x): x is number => x != null);
      const titles = new Map(goalIds.length
        ? (await tx.select({ id: ninetyDayGoals.id, t: ninetyDayGoals.goalText }).from(ninetyDayGoals).where(inArray(ninetyDayGoals.id, goalIds))).map((g) => [g.id, g.t])
        : []);
      const nextSort = await sortCounters(tx, nextWeek);
      for (const g of input.nextGoals) {
        const sortOrder = bump(nextSort, g.pillar);
        const [tpl] = await tx.insert(weeklyGoalTemplates).values({
          weekStartDate: nextWeek, pillar: g.pillar, goalTitle: g.goalTitle, priority: g.priority,
          timeEstimateMins: g.timeEstimateMins, parent90DayGoal: g.ninetyDayGoalId != null ? titles.get(g.ninetyDayGoalId) ?? null : null,
          ninetyDayGoalId: g.ninetyDayGoalId, source: "manual", status: "not_started", sortOrder,
        }).returning({ id: weeklyGoalTemplates.id });
        const [goal] = await tx.insert(weeklyGoals).values({
          weekStartDate: nextWeek, category: g.pillar, goalText: g.goalTitle, sortOrder, completed: false,
          ninetyDayGoalId: g.ninetyDayGoalId, source: "manual", weeklyGoalTemplateId: tpl.id,
        }).returning({ id: weeklyGoals.id });
        created.push(goal.id);
      }
    }

    await tx.update(weeklyGoals).set({ completed: true })
      .where(and(eq(weeklyGoals.weekStartDate, week), eq(weeklyGoals.source, "review")));
    await tx.update(weeklyGoalTemplates).set({ status: "done" })
      .where(and(eq(weeklyGoalTemplates.weekStartDate, week), eq(weeklyGoalTemplates.source, "review")));

    return { review, createdGoalIds: created };
  });
}

/* ---------- recurring habit and review rows ---------- */

// Next sort_order per pillar in a week's weekly_goals, so new rows go after the rest.
async function sortCounters(tx: Db, week: string): Promise<Record<string, number>> {
  const rows = await tx.select({ category: weeklyGoals.category, max: sql<number>`max(${weeklyGoals.sortOrder})` })
    .from(weeklyGoals).where(eq(weeklyGoals.weekStartDate, week)).groupBy(weeklyGoals.category);
  return Object.fromEntries(rows.map((r) => [r.category, Number(r.max) + 1]));
}

function bump(counters: Record<string, number>, key: string) {
  const n = counters[key] ?? 0;
  counters[key] = n + 1;
  return n;
}

// Creates the week's habit rows and review row from the latest committed Yearwise
// session, if they aren't there yet. A row counts as there when the week has a plan
// row for it (source 'habit' + habit_id, or source 'review') — including the rows the
// commit wrote for weeks 1–2 — so it's safe to call on every load, and a goal the
// user removed from the week isn't put back. New rows also go into weekly_goals.
// They carry no yearwise_session_id, so re-committing the session leaves them alone.
export async function ensureRecurringRows(db: Db, weekStartDate: string): Promise<{ created: number }> {
  const week = mondayOf(weekStartDate);
  return db.transaction(async (tx) => {
    // Two tabs loading at once mustn't both insert.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${"recurring:" + week}))`);

    const [session] = await tx.select().from(yearwiseSessions)
      .where(eq(yearwiseSessions.status, "committed"))
      .orderBy(desc(yearwiseSessions.committedAt))
      .limit(1);
    if (!session || week < session.planStart) return { created: 0 };

    const active = await tx.select().from(habits)
      .where(and(eq(habits.yearwiseSessionId, session.id), eq(habits.active, true)))
      .orderBy(habits.yearwiseKey);
    const parentIds = active.map((h) => h.parent90DayGoalId).filter((x): x is number => x != null);
    const goalTitles: Record<number, string> = Object.fromEntries(parentIds.length
      ? (await tx.select({ id: ninetyDayGoals.id, t: ninetyDayGoals.goalText }).from(ninetyDayGoals).where(inArray(ninetyDayGoals.id, parentIds))).map((g) => [g.id, g.t])
      : []);
    const rows = recurringRows(active, session.answers as Answers, goalTitles);
    if (!rows.length) return { created: 0 };

    const present = await tx.select({ source: weeklyGoalTemplates.source, habitId: weeklyGoalTemplates.habitId }).from(weeklyGoalTemplates)
      .where(and(eq(weeklyGoalTemplates.weekStartDate, week), inArray(weeklyGoalTemplates.source, ["habit", "review"])));
    const hasHabit = new Set(present.filter((p) => p.source === "habit").map((p) => p.habitId));
    const hasReview = present.some((p) => p.source === "review");

    const tplSort: Record<string, number> = {};
    for (const r of await tx.select({ pillar: weeklyGoalTemplates.pillar, max: sql<number>`max(${weeklyGoalTemplates.sortOrder})` })
      .from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.weekStartDate, week)).groupBy(weeklyGoalTemplates.pillar)) {
      tplSort[r.pillar] = Number(r.max) + 1;
    }
    const goalSort = await sortCounters(tx, week);

    let created = 0;
    for (const r of rows) {
      if (r.source === "habit" ? hasHabit.has(r.habitId) : hasReview) continue;
      const [tpl] = await tx.insert(weeklyGoalTemplates).values({
        weekStartDate: week, pillar: r.pillar, goalTitle: r.goalTitle, goalDescription: r.goalDescription,
        priority: r.priority, timeEstimateMins: r.timeEstimateMins, parent90DayGoal: r.parent90DayGoal, notes: r.notes,
        sortOrder: bump(tplSort, r.pillar), source: r.source, habitId: r.habitId, ninetyDayGoalId: r.ninetyDayGoalId,
        status: "not_started",
      }).returning({ id: weeklyGoalTemplates.id });
      await tx.insert(weeklyGoals).values({
        weekStartDate: week, category: r.pillar, goalText: r.goalTitle, sortOrder: bump(goalSort, r.pillar), completed: false,
        ninetyDayGoalId: r.ninetyDayGoalId, source: r.source, habitId: r.habitId, weeklyGoalTemplateId: tpl.id,
      });
      created++;
    }
    return { created };
  });
}
