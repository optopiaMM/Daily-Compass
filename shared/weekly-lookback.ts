// Weekly look-back: what got done last week, by pillar and by 90-day goal. Pure,
// so the server returns exactly what the tests check.
import { SIX_P_CATEGORIES } from "./schema";
import type { HydrationWeek } from "./hydration";

export interface Tally { done: number; total: number }
// pct = done / total as a whole percentage, 0 when there's nothing.
export interface Progress extends Tally { pct: number }

export interface PillarTally extends Progress { pillar: string } // the week's weekly goals only
export interface GoalTally extends Progress { id: number; goalText: string } // merged units of work

export interface WeeklyLookbackCounts {
  pillars: PillarTally[]; // the six P's, in order
  goals: GoalTally[]; // the goals active in the week, in the order given
  unassignedGoal: Tally; // work linked to no goal, or only to one not active in the week
}

export interface WeeklyLookback extends WeeklyLookbackCounts {
  weekStart: string;
  hydration: HydrationWeek;
}

export interface WeeklyGoalLike {
  id: number;
  category: string;
  completed: boolean;
  ninetyDayGoalId: number | null;
  source: string;
}

export interface DailyItemLike {
  id: number;
  date: string;
  type: string;
  text: string;
  completed: boolean;
  linkedWeeklyGoalId: number | null;
  ninetyDayGoalId: number | null;
}

export interface ActiveGoalLike { id: number; goalText: string }

/* ================= daily tasks, with carry-overs merged ================= */

export interface DailyTask {
  completed: boolean;
  linkedWeeklyGoalId: number | null;
  ninetyDayGoalId: number | null;
}

// Carrying a task forward copies it to the next day as a new row, so one task can
// be several rows. Rows of the same task (same text and weekly-goal link) are
// walked by date: each completed row is one done task, and the unfinished rows
// before it were that task being carried, so they don't count again. Unfinished
// rows after the last completion are one task still open. A task done twice (a
// habit on Monday and Wednesday, say) still counts twice.
// A goal tag set on any of a task's rows applies; the latest wins.
export function mergeCarriedTasks(items: DailyItemLike[]): DailyTask[] {
  const groups = new Map<string, DailyItemLike[]>();
  for (const it of items) {
    const key = `${it.linkedWeeklyGoalId ?? ""}|${it.text.trim().toLowerCase()}`;
    const g = groups.get(key);
    if (g) g.push(it); else groups.set(key, [it]);
  }
  const tasks: DailyTask[] = [];
  for (const rows of Array.from(groups.values())) {
    rows.sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const tagged = [...rows].reverse().find((r) => r.ninetyDayGoalId != null);
    const tags = { linkedWeeklyGoalId: rows[0].linkedWeeklyGoalId, ninetyDayGoalId: tagged?.ninetyDayGoalId ?? null };
    let open = false;
    for (const r of rows) {
      if (r.completed) { tasks.push({ completed: true, ...tags }); open = false; }
      else open = true;
    }
    if (open) tasks.push({ completed: false, ...tags });
  }
  return tasks;
}

/* ================= counting ================= */

const progress = (done: number, total: number): Progress => ({ done, total, pct: total ? Math.round((done / total) * 100) : 0 });

// weeklyGoals: the week's goals. dailyItems: the week's daily items (Mon–Sun).
// linkedGoals: the weekly goals those items link to, from any week, for the
// fallback goal tag. activeGoals: the 90-day goals active in the week; a link to
// any other goal (an old placeholder, say) counts as unassigned.
//
// The two sections count differently, on purpose:
// - By pillar: the week's weekly goals only, by category. Daily tasks don't count.
// - By 90-day goal: units of work. Each of the week's weekly goals for the goal is
//   one unit, and each daily task for it (after carry-overs are merged) is one
//   more, unless it's linked to one of those weekly goals, in which case it's that
//   same unit. A unit is done if any of its parts is.
// Both leave out the week's review row, which saving the review ticks.
export function lookbackCounts(
  weeklyGoals: WeeklyGoalLike[],
  dailyItems: DailyItemLike[],
  linkedGoals: WeeklyGoalLike[],
  activeGoals: ActiveGoalLike[],
): WeeklyLookbackCounts {
  const weekGoals = weeklyGoals.filter((g) => g.source !== "review");

  const pillars = SIX_P_CATEGORIES.map((pillar) => {
    const inPillar = weekGoals.filter((g) => g.category === pillar);
    return { pillar, ...progress(inPillar.filter((g) => g.completed).length, inPillar.length) };
  });

  // Units per goal (null = unassigned): unit key → done.
  const active = new Set(activeGoals.map((g) => g.id));
  const units = new Map<number | null, Map<string, boolean>>([[null, new Map()], ...activeGoals.map((g) => [g.id, new Map()] as const)]);
  const goalOf = (id: number | null | undefined) => (id != null && active.has(id) ? id : null);
  const addUnit = (goal: number | null, key: string, done: boolean) => {
    const m = units.get(goal)!;
    m.set(key, (m.get(key) ?? false) || done);
  };

  const weekGoalOf = new Map<number, number | null>(); // this week's weekly goal → its goal
  for (const g of weekGoals) {
    const goal = goalOf(g.ninetyDayGoalId);
    weekGoalOf.set(g.id, goal);
    addUnit(goal, `wg:${g.id}`, g.completed);
  }

  const linked = new Map(linkedGoals.map((g) => [g.id, g]));
  mergeCarriedTasks(dailyItems).forEach((t, i) => {
    const wg = t.linkedWeeklyGoalId != null ? linked.get(t.linkedWeeklyGoalId) : undefined;
    const goal = goalOf(t.ninetyDayGoalId ?? wg?.ninetyDayGoalId);
    const sameUnit = t.linkedWeeklyGoalId != null && weekGoalOf.has(t.linkedWeeklyGoalId) && weekGoalOf.get(t.linkedWeeklyGoalId) === goal;
    addUnit(goal, sameUnit ? `wg:${t.linkedWeeklyGoalId}` : `task:${i}`, t.completed);
  });

  const count = (goal: number | null): Tally => {
    const done = Array.from(units.get(goal)!.values());
    return { done: done.filter(Boolean).length, total: done.length };
  };
  const goals = activeGoals.map((g) => {
    const t = count(g.id);
    return { id: g.id, goalText: g.goalText, ...progress(t.done, t.total) };
  });
  return { pillars, goals, unassignedGoal: count(null) };
}
