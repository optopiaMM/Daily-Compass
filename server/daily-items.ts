// Daily tasks and their look-back tags (pillar, 90-day goal). A task created from
// a weekly goal takes its tags from that goal, so pulled tasks are attributed
// without any picking; a tag given explicitly wins. Each function takes the db so
// the tests can run them against PGlite.
import { eq, inArray } from "drizzle-orm";
import { dailyItems, weeklyGoals, type DailyItem, type DailyItemTags, type InsertDailyItem } from "@shared/schema";
import type { Db } from "./yearwise-commit";

type NewDailyItem = Omit<InsertDailyItem, "date"> & { date?: string };

// Fills in pillar and ninety_day_goal_id from each item's linked weekly goal,
// where the item doesn't already have them.
export async function withGoalTags<T extends NewDailyItem>(db: Db, items: T[]): Promise<T[]> {
  const ids = Array.from(new Set(items.map((it) => it.linkedWeeklyGoalId).filter((x): x is number => x != null)));
  if (!ids.length) return items;
  const linked = new Map((await db.select({ id: weeklyGoals.id, category: weeklyGoals.category, ninetyDayGoalId: weeklyGoals.ninetyDayGoalId })
    .from(weeklyGoals).where(inArray(weeklyGoals.id, ids))).map((g) => [g.id, g]));
  return items.map((it) => {
    const g = it.linkedWeeklyGoalId != null ? linked.get(it.linkedWeeklyGoalId) : undefined;
    if (!g) return it;
    return { ...it, pillar: it.pillar ?? g.category, ninetyDayGoalId: it.ninetyDayGoalId ?? g.ninetyDayGoalId };
  });
}

// The morning plan replaces the day's items.
export async function saveDailyPlan(db: Db, date: string, items: NewDailyItem[]) {
  const tagged = await withGoalTags(db, items);
  await db.transaction(async (tx) => {
    await tx.delete(dailyItems).where(eq(dailyItems.date, date));
    if (tagged.length) await tx.insert(dailyItems).values(tagged.map((it) => ({ ...it, date })));
  });
}

export async function addDailyItem(db: Db, item: InsertDailyItem): Promise<DailyItem> {
  const [tagged] = await withGoalTags(db, [item]);
  const [row] = await db.insert(dailyItems).values(tagged).returning();
  return row;
}

// Sets both tags at once (null clears one). Undefined if there's no such item.
export async function setDailyItemTags(db: Db, itemId: number, tags: DailyItemTags): Promise<DailyItem | undefined> {
  const [row] = await db.update(dailyItems)
    .set({ pillar: tags.pillar, ninetyDayGoalId: tags.ninetyDayGoalId })
    .where(eq(dailyItems.id, itemId))
    .returning();
  return row;
}
