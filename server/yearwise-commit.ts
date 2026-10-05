// "Commit to Daily Compass" for a Yearwise session (spec §7 Prompt D): writes the
// session's answers into the real tier 1–3 tables in one transaction.
//
// Every record written carries yearwise_session_id plus a position key
// (annual target: one per session; 90-day goals "g0"–"g2"; habits "h0"…; weekly
// rows "w1.plan.0", "w1.habit.2", "w2.review"; if–then plans by sort; life
// check-ins by area). Re-committing the same session updates those records in
// place, deactivates goals/habits that were removed, and deletes weekly rows that
// are no longer generated. Each weekly row is also written to weekly_goals,
// linked by weekly_goal_template_id, alongside any goals the user entered.
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { PgDatabase } from "drizzle-orm/pg-core";
import * as schema from "@shared/schema";
import {
  yearwiseSessions, annualTargets, ninetyDayGoals, ifThenPlans, habits, weeklyGoalTemplates, weeklyGoals, lifeCheckins,
  type YearwiseSession,
} from "@shared/schema";
import { type Answers, AREAS, V, deriveDates, iso, migrateParents } from "@shared/yearwise";
import { habitList, horizonLabel, ninetyList, periodLabel, weeklyRows } from "@shared/yearwise-output";

// Works with both the app's node-postgres db and the PGlite db used in tests.
export type Db = PgDatabase<any, typeof schema>;

export interface CommitResult {
  session: YearwiseSession;
  weekOneStart: string;
  annualTargetId: number;
  counts: {
    ninetyDayGoals: number;
    ifThenPlans: number;
    habits: number;
    weeklyGoals: number;
    lifeCheckins: number;
  };
}

const intOrNull = (s: string) => {
  const n = parseInt(s, 10);
  return Number.isNaN(n) ? null : n;
};

// Returns undefined when the session doesn't exist.
export async function commitYearwiseSession(
  db: Db,
  sessionId: number,
  rawAnswers: Answers,
  today: Date = new Date(),
): Promise<CommitResult | undefined> {
  const a = migrateParents(rawAnswers);
  const d = deriveDates(a, today);
  const start = iso(d.start);

  return db.transaction(async (tx) => {
    // The answers sent with the commit are what gets written, so save them first.
    const [saved] = await tx.update(yearwiseSessions)
      .set({ answers: a, planStart: start, updatedAt: new Date() })
      .where(eq(yearwiseSessions.id, sessionId))
      .returning({ id: yearwiseSessions.id });
    if (!saved) return undefined;

    /* ---------- tier 1: annual target (one per session) ---------- */
    const annualValues = {
      title: V(a, "annual.title") || "Untitled annual target",
      measure: V(a, "annual.measure"),
      horizon: horizonLabel(d),
      motive: V(a, "annual.motive") || null,
      active: true,
      yearwiseSessionId: sessionId,
    };
    const [existingTarget] = await tx.select({ id: annualTargets.id }).from(annualTargets)
      .where(eq(annualTargets.yearwiseSessionId, sessionId))
      .orderBy(annualTargets.id)
      .limit(1);
    const annualTargetId = existingTarget
      ? (await tx.update(annualTargets).set(annualValues).where(eq(annualTargets.id, existingTarget.id)).returning({ id: annualTargets.id }))[0].id
      : (await tx.insert(annualTargets).values(annualValues).returning({ id: annualTargets.id }))[0].id;

    /* ---------- tier 2: 90-day goals and their if–then plans ---------- */
    const goals = ninetyList(a, d);
    const existingGoals = await tx.select({ id: ninetyDayGoals.id, key: ninetyDayGoals.yearwiseKey }).from(ninetyDayGoals)
      .where(eq(ninetyDayGoals.yearwiseSessionId, sessionId));
    const goalByKey = new Map(existingGoals.map((g) => [g.key, g.id]));
    const goalIds: Record<string, number> = {};
    let planCount = 0;

    for (const g of goals) {
      const values = {
        annualTargetId,
        periodLabel: periodLabel(d.start, d.q),
        startDate: g.start_date,
        endDate: g.end_date,
        goalText: g.title,
        definitionOfDone: g.definition_of_done || null,
        woopOutcome: g.woop.outcome || null,
        woopObstacle: g.woop.obstacle || null,
        track: g.track || null,
        movesAnnual: g.moves_annual_target,
        active: true,
        yearwiseSessionId: sessionId,
        yearwiseKey: g.key,
      };
      const existingId = goalByKey.get(g.key);
      const id = existingId
        ? (await tx.update(ninetyDayGoals).set(values).where(eq(ninetyDayGoals.id, existingId)).returning({ id: ninetyDayGoals.id }))[0].id
        : (await tx.insert(ninetyDayGoals).values(values).returning({ id: ninetyDayGoals.id }))[0].id;
      goalIds[g.key] = id;

      // If–then plans keyed on (goal, sort).
      const existingPlans = await tx.select({ id: ifThenPlans.id, sort: ifThenPlans.sort }).from(ifThenPlans)
        .where(eq(ifThenPlans.ninetyDayGoalId, id));
      const planBySort = new Map(existingPlans.map((p) => [p.sort, p.id]));
      for (const p of g.woop.if_then_plans) {
        const pv = { ninetyDayGoalId: id, ifText: p.if, thenText: p.then, sort: p.sort };
        const pid = planBySort.get(p.sort);
        if (pid) await tx.update(ifThenPlans).set(pv).where(eq(ifThenPlans.id, pid));
        else await tx.insert(ifThenPlans).values(pv);
        planCount++;
      }
      const keepSorts = g.woop.if_then_plans.map((p) => p.sort);
      await tx.delete(ifThenPlans).where(and(
        eq(ifThenPlans.ninetyDayGoalId, id),
        keepSorts.length ? notInArray(ifThenPlans.sort, keepSorts) : sql`true`,
      ));
    }
    // Goals removed from the session since the last commit: keep the row (weekly
    // review scores may point at it) but take it out of play.
    const droppedGoals = existingGoals.filter((g) => !g.key || !(g.key in goalIds)).map((g) => g.id);
    if (droppedGoals.length) await tx.update(ninetyDayGoals).set({ active: false }).where(inArray(ninetyDayGoals.id, droppedGoals));

    /* ---------- habits ---------- */
    const habitItems = habitList(a);
    const existingHabits = await tx.select({ id: habits.id, key: habits.yearwiseKey }).from(habits)
      .where(eq(habits.yearwiseSessionId, sessionId));
    const habitByKey = new Map(existingHabits.map((h) => [h.key, h.id]));
    const habitIds: Record<string, number> = {};
    for (const h of habitItems) {
      const values = {
        title: h.habit,
        cue: h.cue || null,
        freqKey: h.freqKey,
        minsEach: h.minutes_each,
        pillar: h.pillar || null,
        parent90DayGoalId: goalIds[h.parentRef] ?? null,
        active: true,
        yearwiseSessionId: sessionId,
        yearwiseKey: h.key,
      };
      const existingId = habitByKey.get(h.key);
      habitIds[h.key] = existingId
        ? (await tx.update(habits).set(values).where(eq(habits.id, existingId)).returning({ id: habits.id }))[0].id
        : (await tx.insert(habits).values(values).returning({ id: habits.id }))[0].id;
    }
    const droppedHabits = existingHabits.filter((h) => !h.key || !(h.key in habitIds)).map((h) => h.id);
    if (droppedHabits.length) await tx.update(habits).set({ active: false }).where(inArray(habits.id, droppedHabits));

    /* ---------- tier 3: weeks 1–2 weekly goals ---------- */
    const rows = weeklyRows(a, d);
    const goalPillar: Record<string, string> = Object.fromEntries(goals.map((g) => [g.key, g.pillar]));
    const existingRows = await tx.select({ id: weeklyGoalTemplates.id, key: weeklyGoalTemplates.yearwiseKey }).from(weeklyGoalTemplates)
      .where(eq(weeklyGoalTemplates.yearwiseSessionId, sessionId));
    const rowByKey = new Map(existingRows.map((r) => [r.key, r.id]));
    const sortCounters: Record<string, number> = {};
    const writtenKeys = new Set<string>();
    const written: { templateId: number; values: { weekStartDate: string; pillar: string; goalTitle: string; source: string; habitId: number | null; ninetyDayGoalId: number | null } }[] = [];

    for (const r of rows) {
      // pillar is NOT NULL on weekly_goal_templates; the readiness check has
      // already warned about the gap, so borrow the parent goal's or the annual one.
      const pillar = r.pillar || goalPillar[r.parentRef] || V(a, "annual.pillar") || "Personal";
      const bucket = `${r.week_start_date}|${pillar}`;
      const sortOrder = sortCounters[bucket] ?? 0;
      sortCounters[bucket] = sortOrder + 1;
      const values = {
        weekStartDate: r.week_start_date,
        pillar,
        track: r.track || null,
        goalTitle: r.goal_title,
        goalDescription: r.goal_description || null,
        priority: intOrNull(r.priority),
        timeEstimateMins: intOrNull(r.time_estimate_mins),
        parent90DayGoal: r.parent_90day_goal || null,
        notes: r.notes || null,
        sortOrder,
        source: r.source,
        habitId: habitIds[r.habitKey] ?? null,
        ninetyDayGoalId: goalIds[r.parentRef] ?? null,
        yearwiseSessionId: sessionId,
        yearwiseKey: r.key,
      };
      const existingId = rowByKey.get(r.key);
      // Updates leave `status` alone so progress made since the last commit survives.
      const templateId = existingId
        ? (await tx.update(weeklyGoalTemplates).set(values).where(eq(weeklyGoalTemplates.id, existingId)).returning({ id: weeklyGoalTemplates.id }))[0].id
        : (await tx.insert(weeklyGoalTemplates).values({ ...values, status: "not_started" }).returning({ id: weeklyGoalTemplates.id }))[0].id;
      written.push({ templateId, values });
      writtenKeys.add(r.key);
    }
    const staleRows = existingRows.filter((r) => !r.key || !writtenKeys.has(r.key)).map((r) => r.id);

    /* ---------- the same rows as live weekly goals ---------- */
    // So they show in "This week's goals" without an accept step. Matched to their
    // template by weekly_goal_template_id; rows without one (the user's manual
    // goals) are never selected, updated or deleted here. Never goes through
    // createWeeklyGoals, which wipes the whole week.
    const templateIds = [...written.map((w) => w.templateId), ...staleRows];
    const linkedGoals = templateIds.length
      ? await tx.select({ id: weeklyGoals.id, templateId: weeklyGoals.weeklyGoalTemplateId, completed: weeklyGoals.completed })
        .from(weeklyGoals).where(inArray(weeklyGoals.weeklyGoalTemplateId, templateIds))
      : [];
    const goalByTemplate = new Map(linkedGoals.map((g) => [g.templateId, g]));
    // New rows go after whatever is already in that week's pillar.
    const weeks = Array.from(new Set(written.map((w) => w.values.weekStartDate)));
    const maxSorts = weeks.length
      ? await tx.select({ week: weeklyGoals.weekStartDate, category: weeklyGoals.category, max: sql<number>`max(${weeklyGoals.sortOrder})` })
        .from(weeklyGoals).where(inArray(weeklyGoals.weekStartDate, weeks))
        .groupBy(weeklyGoals.weekStartDate, weeklyGoals.category)
      : [];
    const nextSort: Record<string, number> = Object.fromEntries(maxSorts.map((m) => [`${m.week}|${m.category}`, Number(m.max) + 1]));

    for (const { templateId, values } of written) {
      const goalValues = {
        weekStartDate: values.weekStartDate,
        category: values.pillar,
        goalText: values.goalTitle,
        source: values.source,
        habitId: values.habitId,
        ninetyDayGoalId: values.ninetyDayGoalId,
        weeklyGoalTemplateId: templateId,
      };
      const existing = goalByTemplate.get(templateId);
      // Updates leave completed, is_top_focus and sort_order as the user left them.
      if (existing) await tx.update(weeklyGoals).set(goalValues).where(eq(weeklyGoals.id, existing.id));
      else {
        const bucket = `${values.weekStartDate}|${values.pillar}`;
        const sortOrder = nextSort[bucket] ?? 0;
        nextSort[bucket] = sortOrder + 1;
        await tx.insert(weeklyGoals).values({ ...goalValues, sortOrder, completed: false });
      }
    }
    // Weekly rows no longer generated: drop their open goals; completed ones stay
    // as a record (their template link goes null when the template is deleted).
    const staleGoals = linkedGoals.filter((g) => g.templateId != null && staleRows.includes(g.templateId) && !g.completed).map((g) => g.id);
    if (staleGoals.length) await tx.delete(weeklyGoals).where(inArray(weeklyGoals.id, staleGoals));
    if (staleRows.length) await tx.delete(weeklyGoalTemplates).where(inArray(weeklyGoalTemplates.id, staleRows));

    /* ---------- life check-ins ---------- */
    const scored = AREAS.map(([k]) => ({ k, score: Number(V(a, `life.${k}.score`)) }))
      .filter((x) => Number.isInteger(x.score) && x.score >= 1 && x.score <= 10);
    for (const { k, score } of scored) {
      const values = { yearwiseSessionId: sessionId, areaKey: k, score, why: V(a, `life.${k}.why`) || null, plusTwo: V(a, `life.${k}.plus2`) || null };
      await tx.insert(lifeCheckins).values(values).onConflictDoUpdate({
        target: [lifeCheckins.yearwiseSessionId, lifeCheckins.areaKey],
        set: { score: values.score, why: values.why, plusTwo: values.plusTwo },
      });
    }
    const scoredKeys = scored.map((x) => x.k);
    await tx.delete(lifeCheckins).where(and(
      eq(lifeCheckins.yearwiseSessionId, sessionId),
      scoredKeys.length ? notInArray(lifeCheckins.areaKey, scoredKeys) : sql`true`,
    ));

    /* ---------- mark committed ---------- */
    const now = new Date();
    const [session] = await tx.update(yearwiseSessions)
      .set({ status: "committed", committedAt: now, updatedAt: now })
      .where(eq(yearwiseSessions.id, sessionId))
      .returning();

    return {
      session,
      weekOneStart: start,
      annualTargetId,
      counts: {
        ninetyDayGoals: goals.length,
        ifThenPlans: planCount,
        habits: habitItems.length,
        weeklyGoals: rows.length,
        lifeCheckins: scored.length,
      },
    };
  });
}
