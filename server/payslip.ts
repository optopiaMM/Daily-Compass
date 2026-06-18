// server/payslip.ts
//
// Monthly payslip agent. Mirrors the architecture of agent.ts:
//   gather -> call Claude (structured output) -> validate in code -> act.
//
// Flow:
//   1. Find the latest email from the accountant (Outlook via Graph).
//   2. Skip if we've already processed that message (idempotent — safe to
//      run on a daily cron; it no-ops until a new email arrives).
//   3. Unzip the attachment, hand the payslip PDFs + email body to Claude,
//      get back structured figures (net pay per payee + HMRC payment).
//   4. Validate the figures deterministically before doing anything real.
//   5. Compare each net pay to the standing-order baseline.
//   6. Create TWO calendar appointments via the existing Graph code:
//        - "Payslip actions" — next weekday after the email, 08:00, 15 min
//        - "Pay HMRC"        — 2 working days before due date, 08:00, 15 min
//   7. Record the run + actions; update the baseline to the latest figures.

import Anthropic from "@anthropic-ai/sdk";
import AdmZip from "adm-zip";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { storage } from "./storage";
import { getValidAccessToken } from "./outlook";
import { createCalendarEvent } from "./graph";
import { getLatestMessageFromSender, getMessageAttachments } from "./graph-mail";
import { standingOrders, payslipRuns, payslipActions } from "@shared/schema";

const MODEL = "claude-opus-4-8";
const TIME_ZONE = "Europe/London";
const CATEGORY = "Payslip Agent";
const APPT_TIME = "08:00";
const APPT_DURATION_MIN = 15;
const HMRC_LEAD_WORKING_DAYS = 2; // HMRC appt lands this many working days before due

function accountantEmail(): string {
  const fromEnv = process.env.ACCOUNTANT_EMAIL;
  if (fromEnv) return fromEnv;
  throw new Error("ACCOUNTANT_EMAIL not set (and no config fallback wired).");
}

// ---------------------------------------------------------------------------
// Structured extraction schema (same json_schema pattern as agent.ts)
// ---------------------------------------------------------------------------

interface PayeeFigure {
  name: string;
  netPayGbp: number;
}
interface HmrcFigure {
  amountGbp: number;
  dueDate: string; // YYYY-MM-DD
  reference: string;
  account: string;
}
interface Extraction {
  period: string;
  payees: PayeeFigure[];
  hmrc: HmrcFigure | null;
  notes: string;
}

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    period: {
      type: "string",
      description: 'The pay period, e.g. "June 2026". Prefer the period stated on the payslips.',
    },
    payees: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: { type: "string", description: "Full name exactly as it appears on the payslip." },
          netPayGbp: { type: "number", description: "Net (take-home) pay in GBP, e.g. 2350.00" },
        },
        required: ["name", "netPayGbp"],
      },
    },
    hmrc: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            amountGbp: { type: "number", description: "Total PAYE/NIC due to HMRC in GBP." },
            dueDate: { type: "string", description: "Payment due date as YYYY-MM-DD." },
            reference: {
              type: "string",
              description:
                "The HMRC payment reference, copied VERBATIM from the email body. Do not reconstruct it.",
            },
            account: {
              type: "string",
              description:
                "Destination account details (sort code / account no / name) as stated, or empty string if not given.",
            },
          },
          required: ["amountGbp", "dueDate", "reference", "account"],
        },
      ],
      description: "HMRC payment for the period, or null if none is due this month.",
    },
    notes: { type: "string", description: "One short line on anything ambiguous. Keep it brief." },
  },
  required: ["period", "payees", "hmrc", "notes"],
} as const;

const SYSTEM_PROMPT = `You extract structured payroll figures for a small UK limited company.

You are given the body text of an email from the company's accountant, plus
one or more payslip PDFs for the month.

Extract:
- The pay period.
- Each employee's NET (take-home) pay, in GBP, from their payslip.
- The amount due to HMRC (PAYE/NIC), its due date, its payment reference, and
  the destination account — these come from the EMAIL BODY, not the payslips.

CRITICAL RULES
- The HMRC payment reference must be copied VERBATIM from the email body. It
  carries a period suffix that changes every month; never reconstruct or guess
  it. If you cannot find it, return an empty string for reference.
- Net pay is the take-home figure, NOT gross and NOT total cost to employer.
- Amounts are plain numbers in GBP (e.g. 2350.00), no currency symbols.
- If no HMRC payment is due this month, set "hmrc": null.
- Return a single JSON object matching the provided schema. No commentary.`;

// ---------------------------------------------------------------------------
// Date helpers (Europe/London, weekend-aware; bank holidays not handled —
// see SETUP.md for the gov.uk upgrade)
// ---------------------------------------------------------------------------

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function parseYmd(s: string): Date {
  return new Date(`${s.slice(0, 10)}T12:00:00Z`);
}
function isWeekend(d: Date): boolean {
  const day = d.getUTCDay();
  return day === 0 || day === 6;
}
/** First weekday strictly after the given date. */
function nextWeekday(dateStr: string): string {
  const d = parseYmd(dateStr);
  do {
    d.setUTCDate(d.getUTCDate() + 1);
  } while (isWeekend(d));
  return ymd(d);
}
/** Date that is `n` working days before the given date. */
function workingDaysBefore(dateStr: string, n: number): string {
  const d = parseYmd(dateStr);
  let left = n;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    if (!isWeekend(d)) left--;
  }
  return ymd(d);
}
function makeIso(date: string, hhmm: string): string {
  return `${date}T${hhmm}:00`;
}
function addMinutes(hhmm: string, minutes: number): string {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}
function poundsToPence(n: number): number {
  return Math.round(n * 100);
}
function fmt(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`;
}
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function norm(name: string): string {
  return name.trim().toLowerCase();
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

type ActionType = "no_action" | "change" | "verify";
interface PayeeAction {
  payeeName: string;
  requiredPence: number;
  previousPence: number | null;
  actionType: ActionType;
  note: string;
}
export interface PayslipRunResult {
  ok: boolean;
  status: "ok" | "needs_review" | "skipped" | "error";
  period?: string;
  actions?: PayeeAction[];
  changesEventId?: string;
  hmrcEventId?: string;
  reasons?: string[];
  message?: string;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

export async function runPayslipAgent(): Promise<PayslipRunResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error("Anthropic API key not configured (ANTHROPIC_API_KEY).");
  }

  // The read_write Outlook account is used both to read mail (Mail.Read) and
  // to write the calendar appointments (Calendars.ReadWrite).
  const account = await storage.getReadWriteOauthToken("microsoft");
  if (!account) throw new Error("No read_write Outlook account connected.");
  const token = await getValidAccessToken(account.accountKey);

  // 1. Latest email from the accountant
  const email = await getLatestMessageFromSender(token, accountantEmail());
  if (!email) {
    return { ok: true, status: "skipped", message: "No email from the accountant found." };
  }

  // 2. Idempotency — already processed this message?
  const existing = await db
    .select({ id: payslipRuns.id })
    .from(payslipRuns)
    .where(eq(payslipRuns.sourceMessageId, email.id))
    .limit(1);
  if (existing.length > 0) {
    return { ok: true, status: "skipped", message: "Latest accountant email already processed." };
  }

  // 3. Unzip the attachment(s) and collect payslip PDFs
  const attachments = await getMessageAttachments(token, email.id);
  const pdfBuffers: { name: string; b64: string }[] = [];
  for (const att of attachments) {
    const isZip = /\.zip$/i.test(att.name) || /zip/i.test(att.contentType);
    if (isZip) {
      const zip = new AdmZip(Buffer.from(att.contentBytes, "base64"));
      for (const entry of zip.getEntries()) {
        if (!entry.isDirectory && /\.pdf$/i.test(entry.entryName)) {
          pdfBuffers.push({ name: entry.entryName, b64: entry.getData().toString("base64") });
        }
      }
    } else if (/\.pdf$/i.test(att.name)) {
      pdfBuffers.push({ name: att.name, b64: att.contentBytes });
    }
  }
  if (pdfBuffers.length === 0) {
    return await recordNeedsReview(email, "No payslip PDFs found in the email attachments.");
  }

  // 4. Extract with Claude (PDF document blocks + email body), structured output
  const client = new Anthropic();
  const content: any[] = [
    { type: "text", text: `Accountant's email body:\n\n${email.bodyText || "(empty)"}` },
    ...pdfBuffers.map((p) => ({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: p.b64 },
    })),
    { type: "text", text: "Extract the figures as per the schema." },
  ];

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    thinking: { type: "adaptive" },
    output_config: {
      effort: "high",
      format: { type: "json_schema", schema: EXTRACT_SCHEMA },
    },
    system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content }],
  } as any);

  const textBlock = response.content.find((b: any) => b.type === "text") as any;
  if (!textBlock) return await recordNeedsReview(email, "Claude returned no JSON output block.");

  let data: Extraction;
  try {
    data = JSON.parse(textBlock.text) as Extraction;
  } catch (err: any) {
    return await recordNeedsReview(email, `Could not parse extraction JSON: ${err?.message ?? err}`);
  }

  // 5. Validate before doing anything real
  const reasons: string[] = [];
  if (!data.period) reasons.push("Missing pay period.");
  if (!data.payees?.length) reasons.push("No payees extracted.");
  for (const p of data.payees ?? []) {
    if (!(p.netPayGbp > 0)) reasons.push(`Net pay for ${p.name || "(unnamed)"} is not a positive number.`);
  }
  if (data.hmrc) {
    if (!(data.hmrc.amountGbp >= 0)) reasons.push("HMRC amount is invalid.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data.hmrc.dueDate || "")) reasons.push("HMRC due date is not a valid date.");
    if (!data.hmrc.reference?.trim()) reasons.push("HMRC payment reference is missing.");
  }
  if (reasons.length > 0) {
    return await recordNeedsReview(email, reasons.join(" "));
  }

  // 6. Compare each net pay to the standing-order baseline
  const baseline = await db.select().from(standingOrders);
  const baselineByName = new Map(baseline.map((b) => [norm(b.payeeName), b]));

  const actions: PayeeAction[] = [];
  for (const p of data.payees) {
    const requiredPence = poundsToPence(p.netPayGbp);
    const known = baselineByName.get(norm(p.name));
    if (!known) {
      actions.push({
        payeeName: p.name,
        requiredPence,
        previousPence: null,
        actionType: "verify",
        note: "Not in baseline — set up / verify standing order.",
      });
    } else if (known.currentAmountPence === requiredPence) {
      actions.push({ payeeName: p.name, requiredPence, previousPence: requiredPence, actionType: "no_action", note: "" });
    } else {
      actions.push({
        payeeName: p.name,
        requiredPence,
        previousPence: known.currentAmountPence,
        actionType: "change",
        note: `Change standing order ${fmt(known.currentAmountPence)} → ${fmt(requiredPence)}`,
      });
    }
  }

  // 7. Build + create the two appointments
  const changesDate = nextWeekday(email.receivedDateTime.slice(0, 10));
  const changesBody = buildChangesBody(data.period, actions);
  const changesEvent = await createCalendarEvent(token, {
    subject: `Payslip actions — ${data.period}`,
    bodyHtml: changesBody,
    startISO: makeIso(changesDate, APPT_TIME),
    endISO: makeIso(changesDate, addMinutes(APPT_TIME, APPT_DURATION_MIN)),
    timeZone: TIME_ZONE,
    categories: [CATEGORY],
  });

  let hmrcEvent: { id: string } | null = null;
  if (data.hmrc) {
    const hmrcDate = workingDaysBefore(data.hmrc.dueDate, HMRC_LEAD_WORKING_DAYS);
    hmrcEvent = await createCalendarEvent(token, {
      subject: `Pay HMRC — ${data.period}`,
      bodyHtml: buildHmrcBody(data.period, data.hmrc),
      startISO: makeIso(hmrcDate, APPT_TIME),
      endISO: makeIso(hmrcDate, addMinutes(APPT_TIME, APPT_DURATION_MIN)),
      timeZone: TIME_ZONE,
      categories: [CATEGORY],
    });
  }

  // 8. Persist the run + actions; update the baseline to the latest figures
  const [run] = await db
    .insert(payslipRuns)
    .values({
      period: data.period,
      sourceMessageId: email.id,
      status: "ok",
      hmrcAmountPence: data.hmrc ? poundsToPence(data.hmrc.amountGbp) : null,
      hmrcDueDate: data.hmrc ? data.hmrc.dueDate : null,
      hmrcReference: data.hmrc ? data.hmrc.reference : null,
      hmrcAccount: data.hmrc ? data.hmrc.account : null,
      changesEventId: changesEvent.id,
      hmrcEventId: hmrcEvent?.id ?? null,
      notes: data.notes ?? "",
      modelUsage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
    })
    .returning({ id: payslipRuns.id });

  for (const a of actions) {
    await db.insert(payslipActions).values({
      runId: run.id,
      payeeName: a.payeeName,
      requiredAmountPence: a.requiredPence,
      previousAmountPence: a.previousPence,
      actionType: a.actionType,
      note: a.note,
    });
    // Keep the baseline current: assume the change will be actioned.
    if (a.actionType === "change") {
      await db
        .update(standingOrders)
        .set({ currentAmountPence: a.requiredPence, updatedAt: new Date() })
        .where(eq(standingOrders.payeeName, a.payeeName));
    }
  }

  return {
    ok: true,
    status: "ok",
    period: data.period,
    actions,
    changesEventId: changesEvent.id,
    hmrcEventId: hmrcEvent?.id,
  };
}

// ---------------------------------------------------------------------------
// Appointment bodies + needs-review fallback
// ---------------------------------------------------------------------------

function buildChangesBody(period: string, actions: PayeeAction[]): string {
  const lines = actions.map((a) => {
    if (a.actionType === "no_action") return `• ${escapeHtml(a.payeeName)} — no action (${fmt(a.requiredPence)})`;
    if (a.actionType === "change")
      return `• <strong>${escapeHtml(a.payeeName)} — ${escapeHtml(a.note)}</strong>`;
    return `• <strong>${escapeHtml(a.payeeName)} — verify / set up standing order (${fmt(a.requiredPence)})</strong>`;
  });
  return [
    `<p><strong>Payslip actions — ${escapeHtml(period)}</strong></p>`,
    `<p>${lines.join("<br>")}</p>`,
    `<p style="color:#888;font-size:11px">Created by the payslip agent</p>`,
  ].join("");
}

function buildHmrcBody(period: string, hmrc: HmrcFigure): string {
  return [
    `<p><strong>Pay HMRC — ${escapeHtml(period)}</strong></p>`,
    `<p>• Amount: <strong>${fmt(poundsToPence(hmrc.amountGbp))}</strong><br>`,
    `• Due by: ${escapeHtml(hmrc.dueDate)}<br>`,
    `• Reference: <strong>${escapeHtml(hmrc.reference)}</strong><br>`,
    hmrc.account ? `• Account: ${escapeHtml(hmrc.account)}` : "",
    `</p>`,
    `<p style="color:#888;font-size:11px">Reference copied verbatim from the accountant's email · Created by the payslip agent</p>`,
  ].join("");
}

/** Records a run that needs manual attention and drops a single nudge appointment. */
async function recordNeedsReview(
  email: { id: string; receivedDateTime: string },
  reason: string,
): Promise<PayslipRunResult> {
  try {
    const account = await storage.getReadWriteOauthToken("microsoft");
    if (account) {
      const token = await getValidAccessToken(account.accountKey);
      const date = nextWeekday(email.receivedDateTime.slice(0, 10));
      await createCalendarEvent(token, {
        subject: "Payslip agent needs attention",
        bodyHtml: `<p>The payslip agent couldn't process this month automatically.</p><p><em>${escapeHtml(reason)}</em></p><p>Open the accountant's email and handle the payments manually.</p>`,
        startISO: makeIso(date, APPT_TIME),
        endISO: makeIso(date, addMinutes(APPT_TIME, APPT_DURATION_MIN)),
        timeZone: TIME_ZONE,
        categories: [CATEGORY],
      });
    }
  } catch {
    /* best-effort nudge only */
  }
  await db.insert(payslipRuns).values({ period: "(unknown)", sourceMessageId: email.id, status: "needs_review", notes: reason });
  return { ok: false, status: "needs_review", reasons: [reason] };
}
