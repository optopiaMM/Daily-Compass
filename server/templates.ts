import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { db } from "./db";
import { weeklyGoalTemplates, type InsertWeeklyGoalTemplate } from "@shared/schema";

const CSV_FILENAME = "weekly_goal_templates.csv";

// CSV uses "Personal Development" — the app constant is "Personal Development & Learning".
// Map CSV pillar names to the app's canonical pillar names so cards drop into the right bucket.
const PILLAR_MAP: Record<string, string> = {
  "Profit": "Profit",
  "Promise": "Promise",
  "Personal": "Personal",
  "People": "People",
  "Personal Development": "Personal Development & Learning",
  "Personal Development & Learning": "Personal Development & Learning",
  "Physical Environment": "Physical Environment",
};

interface CsvRow {
  week_start_date: string;
  pillar: string;
  track: string;
  goal_title: string;
  goal_description: string;
  priority: string;
  time_estimate_mins: string;
  parent_90day_goal: string;
  status: string;
  notes: string;
}

function emptyToNull(s: string | undefined | null): string | null {
  if (s === undefined || s === null) return null;
  const t = s.trim();
  return t.length === 0 ? null : t;
}

function intOrNull(s: string | undefined | null): number | null {
  const v = emptyToNull(s);
  if (v === null) return null;
  const n = parseInt(v, 10);
  return Number.isNaN(n) ? null : n;
}

export async function syncWeeklyGoalTemplatesFromCsv(): Promise<void> {
  const csvPath = path.resolve(process.cwd(), CSV_FILENAME);
  if (!fs.existsSync(csvPath)) {
    console.log(`[templates] ${CSV_FILENAME} not found at ${csvPath}, skipping`);
    return;
  }

  console.log(`[templates] reading ${csvPath}`);
  let rows: CsvRow[];
  try {
    const text = fs.readFileSync(csvPath, "utf-8");
    rows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    }) as CsvRow[];
  } catch (err: any) {
    console.error(`[templates] failed to parse CSV: ${err?.message ?? err}`);
    return;
  }

  const toInsert: InsertWeeklyGoalTemplate[] = [];
  const skippedByPillarBucket: Record<string, number> = {};
  let skippedNoTitle = 0;
  let skippedBadPillar = 0;

  // Group by (week_start_date, pillar) to assign sortOrder within each bucket
  const counters: Record<string, number> = {};

  for (const r of rows) {
    const title = emptyToNull(r.goal_title);
    if (!title) {
      skippedNoTitle += 1;
      continue;
    }
    const rawPillar = (r.pillar ?? "").trim();
    const pillar = PILLAR_MAP[rawPillar];
    if (!pillar) {
      console.warn(`[templates] unknown pillar "${rawPillar}" on row "${title}" — skipping`);
      skippedBadPillar += 1;
      continue;
    }
    const week = emptyToNull(r.week_start_date);
    if (!week) {
      console.warn(`[templates] missing week_start_date for row "${title}" — skipping`);
      continue;
    }

    const key = `${week}|${pillar}`;
    counters[key] = (counters[key] ?? 0);
    const sortOrder = counters[key];
    counters[key] += 1;
    skippedByPillarBucket[pillar] = (skippedByPillarBucket[pillar] ?? 0);

    toInsert.push({
      weekStartDate: week,
      pillar,
      track: emptyToNull(r.track),
      goalTitle: title,
      goalDescription: emptyToNull(r.goal_description),
      priority: intOrNull(r.priority),
      timeEstimateMins: intOrNull(r.time_estimate_mins),
      parent90DayGoal: emptyToNull(r.parent_90day_goal),
      status: emptyToNull(r.status) ?? "not_started",
      notes: emptyToNull(r.notes),
      sortOrder,
    });
  }

  // Wipe and reinsert — CSV is the source of truth.
  await db.delete(weeklyGoalTemplates);
  if (toInsert.length > 0) {
    // Insert in batches to avoid any parameter-count limits.
    const BATCH = 200;
    for (let i = 0; i < toInsert.length; i += BATCH) {
      const chunk = toInsert.slice(i, i + BATCH);
      await db.insert(weeklyGoalTemplates).values(chunk);
    }
  }
  console.log(`[templates] sync complete: ${toInsert.length} rows inserted, ${skippedNoTitle} placeholder rows skipped, ${skippedBadPillar} unknown-pillar rows skipped`);
}
