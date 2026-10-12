import { describe, it, expect, beforeEach } from "vitest";
import { hydrationSettings, waterLogs } from "@shared/schema";
import type { Db } from "./yearwise-commit";
import { getHydrationDay, getHydrationWeek, getWaterTarget, logWater, setWaterTarget, undoLastWaterLog } from "./hydration";
import { freshDb } from "./test-db";

const TODAY = "2026-10-12";
let db: Db;

beforeEach(async () => { db = await freshDb(); });

describe("hydration", () => {
  it("totals only the given day's logs", async () => {
    await logWater(db, "2026-10-11", 1000);
    await logWater(db, TODAY, 250);
    const day = await logWater(db, TODAY, 500);
    expect(day).toMatchObject({ date: TODAY, totalMl: 750, logCount: 2, lastLogMl: 500 });
    expect((await getHydrationDay(db, "2026-10-13")).totalMl).toBe(0);
  });

  it("defaults the target to 2000 ml, then keeps one settings row as it changes", async () => {
    expect(await getWaterTarget(db)).toBe(2000);
    expect((await getHydrationDay(db, TODAY)).targetMl).toBe(2000);
    await setWaterTarget(db, 2500);
    await setWaterTarget(db, 3000);
    expect(await getWaterTarget(db)).toBe(3000);
    expect(await db.select().from(hydrationSettings)).toHaveLength(1);
  });

  it("marks the target reached once the total gets there", async () => {
    await setWaterTarget(db, 750);
    expect((await logWater(db, TODAY, 500)).reached).toBe(false);
    expect((await logWater(db, TODAY, 250)).reached).toBe(true);
    expect((await logWater(db, TODAY, 250)).reached).toBe(true); // past it
  });

  it("undo removes the day's last log only", async () => {
    await logWater(db, TODAY, 250);
    await logWater(db, TODAY, 500);
    await logWater(db, "2026-10-13", 1000);

    const after = await undoLastWaterLog(db, TODAY);
    expect(after.undone?.amountMl).toBe(500);
    expect(after).toMatchObject({ totalMl: 250, logCount: 1, lastLogMl: 250 });

    const again = await undoLastWaterLog(db, TODAY);
    expect(again.undone?.amountMl).toBe(250);
    expect(again).toMatchObject({ totalMl: 0, logCount: 0, lastLogMl: null });

    const none = await undoLastWaterLog(db, TODAY);
    expect(none.undone).toBeNull();
    expect((await db.select().from(waterLogs)).map((l) => l.date)).toEqual(["2026-10-13"]);
  });

  it("summarises a week from Monday to Sunday only, against the current target", async () => {
    await logWater(db, "2026-10-11", 3000); // Sunday before
    await logWater(db, "2026-10-12", 2000); // Mon: on target
    await logWater(db, "2026-10-14", 1000); // Wed: under
    await logWater(db, "2026-10-18", 1500); // Sun
    await logWater(db, "2026-10-18", 1000); // Sun: over
    await logWater(db, "2026-10-19", 3000); // Monday after

    const week = await getHydrationWeek(db, "2026-10-12");
    expect(week).toMatchObject({ weekStart: "2026-10-12", targetMl: 2000, daysHit: 2, averageMl: 786 }); // 5500 / 7
    expect(week.days.map((d) => d.totalMl)).toEqual([2000, 0, 1000, 0, 0, 0, 2500]);

    await setWaterTarget(db, 2500);
    expect((await getHydrationWeek(db, "2026-10-12")).daysHit).toBe(1);
  });
});
