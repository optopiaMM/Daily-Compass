// One-off: import a Yearwise prototype JSON export into a new draft yearwise_sessions row.
// Usage: npx tsx script/import-yearwise-prototype.ts <export.json> [--dry-run]
// Refuses to write anywhere but the dev Neon branch (ep-winter-leaf).
import "dotenv/config";
import { readFileSync } from "fs";
import { FREQ, TRACKS, PILLARS, iso, planStart, setP, type Answers } from "@shared/yearwise";

const [file, flag] = process.argv.slice(2);
if (!file) throw new Error("Usage: tsx script/import-yearwise-prototype.ts <export.json> [--dry-run]");
const dryRun = flag === "--dry-run";
const x = JSON.parse(readFileSync(file, "utf-8"));

const AREA_KEYS: Record<string, string> = {
  "Health": "health", "Work": "work", "Money": "money", "Love life": "love", "Friendships": "friends",
  "Happiness": "happiness", "Fun": "fun", "Spirituality": "spirit", "Meaning & purpose": "meaning", "Self-love": "selflove",
};

// The prototype wrote "Personal Development and Learning"; Daily Compass stores "&".
const pillar = (p: string) => {
  const v = (p || "").replace(/ and Learning$/, " & Learning");
  if (v && !(PILLARS as readonly string[]).includes(v)) console.warn(`  ! unknown pillar "${p}", kept as-is`);
  return v;
};
const freqKey = (label: string) => {
  const f = FREQ.find((f) => f.label === label);
  if (label && !f) console.warn(`  ! unknown frequency "${label}", left blank`);
  return f ? f.key : "";
};
const str = (v: unknown) => (v == null ? "" : String(v));

let a: Answers = {};
const put = (p: string, v: unknown) => {
  if (str(v).trim() !== "") a = setP(a, p, v);
};
// A known BD track, or "other" plus free text in <path>Other.
const putTrack = (p: string, t: string) => {
  if (!t) return;
  if ((TRACKS as readonly string[]).includes(t)) put(p, t);
  else { put(p, "other"); put(p + "Other", t); }
};

// Before you start
put("planStart", x.plan.start_date);

// Life check-in
for (const s of x.life_scores ?? []) {
  const k = AREA_KEYS[s.area];
  if (!k) { console.warn(`  ! unknown life area "${s.area}", skipped`); continue; }
  if (s.score) put(`life.${k}.score`, Number(s.score));
  put(`life.${k}.why`, s.why);
  put(`life.${k}.plus2`, s.plus_two);
}

// Reflection. The export lists high lessons then low lessons with blanks dropped,
// so with 6 entries the first 3 are highs and the last 3 lows.
const r = x.reflection ?? {};
put("highThreads", r.highs_common_thread);
put("lowNeed", r.needed_in_lows);
(r.best_year_top_three ?? []).forEach((t: string, i: number) => put(`bestThree.${i}`, t));
const lessons: string[] = r.lessons ?? [];
if (lessons.length !== 6) console.warn(`  ! ${lessons.length} lessons (expected 6); high/low split is a guess`);
lessons.slice(0, 3).forEach((t, i) => put(`lessonsHigh.${i}.learned`, t));
lessons.slice(3, 6).forEach((t, i) => put(`lessonsLow.${i}.learned`, t));

// Stop / Continue / Start
(x.stops ?? []).forEach((s: any, i: number) => { put(`stop.${i}.what`, s.stop); put(`stop.${i}.instead`, s.instead); });
(x.continues ?? []).forEach((c: any, i: number) => { put(`cont.${i}.what`, c.continue); put(`cont.${i}.keep`, c.keep_going); });
(x.starts ?? []).forEach((s: any, i: number) => {
  put(`start.${i}.what`, s.start);
  put(`start.${i}.pillar`, pillar(s.pillar));
  put(`start.${i}.motive`, s.motive);
  put(`start.${i}.dest`, s.goes_to);
});

// Annual target
const at = x.annual_target ?? {};
for (const f of ["title", "outcome", "measure", "motive", "needs"]) put(`annual.${f}`, at[f]);
put("annual.pillar", pillar(at.pillar));

// 90-day goals; parents elsewhere are resolved to g0–g2 by title.
const refByTitle: Record<string, string> = {};
(x.ninety_day_goals ?? []).slice(0, 3).forEach((g: any, i: number) => {
  const p = `ninety.${i}`;
  refByTitle[g.title] = "g" + i;
  put(p + ".title", g.title);
  put(p + ".pillar", pillar(g.pillar));
  putTrack(p + ".track", str(g.track));
  put(p + ".annual", g.moves_annual_target ? "yes" : "no");
  put(p + ".done", g.definition_of_done);
  put(p + ".outcome", g.woop?.outcome);
  put(p + ".obstacle", g.woop?.obstacle);
  (g.woop?.if_then_plans ?? []).slice(0, 3).forEach((it: any, j: number) => {
    put(`${p}.if${j + 1}`, it.if);
    put(`${p}.then${j + 1}`, it.then);
  });
});
const parentRef = (title: string) => {
  if (title && !refByTitle[title]) console.warn(`  ! parent "${title}" matches no 90-day goal, left blank`);
  return refByTitle[title] ?? "";
};

// Habits
const habits: any[] = x.habits ?? [];
if (habits.length > 3) put("habits.n", habits.length);
habits.forEach((h, i) => {
  const p = `habits.${i}`;
  put(p + ".what", h.habit);
  put(p + ".cue", h.cue);
  put(p + ".freq", freqKey(h.frequency));
  put(p + ".pillar", pillar(h.pillar));
  if (h.minutes_each) put(p + ".mins", String(h.minutes_each));
  put(p + ".parent", parentRef(h.parent_90day_goal));
});

// First two weeks: planned rows only (habit and review rows are generated, not entered).
const w1 = x.plan.start_date;
const w2 = iso(new Date(new Date(w1 + "T12:00:00").getTime() + 7 * 864e5));
const planned = (x.weekly_goals ?? []).filter(
  (r: any) => !String(r.goal_title).startsWith("Habit: ") && r.goal_title !== "Weekly review and progress scores",
);
const addedHabitRows = (x.weekly_goals ?? []).some((r: any) => String(r.goal_title).startsWith("Habit: "));
for (const [w, date, def] of [["w1", w1, 3], ["w2", w2, 2]] as const) {
  const rows = planned.filter((r: any) => r.week_start_date === date);
  if (rows.length > def) put(`weeks.${w}.n`, rows.length);
  rows.forEach((row: any, i: number) => {
    const p = `weeks.${w}.${i}`;
    put(p + ".title", row.goal_title);
    put(p + ".desc", row.goal_description);
    put(p + ".pillar", pillar(row.pillar));
    putTrack(p + ".track", str(row.track));
    put(p + ".priority", str(row.priority));
    put(p + ".mins", str(row.time_estimate_mins));
    put(p + ".parent", parentRef(row.parent_90day_goal));
    put(p + ".notes", row.notes);
  });
}
const otherWeeks = planned.filter((r: any) => r.week_start_date !== w1 && r.week_start_date !== w2);
if (otherWeeks.length) console.warn(`  ! ${otherWeeks.length} weekly rows outside weeks 1–2 skipped`);
if (!addedHabitRows && habits.length) put("addHabits", "no");

// Review & support
put("review.day", x.review?.day);
put("review.time", x.review?.time);
if (x.review?.minutes) put("review.mins", String(x.review.minutes));
put("tell.who", x.accountability?.who);
put("tell.ask", x.accountability?.ask);
put("tell.freq", x.accountability?.update);
put("firstStep", x.first_step);

const start = iso(planStart(a));
console.log(`plan_start ${start} · ${Object.keys(a).length} top-level answer keys`);

if (dryRun) {
  console.log(JSON.stringify(a, null, 2));
} else {
  const host = new URL(process.env.DATABASE_URL ?? "").hostname;
  if (!host.startsWith("ep-winter-leaf")) throw new Error(`Refusing to write: DATABASE_URL host is ${host}, not the dev branch`);
  const { storage } = await import("../server/storage");
  const { pool } = await import("../server/db");
  const row = await storage.createYearwiseSession({ kind: "annual", status: "draft", planStart: start, answers: a });
  console.log(`Created yearwise_sessions id ${row.id} on ${host}`);
  await pool.end();
}
