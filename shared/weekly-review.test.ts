import { describe, it, expect } from "vitest";
import { addDaysISO, isFreshStart, mondayOf, recurringRows, reviewBody, scoreTrend } from "./weekly-review";

describe("dates", () => {
  it("finds the Monday of any day and adds days across month ends", () => {
    expect(mondayOf("2026-10-05")).toBe("2026-10-05");
    expect(mondayOf("2026-10-04")).toBe("2026-09-28"); // Sunday
    expect(mondayOf("2026-10-07")).toBe("2026-10-05");
    expect(addDaysISO("2026-09-28", 7)).toBe("2026-10-05");
    expect(addDaysISO("2026-12-28", 7)).toBe("2027-01-04");
  });
});

describe("isFreshStart", () => {
  const reviewed = ["2026-09-28"];
  it("needs two whole weeks with no review", () => {
    expect(isFreshStart("2026-10-12", reviewed, "2026-09-28")).toBe(false); // missed w/c 5 Oct only
    expect(isFreshStart("2026-10-19", reviewed, "2026-09-28")).toBe(true); // missed 5 and 12 Oct
  });
  it("only shows on a Monday or the 1st of the month", () => {
    expect(isFreshStart("2026-10-20", reviewed, "2026-09-28")).toBe(false); // Tuesday
    expect(isFreshStart("2026-12-01", reviewed, "2026-09-28")).toBe(true); // Tuesday the 1st
  });
  it("ignores reviews this week or later, and counts from the first review week when there are none", () => {
    expect(isFreshStart("2026-10-19", ["2026-10-19"], "2026-09-28")).toBe(true);
    expect(isFreshStart("2026-10-19", [], null)).toBe(false);
    expect(isFreshStart("2026-10-12", [], "2026-09-28")).toBe(true); // 28 Sep and 5 Oct never reviewed
    expect(isFreshStart("2026-10-05", [], "2026-09-28")).toBe(false);
  });
});

describe("recurringRows", () => {
  const habit = { id: 7, title: "Gym", cue: "Mon/Wed", freqKey: "4pw", minsEach: 45, pillar: "Personal", parent90DayGoalId: 3 };
  it("builds habit and review rows as the commit does", () => {
    const rows = recurringRows([habit], { review: { day: "Monday", time: "09:00", mins: "30" } }, { 3: "Get fit" });
    expect(rows).toEqual([
      {
        source: "habit", habitId: 7, pillar: "Personal", goalTitle: "Habit: Gym", goalDescription: "Mon/Wed · 4× a week",
        priority: 2, timeEstimateMins: 180, parent90DayGoal: "Get fit", ninetyDayGoalId: 3, notes: "Recurring habit (4× a week)",
      },
      {
        source: "review", habitId: null, pillar: "Personal Development & Learning", goalTitle: "Weekly review and progress scores",
        goalDescription: "Monday 09:00: done / slipped / why; score each 90-day goal 1–10; set next week",
        priority: 1, timeEstimateMins: 30, parent90DayGoal: null, ninetyDayGoalId: null, notes: "Keeps the cascade honest",
      },
    ]);
  });
  it("respects addHabits = no and a missing review day", () => {
    expect(recurringRows([habit], { addHabits: "no" })).toEqual([]);
  });
});

describe("scoreTrend", () => {
  it("sorts by week and reports the latest", () => {
    expect(scoreTrend([{ weekStartDate: "2026-10-05", score: 6 }, { weekStartDate: "2026-09-28", score: 4 }]))
      .toEqual({ points: [{ weekStartDate: "2026-09-28", score: 4 }, { weekStartDate: "2026-10-05", score: 6 }], latest: 6 });
    expect(scoreTrend([]).latest).toBeNull();
  });
});

describe("reviewBody", () => {
  it("takes the goal checklist and drops the old done / slipped / why fields", () => {
    const parsed = reviewBody.parse({
      weekStartDate: "2026-10-05",
      doneNotes: "old", slippedNotes: "old", whyNotes: "old",
      goals: [{ id: 3, completed: true, note: "Booked" }, { id: 4, completed: false }],
    });
    expect(parsed).toEqual({
      weekStartDate: "2026-10-05",
      goals: [{ id: 3, completed: true, note: "Booked" }, { id: 4, completed: false }],
      scores: [], nextGoals: [],
    });
  });
  it("rejects a checklist row without a completed flag, and out-of-range scores", () => {
    expect(reviewBody.safeParse({ weekStartDate: "2026-10-05", goals: [{ id: 3 }] }).success).toBe(false);
    expect(reviewBody.safeParse({ weekStartDate: "2026-10-05", scores: [{ ninetyDayGoalId: 1, score: 11 }] }).success).toBe(false);
  });
});
