// Saving a week from the weekly-goals step. Each posted goal is matched to the
// row it came from (by id, then template link, then category + text) and updated
// in place, so `completed`, ids and any daily items linked to them survive a
// re-save. Rows left out of the post are deleted; new goals are inserted.
import { eq, inArray } from "drizzle-orm";
import { weeklyGoals, type WeeklyGoal } from "@shared/schema";
import type { Db } from "./yearwise-commit";

// A weekly goal as the weekly view saves it. The link fields are set when the goal
// came from a plan row (weekly_goal_templates), so it keeps that row's own
// 90-day goal rather than defaulting to the "current" one.
export interface WeeklyGoalInput {
  id?: number | null; // the existing weekly_goals row, when re-saving it
  category: string;
  goalText: string;
  sortOrder: number;
  isTopFocus?: boolean;
  ninetyDayGoalId?: number | null;
  weeklyGoalTemplateId?: number | null;
  source?: string;
  habitId?: number | null;
}

export async function saveWeeklyGoals(
  db: Db,
  weekStartDate: string,
  goals: WeeklyGoalInput[],
  defaultNinetyDayGoalId: number | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const existing = await tx.select().from(weeklyGoals).where(eq(weeklyGoals.weekStartDate, weekStartDate));
    const used = new Set<number>();
    const take = (pred: (e: WeeklyGoal) => boolean) => {
      const hit = existing.find((e) => !used.has(e.id) && pred(e));
      if (hit) used.add(hit.id);
      return hit;
    };

    for (const g of goals) {
      const match =
        (g.id != null ? take((e) => e.id === g.id) : undefined) ??
        (g.weeklyGoalTemplateId != null ? take((e) => e.weeklyGoalTemplateId === g.weeklyGoalTemplateId) : undefined) ??
        take((e) => e.category === g.category && e.goalText.trim() === g.goalText.trim());
      const values = {
        category: g.category,
        goalText: g.goalText,
        sortOrder: g.sortOrder,
        isTopFocus: g.isTopFocus ?? false,
        ninetyDayGoalId: g.ninetyDayGoalId ?? match?.ninetyDayGoalId ?? defaultNinetyDayGoalId,
        weeklyGoalTemplateId: g.weeklyGoalTemplateId ?? match?.weeklyGoalTemplateId ?? null,
        source: g.source ?? match?.source ?? "manual",
        habitId: g.habitId ?? match?.habitId ?? null,
      };
      if (match) await tx.update(weeklyGoals).set(values).where(eq(weeklyGoals.id, match.id));
      else await tx.insert(weeklyGoals).values({ ...values, weekStartDate, completed: false });
    }

    const removed = existing.filter((e) => !used.has(e.id)).map((e) => e.id);
    if (removed.length) await tx.delete(weeklyGoals).where(inArray(weeklyGoals.id, removed));
  });
}
