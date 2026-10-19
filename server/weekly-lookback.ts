// Weekly look-back (the Monday morning step): last week's water, and tasks done
// by pillar and by 90-day goal. Read-only.
import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { dailyItems, weeklyGoals } from "@shared/schema";
import { DAYS_IN_WEEK } from "@shared/hydration";
import { addDaysISO } from "@shared/weekly-review";
import { lookbackCounts, type WeeklyLookback } from "@shared/weekly-lookback";
import { getHydrationWeek } from "./hydration";
import { goalsWithTrends } from "./weekly-review";
import type { Db } from "./yearwise-commit";

// weekStart is the week's Monday.
export async function getWeeklyLookback(db: Db, weekStart: string): Promise<WeeklyLookback> {
  const weekEnd = addDaysISO(weekStart, DAYS_IN_WEEK - 1);
  const goals = await db.select().from(weeklyGoals).where(eq(weeklyGoals.weekStartDate, weekStart));
  const items = await db.select().from(dailyItems).where(and(gte(dailyItems.date, weekStart), lte(dailyItems.date, weekEnd)));

  // A task carried into this week can link to a goal from an earlier week.
  const linkedIds = Array.from(new Set(items.map((it) => it.linkedWeeklyGoalId).filter((x): x is number => x != null)));
  const linked = linkedIds.length ? await db.select().from(weeklyGoals).where(inArray(weeklyGoals.id, linkedIds)) : [];

  // The same "active in this week" goals the weekly review scores.
  const active = await goalsWithTrends(db, weekStart);

  return {
    weekStart,
    hydration: await getHydrationWeek(db, weekStart),
    ...lookbackCounts(goals, items, linked, active),
  };
}
