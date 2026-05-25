import { pgTable, text, integer, boolean, date, serial, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export type GoalStatus = "green" | "amber" | "red" | "done" | "parked";

export interface FailureTrigger {
  if: string;
  then: string;
}

export const annualTargets = pgTable("annual_targets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  measure: text("measure").notNull(),
  horizon: text("horizon").notNull(),
  status: text("status").notNull().default("green"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const ninetyDayGoals = pgTable("ninety_day_goals", {
  id: serial("id").primaryKey(),
  annualTargetId: integer("annual_target_id").notNull(),
  periodLabel: text("period_label").notNull(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  goalText: text("goal_text").notNull(),
  whyText: text("why_text"),
  successIndicators: jsonb("success_indicators").$type<string[]>().notNull().default([]),
  failureIndicators: jsonb("failure_indicators").$type<string[]>().notNull().default([]),
  failureTriggers: jsonb("failure_triggers").$type<FailureTrigger[]>().notNull().default([]),
  protectedRule: text("protected_rule"),
  ragStatus: text("rag_status").notNull().default("green"),
  reviewText: text("review_text"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const morningSessions = pgTable("morning_sessions", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  completed: boolean("completed").notNull().default(false),
});

export const gratitudeEntries = pgTable("gratitude_entries", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  general1: text("general1").notNull(),
  general2: text("general2").notNull(),
  general3: text("general3").notNull(),
  lizzie: text("lizzie").notNull(),
  george: text("george").notNull(),
  ben: text("ben").notNull(),
});

export const livingPowerfullyScores = pgTable("living_powerfully_scores", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  area: text("area").notNull(),
  score: integer("score").notNull(),
  actionNote: text("action_note"),
  targetCategory: text("target_category"),
});

export const weeklyGoals = pgTable("weekly_goals", {
  id: serial("id").primaryKey(),
  weekStartDate: date("week_start_date").notNull(),
  category: text("category").notNull(),
  goalText: text("goal_text").notNull(),
  completed: boolean("completed").notNull().default(false),
  sortOrder: integer("sort_order").notNull().default(0),
  ninetyDayGoalId: integer("ninety_day_goal_id"),
});

export const dailyItems = pgTable("daily_items", {
  id: serial("id").primaryKey(),
  date: date("date").notNull(),
  type: text("type").notNull(),
  text: text("text").notNull(),
  rank: integer("rank"),
  completed: boolean("completed").notNull().default(false),
  linkedWeeklyGoalId: integer("linked_weekly_goal_id"),
  scheduledReviewDate: date("scheduled_review_date"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const dailyQuotes = pgTable("daily_quotes", {
  id: serial("id").primaryKey(),
  date: date("date").notNull().unique(),
  quoteText: text("quote_text").notNull(),
  author: text("author").notNull(),
});

export const insertAnnualTargetSchema = createInsertSchema(annualTargets).omit({ id: true, createdAt: true });
export const insertNinetyDayGoalSchema = createInsertSchema(ninetyDayGoals).omit({ id: true, createdAt: true });

export type AnnualTarget = typeof annualTargets.$inferSelect;
export type InsertAnnualTarget = z.infer<typeof insertAnnualTargetSchema>;
export type NinetyDayGoal = typeof ninetyDayGoals.$inferSelect;
export type InsertNinetyDayGoal = z.infer<typeof insertNinetyDayGoalSchema>;

export const insertMorningSessionSchema = createInsertSchema(morningSessions).omit({ id: true });
export const insertGratitudeSchema = createInsertSchema(gratitudeEntries).omit({ id: true });
export const insertLivingPowerfullySchema = createInsertSchema(livingPowerfullyScores).omit({ id: true });
export const insertWeeklyGoalSchema = createInsertSchema(weeklyGoals).omit({ id: true });
export const insertDailyItemSchema = createInsertSchema(dailyItems).omit({ id: true, createdAt: true });
export const insertDailyQuoteSchema = createInsertSchema(dailyQuotes).omit({ id: true });

export type MorningSession = typeof morningSessions.$inferSelect;
export type InsertMorningSession = z.infer<typeof insertMorningSessionSchema>;
export type GratitudeEntry = typeof gratitudeEntries.$inferSelect;
export type InsertGratitudeEntry = z.infer<typeof insertGratitudeSchema>;
export type LivingPowerfullyScore = typeof livingPowerfullyScores.$inferSelect;
export type InsertLivingPowerfullyScore = z.infer<typeof insertLivingPowerfullySchema>;
export type WeeklyGoal = typeof weeklyGoals.$inferSelect;
export type InsertWeeklyGoal = z.infer<typeof insertWeeklyGoalSchema>;
export type DailyItem = typeof dailyItems.$inferSelect;
export type InsertDailyItem = z.infer<typeof insertDailyItemSchema>;
export type DailyQuote = typeof dailyQuotes.$inferSelect;
export type InsertDailyQuote = z.infer<typeof insertDailyQuoteSchema>;

export const LIVING_POWERFULLY_AREAS = [
  "Personal Resilience",
  "Health & Wellbeing",
  "Connections",
  "Mission & Purpose",
  "Relationship with Self",
  "Achievements",
] as const;

export const SIX_P_CATEGORIES = [
  "Profit",
  "Promise",
  "Personal",
  "People",
  "Personal Development & Learning",
  "Physical Environment",
] as const;

export type LivingPowerfullyArea = (typeof LIVING_POWERFULLY_AREAS)[number];
export type SixPCategory = (typeof SIX_P_CATEGORIES)[number];
