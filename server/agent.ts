import Anthropic from "@anthropic-ai/sdk";
import { storage } from "./storage";
import { getValidAccessToken } from "./outlook";
import { listCalendarForDay, createCalendarEvent, type CalendarEvent } from "./graph";
import type { DailyItem, NinetyDayGoal, WeeklyGoal, WeeklyGoalTemplate } from "@shared/schema";

const MODEL = "claude-opus-4-8";
const TIME_ZONE = "Europe/London";
const LUNCH_START = 12; // 12:00
const LUNCH_END = 13;   // 13:00

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

interface ScheduleResponse {
  scheduled: ScheduleBlock[];
  unscheduled: UnscheduledBlock[];
  notes: string;
}

const SCHEDULE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
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
  required: ["scheduled", "unscheduled", "notes"],
} as const;

const SYSTEM_PROMPT = `You are the scheduling assistant inside Daily Compass, a personal planning app.

Your job: take the user's prioritised goals AND to-dos for a single day and place each one into a free block in their Outlook calendar.

HARD RULES
- Working hours window will be supplied per request (start and end in HH:MM, Europe/London local time).
- Leave ${LUNCH_START}:00–${LUNCH_END}:00 clear for lunch.
- Never overlap an existing calendar event (you'll be given them).
- Never overlap two scheduled blocks with each other.
- Schedule items of type "main", "priority", AND "todo".

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
- Times are local wall times in ISO 8601 like "2026-06-10T09:00:00" (no timezone suffix; the host applies Europe/London).
- If a goal or to-do genuinely won't fit, list it in "unscheduled" with a one-line reason.
- "notes" is one sentence summarising the plan or any caveats. Keep it short.`;

interface ScheduleInput {
  date: string;
  dayOfWeek: string;
  ninetyDayGoalLabel: string | null;
  workingHoursStart: string;  // "HH:MM"
  workingHoursEnd: string;
  events: CalendarEvent[];
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
 * Returns the working-hours window for a given date.
 * Currently defaults to 08:00–18:00. Once the Family Life ICS feed is wired
 * in, this should narrow to (end-of-morning-school-run, start-of-afternoon-
 * school-run) on school-run days.
 */
function getWorkingHoursForDay(_date: string): { start: string; end: string } {
  return { start: "08:00", end: "18:00" };
}

interface RunResult {
  ok: boolean;
  scheduled: Array<ScheduleBlock & { eventId?: string; webLink?: string }>;
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
  const workingHours = getWorkingHoursForDay(date);

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

  const dayOfWeek = new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long" });

  const userMessage = buildUserMessage({
    date,
    dayOfWeek,
    ninetyDayGoalLabel: ninetyDay?.periodLabel ?? null,
    workingHoursStart: workingHours.start,
    workingHoursEnd: workingHours.end,
    events,
    goals,
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

  // 3. Validate against existing events + each other + working hours
  const eventRanges = events
    .filter((e) => !e.isAllDay)
    .map((e) => ({ start: parseLocalIso(e.startISO.replace("Z", "")), end: parseLocalIso(e.endISO.replace("Z", "")) }));

  const rejected: Array<{ block: ScheduleBlock; reason: string }> = [];
  const accepted: ScheduleBlock[] = [];

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
  if (!writeAccount) {
    for (const block of accepted) {
      rejected.push({ block, reason: "No Outlook account is marked read_write; can't create events." });
    }
  } else {
    const writeToken = await getValidAccessToken(writeAccount.accountKey);
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

  return {
    ok: true,
    scheduled: created,
    unscheduled: parsed.unscheduled ?? [],
    rejected,
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

function getWeekStartDate(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diff);
  return d.toISOString().split("T")[0];
}
