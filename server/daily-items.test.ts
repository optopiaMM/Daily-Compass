import { describe, it, expect, beforeEach } from "vitest";
import { eq } from "drizzle-orm";
import { dailyItems, ninetyDayGoals, weeklyGoals } from "@shared/schema";
import type { Db } from "./yearwise-commit";
import { addDailyItem, saveDailyPlan, setDailyItemTags } from "./daily-items";
import { freshDb } from "./test-db";

const DAY = "2026-10-13";
let db: Db;
let goalId: number;
let otherGoalId: number;
let weeklyGoalId: number;

beforeEach(async () => {
  db = await freshDb();
  const goals = await db.insert(ninetyDayGoals).values([
    { annualTargetId: 1, periodLabel: "Q4", startDate: "2026-09-28", endDate: "2026-12-27", goalText: "Interesting work" },
    { annualTargetId: 1, periodLabel: "Q4", startDate: "2026-09-28", endDate: "2026-12-27", goalText: "Friends" },
  ]).returning();
  [goalId, otherGoalId] = goals.map((g) => g.id);
  const [wg] = await db.insert(weeklyGoals).values({ weekStartDate: "2026-10-12", category: "Profit", goalText: "Send proposal", ninetyDayGoalId: goalId }).returning();
  weeklyGoalId = wg.id;
});

const base = { date: DAY, type: "todo", rank: null, completed: false, scheduledReviewDate: null };
const day = () => db.select().from(dailyItems).where(eq(dailyItems.date, DAY)).orderBy(dailyItems.id);

describe("daily item tags", () => {
  it("a task pulled from a weekly goal takes that goal's pillar and 90-day goal", async () => {
    const row = await addDailyItem(db, { ...base, text: "Send proposal", linkedWeeklyGoalId: weeklyGoalId });
    expect(row).toMatchObject({ pillar: "Profit", ninetyDayGoalId: goalId });
  });

  it("the morning plan tags linked tasks and leaves fresh ones untagged unless picked", async () => {
    await saveDailyPlan(db, DAY, [
      { ...base, text: "Send proposal", linkedWeeklyGoalId: weeklyGoalId },
      { ...base, text: "Buy milk", linkedWeeklyGoalId: null },
      { ...base, text: "Text Matt", linkedWeeklyGoalId: null, pillar: "People", ninetyDayGoalId: otherGoalId },
    ]);
    expect((await day()).map((r) => [r.text, r.pillar, r.ninetyDayGoalId])).toEqual([
      ["Send proposal", "Profit", goalId],
      ["Buy milk", null, null],
      ["Text Matt", "People", otherGoalId],
    ]);
  });

  it("an explicit tag wins over the linked goal's", async () => {
    const row = await addDailyItem(db, { ...base, text: "Send proposal", linkedWeeklyGoalId: weeklyGoalId, pillar: "Promise", ninetyDayGoalId: otherGoalId });
    expect(row).toMatchObject({ pillar: "Promise", ninetyDayGoalId: otherGoalId });
  });

  it("tags can be set, changed and cleared after the task is created", async () => {
    const row = await addDailyItem(db, { ...base, text: "Buy milk", linkedWeeklyGoalId: null });
    expect(await setDailyItemTags(db, row.id, { pillar: "Personal", ninetyDayGoalId: goalId })).toMatchObject({ pillar: "Personal", ninetyDayGoalId: goalId });
    expect(await setDailyItemTags(db, row.id, { pillar: null, ninetyDayGoalId: null })).toMatchObject({ pillar: null, ninetyDayGoalId: null });
    expect(await setDailyItemTags(db, 9999, { pillar: null, ninetyDayGoalId: null })).toBeUndefined();
  });
});
