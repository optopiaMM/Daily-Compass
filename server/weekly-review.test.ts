import { describe, it, expect, beforeEach } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  yearwiseSessions, ninetyDayGoals, habits, weeklyGoalTemplates, weeklyGoals, weeklyReviews, weeklyReviewScores,
} from "@shared/schema";
import { scoreTrend } from "@shared/weekly-review";
import { commitYearwiseSession, type Db } from "./yearwise-commit";
import { ensureRecurringRows, freshStartFor, getReviewContext, goalsWithTrends, saveWeeklyReview, type WeeklyReviewInput } from "./weekly-review";
import { freshDb } from "./test-db";
import { answers } from "./test-fixtures";

const TODAY = new Date(2026, 8, 30); // Wed 30 Sep 2026: week 1 is w/c 28 Sep, week 2 w/c 5 Oct
const W1 = "2026-09-28", W2 = "2026-10-05", W3 = "2026-10-12", W4 = "2026-10-19";
const HABITS = 5;

let db: Db;
let goal: Record<string, number>; // "g0" → id

beforeEach(async () => {
  db = await freshDb();
  const [{ id }] = await db.insert(yearwiseSessions).values({ planStart: W1, answers: {} }).returning();
  await commitYearwiseSession(db, id, answers, TODAY);
  goal = Object.fromEntries((await db.select().from(ninetyDayGoals)).map((g) => [g.yearwiseKey!, g.id]));
});

const review = (over: Partial<WeeklyReviewInput> = {}): WeeklyReviewInput => ({
  weekStartDate: W1, goals: [],
  scores: [{ ninetyDayGoalId: goal.g0, score: 4 }, { ninetyDayGoalId: goal.g1, score: 6 }, { ninetyDayGoalId: goal.g2, score: 3 }],
  nextGoals: [], ...over,
});
const weekGoals = (week: string) => db.select().from(weeklyGoals).where(eq(weeklyGoals.weekStartDate, week));
const reviewGoal = async (week: string) => (await weekGoals(week)).find((g) => g.source === "review")!;

describe("saveWeeklyReview", () => {
  it("stores the review and its scores and marks that week's review goal done", async () => {
    expect((await reviewGoal(W1)).completed).toBe(false);
    await saveWeeklyReview(db, review());

    const [r] = await db.select().from(weeklyReviews);
    expect(r).toMatchObject({ weekStartDate: W1, goalNotes: {} });
    const scores = await db.select().from(weeklyReviewScores);
    expect(scores.map((s) => [s.ninetyDayGoalId, s.score]).sort()).toEqual([[goal.g0, 4], [goal.g1, 6], [goal.g2, 3]].sort());

    expect((await reviewGoal(W1)).completed).toBe(true);
    expect((await reviewGoal(W2)).completed).toBe(false); // only the reviewed week
    const [tpl] = await db.select().from(weeklyGoalTemplates).where(and(eq(weeklyGoalTemplates.weekStartDate, W1), eq(weeklyGoalTemplates.source, "review")));
    expect(tpl.status).toBe("done");
    // Nothing else in the week was ticked.
    expect((await weekGoals(W1)).filter((g) => g.completed).length).toBe(1);
  });

  it("adds next week's goals as plan rows plus linked weekly goals, after what's there", async () => {
    const before = (await weekGoals(W2)).filter((g) => g.category === "Profit");
    await saveWeeklyReview(db, review({
      nextGoals: [
        { pillar: "Profit", goalTitle: "Send CUSP proposal", priority: 1, timeEstimateMins: 90, ninetyDayGoalId: goal.g0 },
        { pillar: "Physical Environment", goalTitle: "Fix stair lights", priority: 3, timeEstimateMins: null, ninetyDayGoalId: null },
      ],
    }));
    const proposal = (await weekGoals(W2)).find((g) => g.goalText === "Send CUSP proposal")!;
    expect(proposal).toMatchObject({ category: "Profit", source: "manual", ninetyDayGoalId: goal.g0, completed: false });
    expect(proposal.sortOrder).toBeGreaterThan(Math.max(...before.map((g) => g.sortOrder)));
    const [tpl] = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.id, proposal.weeklyGoalTemplateId!));
    expect(tpl).toMatchObject({
      weekStartDate: W2, pillar: "Profit", priority: 1, timeEstimateMins: 90, source: "manual",
      ninetyDayGoalId: goal.g0, parent90DayGoal: "Gain regular interesting work", yearwiseSessionId: null,
    });
    expect((await weekGoals(W2)).find((g) => g.goalText === "Fix stair lights")).toMatchObject({ category: "Physical Environment", sortOrder: 0 });
  });

  it("re-saving the same week updates the review and its scores in place", async () => {
    await saveWeeklyReview(db, review());
    const [first] = await db.select().from(weeklyReviews);
    const [aGoal] = (await weekGoals(W1)).filter((g) => g.source !== "review");
    await saveWeeklyReview(db, review({ goals: [{ id: aGoal.id, completed: false, note: "Edited" }], scores: [{ ninetyDayGoalId: goal.g0, score: 7 }] }));
    const reviews = await db.select().from(weeklyReviews);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ id: first.id, goalNotes: { [aGoal.id]: "Edited" } });
    expect((await db.select().from(weeklyReviewScores)).map((s) => [s.ninetyDayGoalId, s.score])).toEqual([[goal.g0, 7]]);
  });

  it("rejects the whole save if a score points at a goal that doesn't exist", async () => {
    const ids = (await weekGoals(W1)).filter((g) => g.source !== "review").map((g) => g.id);
    await expect(saveWeeklyReview(db, review({
      goals: ids.map((id) => ({ id, completed: true, note: "x" })),
      scores: [{ ninetyDayGoalId: goal.g0, score: 5 }, { ninetyDayGoalId: 9999, score: 5 }],
    }))).rejects.toThrow();
    expect(await db.select().from(weeklyReviews)).toEqual([]);
    expect((await weekGoals(W1)).every((g) => !g.completed)).toBe(true); // ticks rolled back too
  });
});

describe("the review's goal checklist", () => {
  // Week 1's goals other than the review goal: 3 planned + 5 habits.
  const checklist = async () => (await weekGoals(W1)).filter((g) => g.source !== "review").sort((x, y) => x.id - y.id);
  const strip = (rows: Awaited<ReturnType<typeof weekGoals>>) => rows.map(({ completed, ...rest }) => rest).sort((x, y) => x.id - y.id);

  it("writes the ticks back to the weekly goals, unticking as well as ticking, and changes nothing else", async () => {
    const [a, b, c] = await checklist();
    await db.update(weeklyGoals).set({ completed: true }).where(eq(weeklyGoals.id, a.id)); // done during the week
    const before = await weekGoals(W1);

    await saveWeeklyReview(db, review({ goals: [
      { id: a.id, completed: false }, // unticked in the review
      { id: b.id, completed: true }, // ticked in the review
      { id: c.id, completed: false }, // left unticked
    ] }));

    const after = await weekGoals(W1);
    const done = (id: number) => after.find((g) => g.id === id)!.completed;
    expect([done(a.id), done(b.id), done(c.id)]).toEqual([false, true, false]);
    expect(strip(after)).toEqual(strip(before)); // same rows, same ids, only completed changed
  });

  it("leaves goals it wasn't sent alone, and ignores other weeks' goals and the review goal", async () => {
    const [a, , , d] = await checklist();
    await db.update(weeklyGoals).set({ completed: true }).where(eq(weeklyGoals.id, d.id));
    const w2Goal = (await weekGoals(W2))[0];
    const own = await reviewGoal(W1);

    await saveWeeklyReview(db, review({ goals: [
      { id: a.id, completed: true },
      { id: w2Goal.id, completed: true, note: "wrong week" },
      { id: own.id, completed: false, note: "the review itself" },
    ] }));

    expect((await weekGoals(W1)).find((g) => g.id === d.id)!.completed).toBe(true);
    expect((await weekGoals(W2)).find((g) => g.id === w2Goal.id)!.completed).toBe(false);
    expect((await reviewGoal(W1)).completed).toBe(true);
    const [r] = await db.select().from(weeklyReviews);
    expect(r.goalNotes).toEqual({});
  });

  it("stores per-goal notes, dropping blank ones, and reads them back", async () => {
    const [a, b, c] = await checklist();
    await saveWeeklyReview(db, review({ goals: [
      { id: a.id, completed: true, note: "  Booked for Thursday  " },
      { id: b.id, completed: false, note: "   " },
      { id: c.id, completed: false, note: "Ran out of evenings" },
    ] }));
    const ctx = await getReviewContext(db, W1);
    expect(ctx.review?.goalNotes).toEqual({ [a.id]: "Booked for Thursday", [c.id]: "Ran out of evenings" });

    // Re-saving with different notes replaces them.
    await saveWeeklyReview(db, review({ goals: [{ id: a.id, completed: true, note: null }, { id: b.id, completed: false, note: "Next week" }] }));
    expect((await getReviewContext(db, W1)).review?.goalNotes).toEqual({ [b.id]: "Next week" });
  });

  it("re-saving the same review is idempotent and never deletes or re-creates goals", async () => {
    const goals = await checklist();
    const input = review({ goals: goals.map((g, i) => ({ id: g.id, completed: i % 2 === 0, note: i === 0 ? "first" : null })) });
    await saveWeeklyReview(db, input);
    const sortById = <T extends { id: number }>(rows: T[]) => [...rows].sort((x, y) => x.id - y.id);
    const snapshot = async () => ({
      w1: sortById(await weekGoals(W1)),
      w2: sortById(await weekGoals(W2)),
      reviews: await db.select().from(weeklyReviews),
      scores: sortById(await db.select().from(weeklyReviewScores)),
    });
    const once = await snapshot();
    await saveWeeklyReview(db, input);
    await saveWeeklyReview(db, input);
    expect(await snapshot()).toEqual(once);
    expect(once.w1).toHaveLength(HABITS + 3 + 1);
  });

  it("no longer writes done / slipped / why notes", async () => {
    await saveWeeklyReview(db, { ...review(), doneNotes: "x", slippedNotes: "y", whyNotes: "z" } as WeeklyReviewInput);
    const [r] = await db.select().from(weeklyReviews);
    expect(r).toMatchObject({ doneNotes: null, slippedNotes: null, whyNotes: null });
  });

  it("keeps an older review's text when it's saved again", async () => {
    await db.insert(weeklyReviews).values({ weekStartDate: W1, doneNotes: "Old done", slippedNotes: "Old slipped", whyNotes: "Old why" });
    await saveWeeklyReview(db, review());
    const [r] = await db.select().from(weeklyReviews);
    expect(r).toMatchObject({ doneNotes: "Old done", slippedNotes: "Old slipped", whyNotes: "Old why", goalNotes: {} });
  });
});

describe("score trends", () => {
  it("reads every week's score back per goal, oldest first, with the latest", async () => {
    await saveWeeklyReview(db, review({ weekStartDate: W2, scores: [{ ninetyDayGoalId: goal.g0, score: 6 }] }));
    await saveWeeklyReview(db, review());
    const goals = await goalsWithTrends(db, W2);
    expect(goals.map((g) => g.yearwiseKey)).toEqual(["g0", "g1", "g2"]);
    const g0 = goals.find((g) => g.id === goal.g0)!;
    expect(g0.history).toEqual([{ weekStartDate: W1, score: 4 }, { weekStartDate: W2, score: 6 }]);
    expect(scoreTrend(g0.history).latest).toBe(6);
    expect(goals.find((g) => g.id === goal.g1)!.history).toEqual([{ weekStartDate: W1, score: 6 }]);
    expect(g0.plans.map((p) => p.ifText)).toEqual(["I catch myself drifting", "a call ends"]);
  });

  it("gives the review screen this week's saved scores and leaves out goals outside their window", async () => {
    await db.insert(ninetyDayGoals).values({ annualTargetId: 1, periodLabel: "Old", startDate: "2026-06-01", endDate: "2026-08-31", goalText: "Last quarter" });
    await saveWeeklyReview(db, review());
    const ctx = await getReviewContext(db, W1);
    expect(ctx.review?.weekStartDate).toBe(W1);
    expect(ctx.scores).toEqual({ [goal.g0]: 4, [goal.g1]: 6, [goal.g2]: 3 });
    expect(ctx.goals.map((g) => g.goalText)).not.toContain("Last quarter");
    expect((await getReviewContext(db, W2)).review).toBeNull();
  });
});

describe("ensureRecurringRows", () => {
  const rowsIn = async (week: string) => ({
    templates: await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.weekStartDate, week)),
    goals: await weekGoals(week),
  });

  it("creates the habit rows and review row for a later week, in both tables", async () => {
    expect(await ensureRecurringRows(db, W3)).toEqual({ created: HABITS + 1 });
    const { templates, goals } = await rowsIn(W3);
    expect(templates.filter((t) => t.source === "habit")).toHaveLength(HABITS);
    expect(templates.filter((t) => t.source === "review")).toHaveLength(1);
    expect(goals).toHaveLength(HABITS + 1);
    for (const g of goals) {
      const t = templates.find((x) => x.id === g.weeklyGoalTemplateId)!;
      expect(g).toMatchObject({ category: t.pillar, goalText: t.goalTitle, source: t.source, habitId: t.habitId, completed: false });
      expect(t.yearwiseSessionId).toBeNull();
    }
    // Worded exactly like the commit's week-1 rows.
    const w1 = await db.select().from(weeklyGoalTemplates).where(eq(weeklyGoalTemplates.weekStartDate, W1));
    const pick = (rows: typeof w1) => rows.filter((r) => r.source !== "yearwise")
      .map((r) => [r.source, r.habitId, r.pillar, r.goalTitle, r.goalDescription, r.priority, r.timeEstimateMins, r.ninetyDayGoalId, r.parent90DayGoal, r.notes])
      .sort((x, y) => String(x[3]).localeCompare(String(y[3])));
    expect(pick(templates)).toEqual(pick(w1));
  });

  it("is idempotent, and does nothing for weeks the commit already filled", async () => {
    await ensureRecurringRows(db, W3);
    const first = await rowsIn(W3);
    expect(await ensureRecurringRows(db, W3)).toEqual({ created: 0 });
    expect(await ensureRecurringRows(db, "2026-10-14")).toEqual({ created: 0 }); // any day of that week
    const second = await rowsIn(W3);
    expect(second.templates.map((t) => t.id).sort()).toEqual(first.templates.map((t) => t.id).sort());
    expect(second.goals.map((g) => g.id).sort()).toEqual(first.goals.map((g) => g.id).sort());

    const w2Before = await rowsIn(W2);
    expect(await ensureRecurringRows(db, W2)).toEqual({ created: 0 });
    expect((await rowsIn(W2)).goals).toHaveLength(w2Before.goals.length);
  });

  it("doesn't put back a habit goal the user removed from the week", async () => {
    await ensureRecurringRows(db, W3);
    const habitGoal = (await weekGoals(W3)).find((g) => g.source === "habit")!;
    await db.delete(weeklyGoals).where(eq(weeklyGoals.id, habitGoal.id));
    await ensureRecurringRows(db, W3);
    expect((await weekGoals(W3)).some((g) => g.habitId === habitGoal.habitId)).toBe(false);
  });

  it("skips inactive habits and weeks before the plan, and its rows survive a re-commit", async () => {
    const [h] = await db.select().from(habits).where(eq(habits.yearwiseKey, "h0"));
    await db.update(habits).set({ active: false }).where(eq(habits.id, h.id));
    expect(await ensureRecurringRows(db, W4)).toEqual({ created: HABITS });
    expect(await ensureRecurringRows(db, "2026-09-21")).toEqual({ created: 0 });

    const [s] = await db.select().from(yearwiseSessions);
    await commitYearwiseSession(db, s.id, answers, TODAY);
    expect((await rowsIn(W4)).templates).toHaveLength(HABITS); // the commit didn't touch week 4…
    expect(await ensureRecurringRows(db, W4)).toEqual({ created: 1 }); // …and h0, active again, is added now
  });

  it("does nothing without a committed session", async () => {
    await db.update(yearwiseSessions).set({ status: "draft" });
    expect(await ensureRecurringRows(db, W3)).toEqual({ created: 0 });
  });
});

describe("freshStartFor", () => {
  it("counts from the first review row when there's never been a review, then from the last review", async () => {
    // Review rows start w/c 28 Sep. Mon 5 Oct: only that one week has gone by.
    expect(await freshStartFor(db, W2)).toBe(false);
    expect(await freshStartFor(db, W3)).toBe(true);
    await saveWeeklyReview(db, review({ weekStartDate: W2 }));
    expect(await freshStartFor(db, W3)).toBe(false);
    expect(await freshStartFor(db, W4)).toBe(false);
    expect(await freshStartFor(db, "2026-10-26")).toBe(true);
  });
});
