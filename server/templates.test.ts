import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// In-memory stand-in for weekly_goal_templates. The fake db renders the real
// drizzle `where` condition to SQL and only understands `"source" = $1`, so an
// unscoped delete (the old wipe-everything behaviour) removes every row.
const rows: Array<Record<string, unknown>> = [];
const dialect = new PgDialect();

vi.mock("./db", () => ({
  db: {
    delete: () => {
      const run = (cond?: SQL) => {
        if (!cond) {
          rows.length = 0;
          return Promise.resolve();
        }
        const q = dialect.sqlToQuery(cond);
        if (q.sql !== '"weekly_goal_templates"."source" = $1') {
          throw new Error(`fake db: unsupported delete condition ${q.sql}`);
        }
        const keep = rows.filter((r) => r.source !== q.params[0]);
        rows.length = 0;
        rows.push(...keep);
        return Promise.resolve();
      };
      const p = { where: run, then: (res: any, rej: any) => run().then(res, rej) };
      return p;
    },
    insert: () => ({
      values: (vals: Array<Record<string, unknown>>) => {
        for (const v of vals) rows.push({ ...v }); // no default: source must come from the sync
        return Promise.resolve();
      },
    }),
  },
}));

const { syncWeeklyGoalTemplatesFromCsv } = await import("./templates");

const CSV = [
  "week_start_date,pillar,track,goal_title,goal_description,priority,time_estimate_mins,parent_90day_goal,status,notes",
  "2026-10-05,Profit,,Send invoices,,1,30,,,",
  "2026-10-05,People,,Call mentor,,2,15,,,",
].join("\n");

describe("syncWeeklyGoalTemplatesFromCsv", () => {
  let dir: string;

  beforeEach(() => {
    rows.length = 0;
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "templates-test-"));
    fs.writeFileSync(path.join(dir, "weekly_goal_templates.csv"), CSV);
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("keeps non-csv rows across a re-sync and replaces csv rows", async () => {
    rows.push(
      { goalTitle: "Stale CSV row", source: "csv" },
      { goalTitle: "Yearwise row", source: "yearwise" },
      { goalTitle: "Habit row", source: "habit" },
      { goalTitle: "Review row", source: "review" },
    );

    await syncWeeklyGoalTemplatesFromCsv();
    await syncWeeklyGoalTemplatesFromCsv();

    const titles = rows.map((r) => r.goalTitle).sort();
    expect(titles).toEqual(["Call mentor", "Habit row", "Review row", "Send invoices", "Yearwise row"]);
  });

  it("writes CSV rows with source='csv' explicitly", async () => {
    await syncWeeklyGoalTemplatesFromCsv();
    expect(rows).toHaveLength(2);
    for (const r of rows) expect(r.source).toBe("csv");
  });
});
