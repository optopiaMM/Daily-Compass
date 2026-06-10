import { getValidAccessToken } from "./outlook";

const GRAPH = "https://graph.microsoft.com/v1.0";

export interface CalendarEvent {
  subject: string;
  startISO: string;
  endISO: string;
  showAs?: string;
  isAllDay?: boolean;
}

/**
 * Returns the user's calendar events for a given day in the given IANA
 * timezone. Uses the calendarView endpoint so all-day items and recurring
 * series instances are expanded to concrete occurrences.
 */
export async function listCalendarForDay(dateISO: string, tz = "Europe/London"): Promise<CalendarEvent[]> {
  const accessToken = await getValidAccessToken();
  const startOfDay = `${dateISO}T00:00:00`;
  const endOfDay = `${dateISO}T23:59:59`;
  const url = `${GRAPH}/me/calendarView?startDateTime=${encodeURIComponent(startOfDay)}&endDateTime=${encodeURIComponent(endOfDay)}&$select=subject,start,end,showAs,isAllDay&$top=200&$orderby=start/dateTime`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Prefer: `outlook.timezone="${tz}"`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph calendarView failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { value?: any[] };
  return (body.value ?? []).map((e) => ({
    subject: e.subject ?? "(no subject)",
    startISO: `${e.start?.dateTime}Z`.replace(/\.\d+Z$/, "Z"),
    endISO: `${e.end?.dateTime}Z`.replace(/\.\d+Z$/, "Z"),
    showAs: e.showAs,
    isAllDay: e.isAllDay,
  }));
}

export interface CreateEventInput {
  subject: string;
  bodyHtml?: string;
  startISO: string;  // local-zone wall time, e.g. "2026-06-10T09:00:00"
  endISO: string;
  timeZone?: string;
  categories?: string[];
}

export async function createCalendarEvent(input: CreateEventInput): Promise<{ id: string; webLink?: string }> {
  const accessToken = await getValidAccessToken();
  const payload = {
    subject: input.subject,
    body: { contentType: "HTML", content: input.bodyHtml ?? "" },
    start: { dateTime: input.startISO, timeZone: input.timeZone ?? "Europe/London" },
    end: { dateTime: input.endISO, timeZone: input.timeZone ?? "Europe/London" },
    showAs: "busy",
    isReminderOn: true,
    reminderMinutesBeforeStart: 5,
    categories: input.categories ?? ["Daily Compass"],
  };
  const res = await fetch(`${GRAPH}/me/events`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Graph create event failed: ${res.status} ${text}`);
  }
  const body = (await res.json()) as { id: string; webLink?: string };
  return { id: body.id, webLink: body.webLink };
}
