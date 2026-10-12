import { describe, it, expect } from "vitest";
import {
  DEFAULT_WATER_TARGET_ML, hydrationDay, hydrationWeek, isReached, lastLogOf, progressPct, targetOrDefault, totalForDate,
  weekDates, weeklySummary,
} from "./hydration";

const at = (id: number, date: string, amountMl: number, createdAt = `${date}T09:00:00Z`) => ({ id, date, amountMl, createdAt });

const logs = [
  at(1, "2026-10-11", 500), // yesterday
  at(2, "2026-10-12", 250, "2026-10-12T08:00:00Z"),
  at(3, "2026-10-12", 500, "2026-10-12T12:00:00Z"),
  at(4, "2026-10-13", 750), // tomorrow
];

describe("totalForDate", () => {
  it("sums only that date's logs", () => {
    expect(totalForDate(logs, "2026-10-12")).toBe(750);
    expect(totalForDate(logs, "2026-10-11")).toBe(500);
  });
  it("is 0 for a day with no logs, so each day starts from zero", () => {
    expect(totalForDate(logs, "2026-10-14")).toBe(0);
    expect(totalForDate([], "2026-10-12")).toBe(0);
  });
});

describe("targetOrDefault", () => {
  it("defaults to 2000 ml when no target has been saved", () => {
    expect(DEFAULT_WATER_TARGET_ML).toBe(2000);
    expect(targetOrDefault(undefined)).toBe(2000);
    expect(targetOrDefault(null)).toBe(2000);
  });
  it("uses the saved target", () => {
    expect(targetOrDefault({ targetMl: 2500 })).toBe(2500);
  });
});

describe("isReached and progressPct", () => {
  it("is reached at the target and beyond, not below", () => {
    expect(isReached(1999, 2000)).toBe(false);
    expect(isReached(2000, 2000)).toBe(true);
    expect(isReached(2750, 2000)).toBe(true);
    expect(isReached(0, 0)).toBe(false);
  });
  it("fills in proportion and stays full past the target", () => {
    expect(progressPct(0, 2000)).toBe(0);
    expect(progressPct(750, 2000)).toBe(38);
    expect(progressPct(2000, 2000)).toBe(100);
    expect(progressPct(3000, 2000)).toBe(100);
  });
});

describe("lastLogOf", () => {
  it("is the day's newest log, ignoring other days", () => {
    expect(lastLogOf(logs, "2026-10-12")?.id).toBe(3);
    expect(lastLogOf(logs, "2026-10-14")).toBeUndefined();
  });
  it("breaks a created_at tie on the higher id", () => {
    const same = [at(7, "2026-10-12", 250), at(9, "2026-10-12", 500), at(8, "2026-10-12", 250)];
    expect(lastLogOf(same, "2026-10-12")?.id).toBe(9);
  });
});

describe("hydrationDay", () => {
  it("summarises one day against the target", () => {
    expect(hydrationDay(logs, "2026-10-12", 2000)).toEqual({
      date: "2026-10-12", totalMl: 750, targetMl: 2000, reached: false, logCount: 2, lastLogMl: 500,
    });
    expect(hydrationDay(logs, "2026-10-12", 750).reached).toBe(true);
    expect(hydrationDay([], "2026-10-12", 2000)).toEqual({
      date: "2026-10-12", totalMl: 0, targetMl: 2000, reached: false, logCount: 0, lastLogMl: null,
    });
  });
});

describe("weeklySummary", () => {
  it("counts days at or over target out of 7 and averages across all 7, empty days as 0", () => {
    // Mon over, Tue under, Wed exactly on, Thu no logs, Fri over, Sat under, Sun no logs.
    const totals = [2500, 1500, 2000, 0, 3000, 250, 0];
    expect(weeklySummary(totals, 2000)).toEqual({ daysHit: 3, averageMl: 1321 }); // 9250 / 7 = 1321.4
  });
  it("is 0/7 with a 0 average for a week with no logs", () => {
    expect(weeklySummary([0, 0, 0, 0, 0, 0, 0], 2000)).toEqual({ daysHit: 0, averageMl: 0 });
  });
  it("is 7/7 when every day hits", () => {
    expect(weeklySummary([2000, 2000, 2000, 2000, 2000, 2000, 2000], 2000)).toEqual({ daysHit: 7, averageMl: 2000 });
  });
  it("still divides by 7 when given fewer days", () => {
    expect(weeklySummary([2100, 2100], 2000)).toEqual({ daysHit: 2, averageMl: 600 });
  });
  it("rounds the average to the nearest ml", () => {
    expect(weeklySummary([1000, 0, 0, 0, 0, 0, 0], 2000).averageMl).toBe(143); // 142.86
  });
});

describe("hydrationWeek", () => {
  it("runs Monday to Sunday across a month end", () => {
    expect(weekDates("2026-09-28")).toEqual([
      "2026-09-28", "2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04",
    ]);
  });

  it("sums each day's logs and ignores days outside the week", () => {
    const week = [
      at(1, "2026-10-11", 5000), // the Sunday before
      at(2, "2026-10-12", 1500), at(3, "2026-10-12", 1000), // Mon: over
      at(4, "2026-10-13", 1000), // Tue: under
      at(5, "2026-10-14", 2000), // Wed: exactly on
      at(6, "2026-10-17", 250), at(7, "2026-10-17", 250), // Sat: under
      at(8, "2026-10-19", 5000), // the Monday after
    ];
    const result = hydrationWeek(week, "2026-10-12", 2000);
    expect(result.days).toEqual([
      { date: "2026-10-12", totalMl: 2500, hit: true },
      { date: "2026-10-13", totalMl: 1000, hit: false },
      { date: "2026-10-14", totalMl: 2000, hit: true },
      { date: "2026-10-15", totalMl: 0, hit: false },
      { date: "2026-10-16", totalMl: 0, hit: false },
      { date: "2026-10-17", totalMl: 500, hit: false },
      { date: "2026-10-18", totalMl: 0, hit: false },
    ]);
    expect(result).toMatchObject({ weekStart: "2026-10-12", targetMl: 2000, daysHit: 2, averageMl: 857 }); // 6000 / 7
  });
});
