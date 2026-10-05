// Yearwise: pure logic shared by the wizard UI and the server.
// Mirrors the reference prototype (yearwise.html) and the build spec §3–§4.
import { SIX_P_CATEGORIES, BD_TRACKS } from "./schema";

export type Answers = Record<string, unknown>;

/* ================= constants ================= */

// Stored pillar values are Daily Compass's own (SIX_P_CATEGORIES), which spell
// "Personal Development & Learning" with an ampersand.
export const PILLARS = SIX_P_CATEGORIES;

// The prototype's pillar names, used only to read legacy `ratings.<key>` scores.
const PROTOTYPE_PILLARS = [
  "Profit",
  "Promise",
  "Personal",
  "People",
  "Personal Development and Learning",
  "Physical Environment",
];

export const AREAS: readonly [string, string][] = [
  ["health", "Health"],
  ["work", "Work"],
  ["money", "Money"],
  ["love", "Love life"],
  ["friends", "Friendships"],
  ["happiness", "Happiness"],
  ["fun", "Fun"],
  ["spirit", "Spirituality"],
  ["meaning", "Meaning & purpose"],
  ["selflove", "Self-love"],
];

export const TRACKS = BD_TRACKS;

export interface FreqOption {
  key: string;
  label: string;
  perWeek: number;
  short: string;
}

export const FREQ: readonly FreqOption[] = [
  { key: "daily", label: "Every day", perWeek: 7, short: "every day" },
  { key: "weekdays", label: "Weekdays", perWeek: 5, short: "weekdays" },
  { key: "4pw", label: "4× a week", perWeek: 4, short: "4× a week" },
  { key: "3pw", label: "3× a week", perWeek: 3, short: "3× a week" },
  { key: "2pw", label: "2× a week", perWeek: 2, short: "2× a week" },
  { key: "weekly", label: "Once a week", perWeek: 1, short: "weekly" },
  { key: "2pm", label: "2× a month", perWeek: 0.5, short: "2× a month" },
  { key: "monthly", label: "Once a month", perWeek: 0.25, short: "monthly" },
  { key: "asneeded", label: "When needed (a replacement, not scheduled)", perWeek: 0, short: "when needed, unscheduled" },
  { key: "rule", label: "A rule for every day (no time block)", perWeek: 0, short: "daily rule, no time block" },
];

export const DEST: readonly [string, string][] = [
  ["annual", "Annual target"],
  ["ninety", "A 90-day goal"],
  ["habit", "A habit"],
  ["week", "A weekly goal"],
  ["later", "Not this year"],
];

export const MOTIVES: readonly [string, string][] = [
  ["want", "I want to / it matters to me"],
  ["mixed", "A bit of both"],
  ["should", "I feel I should / others expect it"],
];

export const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

const MONTHN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const MONTHF = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/* ================= answer access ================= */

export const filled = (v: unknown) => v !== undefined && v !== null && String(v).trim() !== "";

export function getP(o: unknown, p: string): unknown {
  return p.split(".").reduce<unknown>((a, k) => (a == null ? undefined : (a as Record<string, unknown>)[k]), o);
}

// Immutable set: copies each object along the path.
export function setP(o: Answers, p: string, v: unknown): Answers {
  const [k, ...rest] = p.split(".");
  const next = { ...o };
  if (!rest.length) {
    next[k] = v;
  } else {
    const child = next[k];
    next[k] = setP(typeof child === "object" && child !== null ? (child as Answers) : {}, rest.join("."), v);
  }
  return next;
}

// Trimmed string value, or "" when blank.
export const V = (a: Answers, p: string) => {
  const v = getP(a, p);
  return filled(v) ? String(v).trim() : "";
};

// Number of dynamic rows at a path (stored as `<path>.n`).
export function count(a: Answers, p: string, def: number) {
  const n = Number(getP(a, p + ".n"));
  return n > 0 ? n : def;
}

/* ================= dates (§4.1) ================= */

export function iso(d: Date) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

export function parseISO(s: string | undefined | null) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

export function addDays(d: Date, n: number) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function fmt(d: Date) {
  return d.getDate() + " " + MONTHN[d.getMonth()] + " " + d.getFullYear();
}

// The coming Monday, or today if today is a Monday.
export function nextMonday(today: Date = new Date()) {
  const d = new Date(today);
  d.setHours(0, 0, 0, 0);
  const add = (8 - d.getDay()) % 7;
  d.setDate(d.getDate() + add);
  return d;
}

// planStart snapped back to that week's Monday; next Monday when blank.
export function planStart(a: Answers, today: Date = new Date()) {
  const d = parseISO(V(a, "planStart"));
  if (!d) return nextMonday(today);
  const w = d.getDay();
  if (w !== 1) d.setDate(d.getDate() - ((w + 6) % 7));
  return d;
}

export interface ReviewMonth {
  key: string;
  label: string;
}

// The 12 calendar months ending with the start month.
export function reviewMonths(start: Date): ReviewMonth[] {
  const out: ReviewMonth[] = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(start.getFullYear(), start.getMonth() - i, 1);
    out.push({ key: d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"), label: MONTHF[d.getMonth()] + " " + d.getFullYear() });
  }
  return out;
}

export interface PlanDates {
  start: Date;
  w1: Date;
  w2: Date;
  q: Date;
  yearEnd: Date;
  months: ReviewMonth[];
  revFrom: string;
  revTo: string;
  endLabel: string;
}

export function deriveDates(a: Answers, today: Date = new Date()): PlanDates {
  const s = planStart(a, today);
  const months = reviewMonths(s);
  const yearEnd = new Date(s.getFullYear() + 1, s.getMonth(), s.getDate() - 1);
  // The month before the start month, a year on (e.g. start Oct 2026 → September 2027).
  const endMonth = new Date(s.getFullYear() + 1, s.getMonth() - 1, 1);
  return {
    start: s,
    w1: s,
    w2: addDays(s, 7),
    q: addDays(s, 90),
    yearEnd,
    months,
    revFrom: months[0].label,
    revTo: months[11].label,
    endLabel: MONTHF[endMonth.getMonth()] + " " + endMonth.getFullYear(),
  };
}

/* ================= habits: frequency time maths (§3.12) ================= */

export const freqOption = (key: string) => FREQ.find((f) => f.key === key);

// Planned minutes per week for a habit; null when it takes no scheduled time.
export function habitWeeklyMins(mins: number | string, freqKey: string): number | null {
  const f = freqOption(freqKey);
  const times = f ? f.perWeek : 1;
  const t = Math.round((Number(mins) || 0) * times);
  return t || null;
}

/* ================= if–then quality check (§4.3) ================= */

export const WEAK_IF = /^\s*(i\s+(want|need|would like|wish|should)|i'?d like)\b/i;
export const WEAK_THEN = /^\s*i\s+(need|have|should|must|ought)\s+to\b|^\s*i\s+(need|should|must)\b|^\s*(i am|i'm|it will|it'll|that will|that's)\b/i;

export const IF_MSG = {
  weakIf: "The 'if' is a wish, not a moment. Name when the obstacle shows up: a time, a place, a feeling or a thought.",
  weakThen: "The 'then' is an intention or a consequence, not an action. Name one thing you'll physically do right then.",
  missingThen: "Add the 'then': one specific action.",
};

export function ifThenIssue(ifText: string, thenText: string): string {
  const a = ifText.trim();
  const b = thenText.trim();
  if (!a && !b) return "";
  if (a && WEAK_IF.test(a)) return IF_MSG.weakIf;
  if (b && WEAK_THEN.test(b)) return IF_MSG.weakThen;
  if (a && !b) return IF_MSG.missingThen;
  return "";
}

export const ifIssue = (a: Answers, p: string, k: number) => ifThenIssue(V(a, `${p}.if${k}`), V(a, `${p}.then${k}`));

/* ================= 90-day goal references (§4.5) ================= */

export const NINETY_IDX = [0, 1, 2] as const;

// Parent options: [ref, title] for each 90-day goal with a title.
export function ninetyOpts(a: Answers): [string, string][] {
  return NINETY_IDX.filter((i) => V(a, `ninety.${i}.title`)).map((i) => ["g" + i, V(a, `ninety.${i}.title`)]);
}

export function parentTitle(a: Answers, v: string) {
  const m = /^g([0-2])$/.exec(v || "");
  return m ? V(a, `ninety.${m[1]}.title`) : v || "";
}

// Legacy parents stored as a title become the matching goal's ref.
export function migrateParents(a: Answers): Answers {
  const map: Record<string, string> = {};
  NINETY_IDX.forEach((i) => {
    const t = V(a, `ninety.${i}.title`);
    if (t) map[t] = "g" + i;
  });
  let out = a;
  const fix = (p: string) => {
    const v = V(out, p);
    if (v && map[v]) out = setP(out, p, map[v]);
  };
  for (let i = 0; i < count(a, "habits", 3); i++) fix(`habits.${i}.parent`);
  (["w1", "w2"] as const).forEach((w) => {
    for (let i = 0; i < count(a, "weeks." + w, 3); i++) fix(`weeks.${w}.${i}.parent`);
  });
  return out;
}

/* ================= chip sources (§3.4, §3.10–3.12) ================= */

export type ChipSource = "highs" | "lows" | "starts" | "habitsrc" | "annualsrc" | "ninetysrc";

const uniq = (xs: string[]) => Array.from(new Set(xs.filter(Boolean)));
const three = [0, 1, 2];

export function chipItems(a: Answers, k: ChipSource): string[] {
  if (k === "highs" || k === "lows") return [0, 1, 2, 3, 4].map((i) => V(a, `${k}.${i}`)).filter(Boolean);
  if (k === "starts") return three.map((i) => V(a, `start.${i}.what`)).filter(Boolean);
  if (k === "habitsrc")
    return uniq(
      three.map((i) => V(a, `stop.${i}.instead`))
        .concat(three.map((i) => V(a, `cont.${i}.what`)))
        .concat(three.filter((i) => ["habit", ""].includes(V(a, `start.${i}.dest`))).map((i) => V(a, `start.${i}.what`))),
    );
  if (k === "annualsrc") return uniq(three.map((i) => V(a, `start.${i}.what`)).concat(three.map((i) => V(a, `bestThree.${i}`))));
  if (k === "ninetysrc")
    return uniq(
      three.filter((i) => ["ninety", ""].includes(V(a, `start.${i}.dest`))).map((i) => V(a, `start.${i}.what`))
        .concat(three.map((i) => V(a, `bestThree.${i}`))),
    );
  return [];
}

/* ================= reflection panel (§4.4) ================= */

export interface Reflection {
  low: { name: string; score: number; plus2: string }[];
  best: string[];
  highThreads: string;
  lowNeed: string;
  starts: string[];
}

// null when there's nothing to show (starts alone don't open the panel).
export function reflection(a: Answers): Reflection | null {
  const low = AREAS.map(([k, name]) => ({ name, score: Number(V(a, `life.${k}.score`)), plus2: V(a, `life.${k}.plus2`) }))
    .filter((x) => x.score && x.score <= 5)
    .sort((x, y) => x.score - y.score);
  const best = three.map((i) => V(a, `bestThree.${i}`)).filter(Boolean);
  const starts = three.map((i) => V(a, `start.${i}.what`)).filter(Boolean);
  const highThreads = V(a, "highThreads");
  const lowNeed = V(a, "lowNeed");
  if (!low.length && !best.length && !highThreads && !lowNeed) return null;
  return { low, best, highThreads, lowNeed, starts };
}

// Earlier 6 P's scores saved by an older version of the prototype.
export function legacyPillarScores(a: Answers): [string, string][] {
  const pkey = (p: string) => p.toLowerCase().replace(/[^a-z]+/g, "_");
  return PROTOTYPE_PILLARS.map((n): [string, string] => [n, V(a, `ratings.${pkey(n)}.score`)]).filter((x) => x[1]);
}

/* ================= steps and progress ================= */

export type StepId =
  | "welcome" | "months" | "lows" | "highs" | "lessons" | "checkin"
  | "future" | "stop" | "cont" | "start"
  | "annual" | "ninety" | "habits" | "weeks" | "rhythm" | "output";

export interface StepMeta {
  id: StepId;
  group: string;
  nav: string;
}

export const STEPS: readonly StepMeta[] = [
  { id: "welcome", group: "Begin", nav: "Before you start" },
  { id: "months", group: "Part 1 · Look back", nav: "Month by month" },
  { id: "lows", group: "Part 1 · Look back", nav: "Low points" },
  { id: "highs", group: "Part 1 · Look back", nav: "High points" },
  { id: "lessons", group: "Part 1 · Look back", nav: "Lessons" },
  { id: "checkin", group: "Part 1 · Look back", nav: "Life check-in" },
  { id: "future", group: "Part 2 · Choose direction", nav: "Best possible year" },
  { id: "stop", group: "Part 2 · Choose direction", nav: "Stop" },
  { id: "cont", group: "Part 2 · Choose direction", nav: "Continue" },
  { id: "start", group: "Part 2 · Choose direction", nav: "Start" },
  { id: "annual", group: "Part 3 · Commit", nav: "Annual target" },
  { id: "ninety", group: "Part 3 · Commit", nav: "90-day goals" },
  { id: "habits", group: "Part 3 · Commit", nav: "Habits" },
  { id: "weeks", group: "Part 3 · Commit", nav: "First two weeks" },
  { id: "rhythm", group: "Part 3 · Commit", nav: "Review & support" },
  { id: "output", group: "Output", nav: "Export to Daily Compass" },
];

export const GROUP_TIMES: Record<string, string> = {
  "Part 1 · Look back": "~45 min",
  "Part 2 · Choose direction": "~30 min",
  "Part 3 · Commit": "~45 min",
};

export const isStepId = (s: string): s is StepId => STEPS.some((x) => x.id === s);

// Required fields per step (the first card of each repeating group; the rest are optional).
export function requiredPaths(id: StepId): string[] {
  switch (id) {
    case "welcome": return ["planStart"];
    case "lows": return ["lows.0", "lows.1", "lows.2", "lowNeed"];
    case "highs": return ["highs.0", "highs.1", "highs.2", "highThreads"];
    case "lessons":
      return three.flatMap((i) => [`lessonsHigh.${i}.point`, `lessonsHigh.${i}.learned`])
        .concat(three.flatMap((i) => [`lessonsLow.${i}.point`, `lessonsLow.${i}.learned`]));
    case "checkin": return AREAS.flatMap(([k]) => [`life.${k}.score`, `life.${k}.why`]);
    case "future": return ["bestSelf", "bestThree.0", "bestThree.1", "bestThree.2"];
    case "stop": return ["stop.0.what", "stop.0.why", "stop.0.cost", "stop.0.instead"];
    case "cont": return ["cont.0.what", "cont.0.proof", "cont.0.keep"];
    case "start": return ["what", "why", "adds", "pillar", "motive", "dest"].map((f) => `start.0.${f}`);
    case "annual": return ["title", "outcome", "measure", "pillar", "motive", "needs"].map((f) => `annual.${f}`);
    case "ninety": return ["title", "pillar", "annual", "done", "outcome", "obstacle", "if1", "then1"].map((f) => `ninety.0.${f}`);
    case "habits": return ["what", "cue", "freq", "pillar", "mins"].map((f) => `habits.0.${f}`);
    case "weeks": return ["title", "pillar", "priority", "mins"].map((f) => `weeks.w1.0.${f}`);
    case "rhythm": return ["review.day", "review.time", "review.mins", "tell.who", "tell.ask", "tell.freq", "firstStep"];
    default: return [];
  }
}

// 0–1, or null for steps without a ring.
export function stepProgress(id: StepId, a: Answers, today: Date = new Date()): number | null {
  if (id === "output") return null;
  if (id === "months") {
    const ms = deriveDates(a, today).months;
    return ms.filter((m) => V(a, `months.${m.key}.0`) || V(a, `months.${m.key}.1`)).length / 12;
  }
  const ps = requiredPaths(id);
  return ps.length ? ps.filter((p) => filled(getP(a, p))).length / ps.length : 0;
}
