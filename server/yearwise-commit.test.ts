import { describe, it, expect, beforeEach } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@shared/schema";
import {
  yearwiseSessions, annualTargets, ninetyDayGoals, ifThenPlans, habits, weeklyGoalTemplates, weeklyGoals, lifeCheckins,
} from "@shared/schema";
import type { Answers } from "@shared/yearwise";
import { commitYearwiseSession, type Db } from "./yearwise-commit";

// A real Postgres (PGlite, in-process) with the app schema, so the transaction,
// FKs and the unique constraint on life_checkins behave as they do on Neon.
async function freshDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  const statements = await generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
  for (const s of statements) await client.exec(s);
  return db as unknown as Db;
}

const TODAY = new Date(2026, 8, 30); // Wed 30 Sep 2026

// Shaped like a real session: 3 goals, habits of every time type, two weeks.
const answers: Answers = {
  planStart: "2026-09-28",
  life: {
    health: { score: 4, why: "Unfit" },
    work: { score: 6, why: "OK" },
    friends: { score: 3, why: "Few new ones", plus2: "Two new friends" },
  },
  annual: { title: "Work 3 days a week on strategic water work", measure: "3 days a week for 6+ months", pillar: "Profit", motive: "want" },
  ninety: {
    0: {
      title: "Gain regular interesting work", pillar: "Profit", track: "other", trackOther: "Water", annual: "yes",
      done: "Signed commitment for 2+ days a week", outcome: "3 days a week", obstacle: "Reluctance to sell",
      if1: "I catch myself drifting", then1: "I book a coach slot", if2: "a call ends", then2: "I write the next action",
    },
    1: { title: "Make new friends", pillar: "People", annual: "no", done: "3 new friends", if1: "Friday comes", then1: "I text someone" },
    2: { title: "Get fit", pillar: "Personal", track: "QASR", annual: "no", done: "10k in 50 min", if1: "the alarm goes", then1: "I put my kit on" },
  },
  habits: {
    n: 5,
    0: { what: "Gym and touch rugby", cue: "Mon/Wed/Fri/Sat", freq: "4pw", mins: "45", pillar: "Personal", parent: "g2" },
    1: { what: "Meet a friend", cue: "Twice a month", freq: "2pm", mins: "180", pillar: "People", parent: "g1" },
    2: { what: "Read a book", cue: "When distracted", freq: "asneeded", mins: "30", pillar: "Personal Development & Learning" },
    3: { what: "No crisps", cue: "Every day", freq: "rule", mins: "", pillar: "Personal" },
    4: { what: "Pipeline outreach", cue: "Monday after coaching", freq: "weekly", mins: "60", pillar: "Profit", parent: "g0" },
  },
  weeks: {
    w1: {
      n: 3,
      0: { title: "AI coaching session", pillar: "Profit", priority: "1", mins: "30", parent: "g0" },
      1: { title: "Arrange a meetup", pillar: "People", mins: "90", parent: "g1" },
      2: { title: "Book date night", pillar: "People", priority: "1", mins: "15" },
    },
    w2: {
      0: { title: "Follow up CUSP", pillar: "Profit", track: "CUSP", mins: "30", parent: "g0" },
    },
  },
  review: { day: "Monday", time: "09:00", mins: "30" },
};

// Per week: 3 or 1 planned rows + 5 habit rows + 1 review row.
const EXPECTED_WEEKLY = 3 + 5 + 1 + (1 + 5 + 1);

let db: Db;
let sessionId: number;
let manualGoalId: number;

async function counts() {
  const n = async (t: any) => (await db.select().from(t)).length;
  return {
    annual: await n(annualTargets),
    ninety: await n(ninetyDayGoals),
    plans: await n(ifThenPlans),
    habits: await n(habits),
    weekly: (await db.select().from(weeklyGoalTemplates)).filter((r) => r.source !== "csv").length,
    csv: (await db.select().from(weeklyGoalTemplates)).filter((r) => r.source === "csv").length,
    checkins: await n(lifeCheckins),
    goals: (await db.select().from(weeklyGoals)).length,
  };
}

beforeEach(async () => {
  db = await freshDb();
  // Existing data the commit must leave alone.
  const [old] = await db.insert(annualTargets).values({ title: "Old target", measure: "x", horizon: "2026" }).returning();
  await db.insert(ninetyDayGoals).values({ annualTargetId: old.id, periodLabel: "June – August 2026", startDate: "2026-06-01", endDate: "2026-08-31", goalText: "Old goal" });
  await db.insert(weeklyGoalTemplates).values({ weekStartDate: "2026-09-28", pillar: "Profit", goalTitle: "From the CSV", source: "csv" });
  // A goal the user typed in for week 1 — must never be touched.
  [{ id: manualGoalId }] = await db.insert(weeklyGoals).values({
    weekStartDate: "2026-09-28", category: "People", goalText: "Call Mum", completed: true, sortOrder: 0, isTopFocus: true,
  }).returning();
  [{ id: sessionId }] = await db.insert(yearwiseSessions).values({ planStart: "2026-09-28", answers: {} }).returning();
});

describe("commitYearwiseSession", () => {
  it("creates the expected records and marks the session committed", async () => {
    const result = await commitYearwiseSession(db, sessionId, answers, TODAY);
    expect(result?.counts).toEqual({ ninetyDayGoals: 3, ifThenPlans: 4, habits: 5, weeklyGoals: EXPECTED_WEEKLY, lifeCheckins: 3 });
    expect(result?.weekOneStart).toBe("2026-09-28");

    expect(await counts()).toEqual({ annual: 2, ninety: 4, plans: 4, habits: 5, weekly: EXPECTED_WEEKLY, csv: 1, checkins: 3, goals: 1 + EXPECTED_WEEKLY });

    const [s] = await db.select().from(yearwiseSessions).where(eq(yearwiseSessions.id, sessionId));
    expect(s.status).toBe("committed");
    expect(s.committedAt).toBeInstanceOf(Date);

    const [target] = await db.select().from(annualTargets).where(eq(annualTargets.yearwiseSessionId, sessionId));
    expect(target).toMatchObject({ title: answers.annual && (answers.annual as any).title, measure: "3 days a week for 6+ months", motive: "want", horizon: "2026–27", active: true });

    const goals = await db.select().from(ninetyDayGoals).where(eq(ninetyDayGoals.yearwiseSessionId, sessionId)).orderBy(ninetyDayGoals.yearwiseKey);
    expect(goals.map((g) => g.goalText)).toEqual(["Gain regular interesting work", "Make new friends", "Get fit"]);
    expect(goals[0]).toMatchObject({
      annualTargetId: target.id, startDate: "2026-09-28", endDate: "2026-12-27", periodLabel: "September – December 2026",
      definitionOfDone: "Signed commitment for 2+ days a week", woopOutcome: "3 days a week", woopObstacle: "Reluctance to sell",
      track: "Water", movesAnnual: true, yearwiseKey: "g0",
    });
    expect(goals[1].movesAnnual).toBe(false);

    const byType = (src: string) => db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.source, src));
    expect((await byType("yearwise")).length).toBe(4);
    expect((await byType("habit")).length).toBe(10);
    const review = await byType("review");
    expect(review.map((r) => r.weekStartDate).sort()).toEqual(["2026-09-28", "2026-10-05"]);
    expect(review[0]).toMatchObject({ priority: 1, timeEstimateMins: 30, pillar: "Personal Development & Learning", ninetyDayGoalId: null });
  });

  it("re-committing the same session updates the same records instead of duplicating them", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const snapshot = async () => ({
      annual: (await db.select({ id: annualTargets.id }).from(annualTargets)).map((r) => r.id).sort(),
      goals: (await db.select({ id: ninetyDayGoals.id }).from(ninetyDayGoals)).map((r) => r.id).sort(),
      plans: (await db.select({ id: ifThenPlans.id }).from(ifThenPlans)).map((r) => r.id).sort(),
      habits: (await db.select({ id: habits.id }).from(habits)).map((r) => r.id).sort(),
      weekly: (await db.select({ id: weeklyGoalTemplates.id }).from(weeklyGoalTemplates)).map((r) => r.id).sort(),
      checkins: (await db.select({ id: lifeCheckins.id }).from(lifeCheckins)).map((r) => r.id).sort(),
    });
    const first = await snapshot();

    // Progress made in the weekly view between commits must survive.
    const [coaching] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseKey, "w1.plan.0"));
    await db.update(weeklyGoalTemplates).set({ status: "done" }).where(eq(weeklyGoalTemplates.id, coaching.id));

    await commitYearwiseSession(db, sessionId, answers, TODAY);
    expect(await snapshot()).toEqual(first);
    expect(await counts()).toEqual({ annual: 2, ninety: 4, plans: 4, habits: 5, weekly: EXPECTED_WEEKLY, csv: 1, checkins: 3, goals: 1 + EXPECTED_WEEKLY });
    const [after] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.id, coaching.id));
    expect(after.status).toBe("done");

    // An edited answer updates the row in place.
    const edited = structuredClone(answers);
    (edited.ninety as any)[1].title = "Make three new friends";
    await commitYearwiseSession(db, sessionId, edited, TODAY);
    expect(await snapshot()).toEqual(first);
    const [g1] = await db.select().from(ninetyDayGoals).where(eq(ninetyDayGoals.yearwiseKey, "g1"));
    expect(g1.goalText).toBe("Make three new friends");
    const [meetup] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseKey, "w1.plan.1"));
    expect(meetup.parent90DayGoal).toBe("Make three new friends");
  });

  it("deactivates removed goals and habits and drops their weekly rows on re-commit", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const trimmed = structuredClone(answers);
    delete (trimmed.ninety as any)[2];
    (trimmed.habits as any)[0].parent = "";
    (trimmed.habits as any).n = 4;
    await commitYearwiseSession(db, sessionId, trimmed, TODAY);

    const [g2] = await db.select().from(ninetyDayGoals).where(eq(ninetyDayGoals.yearwiseKey, "g2"));
    expect(g2.active).toBe(false);
    const [h4] = await db.select().from(habits).where(eq(habits.yearwiseKey, "h4"));
    expect(h4.active).toBe(false);
    const rows = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseSessionId, sessionId));
    expect(rows.some((r) => r.yearwiseKey?.endsWith(".habit.4"))).toBe(false);
    expect(rows.length).toBe(EXPECTED_WEEKLY - 2);
  });

  it("resolves parent references to real foreign keys", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const goals = await db.select().from(ninetyDayGoals).where(eq(ninetyDayGoals.yearwiseSessionId, sessionId));
    const goalId = (key: string) => goals.find((g) => g.yearwiseKey === key)!.id;
    const [target] = await db.select().from(annualTargets).where(eq(annualTargets.yearwiseSessionId, sessionId));
    for (const g of goals) expect(g.annualTargetId).toBe(target.id);

    const plans = await db.select().from(ifThenPlans);
    expect(plans.filter((p) => p.ninetyDayGoalId === goalId("g0")).map((p) => p.sort).sort()).toEqual([1, 2]);

    const hs = await db.select().from(habits);
    const habit = (key: string) => hs.find((h) => h.yearwiseKey === key)!;
    expect(habit("h0").parent90DayGoalId).toBe(goalId("g2"));
    expect(habit("h1").parent90DayGoalId).toBe(goalId("g1"));
    expect(habit("h2").parent90DayGoalId).toBeNull();

    const rows = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseSessionId, sessionId));
    const row = (key: string) => rows.find((r) => r.yearwiseKey === key)!;
    expect(row("w1.plan.0")).toMatchObject({ ninetyDayGoalId: goalId("g0"), parent90DayGoal: "Gain regular interesting work" });
    expect(row("w1.plan.1")).toMatchObject({ ninetyDayGoalId: goalId("g1"), priority: 2 });
    expect(row("w1.plan.2").ninetyDayGoalId).toBeNull();
    expect(row("w2.plan.0")).toMatchObject({ weekStartDate: "2026-10-05", ninetyDayGoalId: goalId("g0"), track: "CUSP" });
    expect(row("w1.habit.0")).toMatchObject({ source: "habit", habitId: habit("h0").id, ninetyDayGoalId: goalId("g2"), goalTitle: "Habit: Gym and touch rugby" });
    expect(row("w2.habit.1")).toMatchObject({ habitId: habit("h1").id, ninetyDayGoalId: goalId("g1") });
  });

  it("writes habit time as minutes × frequency per week (null for untimed habits)", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const rows = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.source, "habit"));
    const mins = (key: string) => rows.find((r) => r.yearwiseKey === key)!.timeEstimateMins;
    expect(mins("w1.habit.0")).toBe(180); // 4pw × 45
    expect(mins("w1.habit.1")).toBe(90); // 2pm × 180
    expect(mins("w1.habit.2")).toBeNull(); // asneeded
    expect(mins("w1.habit.3")).toBeNull(); // rule
    expect(mins("w1.habit.4")).toBe(60); // weekly × 60
  });

  it("writes every weekly row into weekly_goals, linked to its template, alongside manual goals", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const templates = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseSessionId, sessionId));
    const goals = await db.select().from(weeklyGoals);
    const linked = goals.filter((g) => g.weeklyGoalTemplateId != null);
    expect(linked.length).toBe(EXPECTED_WEEKLY);
    expect(new Set(linked.map((g) => g.weeklyGoalTemplateId)).size).toBe(EXPECTED_WEEKLY);

    for (const t of templates) {
      const g = linked.find((x) => x.weeklyGoalTemplateId === t.id)!;
      expect(g).toMatchObject({
        weekStartDate: t.weekStartDate, category: t.pillar, goalText: t.goalTitle, source: t.source,
        habitId: t.habitId, ninetyDayGoalId: t.ninetyDayGoalId, completed: false, isTopFocus: false,
      });
    }
    const bySource = (src: string) => linked.filter((g) => g.source === src).length;
    expect([bySource("yearwise"), bySource("habit"), bySource("review")]).toEqual([4, 10, 2]);

    // Appended after the manual People goal in week 1, not on top of it.
    const people = goals.filter((g) => g.weekStartDate === "2026-09-28" && g.category === "People").sort((x, y) => x.sortOrder - y.sortOrder);
    expect(people[0].id).toBe(manualGoalId);
    expect(people.slice(1).every((g) => g.sortOrder >= 1)).toBe(true);
    expect(new Set(people.map((g) => g.sortOrder)).size).toBe(people.length);
  });

  it("leaves the user's manual weekly goals exactly as they were", async () => {
    const [before] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.id, manualGoalId));
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const trimmed = structuredClone(answers);
    (trimmed.habits as any).n = 4;
    await commitYearwiseSession(db, sessionId, trimmed, TODAY);
    const [after] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.id, manualGoalId));
    expect(after).toEqual(before);
  });

  it("re-committing doesn't duplicate weekly goals and keeps completed and top-focus flags", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const ids = async () => (await db.select({ id: weeklyGoals.id }).from(weeklyGoals)).map((r) => r.id).sort();
    const first = await ids();

    const [tpl] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseKey, "w1.plan.0"));
    await db.update(weeklyGoals).set({ completed: true, isTopFocus: true, sortOrder: 7 }).where(eq(weeklyGoals.weeklyGoalTemplateId, tpl.id));

    await commitYearwiseSession(db, sessionId, answers, TODAY);
    expect(await ids()).toEqual(first);
    const [g] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.weeklyGoalTemplateId, tpl.id));
    expect(g).toMatchObject({ completed: true, isTopFocus: true, sortOrder: 7 });

    // An edited title updates the same row.
    const edited = structuredClone(answers);
    (edited.weeks as any).w1[0].title = "Two AI coaching sessions";
    await commitYearwiseSession(db, sessionId, edited, TODAY);
    expect(await ids()).toEqual(first);
    const [renamed] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.id, g.id));
    expect(renamed).toMatchObject({ goalText: "Two AI coaching sessions", completed: true });
  });

  it("links a goal the user already accepted from the template instead of adding a second one", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const [tpl] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseKey, "w1.plan.1"));
    // The weekly-goals step deletes and re-saves the week, giving the row a new id.
    await db.delete(weeklyGoals).where(eq(weeklyGoals.weeklyGoalTemplateId, tpl.id));
    await db.insert(weeklyGoals).values({ weekStartDate: "2026-09-28", category: "People", goalText: tpl.goalTitle, weeklyGoalTemplateId: tpl.id, source: "yearwise", completed: true });
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const rows = await db.select().from(weeklyGoals).where(eq(weeklyGoals.weeklyGoalTemplateId, tpl.id));
    expect(rows.length).toBe(1);
    expect(rows[0].completed).toBe(true);
  });

  it("drops open weekly goals for removed rows but keeps completed ones", async () => {
    await commitYearwiseSession(db, sessionId, answers, TODAY);
    const [w1] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseKey, "w1.habit.4"));
    const [w2] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.yearwiseKey, "w2.habit.4"));
    await db.update(weeklyGoals).set({ completed: true }).where(eq(weeklyGoals.weeklyGoalTemplateId, w1.id));
    const [doneGoal] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.weeklyGoalTemplateId, w1.id));

    const trimmed = structuredClone(answers);
    (trimmed.habits as any).n = 4;
    await commitYearwiseSession(db, sessionId, trimmed, TODAY);

    expect(await db.select().from(weeklyGoals).where(eq(weeklyGoals.weeklyGoalTemplateId, w2.id))).toEqual([]);
    const [kept] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.id, doneGoal.id));
    expect(kept).toMatchObject({ completed: true, weeklyGoalTemplateId: null, goalText: doneGoal.goalText });
    expect((await db.select().from(weeklyGoals)).length).toBe(1 + EXPECTED_WEEKLY - 1);
  });

  it("returns undefined and writes nothing for a missing session", async () => {
    const before = await counts();
    expect(await commitYearwiseSession(db, 9999, answers, TODAY)).toBeUndefined();
    expect(await counts()).toEqual(before);
  });

  it("rolls everything back when a write fails part-way", async () => {
    // Review rows are written after the target, goals, plans and habits, so this
    // makes the transaction fail late.
    await db.execute(sql.raw("alter table weekly_goal_templates add constraint no_review check (source <> 'review')"));
    const before = await counts();
    await expect(commitYearwiseSession(db, sessionId, answers, TODAY)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    const [s] = await db.select().from(yearwiseSessions).where(eq(yearwiseSessions.id, sessionId));
    expect(s).toMatchObject({ status: "draft", answers: {} });
  });

  it("rolls back the templates too when a weekly_goals write fails", async () => {
    await db.execute(sql.raw("alter table weekly_goals add constraint no_review_goal check (source <> 'review')"));
    const before = await counts();
    await expect(commitYearwiseSession(db, sessionId, answers, TODAY)).rejects.toThrow();
    expect(await counts()).toEqual(before);
    const [manual] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.id, manualGoalId));
    expect(manual).toMatchObject({ goalText: "Call Mum", completed: true });
  });
});
