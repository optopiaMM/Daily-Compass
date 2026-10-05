import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { weeklyGoals, weeklyGoalTemplates } from "@shared/schema";
import type { Db } from "./yearwise-commit";
import { saveWeeklyGoals } from "./weekly-goals";
import { freshDb } from "./test-db";

const WEEK = "2026-10-05";
let db: Db;

beforeEach(async () => { db = await freshDb(); });

const week = () => db.select().from(weeklyGoals).where(eq(weeklyGoals.weekStartDate, WEEK)).orderBy(weeklyGoals.id);

describe("saveWeeklyGoals", () => {
  it("re-saving a week keeps completed goals completed, matched by id, template link or text", async () => {
    const [tpl] = await db.insert(weeklyGoalTemplates).values({ weekStartDate: WEEK, pillar: "Profit", goalTitle: "From plan", source: "yearwise" }).returning();
    await saveWeeklyGoals(db, WEEK, [
      { category: "People", goalText: "Call Mum", sortOrder: 0 },
      { category: "Profit", goalText: "From plan", sortOrder: 0, weeklyGoalTemplateId: tpl.id, source: "yearwise" },
      { category: "Personal", goalText: "Swim", sortOrder: 0 },
      { category: "Personal", goalText: "Bike", sortOrder: 1 },
    ], null);
    const [mum, plan, swim, bike] = await week();
    for (const g of [mum, plan, swim]) await db.update(weeklyGoals).set({ completed: true }).where(eq(weeklyGoals.id, g.id));

    // Matched by id (and renamed), by template link, and by category + text; Bike
    // removed; Gym new.
    await saveWeeklyGoals(db, WEEK, [
      { id: mum.id, category: "People", goalText: "Call Mum and Dad", sortOrder: 0, isTopFocus: true },
      { category: "Profit", goalText: "From plan", sortOrder: 0, weeklyGoalTemplateId: tpl.id, source: "yearwise" },
      { category: "Personal", goalText: "Swim", sortOrder: 0 },
      { category: "Personal", goalText: "Gym", sortOrder: 1 },
    ], null);

    const after = await week();
    expect(after.map((g) => [g.goalText, g.completed])).toEqual([
      ["Call Mum and Dad", true], ["From plan", true], ["Swim", true], ["Gym", false],
    ]);
    // Same rows, so daily items linked by id still point at them.
    expect(after.slice(0, 3).map((g) => g.id)).toEqual([mum.id, plan.id, swim.id]);
    expect(after.find((g) => g.id === bike.id)).toBeUndefined();
    expect(after[0]).toMatchObject({ isTopFocus: true, source: "manual" });
    expect(after[1]).toMatchObject({ source: "yearwise", weeklyGoalTemplateId: tpl.id });
  });

  it("keeps a row's source when the post leaves it out", async () => {
    const [habitGoal] = await db.insert(weeklyGoals).values({ weekStartDate: WEEK, category: "Personal", goalText: "Habit: Gym", source: "habit", completed: true }).returning();
    await saveWeeklyGoals(db, WEEK, [{ id: habitGoal.id, category: "Personal", goalText: "Habit: Gym", sortOrder: 0 }], 42);
    expect((await week())[0]).toMatchObject({ id: habitGoal.id, source: "habit", completed: true });
  });

  it("only touches the week being saved", async () => {
    const [other] = await db.insert(weeklyGoals).values({ weekStartDate: "2026-09-28", category: "People", goalText: "Call Mum", completed: true }).returning();
    await saveWeeklyGoals(db, WEEK, [{ id: other.id, category: "People", goalText: "Call Mum", sortOrder: 0 }], null);
    const [still] = await db.select().from(weeklyGoals).where(eq(weeklyGoals.id, other.id));
    expect(still).toMatchObject({ weekStartDate: "2026-09-28", completed: true });
    const [mine] = await week();
    expect(mine.id).not.toBe(other.id);
    expect(mine.completed).toBe(false);
  });
});
