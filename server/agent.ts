import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { getValidAccessToken } from "./outlook";
import { listCalendarForDay, createCalendarEvent, deleteCalendarEvent, type CalendarEvent } from "./graph";
import { listIcsEventsForDay, findSchoolRunBounds, isRelevantToUser } from "./ics";
import type { DailyItem, NinetyDayGoal, WeeklyGoal, WeeklyGoalTemplate } from "@shared/schema";

const MODEL = "claude-opus-4-8";
const TIME_ZONE = "Europe/London";
const USER_NAME = "Mark";
const LUNCH_DURATION_MIN = 30;
const LUNCH_DEFAULT_START = "12:00";
const LUNCH_LATEST_START = "13:00";
const DAILY_COMPASS_CATEGORY = "Daily Compass";

const FITNESS_START_HHMM = "05:30";
const FITNESS_DURATION_MIN = 60;
const CHI_KUNG_START_HHMM = "05:15";
const CHI_KUNG_DURATION_MIN = 15;

const CHI_KUNG_RE = /\bchi\s*kung\b/i;
const FITNESS_RE = /\b(weights?|spin|run(?:ning)?|cycle|cycling|bike|gym|swim(?:ming)?|yoga|pilates|HIIT|workout)\b/i;

type FitnessKind = "fitness" | "chi_kung" | null;
function classifyFitness(text: string): FitnessKind {
  if (CHI_KUNG_RE.test(text)) return "chi_kung";
  if (FITNESS_RE.test(text)) return "fitness";
  return null;
}

function hhmmAddMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  const newH = Math.floor(total / 60) % 24;
  const newM = total % 60;
  return `${String(newH).padStart(2, "0")}:${String(newM).padStart(2, "0")}`;
}

function makeIso(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00`;
}

interface ScheduleBlock {
  dailyItemId: number;
  eventTitle: string;
  startTime: string;
  endTime: string;
  reasoning: string;
}

interface UnscheduledBlock {
  dailyItemId: number;
  reason: string;
}

interface LunchBlock {
  startTime: string;
  endTime: string;
  reasoning: string;
}

interface ScheduleResponse {
  lunch: LunchBlock | null;
  scheduled: ScheduleBlock[];
  unscheduled: UnscheduledBlock[];
  notes: string;
}

const SCHEDULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    lunch: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            startTime: { type: "string", description: "ISO 8601 local wall time for lunch start, e.g. 2026-06-11T12:00:00" },
            endTime: { type: "string", description: "ISO 8601 local wall time for lunch end" },
            reasoning: { type: "string" },
          },
          required: ["startTime", "endTime", "reasoning"],
        },
      ],
      description: "30-minute lunch block. null only if the user's existing calendar already has a lunch event today.",
    },
    scheduled: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dailyItemId: { type: "integer" },
          eventTitle: { type: "string" },
          startTime: { type: "string", description: "ISO 8601 local wall time, e.g. 2026-06-10T09:00:00" },
          endTime: { type: "string", description: "ISO 8601 local wall time, e.g. 2026-06-10T10:30:00" },
          reasoning: { type: "string", description: "Brief why-this-time explanation" },
        },
        required: ["dailyItemId", "eventTitle", "startTime", "endTime", "reasoning"],
      },
    },
    unscheduled: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          dailyItemId: { type: "integer" },
          reason: { type: "string" },
        },
        required: ["dailyItemId", "reason"],
      },
    },
    notes: { type: "string", description: "Brief overall comment on the plan." },
  },
  required: ["lunch", "scheduled", "unscheduled", "notes"],
} as const;

const SYSTEM_PROMPT = `You are the scheduling assistant inside Daily Compass, a personal planning app.

Your job: take the user's prioritised goals AND to-dos for a single day and place each one into a free block in their Outlook calendar.

HARD RULES
- Working hours window will be supplied per request (start and end in HH:MM, Europe/London local time).
- Lunch: a ${LUNCH_DURATION_MIN}-minute lunch break which will ALSO be booked into the user's Outlook calendar. Default start time ${LUNCH_DEFAULT_START}. If a 45-minute work block would butt into that window, you MAY delay lunch — but lunch must start no later than ${LUNCH_LATEST_START} (latest possible window: ${LUNCH_LATEST_START}–13:30). Pick a single ${LUNCH_DURATION_MIN}-minute slot, return it in the "lunch" field of the output, and DO NOT schedule any work blocks across it. If the user's existing calendar already shows a lunch / meal event today, set "lunch": null and treat that existing event as the lunch break.
- Never overlap an existing calendar event (you'll be given them).
- Never overlap two scheduled blocks (or lunch) with each other.
- Schedule items of type "main", "priority", AND "todo".
- Fitness sessions (weights, spin, run, cycle, gym, swim, yoga, etc.) and Chi Kung sessions are handled separately BEFORE you're called — they're already removed from the list you see. Don't second-guess them.

DEFAULT DURATIONS
- Main Goal: 45 minutes — unless a linked weekly action specifies time_estimate_mins, in which case use that.
- Priority: 45 minutes — unless a linked weekly action specifies time_estimate_mins, in which case use that.
- To-do: 15 minutes (fixed).

PLACEMENT GUIDANCE
- Main Goal in the morning, in the largest contiguous block available within the working hours window.
- Priorities by rank (P1 before P2 before P3), filling the next-best free slots after the Main Goal.
- To-dos go in 15-minute slots INTERLEAVED between the longer Main/Priority work blocks — use them as short breathers between deep work. Don't cluster all the to-dos at the end of the day.
- Round all start times to the nearest quarter-hour.

OUTPUT
- Return a single JSON object matching the schema you've been given.
- "lunch" is either {startTime, endTime, reasoning} for the lunch break, or null if the user's existing calendar already contains one.
- "scheduled" is the list of Main / Priority / To-do blocks placed in the calendar.
- Times are local wall times in ISO 8601 like "2026-06-10T09:00:00" (no timezone suffix; the host applies Europe/London).
- If a goal or to-do genuinely won't fit, list it in "unscheduled" with a one-line reason.
- "notes" is one sentence summarising the plan or any caveats. Keep it short.`;

interface ScheduleInput {
  date: string;
  dayOfWeek: string;
  ninetyDayGoalLabel: string | null;
  workingHoursStart: string;
  workingHoursEnd: string;
  events: CalendarEvent[];
  lunchAlreadyExists: boolean;
  goals: Array<{
    id: number;
    type: "main" | "priority" | "todo";
    rank: number | null;
    text: string;
    completed: boolean;
    linkedWeeklyGoal?: WeeklyGoal | null;
    linkedTemplate?: WeeklyGoalTemplate | null;
  }>;
}

function buildUserMessage(input: ScheduleInput): string {
  const eventLines = input.events.length
    ? input.events
        .map((e) => `- ${e.startISO} → ${e.endISO}: ${e.subject}${e.isAllDay ? " (all-day)" : ""}${e.showAs ? ` [${e.showAs}]` : ""}`)
        .join("\n")
    : "(no existing events today)";

  // Skip already-completed items — no point scheduling something done.
  const open = input.goals.filter((g) => !g.completed);
  // Order: Main first, then priorities by rank, then to-dos.
  const ordered = [
    ...open.filter((g) => g.type === "main"),
    ...open.filter((g) => g.type === "priority").sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)),
    ...open.filter((g) => g.type === "todo"),
  ];
  const goalLines = ordered
    .map((g) => {
      const tier =
        g.type === "main" ? "Main Goal" :
        g.type === "priority" ? `Priority ${g.rank ?? "?"}` :
        "To-do (15 min)";
      const templateBits = g.linkedTemplate
        ? ` [linked to weekly action: "${g.linkedTemplate.goalTitle}"` +
          (g.linkedTemplate.timeEstimateMins ? `, time_estimate_mins=${g.linkedTemplate.timeEstimateMins}` : "") +
          (g.linkedTemplate.parent90DayGoal ? `, parent=${g.linkedTemplate.parent90DayGoal}` : "") +
          "]"
        : g.linkedWeeklyGoal
          ? ` [linked to weekly goal: "${g.linkedWeeklyGoal.goalText}" (${g.linkedWeeklyGoal.category})]`
          : "";
      return `- id=${g.id} | ${tier} | "${g.text}"${templateBits}`;
    })
    .join("\n");

  return [
    `Date to plan: ${input.dayOfWeek}, ${input.date}`,
    `Timezone: ${TIME_ZONE}`,
    `Working hours window: ${input.workingHoursStart} to ${input.workingHoursEnd}`,
    input.ninetyDayGoalLabel ? `Quarter context: ${input.ninetyDayGoalLabel}` : null,
    input.lunchAlreadyExists ? `NOTE: a lunch event already exists on the calendar today; return "lunch": null.` : null,
    "",
    "Existing calendar events for today:",
    eventLines,
    "",
    "Goals + to-dos to schedule (Main + Priorities at 45 min each, to-dos at 15 min each, interleaved):",
    goalLines || "(nothing to schedule)",
  ]
    .filter((line) => line !== null)
    .join("\n");
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

function parseLocalIso(iso: string): number {
  // Treat as Europe/London local wall time; we convert to a sortable epoch
  // assuming the host's TZ math is consistent. For our use today this is OK
  // because we never compare across days.
  return new Date(`${iso}+01:00`).getTime();
}

function hhmmToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function inWorkingHours(startIso: string, endIso: string, startHhmm: string, endHhmm: string): boolean {
  if (startIso.slice(0, 10) !== endIso.slice(0, 10)) return false;
  const startMinutes = hhmmToMinutes(startIso.slice(11, 16));
  const endMinutes = hhmmToMinutes(endIso.slice(11, 16));

  // Day-of-week from the date string (Mon=1 ... Sun=0).
  const d = new Date(`${startIso.slice(0, 10)}T12:00:00Z`);
  const day = d.getUTCDay();
  if (day === 0 || day === 6) return false;

  return startMinutes >= hhmmToMinutes(startHhmm) && endMinutes <= hhmmToMinutes(endHhmm);
}

/**
 * Returns the working-hours window for the day, narrowed by school-run
 * events in any configured ICS feed. If the day has a morning school
 * drop-off, the start of work is pushed to the end of that drop-off. If
 * there's an afternoon pick-up, the end of work is pulled back to its
 * start. Otherwise defaults to 08:00–18:00.
 */
function workingHoursFromEvents(events: CalendarEvent[]): { start: string; end: string } {
  const { morningEnd, afternoonStart } = findSchoolRunBounds(events);
  const defaultStart = "08:00";
  const defaultEnd = "18:00";
  const start = morningEnd ? morningEnd.slice(11, 16) : defaultStart;
  const end = afternoonStart ? afternoonStart.slice(11, 16) : defaultEnd;
  return { start, end };
}

interface RunResult {
  ok: boolean;
  lunch: (LunchBlock & { eventId?: string; webLink?: string }) | null;
  lunchRejected?: { block: LunchBlock; reason: string };
  scheduled: Array<ScheduleBlock & { eventId?: string; webLink?: string }>;
  fitness: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string; kind: FitnessKind; eventId?: string; webLink?: string }>;
  alreadyScheduled: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string }>;
  unscheduled: UnscheduledBlock[];
  rejected: Array<{ block: ScheduleBlock; reason: string }>;
  notes: string;
  modelUsage?: { input_tokens: number; output_tokens: number; cache_read_input_tokens?: number };
}

export async function scheduleDayWithClaude(date: string): Promise<RunResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key not configured (ANTHROPIC_API_KEY).");
  }

  // 1. Gather what Claude needs
  const items = await storage.getDailyItems(date);
  const ninetyDay = await storage.getCurrentNinetyDayGoal();
  const weekStart = getWeekStartDate(date);
  const allWeeklyGoals = await storage.getWeeklyGoals(weekStart);
  const allTemplates = await storage.getWeeklyGoalTemplates(weekStart);

  const goals = items.map((it) => {
    let linkedWeeklyGoal: WeeklyGoal | null = null;
    let linkedTemplate: WeeklyGoalTemplate | null = null;
    if (it.linkedWeeklyGoalId) {
      linkedWeeklyGoal = allWeeklyGoals.find((g) => g.id === it.linkedWeeklyGoalId) ?? null;
      if (linkedWeeklyGoal) {
        linkedTemplate =
          allTemplates.find((t) => t.goalTitle.trim().toLowerCase() === linkedWeeklyGoal!.goalText.trim().toLowerCase()) ??
          null;
      }
    }
    return {
      id: it.id,
      type: it.type as "main" | "priority" | "todo",
      rank: it.rank ?? null,
      text: it.text,
      completed: it.completed,
      linkedWeeklyGoal,
      linkedTemplate,
    };
  });

  // Pull busy/free from every connected Outlook account. The first account
  // where role === "read_write" is where we'll create events later.
  const allAccounts = await storage.getOauthTokens("microsoft");
  if (allAccounts.length === 0) throw new Error("No Outlook account connected.");
  const writeAccount = allAccounts.find((a) => a.role === "read_write") ?? null;

  const events: CalendarEvent[] = [];
  for (const acct of allAccounts) {
    try {
      const accessToken = await getValidAccessToken(acct.accountKey);
      const list = await listCalendarForDay(accessToken, date, TIME_ZONE);
      for (const ev of list) {
        events.push({ ...ev, source: acct.accountEmail ?? acct.accountKey });
      }
    } catch (err: any) {
      console.warn(`[agent] could not load calendar for ${acct.accountKey}: ${err?.message ?? err}`);
    }
  }

  // Pull additional calendars from configured ICS feeds (e.g. Family Life).
  // Used both as busy/free signal and to detect school-run events that
  // narrow the working-hours window. Family-Life-style feeds are shared
  // family calendars; filter to events that are actually relevant to the
  // user (named, or transport duties they perform).
  const feedEventsByFeed: CalendarEvent[][] = [];
  const feeds = await storage.getActiveCalendarFeeds();
  for (const feed of feeds) {
    try {
      const list = await listIcsEventsForDay(feed.url, date, feed.name);
      const filtered = list.filter((e) => isRelevantToUser(e.subject, USER_NAME));
      feedEventsByFeed.push(filtered);
      for (const ev of filtered) events.push(ev);
    } catch (err: any) {
      console.warn(`[agent] could not load ICS feed ${feed.name}: ${err?.message ?? err}`);
    }
  }
  // Derive working hours from the first feed (typically Family Life) that
  // has school-run events. If none do, default to 08:00–18:00.
  let workingHours = { start: "08:00", end: "18:00" };
  for (const list of feedEventsByFeed) {
    const candidate = workingHoursFromEvents(list);
    if (candidate.start !== "08:00" || candidate.end !== "18:00") {
      workingHours = candidate;
      break;
    }
  }

  const dayOfWeek = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long" });

  // Build the busy-range list once - used by both the fitness pre-scheduler
  // and the post-Claude validator.
  const eventRanges = events
    .filter((e) => !e.isAllDay)
    .map((e) => ({ start: parseLocalIso(e.startISO.replace("Z", "")), end: parseLocalIso(e.endISO.replace("Z", "")) }));

  // ---- DEDUP & FITNESS PRE-SCHEDULING ----
  // 1. Find existing Daily Compass events on the calendar today. Items whose
  //    title matches one of those are already scheduled and shouldn't be
  //    re-booked or sent to Claude.
  const existingDcEvents = events.filter((e) => (e.categories ?? []).includes(DAILY_COMPASS_CATEGORY));
  const dcSubjects = new Set(existingDcEvents.map((e) => e.subject.trim().toLowerCase()));
  const dcSubjectMap = new Map(existingDcEvents.map((e) => [e.subject.trim().toLowerCase(), e]));

  const alreadyScheduled: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string; webLink?: string }> = [];
  const remaining: typeof goals = [];
  for (const g of goals) {
    if (g.completed) continue;
    const key = g.text.trim().toLowerCase();
    const existing = dcSubjectMap.get(key);
    if (existing && existing.id) {
      alreadyScheduled.push({
        dailyItemId: g.id,
        eventTitle: existing.subject,
        startTime: existing.startISO,
        endTime: existing.endISO,
      });
    } else {
      remaining.push(g);
    }
  }

  // 2. Pre-schedule fitness + chi kung deterministically (before Claude).
  type FitnessSchedule = { dailyItemId: number; eventTitle: string; startTime: string; endTime: string; kind: FitnessKind };
  const preFitness: FitnessSchedule[] = [];
  const fitnessRejected: Array<{ block: { dailyItemId: number; eventTitle: string; startTime: string; endTime: string }; reason: string }> = [];

  const chiKungItems = remaining.filter((g) => classifyFitness(g.text) === "chi_kung");
  const fitnessItems = remaining.filter((g) => classifyFitness(g.text) === "fitness");
  const goalsForClaude = remaining.filter((g) => classifyFitness(g.text) === null);

  function scheduleFitnessBlock(item: typeof remaining[number], startHhmm: string, durationMin: number, kind: FitnessKind) {
    const endHhmm = hhmmAddMinutes(startHhmm, durationMin);
    const startIso = makeIso(date, startHhmm);
    const endIso = makeIso(date, endHhmm);
    const startMs = parseLocalIso(startIso);
    const endMs = parseLocalIso(endIso);
    // Check no overlap with existing events
    const conflict = eventRanges.find((r) => overlaps(startMs, endMs, r.start, r.end));
    if (conflict) {
      fitnessRejected.push({ block: { dailyItemId: item.id, eventTitle: item.text, startTime: startIso, endTime: endIso }, reason: "Overlaps an existing calendar event." });
      return;
    }
    preFitness.push({ dailyItemId: item.id, eventTitle: item.text, startTime: startIso, endTime: endIso, kind });
    eventRanges.push({ start: startMs, end: endMs });
  }

  // Chi kung: each one at 05:15-05:30 (single slot)
  for (const it of chiKungItems) scheduleFitnessBlock(it, CHI_KUNG_START_HHMM, CHI_KUNG_DURATION_MIN, "chi_kung");

  // Fitness sessions: sequence starting at 05:30, each 60 min
  let fitnessSlot = FITNESS_START_HHMM;
  for (const it of fitnessItems) {
    scheduleFitnessBlock(it, fitnessSlot, FITNESS_DURATION_MIN, "fitness");
    fitnessSlot = hhmmAddMinutes(fitnessSlot, FITNESS_DURATION_MIN);
  }

  // Check if lunch already exists; if so, tell Claude not to schedule one.
  const existingLunch = existingDcEvents.find((e) => e.subject.trim().toLowerCase() === "lunch");

  // Build the eventRanges parseLocalIso list (it's used in validation too).
  // It was constructed above with strip-Z; now we've also pushed fitness ranges.

  const userMessage = buildUserMessage({
    date,
    dayOfWeek,
    ninetyDayGoalLabel: ninetyDay?.periodLabel ?? null,
    workingHoursStart: workingHours.start,
    workingHoursEnd: workingHours.end,
    events,
    goals: goalsForClaude,
    lunchAlreadyExists: !!existingLunch,
  });

  // 2. Call Claude (Opus 4.8 + adaptive thinking + structured output, cached system)
  const client = new Anthropic();
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: SCHEDULE_SCHEMA },
    },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: userMessage }],
  });

  const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
  if (!textBlock) throw new Error("Claude did not return a JSON output block.");
  let parsed: ScheduleResponse;
  try {
    parsed = JSON.parse(textBlock.text) as ScheduleResponse;
  } catch (err: any) {
    throw new Error(`Could not parse Claude's schedule JSON: ${err?.message ?? err}`);
  }

  // 3. Validate Claude's blocks against existing events + each other + working hours.
  // eventRanges already includes existing events + the pre-scheduled fitness blocks.
  const rejected: Array<{ block: ScheduleBlock; reason: string }> = [];
  const accepted: ScheduleBlock[] = [];

  // Validate the lunch block first; if accepted, treat it as another event range
  // so work blocks proposed across it are rejected as overlaps.
  let acceptedLunch: LunchBlock | null = null;
  let lunchRejected: { block: LunchBlock; reason: string } | undefined;
  if (parsed.lunch) {
    const lunchStart = parseLocalIso(parsed.lunch.startTime);
    const lunchEnd = parseLocalIso(parsed.lunch.endTime);
    const lunchStartHhmm = parsed.lunch.startTime.slice(11, 16);
    const durationMin = (lunchEnd - lunchStart) / 60000;
    if (!Number.isFinite(lunchStart) || !Number.isFinite(lunchEnd) || lunchEnd <= lunchStart) {
      lunchRejected = { block: parsed.lunch, reason: "Invalid start/end time." };
    } else if (!inWorkingHours(parsed.lunch.startTime, parsed.lunch.endTime, workingHours.start, workingHours.end)) {
      lunchRejected = { block: parsed.lunch, reason: `Lunch falls outside working hours (${workingHours.start}–${workingHours.end}).` };
    } else if (hhmmToMinutes(lunchStartHhmm) > hhmmToMinutes(LUNCH_LATEST_START)) {
      lunchRejected = { block: parsed.lunch, reason: `Lunch must start no later than ${LUNCH_LATEST_START}.` };
    } else if (Math.abs(durationMin - LUNCH_DURATION_MIN) > 1) {
      lunchRejected = { block: parsed.lunch, reason: `Lunch must be ${LUNCH_DURATION_MIN} minutes (was ${durationMin}).` };
    } else if (eventRanges.some((r) => overlaps(lunchStart, lunchEnd, r.start, r.end))) {
      lunchRejected = { block: parsed.lunch, reason: "Lunch overlaps an existing calendar event." };
    } else {
      acceptedLunch = parsed.lunch;
      eventRanges.push({ start: lunchStart, end: lunchEnd });
    }
  }

  for (const block of parsed.scheduled) {
    const startMs = parseLocalIso(block.startTime);
    const endMs = parseLocalIso(block.endTime);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      rejected.push({ block, reason: "Invalid start/end time." });
      continue;
    }
    if (!inWorkingHours(block.startTime, block.endTime, workingHours.start, workingHours.end)) {
      rejected.push({ block, reason: `Outside working hours (${workingHours.start}–${workingHours.end}) or weekend.` });
      continue;
    }
    if (eventRanges.some((r) => overlaps(startMs, endMs, r.start, r.end))) {
      rejected.push({ block, reason: "Overlaps an existing calendar event." });
      continue;
    }
    if (accepted.some((other) => overlaps(startMs, endMs, parseLocalIso(other.startTime), parseLocalIso(other.endTime)))) {
      rejected.push({ block, reason: "Overlaps another scheduled block." });
      continue;
    }
    accepted.push(block);
  }

  // 4. Create accepted events in Outlook (only on the read_write account).
  const created: Array<ScheduleBlock & { eventId?: string; webLink?: string }> = [];
  const createdFitness: Array<{ dailyItemId: number; eventTitle: string; startTime: string; endTime: string; kind: FitnessKind; eventId?: string; webLink?: string }> = [];
  let createdLunch: (LunchBlock & { eventId?: string; webLink?: string }) | null = null;
  if (!writeAccount) {
    for (const block of accepted) {
      rejected.push({ block, reason: "No Outlook account is marked read_write; can't create events." });
    }
    if (acceptedLunch) {
      lunchRejected = { block: acceptedLunch, reason: "No Outlook account is marked read_write; can't create events." };
    }
  } else {
    const writeToken = await getValidAccessToken(writeAccount.accountKey);

    // Create fitness + chi kung blocks first (deterministic, no reminders).
    for (const f of preFitness) {
      try {
        const ev = await createCalendarEvent(writeToken, {
          subject: f.eventTitle,
          bodyHtml: `<p>${escapeHtml(f.eventTitle)}</p><p style="color:#888;font-size:11px">Scheduled by Daily Compass · ${f.kind === "chi_kung" ? "Chi Kung" : "Fitness"} (no reminder)</p>`,
          startISO: f.startTime,
          endISO: f.endTime,
          timeZone: TIME_ZONE,
          categories: [DAILY_COMPASS_CATEGORY],
          reminderMinutesBeforeStart: null,
        });
        createdFitness.push({ ...f, eventId: ev.id, webLink: ev.webLink });
      } catch (err: any) {
        fitnessRejected.push({ block: { dailyItemId: f.dailyItemId, eventTitle: f.eventTitle, startTime: f.startTime, endTime: f.endTime }, reason: `Outlook create failed: ${err?.message ?? err}` });
      }
    }

    // Create the lunch event first.
    if (acceptedLunch) {
      try {
        const ev = await createCalendarEvent(writeToken, {
          subject: "Lunch",
          bodyHtml: [
            `<p><strong>Lunch break</strong></p>`,
            acceptedLunch.reasoning ? `<p><em>${escapeHtml(acceptedLunch.reasoning)}</em></p>` : "",
            `<p style="color:#888;font-size:11px">Scheduled by Daily Compass</p>`,
          ].join(""),
          startISO: acceptedLunch.startTime,
          endISO: acceptedLunch.endTime,
          timeZone: TIME_ZONE,
          categories: ["Daily Compass"],
        });
        createdLunch = { ...acceptedLunch, eventId: ev.id, webLink: ev.webLink };
      } catch (err: any) {
        lunchRejected = { block: acceptedLunch, reason: `Outlook create failed: ${err?.message ?? err}` };
      }
    }

    for (const block of accepted) {
      const item = goals.find((g) => g.id === block.dailyItemId);
      const bodyHtml = [
        `<p><strong>${escapeHtml(block.eventTitle)}</strong></p>`,
        block.reasoning ? `<p><em>${escapeHtml(block.reasoning)}</em></p>` : "",
        item?.linkedTemplate?.parent90DayGoal
          ? `<p>Ladder: ${escapeHtml(item.linkedTemplate.parent90DayGoal)}</p>`
          : "",
        `<p style="color:#888;font-size:11px">Scheduled by Daily Compass</p>`,
      ].join("");
      try {
        const ev = await createCalendarEvent(writeToken, {
          subject: `${block.eventTitle}`,
          bodyHtml,
          startISO: block.startTime,
          endISO: block.endTime,
          timeZone: TIME_ZONE,
          categories: ["Daily Compass"],
        });
        created.push({ ...block, eventId: ev.id, webLink: ev.webLink });
      } catch (err: any) {
        rejected.push({ block, reason: `Outlook create failed: ${err?.message ?? err}` });
      }
    }
  }

  // Combine fitness rejections into the main rejected list for the UI.
  const allRejected: Array<{ block: ScheduleBlock; reason: string }> = [
    ...rejected,
    ...fitnessRejected.map((r) => ({
      block: { dailyItemId: r.block.dailyItemId, eventTitle: r.block.eventTitle, startTime: r.block.startTime, endTime: r.block.endTime, reasoning: "" },
      reason: r.reason,
    })),
  ];

  return {
    ok: true,
    lunch: createdLunch,
    lunchRejected,
    scheduled: created,
    fitness: createdFitness,
    alreadyScheduled,
    unscheduled: parsed.unscheduled ?? [],
    rejected: allRejected,
    notes: parsed.notes ?? "",
    modelUsage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? undefined,
    },
  };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export async function clearDailyCompassEventsForDay(date: string): Promise<{ deleted: number; failed: number; subjects: string[] }> {
  const accts = await storage.getOauthTokens("microsoft");
  const writeAccount = accts.find((a) => a.role === "read_write");
  if (!writeAccount) throw new Error("No read_write Outlook account.");
  const token = await getValidAccessToken(writeAccount.accountKey);
  const events = await listCalendarForDay(token, date, TIME_ZONE);
  const dc = events.filter((e) => (e.categories ?? []).includes(DAILY_COMPASS_CATEGORY));
  let deleted = 0, failed = 0;
  const subjects: string[] = [];
  for (const e of dc) {
    if (!e.id) continue;
    try {
      await deleteCalendarEvent(token, e.id);
      deleted++;
      subjects.push(e.subject);
    } catch {
      failed++;
    }
  }
  return { deleted, failed, subjects };
}

function getWeekStartDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split("T")[0];
}
