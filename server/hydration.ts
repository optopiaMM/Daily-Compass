// Water logs and the daily target. Each function takes the db so the tests can
// run them against PGlite.
import { and, desc, eq, gte, lte } from "drizzle-orm";
import { hydrationSettings, waterLogs, type WaterLog } from "@shared/schema";
import { DAYS_IN_WEEK, hydrationDay, hydrationWeek, targetOrDefault, type HydrationDay, type HydrationWeek } from "@shared/hydration";
import { addDaysISO } from "@shared/weekly-review";
import type { Db } from "./yearwise-commit";

// The target lives in a single row with this id.
const SETTINGS_ID = 1;

export async function getWaterTarget(db: Db) {
  const [row] = await db.select().from(hydrationSettings).where(eq(hydrationSettings.id, SETTINGS_ID));
  return targetOrDefault(row);
}

export async function setWaterTarget(db: Db, targetMl: number) {
  await db.insert(hydrationSettings)
    .values({ id: SETTINGS_ID, targetMl })
    .onConflictDoUpdate({ target: hydrationSettings.id, set: { targetMl, updatedAt: new Date() } });
  return targetMl;
}

export async function getHydrationDay(db: Db, date: string): Promise<HydrationDay> {
  const logs = await db.select().from(waterLogs).where(eq(waterLogs.date, date));
  return hydrationDay(logs, date, await getWaterTarget(db));
}

// Read-only: the week's logs, summed by the same shared function the day view uses.
// Past days are judged against the current target (there's no target history).
export async function getHydrationWeek(db: Db, weekStart: string): Promise<HydrationWeek> {
  const logs = await db.select().from(waterLogs)
    .where(and(gte(waterLogs.date, weekStart), lte(waterLogs.date, addDaysISO(weekStart, DAYS_IN_WEEK - 1))));
  return hydrationWeek(logs, weekStart, await getWaterTarget(db));
}

export async function logWater(db: Db, date: string, amountMl: number) {
  await db.insert(waterLogs).values({ date, amountMl });
  return getHydrationDay(db, date);
}

// Removes the day's most recent log, if there is one.
export async function undoLastWaterLog(db: Db, date: string): Promise<HydrationDay & { undone: WaterLog | null }> {
  const [last] = await db.select().from(waterLogs)
    .where(eq(waterLogs.date, date))
    .orderBy(desc(waterLogs.createdAt), desc(waterLogs.id))
    .limit(1);
  if (last) await db.delete(waterLogs).where(eq(waterLogs.id, last.id));
  return { ...(await getHydrationDay(db, date)), undone: last ?? null };
}
