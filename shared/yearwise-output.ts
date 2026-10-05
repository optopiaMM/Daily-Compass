// Yearwise Output step (spec §3.15, §4.2, §4.6, §4.7): readiness checks, the
// generated weekly-goal rows and the CSV / JSON / Markdown exports. Shared by the
// wizard (preview and downloads) and the server (commit), so what you preview is
// exactly what gets written.
import {
  type Answers, type PlanDates, AREAS, DEST, MONTHF, WEAK_IF, WEAK_THEN,
  V, count, deriveDates, fmt, freqOption, habitWeeklyMins, iso, legacyPillarScores, parentTitle,
} from "./yearwise";

export const CSV_COLS = [
  "week_start_date", "pillar", "track", "goal_title", "goal_description",
  "priority", "time_estimate_mins", "parent_90day_goal", "status", "notes",
] as const;

export type CsvCol = (typeof CSV_COLS)[number];

export const REVIEW_TITLE = "Weekly review and progress scores";
export const REVIEW_PILLAR = "Personal Development & Learning";
export const HABIT_PREFIX = "Habit: ";

const three = [0, 1, 2];
const WEEKS = [["w1", 3], ["w2", 2]] as const;

// A known track, or the free text typed after choosing "Other…".
export const trackVal = (a: Answers, p: string) => (V(a, p) === "other" ? V(a, p + "Other") : V(a, p));

/* ================= 90-day goals and habits ================= */

export interface NinetyItem {
  key: string; // "g0"–"g2"
  title: string;
  pillar: string;
  track: string;
  moves_annual_target: boolean;
  start_date: string;
  end_date: string;
  definition_of_done: string;
  woop: { outcome: string; obstacle: string; if_then_plans: { if: string; then: string; sort: number }[] };
}

export function ninetyList(a: Answers, d: PlanDates = deriveDates(a)): NinetyItem[] {
  return three.flatMap((i) => {
    const p = `ninety.${i}`;
    if (!V(a, p + ".title")) return [];
    const plans = [1, 2, 3]
      .filter((k) => V(a, `${p}.if${k}`) && V(a, `${p}.then${k}`))
      .map((k) => ({ if: V(a, `${p}.if${k}`), then: V(a, `${p}.then${k}`), sort: k }));
    return [{
      key: "g" + i,
      title: V(a, p + ".title"),
      pillar: V(a, p + ".pillar"),
      track: trackVal(a, p + ".track"),
      moves_annual_target: V(a, p + ".annual") === "yes",
      start_date: iso(d.start),
      end_date: iso(d.q),
      definition_of_done: V(a, p + ".done"),
      woop: { outcome: V(a, p + ".outcome"), obstacle: V(a, p + ".obstacle"), if_then_plans: plans },
    }];
  });
}

export interface HabitItem {
  key: string; // "h0", "h1", …
  habit: string;
  cue: string;
  freqKey: string;
  frequency: string; // the option's label
  minutes_each: number | null;
  pillar: string;
  parentRef: string; // "g0"–"g2" or ""
  parent_90day_goal: string; // resolved title
}

export function habitList(a: Answers): HabitItem[] {
  const out: HabitItem[] = [];
  for (let i = 0; i < count(a, "habits", 3); i++) {
    const p = `habits.${i}`;
    if (!V(a, p + ".what")) continue;
    const f = freqOption(V(a, p + ".freq"));
    out.push({
      key: "h" + i,
      habit: V(a, p + ".what"),
      cue: V(a, p + ".cue"),
      freqKey: V(a, p + ".freq"),
      frequency: f ? f.label : "",
      minutes_each: Number(V(a, p + ".mins")) || null,
      pillar: V(a, p + ".pillar"),
      parentRef: V(a, p + ".parent"),
      parent_90day_goal: parentTitle(a, V(a, p + ".parent")),
    });
  }
  return out;
}

/* ================= weekly-goal rows (§4.6) ================= */

export interface WeeklyRow extends Record<CsvCol, string> {
  key: string; // "w1.plan.0", "w1.habit.2", "w2.review"
  source: "yearwise" | "habit" | "review";
  parentRef: string; // "g0"–"g2" or ""
  habitKey: string; // "h0"… for habit rows, else ""
}

export function weeklyRows(a: Answers, d: PlanDates = deriveDates(a)): WeeklyRow[] {
  const rows: WeeklyRow[] = [];
  const wantHabits = V(a, "addHabits") !== "no";
  const habits = habitList(a);
  for (const [w, def] of WEEKS) {
    const ws = iso(w === "w1" ? d.w1 : d.w2);
    for (let i = 0; i < count(a, "weeks." + w, def); i++) {
      const p = `weeks.${w}.${i}`;
      if (!V(a, p + ".title")) continue;
      rows.push({
        key: `${w}.plan.${i}`, source: "yearwise", parentRef: V(a, p + ".parent"), habitKey: "",
        week_start_date: ws,
        pillar: V(a, p + ".pillar"),
        track: trackVal(a, p + ".track"),
        goal_title: V(a, p + ".title"),
        goal_description: V(a, p + ".desc"),
        priority: V(a, p + ".priority") || "2",
        time_estimate_mins: V(a, p + ".mins"),
        parent_90day_goal: parentTitle(a, V(a, p + ".parent")),
        status: "not_started",
        notes: V(a, p + ".notes"),
      });
    }
    if (wantHabits) {
      for (const h of habits) {
        const f = freqOption(h.freqKey);
        const t = habitWeeklyMins(h.minutes_each ?? 0, h.freqKey);
        rows.push({
          key: `${w}.habit.${h.key.slice(1)}`, source: "habit", parentRef: h.parentRef, habitKey: h.key,
          week_start_date: ws,
          pillar: h.pillar,
          track: "",
          goal_title: HABIT_PREFIX + h.habit,
          goal_description: [h.cue, f ? f.short : ""].filter(Boolean).join(" · "),
          priority: "2",
          time_estimate_mins: t ? String(t) : "",
          parent_90day_goal: h.parent_90day_goal,
          status: "not_started",
          notes: "Recurring habit" + (f ? ` (${f.short})` : ""),
        });
      }
    }
    if (V(a, "review.day")) {
      rows.push({
        key: `${w}.review`, source: "review", parentRef: "", habitKey: "",
        week_start_date: ws,
        pillar: REVIEW_PILLAR,
        track: "",
        goal_title: REVIEW_TITLE,
        goal_description: `${V(a, "review.day")}${V(a, "review.time") ? " " + V(a, "review.time") : ""}: done / slipped / why; score each 90-day goal 1–10; set next week`,
        priority: "1",
        time_estimate_mins: V(a, "review.mins") || "20",
        parent_90day_goal: "",
        status: "not_started",
        notes: "Keeps the cascade honest",
      });
    }
  }
  return rows;
}

// Planned minutes and hours (1 dp) per week, in week order.
export function plannedByWeek(rows: WeeklyRow[]): { week: string; mins: number; hours: number }[] {
  const by = new Map<string, number>();
  for (const r of rows) by.set(r.week_start_date, (by.get(r.week_start_date) ?? 0) + (Number(r.time_estimate_mins) || 0));
  return Array.from(by, ([week, mins]) => ({ week, mins, hours: Math.round((mins / 60) * 10) / 10 }));
}

/* ================= readiness checks (§4.2) ================= */

export interface Check {
  ok: boolean;
  text: string;
}

const longWords = (s: string) => Array.from(new Set(s.toLowerCase().split(/\W+/).filter((w) => w.length > 3)));

// A start counts as used when some goal, habit or weekly-goal title matches it
// exactly, or shares at least 2 words longer than 3 letters (or all of them, when
// the start has fewer than 2 such words).
export function startIsUsed(start: string, titles: string[]): boolean {
  const t = start.trim().toLowerCase();
  const k = longWords(t);
  return titles.some((title) => {
    const x = title.trim().toLowerCase();
    if (x === t) return true;
    if (!k.length) return false;
    const words = new Set(longWords(x));
    return k.filter((w) => words.has(w)).length >= Math.min(2, k.length);
  });
}

export function readinessChecks(a: Answers, d: PlanDates = deriveDates(a)): Check[] {
  const c: Check[] = [];
  const ok = (b: unknown, text: string) => c.push({ ok: !!b, text });
  const warn = (text: string) => c.push({ ok: false, text });
  const nl = ninetyList(a, d);
  const habits = habitList(a);
  const rows = weeklyRows(a, d);

  // 1. Annual target
  ok(V(a, "annual.title") && V(a, "annual.measure"), "Annual target has a title and a measure");
  if (V(a, "annual.measure") && !/\d/.test(V(a, "annual.measure"))) warn("The annual target's measure has no number in it");

  // 2–3. 90-day goals
  ok(nl.length >= 1, "At least one 90-day goal");
  ok(nl.some((g) => g.moves_annual_target), "At least one 90-day goal moves the annual target");
  ok(nl.length && nl.every((g) => g.pillar), "Every 90-day goal has a pillar");
  ok(nl.length && nl.every((g) => g.woop.if_then_plans.length), "Every 90-day goal has a complete if–then plan");

  // 4. 'done' needs a number
  nl.forEach((g) => {
    if (!/\d/.test(g.definition_of_done)) warn(`"${g.title}": 'done' has no number, so it's hard to tell when you're there`);
  });

  // 5. Weak if–then plans (§4.3)
  three.forEach((i) => {
    const t = V(a, `ninety.${i}.title`);
    if (!t) return;
    const weak = [1, 2, 3].filter((k) => {
      const x = V(a, `ninety.${i}.if${k}`);
      const y = V(a, `ninety.${i}.then${k}`);
      return (x && WEAK_IF.test(x)) || (y && WEAK_THEN.test(y));
    }).length;
    if (weak) warn(`"${t}": ${weak} if–then plan${weak > 1 ? "s read" : " reads"} as a wish rather than a moment and an action`);
  });

  // 6. Stops
  ok(three.filter((i) => V(a, `stop.${i}.what`)).every((i) => V(a, `stop.${i}.instead`)), "Every stop has an 'instead'");

  // 7. Starts that aren't used anywhere
  const titles = [V(a, "annual.title"), ...nl.map((g) => g.title), ...habits.map((h) => h.habit), ...rows.map((r) => r.goal_title.replace(/^Habit: /, ""))].filter(Boolean);
  three.forEach((i) => {
    const t = V(a, `start.${i}.what`);
    if (!t || V(a, `start.${i}.dest`) === "later") return;
    if (!startIsUsed(t, titles)) warn(`Start "${t}" isn't in any goal, habit or weekly goal yet`);
  });

  // 8. Week 1, and weekly goals missing a pillar or time estimate
  const planned = rows.filter((r) => r.source === "yearwise");
  ok(planned.some((r) => r.key.startsWith("w1.")), "Week 1 has at least one goal");
  const missing = planned.filter((r) => !(r.pillar && r.time_estimate_mins));
  ok(planned.length && !missing.length, missing.length
    ? `Missing a pillar or time estimate: ${missing.map((r) => r.goal_title).join(", ")}`
    : "Every weekly goal has a pillar and a time estimate");

  // 9. Review day
  ok(V(a, "review.day"), "Weekly review day is set");

  // 10. Mostly "should"
  const should = three.filter((i) => V(a, `start.${i}.what`) && V(a, `start.${i}.motive`) === "should").length
    + (V(a, "annual.motive") === "should" ? 1 : 0);
  if (should) warn(`${should} goal${should > 1 ? "s are" : " is"} mostly "should", so check you want ${should > 1 ? "them" : "it"}`);

  // 11. Low-scoring life areas, lowest first
  const low = AREAS.map(([k, n]) => [n, Number(V(a, `life.${k}.score`))] as const)
    .filter((x) => x[1] && x[1] <= 5)
    .sort((x, y) => x[1] - y[1]);
  if (low.length) warn(`Low-scoring areas: ${low.map((x) => `${x[0]} ${x[1]}/10`).join(", ")}. Check a goal or habit addresses at least the lowest.`);

  return c;
}

/* ================= exports ================= */

export function csvCell(v: unknown) {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

export function buildCSV(a: Answers, d: PlanDates = deriveDates(a)) {
  const lines = [CSV_COLS.join(",")].concat(weeklyRows(a, d).map((r) => CSV_COLS.map((c) => csvCell(r[c])).join(",")));
  return lines.join("\r\n") + "\r\n";
}

const csvRowObject = (r: WeeklyRow) => Object.fromEntries(CSV_COLS.map((c) => [c, r[c]]));

export function buildJSON(a: Answers, d: PlanDates = deriveDates(a), now: Date = new Date()) {
  return JSON.stringify({
    generated: now.toISOString(),
    source: "Yearwise",
    plan: { start_date: iso(d.start), ninety_day_end: iso(d.q), year_end: iso(d.yearEnd) },
    life_scores: AREAS.map(([k, n]) => ({ area: n, score: Number(V(a, `life.${k}.score`)) || null, why: V(a, `life.${k}.why`), plus_two: V(a, `life.${k}.plus2`) })),
    reflection: {
      highs_common_thread: V(a, "highThreads"),
      needed_in_lows: V(a, "lowNeed"),
      best_year_top_three: three.map((i) => V(a, `bestThree.${i}`)).filter(Boolean),
      lessons: three.map((i) => V(a, `lessonsHigh.${i}.learned`)).concat(three.map((i) => V(a, `lessonsLow.${i}.learned`))).filter(Boolean),
    },
    starts: three.filter((i) => V(a, `start.${i}.what`)).map((i) => ({
      start: V(a, `start.${i}.what`), pillar: V(a, `start.${i}.pillar`), motive: V(a, `start.${i}.motive`), goes_to: V(a, `start.${i}.dest`),
    })),
    annual_target: {
      title: V(a, "annual.title"), outcome: V(a, "annual.outcome"), measure: V(a, "annual.measure"),
      pillar: V(a, "annual.pillar"), motive: V(a, "annual.motive"), needs: V(a, "annual.needs"), due: iso(d.yearEnd),
    },
    ninety_day_goals: ninetyList(a, d).map((g) => ({
      title: g.title, pillar: g.pillar, track: g.track, moves_annual_target: g.moves_annual_target,
      start_date: g.start_date, end_date: g.end_date, definition_of_done: g.definition_of_done,
      woop: { outcome: g.woop.outcome, obstacle: g.woop.obstacle, if_then_plans: g.woop.if_then_plans.map((x) => ({ if: x.if, then: x.then })) },
    })),
    habits: habitList(a).map((h) => ({
      habit: h.habit, cue: h.cue, frequency: h.frequency, minutes_each: h.minutes_each, pillar: h.pillar, parent_90day_goal: h.parent_90day_goal,
    })),
    stops: three.filter((i) => V(a, `stop.${i}.what`)).map((i) => ({ stop: V(a, `stop.${i}.what`), instead: V(a, `stop.${i}.instead`) })),
    continues: three.filter((i) => V(a, `cont.${i}.what`)).map((i) => ({ continue: V(a, `cont.${i}.what`), keep_going: V(a, `cont.${i}.keep`) })),
    review: { day: V(a, "review.day"), time: V(a, "review.time"), minutes: Number(V(a, "review.mins")) || 20 },
    accountability: { who: V(a, "tell.who"), ask: V(a, "tell.ask"), update: V(a, "tell.freq") },
    first_step: V(a, "firstStep"),
    weekly_goals: weeklyRows(a, d).map(csvRowObject),
  }, null, 2);
}

const oneLine = (s: string) => s.replace(/\n/g, " ");

export function buildMD(a: Answers, d: PlanDates = deriveDates(a)) {
  const L: string[] = [];
  const line = (s = "") => L.push(s);

  line(`# Yearwise plan · ${fmt(d.start)} to ${fmt(d.yearEnd)}`);
  line();
  line(`Looking back: ${d.revFrom} – ${d.revTo}`);
  line();

  line("## Life check-in");
  line("| Area | Score | Why | +2 looks like |");
  line("|---|---|---|---|");
  AREAS.forEach(([k, n]) => line(`| ${n} | ${V(a, `life.${k}.score`) || "–"} | ${oneLine(V(a, `life.${k}.why`))} | ${oneLine(V(a, `life.${k}.plus2`))} |`));
  line();
  const legacy = legacyPillarScores(a);
  if (legacy.length) {
    line("Earlier 6 P's scores: " + legacy.map(([n, s]) => `${n} ${s}`).join(", "));
    line();
  }

  const lessons = three.map((i) => V(a, `lessonsHigh.${i}.learned`)).concat(three.map((i) => V(a, `lessonsLow.${i}.learned`))).filter(Boolean);
  if (lessons.length) {
    line("## Lessons");
    lessons.forEach((x) => line("- " + oneLine(x)));
    line();
  }

  const best = three.map((i) => V(a, `bestThree.${i}`)).filter(Boolean);
  if (best.length || V(a, "highThreads") || V(a, "lowNeed")) {
    line("## What matters");
    if (V(a, "highThreads")) line("- Best moments had in common: " + oneLine(V(a, "highThreads")));
    if (V(a, "lowNeed")) line("- Needed in the lows: " + oneLine(V(a, "lowNeed")));
    best.forEach((x) => line("- Best year: " + x));
    line();
  }

  const starts = three.filter((i) => V(a, `start.${i}.what`));
  if (starts.length) {
    line("## Starts");
    starts.forEach((i) => {
      const dest = DEST.find((x) => x[0] === V(a, `start.${i}.dest`));
      line(`- ${V(a, `start.${i}.what`)}${dest ? " → " + dest[1] : ""}`);
    });
    line();
  }

  line("## Annual target");
  line(`**${V(a, "annual.title") || "(not set)"}**` + (V(a, "annual.pillar") ? ` · ${V(a, "annual.pillar")}` : ""));
  line();
  if (V(a, "annual.outcome")) line(`By ${fmt(d.yearEnd)}: ${oneLine(V(a, "annual.outcome"))}`);
  if (V(a, "annual.measure")) line(`Measure: ${oneLine(V(a, "annual.measure"))}`);
  if (V(a, "annual.needs")) line(`Needs: ${oneLine(V(a, "annual.needs"))}`);
  line();

  line(`## 90-day goals (to ${fmt(d.q)})`);
  ninetyList(a, d).forEach((g, i) => {
    line(`### ${i + 1}. ${g.title}`);
    line(`${g.pillar}${g.track ? " · " + g.track : ""}${g.moves_annual_target ? " · moves annual target" : ""}`);
    if (g.definition_of_done) line(`- Done means: ${oneLine(g.definition_of_done)}`);
    if (g.woop.outcome) line(`- Outcome: ${oneLine(g.woop.outcome)}`);
    if (g.woop.obstacle) line(`- Obstacle: ${oneLine(g.woop.obstacle)}`);
    g.woop.if_then_plans.forEach((x) => line(`- If ${x.if}, then ${x.then}`));
    line();
  });

  const stops = three.filter((i) => V(a, `stop.${i}.what`));
  if (stops.length) {
    line("## Stop → instead");
    stops.forEach((i) => line(`- Stop: ${V(a, `stop.${i}.what`)} → Instead: ${V(a, `stop.${i}.instead`) || "(not set)"}`));
    line();
  }

  const conts = three.filter((i) => V(a, `cont.${i}.what`));
  if (conts.length) {
    line("## Continue");
    conts.forEach((i) => line(`- ${V(a, `cont.${i}.what`)}${V(a, `cont.${i}.keep`) ? " · " + V(a, `cont.${i}.keep`) : ""}`));
    line();
  }

  const habits = habitList(a);
  if (habits.length) {
    line("## Habits");
    habits.forEach((h) => line(`- ${h.habit} · ${h.frequency || "?"}${h.cue ? " · " + h.cue : ""}${h.minutes_each ? " · " + h.minutes_each + " min" : ""}`));
    line();
  }

  line("## Rhythm and support");
  if (V(a, "review.day")) line(`- Weekly review: ${V(a, "review.day")} ${V(a, "review.time")} (${V(a, "review.mins") || 20} min)`);
  if (V(a, "tell.who")) line(`- Telling: ${V(a, "tell.who")} · ${V(a, "tell.freq")}${V(a, "tell.ask") ? " · ask: " + oneLine(V(a, "tell.ask")) : ""}`);
  if (V(a, "firstStep")) line(`- First step: ${V(a, "firstStep")}`);
  line();

  line("## Weekly goals (Daily Compass CSV rows)");
  line("```csv");
  line(buildCSV(a, d).trim());
  line("```");
  return L.join("\n");
}

/* ================= labels for the committed records ================= */

// "September – December 2026", in the style of the seeded period labels.
export function periodLabel(from: Date, to: Date) {
  const a = MONTHF[from.getMonth()] + (from.getFullYear() !== to.getFullYear() ? " " + from.getFullYear() : "");
  return `${a} – ${MONTHF[to.getMonth()]} ${to.getFullYear()}`;
}

// "2026–27", matching the wizard header.
export const horizonLabel = (d: PlanDates) => `${d.start.getFullYear()}–${String(d.yearEnd.getFullYear()).slice(2)}`;

