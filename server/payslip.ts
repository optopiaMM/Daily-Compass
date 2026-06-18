// server/payslip.ts
//
// Monthly payslip agent. Mirrors the architecture of agent.ts:
//   gather -> call Claude (structured output) -> validate in code -> act.
//
// Flow:
//   1. Find the latest email from the accountant (Outlook via Graph).
//   2. Skip if we've already processed that message (idempotent — safe to
//      run on a daily cron; it no-ops until a new email arrives).
//   3. Unzip the attachment, hand the extracted PDFs + email body to Claude,
//      get back structured figures: net pay per payee from the BACS Pay Transfer
//      Report (NOT individual payslips), and HMRC amount/due-date/reference from
//      the email body (Form P32 used only as a cross-check / fallback).
//   4. Validate the figures deterministically before doing anything real.
//   5. Compare each net pay to the standing-order baseline.
//   6. Create TWO calendar appointments via the existing Graph code:
//        - "Payslip actions" — next weekday after the email, 08:00, 15 min
//        - "Pay HMRC"        — 2 working days before due date, 08:00, 15 min
//   7. Record the run + actions; update the baseline to the latest figures.

import Anthropic from "@anthropic-ai/sdk";
import { extractFull } from "node-7z";
import { path7za } from "7zip-bin";
import { PDFDocument } from "pdf-lib";
import { mkdtemp, writeFile, readFile, readdir, rm, chmod } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
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
/** Final, code-resolved HMRC payment (after email/P32 reconciliation). */
interface HmrcFigure {
  amountGbp: number;
  dueDate: string; // YYYY-MM-DD
  reference: string;
  account: string;
}
/** What Claude pulls straight from the email body — only what is literally there. */
interface HmrcEmail {
  amountGbp: number | null;
  dueDate: string | null; // YYYY-MM-DD or null
  reference: string | null; // verbatim or null
  account: string; // "" if not stated
}
/** What Claude pulls from the Form P32 — used for cross-check / fallback only. */
interface HmrcP32 {
  totalAmountDueGbp: number | null;
  accountsOfficeReference: string | null; // verbatim from the P32
  taxMonthEnd: string | null; // the tax-month-end date the P32 covers, YYYY-MM-DD
}
interface HmrcExtraction {
  paymentDue: boolean;
  email: HmrcEmail;
  p32: HmrcP32;
}
interface Extraction {
  period: string;
  payees: PayeeFigure[]; // from the BACS Pay Transfer Report page
  bacsPaymentSummaryTotalGbp: number | null; // "Payment Summary" total, sanity check
  hmrc: HmrcExtraction;
  notes: string;
}

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    period: {
      type: "string",
      description:
        'The pay-run period, e.g. "June 2026", derived from the Form P32 tax month / date ' +
        'range — NOT from any payslip. UK tax months end on the 5th, so the pay run is the ' +
        'calendar month immediately before the P32 "Date To" (e.g. Date To 05/07/2026 -> June 2026).',
    },
    payees: {
      type: "array",
      description:
        'Net pay per person, taken ONLY from the "BACS Pay Transfer Report" page inside the ' +
        "Payroll Reports PDF (Account Name + Net Pay). Do NOT read individual payslip pages.",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: {
            type: "string",
            description:
              'The Account Name exactly as shown on the BACS report, e.g. "E Mills", "M Mills".',
          },
          netPayGbp: { type: "number", description: "Net (take-home) pay in GBP, e.g. 1047.50" },
        },
        required: ["name", "netPayGbp"],
      },
    },
    bacsPaymentSummaryTotalGbp: {
      anyOf: [{ type: "null" }, { type: "number" }],
      description:
        'The total from the "Payment Summary" on the BACS report (the sum of all net pay), ' +
        "or null if not present. Used only to sanity-check that the per-person figures add up.",
    },
    hmrc: {
      type: "object",
      additionalProperties: false,
      description:
        "HMRC PAYE/NIC payment for the period. The figures the agent acts on come from the " +
        "EMAIL BODY; the Form P32 fields are for cross-check / fallback only.",
      properties: {
        paymentDue: {
          type: "boolean",
          description: "True if a PAYE/NIC payment to HMRC is due for this period, else false.",
        },
        email: {
          type: "object",
          additionalProperties: false,
          description: "Strictly what the accountant's email body states. Use null where absent.",
          properties: {
            amountGbp: {
              anyOf: [{ type: "null" }, { type: "number" }],
              description: "Amount due to HMRC per the EMAIL BODY, or null if the email omits it.",
            },
            dueDate: {
              anyOf: [{ type: "null" }, { type: "string" }],
              description: "Due date per the EMAIL BODY as YYYY-MM-DD, or null if the email omits it.",
            },
            reference: {
              anyOf: [{ type: "null" }, { type: "string" }],
              description:
                "The HMRC payment reference copied VERBATIM from the EMAIL BODY, or null if the " +
                "email omits it. Never reconstruct or guess it — the period suffix changes monthly.",
            },
            account: {
              type: "string",
              description:
                "Destination account details (sort code / account no / name) per the email, or \"\".",
            },
          },
          required: ["amountGbp", "dueDate", "reference", "account"],
        },
        p32: {
          type: "object",
          additionalProperties: false,
          description: 'From the Form P32 / Employer Payment Record. Cross-check / fallback only.',
          properties: {
            totalAmountDueGbp: {
              anyOf: [{ type: "null" }, { type: "number" }],
              description: 'The P32 "Total Amount Due" in GBP, or null if not found.',
            },
            accountsOfficeReference: {
              anyOf: [{ type: "null" }, { type: "string" }],
              description:
                'The P32 "Accounts Office Reference" copied VERBATIM, or null if not found. This is ' +
                "the base reference WITHOUT the monthly period suffix.",
            },
            taxMonthEnd: {
              anyOf: [{ type: "null" }, { type: "string" }],
              description:
                "The tax-month-end date the P32 covers, as YYYY-MM-DD (UK tax months end on the 5th), " +
                "or null if not found.",
            },
          },
          required: ["totalAmountDueGbp", "accountsOfficeReference", "taxMonthEnd"],
        },
      },
      required: ["paymentDue", "email", "p32"],
    },
    notes: { type: "string", description: "One short line on anything ambiguous. Keep it brief." },
  },
  required: ["period", "payees", "bacsPaymentSummaryTotalGbp", "hmrc", "notes"],
} as const;

const SYSTEM_PROMPT = `You extract structured payroll figures for a small UK limited company.

You are given the body text of an email from the company's accountant, plus the
relevant PDF pages extracted from a zip. You are normally given exactly two:
- the "BACS Pay Transfer Report" page (a table of Account Name + Net Pay), and
- a "Form P32" / "Employer Payment Record".
Individual payslip pages are deliberately withheld; if one ever appears, IGNORE it.

WHERE TO READ EACH FIGURE
- NET PAY: read ONLY from the "Net Pay" column of the "BACS Pay Transfer Report"
  table. Each row is "Sort Code  Account Name  Net Pay  ..." e.g.
  "00-00-00  E Mills  1,047.50" and "00-00-00  M Mills  965.10", with a total
  (e.g. 2,012.60) used only to sanity-check that the per-person figures sum
  correctly. Do NOT read net pay (or any figure) from an individual payslip page
  — ignore every payslip entirely. (You are normally given only the BACS report
  page and the P32; if any payslip page is present, ignore it.)
- PERIOD: derive the pay-run month from the Form P32 tax month / "Date To". Tax
  months end on the 5th, so the pay run is the calendar month immediately before
  the Date To (e.g. Date To 05/07/2026 -> "June 2026"). Never read the period
  off an individual payslip.
- HMRC: the amount, due date and payment reference the company acts on all come
  from the ACCOUNTANT'S EMAIL BODY. Put exactly those into hmrc.email (use null
  for anything the email does not state). Separately, read the Form P32's
  "Total Amount Due", "Accounts Office Reference" and tax-month-end into hmrc.p32
  for cross-checking only.

CRITICAL RULES
- The HMRC payment reference must be copied VERBATIM from the email body — it
  carries a period suffix that changes every month. Never reconstruct or guess
  it. If the email omits it, set hmrc.email.reference to null (do NOT fall back
  to the P32 reference yourself; the calling code handles fallback).
- Net pay is the take-home figure, NOT gross and NOT total cost to employer.
- Amounts are plain numbers in GBP (e.g. 1047.50), no currency symbols or commas.
- If no HMRC payment is due this period, set hmrc.paymentDue to false.
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
/**
 * Normalises a name for matching: strips any leading title (Mr/Mrs/Ms/Miss/Dr),
 * trailing punctuation, lowercases, and collapses whitespace. So "Mrs. E Mills"
 * and "E Mills" both normalise to "e mills".
 */
function norm(name: string): string {
  return name
    .replace(/^\s*(mr|mrs|ms|miss|dr)\.?\s+/i, "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/** 22nd of the month following the tax-month-end date (fallback HMRC due date). */
function due22ndAfterTaxMonthEnd(taxMonthEnd: string): string {
  const d = parseYmd(taxMonthEnd);
  const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 22, 12, 0, 0));
  return ymd(next);
}

/**
 * Reconciles the HMRC figures. The amount, due date and reference are taken from
 * the accountant's EMAIL BODY when present. The P32 is a cross-check; it only
 * supplies a value when the email omits one:
 *   - amount    -> P32 "Total Amount Due"
 *   - due date  -> 22nd of the month following the P32 tax-month-end
 *   - reference -> P32 "Accounts Office Reference", flagged as needing the period
 *                  suffix confirmed (the reference is NEVER reconstructed silently).
 * Returns the resolved figure plus any notes (mismatches, fallbacks used).
 */
function resolveHmrc(h: HmrcExtraction): { figure: HmrcFigure | null; notes: string[] } {
  const notes: string[] = [];
  if (!h.paymentDue) return { figure: null, notes };

  const email = h.email;
  const p32 = h.p32;

  // Amount: email first, P32 as fallback / cross-check.
  let amountGbp: number | null = email.amountGbp;
  if (amountGbp == null) {
    amountGbp = p32.totalAmountDueGbp;
    if (amountGbp != null) notes.push(`HMRC amount taken from P32 Total Amount Due (£${amountGbp.toFixed(2)}) — email did not state it.`);
  } else if (p32.totalAmountDueGbp != null && Math.abs(p32.totalAmountDueGbp - amountGbp) > 0.005) {
    notes.push(`HMRC amount mismatch: email £${amountGbp.toFixed(2)} vs P32 Total Amount Due £${p32.totalAmountDueGbp.toFixed(2)}.`);
  }

  // Due date: email first, else 22nd of month after the P32 tax-month-end.
  let dueDate: string | null = email.dueDate;
  if (!dueDate) {
    if (p32.taxMonthEnd && /^\d{4}-\d{2}-\d{2}$/.test(p32.taxMonthEnd)) {
      dueDate = due22ndAfterTaxMonthEnd(p32.taxMonthEnd);
      notes.push(`HMRC due date derived as ${dueDate} (22nd of month after P32 tax-month-end) — email did not state it.`);
    } else {
      notes.push("HMRC due date missing from email and no P32 tax-month-end to derive it from.");
    }
  }

  // Reference: ALWAYS verbatim from the email when present; never reconstructed.
  let reference: string | null = email.reference?.trim() || null;
  if (!reference) {
    if (p32.accountsOfficeReference?.trim()) {
      reference = p32.accountsOfficeReference.trim();
      notes.push(`HMRC reference fell back to the P32 Accounts Office Reference (${reference}) — email did not state it. The monthly period suffix MUST be confirmed before paying.`);
    } else {
      notes.push("HMRC reference missing from email and no P32 Accounts Office Reference to fall back to.");
    }
  }

  return {
    figure: {
      amountGbp: amountGbp ?? 0,
      dueDate: dueDate ?? "",
      reference: reference ?? "",
      account: email.account ?? "",
    },
    notes,
  };
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
// Zip extraction (AES-aware)
// ---------------------------------------------------------------------------

/**
 * Extracts payslip PDFs from a (possibly AES-encrypted) zip.
 *
 * adm-zip cannot open AES-encrypted archives — its password support only covers
 * legacy ZipCrypto — and the accountant's payroll software produces AES zips. So
 * we shell out to the cross-platform 7-Zip binary bundled by `7zip-bin` via
 * `node-7z`, which handles both schemes. The zip bytes are written to a temp
 * file, extracted with the password from PAYSLIP_ZIP_PASSWORD into a temp dir,
 * each PDF is read back as base64, then the temp files are removed.
 */
async function extractPdfsFromZip(zipBytes: Buffer): Promise<{ name: string; b64: string }[]> {
  const password = process.env.PAYSLIP_ZIP_PASSWORD;
  if (!password) {
    throw new Error(
      "PAYSLIP_ZIP_PASSWORD not set — cannot open the password-protected payslip zip.",
    );
  }

  const workDir = await mkdtemp(join(tmpdir(), "payslip-"));
  const zipPath = join(workDir, "payslip.zip");
  const outDir = join(workDir, "out");
  try {
    await writeFile(zipPath, zipBytes);

    // 7zip-bin ships the Linux binary without the executable bit set, so the
    // spawn fails with EACCES on Railway. Mark it executable once before use.
    // (Windows ignores the POSIX mode, so skip it to avoid surprising local runs.)
    if (process.platform !== "win32") {
      try {
        await chmod(path7za, 0o755);
      } catch (err: any) {
        console.warn(`Could not chmod 7-Zip binary at ${path7za}: ${err?.message ?? err}`);
      }
    }

    await new Promise<void>((resolve, reject) => {
      const stream = extractFull(zipPath, outDir, {
        password,
        $bin: path7za,
        recursive: true,
      });
      stream.on("end", () => resolve());
      stream.on("error", (err) =>
        reject(new Error(`7-Zip extraction failed: ${err?.message ?? err}`)),
      );
    });

    const out: { name: string; b64: string }[] = [];
    const entries = await readdir(outDir, { recursive: true, withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && /\.pdf$/i.test(entry.name)) {
        const bytes = await readFile(join(entry.parentPath, entry.name));
        out.push({ name: entry.name, b64: bytes.toString("base64") });
      }
    }
    return out;
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Document selection — send the model ONLY the pages that carry the figures
// ---------------------------------------------------------------------------

/** A labelled PDF (base64) ready to hand to the model as a document block. */
interface DocBlock {
  label: string;
  b64: string;
}

/** Returns a new single-page PDF (base64) containing only page `index` of `b64`. */
async function extractPage(b64: string, index: number): Promise<string> {
  const src = await PDFDocument.load(Buffer.from(b64, "base64"));
  const out = await PDFDocument.create();
  const [page] = await out.copyPages(src, [index]);
  out.addPage(page);
  const bytes = await out.save();
  return Buffer.from(bytes).toString("base64");
}

/**
 * Picks the documents to send to the model from the extracted PDFs:
 *   - the BACS Pay Transfer Report — page 1 ONLY of the Payroll Reports PDF
 *     (so the individual payslip pages 2..n are never seen by the model),
 *   - the Form P32 — sent whole (single page).
 *
 * Files are identified by filename ("...Payroll_Reports...", "...P32..."), with
 * a page-count fallback (the multi-page PDF is the reports file, the 1-page PDF
 * the P32). Any other / individual-payslip PDFs are dropped entirely.
 *
 * Falls back to sending every PDF (labelled, with strong instructions) only if
 * neither file can be identified — better degraded than blind.
 */
async function selectDocuments(
  pdfs: { name: string; b64: string }[],
): Promise<{ blocks: DocBlock[]; notes: string[] }> {
  const notes: string[] = [];

  let reports = pdfs.find((p) => /payroll[\s_-]*reports?/i.test(p.name) && !/p32/i.test(p.name));
  let p32 = pdfs.find((p) => /p32/i.test(p.name));

  // [DIAG] Did the filename match work? (Temporary diagnostics.)
  const reportsByName = !!reports;
  const p32ByName = !!p32;
  console.log(
    `[payslip:diag] selectDocuments: filename match — Payroll Reports: ${reports ? `"${reports.name}"` : "NOT FOUND"}; ` +
      `P32: ${p32 ? `"${p32.name}"` : "NOT FOUND"}`,
  );

  // Filename fallback: classify by page count when names don't match.
  if (!reports || !p32) {
    const withPages = await Promise.all(
      pdfs.map(async (p) => {
        try {
          const doc = await PDFDocument.load(Buffer.from(p.b64, "base64"));
          return { ...p, pages: doc.getPageCount() };
        } catch {
          return { ...p, pages: 0 };
        }
      }),
    );
    if (!reports) reports = withPages.slice().sort((a, b) => b.pages - a.pages)[0];
    if (!p32) p32 = withPages.find((p) => p.pages === 1 && p.name !== reports?.name);

    // [DIAG] We fell back to page-count heuristics for at least one file. This
    // is the prime suspect for the wrong figures — flag it loudly.
    if (!reportsByName) {
      console.warn(
        `[payslip:diag] WARNING: Payroll Reports file was NOT identified by filename — ` +
          `fell back to the highest-page-count PDF: ${reports ? `"${reports.name}"` : "still none"}.`,
      );
    }
    if (!p32ByName) {
      console.warn(
        `[payslip:diag] WARNING: P32 file was NOT identified by filename — ` +
          `fell back to a 1-page PDF: ${p32 ? `"${p32.name}"` : "still none"}.`,
      );
    }
  }

  if (!reports) {
    // Couldn't identify the reports file at all — send everything, degraded.
    console.warn(
      `[payslip:diag] WARNING: could not identify the Payroll Reports PDF at all — ` +
        `sending ALL ${pdfs.length} PDF(s) to the model (this includes individual payslips!).`,
    );
    notes.push("Could not identify the Payroll Reports PDF; sent all PDFs to the model.");
    return { blocks: pdfs.map((p) => ({ label: p.name, b64: p.b64 })), notes };
  }

  const blocks: DocBlock[] = [];
  try {
    const bacsPage = await extractPage(reports.b64, 0); // page 1 = BACS report
    console.log(
      `[payslip:diag] sliced page 1 (index 0) of "${reports.name}" as the BACS Pay Transfer Report.`,
    );
    blocks.push({ label: `BACS Pay Transfer Report (page 1 of ${reports.name})`, b64: bacsPage });
  } catch (err: any) {
    console.warn(
      `[payslip:diag] WARNING: could not isolate page 1 of "${reports.name}" (${err?.message ?? err}) — ` +
        `sending the WHOLE reports PDF (model may see individual payslips).`,
    );
    notes.push(`Could not isolate the BACS page (${err?.message ?? err}); sent the whole reports PDF.`);
    blocks.push({ label: `Payroll Reports — ${reports.name}`, b64: reports.b64 });
  }
  if (p32) {
    console.log(`[payslip:diag] sending Form P32 (whole): "${p32.name}".`);
    blocks.push({ label: `Form P32 — ${p32.name}`, b64: p32.b64 });
  } else {
    console.warn(
      `[payslip:diag] WARNING: could not identify the Form P32 — HMRC cross-check / fallback unavailable.`,
    );
    notes.push("Could not identify the Form P32; HMRC cross-check / fallback unavailable.");
  }

  // [DIAG] Final summary of exactly what is being handed to the model.
  console.log(
    `[payslip:diag] selectDocuments: sending ${blocks.length} document block(s) to the model: ` +
      blocks.map((b) => `"${b.label}"`).join(", "),
  );
  return { blocks, notes };
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
      const pdfs = await extractPdfsFromZip(Buffer.from(att.contentBytes, "base64"));
      pdfBuffers.push(...pdfs);
    } else if (/\.pdf$/i.test(att.name)) {
      pdfBuffers.push({ name: att.name, b64: att.contentBytes });
    }
  }
  if (pdfBuffers.length === 0) {
    return await recordNeedsReview(email, "No payslip PDFs found in the email attachments.");
  }

  // [DIAG] List every PDF extracted from the zip with its page count, so we can
  // confirm which files arrived and how big they are. (Temporary diagnostics.)
  for (const p of pdfBuffers) {
    let pages = -1;
    try {
      pages = (await PDFDocument.load(Buffer.from(p.b64, "base64"))).getPageCount();
    } catch (err: any) {
      console.warn(`[payslip:diag] could not read page count for "${p.name}": ${err?.message ?? err}`);
    }
    console.log(`[payslip:diag] extracted PDF: "${p.name}" — ${pages} page(s)`);
  }

  // 4. Pick the documents to send. We send ONLY page 1 of the Payroll Reports
  // PDF (the BACS Pay Transfer Report) plus the Form P32 — the individual
  // payslip pages are never handed to the model, so it cannot read net pay off
  // them. selectDocuments handles identifying and slicing the files.
  const { blocks: docBlocks, notes: docNotes } = await selectDocuments(pdfBuffers);

  const client = new Anthropic();
  const content: any[] = [
    { type: "text", text: `Accountant's email body:\n\n${email.bodyText || "(empty)"}` },
  ];
  for (const b of docBlocks) {
    content.push({ type: "text", text: `--- ${b.label} ---` });
    content.push({
      type: "document",
      source: { type: "base64", media_type: "application/pdf", data: b.b64 },
    });
  }
  content.push({
    type: "text",
    text:
      "Extract the figures as per the schema. NET PAY comes ONLY from the 'Net Pay' " +
      "column of the BACS Pay Transfer Report table (match Account Names like " +
      "'E Mills' / 'M Mills'); never read net pay from an individual payslip. " +
      "Derive the PERIOD from the Form P32 tax-month / date range, not from any " +
      "payslip. HMRC amount/due-date/reference come from the email body, with the " +
      "P32 Total Amount Due and Accounts Office Reference as cross-check / fallback.",
  });

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

  // 5. Resolve HMRC from the email body (P32 cross-check / fallback) and gather notes.
  const { figure: hmrc, notes: hmrcNotes } = resolveHmrc(data.hmrc);
  const extraNotes: string[] = [...docNotes, ...hmrcNotes];

  // Sanity check: the per-person net figures should sum to the BACS Payment Summary.
  if (data.bacsPaymentSummaryTotalGbp != null && data.payees?.length) {
    const sum = data.payees.reduce((acc, p) => acc + (p.netPayGbp || 0), 0);
    if (Math.abs(sum - data.bacsPaymentSummaryTotalGbp) > 0.01) {
      extraNotes.push(
        `BACS sanity check failed: per-person net pay sums to £${sum.toFixed(2)} but the ` +
          `Payment Summary total is £${data.bacsPaymentSummaryTotalGbp.toFixed(2)}.`,
      );
    }
  }

  // 6. Validate before doing anything real
  const reasons: string[] = [];
  if (!data.period) reasons.push("Missing pay period.");
  if (!data.payees?.length) reasons.push("No payees extracted from the BACS report.");
  for (const p of data.payees ?? []) {
    if (!(p.netPayGbp > 0)) reasons.push(`Net pay for ${p.name || "(unnamed)"} is not a positive number.`);
  }
  // A failed BACS sanity check means the net figures are wrong — don't act on them.
  if (data.bacsPaymentSummaryTotalGbp != null && data.payees?.length) {
    const sum = data.payees.reduce((acc, p) => acc + (p.netPayGbp || 0), 0);
    if (Math.abs(sum - data.bacsPaymentSummaryTotalGbp) > 0.01) {
      reasons.push("Net pay figures do not sum to the BACS Payment Summary total.");
    }
  }
  if (hmrc) {
    if (!(hmrc.amountGbp > 0)) reasons.push("HMRC amount is missing or not positive.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(hmrc.dueDate)) reasons.push("HMRC due date is missing or not a valid date.");
    if (!hmrc.reference.trim()) reasons.push("HMRC payment reference is missing.");
  }
  if (reasons.length > 0) {
    return await recordNeedsReview(email, [...reasons, ...extraNotes].join(" "));
  }

  // 7. Compare each net pay to the standing-order baseline. The BACS report names
  // people as "E Mills" / "M Mills"; match those to the full baseline names via
  // each row's payeeName plus its aliases (all title-stripped, case-insensitive).
  const baseline = await db.select().from(standingOrders);
  const baselineByName = new Map<string, (typeof baseline)[number]>();
  for (const b of baseline) {
    baselineByName.set(norm(b.payeeName), b);
    for (const alias of b.aliases ?? []) baselineByName.set(norm(alias), b);
  }

  const actions: PayeeAction[] = [];
  for (const p of data.payees) {
    const requiredPence = poundsToPence(p.netPayGbp);
    const known = baselineByName.get(norm(p.name));
    // When matched, label the action with the full baseline name, not the
    // abbreviated BACS name, so the calendar entry reads clearly.
    const displayName = known ? known.payeeName : p.name;
    if (!known) {
      actions.push({
        payeeName: displayName,
        requiredPence,
        previousPence: null,
        actionType: "verify",
        note: `Not in baseline (BACS name "${p.name}") — set up / verify standing order.`,
      });
    } else if (known.currentAmountPence === requiredPence) {
      actions.push({ payeeName: displayName, requiredPence, previousPence: requiredPence, actionType: "no_action", note: "" });
    } else {
      actions.push({
        payeeName: displayName,
        requiredPence,
        previousPence: known.currentAmountPence,
        actionType: "change",
        note: `Change standing order ${fmt(known.currentAmountPence)} → ${fmt(requiredPence)}`,
      });
    }
  }

  // 8. Build + create the two appointments
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
  if (hmrc) {
    const hmrcDate = workingDaysBefore(hmrc.dueDate, HMRC_LEAD_WORKING_DAYS);
    hmrcEvent = await createCalendarEvent(token, {
      subject: `Pay HMRC — ${data.period}`,
      bodyHtml: buildHmrcBody(data.period, hmrc, hmrcNotes),
      startISO: makeIso(hmrcDate, APPT_TIME),
      endISO: makeIso(hmrcDate, addMinutes(APPT_TIME, APPT_DURATION_MIN)),
      timeZone: TIME_ZONE,
      categories: [CATEGORY],
    });
  }

  // 9. Persist the run + actions; update the baseline to the latest figures
  const combinedNotes = [data.notes?.trim(), ...extraNotes].filter(Boolean).join(" ");
  const [run] = await db
    .insert(payslipRuns)
    .values({
      period: data.period,
      sourceMessageId: email.id,
      status: "ok",
      hmrcAmountPence: hmrc ? poundsToPence(hmrc.amountGbp) : null,
      hmrcDueDate: hmrc ? hmrc.dueDate : null,
      hmrcReference: hmrc ? hmrc.reference : null,
      hmrcAccount: hmrc ? hmrc.account : null,
      changesEventId: changesEvent.id,
      hmrcEventId: hmrcEvent?.id ?? null,
      notes: combinedNotes,
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

function buildHmrcBody(period: string, hmrc: HmrcFigure, notes: string[]): string {
  const noteHtml = notes.length
    ? `<p style="color:#b00"><strong>⚠ Check before paying:</strong><br>${notes.map(escapeHtml).join("<br>")}</p>`
    : "";
  return [
    `<p><strong>Pay HMRC — ${escapeHtml(period)}</strong></p>`,
    `<p>• Amount: <strong>${fmt(poundsToPence(hmrc.amountGbp))}</strong><br>`,
    `• Due by: ${escapeHtml(hmrc.dueDate)}<br>`,
    `• Reference: <strong>${escapeHtml(hmrc.reference)}</strong><br>`,
    hmrc.account ? `• Account: ${escapeHtml(hmrc.account)}` : "",
    `</p>`,
    noteHtml,
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
