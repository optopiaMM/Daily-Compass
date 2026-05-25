import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  morningSessions, gratitudeEntries, livingPowerfullyScores,
  weeklyGoals, dailyItems, dailyQuotes,
  annualTargets, ninetyDayGoals,
  type InsertGratitudeEntry, type InsertLivingPowerfullyScore,
  type InsertDailyItem, type InsertDailyQuote,
  type InsertAnnualTarget, type InsertNinetyDayGoal,
  type MorningSession, type GratitudeEntry, type LivingPowerfullyScore,
  type WeeklyGoal, type DailyItem, type DailyQuote,
  type AnnualTarget, type NinetyDayGoal,
} from "@shared/schema";

export interface IStorage {
  getAnnualTarget(): Promise<AnnualTarget | undefined>;
  createAnnualTarget(data: InsertAnnualTarget): Promise<AnnualTarget>;
  updateAnnualTarget(id: number, data: Partial<InsertAnnualTarget>): Promise<AnnualTarget>;
  getCurrentNinetyDayGoal(): Promise<NinetyDayGoal | undefined>;
  getAllNinetyDayGoals(): Promise<NinetyDayGoal[]>;
  createNinetyDayGoal(data: InsertNinetyDayGoal): Promise<NinetyDayGoal>;
  updateNinetyDayGoal(id: number, data: Partial<InsertNinetyDayGoal>): Promise<NinetyDayGoal>;
  getMorningSession(date: string): Promise<MorningSession | undefined>;
  completeMorningSession(date: string): Promise<void>;
  createGratitudeEntry(entry: InsertGratitudeEntry): Promise<GratitudeEntry>;
  createLivingPowerfullyScores(entries: InsertLivingPowerfullyScore[]): Promise<void>;
  getWeeklyGoals(weekStartDate: string): Promise<WeeklyGoal[]>;
  createWeeklyGoals(weekStartDate: string, goals: { category: string; goalText: string; sortOrder: number; isTopFocus?: boolean }[]): Promise<void>;
  addWeeklyGoal(weekStartDate: string, category: string, goalText: string): Promise<WeeklyGoal>;
  getWeeklyGoalCountByCategory(weekStartDate: string, category: string): Promise<number>;
  markWeeklyGoalComplete(goalId: number): Promise<void>;
  markWeeklyGoalIncomplete(goalId: number): Promise<void>;
  getDailyItems(date: string): Promise<DailyItem[]>;
  createDailyItems(date: string, items: InsertDailyItem[]): Promise<void>;
  addDailyItem(item: InsertDailyItem): Promise<DailyItem>;
  toggleDailyItem(itemId: number): Promise<DailyItem | undefined>;
  getItemsForReview(currentDate: string): Promise<{ items: DailyItem[]; fromDate: string } | null>;
  getCarriedItems(date: string): Promise<DailyItem[]>;
  carryItemsForward(currentDate: string, itemIds: number[]): Promise<void>;
  scheduleItemForDate(itemId: number, reviewDate: string): Promise<void>;
  getDailyQuote(date: string): Promise<DailyQuote | undefined>;
  saveDailyQuote(quote: InsertDailyQuote): Promise<DailyQuote>;
}

export class DatabaseStorage implements IStorage {
  async getAnnualTarget() {
    const [row] = await db.select().from(annualTargets)
      .where(eq(annualTargets.active, true))
      .orderBy(desc(annualTargets.createdAt))
      .limit(1);
    return row;
  }

  async createAnnualTarget(data: InsertAnnualTarget) {
    const [row] = await db.insert(annualTargets).values(data).returning();
    return row;
  }

  async updateAnnualTarget(id: number, data: Partial<InsertAnnualTarget>) {
    const [row] = await db.update(annualTargets).set(data).where(eq(annualTargets.id, id)).returning();
    return row;
  }

  async getCurrentNinetyDayGoal() {
    const today = new Date().toISOString().split("T")[0];
    const [inWindow] = await db.select().from(ninetyDayGoals)
      .where(and(
        eq(ninetyDayGoals.active, true),
        sql`${ninetyDayGoals.startDate} <= ${today}`,
        sql`${ninetyDayGoals.endDate} >= ${today}`,
      ))
      .orderBy(desc(ninetyDayGoals.createdAt))
      .limit(1);
    if (inWindow) return inWindow;
    // Fallback: nearest active goal (most recent by createdAt) so the cascade
    // is still reachable even before today is inside any quarter window.
    const [fallback] = await db.select().from(ninetyDayGoals)
      .where(eq(ninetyDayGoals.active, true))
      .orderBy(desc(ninetyDayGoals.createdAt))
      .limit(1);
    return fallback;
  }

  async getAllNinetyDayGoals() {
    return db.select().from(ninetyDayGoals).orderBy(desc(ninetyDayGoals.startDate));
  }

  async createNinetyDayGoal(data: InsertNinetyDayGoal) {
    const [row] = await db.insert(ninetyDayGoals).values(data).returning();
    return row;
  }

  async updateNinetyDayGoal(id: number, data: Partial<InsertNinetyDayGoal>) {
    const [row] = await db.update(ninetyDayGoals).set(data).where(eq(ninetyDayGoals.id, id)).returning();
    return row;
  }

  async getMorningSession(date: string) {
    const [session] = await db.select().from(morningSessions).where(eq(morningSessions.date, date));
    return session;
  }

  async completeMorningSession(date: string) {
    const existing = await this.getMorningSession(date);
    if (existing) {
      await db.update(morningSessions).set({ completed: true }).where(eq(morningSessions.date, date));
    } else {
      await db.insert(morningSessions).values({ date, completed: true });
    }
  }

  async createGratitudeEntry(entry: InsertGratitudeEntry) {
    // Upsert on the date unique constraint so a mid-ritual refresh
    // (which resets stepIndex to 0 and re-shows gratitude) can re-save
    // without hitting "duplicate key value violates unique constraint".
    const [result] = await db.insert(gratitudeEntries)
      .values(entry)
      .onConflictDoUpdate({
        target: gratitudeEntries.date,
        set: {
          general1: entry.general1,
          general2: entry.general2,
          general3: entry.general3,
          lizzie: entry.lizzie,
          george: entry.george,
          ben: entry.ben,
        },
      })
      .returning();
    return result;
  }

  async createLivingPowerfullyScores(entries: InsertLivingPowerfullyScore[]) {
    if (entries.length > 0) await db.insert(livingPowerfullyScores).values(entries);
  }

  async getWeeklyGoals(weekStartDate: string) {
    return db.select().from(weeklyGoals)
      .where(eq(weeklyGoals.weekStartDate, weekStartDate))
      .orderBy(weeklyGoals.category, weeklyGoals.sortOrder);
  }

  async createWeeklyGoals(weekStartDate: string, goals: { category: string; goalText: string; sortOrder: number; isTopFocus?: boolean }[]) {
    await db.delete(weeklyGoals).where(eq(weeklyGoals.weekStartDate, weekStartDate));
    if (goals.length > 0) {
      const current = await this.getCurrentNinetyDayGoal();
      const ninetyDayGoalId = current?.id ?? null;
      await db.insert(weeklyGoals).values(
        goals.map((g) => ({
          weekStartDate,
          category: g.category,
          goalText: g.goalText,
          sortOrder: g.sortOrder,
          completed: false,
          ninetyDayGoalId,
          isTopFocus: g.isTopFocus ?? false,
        }))
      );
    }
  }

  async addWeeklyGoal(weekStartDate: string, category: string, goalText: string) {
    const existing = await db.select().from(weeklyGoals)
      .where(and(eq(weeklyGoals.weekStartDate, weekStartDate), eq(weeklyGoals.category, category)));
    const current = await this.getCurrentNinetyDayGoal();
    const [result] = await db.insert(weeklyGoals)
      .values({
        weekStartDate,
        category,
        goalText,
        sortOrder: existing.length,
        completed: false,
        ninetyDayGoalId: current?.id ?? null,
      })
      .returning();
    return result;
  }

  async getWeeklyGoalCountByCategory(weekStartDate: string, category: string) {
    const goals = await db.select().from(weeklyGoals)
      .where(and(eq(weeklyGoals.weekStartDate, weekStartDate), eq(weeklyGoals.category, category)));
    return goals.length;
  }

  async markWeeklyGoalComplete(goalId: number) {
    await db.update(weeklyGoals).set({ completed: true }).where(eq(weeklyGoals.id, goalId));
  }

  async markWeeklyGoalIncomplete(goalId: number) {
    await db.update(weeklyGoals).set({ completed: false }).where(eq(weeklyGoals.id, goalId));
  }

  async getDailyItems(date: string) {
    return db.select().from(dailyItems).where(eq(dailyItems.date, date)).orderBy(dailyItems.type, dailyItems.rank);
  }

  async createDailyItems(date: string, items: InsertDailyItem[]) {
    await db.delete(dailyItems).where(eq(dailyItems.date, date));
    if (items.length > 0) {
      await db.insert(dailyItems).values(items.map((item) => ({ ...item, date })));
    }
  }

  async addDailyItem(item: InsertDailyItem) {
    const [result] = await db.insert(dailyItems).values(item).returning();
    return result;
  }

  async toggleDailyItem(itemId: number) {
    const [item] = await db.select().from(dailyItems).where(eq(dailyItems.id, itemId));
    if (!item) return undefined;
    const [updated] = await db.update(dailyItems).set({ completed: !item.completed })
      .where(eq(dailyItems.id, itemId)).returning();
    if (updated.linkedWeeklyGoalId) {
      if (updated.completed) await this.markWeeklyGoalComplete(updated.linkedWeeklyGoalId);
      else await this.markWeeklyGoalIncomplete(updated.linkedWeeklyGoalId);
    }
    return updated;
  }

  async getItemsForReview(currentDate: string) {
    const scheduledItems = await db.select().from(dailyItems)
      .where(and(eq(dailyItems.scheduledReviewDate, currentDate), eq(dailyItems.completed, false)));

    const previousDays = await db.selectDistinct({ date: dailyItems.date }).from(dailyItems)
      .where(sql`${dailyItems.date} < ${currentDate}`)
      .orderBy(desc(dailyItems.date)).limit(1);

    let incompleteFromPrev: DailyItem[] = [];
    let fromDate = "";
    if (previousDays.length > 0) {
      fromDate = previousDays[0].date;
      incompleteFromPrev = await db.select().from(dailyItems).where(and(
        eq(dailyItems.date, fromDate),
        eq(dailyItems.completed, false),
        sql`(${dailyItems.scheduledReviewDate} IS NULL OR ${dailyItems.scheduledReviewDate} <= ${currentDate})`
      ));
    }

    const scheduledIds = new Set(scheduledItems.map((i) => i.id));
    const allItems = [...scheduledItems, ...incompleteFromPrev.filter((i) => !scheduledIds.has(i.id))];
    if (allItems.length === 0) return null;
    return { items: allItems, fromDate: fromDate || currentDate };
  }

  async getCarriedItems(date: string) {
    return db.select().from(dailyItems)
      .where(and(eq(dailyItems.date, date), eq(dailyItems.completed, false)));
  }

  async carryItemsForward(currentDate: string, itemIds: number[]) {
    for (const id of itemIds) {
      const [item] = await db.select().from(dailyItems).where(eq(dailyItems.id, id));
      if (item) {
        const existing = await db.select().from(dailyItems).where(and(
          eq(dailyItems.date, currentDate), eq(dailyItems.text, item.text), eq(dailyItems.type, item.type)
        ));
        if (existing.length === 0) {
          await db.insert(dailyItems).values({
            date: currentDate, type: item.type, text: item.text, rank: item.rank,
            completed: false, linkedWeeklyGoalId: item.linkedWeeklyGoalId, scheduledReviewDate: null,
          });
        }
      }
    }
  }

  async scheduleItemForDate(itemId: number, reviewDate: string) {
    await db.update(dailyItems).set({ scheduledReviewDate: reviewDate }).where(eq(dailyItems.id, itemId));
  }

  async getDailyQuote(date: string) {
    const [quote] = await db.select().from(dailyQuotes).where(eq(dailyQuotes.date, date));
    return quote;
  }

  async saveDailyQuote(quote: InsertDailyQuote) {
    const [result] = await db.insert(dailyQuotes).values(quote).onConflictDoNothing().returning();
    if (!result) {
      const [existing] = await db.select().from(dailyQuotes).where(eq(dailyQuotes.date, quote.date));
      return existing;
    }
    return result;
  }
}

export const storage = new DatabaseStorage();
