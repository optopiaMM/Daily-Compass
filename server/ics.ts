import ical from "node-ical";
import type { CalendarEvent } from "./graph";

/**
 * Fetches an iCalendar feed URL and returns the events that fall on the
 * given date. Recurring events are expanded; all-day events flagged.
 * Times are returned as naked local-wall ISO strings ("2026-06-11T08:35:00")
 * matching the format used elsewhere in the agent flow.
 *
 * `sourceLabel` is stamped onto each event so the prompt can show which
 * feed it came from.
 */
export async function listIcsEventsForDay(
  url: string,
  date: string,
  sourceLabel: string,
): Promise<CalendarEvent[]> {
  const parsed = await ical.async.fromURL(url);
  const dayStart = new Date(`${date}T00:00:00+01:00`);
  const dayEnd = new Date(`${date}T23:59:59+01:00`);
  const events: CalendarEvent[] = [];

  for (const key of Object.keys(parsed)) {
    const entry = (parsed as any)[key];
    if (!entry || entry.type !== "VEVENT") continue;

    // Recurring events: expand instances within the day window.
    if (entry.rrule) {
      const occurrences: Date[] = entry.rrule.between(dayStart, dayEnd, true);
      for (const occ of occurrences) {
        const offset = entry.end.getTime() - entry.start.getTime();
        const occEnd = new Date(occ.getTime() + offset);
        events.push(makeEvent(entry, occ, occEnd, sourceLabel));
      }
    } else {
      const start: Date = entry.start;
      const end: Date = entry.end ?? entry.start;
      if (!start || !end) continue;
      if (end < dayStart || start > dayEnd) continue;
      events.push(makeEvent(entry, start, end, sourceLabel));
    }
  }

  events.sort((a, b) => (a.startISO < b.startISO ? -1 : 1));
  return events;
}

function makeEvent(entry: any, start: Date, end: Date, source: string): CalendarEvent {
  const isAllDay = entry.datetype === "date" || (
    start.getUTCHours() === 0 && start.getUTCMinutes() === 0 &&
    end.getUTCHours() === 0 && end.getUTCMinutes() === 0
  );
  return {
    subject: String(entry.summary ?? "(no subject)"),
    startISO: toNakedLocal(start),
    endISO: toNakedLocal(end),
    isAllDay,
    source,
  };
}

/**
 * Convert a Date to a naked local-wall ISO string in Europe/London.
 * The date instance carries an absolute moment; we render its
 * London-local hours/minutes.
 */
function toNakedLocal(d: Date): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).filter((p) => p.type !== "literal").map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

const DROP_OFF_RE = /school\s*drop/i;
const PICK_UP_RE = /school\s*pick/i;
const TRANSPORT_RE = /^(school\s*(drop\s*off|pick\s*up)|drop\s*off|pick\s*up)\b/i;

/**
 * Family Life is a shared family calendar — events tagged for Lizzie /
 * the kids shouldn't show up as busy for Mark. Keep only events where
 * Mark is named OR which look like transport duties Mark performs
 * (school drop-off / pick-up, "Drop off X", "Pick up X").
 */
export function isRelevantToUser(subject: string, userName: string): boolean {
  if (!subject) return false;
  const lower = subject.toLowerCase();
  if (lower.includes(userName.toLowerCase())) return true;
  if (TRANSPORT_RE.test(subject)) return true;
  return false;
}

/**
 * From a list of family-life events for the day, extract the morning
 * school-run end (drop-off end) and the afternoon school-run start
 * (pick-up start). Returns null for either if not found.
 */
export function findSchoolRunBounds(events: CalendarEvent[]): { morningEnd: string | null; afternoonStart: string | null } {
  let morningEnd: string | null = null;  // latest drop-off end
  let afternoonStart: string | null = null;  // earliest pick-up start
  for (const e of events) {
    if (DROP_OFF_RE.test(e.subject)) {
      if (!morningEnd || e.endISO > morningEnd) morningEnd = e.endISO;
    } else if (PICK_UP_RE.test(e.subject)) {
      if (!afternoonStart || e.startISO < afternoonStart) afternoonStart = e.startISO;
    }
  }
  return { morningEnd, afternoonStart };
}
