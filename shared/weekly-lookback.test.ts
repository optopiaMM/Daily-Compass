import { describe, it, expect } from "vitest";
import { lookbackCounts, mergeCarriedTasks, type DailyItemLike, type WeeklyGoalLike } from "./weekly-lookback";

let nextId = 1;
const item = (p: Partial<DailyItemLike> & { text: string; date: string }): DailyItemLike => ({
  id: nextId++, type: "todo", completed: false, linkedWeeklyGoalId: null, ninetyDayGoalId: null, ...p,
});
const goal = (p: Partial<WeeklyGoalLike> & { id: number; category: string }): WeeklyGoalLike => ({
  completed: false, ninetyDayGoalId: null, source: "manual", ...p,
});

const pillar = (r: ReturnType<typeof lookbackCounts>, name: string) => r.pillars.find((p) => p.pillar === name);

describe("mergeCarriedTasks", () => {
  it("counts a task carried over several days, then done, once", () => {
    const tasks = mergeCarriedTasks([
      item({ text: "Send invoice", date: "2026-10-12" }),
      item({ text: "send invoice ", date: "2026-10-13" }),
      item({ text: "Send invoice", date: "2026-10-14", completed: true }),
    ]);
    expect(tasks).toEqual([{ completed: true, linkedWeeklyGoalId: null, ninetyDayGoalId: null }]);
  });

  it("counts a task carried and never done once, as open", () => {
    const tasks = mergeCarriedTasks([item({ text: "Fix gate", date: "2026-10-12" }), item({ text: "Fix gate", date: "2026-10-13" })]);
    expect(tasks.map((t) => t.completed)).toEqual([false]);
  });

  it("counts a task done on two days twice", () => {
    const tasks = mergeCarriedTasks([
      item({ text: "Gym", date: "2026-10-12", completed: true }),
      item({ text: "Gym", date: "2026-10-14", completed: true }),
      item({ text: "Gym", date: "2026-10-16" }),
    ]);
    expect(tasks.map((t) => t.completed)).toEqual([true, true, false]);
  });

  it("keeps the latest goal tag set on any of a task's rows", () => {
    const [t] = mergeCarriedTasks([
      item({ text: "Call Sam", date: "2026-10-12", ninetyDayGoalId: 3 }),
      item({ text: "Call Sam", date: "2026-10-13", completed: true }),
    ]);
    expect(t).toMatchObject({ completed: true, ninetyDayGoalId: 3 });
  });
});

describe("lookbackCounts", () => {
  const active = [{ id: 2, goalText: "More interesting work" }, { id: 3, goalText: "Friends" }];

  it("pillar bars count the week's weekly goals only and ignore daily tasks", () => {
    const wgs = [
      goal({ id: 10, category: "Profit", completed: true }),
      goal({ id: 11, category: "Profit" }),
      goal({ id: 12, category: "Profit" }),
      goal({ id: 13, category: "People", completed: true }),
      goal({ id: 14, category: "Personal Development & Learning", source: "review", completed: true }), // the review row: left out
    ];
    const items = [
      item({ text: "Draft pitch", date: "2026-10-12", linkedWeeklyGoalId: 11, completed: true }), // doesn't tick 11's bar
      item({ text: "Tidy desk", date: "2026-10-13", completed: true }),
      item({ text: "Call Sam", date: "2026-10-13", ninetyDayGoalId: 2, completed: true }),
    ];
    const r = lookbackCounts(wgs, items, wgs, active);

    expect(r.pillars).toEqual([
      { pillar: "Profit", done: 1, total: 3, pct: 33 },
      { pillar: "Promise", done: 0, total: 0, pct: 0 },
      { pillar: "Personal", done: 0, total: 0, pct: 0 },
      { pillar: "People", done: 1, total: 1, pct: 100 },
      { pillar: "Personal Development & Learning", done: 0, total: 0, pct: 0 },
      { pillar: "Physical Environment", done: 0, total: 0, pct: 0 },
    ]);
    // Same weekly goals, no daily tasks: the pillar bars don't move.
    expect(lookbackCounts(wgs, [], [], active).pillars).toEqual(r.pillars);
  });

  it("only credits active goals; a link to a non-active goal is unassigned", () => {
    const wgs = [
      goal({ id: 20, category: "Profit", ninetyDayGoalId: 2, completed: true }),
      goal({ id: 21, category: "Profit", ninetyDayGoalId: 2 }),
      goal({ id: 22, category: "People", ninetyDayGoalId: 1, completed: true }), // placeholder goal, not active
      goal({ id: 23, category: "People" }),
    ];
    const placeholderLinked = goal({ id: 99, category: "Profit", ninetyDayGoalId: 1 }); // from an earlier week
    const items = [
      item({ text: "Tagged directly", date: "2026-10-12", ninetyDayGoalId: 3, completed: true }),
      item({ text: "Via weekly goal", date: "2026-10-13", linkedWeeklyGoalId: 20, completed: true }),
      item({ text: "Old link", date: "2026-10-13", linkedWeeklyGoalId: 99, completed: true }),
      item({ text: "Tagged to placeholder", date: "2026-10-14", ninetyDayGoalId: 1 }),
    ];
    const r = lookbackCounts(wgs, items, [...wgs, placeholderLinked], active);

    // Goal 2: weekly goals 20 and 21; "Via weekly goal" is 20 again. Goal 3: the
    // directly tagged task.
    expect(r.goals).toEqual([
      { id: 2, goalText: "More interesting work", done: 1, total: 2, pct: 50 },
      { id: 3, goalText: "Friends", done: 1, total: 1, pct: 100 },
    ]);
    expect(r.goals.find((g) => g.id === 1)).toBeUndefined();
    // 22 (placeholder), 23 (no goal), "Old link" (placeholder via an earlier week's
    // goal) and "Tagged to placeholder".
    expect(r.unassignedGoal).toEqual({ done: 2, total: 4 });
  });

  it("merges a weekly goal and its linked daily tasks into one unit per goal", () => {
    const wgs = [
      goal({ id: 30, category: "Profit", ninetyDayGoalId: 2 }), // open, but its task got done
      goal({ id: 31, category: "Profit", ninetyDayGoalId: 2, completed: true }), // done, its task left open
      goal({ id: 32, category: "Profit", ninetyDayGoalId: 2 }), // open, no task
      goal({ id: 33, category: "People", ninetyDayGoalId: 3 }), // the other goal's
    ];
    const items = [
      item({ text: "Proposal", date: "2026-10-12", linkedWeeklyGoalId: 30, ninetyDayGoalId: 2 }),
      item({ text: "Proposal", date: "2026-10-13", linkedWeeklyGoalId: 30, ninetyDayGoalId: 2, completed: true }), // carried, then done
      item({ text: "Invoice", date: "2026-10-12", linkedWeeklyGoalId: 31, ninetyDayGoalId: 2 }),
      item({ text: "Fresh idea", date: "2026-10-14", ninetyDayGoalId: 2 }), // its own unit
      item({ text: "Cross-tagged", date: "2026-10-14", linkedWeeklyGoalId: 33, ninetyDayGoalId: 2, completed: true }), // 33 is goal 3's
    ];
    const r = lookbackCounts(wgs, items, wgs, active);
    const work = r.goals.find((g) => g.id === 2)!;
    // 30 (done via its task), 31 (done), 32, Fresh idea, Cross-tagged (done): 5 units, not 8 rows.
    expect(work).toMatchObject({ done: 3, total: 5, pct: 60 });
    expect(r.goals.find((g) => g.id === 3)).toMatchObject({ done: 0, total: 1, pct: 0 });

    // Just a weekly goal and the task pulled from it: one unit.
    const one = lookbackCounts([wgs[0]], [items[0]], [wgs[0]], active).goals.find((g) => g.id === 2);
    expect(one).toMatchObject({ done: 0, total: 1, pct: 0 });
  });

  it("gives a goal with nothing allocated 0 of 0 at 0%", () => {
    expect(lookbackCounts([], [], [], active).goals).toEqual([
      { id: 2, goalText: "More interesting work", done: 0, total: 0, pct: 0 },
      { id: 3, goalText: "Friends", done: 0, total: 0, pct: 0 },
    ]);
  });
});
