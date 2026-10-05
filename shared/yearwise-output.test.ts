import { describe, it, expect } from "vitest";
import type { Answers } from "./yearwise";
import { deriveDates } from "./yearwise";
import {
  CSV_COLS, buildCSV, buildJSON, buildMD, plannedByWeek, readinessChecks, startIsUsed, weeklyRows,
} from "./yearwise-output";

const TODAY = new Date(2026, 8, 30);

const base: Answers = {
  planStart: "2026-09-28",
  annual: { title: "Strategic water work", measure: "3 days a week", motive: "want" },
  ninety: { 0: { title: "Gain regular work", pillar: "Profit", annual: "yes", done: "2+ days a week", if1: "a call ends", then1: "I write the next action" } },
  habits: {
    0: { what: "Gym", freq: "4pw", mins: "45", pillar: "Personal", parent: "g0" },
    1: { what: "Meet a friend", freq: "2pm", mins: "180", pillar: "People" },
    2: { what: "Read", freq: "asneeded", mins: "30", pillar: "Personal" },
  },
  weeks: { w1: { 0: { title: "Coaching", pillar: "Profit", mins: "30", parent: "g0" } } },
  review: { day: "Monday", time: "09:00" },
};

const d = deriveDates(base, TODAY);
const texts = (a: Answers) => readinessChecks(a, deriveDates(a, TODAY));

describe("weekly rows (§4.6)", () => {
  it("adds habit and review rows to each week with the spec's time maths", () => {
    const rows = weeklyRows(base, d);
    const w1 = rows.filter((r) => r.week_start_date === "2026-09-28");
    expect(w1.map((r) => r.goal_title)).toEqual(["Coaching", "Habit: Gym", "Habit: Meet a friend", "Habit: Read", "Weekly review and progress scores"]);
    expect(w1.map((r) => r.time_estimate_mins)).toEqual(["30", "180", "90", "", "20"]);
    expect(w1[0]).toMatchObject({ priority: "2", parent_90day_goal: "Gain regular work", parentRef: "g0", status: "not_started" });
    expect(w1[1]).toMatchObject({ goal_description: "4× a week", notes: "Recurring habit (4× a week)", parent_90day_goal: "Gain regular work" });
    expect(w1[4]).toMatchObject({ priority: "1", pillar: "Personal Development & Learning", goal_description: "Monday 09:00: done / slipped / why; score each 90-day goal 1–10; set next week" });
    expect(rows.filter((r) => r.week_start_date === "2026-10-05").length).toBe(4);
  });

  it("leaves habits out when addHabits is no", () => {
    expect(weeklyRows({ ...base, addHabits: "no" }, d).some((r) => r.source === "habit")).toBe(false);
  });

  it("totals planned hours per week", () => {
    expect(plannedByWeek(weeklyRows(base, d))).toEqual([
      { week: "2026-09-28", mins: 320, hours: 5.3 },
      { week: "2026-10-05", mins: 290, hours: 4.8 },
    ]);
  });
});

describe("exports", () => {
  it("writes the CSV in the existing template columns", () => {
    const csv = buildCSV(base, d);
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("week_start_date,pillar,track,goal_title,goal_description,priority,time_estimate_mins,parent_90day_goal,status,notes");
    expect(lines[1]).toBe("2026-09-28,Profit,,Coaching,,2,30,Gain regular work,not_started,");
    expect(lines.length).toBe(1 + 9);
    expect(CSV_COLS.length).toBe(10);
  });

  it("quotes CSV cells with commas and quotes", () => {
    const a = { ...base, weeks: { w1: { 0: { title: 'Say "yes", then go', pillar: "Profit", mins: "5" } } } };
    expect(buildCSV(a, d)).toContain('"Say ""yes"", then go"');
  });

  it("builds JSON with the §4.7 top-level keys", () => {
    const j = JSON.parse(buildJSON(base, d));
    for (const k of ["plan", "life_scores", "reflection", "starts", "annual_target", "ninety_day_goals", "habits", "stops", "continues", "review", "accountability", "first_step", "weekly_goals"]) {
      expect(j).toHaveProperty(k);
    }
    expect(j.plan).toEqual({ start_date: "2026-09-28", ninety_day_end: "2026-12-27", year_end: "2027-09-27" });
    expect(j.ninety_day_goals[0].woop.if_then_plans).toEqual([{ if: "a call ends", then: "I write the next action" }]);
    expect(Object.keys(j.weekly_goals[0])).toEqual([...CSV_COLS]);
  });

  it("builds a Markdown summary with a CSV block", () => {
    const md = buildMD(base, d);
    expect(md).toContain("## Life check-in");
    expect(md).toContain("### 1. Gain regular work");
    expect(md).toContain("- If a call ends, then I write the next action");
    expect(md).toContain("```csv\nweek_start_date,");
  });
});

describe("readiness checks (§4.2)", () => {
  it("passes a complete plan", () => {
    expect(texts(base).filter((c) => !c.ok).map((c) => c.text)).toEqual([]);
  });

  it("warns without blocking on each gap", () => {
    const a: Answers = {
      planStart: "2026-09-28",
      annual: { title: "Be well", measure: "feel better", motive: "should" },
      ninety: { 0: { title: "Get fit", annual: "no", done: "fitter", if1: "I want to run", then1: "I need to go" } },
      stop: { 0: { what: "Doomscrolling" } },
      start: { 0: { what: "Learn Spanish properly", dest: "ninety", motive: "should" }, 1: { what: "Pottery", dest: "later" } },
      weeks: { w1: { 0: { title: "Run", pillar: "Personal" } } },
      life: { health: { score: 4 }, fun: { score: 2 }, work: { score: 7 } },
    };
    const out = texts(a);
    const bad = out.filter((c) => !c.ok).map((c) => c.text);
    expect(bad).toEqual([
      "The annual target's measure has no number in it",
      "At least one 90-day goal moves the annual target",
      "Every 90-day goal has a pillar",
      `"Get fit": 'done' has no number, so it's hard to tell when you're there`,
      `"Get fit": 1 if–then plan reads as a wish rather than a moment and an action`,
      "Every stop has an 'instead'",
      `Start "Learn Spanish properly" isn't in any goal, habit or weekly goal yet`,
      "Missing a pillar or time estimate: Run",
      "Weekly review day is set",
      `2 goals are mostly "should", so check you want them`,
      "Low-scoring areas: Fun 2/10, Health 4/10. Check a goal or habit addresses at least the lowest.",
    ]);
    expect(out.find((c) => c.text === "Week 1 has at least one goal")?.ok).toBe(true);
  });

  it("matches starts on exact text or 2 shared long words", () => {
    expect(startIsUsed("Get fit", ["get fit"])).toBe(true);
    expect(startIsUsed("Build a sales pipeline", ["Pipeline outreach for sales"])).toBe(true);
    expect(startIsUsed("Build a sales pipeline", ["Pipeline review"])).toBe(false);
    expect(startIsUsed("Swimming", ["Swimming twice a week"])).toBe(true); // only one long word
  });
});
