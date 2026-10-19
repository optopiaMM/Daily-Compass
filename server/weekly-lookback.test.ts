import { describe, it, expect, beforeEach } from "vitest";
import { dailyItems, ninetyDayGoals, weeklyGoals } from "@shared/schema";
import type { Db } from "./yearwise-commit";
import { getHydrationWeek, logWater, setWaterTarget } from "./hydration";
import { getWeeklyLookback } from "./weekly-lookback";
import { freshDb } from "./test-db";

const WEEK = "2026-10-12"; // Mon–Sun 12–18 Oct
let db: Db;

beforeEach(async () => { db = await freshDb(); });

describe("getWeeklyLookback", () => {
  it("returns the week's hydration exactly as the weekly hydration summary does", async () => {
    await setWaterTarget(db, 2000);
    await logWater(db, "2026-10-11", 3000); // the Sunday before
    await logWater(db, "2026-10-12", 2000);
    await logWater(db, "2026-10-15", 1000);
    await logWater(db, "2026-10-19", 2500); // the Monday after
    const r = await getWeeklyLookback(db, WEEK);
    expect(r.weekStart).toBe(WEEK);
    expect(r.hydration).toEqual(await getHydrationWeek(db, WEEK));
    expect(r.hydration).toMatchObject({ daysHit: 1, averageMl: 429 });
  });

  it("counts by pillar and by active goal, sending the old placeholder goal to unassigned", async () => {
    const [placeholder] = await db.insert(ninetyDayGoals).values(
      { annualTargetId: 1, periodLabel: "Q3", startDate: "2026-06-01", endDate: "2026-08-31", goalText: "[TBC]" },
    ).returning();
    const [work, friends] = await db.insert(ninetyDayGoals).values([
      { annualTargetId: 1, periodLabel: "Q4", startDate: "2026-09-28", endDate: "2026-12-27", goalText: "Work", yearwiseKey: "g0" },
      { annualTargetId: 1, periodLabel: "Q4", startDate: "2026-09-28", endDate: "2026-12-27", goalText: "Friends", yearwiseKey: "g1" },
    ]).returning();

    const [earlier] = await db.insert(weeklyGoals).values(
      { weekStartDate: "2026-10-05", category: "People", goalText: "Old goal", ninetyDayGoalId: placeholder.id },
    ).returning();
    const [pitch] = await db.insert(weeklyGoals).values([
      { weekStartDate: WEEK, category: "Profit", goalText: "Pitch", ninetyDayGoalId: work.id, completed: true },
      { weekStartDate: WEEK, category: "People", goalText: "Meetup", ninetyDayGoalId: friends.id },
      { weekStartDate: WEEK, category: "People", goalText: "Auto-filled", ninetyDayGoalId: placeholder.id, completed: true },
      { weekStartDate: WEEK, category: "Personal Development & Learning", goalText: "Weekly review", source: "review", completed: true },
      { weekStartDate: "2026-10-19", category: "Profit", goalText: "Next week", ninetyDayGoalId: work.id },
    ]).returning();

    const row = { type: "todo", completed: false, linkedWeeklyGoalId: null as number | null };
    await db.insert(dailyItems).values([
      { ...row, date: "2026-10-12", text: "Pitch deck", linkedWeeklyGoalId: pitch.id, pillar: "Profit", ninetyDayGoalId: work.id, completed: true },
      { ...row, date: "2026-10-13", text: "Errand" },
      { ...row, date: "2026-10-14", text: "Errand", completed: true }, // carried from Tuesday
      { ...row, date: "2026-10-14", text: "Old thing", linkedWeeklyGoalId: earlier.id }, // carried in, untagged
      { ...row, date: "2026-10-11", text: "Last week", pillar: "Profit", completed: true }, // outside the week
    ]);

    const r = await getWeeklyLookback(db, WEEK);
    const p = (name: string) => r.pillars.find((x) => x.pillar === name);
    // Pillars: this week's weekly goals only (not the review row, not next week's).
    expect(p("Profit")).toMatchObject({ done: 1, total: 1, pct: 100 });
    expect(p("People")).toMatchObject({ done: 1, total: 2, pct: 50 });
    expect(p("Personal Development & Learning")).toMatchObject({ done: 0, total: 0, pct: 0 });
    // "Pitch deck" was pulled from Pitch, so Work has one unit, not two.
    expect(r.goals.map((g) => [g.goalText, g.done, g.total, g.pct])).toEqual([
      ["Work", 1, 1, 100],
      ["Friends", 0, 1, 0],
    ]);
    // Auto-filled (placeholder), Errand, and Old thing (linked to last week's goal).
    expect(r.unassignedGoal).toEqual({ done: 2, total: 3 });
  });
});
